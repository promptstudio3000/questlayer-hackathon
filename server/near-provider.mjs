import { JsonRpcProvider, FailoverRpcProvider } from "near-api-js";
// Current public testnet endpoints: https://docs.near.org/api/rpc/providers
export const TESTNET_RPC = "https://test.rpc.fastnear.com";
export const TESTNET_FALLBACK_RPCS = [
  "https://testnet-rpc.intea.rs",
  // fastnear rate-limits the VPS under load (11 Nov 2026), so a third
  // endpoint keeps reads working; all answer the same JSON-RPC.
  "https://near-testnet.drpc.org",
];
export function createNearProvider(url = TESTNET_RPC, options = {}) {
  const urls = url === TESTNET_RPC ? [TESTNET_RPC, ...TESTNET_FALLBACK_RPCS] : [url];
  const providers = urls.map(
    (url) =>
      new JsonRpcProvider({ url }, { retries: 2, wait: 250, backoff: 1.5 }),
  );
  const base =
    providers.length === 1 ? providers[0] : new FailoverRpcProvider(providers);
  return options.cache === false ? base : cachedNearProvider(base, options);
}

// Read requests worth sharing between callers. view_access_key is left out on
// purpose: it carries the nonce a signer needs right now.
const CACHED_QUERIES = new Set([
  "call_function",
  "view_account",
  "view_code",
  "view_state",
  "view_access_key_list",
]);
// Anything that sends or looks up a transaction means chain state may have
// just changed, so cached reads are dropped (docs/NEAR-RPC-CACHE.md).
const TX_METHODS = new Set([
  "sendTransaction",
  "sendTransactionAsync",
  "sendTransactionUntil",
  "txStatus",
  "viewTransactionStatus",
  "viewTransactionStatusWithReceipts",
  "viewTransactionReceipt",
]);
const numberSetting = (value, fallback) => {
  const n = Number(value);
  return value !== undefined && value !== "" && Number.isFinite(n) && n >= 0
    ? n
    : fallback;
};
export function rpcCacheSettings(env = process.env) {
  return {
    // How long a read of the final block is reused. Final state lags the
    // chain head by ~2 s anyway; transactions through this provider clear it.
    ttlMs: numberSetting(env.NEAR_RPC_CACHE_MS, 3000),
    // Reads pinned to a block id never change.
    blockTtlMs: 5 * 60_000,
    // On an RPC failure (429, timeout) a value this recent is served instead.
    staleMs: numberSetting(env.NEAR_RPC_STALE_MS, 30_000),
    maxEntries: numberSetting(env.NEAR_RPC_CACHE_ENTRIES, 2000),
    // Upstream read pacing: at most this many reads per second (with a short
    // burst) and in flight, so a restart's warm-up burst is spread out.
    rps: numberSetting(env.NEAR_RPC_RPS, 8),
    burst: numberSetting(env.NEAR_RPC_BURST, 16),
    concurrency: numberSetting(env.NEAR_RPC_CONCURRENCY, 6),
    // After a 429 every read waits this long before the next upstream call.
    cooldownMs: numberSetting(env.NEAR_RPC_COOLDOWN_MS, 1500),
  };
}

export function isRateLimited(error) {
  return /\b429\b|too many requests|rate.?limit/i.test(rpcErrorText(error));
}

/**
 * Wraps a near-api-js provider so the whole server shares chain reads: equal
 * reads in flight are merged, recent results are reused for a few seconds,
 * upstream reads are paced, and a 429 makes reads back off instead of
 * hammering the next endpoint. Writes and nonce reads pass straight through.
 */
export function cachedNearProvider(provider, options = {}) {
  const s = { ...rpcCacheSettings(options.env), ...options };
  const now = s.clock || Date.now;
  const cache = new Map(); // key -> {value, at, until}
  const pending = new Map(); // key -> {promise, generation}
  const queue = [];
  let generation = 0,
    active = 0,
    tokens = s.burst || 1,
    refilledAt = now(),
    pausedUntil = 0,
    timer = null;
  const stats = { upstream: 0, hits: 0, merged: 0, stale: 0, rateLimited: 0, errors: 0 };

  function remember(key, entry) {
    cache.delete(key);
    cache.set(key, entry);
    while (cache.size > s.maxEntries) cache.delete(cache.keys().next().value);
  }
  function invalidate() {
    generation += 1;
    cache.clear();
  }
  function refill() {
    const t = now();
    if (s.rps > 0) {
      tokens = Math.min(s.burst || 1, tokens + ((t - refilledAt) / 1000) * s.rps);
    } else tokens = Infinity;
    refilledAt = t;
  }
  function pump() {
    timer = null;
    while (queue.length) {
      const t = now();
      if (t < pausedUntil) return schedule(pausedUntil - t);
      if (s.concurrency > 0 && active >= s.concurrency) return;
      refill();
      if (tokens < 1) return schedule(Math.ceil(((1 - tokens) / s.rps) * 1000));
      tokens -= 1;
      const job = queue.shift();
      active += 1;
      stats.upstream += 1;
      Promise.resolve()
        .then(job.run)
        .then(job.resolve, (error) => {
          if (isRateLimited(error)) {
            stats.rateLimited += 1;
            pausedUntil = Math.max(pausedUntil, now() + s.cooldownMs);
          }
          job.reject(error);
        })
        .finally(() => {
          active -= 1;
          pump();
        });
    }
  }
  function schedule(ms) {
    if (timer) return;
    // Kept referenced: it only exists while reads wait, and a one-off script
    // must not exit with a read still queued.
    timer = setTimeout(pump, Math.max(1, ms));
  }
  function paced(run) {
    return new Promise((resolve, reject) => {
      queue.push({ run, resolve, reject });
      if (!timer) pump();
    });
  }
  function read(key, ttlMs, run) {
    const t = now(),
      hit = cache.get(key);
    if (hit && hit.until > t) {
      stats.hits += 1;
      return Promise.resolve(hit.value);
    }
    const inFlight = pending.get(key);
    if (inFlight) {
      stats.merged += 1;
      return inFlight.promise;
    }
    const startedIn = generation;
    const promise = paced(run).then(
      (value) => {
        if (generation === startedIn && ttlMs > 0)
          remember(key, { value, at: now(), until: now() + ttlMs });
        return value;
      },
      (error) => {
        stats.errors += 1;
        const old = cache.get(key);
        if (old && now() - old.at <= s.staleMs) {
          stats.stale += 1;
          return old.value;
        }
        throw error;
      },
    );
    const entry = { promise };
    pending.set(key, entry);
    promise.then(
      () => pending.get(key) === entry && pending.delete(key),
      () => pending.get(key) === entry && pending.delete(key),
    );
    return promise;
  }

  const overrides = {
    query(...args) {
      const params = args[0];
      if (
        args.length !== 1 ||
        !params ||
        typeof params !== "object" ||
        !CACHED_QUERIES.has(params.request_type)
      )
        return provider.query(...args);
      const pinned = params.block_id !== undefined && params.block_id !== null;
      return read(
        "q:" + JSON.stringify(params),
        pinned ? s.blockTtlMs : s.ttlMs,
        () => provider.query(params),
      );
    },
    viewBlock(blockQuery) {
      const pinned = blockQuery && blockQuery.blockId !== undefined;
      return read(
        "b:" + JSON.stringify(blockQuery ?? null),
        pinned ? s.blockTtlMs : Math.min(s.ttlMs, 1000),
        () => provider.viewBlock(blockQuery),
      );
    },
    viewNodeStatus() {
      return read("status", 30_000, () => provider.viewNodeStatus());
    },
  };
  const bound = new Map();
  return new Proxy(provider, {
    get(target, prop) {
      if (prop === "rpcCache")
        return { stats: () => ({ ...stats, entries: cache.size, queued: queue.length }), invalidate };
      if (Object.hasOwn(overrides, prop)) return overrides[prop];
      const value = Reflect.get(target, prop, target);
      if (typeof value !== "function") return value;
      if (!bound.has(prop))
        bound.set(
          prop,
          TX_METHODS.has(prop)
            ? (...args) => {
                invalidate();
                return Promise.resolve(value.apply(target, args)).finally(invalidate);
              }
            : value.bind(target),
        );
      return bound.get(prop);
    },
  });
}

export function rpcErrorText(error) {
  const seen = new Set(),
    parts = [];
  function visit(value) {
    if (!value || seen.has(value) || seen.size >= 12) return;
    seen.add(value);
    parts.push(String(value.message || value));
    if (Array.isArray(value.errors)) value.errors.forEach(visit);
    if (value.cause) visit(value.cause);
  }
  visit(error);
  return parts.join(" | ");
}
