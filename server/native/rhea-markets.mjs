// Rhea Lend (formerly Burrow) markets for the yield vault (docs/YIELD-VAULT-PLAN.md).
// Reads only: supply APR, supplied, borrowed and utilization per allowlisted
// token. A market at or above the utilization cap is "full": withdrawals there
// can wait on borrowers repaying, so the game does not offer it.
import { assert } from "../domain.mjs";

export const RHEA_LEND = {
  testnet: {
    contract: "contract.burrow.testnet",
    tokens: [
      { id: "usdc", label: "USDC (test)", token: "usdc.fakes.testnet", kind: "stable" },
      { id: "usdt", label: "USDT (test)", token: "usdt.fakes.testnet", kind: "stable" },
      { id: "wnear", label: "wNEAR", token: "wrap.testnet", kind: "near" },
      { id: "linear", label: "LiNEAR", token: "linear-protocol.testnet", kind: "lst" },
    ],
  },
  mainnet: {
    contract: "contract.main.burrow.near",
    tokens: [
      { id: "usdc", label: "USDC", token: "17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1", kind: "stable" },
      { id: "usdt", label: "USDt", token: "usdt.tether-token.near", kind: "stable" },
      { id: "wnear", label: "wNEAR", token: "wrap.near", kind: "near" },
      { id: "eth", label: "ETH", token: "eth.bridge.near", kind: "major" },
      { id: "wbtc", label: "WBTC", token: "2260fac5e5542a773aa44fbcfedf7c193bc2c599.factory.bridge.near", kind: "major" },
      { id: "nbtc", label: "nBTC", token: "nbtc.bridge.near", kind: "major" },
    ],
  },
};

export function rheaSettings(env = process.env, network = "testnet") {
  const cfg = RHEA_LEND[network];
  const cap = Number(env.RHEA_MAX_UTILIZATION);
  return {
    enabled: env.RHEA_MARKETS_ENABLED !== "0" && !!cfg,
    network,
    contract: cfg?.contract || null,
    tokens: cfg?.tokens || [],
    // Percent; a market at or above it is not offered.
    maxUtilization: cap > 0 && cap <= 100 ? cap : 95,
    cacheMs: 5 * 60_000,
  };
}

const big = (v) => {
  try {
    return BigInt(String(v ?? "0"));
  } catch {
    return 0n;
  }
};

/** Pure: one market row from a get_assets_paged_detailed entry. */
export function marketRow(def, asset, maxUtilization) {
  const supplied = big(asset?.supplied?.balance),
    borrowed = big(asset?.borrowed?.balance);
  // Basis points of supply that is lent out, exact in integers.
  const utilizationBps = supplied > 0n ? Number((borrowed * 10000n) / supplied) : 0;
  const apr = Number(asset?.supply_apr);
  const free = supplied > borrowed ? supplied - borrowed : 0n;
  const canDeposit = asset?.config?.can_deposit !== false;
  const full = utilizationBps >= maxUtilization * 100;
  return {
    id: def.id,
    label: def.label,
    token: def.token,
    kind: def.kind,
    supplyAprPercent: Number.isFinite(apr) ? Math.round(apr * 10000) / 100 : null,
    utilizationPercent: utilizationBps / 100,
    // Inner units (token decimals + Rhea extra decimals); ratios only.
    supplied: supplied.toString(),
    borrowed: borrowed.toString(),
    freeLiquidity: free.toString(),
    extraDecimals: asset?.config?.extra_decimals ?? 0,
    full,
    offered: !!asset && canDeposit && !full,
    reason: !asset ? "not listed" : !canDeposit ? "deposits closed" : full ? `pool ${utilizationBps / 100} % lent out` : null,
  };
}

export async function readRheaMarkets(provider, settings, { now = Date.now() } = {}) {
  assert(settings.contract, "Rhea Lend is not known on this network.", 503);
  const response = await provider.query({
    request_type: "call_function",
    finality: "final",
    account_id: settings.contract,
    method_name: "get_assets_paged_detailed",
    args_base64: Buffer.from(JSON.stringify({ from_index: 0, limit: 100 })).toString("base64"),
  });
  assert(Array.isArray(response.result) && response.result.length <= 2_000_000, "Rhea view is too large.", 503);
  const assets = JSON.parse(Buffer.from(response.result).toString());
  assert(Array.isArray(assets), "Unexpected Rhea view.", 503);
  const byToken = new Map(assets.map((a) => [a.token_id, a]));
  const markets = settings.tokens.map((def) => marketRow(def, byToken.get(def.token), settings.maxUtilization));
  markets.sort((a, b) => Number(b.offered) - Number(a.offered) || (b.supplyAprPercent ?? -1) - (a.supplyAprPercent ?? -1));
  return {
    network: settings.network,
    contract: settings.contract,
    observedAt: now,
    blockHeight: response.block_height,
    maxUtilizationPercent: settings.maxUtilization,
    note: "Variable rates without booster rewards. Read-only; the game does not deposit for you here.",
    markets,
  };
}

export function createRheaMarkets({ provider, settings, clock = Date.now }) {
  let hit = null;
  return {
    settings,
    async read() {
      if (hit && clock() - hit.at < settings.cacheMs) return hit.value;
      const value = await readRheaMarkets(provider, settings, { now: clock() });
      hit = { at: clock(), value };
      return value;
    },
  };
}
