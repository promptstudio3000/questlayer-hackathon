// NEAR → EUR reference price for "Stake 2 NEAR (~5 €)" labels only. It never
// prices a trade, a payout or a fee. Sources, first match wins:
//   NEAR_PRICE_EUR=4.2        a fixed operator value
//   NEAR_PRICE_FEED=off       no price: labels show NEAR only
//   (default)                 CoinGecko simple price, cached for an hour,
//                             fetched in the background; null until it answers
const FEED = "https://api.coingecko.com/api/v3/simple/price?ids=near&vs_currencies=eur";
const TTL_MS = 60 * 60_000;
const RETRY_MS = 10 * 60_000;

export function createNearPrice({ env = process.env, fetchImpl = globalThis.fetch, clock = Date.now } = {}) {
  const fixed = Number(env.NEAR_PRICE_EUR);
  if (fixed > 0 && fixed < 10_000) return { eur: () => fixed, refresh: async () => fixed, source: "env" };
  if (env.NEAR_PRICE_FEED === "off" || typeof fetchImpl !== "function") return { eur: () => null, refresh: async () => null, source: "off" };
  let value = null,
    at = 0,
    tried = 0,
    inflight = null;
  async function refresh() {
    if (inflight) return inflight;
    tried = clock();
    inflight = (async () => {
      try {
        const res = await fetchImpl(FEED, { signal: AbortSignal.timeout(3000), headers: { accept: "application/json" } });
        if (!res.ok) return value;
        const n = Number((await res.json())?.near?.eur);
        if (n > 0 && n < 10_000) {
          value = n;
          at = clock();
        }
      } catch {
        /* Keep the last value; labels fall back to NEAR only. */
      } finally {
        inflight = null;
      }
      return value;
    })();
    return inflight;
  }
  /** Cached value (or null), refreshing in the background when stale. */
  function eur() {
    const now = clock();
    if (now - at > TTL_MS && now - tried > RETRY_MS) void refresh();
    return value != null && now - at <= 6 * TTL_MS ? value : null;
  }
  return { eur, refresh, source: "coingecko" };
}
