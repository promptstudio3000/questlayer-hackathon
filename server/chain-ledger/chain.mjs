// Sends the ledger queue (./service.mjs) to the questlayer_ledger contract.
//
// The recorder is a function-call access key on the ledger contract's own
// account (methods record_batch, commit_day, retry_gold), installed on the
// VPS as <state dir>/ledger-recorder.json by
// scripts/install-ledger-recorder-vps.sh. It cannot move NEAR; gas comes
// from the contract account's allowance and storage from its balance.
import { existsSync } from "node:fs";
import { loadServiceAccount } from "../relayer/key-transport.mjs";
import { MAX_BATCH } from "./service.mjs";

const GAS = 150n * 10n ** 12n;

const failureOf = (r) => {
  const all = [
    r?.status,
    ...(r?.receipts_outcome || []).map((x) => x.outcome?.status),
  ];
  const f = all.find((s) => s && typeof s === "object" && "Failure" in s);
  return f ? JSON.stringify(f.Failure) : null;
};

/** Return value of the transaction's first receipt (the called method). */
export function returnValue(r) {
  const first = r?.transaction_outcome?.outcome?.receipt_ids?.[0];
  const outcome = (r?.receipts_outcome || []).find(
    (x) => x.id === first,
  )?.outcome;
  const value = outcome?.status?.SuccessValue ?? r?.status?.SuccessValue;
  if (typeof value !== "string" || !value) return null;
  try {
    return JSON.parse(Buffer.from(value, "base64").toString());
  } catch {
    return null;
  }
}

export function createLedgerChain({
  provider,
  contractId,
  keyPath,
  log = console,
}) {
  const state = {
    contractId,
    ready: false,
    account: null,
    error: null,
    goldToken: null,
  };
  async function view(method, args = {}) {
    const r = await provider.query({
      request_type: "call_function",
      account_id: contractId,
      method_name: method,
      args_base64: Buffer.from(JSON.stringify(args)).toString("base64"),
      finality: "optimistic",
    });
    return JSON.parse(Buffer.from(r.result).toString());
  }
  async function connect() {
    if (!contractId || !keyPath || !existsSync(keyPath)) {
      state.error = !contractId ? "no contract" : "no recorder key";
      return state;
    }
    try {
      const service = await loadServiceAccount(provider, keyPath, {
        expectAccountId: contractId,
        requireFullAccess: false,
      });
      const config = await view("get_config");
      state.goldToken = config.gold_token || null;
      state.account = service.account;
      state.ready = true;
      state.error = null;
    } catch (e) {
      state.error = String(e?.message || e).slice(0, 200);
      log.warn?.(
        JSON.stringify({
          chainLedger: "recorder unavailable",
          error: state.error,
        }),
      );
    }
    return state;
  }
  async function call(methodName, args) {
    const r = await state.account.callFunctionRaw({
      contractId,
      methodName,
      args,
      deposit: 0n,
      gas: GAS,
      waitUntil: "EXECUTED_OPTIMISTIC",
    });
    const tx = r?.transaction?.hash || r?.transaction_outcome?.id || null;
    // Only the called receipt decides; a failed QGOLD mint is held on chain and retried.
    const first = r?.transaction_outcome?.outcome?.receipt_ids?.[0];
    const main = (r?.receipts_outcome || []).find((x) => x.id === first);
    const failure = main
      ? failureOf({ status: main.outcome?.status })
      : failureOf(r);
    if (failure) {
      const e = new Error(failure);
      e.tx = tx;
      e.contract = true;
      throw e;
    }
    return { tx, value: returnValue(r) };
  }
  return {
    get contractId() {
      return state.contractId;
    },
    get ready() {
      return state.ready;
    },
    get error() {
      return state.error;
    },
    get goldToken() {
      return state.goldToken;
    },
    connect,
    view,
    recordBatch: (actions) => call("record_batch", { actions }),
    commitDay: (d) =>
      call("commit_day", {
        day: d.day,
        root: d.root,
        count: String(d.count),
        xp: String(d.xp),
        gold: String(d.gold_u),
      }),
  };
}

/** One pass: bind accounts, plan records, commit finished days, send one batch. */
export async function runLedgerQueue(ledger, chain) {
  const done = {
    bound: 0,
    planned: 0,
    sent: 0,
    confirmed: 0,
    retried: 0,
    days: 0,
  };
  done.bound = ledger.bindAccounts();
  if (!chain?.ready) return done;

  // Seed the seq of accounts the chain may already know (restored database).
  const seeds = {};
  for (const account of ledger.accountsNeedingSeq().slice(0, 10))
    seeds[account] =
      Number(
        await chain.view("last_seq", { account_id: account }).catch(() => 0),
      ) || 0;
  done.planned += ledger.planEach(seeds);

  for (const day of ledger.daysToCommit()) ledger.prepareDay(day);
  for (const d of ledger.dueDays()) {
    try {
      const { tx } = await chain.commitDay(d);
      ledger.markDay(d.day, { tx, confirmed: true });
      done.days++;
    } catch (e) {
      const onChain = await chain
        .view("get_day", { day: d.day })
        .catch(() => null);
      if (onChain?.root === d.root)
        ledger.markDay(d.day, { tx: e.tx || null, confirmed: true });
      else ledger.markDay(d.day, { error: e?.message || e });
    }
  }
  done.planned += ledger.planDaily();

  // A record that failed twice goes alone, so one bad action cannot hold a batch.
  let batch = ledger.nextBatch(MAX_BATCH);
  if (batch.some((r) => r.attempts >= 2))
    batch = [batch.find((r) => r.attempts >= 2)];
  if (!batch.length) return done;
  done.sent = batch.length;
  try {
    const { tx, value } = await chain.recordBatch(
      batch.map(ledger.contractAction),
    );
    const skipped = new Set(value?.skipped_refs || []);
    const ok = [];
    for (const r of batch) {
      if (!skipped.has(r.id)) ok.push(r.id);
      else if (r.attempts > 0)
        ok.push(r.id); // recorded by an earlier send whose reply was lost
      else {
        const last =
          Number(
            await chain
              .view("last_seq", { account_id: r.account_id })
              .catch(() => 0),
          ) || 0;
        ledger.reseq(r.id, last);
        done.retried++;
      }
    }
    ledger.markConfirmed(ok, tx);
    done.confirmed += ok.length;
  } catch (e) {
    if (e?.contract) {
      ledger.markRetry(
        batch.map((r) => r.id),
        e.message,
      );
      done.retried += batch.length;
    } else {
      // Unknown outcome: whatever the chain already has is confirmed.
      for (const r of batch) {
        const last = Number(
          await chain
            .view("last_seq", { account_id: r.account_id })
            .catch(() => -1),
        );
        if (last >= r.seq) {
          ledger.markConfirmed([r.id], e?.tx || null);
          done.confirmed++;
        } else {
          ledger.markRetry([r.id], e?.message || e);
          done.retried++;
        }
      }
    }
  }
  return done;
}

/** Background worker: one pass every batchMs (default 2 s). */
export function startLedgerWorker(
  ledger,
  chain,
  { intervalMs = 2_000, log = console } = {},
) {
  let stopped = false,
    timer = null,
    lastConnect = 0;
  async function tick() {
    if (stopped) return;
    try {
      if (!chain.ready && Date.now() - lastConnect > 5 * 60_000) {
        lastConnect = Date.now();
        await chain.connect();
      }
      const r = await runLedgerQueue(ledger, chain);
      if (r.sent || r.days || r.retried)
        log.info?.(JSON.stringify({ chainLedger: r }));
    } catch (e) {
      log.warn?.(
        JSON.stringify({
          chainLedger: "queue error",
          error: String(e?.message || e).slice(0, 200),
        }),
      );
    }
    if (!stopped) {
      timer = setTimeout(tick, intervalMs);
      timer.unref?.();
    }
  }
  timer = setTimeout(tick, 3_000);
  timer.unref?.();
  return {
    stop() {
      stopped = true;
      clearTimeout(timer);
    },
  };
}
