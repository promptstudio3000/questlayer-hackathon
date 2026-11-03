// Public economy ledger (docs/ECONOMY-PAGE.md): one read-only JSON for the
// /economy page. It only composes facts the server already publishes
// elsewhere (distribution audit, stNEAR treasury view, realized-yield
// backing, published days, confirmed claims and the yield cycle proof) and
// adds an explorer link to every transaction. Nothing here signs, and no
// player id, session or key is ever part of the answer.
import { manifestCost } from "./allocation.mjs";
import { storedNativeManifest } from "./reward-manifest.mjs";
import { EXPLORER_BASE, NETWORK } from "./network.mjs";

export const LEDGER_DAYS = 14;
export const LEDGER_PAYOUTS = 50;

const txUrl = (hash) =>
  typeof hash === "string" && /^[1-9A-HJ-NP-Za-km-z]{32,64}$/.test(hash)
    ? `${EXPLORER_BASE}/txns/${hash}`
    : null;
const accountUrl = (id) =>
  typeof id === "string" && id ? `${EXPLORER_BASE}/address/${id}` : null;
const iso = (ms) => (Number.isFinite(ms) ? new Date(ms).toISOString() : null);

/** Published (and recently closed) prize days with their exact budget. */
export function publishedDays(db, limit = LEDGER_DAYS) {
  let rows;
  try {
    rows = db
      .prepare(
        "SELECT * FROM native_days WHERE state!='prepared' ORDER BY day DESC,id DESC LIMIT ?",
      )
      .all(limit);
  } catch {
    return [];
  }
  const out = [];
  for (const row of rows) {
    let m;
    try {
      m = storedNativeManifest(row);
    } catch {
      continue;
    }
    const cost = manifestCost(m);
    out.push({
      id: row.id,
      date: row.day,
      state: row.state,
      funding: m.funding === "realized_yield" ? "realized-yield" : "treasury",
      coins: m.coins.length,
      coinBudget: cost.coins.toString(),
      zones: m.quests.length,
      zoneBudget: cost.zones.toString(),
      total: cost.total.toString(),
      transactionHash: row.transaction_hash || null,
      explorerUrl: txUrl(row.transaction_hash),
    });
  }
  return out;
}

/** Budget per local date across every city (money is one global pool). */
export function budgetByDate(days) {
  const byDate = new Map();
  for (const d of days) {
    const r = byDate.get(d.date) || {
      date: d.date,
      cities: 0,
      coinBudget: 0n,
      zoneBudget: 0n,
      fromYield: 0n,
    };
    r.cities += 1;
    r.coinBudget += BigInt(d.coinBudget);
    r.zoneBudget += BigInt(d.zoneBudget);
    if (d.funding === "realized-yield") r.fromYield += BigInt(d.total);
    byDate.set(d.date, r);
  }
  return [...byDate.values()].map((r) => ({
    date: r.date,
    cities: r.cities,
    coinBudget: r.coinBudget.toString(),
    zoneBudget: r.zoneBudget.toString(),
    total: (r.coinBudget + r.zoneBudget).toString(),
    fromYield: r.fromYield.toString(),
  }));
}

/** Confirmed on-chain claims, newest first; the account is already public on chain. */
export function confirmedPayouts(db, limit = LEDGER_PAYOUTS) {
  let rows, totals;
  try {
    rows = db
      .prepare(
        "SELECT day_id,kind,account_id,amount,transaction_hash,confirmed_at FROM native_reward_claims WHERE state='confirmed' ORDER BY confirmed_at DESC,seq DESC LIMIT ?",
      )
      .all(limit);
    totals = db
      .prepare(
        "SELECT kind,COUNT(*) AS n,GROUP_CONCAT(amount) AS amounts FROM native_reward_claims WHERE state='confirmed' GROUP BY kind",
      )
      .all();
  } catch {
    return { count: 0, total: "0", byKind: {}, recent: [] };
  }
  let total = 0n,
    count = 0;
  const byKind = {};
  for (const t of totals) {
    const sum = String(t.amounts || "")
      .split(",")
      .filter((a) => /^\d+$/.test(a))
      .reduce((a, b) => a + BigInt(b), 0n);
    byKind[t.kind] = { count: t.n, total: sum.toString() };
    total += sum;
    count += t.n;
  }
  return {
    count,
    total: total.toString(),
    byKind,
    recent: rows.map((r) => ({
      dayId: r.day_id,
      kind: r.kind,
      account: r.account_id,
      amount: /^\d+$/.test(r.amount || "") ? r.amount : null,
      at: iso(r.confirmed_at),
      transactionHash: r.transaction_hash || null,
      explorerUrl: txUrl(r.transaction_hash),
    })),
  };
}

/** The checked yield cycle proof, with an explorer link per flush. */
export function yieldCycle(proof) {
  if (!proof?.realizedYieldYocto) return null;
  const flush = (proof.timeline || []).find((s) => s.step === "flush");
  return {
    summary: proof.summary,
    rewardsContract: proof.rewardsContract,
    pool: proof.pool,
    generation: proof.generation,
    realizedYieldYocto: proof.realizedYieldYocto,
    fundedBefore: proof.treasuryBefore?.funded ?? null,
    fundedAfter: proof.treasuryAfter?.funded ?? null,
    reconciliation: proof.reconciliation,
    auditStatus: proof.distributionAudit?.status ?? null,
    timeline: (proof.timeline || []).map((s) => ({
      step: s.step,
      epoch: s.epoch ?? null,
      at: s.at ?? null,
      detail: s.detail ?? null,
    })),
    flushes: (flush?.flushes || []).map((f) => ({
      vault: f.vault,
      gamePaidYocto: f.gamePaidYocto,
      at: f.at,
      transactionHash: f.transactionHash,
      explorerUrl: txUrl(f.transactionHash),
    })),
  };
}

async function settle(fn) {
  try {
    return { status: "observed", data: await fn() };
  } catch (error) {
    return {
      status: "unavailable",
      reason: String(error?.message || error).slice(0, 160),
    };
  }
}

/**
 * Builds the public ledger reader. Every source is optional: a host without
 * native rewards still answers, and says which parts it cannot show.
 */
export function createPublicLedger({
  native = null,
  treasury = null,
  yieldBacking = null,
  cycleProof = () => null,
  clock = Date.now,
  cacheMs = 60_000,
}) {
  let hit = null,
    pending = null;
  async function build() {
    const audit = native?.lastAudit ?? null;
    const [stnear, backing] = await Promise.all([
      treasury ? settle(treasury) : { status: "not-configured" },
      native && yieldBacking
        ? settle(() => yieldBacking(native))
        : { status: "not-configured" },
    ]);
    const days = native ? publishedDays(native.db) : [];
    const yieldStatus = stnear.data?.yieldStatus ?? null;
    return {
      version: 1,
      network: NETWORK,
      unit: "yoctoNEAR",
      explorer: EXPLORER_BASE,
      generatedAt: iso(clock()),
      rewardsContract: native
        ? { id: native.contractId, explorerUrl: accountUrl(native.contractId) }
        : null,
      treasury: audit?.totals
        ? {
            status: "observed",
            observedAt: iso(audit.observedAt),
            ...audit.totals,
            liquid:
              audit.checks?.find((c) => c.name === "account-covers-liabilities")
                ?.liquid ?? null,
            yieldBackedDays: native?.yieldBackedDays === true,
          }
        : { status: native ? "not-audited-yet" : "not-configured" },
      audit: audit
        ? {
            status: audit.status,
            observedAt: iso(audit.observedAt),
            failed: audit.failed ?? [],
            reason: audit.reason ?? null,
            checks: (audit.checks || []).map((c) => ({
              name: c.name,
              ok: c.ok,
            })),
            scope: audit.scope ?? null,
          }
        : { status: native ? "not-run" : "not-configured" },
      realizedYield:
        backing.status === "observed"
          ? {
              status: "observed",
              paid: backing.data.paid,
              committed: backing.data.committed,
              free: backing.data.free,
              vaults: (backing.data.vaults || []).map((v) => ({
                accountId: v.accountId,
                gamePaid: v.gamePaid,
                explorerUrl: accountUrl(v.accountId),
              })),
            }
          : { status: backing.status, reason: backing.reason ?? null },
      stnear:
        stnear.status === "observed"
          ? {
              status: "observed",
              account: stnear.data.account,
              accountUrl: accountUrl(stnear.data.account),
              contract: stnear.data.contract,
              balance: stnear.data.balance,
              parked: stnear.data.parked,
              price: stnear.data.price,
              depositPrice: stnear.data.depositPrice,
              value: stnear.data.value,
              principal: stnear.data.principal,
              growth: stnear.data.growth,
              harvested: stnear.data.harvested,
              yieldStatus,
              deposits: (stnear.data.deposits || []).map((d) => ({
                at: d.at,
                near: d.near,
                stnear: d.stnear,
                explorerUrl: txUrl(d.transaction),
              })),
              harvests: (stnear.data.harvests || []).map((h) => ({
                at: h.at,
                received: h.received ?? null,
                receiptId: h.receiptId ?? null,
                sellUrl: txUrl(h.unstakeTransaction),
                fundUrl: txUrl(h.fundTransaction),
              })),
            }
          : { status: stnear.status, reason: stnear.reason ?? null },
      budget: budgetByDate(days),
      days,
      payouts: native
        ? confirmedPayouts(native.db)
        : { count: 0, total: "0", byKind: {}, recent: [] },
      yieldCycle: yieldCycle(cycleProof()),
    };
  }
  return async function read() {
    if (hit && clock() - hit.at < cacheMs) return hit.value;
    if (pending) return pending;
    pending = build();
    try {
      const value = await pending;
      hit = { at: clock(), value };
      return value;
    } finally {
      pending = null;
    }
  };
}
