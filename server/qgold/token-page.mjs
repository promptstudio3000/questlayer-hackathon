// QGOLD token section of the public /economy page (docs/QGOLD-MARKET.md).
// GET /api/economy/qgold. Read-only: backing rate R, supply, backing and its
// composition, buy/sell prices, exit paths and the exit queue, burns, fees,
// the Rhea pool, the keeper's committed sale schedule and the R chart. Before
// the QGOLD vault is deployed it still answers, with status "vault-pending"
// and the rules that will apply, so the page never shows invented numbers.
import { EXPLORER_BASE, NETWORK } from "../native/network.mjs";
import { POLICY, QGOLD_DECIMALS, poolPrice } from "./market-math.mjs";
import { vaultState } from "./keeper.mjs";

export const RHEA_DEX = { testnet: "ref-finance-101.testnet", mainnet: "v2.ref-finance.near" };

const accountUrl = (id) => (id ? `${EXPLORER_BASE}/address/${id}` : null);
const txUrl = (h) => (typeof h === "string" && /^[1-9A-HJ-NP-Za-km-z]{32,64}$/.test(h) ? `${EXPLORER_BASE}/txns/${h}` : null);
const BPS = 10000n;

export const FEE_TABLE = Object.freeze([
  { id: "deposit", label: "Buy from the vault", bps: POLICY.depositFeeBps, to: "treasury" },
  { id: "redeem", label: "Sell to the vault", bps: POLICY.redeemFeeBps, to: "treasury" },
  { id: "p2p", label: "Player-to-player trade (Intents)", bps: 200, to: "treasury" },
  { id: "tasks", label: "Paid tasks and content (poster pays on top)", bps: 1000, to: "treasury" },
  { id: "send", label: "Plain send or conditional escrow send", bps: 0, to: null },
  { id: "play", label: "Earning or spending in the game", bps: 0, to: null },
]);

export function exitPaths(state) {
  const lstLive = Boolean(state?.lsts?.length);
  const cap = state?.exit?.instantCap24h ?? 0n,
    used = state?.exit?.instantUsed24h ?? 0n;
  return [
    {
      id: "near_instant",
      label: "Instant in NEAR",
      available: Boolean(state) && !state.paused,
      note: "Paid now at R − 1 %. Above the daily instant limit the request joins the queue automatically.",
      left24h: state ? (cap > used ? cap - used : 0n).toString() : null,
    },
    {
      id: "lst",
      label: "Instant in stNEAR / LiNEAR",
      available: Boolean(state) && !state.paused && lstLive,
      note: lstLive ? "Your share of the liquid staking tokens, at R − 1 %." : "Not offered yet: testnet staking token prices are frozen.",
    },
    {
      id: "near_queue",
      label: "Queued in NEAR",
      available: Boolean(state) && !state.paused,
      note: "Waits out the safe window, then you claim the NEAR. Nobody can take it in the meantime.",
      safeWindowMs: state?.exit?.safeWindowMs ?? null,
    },
  ];
}

const str = (v) => (v == null ? null : v.toString());

/**
 * @param vaultManifest public/native-qgold-vault-<network>.json or null
 * @param poolManifest  public/native-qgold-pool-<network>.json or null
 * @param vault         NativeContractReader for the vault, or null
 * @param rhea          NativeContractReader for the Rhea exchange, or null
 * @param keeper        QgoldKeeper or null
 */
export function createQgoldPage({ vaultManifest = null, poolManifest = null, vault = null, rhea = null, keeper = null, clock = Date.now, cacheMs = 30_000 }) {
  let cached = null;
  async function build() {
    const now = clock();
    const out = {
      network: NETWORK,
      generatedAt: new Date(now).toISOString(),
      status: vault ? "live" : "vault-pending",
      token: {
        symbol: "QGOLD",
        decimals: QGOLD_DECIMALS,
        contract: vaultManifest?.tokenContract || vaultManifest?.vaultContract || null,
        explorerUrl: accountUrl(vaultManifest?.tokenContract || vaultManifest?.vaultContract),
      },
      rules: {
        initialRate: "1000000000000000000000",
        buyFeeBps: POLICY.depositFeeBps,
        sellFeeBps: POLICY.redeemFeeBps,
        ladder: POLICY.ladderBps.map((b) => b / 10000),
        salesPerDay: POLICY.salesPerDay,
        maxDailySaleSupplyBps: POLICY.maxDailySaleSupplyBps,
        buybackFeeBps: POLICY.buybackFeeBps,
        minPoolNear: (keeper?.settings.policy.minPoolNear ?? POLICY.minPoolNear).toString(),
      },
      fees: FEE_TABLE,
      vault: null,
      exitPaths: exitPaths(null).map((p) => ({ ...p, left24h: null })),
      pool: { status: "none", dex: RHEA_DEX[NETWORK] || null },
      keeper: null,
      chart: [],
    };
    let state = null;
    if (vault) {
      try {
        state = vaultState(await vault.view("get_state"));
        out.vault = {
          contract: vault.contractId,
          explorerUrl: accountUrl(vault.contractId),
          rate: str(state.rate),
          rPeak: str(state.rPeak),
          supply: str(state.supply),
          backing: str(state.backing),
          reserveNear: str(state.reserveNear),
          lsts: state.lsts.map((l) => ({ token: l.token, amount: str(l.amount), nearValue: str(l.near_value) })),
          insurance: str(state.insurance),
          burned: str(state.burned),
          fees: str(state.fees),
          buyPrice: ((state.rate * (BPS + BigInt(POLICY.depositFeeBps))) / BPS).toString(),
          sellPrice: ((state.rate * (BPS - BigInt(POLICY.redeemFeeBps))) / BPS).toString(),
          paused: state.paused,
          pauseUntil: state.pauseUntil,
          exit: {
            instantUsed24h: str(state.exit.instantUsed24h),
            instantCap24h: str(state.exit.instantCap24h),
            accountCap24h: str(state.exit.accountCap24h),
            queuePending: str(state.exit.queuePending),
            queueCount: state.exit.queueCount,
            safeWindowMs: state.exit.safeWindowMs,
          },
          transactions: (vaultManifest?.transactions || []).map((t) => ({ label: t.label, transaction: t.transaction, explorerUrl: txUrl(t.transaction) })),
        };
        out.exitPaths = exitPaths(state).map((p) => ({ ...p, left24h: p.left24h ?? null }));
      } catch (error) {
        out.status = "vault-unreachable";
        out.reason = "The QGOLD vault could not be read right now.";
      }
    }
    if (rhea && poolManifest && Number.isInteger(poolManifest.poolId)) {
      try {
        const raw = await rhea.view("get_pool", { pool_id: poolManifest.poolId });
        const ids = raw?.token_account_ids || [];
        const iN = ids.indexOf(poolManifest.wnear),
          iQ = ids.indexOf(out.token.contract);
        const pool = iN >= 0 && iQ >= 0 ? { near: BigInt(raw.amounts[iN]), qgold: BigInt(raw.amounts[iQ]) } : null;
        const price = pool ? poolPrice(pool) : null;
        out.pool = {
          status: pool ? "live" : "mismatch",
          dex: rhea.contractId,
          poolId: poolManifest.poolId,
          feeBps: Number(raw?.total_fee ?? 0),
          near: str(pool?.near),
          qgold: str(pool?.qgold),
          price: str(price),
          premiumBps: price && state?.rate ? Number(((price - state.rate) * BPS) / state.rate) : null,
          keeperActive: pool ? pool.near >= BigInt(out.rules.minPoolNear) : false,
          explorerUrl: accountUrl(rhea.contractId),
          swapUrl: poolManifest.swapUrl || null,
        };
      } catch {
        out.pool = { status: "unreachable", dex: rhea.contractId, poolId: poolManifest.poolId };
      }
    }
    if (keeper) {
      out.keeper = keeper.publicView(now, state ? { rate: state.rate, supply: state.supply } : {});
      out.chart = keeper.chart(now);
    }
    return out;
  }
  return async function qgoldPage() {
    const now = clock();
    if (cached && cached.until > now) return cached.value;
    const value = await build();
    cached = { until: now + cacheMs, value };
    return value;
  };
}
