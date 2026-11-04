// NPC trader keeper (N3): the bookkeeper that keeps each trader's purse
// healthy and sends its profit to the game treasury. The trader trades on the
// game's NEAR Intents verifier, so its stock and purse live there. One tick:
//   1. settle issued deals (ledger reconcile),
//   1b. register the trader's signing key on the verifier (add_public_key),
//   2a. stock: when the trader holds fewer than 3 Auras, mint one rare/epic
//      chest Aura to its own account with an award-signed redeem_aura claim
//      (earned:npc-stock:<id>:<day>:<n>, max 3 a day) paid from its liquid
//      NEAR; the measured cost becomes the lot's cost basis, so the sale
//      price is never below cost × 1.10,
//   2b. restock: deposit Auras from the trader's wallet into the verifier
//      (nft_transfer_call, msg ""), so they can be sold with one intent,
//   3. sweep: when the trader's wNEAR in the verifier exceeds the 2 test NEAR
//      float + buffer and no buy is open, withdraw the surplus (ft_withdraw),
//      unwrap it and pay it into rewards fund_rewards("sponsor",
//      "npc-<id>-<day>-<n>"),
//   4. restore: top the verifier purse back up to the float, with loose wNEAR
//      first (an interrupted sweep), then wrapped liquid NEAR.
// Testnet only. Without an account key it runs as a dry run and reports.
import { Account, KeyPairSigner } from "near-api-js";
import { assert } from "../domain.mjs";
import { awardMessage } from "../native/award-vouchers.mjs";
import {
  FLOAT,
  MILLI,
  STOCK_DEPOSIT,
  STOCK_EDITION_HEADROOM,
  STOCK_MINTS_PER_DAY,
  STOCK_RESERVE,
  STOCK_TARGET,
  SWEEP_BUFFER,
  YOCTO,
  editionOf,
  pickStockEdition,
  sweepableSurplus,
} from "./trader-pricing.mjs";

const TGAS = 10n ** 12n;
const GAS_RESERVE = YOCTO / 2n; // keep 0.5 NEAR liquid for gas and storage
const SPONSOR_STORAGE_FEE = 5n * 10n ** 21n; // rewards contract SPONSOR_STORAGE_FEE
const MAX_RESTOCK_PER_TICK = 4;
const MAX_SWEEPS_PER_DAY = 2;
const CLAIM_TTL_MS = 15 * 60_000;
const WNEAR_STORAGE = 125n * 10n ** 19n; // wrap.testnet storage_deposit (0.00125 NEAR)

export function stockClaimId(actorId, dayKey, n) {
  return `earned:npc-stock:${actorId}:${dayKey}:${n}`;
}

export function sweepReceiptId(actorId, dayKey, n) {
  return `npc-${actorId}`.slice(0, 44) + `-${dayKey}-${n}`;
}

export function createTraderKeeper({
  service,
  provider,
  rewardsId,
  awardSigner = null,
  stock = true,
  clock = Date.now,
  log = () => {},
  accountFor: accountForOverride = null,
}) {
  assert(/\.testnet$/.test(String(rewardsId)), "The keeper is testnet-only.", 503);
  const { ledger, traders } = service;
  const accountFor =
    accountForOverride ||
    ((t) => (t.accountKey ? new Account(t.accountId, provider, KeyPairSigner.fromSecretKey(t.accountKey)) : null));
  const send = async (account, receiverId, methodName, args, deposit, gas = 100n * TGAS) => {
    const r = await account.callFunctionRaw({ contractId: receiverId, methodName, args, deposit, gas, waitUntil: "FINAL" });
    assert(!r.status?.Failure, `${methodName} failed on chain.`, 503);
    return r.transaction?.hash || r.transaction_outcome?.id;
  };
  const balance = async (accountId) => {
    const a = await provider.query({ request_type: "view_account", account_id: accountId, finality: "final" });
    return { amount: BigInt(a.amount), locked: BigInt(a.storage_usage) * 10n ** 19n }; // 1e19 yocto per byte
  };
  const liquid = async (accountId) => {
    const b = await balance(accountId);
    return b.amount - b.locked;
  };
  const viewOn = async (contractId, method, args) => {
    const r = await provider.query({
      request_type: "call_function",
      account_id: contractId,
      method_name: method,
      args_base64: Buffer.from(JSON.stringify(args)).toString("base64"),
      finality: "final",
    });
    return JSON.parse(Buffer.from(r.result).toString() || "null");
  };
  // The collection must trust this server's award key before a claim is signed.
  let signerOk = null;
  const signerReady = async () => {
    if (!awardSigner) return false;
    if (signerOk === null) signerOk = (await service.nftsView("get_award_signer", {}, true).catch(() => null)) === awardSigner.publicKey;
    return signerOk;
  };

  /** 2a. Mint one stock Aura when the shelf is short. Returns the minted token id. */
  async function mintStock(t, account, report, { shelf, heldEditions, dayKey }) {
    if (!stock || shelf >= STOCK_TARGET) return null;
    const n = ledger.stockMintsToday(t.actorId, dayKey);
    if (n >= STOCK_MINTS_PER_DAY) return null;
    if (!awardSigner) return null;
    if (!(await signerReady())) {
      report.actions.push({ step: "stock", skipped: "award-signer" });
      return null;
    }
    const edition = pickStockEdition(heldEditions, n);
    if (!edition) return null;
    const minted = Number(await service.nftsView("edition_minted", { edition }, true));
    if (!(minted < STOCK_EDITION_HEADROOM)) {
      report.actions.push({ step: "stock", edition, skipped: "edition-supply" });
      return null;
    }
    const spare = (await liquid(t.accountId)) - GAS_RESERVE;
    if (spare < STOCK_DEPOSIT) {
      // Restocking waits until a sweep leaves liquid NEAR behind (STOCK_RESERVE).
      report.actions.push({ step: "stock", edition, skipped: "low-liquid", spare: spare.toString() });
      return null;
    }
    const claim = {
      claim_id: stockClaimId(t.actorId, dayKey, n + 1),
      edition,
      receiver_id: t.accountId,
      expires_at: clock() + CLAIM_TTL_MS,
    };
    const action = { step: "stock", edition, claimId: claim.claim_id };
    report.actions.push(action);
    if (!account) return null;
    const before = (await balance(t.accountId)).amount;
    action.tx = await send(
      account,
      service.nftId,
      "redeem_aura",
      {
        claim_id: claim.claim_id,
        edition,
        receiver_id: t.accountId,
        expires_at_ms: claim.expires_at,
        signature: awardSigner.sign(awardMessage(service.nftId, claim)),
      },
      STOCK_DEPOSIT,
      100n * TGAS,
    );
    const tokenId = await service.nftsView("get_claim_token", { claim_id: claim.claim_id }, true);
    assert(tokenId, "The stock claim minted no token.", 503);
    const spent = before - (await balance(t.accountId)).amount;
    // Cost basis = what minting really took + an allowance for the escrow gas.
    const cost = (((spent > 0n ? spent : 0n) + 3n * MILLI + MILLI - 1n) / MILLI) * MILLI;
    ledger.addLot({ trader: t.actorId, tokenId, cost, source: "seed", tradeId: claim.claim_id });
    action.tokenId = tokenId;
    action.cost = cost.toString();
    return tokenId;
  }

  async function tickTrader(t, { execute }) {
    const account = execute ? accountFor(t) : null;
    const report = { actorId: t.actorId, accountId: t.accountId, actions: [], execute: !!account };
    const dayKey = new Date(clock()).toISOString().slice(0, 10).replaceAll("-", "");
    // 1b. The trader signs its intents with this key on the verifier.
    const keyOk = await service.verifierView("has_public_key", { account_id: t.accountId, public_key: t.signingPublicKey }, true);
    if (!keyOk) {
      const action = { step: "register-key", publicKey: t.signingPublicKey };
      if (account) action.tx = await send(account, service.verifierId, "add_public_key", { public_key: t.signingPublicKey }, 1n, 30n * TGAS);
      report.actions.push(action);
    }
    // 2a. Stock: the shelf is the trader's Auras in the verifier plus in its wallet.
    const owned = await service.nftsView("nft_tokens_for_owner", { account_id: t.accountId, from_index: "0", limit: 50 });
    const wallet = owned.filter((x) => x.owner_id === t.accountId && editionOf(x.token_id)).map((x) => x.token_id);
    const held = await service.holdings(t.accountId);
    const deposited = held.auras.filter((x) => editionOf(x));
    const heldEditions = [...wallet, ...deposited].map(editionOf);
    const fresh = await mintStock(t, account, report, { shelf: wallet.length + deposited.length, heldEditions, dayKey });
    if (fresh && !wallet.includes(fresh)) wallet.unshift(fresh);
    // 2b. Restock: Auras the trader owns outright go into the verifier, up to
    // a shelf of STOCK_TARGET.
    const room = Math.max(0, STOCK_TARGET - deposited.length);
    for (const tokenId of wallet.slice(0, Math.min(room, MAX_RESTOCK_PER_TICK))) {
      if (!ledger.heldLot(t.actorId, tokenId)) ledger.addLot({ trader: t.actorId, tokenId, cost: 0n, source: "seed" });
      const action = { step: "restock", tokenId };
      if (account)
        action.tx = await send(
          account,
          service.nftId,
          "nft_transfer_call",
          { receiver_id: service.verifierId, token_id: tokenId, approval_id: null, memo: null, msg: "" },
          1n,
          200n * TGAS,
        );
      report.actions.push(action);
    }
    // 3. Sweep surplus above the float when no buy can draw on it.
    const credit = BigInt(held.wnear || "0");
    const reserved = ledger.reservedForBuys(t.actorId);
    const openBuys = ledger.openTrades("trade_buy").filter((x) => x.trader === t.actorId).length;
    const swept = sweepableSurplus(credit, { reserved });
    // Keep up to STOCK_RESERVE liquid for restocking; the rest goes to the treasury.
    const spareNow = swept > 0n && stock ? (await liquid(t.accountId)) - GAS_RESERVE : STOCK_RESERVE;
    const holdBack = spareNow >= STOCK_RESERVE ? 0n : STOCK_RESERVE - (spareNow > 0n ? spareNow : 0n);
    const surplus = swept > holdBack ? swept - holdBack : 0n;
    report.purse = credit.toString();
    report.surplus = surplus.toString();
    if (holdBack && swept) report.stockReserve = (swept < holdBack ? swept : holdBack).toString();
    if (surplus >= MILLI && !openBuys) {
      const n = ledger.sweepsToday(t.actorId, dayKey);
      if (n < MAX_SWEEPS_PER_DAY) {
        const receiptId = sweepReceiptId(t.actorId, dayKey, n + 1);
        const action = { step: "sweep", amount: surplus.toString(), receiptId, rewards: rewardsId };
        if (account) {
          const sweepId = ledger.recordSweep({ trader: t.actorId, amount: surplus, receiptId });
          try {
            // ft_withdraw pays the trader account on wrap.testnet, which needs storage there.
            if (!(await viewOn(service.wnear, "storage_balance_of", { account_id: t.accountId })))
              await send(account, service.wnear, "storage_deposit", { account_id: t.accountId, registration_only: true }, WNEAR_STORAGE, 30n * TGAS);
            action.withdrawTx = await send(
              account,
              service.verifierId,
              "ft_withdraw",
              { token: service.wnear, receiver_id: t.accountId, amount: surplus.toString(), memo: "questlayer npc sweep", msg: null },
              1n,
              100n * TGAS,
            );
            action.unwrapTx = await send(account, service.wnear, "near_withdraw", { amount: surplus.toString() }, 1n, 30n * TGAS);
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
    // 4. Restore the verifier purse up to the float: loose wNEAR first (an
    // interrupted sweep), then wrapped liquid NEAR.
    const after = account ? BigInt((await service.holdings(t.accountId)).wnear || "0") : credit;
    if (after < FLOAT && !openBuys) {
      const want = FLOAT + SWEEP_BUFFER - after;
      const registered = Boolean(await viewOn(service.wnear, "storage_balance_of", { account_id: t.accountId }));
      const loose = registered ? BigInt((await viewOn(service.wnear, "ft_balance_of", { account_id: t.accountId })) || "0") : 0n;
      const spare = (await liquid(t.accountId)) - GAS_RESERVE - (registered ? 0n : WNEAR_STORAGE);
      const need = want > loose ? want - loose : 0n;
      const wrap = need < spare ? need : spare > 0n ? spare : 0n;
      const top = loose + wrap < want ? loose + wrap : want;
      if (top >= MILLI) {
        const action = { step: "restore-float", amount: top.toString(), wrap: wrap.toString() };
        if (account) {
          if (!registered)
            await send(account, service.wnear, "storage_deposit", { account_id: t.accountId, registration_only: true }, WNEAR_STORAGE, 30n * TGAS);
          if (wrap > 0n) await send(account, service.wnear, "near_deposit", {}, wrap, 30n * TGAS);
          action.tx = await send(
            account,
            service.wnear,
            "ft_transfer_call",
            { receiver_id: service.verifierId, amount: top.toString(), msg: "" },
            1n,
            100n * TGAS,
          );
        }
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
