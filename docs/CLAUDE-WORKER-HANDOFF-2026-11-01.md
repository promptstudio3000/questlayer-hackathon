# Claude handoff: zone/map worker

## Latest delivery: five map/backend follow-ups

Continue on `claude/upbeat-gauss-5czir7` from [the implementation handoff](MAP-BACKEND-CONTINUATION-2026-11-01.md). All five follow-ups are implemented: bounded map-data caching/recovery and worker retries, pedestrian graph import/reachability validation, audited place closures, compatible viewport/pagination APIs, and an isolated multi-day recovery pilot. `npm run check` passes **566/566** application tests plus the build; [recorded evidence](../output/qa/2026-11-map-backend/README.md) includes compatibility checks against `e94be6c`.

The source is being handed off through this branch at the owner's request. UI, assets, contracts and financial policy are unchanged; nothing is deployed. The current client still uses its existing map requests and straight-line distances.

## Next: activate reviewed routing in Plzeň

1. Acquire a bounded, complete OSM node/way snapshot with original IDs, referenced nodes and access/barrier tags. `server/data/plzen-v1.json` remains the active geometry-only source; it cannot establish topology. Do not merge coincident coordinates to invent junctions. The bounded live source fetch timed out after 30 seconds; no replacement source was adopted.
2. Review public entries and exclusions for each candidate, retaining target `pathId` references. Do not guess entries or mark map-derived access as field verified. Import the snapshot with `scripts/import-pedestrian-graph.mjs` into a separate graph artifact and attach it to a draft CityPack.
3. Run `npm run world:preview -- DATE --pack draft-city-pack.json`. Inspect entry-to-target reachability, transfers, restrictions and coverage of the six citywide sectors. Report disconnected or incomplete coverage; do not relax restrictions or fabricate paths to fill six slots. Native v1 still requires exactly six slots.
4. Field-check entries, crossings, barriers and public access. Deliberately adopt the reviewed source as a new revision for future, unissued plans. Preserve existing published worlds, day IDs, native manifests, funded intents and accepted receipts; do not rewrite or reprice them.
5. Separately adopt route metadata and optional viewport fields in the existing client when the data establishes them, preserving the accepted UI. Server graph support is ready; a player-facing verified walking route, live Plzeň graph validation and real-device GPS journeys are still outstanding.

Contracts, liquidity/yield reconciliation, funding policy and release/deployment remain Claude's separate lane. The historical notes below describe the earlier worker delivery; implemented follow-ups above should not be rebuilt.

## Earlier delivery: `e94be6c`

1 November 2026. Continue on `claude/upbeat-gauss-5czir7`; this delivery extends your cloud checkpoint `cb8ddcd`. The owner's instruction is to preserve your UI and product direction and leave contracts/financial development with you.

### Ready to reuse

- City preparation safely returns 0–6 suitable zones, isolates malformed candidates and reports rejection/coverage diagnostics in the operator preview.
- Current local-date jobs take precedence over obsolete source/date jobs. Readiness checks stored integrity; retention preserves geometry referenced by existing worlds/native days.
- `server/native/day-publication.mjs` owns publication from one explicit CityPack: its timezone, path samples and stable day ID. Plzeň remains the only enabled city.
- Publication retries recover the original durable intent after a lost response. Missing intent requires restoration. Confirmation, re-audit, visit admission and closure check exact chain terms/storage, not only the hash.
- UI, assets, contracts, relayer, funding rules and deployment configuration are unchanged. Selected normal-day Plzeň geometry and complete native commitments match `cb8ddcd` byte for byte. Native v1 still requires six slots; a reduced map plan cannot bypass it.

### Verified

Node 24; `npm ci`; `npm run check`: **545/545** application tests and build pass. Focused suites: **48/48**. The actual preparation CLI was repeated against isolated SQLite with unchanged treasury and no materialized worlds/coins. Native fault cases use fake RPC; no new live-chain or physical-device proof is claimed. [Evidence](../output/qa/2026-11-world-worker/README.md) · [worker lifecycle/interfaces](WORLD-WORKER.md).

### Gaps recorded at that checkpoint (superseded above for map/backend work)

1. Reviewed pedestrian graph, exclusions and entry/target reachability; field-check public access before treating straight-line distances as walking routes.
2. Financial lane: actual treasury/account-liquidity reconciliation (`reconciled` currently describes ledger conservation), realized-yield/exit proof and an explicit funded allocation policy before enabling additional native cities. This delivery does not implement the cloud's full distribution engine.
3. Keep “advance against future staking yield” proposal-only until separately funded backing, repayment/loss rules and contracts are reviewed. Current publication uses received liquidity.
4. Contract lane: fix CI build ordering for the vault WASM embedded by the factory, and continue the existing contract/integration work. Contracts were not changed or retested here.
5. Separately review deployment/migration, hosted integration and real iOS/Android GPS journeys. Nothing was deployed and no full W01/W06 milestone was closed.
