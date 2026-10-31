import { readFileSync, statSync } from "node:fs";
import { Account, KeyPairSigner } from "near-api-js";
import { atomic } from "../database.mjs";
import { assert, id, dayKey, hash } from "../domain.mjs";
import { PLZEN } from "../spatial/city-pack.mjs";
import { shiftDate } from "../spatial/calendar.mjs";
import { getOrPrepareCityPlan } from "../world-planner.mjs";
import {
  nativeManifest,
  publicationArgs,
  rewardMessage,
} from "./reward-manifest.mjs";
import { assertTestnetRpc } from "../identity/near.mjs";
import { NativeContractReader } from "./reader.mjs";
import { VAULT_POOLS } from "./vaults.mjs";
const METHODS = ["publish_day", "close_day", "claim", "maintain_vault"];
export async function rewardTransport(
  provider,
  contractId,
  keyPath,
  expectedCodeHash,
) {
  assert(
    (statSync(keyPath).mode & 0o077) === 0,
    "Worker key permissions must be private.",
    503,
  );
  const config = JSON.parse(readFileSync(keyPath));
  assert(
    config.network === "testnet" && config.accountId === contractId,
    "Wrong worker identity.",
    503,
  );
  await assertTestnetRpc(provider);
  const code = await provider.query({
    request_type: "view_account",
    account_id: contractId,
    finality: "final",
  });
  assert(
    typeof expectedCodeHash === "string" && code.code_hash === expectedCodeHash,
    "Native reward bytecode differs from the reviewed deployment.",
    503,
  );
  const signer = KeyPairSigner.fromSecretKey(config.secretKey);
  const publicKey = (await signer.getPublicKey()).toString();
  const access = await provider.query({
    request_type: "view_access_key",
    account_id: contractId,
    public_key: publicKey,
    finality: "final",
  });
  const p = access.permission?.FunctionCall;
  assert(
    p &&
      p.receiver_id === contractId &&
      p.allowance !== null &&
      BigInt(p.allowance) <= 10n ** 24n &&
      p.method_names.length === METHODS.length &&
      p.method_names.every((m) => METHODS.includes(m)),
    "Worker key must have only bounded reward methods.",
    503,
  );
  const account = new Account(contractId, provider, signer);
  return async (method, args) => {
    assert(METHODS.includes(method), "Unsupported worker method.");
    const result = await account.callFunctionRaw({
      contractId,
      methodName: method,
      args,
      gas: 280n * 10n ** 12n,
      deposit: 0n,
      waitUntil: "FINAL",
    });
    assert(
      !result.status?.Failure,
      "The native worker transaction failed.",
      503,
    );
    return result.transaction?.hash || result.transaction_outcome?.id;
  };
}
export async function runRewardWorker(
  native,
  send,
  { clock = Date.now, maxClaims = 8 } = {},
) {
  const db = native.db,
    owner = id("native-lease"),
    now = clock();
  const acquired = atomic(
    db,
    () =>
      db
        .prepare(
          "UPDATE native_worker_lease SET owner=?,until_ms=? WHERE id=1 AND until_ms<=?",
        )
        .run(owner, now + 120000, now).changes === 1,
  );
  if (!acquired) return { busy: true };
  const renew = () => {
    assert(
      db
        .prepare(
          "UPDATE native_worker_lease SET until_ms=? WHERE id=1 AND owner=? AND until_ms>?",
        )
        .run(clock() + 120000, owner, clock()).changes === 1,
      "Native worker lease expired.",
      503,
    );
  };
  const writeOwned = (sql, ...parameters) =>
    atomic(db, () => {
      renew();
      return db.prepare(sql).run(...parameters);
    });
  // RPC completion does not prove this process still owns the durable work.
  // Fence both sides of a send; a lost response is reconciled by the next owner
  // from the contract receipt/state, never by a stale worker rewriting its result.
  const sendOwned = async (method, args) => {
    renew();
    const result = await send(method, args);
    renew();
    return result;
  };
  let completed = 0;
  try {
    const configuration = await native.view("get_config", {}, true);
    renew();
    assert(
      configuration.attestor === native.signer.publicKey &&
        configuration.publisher === native.contractId,
      "Native worker identity prevents settlement and maintenance.",
      503,
    );
    let settlementError = null;
    try {
      assert(
        configuration.paused === false,
        "Native reward publication and claims are paused.",
        503,
      );
      // Reconcile the oldest durable acceptance first; a failed older receipt blocks
      // later claims, retaining deterministic first-valid-winner order.
      for (let n = 0; n < maxClaims; n++) {
        const row = db
          .prepare(
            "SELECT * FROM native_reward_claims WHERE state!='confirmed' ORDER BY seq LIMIT 1",
          )
          .get();
        if (!row || row.run_after > clock()) break;
        renew();
        const claim = JSON.parse(row.body);
        let receipt = await native.view(
            "get_receipt",
            { receipt_id: row.id },
            true,
          ),
          tx = row.transaction_hash;
        try {
          if (!receipt) {
            tx = await sendOwned("claim", { claim, signature: row.signature });
            writeOwned(
              "UPDATE native_reward_claims SET transaction_hash=? WHERE id=?",
              tx,
              row.id,
            );
            receipt = await native.view(
              "get_receipt",
              { receipt_id: row.id },
              true,
            );
          }
          assert(
            receipt?.receiver_id === row.account_id &&
              receipt.message_hash ===
                hash(rewardMessage(native.contractId, claim)),
            "Native receipt does not match accepted evidence.",
            503,
          );
          writeOwned(
            "UPDATE native_reward_claims SET state='confirmed',amount=?,xp=?,confirmed_at=?,transaction_hash=?,last_error=NULL WHERE id=?",
            receipt.amount,
            receipt.xp,
            clock(),
            tx,
            row.id,
          );
          completed++;
        } catch (error) {
          writeOwned(
            "UPDATE native_reward_claims SET state='retrying',attempts=attempts+1,run_after=?,last_error=? WHERE id=?",
            clock() + Math.min(300000, 5000 * 2 ** Math.min(row.attempts, 6)),
            String(error.message).slice(0, 200),
            row.id,
          );
          throw error;
        }
      }
      // Retire only after every accepted receipt for that day is authoritative.
      for (const row of db
        .prepare(
          "SELECT id,body FROM native_days WHERE state='published' ORDER BY day LIMIT 10",
        )
        .all()) {
        const m = JSON.parse(row.body);
        if (
          clock() < m.endsAt + 86400000 ||
          db
            .prepare(
              "SELECT 1 FROM native_reward_claims WHERE day_id=? AND state!='confirmed'",
            )
            .get(row.id)
        )
          continue;
        renew();
        let day = await native.view("get_day", { day_id: row.id }, true);
        if (!day?.closed) await sendOwned("close_day", { day_id: row.id });
        day = await native.view("get_day", { day_id: row.id }, true);
        assert(day?.closed, "Day closure has not confirmed.", 503);
        writeOwned(
          "UPDATE native_days SET state='closed',updated_at=? WHERE id=?",
          clock(),
          row.id,
        );
      }
      for (const day of [dayKey(clock()), shiftDate(dayKey(clock()))]) {
        renew();
        const dayId = `plzen-${day}-v1`;
        let row = db.prepare("SELECT * FROM native_days WHERE id=?").get(dayId);
        if (!row) {
          const plan = getOrPrepareCityPlan(db, PLZEN, day, clock()),
            treasury = await native.view("get_treasury", {}, true),
            m = nativeManifest(plan, treasury);
          if (!m) continue;
          writeOwned(
            "INSERT OR IGNORE INTO native_days(id,day,body,hash,updated_at) VALUES(?,?,?,?,?)",
            m.id,
            m.day,
            JSON.stringify(m),
            m.hash,
            clock(),
          );
          row = db.prepare("SELECT * FROM native_days WHERE id=?").get(dayId);
        }
        if (row.state !== "prepared") continue;
        const m = JSON.parse(row.body);
        let confirmed = await native.view("get_day", { day_id: m.id }, true),
          tx = row.transaction_hash;
        if (!confirmed) {
          tx = await sendOwned("publish_day", publicationArgs(m));
          writeOwned(
            "UPDATE native_days SET transaction_hash=? WHERE id=?",
            tx,
            m.id,
          );
          confirmed = await native.view("get_day", { day_id: m.id }, true);
        }
        assert(
          confirmed?.manifest_hash === m.hash && !confirmed.closed,
          "Native day differs from the durable manifest.",
          503,
        );
        writeOwned(
          "UPDATE native_days SET state='published',updated_at=?,transaction_hash=? WHERE id=?",
          clock(),
          tx,
          m.id,
        );
      }
    } catch (error) {
      settlementError = error;
    }
    // Keepers have no beneficiary methods. A busy/failing vault cannot block
    // funded claims, and paused/failed claims cannot block an existing exit.
    // Preserve the settlement error and receipt order after maintenance finishes.
    try {
      for (const v of await native.vaultList()) {
        const job = db
          .prepare("SELECT * FROM native_vault_jobs WHERE account_id=?")
          .get(v.accountId);
        if (job?.next_check > clock()) continue;
        renew();
        try {
          const code = await native.provider.query({
            request_type: "view_account",
            account_id: v.accountId,
            finality: "final",
          });
          assert(
            typeof v.codeHash === "string" && code.code_hash === v.codeHash,
            "Vault bytecode changed; maintenance is paused.",
            503,
          );
          if (
            !(native.config.vaults || []).some(
              (p) => p.accountId === v.accountId,
            )
          ) {
            const keys = await native.provider.query({
              request_type: "view_access_key_list",
              account_id: v.accountId,
              finality: "final",
            });
            assert(
              Array.isArray(keys.keys) && keys.keys.length === 0,
              "Vault keyless ownership changed; maintenance is paused.",
              503,
            );
          }
          const reader = new NativeContractReader(native.provider, v.accountId);
          let state = await reader.view("get_state", {}, true),
            action = null;
          assert(
            state.beneficiary === v.beneficiary &&
              state.rewards === native.contractId &&
              VAULT_POOLS.some((p) => p.id === state.pool) &&
              (!v.pool || state.pool === v.pool),
            "Vault configuration mismatch.",
            503,
          );
          if (
            state.stage === "awaiting_cash" ||
            (state.stage === "unlocking" &&
              BigInt(state.epoch) >= BigInt(state.unlock_epoch))
          )
            action = "advance";
          if (
            state.stage === "idle" &&
            state.owner_pending === "0" &&
            state.game_pending === "0"
          ) {
            if (BigInt(state.game_credit) > 0n) action = "flush_game";
            else if (state.exit_requested) action = "advance";
            else if (BigInt(state.principal) > 0n)
              action =
                BigInt(state.staked) + BigInt(state.unstaked) >
                  BigInt(state.high_water_basis) + 10n ** 18n &&
                state.contribution_bps > 0
                  ? "harvest"
                  : "refresh";
          }
          if (action) {
            await sendOwned("maintain_vault", {
              vault_id: v.accountId,
              action,
            });
            state = await reader.view("get_state", {}, true);
          }
          writeOwned(
            "INSERT INTO native_vault_jobs VALUES(?,?,?,?,NULL) ON CONFLICT(account_id) DO UPDATE SET next_check=excluded.next_check,last_action=excluded.last_action,last_state=excluded.last_state,last_error=NULL",
            v.accountId,
            clock() + (state.stage === "awaiting_cash" ? 30000 : 30 * 60000),
            action,
            JSON.stringify(state),
          );
        } catch (error) {
          writeOwned(
            "INSERT INTO native_vault_jobs(account_id,next_check,last_error) VALUES(?,?,?) ON CONFLICT(account_id) DO UPDATE SET next_check=excluded.next_check,last_error=excluded.last_error",
            v.accountId,
            clock() + 300000,
            String(error.message).slice(0, 200),
          );
        }
      }
    } catch (error) {
      settlementError ||= error;
    }
    writeOwned(
      "DELETE FROM native_locations WHERE received_at<?",
      clock() - 86400000,
    );
    if (settlementError) throw settlementError;
    writeOwned(
      "UPDATE native_worker_lease SET last_success=?,last_error=NULL WHERE id=1 AND owner=?",
      clock(),
      owner,
    );
    return { completed };
  } catch (error) {
    db.prepare(
      "UPDATE native_worker_lease SET last_error=? WHERE id=1 AND owner=?",
    ).run(String(error.message).slice(0, 200), owner);
    throw error;
  } finally {
    db.prepare(
      "UPDATE native_worker_lease SET until_ms=0,owner=NULL WHERE id=1 AND owner=?",
    ).run(owner);
  }
}
export function startRewardWorker(
  native,
  { keyPath, intervalMs = 30000 } = {},
) {
  let stopped = false,
    running = null,
    send = null,
    timer;
  async function tick() {
    if (stopped || running) return;
    const startedAt = Date.now();
    running = (async () => {
      let enteredWorker = false;
      try {
        send ||= await rewardTransport(
          native.provider,
          native.contractId,
          keyPath,
          native.config.codeHash,
        );
        enteredWorker = true;
        await runRewardWorker(native, send);
      } catch (error) {
        console.error(
          "Native reward worker:",
          String(error.message).slice(0, 200),
        );
        // runRewardWorker records errors only under its own lease. An older
        // process must not overwrite the health of a successor after a late RPC.
        if (!enteredWorker)
          native.db
            .prepare(
              "UPDATE native_worker_lease SET last_error=? WHERE id=1 AND until_ms<=? AND (last_success IS NULL OR last_success<?)",
            )
            .run(String(error.message).slice(0, 200), Date.now(), startedAt);
      }
    })();
    await running;
    running = null;
  }
  timer = setInterval(tick, intervalMs);
  timer.unref();
  void tick();
  return {
    stop: async () => {
      stopped = true;
      clearInterval(timer);
      await running;
    },
  };
}
