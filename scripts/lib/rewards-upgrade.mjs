// Pure helpers for scripts/upgrade-rewards-m4-testnet.mjs (PR #240: measured
// callback gas, PAYOUT_MAX_BATCH 8, nonce-recorded mint attempts and reconcile
// methods). No IO: tests/rewards-upgrade.test.mjs covers everything here.
import { diffValues } from "./vault-rollout.mjs";

/** New LookupMap prefixes (contracts/rewards/src/reconcile.rs). Empty before the upgrade. */
export const M4_NEW_PREFIXES = ["native-payout-attempts", "native-withdraw-attempts", "native-callback-nonce"];

/** get_payout_config after PR #240: max_batch 10 -> 8 and three new fields. */
export const M4_PAYOUT_CONFIG = { max_batch: 8, mint_tgas: 15, callback_tgas: 10, reconcile_after_ms: 86_400_000 };
export const M4_NEW_PAYOUT_FIELDS = ["mint_tgas", "callback_tgas", "reconcile_after_ms"];

/** Methods the M4 build adds; the old build must not have them. */
export const M4_NEW_METHODS = [
  "get_payout_attempt",
  "get_withdrawal_attempt",
  "on_payout_reconciled",
  "owner_reconcile_payout",
  "owner_reconcile_withdrawal",
  "reconcile_payout",
];

/**
 * Conservation, as contracts/rewards `check()` asserts it:
 *   funded == coins.available + coins.reserved + zones.available + zones.reserved + owed + pending + withdrawn
 *   coins.awarded + zones.awarded == owed + pending + withdrawn
 * Returns the broken equations (empty = conserved).
 */
export function treasuryMismatches(t) {
  const n = (v) => BigInt(v ?? "0");
  const out = [];
  const held = n(t.coins?.available) + n(t.coins?.reserved) + n(t.zones?.available) + n(t.zones?.reserved) + n(t.owed) + n(t.pending) + n(t.withdrawn);
  if (held !== n(t.funded)) out.push(`funded ${t.funded} != buckets + owed + pending + withdrawn ${held}`);
  const awarded = n(t.coins?.awarded) + n(t.zones?.awarded);
  const owing = n(t.owed) + n(t.pending) + n(t.withdrawn);
  if (awarded !== owing) out.push(`awarded ${awarded} != owed + pending + withdrawn ${owing}`);
  return out;
}

/**
 * Reasons the rewards contract is not quiet enough for a code switch (empty = go).
 *
 * The chain proof: `claim_payout` and `withdraw` both add the minted amount to
 * the treasury's `pending` and only their callbacks (`on_payout`,
 * `on_withdraw`) take it out again, so `get_treasury().pending == "0"` proves
 * no mint callback of either kind is in flight, for every day and account.
 * Per-day `pending_leaves` (get_payout_progress) must agree. The server
 * signals (claim queue, reconciling days, payout days still sending) are the
 * worker side: a worker that is about to send is a reason to wait too.
 *
 *   treasury   get_treasury()
 *   progress   { [payoutDayId]: get_payout_progress(day, []) | null }
 *   health     GET /api/health (or null when the server was not asked)
 *   payouts    GET /api/map/rewards/day `.payouts` (or null)
 *   distribution GET /api/native/distribution (or null)
 *   pragueHour local hour in Europe/Prague (the payout worker runs after midnight)
 */
export function rewardsBusyReasons({ treasury, progress = {}, health = null, payouts = null, distribution = null, pragueHour = null }) {
  const reasons = [];
  if (String(treasury?.pending ?? "") !== "0") reasons.push(`treasury pending ${treasury?.pending}: a payout or withdrawal mint callback is in flight`);
  for (const [day, p] of Object.entries(progress)) {
    if (p && Number(p.pending_leaves) !== 0) reasons.push(`${day}: ${p.pending_leaves} payout leaf callback(s) pending`);
  }
  if (health) {
    const nr = health.nativeRewards;
    if (nr && Number(nr.queued) > 0) reasons.push(`server: ${nr.queued} native reward claim(s) queued`);
    if (nr?.last_error) reasons.push(`server: reward worker last error: ${nr.last_error}`);
  }
  for (const d of payouts || [])
    if (d.state === "published" && Number(d.sent) < Number(d.leaves))
      reasons.push(`server: payout day ${d.dayId} is still sending (${d.sent}/${d.leaves} leaves confirmed)`);
  if (distribution) {
    if (distribution.status && distribution.status !== "verified") reasons.push(`server: distribution audit ${distribution.status}`);
    if ((distribution.reconciling || []).length) reasons.push(`server: reconciling ${JSON.stringify(distribution.reconciling)}`);
  }
  if (pragueHour === 0) reasons.push("00:00-00:59 Europe/Prague: the nightly payout worker publishes and claims now; run after 01:00");
  return reasons;
}

/** Hour of `nowMs` in Europe/Prague (0-23). */
export function pragueHour(nowMs) {
  return Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Prague", hour: "2-digit", hourCycle: "h23" }).format(nowMs));
}

/** Canonical world day id (contracts/rewards/src/world_days.rs). */
export const worldDayId = (date) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error(`Not a YYYY-MM-DD date: ${date}`);
  return `world-${date}-v1`;
};

/** UTC dates from `back` days before `nowMs` to `ahead` days after, oldest first. */
export function utcDates(nowMs, back = 2, ahead = 1) {
  const day = 86_400_000;
  const out = [];
  for (let i = -back; i <= ahead; i++) out.push(new Date(Math.floor(nowMs / day) * day + i * day).toISOString().slice(0, 10));
  return out;
}

/**
 * Day ids to snapshot, from the public server endpoints plus operator flags.
 * Returns { days, mapDays, payoutDays, dates } with unique sorted ids.
 */
export function snapshotTargets({ distribution = null, mapDay = null, extraDays = [], extraPayoutDays = [], nowMs }) {
  const uniq = (a) => [...new Set(a.filter(Boolean))].sort();
  const listed = distribution?.days || [];
  const days = uniq([...listed.filter((d) => d.kind !== "map").map((d) => d.id), ...extraDays.filter((d) => !d.startsWith("payout-"))]);
  const mapDays = uniq(listed.filter((d) => d.kind === "map").map((d) => d.id));
  const payoutDays = uniq([...(mapDay?.payouts || []).filter((p) => p.state !== "empty" || Number(p.leaves) > 0).map((p) => p.dayId), ...extraPayoutDays]);
  const auditDates = (distribution?.checks || []).find((c) => c.name === "date-totals-match-publications")?.dates?.map((d) => d.date) || [];
  const dates = uniq([...auditDates, ...utcDates(nowMs)]);
  return { days, mapDays, payoutDays, dates };
}

/**
 * The world budget's liquid backing after the code grows or shrinks: storage
 * staking for the code comes out of the same balance (get_world_budget).
 */
export function liquidAfterDeploy(worldBudget, oldCodeBytes, newCodeBytes, byteCost = 10n ** 19n) {
  return BigInt(worldBudget.liquid_backing) - (BigInt(newCodeBytes) - BigInt(oldCodeBytes)) * byteCost;
}

/** Fields of get_world_budget that move with balance or storage, not with state. */
const WORLD_BUDGET_MOVING = ["liquid_backing", "operating_and_storage"];

/**
 * Differences between two snapshots (see the upgrade script) that a code-only
 * M4 deploy must not cause. Allowed: payout config max_batch 10 -> 8 and its
 * three new fields; the world budget's balance-derived fields. Everything else
 * (config, treasury, every day, payout day, progress, world day, date total
 * and the raw root STATE bytes when both snapshots have them) must be equal.
 */
export function compareRewardsSnapshots(before, after) {
  const out = [];
  const strip = (s) => {
    const c = structuredClone(s.views);
    if (c.worldBudget) for (const k of WORLD_BUDGET_MOVING) delete c.worldBudget[k];
    delete c.payoutConfig;
    return c;
  };
  out.push(...diffValues(strip(before), strip(after)).map((d) => ({ ...d, path: `views.${d.path}` })));
  const pb = before.views.payoutConfig || {},
    pa = after.views.payoutConfig || {};
  out.push(
    ...diffValues(pb, pa, { ignore: ["max_batch"], additive: M4_NEW_PAYOUT_FIELDS }).map((d) => ({ ...d, path: `views.payoutConfig.${d.path}` })),
  );
  for (const [k, v] of Object.entries(M4_PAYOUT_CONFIG))
    if (pa[k] !== v) out.push({ path: `views.payoutConfig.${k}`, before: pb[k], after: pa[k], expected: v });
  if (before.rawState?.digest && after.rawState?.digest && before.rawState.digest !== after.rawState.digest)
    out.push({ path: "rawState.STATE", before: before.rawState.digest, after: after.rawState.digest });
  return out;
}

/** True when the payout config is already the M4 build's (used to detect an earlier deploy). */
export const isM4PayoutConfig = (cfg) => Object.entries(M4_PAYOUT_CONFIG).every(([k, v]) => cfg?.[k] === v);

/**
 * The manifest edits after the deploy, as a new object:
 * - root codeHash/wasmSha256 = the new build,
 * - globalRewards.rewardsCodeHash follows it when it pinned the old code,
 * - a `callbackRecoveryUpgrade` record and the transaction label.
 * The previous record goes to `previousDeployments` via recordReplacedDeployment.
 */
export function m4ManifestFields(manifest, { codeHash, wasmSha256, previousCodeHash, transactionHash, verifiedAt, sourceCommit, payoutConfig }) {
  const m = structuredClone(manifest);
  m.codeHash = codeHash;
  m.wasmSha256 = wasmSha256;
  if (m.globalRewards && m.globalRewards.rewardsCodeHash === previousCodeHash) m.globalRewards.rewardsCodeHash = codeHash;
  m.callbackRecoveryUpgrade = {
    verifiedAt,
    sourceCommit,
    previousCodeHash,
    newCodeHash: codeHash,
    treasuryUnchanged: true,
    payoutMaxBatch: payoutConfig.max_batch,
    mintTgas: payoutConfig.mint_tgas,
    callbackTgas: payoutConfig.callback_tgas,
    reconcileAfterMs: payoutConfig.reconcile_after_ms,
    note: "Code-only deploy of PR #240 (M4). Root Borsh layout unchanged; attempts live under new LookupMap prefixes. Worker key unchanged: it does not call the reconcile methods.",
  };
  m.verifiedAt = verifiedAt;
  m.transactions = [...(m.transactions || []), { label: "Upgrade rewards: measured callback gas, batch 8, recorded mint attempts and reconcile (M4)", transaction: transactionHash }];
  return m;
}
