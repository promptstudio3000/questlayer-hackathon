// Pure helpers for scripts/smoke-vault-v3-position-testnet.mjs. No IO:
// tests/vault-smoke.test.mjs covers everything here.

const NEAR = 10n ** 24n;
/** contracts/vault MIN_POSITION and the server's deposit floor (0.001 test NEAR). */
export const MIN_STAKE_YOCTO = 10n ** 21n;
/** Gas the app attaches to every vault/factory call (server/native/vaults.mjs prepare). */
export const APP_GAS = 280n * 10n ** 12n;
/** Gas the factory gives the child's `new` (contracts/vault-factory create_position). */
export const NEW_GAS_TGAS = 25;
/** Fields the v3 vault adds to get_state (contracts/vault get_state, docs/NATIVE-REWARDS-AND-VAULT.md). */
export const V3_STATE_FIELDS = ["busy_since", "recoverable_at_epoch", "min_harvest", "next_harvest_epoch", "recovery_policy"];
export const V3_RECOVERY_POLICY = "balance-and-pool-reconciled-after-2-epochs-v3";

/** The dedicated smoke account: a direct sub-account of the operator. */
export function smokeAccountId(operatorId, label = "vault-smoke-v3") {
  if (!/^[a-z0-9-]+$/.test(label)) throw new Error("Smoke label: lowercase letters, digits and '-' only");
  if (!/\.testnet$/.test(operatorId || "")) throw new Error(`${operatorId} is not a testnet account`);
  const id = `${label}.${operatorId}`;
  if (id.length > 64) throw new Error(`${id} is longer than 64 characters`);
  return id;
}

/**
 * NEAR the smoke account needs: the factory's exact setup deposit, the stake,
 * and a gas/storage margin (account record, two 280 TGas calls, the sign-in
 * key stays). Returns { fund, topUp } where topUp is what to send to an
 * existing account with `balance` (0 when it already has enough).
 */
export function smokeFunding({ setupDeposit, stake = MIN_STAKE_YOCTO, margin = NEAR / 10n, balance = 0n, positionExists = false }) {
  const need = (positionExists ? 0n : BigInt(setupDeposit)) + BigInt(stake) + BigInt(margin);
  const have = BigInt(balance);
  return { fund: need, topUp: have >= need ? 0n : need - have };
}

/** The single position the smoke account owns in the factory (null if none; throws on several). */
export function ownPosition(positions, beneficiary) {
  const mine = (positions || []).filter((p) => p.beneficiary === beneficiary && p.state !== "failed");
  if (mine.length > 1) throw new Error(`${beneficiary} owns ${mine.length} live positions; the smoke test expects one`);
  return mine[0] || null;
}

/** Child account the factory derives for position id `id`. */
export const childAccountId = (id, factoryId) => `v${id}.${factoryId}`;

/**
 * Receipt facts of a create_position transaction (the final outcome from
 * sendTransaction / tx status). The child's first receipt holds
 * CreateAccount + Transfer + DeployContract + FunctionCall(new, 25 TGas).
 */
export function summarizeCreateOutcome(outcome, { childId, factoryId, rewardsId }) {
  const receipts = outcome?.receipts_outcome || [];
  const failed = (r) => !!r.outcome?.status?.Failure;
  const pick = (executor) => receipts.filter((r) => r.outcome?.executor_id === executor);
  const child = pick(childId);
  const rewards = pick(rewardsId);
  const factory = pick(factoryId);
  const failures = receipts.filter(failed).map((r) => ({ executor: r.outcome.executor_id, failure: r.outcome.status.Failure }));
  const tgas = (g) => Number(BigInt(g || 0) / 10n ** 9n) / 1000;
  return {
    transactionFailed: !!outcome?.status?.Failure,
    failures,
    child: child.length ? { receipts: child.length, ok: child.every((r) => !failed(r)), gasBurntTgas: child.map((r) => tgas(r.outcome.gas_burnt)) } : null,
    registered: rewards.length ? { ok: rewards.every((r) => !failed(r)), gasBurntTgas: rewards.map((r) => tgas(r.outcome.gas_burnt)) } : null,
    factoryCallbacks: factory.length,
    totalGasBurntTgas: tgas(receipts.reduce((a, r) => a + BigInt(r.outcome?.gas_burnt || 0), BigInt(outcome?.transaction_outcome?.outcome?.gas_burnt || 0))),
  };
}

/**
 * Problems with a fresh child's get_state against v3 and the creation inputs
 * (empty = ok). `stake` is what was deposited (0n before any deposit).
 */
export function v3StateProblems(s, { beneficiary, pool, rewards, contributionBps, stake = 0n }) {
  const out = [];
  if (!s) return ["get_state returned nothing"];
  if (s.version !== 2) out.push(`version ${s.version}, expected 2 (v3 keeps get_state.version 2)`);
  if (s.network !== "testnet") out.push(`network ${s.network}`);
  for (const f of V3_STATE_FIELDS) if (!(f in s)) out.push(`missing v3 field ${f}`);
  if ("recovery_policy" in s && s.recovery_policy !== V3_RECOVERY_POLICY) out.push(`recovery_policy ${s.recovery_policy}`);
  if (s.beneficiary !== beneficiary) out.push(`beneficiary ${s.beneficiary}, expected ${beneficiary}`);
  if (s.pool !== pool) out.push(`pool ${s.pool}, expected ${pool}`);
  if (s.rewards !== rewards) out.push(`rewards ${s.rewards}, expected ${rewards}`);
  if (contributionBps !== undefined && s.contribution_bps !== contributionBps) out.push(`contribution_bps ${s.contribution_bps}, expected ${contributionBps}`);
  if (s.stage !== "idle") out.push(`stage ${s.stage}, expected idle`);
  if (s.exit_requested) out.push("exit already requested");
  if (BigInt(s.principal ?? -1) !== BigInt(stake)) out.push(`principal ${s.principal}, expected ${stake}`);
  if (BigInt(s.staked ?? -1) !== BigInt(stake)) out.push(`staked ${s.staked}, expected ${stake}`);
  return out;
}

/** Parses "0.001" style NEAR into yocto (no floats). */
export function nearToYocto(text) {
  const m = /^(\d+)(?:\.(\d{1,24}))?$/.exec(String(text));
  if (!m) throw new Error(`Not a NEAR amount: ${text}`);
  return BigInt(m[1]) * NEAR + BigInt((m[2] || "").padEnd(24, "0") || "0");
}
export function yoctoToNear(y) {
  const v = BigInt(y);
  const frac = (v % NEAR).toString().padStart(24, "0").replace(/0+$/, "");
  return `${v / NEAR}${frac ? "." + frac : ""}`;
}

/**
 * What the server lists for the smoke account (GET /api/native/vaults?account=):
 * the position must be ready, carry a position state and match the child.
 */
export function serverListingProblems(snapshot, { childId, factoryId }) {
  const out = [];
  if (!snapshot || snapshot.status === "not-configured") return ["server: vaults not configured"];
  if (snapshot.factoryId !== factoryId) out.push(`server factory ${snapshot.factoryId}, expected ${factoryId}`);
  const p = (snapshot.positions || []).find((x) => x.account_id === childId);
  if (!p) out.push(`server does not list ${childId}`);
  else {
    if (p.state !== "ready") out.push(`server lists ${childId} as ${p.state}, not ready`);
    if (!p.position) out.push("server returned no position state (code hash or keyless check failed)");
  }
  return out;
}
