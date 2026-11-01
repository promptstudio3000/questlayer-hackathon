// NPC trader keeper (N3): the bookkeeper that keeps each trader's purse
// healthy and sends its profit to the game treasury. One tick:
//   1. settle issued orders (ledger reconcile),
//   2. restock: escrow Auras the trader holds into the market so they can be
//      sold with signed orders (nft_transfer_call {"deposit":true}),
//   3. sweep: when the market credit exceeds the 2 test NEAR float + buffer and
//      no buy order is open, withdraw, pay the surplus into rewards
//      fund_rewards("sponsor", "npc-<id>-<day>-<n>") and re-deposit the float,
//   4. restore: if a sweep was interrupted, re-deposit liquid NEAR up to the float.
// Testnet only. Without an account key it runs as a dry run and reports.
import { Account, KeyPairSigner } from "near-api-js";
import { assert } from "../domain.mjs";
import { FLOAT, MILLI, SWEEP_BUFFER, YOCTO, sweepableSurplus } from "./trader-pricing.mjs";

const TGAS = 10n ** 12n;
const GAS_RESERVE = YOCTO / 2n; // keep 0.5 NEAR liquid for gas and storage
const SPONSOR_STORAGE_FEE = 5n * 10n ** 21n; // rewards contract SPONSOR_STORAGE_FEE
const MAX_RESTOCK_PER_TICK = 4;
const MAX_SWEEPS_PER_DAY = 2;

export function sweepReceiptId(actorId, dayKey, n) {
  return `npc-${actorId}`.slice(0, 44) + `-${dayKey}-${n}`;
}

export function createTraderKeeper({ service, provider, rewardsId, clock = Date.now, log = () => {} }) {
  assert(/\.testnet$/.test(String(rewardsId)), "The keeper is testnet-only.", 503);
  const { ledger, traders } = service;
  const accountFor = (t) => (t.accountKey ? new Account(t.accountId, provider, KeyPairSigner.fromSecretKey(t.accountKey)) : null);
  const send = async (account, receiverId, methodName, args, deposit, gas = 100n * TGAS) => {
    const r = await account.callFunctionRaw({ contractId: receiverId, methodName, args, deposit, gas, waitUntil: "FINAL" });
    assert(!r.status?.Failure, `${methodName} failed on chain.`, 503);
    return r.transaction?.hash || r.transaction_outcome?.id;
  };
  const liquid = async (accountId) => {
    const a = await provider.query({ request_type: "view_account", account_id: accountId, finality: "final" });
    const locked = BigInt(a.storage_usage) * 10n ** 19n; // 1e19 yocto per byte
    return BigInt(a.amount) - locked;
  };

  async function tickTrader(t, { execute }) {
    const report = { actorId: t.actorId, accountId: t.accountId, actions: [], execute: execute && !!t.accountKey };
    const account = report.execute ? accountFor(t) : null;
    // 2. Restock: tokens the trader owns outright go into market escrow.
    const owned = await service.nftsView("nft_tokens_for_owner", { account_id: t.accountId, from_index: "0", limit: 50 });
    for (const token of owned.filter((x) => x.owner_id === t.accountId).slice(0, MAX_RESTOCK_PER_TICK)) {
      if (!ledger.heldLot(t.actorId, token.token_id)) ledger.addLot({ trader: t.actorId, tokenId: token.token_id, cost: 0n, source: "seed" });
      const action = { step: "restock", tokenId: token.token_id };
      if (account)
        action.tx = await send(
          account,
          service.nftId,
          "nft_transfer_call",
          { receiver_id: service.marketId, token_id: token.token_id, approval_id: null, memo: null, msg: JSON.stringify({ deposit: true }) },
          1n,
          200n * TGAS,
        );
      report.actions.push(action);
    }
    // 3. Sweep surplus above the float when no buy order can draw on it.
    const acct = await service.marketView("get_account", { account_id: t.accountId }, true);
    const credit = BigInt(acct?.credit || "0");
    const reserved = ledger.reservedForBuys(t.actorId);
    const openBuys = ledger.openTrades("trade_buy").filter((x) => x.trader === t.actorId).length;
    const surplus = sweepableSurplus(credit, { reserved });
    const dayKey = new Date(clock()).toISOString().slice(0, 10).replaceAll("-", "");
    report.credit = credit.toString();
    report.surplus = surplus.toString();
    if (surplus > 0n && !openBuys && BigInt(acct?.withdrawing || "0") === 0n) {
      const n = ledger.sweepsToday(t.actorId, dayKey);
      if (n < MAX_SWEEPS_PER_DAY) {
        const receiptId = sweepReceiptId(t.actorId, dayKey, n + 1);
        const action = { step: "sweep", amount: surplus.toString(), receiptId, rewards: rewardsId };
        if (account) {
          const sweepId = ledger.recordSweep({ trader: t.actorId, amount: surplus, receiptId });
          try {
            action.withdrawTx = await send(account, service.marketId, "withdraw", {}, 1n, 100n * TGAS);
            action.fundTx = await send(account, rewardsId, "fund_rewards", { source: "sponsor", receipt_id: receiptId }, surplus + SPONSOR_STORAGE_FEE, 50n * TGAS);
            ledger.finishSweep(sweepId, "done", action.fundTx);
          } catch (error) {
            ledger.finishSweep(sweepId, "failed");
            action.error = String(error?.message || error).slice(0, 200);
          }
        }
        report.actions.push(action);
      }
    }
    // 4. Restore the float from liquid NEAR (after a sweep or an interrupted one).
    const after = account ? BigInt((await service.marketView("get_account", { account_id: t.accountId }, true))?.credit || "0") : credit;
    if (after < FLOAT && !openBuys) {
      const spare = (await liquid(t.accountId)) - GAS_RESERVE;
      const want = FLOAT + SWEEP_BUFFER - after;
      const top = want < spare ? want : spare;
      if (top >= MILLI) {
        const action = { step: "restore-float", amount: top.toString() };
        if (account) action.tx = await send(account, service.marketId, "deposit_near", {}, top, 30n * TGAS);
        report.actions.push(action);
      }
    }
    return report;
  }

  async function tick({ execute = false } = {}) {
    const settled = await service.reconcile({ limit: 48 });
    const reports = [];
    for (const t of traders.values()) {
      try {
        reports.push(await tickTrader(t, { execute }));
      } catch (error) {
        reports.push({ actorId: t.actorId, error: String(error?.message || error).slice(0, 200) });
      }
    }
    log({ keeper: "npc-traders", settled: settled.settled, reports });
    return { settled: settled.settled, reports };
  }

  return { tick };
}

export function startTraderKeeper(keeper, { intervalMs = 10 * 60_000, execute = true } = {}) {
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try {
      await keeper.tick({ execute });
    } catch (error) {
      console.error("NPC trader keeper:", error?.message || error);
    } finally {
      running = false;
    }
  };
  const timer = setInterval(() => void run(), intervalMs);
  timer.unref?.();
  setTimeout(() => void run(), 30_000).unref?.();
  return { stop: () => clearInterval(timer), run };
}
