// Reads the QGOLD vault (contracts/qgold, docs/QGOLD-VAULT.md): backing, supply,
// R, exit caps and queue, insurance, and the on-chain invariant audit. It feeds
// /api/qgold, /api/qgold/account and the qgoldVault block of /api/health.
// Reads only; it never signs or moves funds.
import { assert } from "../domain.mjs";

const ACCOUNT = /^(?=.{2,64}$)(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/;
const big = (v) => {
  try {
    return BigInt(String(v ?? "0"));
  } catch {
    return 0n;
  }
};

export function qgoldVaultSettings(env = process.env, manifest = null) {
  const contract = env.QGOLD_VAULT_ACCOUNT || manifest?.vaultContract || null;
  return {
    enabled: env.QGOLD_VAULT_ENABLED !== "0" && !!contract && ACCOUNT.test(contract),
    contract,
    manifest,
    cacheMs: 30_000,
  };
}

/**
 * Pure: the monitor's verdict on one get_state + audit pair.
 * - impaired: the contract holds less NEAR than it owes, or R is below its peak
 *   (a booked loss the insurance fund has not refilled yet);
 * - paused: guardian or council pause;
 * - ok otherwise.
 */
export function assessVault(state, audit) {
  const issues = [];
  if (!state || !audit) return { status: "unknown", issues: ["unreadable"] };
  if (big(audit.shortfall) > 0n) issues.push("balance-short");
  if (big(state.supply) > 0n && big(state.rate) < big(state.r_peak)) issues.push("rate-below-peak");
  if (audit.backing_covers_supply_at_peak === false) issues.push("backing-below-supply-at-peak");
  if (big(state.supply) > 0n && big(state.backing) === 0n) issues.push("no-backing");
  const status = issues.length ? "impaired" : state.paused ? "paused" : "ok";
  return { status, issues };
}

export function createQgoldVaultReader({ provider, settings, clock = Date.now, log = () => {} }) {
  let last = null;
  let lastError = null;
  const exits = new Map();
  async function view(method, args = {}) {
    const r = await provider.query({
      request_type: "call_function",
      finality: "final",
      account_id: settings.contract,
      method_name: method,
      args_base64: Buffer.from(JSON.stringify(args)).toString("base64"),
    });
    return JSON.parse(Buffer.from(r.result).toString());
  }
  async function read({ fresh = false } = {}) {
    if (!fresh && last && clock() - last.at < settings.cacheMs) return last.value;
    try {
      const [state, audit] = await Promise.all([view("get_state"), view("audit")]);
      const value = { contract: settings.contract, state, audit, assessment: assessVault(state, audit), readAt: clock() };
      last = { at: clock(), value };
      lastError = null;
      if (value.assessment.status === "impaired") log("qgold-vault-impaired", value.assessment);
      return value;
    } catch (e) {
      lastError = String(e?.message || e).slice(0, 200);
      if (last) return { ...last.value, stale: true };
      throw e;
    }
  }
  async function account(accountId) {
    assert(ACCOUNT.test(accountId || ""), "Invalid NEAR account.");
    const hit = exits.get(accountId);
    if (hit && clock() - hit.at < settings.cacheMs) return hit.value;
    const [balance, open, storage] = await Promise.all([
      view("ft_balance_of", { account_id: accountId }),
      view("get_account_exits", { account_id: accountId }),
      view("storage_balance_of", { account_id: accountId }),
    ]);
    const now = clock();
    const value = {
      accountId,
      balance,
      registered: !!storage,
      exits: (open || []).map((e) => ({ ...e, claimable: Number(e.ready_at) <= now })),
    };
    if (exits.size > 5_000) exits.clear();
    exits.set(accountId, { at: now, value });
    return value;
  }
  function status() {
    if (!last) return { status: lastError ? "unreadable" : "starting", contract: settings.contract, error: lastError || undefined };
    const { state, assessment } = last.value;
    return {
      status: assessment.status,
      issues: assessment.issues,
      contract: settings.contract,
      rate: state.rate,
      supply: state.supply,
      backing: state.backing,
      insurance: state.insurance,
      queue: state.exit?.queue_count ?? 0,
      readAt: last.at,
      error: lastError || undefined,
    };
  }
  return { read, account, status, settings };
}
