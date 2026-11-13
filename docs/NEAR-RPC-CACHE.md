# NEAR RPC reads: shared cache and pacing

The server reads contract state (rewards, collectibles, vaults, QGOLD vault, payouts) through public
NEAR JSON-RPC endpoints. On testnet that is fastnear, with `testnet-rpc.intea.rs` and
`near-testnet.drpc.org` as fallbacks (`server/near-provider.mjs`). These are free public endpoints with
rate limits; on 11 Nov 2026 per-player reads tripped fastnear's 429 limit. Running our own NEAR node on
the VPS is not an option (a node needs far more disk than the shared VPS has), so the server spends
fewer requests instead.

`createNearProvider()` wraps the provider with `cachedNearProvider()`:

- **Merged reads.** Equal reads in flight (`call_function`, `view_account`, `view_code`, `view_state`,
  `view_access_key_list`, `viewBlock`, `viewNodeStatus`) share one upstream request.
- **Short reuse.** A read of the final block is reused for `NEAR_RPC_CACHE_MS` (default 3000 ms);
  final state already lags the chain head by about 2 s. Reads pinned to a block id are kept 5 min,
  node status 30 s, the latest block at most 1 s.
- **Transactions clear it.** Any `sendTransaction*`, `txStatus` or `viewTransaction*` through the
  provider drops every cached read before and after, so a read after our own transaction is fresh.
- **Never cached:** `view_access_key` (signer nonces) and anything that is not a read.
- **Pacing.** Upstream reads run at most `NEAR_RPC_RPS` per second (default 8, burst
  `NEAR_RPC_BURST` 16) and `NEAR_RPC_CONCURRENCY` at once (default 6). A restart's warm-up burst is
  spread over a few seconds instead of hitting the RPC at once. Writes are not queued.
- **Back-off on 429.** A rate-limited read pauses all queued reads for `NEAR_RPC_COOLDOWN_MS`
  (default 1500 ms) instead of trying the next endpoint at full speed.
- **Stale on error.** If a read fails (429, timeout, endpoint down) and the same read succeeded within
  `NEAR_RPC_STALE_MS` (default 30 s), that value is returned instead of an error.
- `NativeContractReader` keeps its own 15 s per-contract cache; it now evicts the oldest entry instead of
  clearing all entries once it holds 512.

`provider.rpcCache.stats()` returns upstream calls, cache hits, merged reads, stale answers and 429s.
`createNearProvider(url, { cache: false })` returns the bare provider.
