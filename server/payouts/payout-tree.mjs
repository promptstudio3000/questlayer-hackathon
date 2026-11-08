// Daily payout tree (contracts/rewards/src/payouts.rs, docs/DAILY-PAYOUTS.md).
//
// One leaf per account per day: what the account earned that day, in
// yoctoNEAR. The rewards contract checks each leaf against the published root
// and mints that NEAR as QGOLD in the vault for the account in the leaf.
//
// Leaf = sha256("payout|<day_id>|<index>|<account>|<amount_yocto>") in hex;
// the tree is the sorted-pair tree of server/chain-ledger/merkle.mjs.
import { merkle, sha256Hex, verifyProof } from "../chain-ledger/merkle.mjs";

/** Smallest leaf the contract accepts (PAYOUT_MIN_YOCTO); smaller amounts carry over. */
export const PAYOUT_MIN_YOCTO = 10n ** 16n;
/** Leaves per claim_payout transaction (PAYOUT_MAX_BATCH). */
export const PAYOUT_MAX_BATCH = 10;
export const PAYOUT_MAX_LEAVES = 262_144;
/** close_payout_day is allowed this long after publication. */
export const PAYOUT_GRACE_MS = 3 * 86_400_000;
/** Methods the reward worker's access key needs for payouts. */
export const PAYOUT_CHAIN_METHODS = Object.freeze([
  "publish_payout_day",
  "claim_payout",
  "close_payout_day",
]);

export const payoutDayId = (date, version = 1) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("date is YYYY-MM-DD");
  return `payout-${date}-v${version}`;
};

export const payoutLeaf = (dayId, index, accountId, amountYocto) =>
  sha256Hex(`payout|${dayId}|${index}|${accountId}|${BigInt(amountYocto)}`);

/**
 * Builds one payout day from per-account totals (summed per account first).
 * Accounts are ordered by name, so the same input always gives the same root.
 * Amounts under PAYOUT_MIN_YOCTO are returned in `carry` for the next day.
 * `coinsYocto` + `zonesYocto` in `publish` always equals the leaf total; the
 * split takes coins first, up to `coinsShareYocto` when given.
 */
export function buildPayoutDay({ dayId, entries, coinsShareYocto = null }) {
  const totals = new Map();
  for (const { accountId, amountYocto } of entries) {
    const v = BigInt(amountYocto);
    if (v < 0n) throw new Error("negative payout");
    totals.set(accountId, (totals.get(accountId) ?? 0n) + v);
  }
  const carry = [];
  const paid = [];
  for (const accountId of [...totals.keys()].sort()) {
    const amount = totals.get(accountId);
    if (amount === 0n) continue;
    (amount < PAYOUT_MIN_YOCTO ? carry : paid).push({ accountId, amountYocto: amount });
  }
  if (paid.length > PAYOUT_MAX_LEAVES) throw new Error("too many payout leaves");
  const leaves = paid.map((p, index) => payoutLeaf(dayId, index, p.accountId, p.amountYocto));
  const { root, proofs } = merkle(leaves);
  const total = paid.reduce((s, p) => s + p.amountYocto, 0n);
  const coins =
    coinsShareYocto == null ? total : BigInt(coinsShareYocto) < total ? BigInt(coinsShareYocto) : total;
  const claims = paid.map((p, index) => ({
    index,
    account_id: p.accountId,
    amount_yocto: p.amountYocto.toString(),
    proof: proofs[index],
  }));
  return {
    dayId,
    root,
    total,
    carry,
    claims,
    publish: root && {
      day_id: dayId,
      root,
      leaves: claims.length,
      coins_yocto: coins.toString(),
      zones_yocto: (total - coins).toString(),
    },
  };
}

/** claim_payout argument batches of at most PAYOUT_MAX_BATCH leaves. */
export function claimBatches(day, size = PAYOUT_MAX_BATCH) {
  const out = [];
  for (let i = 0; i < day.claims.length; i += size)
    out.push({ day_id: day.dayId, claims: day.claims.slice(i, i + size) });
  return out;
}

export function verifyPayoutClaim(dayId, root, c) {
  return verifyProof(payoutLeaf(dayId, c.index, c.account_id, c.amount_yocto), c.proof, root);
}
