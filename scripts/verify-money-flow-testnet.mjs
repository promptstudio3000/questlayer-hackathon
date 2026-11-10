// Read-only check of the whole testnet money chain, printed as a PASS/WARN/FAIL
// table. It sends no transaction, needs no key and reads nothing private:
// NEAR RPC view calls (call_function, view_account, view_access_key_list) and
// the public GET endpoints of the game server.
//
//   npm run verify:money-flow
//   node scripts/verify-money-flow-testnet.mjs [--escrow=<id>] [--qgold=<id>]
//     [--rewards=<id>] [--yield-vault=<id>] [--base-url=<url>] [--rpc=<url>] [--json]
//
// Contract accounts come from the testnet manifests in public/ (the same files
// the server reads); the flags override them, e.g. --escrow= for a new escrow
// account before its manifest is committed.
//
// Checks (each runs on its own; one failure never hides the others):
//   1. Map coins: the day's budget is priced at the QGOLD rate R, one coin is the
//      coin budget over all coin shares, the budget fits the rewards per-date
//      cap, and realized yield committed to days never exceeds yield paid.
//   2. Daily payouts: payout days the server reports exist on the rewards
//      contract with a root; paid ≤ reserved; per-leaf statuses agree with the
//      settlement counters (no leaf paid twice).
//   3. QGOLD: metadata, total supply, invariant audit, minter, and the code hash
//      against contracts/wasm-sha256.json (WARN while a timelocked upgrade is pending).
//   4. Burns: supply = minted − burned − redeemed, the burn total the server
//      shows, burns only ever growing.
//   5. Escrow: account, code hash, token = QGOLD, conserved stats, and the server
//      and signing vault both pointing at this escrow.
//   6. Treasury / yield vault: reward buckets add up to funding, the server's
//      distribution audit, the yield vault and the stNEAR mix.
//
// Exit code 1 when any check FAILs; WARN (e.g. "not upgraded yet") exits 0.
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const DEFAULT_BASE_URL = "https://questlayer.promptstudio3000.com";
export const DEFAULT_RPCS = ["https://rpc.testnet.near.org", "https://test.rpc.fastnear.com"];
export const PASS = "PASS", WARN = "WARN", FAIL = "FAIL";

// ------------------------------------------------------------------ pure parts

export function parseArgs(argv) {
  const out = {};
  for (const a of argv) {
    const m = /^--([a-z-]+)(?:=(.*))?$/.exec(a);
    if (!m) throw new Error(`Unknown argument: ${a}`);
    out[m[1]] = m[2] ?? true;
  }
  const allowed = ["escrow", "qgold", "rewards", "yield-vault", "base-url", "rpc", "json"];
  for (const k of Object.keys(out)) if (!allowed.includes(k)) throw new Error(`Unknown flag --${k}`);
  for (const k of ["escrow", "qgold", "rewards", "yield-vault"])
    if (out[k] !== undefined && !/^[a-z0-9][a-z0-9._-]*\.testnet$/.test(String(out[k])))
      throw new Error(`--${k} must be a .testnet account, got ${out[k]}`);
  return out;
}

const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
/** NEAR code_hash (base58 of the WASM sha256) to lowercase hex. */
export function base58ToHex(s) {
  let n = 0n;
  for (const c of String(s)) {
    const v = B58.indexOf(c);
    if (v < 0) throw new Error(`Not base58: ${s}`);
    n = n * 58n + BigInt(v);
  }
  let hex = n === 0n ? "" : n.toString(16);
  if (hex.length % 2) hex = "0" + hex;
  for (const c of String(s)) {
    if (c !== "1") break;
    hex = "00" + hex;
  }
  return hex.padStart(64, "0");
}

/**
 * Deployed code against the reproducible build pin. Equal → PASS. A hash the
 * repo lists on purpose as an older testnet deployment of this contract
 * (testnetDeploymentsNotFromThisBuild) → WARN: not upgraded yet. Anything
 * else → FAIL: unknown code.
 */
export function classifyCodeHash(actualHex, contract, pins) {
  const pinned = pins?.contracts?.[contract];
  const actual = String(actualHex || "").toLowerCase();
  if (!pinned) return { status: FAIL, detail: `${contract} has no pin in contracts/wasm-sha256.json` };
  if (/^0+$/.test(actual)) return { status: FAIL, detail: "no contract code deployed on this account" };
  if (actual === pinned) return { status: PASS, detail: `matches pin ${pinned.slice(0, 12)}…` };
  const known = Object.entries(pins.testnetDeploymentsNotFromThisBuild || {})
    .filter(([k, v]) => k !== "about" && v?.contract === contract && v.sha256 === actual);
  if (known.length)
    return {
      status: WARN,
      pending: true,
      detail: `not upgraded yet: runs ${actual.slice(0, 12)}… (recorded older build, ${known[0][0].split(":")[0]}), pin is ${pinned.slice(0, 12)}…`,
    };
  return { status: FAIL, detail: `unknown code ${actual.slice(0, 12)}…, pin is ${pinned.slice(0, 12)}…` };
}

const big = (v) => BigInt(String(v ?? "0"));

/** Problems with one payout day read from the rewards contract (empty = fine). */
export function payoutDayProblems(day, progress) {
  const p = [];
  if (!day) return ["day missing on chain"];
  if (!/^[0-9a-f]{64}$/i.test(String(day.root || ""))) p.push(`root is not a 32-byte hex hash: ${day.root}`);
  const reserved = big(day.coins_reserved) + big(day.zones_reserved);
  const left = big(day.coins_left) + big(day.zones_left);
  const paid = big(day.paid);
  if (paid > reserved) p.push(`paid ${paid} > reserved ${reserved}`);
  if (!day.closed && paid + left !== reserved) p.push(`open day: paid ${paid} + left ${left} ≠ reserved ${reserved}`);
  if (day.closed && left !== 0n) p.push(`closed day still holds ${left}`);
  if (day.paid_leaves > day.leaves) p.push(`claimed leaves ${day.paid_leaves} > leaves ${day.leaves}`);
  if (progress) {
    if (progress.root !== day.root) p.push("progress root differs from day root");
    if (progress.paid_leaves + progress.pending_leaves !== day.paid_leaves)
      p.push(`settlement paid ${progress.paid_leaves} + pending ${progress.pending_leaves} ≠ claimed ${day.paid_leaves}`);
    if (day.closed && (progress.pending_leaves !== 0 || progress.paid_leaves !== day.leaves))
      p.push(`closed with ${progress.paid_leaves}/${day.leaves} paid, ${progress.pending_leaves} pending`);
    const st = progress.statuses || [];
    if (st.length === day.leaves) {
      const paidN = st.filter((s) => s === "paid").length;
      const pendN = st.filter((s) => s === "pending").length;
      if (paidN !== progress.paid_leaves) p.push(`leaf statuses show ${paidN} paid, settlement says ${progress.paid_leaves}`);
      if (paidN + pendN !== day.paid_leaves) p.push(`leaf statuses show ${paidN + pendN} claimed, day says ${day.paid_leaves}`);
    }
  } else p.push("no settlement record (get_payout_progress returned null)");
  return p;
}

/** Map day arithmetic the server reports (server/map-rewards/day-plan.mjs, budget.mjs). */
export function mapDayProblems(d, { pioneerMult = 2 } = {}) {
  const p = [];
  const b = d?.summary?.budget;
  if (!b) return ["no budget in the map day"];
  const rate = big(b.rateYocto);
  if (rate <= 0n) return ["budget rate is zero"];
  const coinsU = (big(b.coinYocto) * 1_000_000n) / rate;
  const zonesU = (big(b.zoneYocto) * 1_000_000n) / rate;
  if (BigInt(b.coinsU) !== coinsU) p.push(`coin budget ${b.coinsU} µQGOLD ≠ ${b.coinYocto} yocto ÷ R = ${coinsU}`);
  if (BigInt(b.zonesU) !== zonesU) p.push(`zone budget ${b.zonesU} µQGOLD ≠ ${b.zoneYocto} yocto ÷ R = ${zonesU}`);
  const s = d.summary;
  const shares = s.coinsPerCell * (s.cells + s.pioneers * (pioneerMult - 1));
  const value = shares > 0 ? Math.floor(b.coinsU / shares) : 0;
  if (s.coinValueU !== value) p.push(`coin value ${s.coinValueU} ≠ ${b.coinsU} ÷ ${shares} shares = ${value}`);
  if (d.coinsU + d.pioneerU + s.unplacedU.coins !== b.coinsU)
    p.push(`placed ${d.coinsU} + pioneer ${d.pioneerU} + unplaced ${s.unplacedU.coins} ≠ budget ${b.coinsU}`);
  if (d.zonesU + s.unplacedU.zones !== b.zonesU) p.push(`zones ${d.zonesU} + unplaced ${s.unplacedU.zones} ≠ budget ${b.zonesU}`);
  return p;
}

export const exitCode = (rows) => (rows.some((r) => r.status === FAIL) ? 1 : 0);

export function summarize(rows) {
  const n = { [PASS]: 0, [WARN]: 0, [FAIL]: 0 };
  for (const r of rows) n[r.status] = (n[r.status] || 0) + 1;
  return n;
}

export function renderTable(rows) {
  const w1 = Math.max(5, ...rows.map((r) => r.area.length));
  const w2 = Math.max(5, ...rows.map((r) => r.check.length));
  const line = (a, b, c, d) => `${a.padEnd(w1)}  ${b.padEnd(w2)}  ${c.padEnd(6)}  ${d}`;
  const out = [line("AREA", "CHECK", "STATUS", "DETAIL"), line("-".repeat(w1), "-".repeat(w2), "------", "------")];
  for (const r of rows) out.push(line(r.area, r.check, r.status, r.detail));
  const n = summarize(rows);
  out.push("", `${n.PASS} PASS, ${n.WARN} WARN, ${n.FAIL} FAIL → ${exitCode(rows) ? "FAIL" : n.WARN ? "PASS with warnings" : "PASS"}`);
  return out.join("\n");
}

// ------------------------------------------------------------------ IO

function manifest(name) {
  try {
    return JSON.parse(readFileSync(resolve(ROOT, "public", name), "utf8"));
  } catch {
    return {};
  }
}

export function resolveAccounts(args, read = manifest) {
  const qv = read("native-qgold-vault-testnet.json");
  const rw = read("native-rewards-testnet.json");
  const es = read("native-qgold-escrow-testnet.json");
  const yv = read("native-yield-vault-testnet.json");
  const mix = read("treasury-mix-testnet.json");
  const st = read("stnear-treasury-testnet.json");
  return {
    qgold: args.qgold || qv.tokenContract || rw.qgoldVault,
    rewards: args.rewards || rw.contractId || qv.rewardsContract,
    escrow: args.escrow || es.contractId,
    escrowManifestToken: es.tokenId,
    yieldVault: args["yield-vault"] || yv.contractId || mix.vault,
    treasury: mix.account || st.account,
    stnear: st.contract || "meta-v2.pool.testnet",
  };
}

function makeRpc(urls) {
  async function call(method, params) {
    let last;
    for (const url of urls) {
      try {
        const r = await fetch(url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id: "verify", method, params }),
          signal: AbortSignal.timeout(20000),
        });
        if (!r.ok) throw new Error(`${url} HTTP ${r.status}`);
        const j = await r.json();
        if (j.error) {
          const t = JSON.stringify(j.error);
          // A contract/account error is an answer, not an RPC outage.
          if (/UNKNOWN_ACCOUNT|does not exist|MethodNotFound|FunctionCallError|NO_CONTRACT_CODE|CodeDoesNotExist/i.test(t))
            throw Object.assign(new Error(t.slice(0, 300)), { final: true });
          throw new Error(t.slice(0, 300));
        }
        if (j.result?.error) throw Object.assign(new Error(String(j.result.error).slice(0, 300)), { final: true });
        return j.result;
      } catch (e) {
        if (e.final) throw e;
        last = e;
      }
    }
    throw last;
  }
  const query = (p) => call("query", { finality: "final", ...p });
  return {
    view: async (account_id, method_name, args = {}) => {
      const r = await query({ request_type: "call_function", account_id, method_name, args_base64: Buffer.from(JSON.stringify(args)).toString("base64") });
      const text = Buffer.from(r.result).toString();
      return text ? JSON.parse(text) : null;
    },
    account: (account_id) => query({ request_type: "view_account", account_id }),
    keys: async (account_id) => (await query({ request_type: "view_access_key_list", account_id })).keys,
  };
}

async function getJson(url) {
  const r = await fetch(url, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(20000) });
  const text = await r.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = null;
  }
  if (!r.ok) throw new Error(`GET ${url} → HTTP ${r.status}${body?.error ? `: ${body.error}` : ""}`);
  return body;
}

const short = (yocto, dec = 24, digits = 4) => {
  const v = big(yocto);
  const s = v.toString().padStart(dec + 1, "0");
  return `${s.slice(0, -dec)}.${s.slice(-dec).slice(0, digits)}`;
};
// Tiny testnet amounts (realized yield) would print as 0.0000: show yocto then.
const nearOf = (y) => (big(y) > 0n && big(y) < 10n ** 20n ? `${big(y)} yoctoNEAR` : `${short(y)} NEAR`);
const qgoldOf = (u) => `${short(u, 6, 3)} QGOLD`;

// One area's checks. `add` collects rows; a thrown error becomes one FAIL row
// and the other areas still run.
async function area(rows, name, fn) {
  const add = (check, status, detail) => rows.push({ area: name, check, status, detail: String(detail) });
  try {
    await fn(add);
  } catch (e) {
    add("area could not complete", FAIL, e.message || e);
  }
}

const eq = (add, check, a, b, detail = "") =>
  add(check, a === b ? PASS : FAIL, a === b ? `${detail || a}` : `${a} ≠ ${b}${detail ? ` (${detail})` : ""}`);

export async function runChecks({ args = {}, now = Date.now(), log = () => {} } = {}) {
  const base = String(args["base-url"] || DEFAULT_BASE_URL).replace(/\/+$/, "");
  const rpcUrls = args.rpc ? [String(args.rpc)] : DEFAULT_RPCS;
  const rpc = makeRpc(rpcUrls);
  const ids = resolveAccounts(args);
  const pins = JSON.parse(readFileSync(resolve(ROOT, "contracts/wasm-sha256.json"), "utf8"));
  log(`server ${base}\nrpc    ${rpcUrls.join(", ")}\nqgold  ${ids.qgold}\nrewards ${ids.rewards}\nescrow ${ids.escrow}\nyield  ${ids.yieldVault}\n`);
  const rows = [];
  const cache = new Map();
  const once = (k, f) => (cache.has(k) ? cache.get(k) : (cache.set(k, f()), cache.get(k)));
  const server = (path) => once(path, () => getJson(base + path));
  const qstate = () => once("qstate", () => rpc.view(ids.qgold, "get_state"));
  const codeHex = async (id) => base58ToHex((await rpc.account(id)).code_hash);

  // 1. Map coins ------------------------------------------------------------
  await area(rows, "1 map coins", async (add) => {
    const d = await server("/api/map/rewards/day");
    const b = d.summary.budget;
    const problems = mapDayProblems(d);
    add("budget ÷ coin shares = coin value", problems.length ? FAIL : PASS,
      problems.join("; ") || `${d.day}: ${d.summary.cells} cells, ${d.summary.pioneers} pioneers, 1 coin = ${d.summary.coinValueU} µQGOLD, budget ${nearOf(b.coinYocto)} coins + ${nearOf(b.zoneYocto)} zones`);
    add("budget priced from chain", b.source === "chain" ? PASS : WARN, `source=${b.source}`);
    const state = await qstate();
    const r = big(b.rateYocto), live = big(state.rate);
    add("budget rate vs live QGOLD R", r <= live ? PASS : FAIL,
      r === live ? `R ${r}` : r < live ? `budget R ${r} < live R ${live} (R rose since pricing; fine)` : `budget R ${r} > live R ${live}: coins over-valued`);
    const t = await rpc.view(ids.rewards, "get_date_totals", { date: d.day });
    const half = big(t.cap) / 2n;
    add("budget within rewards per-date cap", big(b.coinYocto) <= half && big(b.zoneYocto) <= half ? PASS : FAIL,
      `coins ${nearOf(b.coinYocto)}, zones ${nearOf(b.zoneYocto)}, half cap ${nearOf(half)} (cap ${nearOf(t.cap)})`);
    const ledger = await server("/api/economy/ledger");
    const y = ledger.realizedYield;
    if (!y || y.status !== "observed") add("yield committed ≤ yield paid", WARN, `realized yield ${y?.status || "missing"}`);
    else
      add("yield committed ≤ yield paid", big(y.committed) <= big(y.paid) ? PASS : FAIL,
        `paid ${nearOf(y.paid)}, committed ${nearOf(y.committed)}, free ${nearOf(y.free)}; yield-backed days ${ledger.treasury?.yieldBackedDays ? "on" : "off"}`);
  });

  // 2. Daily payouts --------------------------------------------------------
  await area(rows, "2 payouts", async (add) => {
    const cls = classifyCodeHash(await codeHex(ids.rewards), "questlayer_rewards", pins);
    add("rewards code hash", cls.status, cls.detail);
    const cfg = await rpc.view(ids.rewards, "get_config");
    eq(add, "rewards pays into QGOLD vault", cfg.qgold_vault, ids.qgold);
    add("rewards not paused", cfg.paused ? FAIL : PASS, `paused=${cfg.paused}`);
    const d = await server("/api/map/rewards/day");
    if (!Array.isArray(d.payouts)) {
      add("server payout days", WARN, "payouts not enabled on the server (payouts: null)");
      return;
    }
    if (!d.payouts.length) {
      add("server payout days", WARN, "no payout days recorded yet");
      return;
    }
    const latest = d.payouts.map((p) => p.date).sort().at(-1);
    // A payout round labels its date with the local cutoff (YYYY-MM-DDTHH:MM).
    const age = Math.round((Date.parse(d.day) - Date.parse(latest.slice(0, 10))) / 86400000);
    add("latest payout day is recent", age <= 2 ? PASS : WARN, `latest ${latest}, map day ${d.day} (${age} d)`);
    let published = null;
    for (const p of d.payouts) {
      const day = await rpc.view(ids.rewards, "get_payout_day", { day_id: p.dayId });
      if (p.state === "empty" && !day) {
        add(`${p.dayId}`, PASS, "empty: no leaves, nothing published");
        continue;
      }
      if (p.state === "pending" && !day) {
        add(`${p.dayId}`, WARN, "built, not yet published on chain");
        continue;
      }
      if (!day) {
        add(`${p.dayId}`, FAIL, `server says ${p.state}, chain has no such payout day`);
        continue;
      }
      const n = Math.min(day.leaves, 1024);
      const progress = await rpc.view(ids.rewards, "get_payout_progress", { day_id: p.dayId, indexes: [...Array(n).keys()] });
      const problems = payoutDayProblems(day, progress);
      if (day.leaves !== p.leaves) problems.push(`chain leaves ${day.leaves} ≠ server ${p.leaves}`);
      const reserved = big(day.coins_reserved) + big(day.zones_reserved);
      if (p.totalYocto && reserved !== big(p.totalYocto)) problems.push(`chain reserved ${reserved} ≠ server total ${p.totalYocto}`);
      add(`${p.dayId}`, problems.length ? FAIL : PASS,
        problems.join("; ") || `${day.closed ? "closed" : "open"}, root ${day.root.slice(0, 10)}…, ${progress.paid_leaves}/${day.leaves} paid, ${progress.pending_leaves} pending, paid ${nearOf(day.paid)} of ${nearOf(reserved)}`);
      if (!published || p.date > published.date) published = p;
    }
    add("a payout day with leaves is published", published ? PASS : WARN,
      published ? `latest ${published.dayId}` : `all ${d.payouts.length} recent payout days are empty (no wallet-linked map coins to pay)`);
  });

  // 3. QGOLD ----------------------------------------------------------------
  await area(rows, "3 QGOLD", async (add) => {
    const md = await rpc.view(ids.qgold, "ft_metadata");
    add("ft_metadata", md.symbol === "QGOLD" && md.decimals === 6 ? PASS : FAIL, `${md.name} ${md.symbol}, ${md.decimals} decimals, ${md.spec}`);
    const [supply, state, audit, cfg] = await Promise.all([
      rpc.view(ids.qgold, "ft_total_supply"), qstate(), rpc.view(ids.qgold, "audit"), rpc.view(ids.qgold, "get_config"),
    ]);
    eq(add, "ft_total_supply = state supply", supply, state.supply, qgoldOf(supply));
    add("vault audit (backing ≥ obligations, R ≥ peak)", audit.ok && audit.backing_covers_supply_at_peak ? PASS : FAIL,
      `ok=${audit.ok}, covers=${audit.backing_covers_supply_at_peak}, slack ${nearOf(audit.slack)}, shortfall ${nearOf(audit.shortfall)}, R ${short(state.rate, 21, 6)} mNEAR/QGOLD`);
    add("not paused", state.paused ? FAIL : PASS, `paused=${state.paused}`);
    add("rewards is a minter", (cfg.minters || []).includes(ids.rewards) ? PASS : FAIL, `minters: ${(cfg.minters || []).join(", ") || "none"}`);
    const cls = classifyCodeHash(await codeHex(ids.qgold), "questlayer_qgold", pins);
    let detail = cls.detail;
    if (cls.pending) {
      const pin = pins.contracts.questlayer_qgold;
      for (let id = 1; id <= 20; id++) {
        const p = await rpc.view(ids.qgold, "get_proposal", { id: String(id) }).catch(() => null);
        if (!p) break;
        if (p.action?.Upgrade?.code_sha256 === pin && !p.done) {
          const at = Number(p.executable_at);
          detail += `; council proposal #${p.id} upgrades to the pin, ${at > now ? `timelock ends ${new Date(at).toISOString()}` : `executable since ${new Date(at).toISOString()}, not applied`}`;
        }
      }
    }
    add("code hash vs wasm-sha256.json", cls.status, detail);
    const page = await server("/api/economy/qgold");
    eq(add, "server QGOLD token = QGOLD account", page.token?.contract, ids.qgold);
    add("server supply = chain supply", page.vault?.supply === state.supply ? PASS : WARN,
      page.vault?.supply === state.supply ? qgoldOf(state.supply) : `server ${page.vault?.supply} vs chain ${state.supply} (server caches 30 s)`);
  });

  // 4. Burns ----------------------------------------------------------------
  await area(rows, "4 burns", async (add) => {
    const s = await qstate();
    const expect = big(s.minted_total) - big(s.burned_total) - big(s.redeemed_total);
    add("supply = minted − burned − redeemed", expect === big(s.supply) ? PASS : FAIL,
      `${qgoldOf(s.minted_total)} − ${qgoldOf(s.burned_total)} − ${qgoldOf(s.redeemed_total)} = ${qgoldOf(expect)} vs supply ${qgoldOf(s.supply)}`);
    add("burns recorded on chain", big(s.burned_total) > 0n ? PASS : WARN, `burned_total ${qgoldOf(s.burned_total)}`);
    add("burns keep R at its peak", big(s.rate) >= big(s.r_peak) ? PASS : FAIL, `R ${s.rate}, peak ${s.r_peak}`);
    const page = await server("/api/economy/qgold");
    add("server burn total = chain", page.vault?.burned === s.burned_total ? PASS : WARN,
      `server ${page.vault?.burned}, chain ${s.burned_total}`);
    const chart = (page.chart || []).filter((c) => c.burned != null);
    const drops = chart.filter((c, i) => i > 0 && big(c.burned) < big(chart[i - 1].burned));
    const beyond = chart.filter((c) => big(c.burned) > big(s.burned_total));
    add("burn history only grows", drops.length || beyond.length ? FAIL : PASS,
      drops.length || beyond.length ? `${drops.length} decreases, ${beyond.length} points above chain` : `${chart.length} chart points, last ${qgoldOf(chart.at(-1)?.burned ?? 0)}`);
  });

  // 5. Escrow ---------------------------------------------------------------
  await area(rows, "5 escrow", async (add) => {
    if (!ids.escrow) throw new Error("no escrow account (manifest missing; pass --escrow=)");
    const acct = await rpc.account(ids.escrow);
    add("escrow account exists", PASS, `${ids.escrow}, ${nearOf(acct.amount)}`);
    const cls = classifyCodeHash(base58ToHex(acct.code_hash), "questlayer_qgold_escrow", pins);
    add("code hash vs wasm-sha256.json", cls.status, cls.pending ? `${cls.detail}; the new escrow is not this account yet` : cls.detail);
    const keys = await rpc.keys(ids.escrow);
    const full = keys.filter((k) => k.access_key?.permission === "FullAccess").length;
    add("escrow is keyless", keys.length === 0 ? PASS : WARN, `${keys.length} keys (${full} full access)`);
    const cfg = await rpc.view(ids.escrow, "get_config");
    eq(add, "escrow token = QGOLD", cfg.token_id, ids.qgold);
    add("escrow not paused", cfg.paused ? FAIL : PASS, `paused=${cfg.paused}, fee ${cfg.fee_bps} bps`);
    const stats = await rpc.view(ids.escrow, "get_stats");
    const bal = await rpc.view(ids.qgold, "ft_balance_of", { account_id: ids.escrow });
    add("escrow conserved and backed", stats.conserved && big(bal) >= big(stats.total_held) ? PASS : FAIL,
      `conserved=${stats.conserved}, holds ${qgoldOf(stats.total_held)}, QGOLD balance ${qgoldOf(bal)}, ${stats.open_escrows} open`);
    const reg = await rpc.view(ids.qgold, "storage_balance_of", { account_id: ids.escrow });
    add("escrow registered on QGOLD", reg ? PASS : FAIL, reg ? "storage registered" : "not registered");
    const health = await server("/api/health");
    const me = health.marketEscrow || {};
    add("server escrow = this escrow", me.contractId === ids.escrow ? PASS : FAIL,
      `/api/health marketEscrow.contractId=${me.contractId}, enabled=${me.enabled}, failed=${me.failed}`);
    const config = await server("/api/config");
    if (config.contracts?.qgoldEscrow !== undefined)
      eq(add, "/api/config escrow", config.contracts.qgoldEscrow, ids.escrow);
    if (!config.signingVaultOrigin) add("signing vault allowlist", WARN, "/api/config has no signingVaultOrigin");
    else {
      const vc = await getJson(`${config.signingVaultOrigin.replace(/\/+$/, "")}/vault-config.json`);
      const ok = vc.contracts?.qgoldEscrow === ids.escrow && vc.contracts?.qgold === ids.qgold;
      add("signing vault allowlist", ok ? PASS : FAIL,
        `${config.signingVaultOrigin}/vault-config.json: qgoldEscrow=${vc.contracts?.qgoldEscrow}, qgold=${vc.contracts?.qgold}`);
    }
  });

  // 6. Treasury / yield vault -----------------------------------------------
  await area(rows, "6 treasury", async (add) => {
    const t = await rpc.view(ids.rewards, "get_treasury");
    const buckets = ["coins", "zones"].reduce((n, k) => n + big(t[k].available) + big(t[k].reserved) + big(t[k].awarded), 0n);
    add("reward buckets = funded", buckets === big(t.funded) ? PASS : FAIL, `buckets ${nearOf(buckets)}, funded ${nearOf(t.funded)}, pending ${nearOf(t.pending)}`);
    const acct = await rpc.account(ids.rewards);
    const owe = big(t.funded) - big(t.withdrawn);
    add("rewards account covers liabilities", big(acct.amount) >= owe ? PASS : FAIL, `balance ${nearOf(acct.amount)} ≥ ${nearOf(owe)}`);
    try {
      const dist = await server("/api/native/distribution");
      add("server distribution audit", dist.status === "verified" && !dist.failed?.length ? PASS : FAIL,
        `status=${dist.status}${dist.failed?.length ? `, failed: ${dist.failed.join(", ")}` : `, ${dist.checks?.length} checks ok`}`);
    } catch (e) {
      add("server distribution audit", WARN, e.message);
    }
    if (!ids.yieldVault) add("yield vault readable", WARN, "no yield vault manifest");
    else {
      const [vcfg, tokens] = await Promise.all([rpc.view(ids.yieldVault, "get_config"), rpc.view(ids.yieldVault, "get_tokens")]);
      add("yield vault readable", PASS,
        `${ids.yieldVault}: ${vcfg.positions} positions, ${tokens.map((x) => `${x.token_id.split(".")[0]} ${x.kind} principal ${x.principal}`).join("; ")}`);
    }
    let mix;
    try {
      mix = await server("/api/treasury/mix");
    } catch (e) {
      add("treasury mix", WARN, e.message);
      return;
    }
    add("treasury mix uses this yield vault", !ids.yieldVault || mix.vault === ids.yieldVault ? PASS : FAIL, `mix vault ${mix.vault}`);
    add("treasury mix readable", PASS,
      `total ${nearOf(mix.total)}: ${(mix.buckets || []).map((b) => `${b.bucket} ${b.currentBps / 100}% (target ${b.targetBps / 100}%, policy ${b.policyBps / 100}%)`).join(", ")}; next: ${mix.next?.action}`);
    const st = (mix.holdings || []).find((h) => h.id === "stnear");
    if (st && mix.account) {
      const bal = await rpc.view(st.token, "ft_balance_of", { account_id: mix.account });
      add("stNEAR wallet on chain ≥ mix", big(bal) >= big(st.wallet) ? PASS : WARN,
        `chain ${short(bal)} stNEAR, mix wallet ${short(st.wallet)}, in vault ${short(st.vault)}, value ${nearOf(st.value)}`);
    }
    const stale = mix.prices?.stale || [];
    add("treasury prices fresh", stale.length ? WARN : PASS,
      stale.length ? `stale: ${stale.map((s) => `${s.id} ${Math.round(s.ageSec / 86400)} d`).join(", ")} (testnet oracle)` : "fresh");
  });

  return rows;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const rows = await runChecks({ args, log: args.json ? () => {} : (s) => console.log(s) });
  if (args.json) console.log(JSON.stringify({ at: new Date().toISOString(), rows, summary: summarize(rows), exit: exitCode(rows) }, null, 2));
  else console.log(renderTable(rows));
  process.exitCode = exitCode(rows);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  main().catch((e) => {
    console.error(e.message || e);
    process.exitCode = 2;
  });
