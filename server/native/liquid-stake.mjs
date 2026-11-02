// Liquid staking tokens as a second path to the Staker step (docs/LIQUID-STAKE.md).
// Reads only: it never signs, swaps or holds a token. A player keeps stNEAR or
// LiNEAR in a linked wallet; this module values it at the protocol's own
// on-chain price and counts only the balance that stayed in that wallet for
// the whole hold window. The window replaces the vault's E+2 rule: a token can
// be transferred, so without it the same 2 NEAR could open Staker for many
// accounts one after another. Instead of local samples it reads the balance at
// several past blocks (RPC nodes keep about two days of state), so a visit is
// not needed to start the clock and a transfer anywhere in the window shows up
// at the next checkpoint.
import { assert } from "../domain.mjs";

const YOCTO = 10n ** 24n;
const HOUR = 3600_000;
const ACCOUNT = /^(?=.{2,64}$)(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/;

// Protocol contracts we know and checked (2 Nov 2026). Everything else is ignored.
export const KNOWN_TOKENS = {
  testnet: [
    { id: "stnear", label: "stNEAR (Meta Pool)", contract: "meta-v2.pool.testnet", price: "get_st_near_price", instantExit: "metapool", app: "https://testnet.metapool.app/" },
    { id: "linear", label: "LiNEAR", contract: "linear-protocol.testnet", price: "ft_price", instantExit: null, app: "https://testnet.linearprotocol.org/" },
  ],
  mainnet: [
    { id: "stnear", label: "stNEAR (Meta Pool)", contract: "meta-pool.near", price: "get_st_near_price", instantExit: "metapool", app: "https://www.metapool.app/" },
    { id: "linear", label: "LiNEAR", contract: "linear-protocol.near", price: "ft_price", instantExit: null, app: "https://app.linearprotocol.org/" },
    { id: "rnear", label: "rNEAR (Rhea)", contract: "lst.rhealab.near", price: "ft_price", instantExit: null, app: "https://app.rhea.finance/" },
  ],
};

export function liquidStakeSettings(env = process.env, network = "testnet") {
  const known = KNOWN_TOKENS[network] || [];
  const wanted = String(env.LIQUID_STAKE_TOKENS || (network === "mainnet" ? "" : "stnear,linear"))
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  const holdHours = Math.min(36, Math.max(1, Number(env.LIQUID_HOLD_HOURS) || 24));
  const checkpoints = Math.min(12, Math.max(2, Number(env.LIQUID_HOLD_CHECKPOINTS) || 7));
  return {
    // Off by default; mainnet additionally needs the explicit token list.
    enabled: env.LIQUID_STAKE_ENABLED === "1",
    network,
    holdHours,
    checkpoints,
    cacheMs: 10 * 60_000,
    tokens: known.filter((t) => wanted.includes(t.id)),
  };
}

const u128 = (v, what) => {
  assert(typeof v === "string" && /^(0|[1-9]\d{0,38})$/.test(v), `Invalid ${what}.`, 503);
  return BigInt(v);
};
const toNear = (balance, price) => (balance * price) / YOCTO;

/** Heights for "now" and evenly spaced points back to the start of the hold window. */
export function checkpointHeights({ height, timestampMs }, { height: pastHeight, timestampMs: pastMs }, holdHours, count) {
  assert(height > pastHeight && timestampMs > pastMs, "Block times are not increasing.", 503);
  const msPerBlock = (timestampMs - pastMs) / (height - pastHeight);
  const span = Math.ceil((holdHours * HOUR) / msPerBlock);
  const out = [];
  for (let i = 0; i < count; i++) out.push(height - Math.round((span * i) / (count - 1)));
  return out;
}

/**
 * Pure: what counts. `balances` are token units at each checkpoint, newest
 * first. Mature = the lowest of them (it stayed in the wallet throughout).
 */
export function matureOf(balances) {
  assert(balances.length >= 2, "At least two checkpoints are needed.");
  return balances.reduce((min, b) => (b < min ? b : min), balances[0]);
}

async function view(provider, contract, method, args, blockId) {
  const response = await provider.query({
    request_type: "call_function",
    account_id: contract,
    method_name: method,
    args_base64: Buffer.from(JSON.stringify(args)).toString("base64"),
    ...(blockId == null ? { finality: "final" } : { block_id: blockId }),
  });
  assert(Array.isArray(response.result) && response.result.length <= 200000, "Token view is too large.", 503);
  return JSON.parse(Buffer.from(response.result).toString());
}

// A height can be a skipped block; step back a little.
async function balanceAt(provider, contract, accountId, height) {
  let last;
  for (let h = height, tries = 0; tries < 4; tries++, h--) {
    try {
      return u128(await view(provider, contract, "ft_balance_of", { account_id: accountId }, h), "token balance");
    } catch (error) {
      last = error;
      const text = String(error?.message || error);
      if (/GARBAGE_COLLECTED|garbage/i.test(text)) break;
    }
  }
  const error = new Error("This wallet's earlier balance is not readable right now.");
  error.status = 503;
  error.code = "LIQUID_STAKE_HISTORY";
  error.cause = last;
  throw error;
}

/** Live reading of one account across the allowed tokens. */
export async function readLiquidStake(provider, accountId, settings, { now = Date.now() } = {}) {
  assert(ACCOUNT.test(accountId), "Invalid NEAR account.");
  const head = (await provider.viewBlock({ finality: "final" })).header;
  // Rate from a block about 2 h back, enough for a stable estimate.
  const probe = (await provider.viewBlock({ blockId: Math.max(1, head.height - 10_000) })).header;
  const heights = checkpointHeights(
    { height: head.height, timestampMs: Number(BigInt(head.timestamp_nanosec ?? head.timestamp) / 1_000_000n) },
    { height: probe.height, timestampMs: Number(BigInt(probe.timestamp_nanosec ?? probe.timestamp) / 1_000_000n) },
    settings.holdHours,
    settings.checkpoints,
  );
  heights[0] = head.height;
  const tokens = [];
  for (const t of settings.tokens) {
    const price = u128(await view(provider, t.contract, t.price, {}, head.height), "token price");
    const balances = await Promise.all(heights.map((h) => balanceAt(provider, t.contract, accountId, h)));
    const balance = balances[0];
    const mature = matureOf(balances);
    let instantExitFeeBps = null;
    if (t.instantExit === "metapool" && balance > 0n) {
      try {
        const s = await view(provider, t.contract, "get_contract_state", {}, head.height);
        if (Number.isSafeInteger(s?.nslp_current_discount_basis_points)) instantExitFeeBps = s.nslp_current_discount_basis_points;
      } catch {
        instantExitFeeBps = null;
      }
    }
    tokens.push({
      id: t.id,
      label: t.label,
      contract: t.contract,
      app: t.app,
      balance: balance.toString(),
      matureBalance: mature.toString(),
      price: price.toString(),
      near: toNear(balance, price).toString(),
      matureNear: toNear(mature, price).toString(),
      instantExitFeeBps,
    });
  }
  const sum = (k) => tokens.reduce((a, t) => a + BigInt(t[k]), 0n).toString();
  return {
    accountId,
    network: settings.network,
    observedAt: now,
    blockHeight: head.height,
    holdHours: settings.holdHours,
    checkpoints: heights,
    tokens,
    near: sum("near"),
    matureNear: sum("matureNear"),
    // The not-yet-counted part counts at the latest after a full window, if it stays.
    pendingCountsBy: BigInt(sum("near")) > BigInt(sum("matureNear")) ? now + settings.holdHours * HOUR : null,
  };
}

export function createLiquidStake({ provider, settings, clock = Date.now }) {
  const cache = new Map();
  async function read(accountId) {
    const hit = cache.get(accountId);
    if (hit && clock() - hit.at < settings.cacheMs) return hit.value;
    const value = await readLiquidStake(provider, accountId, settings, { now: clock() });
    cache.set(accountId, { at: clock(), value });
    if (cache.size > 2000) cache.delete(cache.keys().next().value);
    return value;
  }
  return {
    settings,
    read,
    /** All linked accounts of a player; unreadable accounts count as zero. */
    async forPlayer(db, player) {
      const accounts = db
        .prepare("SELECT account_id FROM wallet_links WHERE player_id=? ORDER BY verified_at")
        .all(player)
        .map((r) => r.account_id)
        .slice(0, 3);
      const readings = [];
      let unreadable = 0;
      for (const a of accounts) {
        try {
          readings.push(await read(a));
        } catch {
          unreadable++;
        }
      }
      const matureNear = readings.reduce((s, r) => s + BigInt(r.matureNear), 0n).toString();
      return { enabled: true, holdHours: settings.holdHours, linked: accounts.length, unreadable, matureNear, readings };
    },
  };
}
