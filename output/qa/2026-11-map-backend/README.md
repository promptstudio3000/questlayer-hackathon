# Five map/backend tasks — 1 November 2026

Baseline: `e94be6c`. Source delivery on `claude/upbeat-gauss-5czir7`; Claude's UI and contract direction remain unchanged. Publication of source does not activate routing or deploy the application.

## Recorded checks

- Node 24.21.0; `npm ci` completed without dependency additions.
- `npm run check`: **566/566**, zero failures/skips, TypeScript/Vite build passed ([check.txt](check.txt)). This includes the real isolated HTTP world/page routes and existing 365-date spatial tests.
- [Focused phase logs](focused-tests.txt) cover map recovery/cache bounds, OSM topology and restrictions, operator authority/versioning/replay, paginated queries, native admission and the multi-day pilot. They precede the final combined check, which is authoritative for the delivered source.
- The standalone `world:pilot` command produced [pilot.json](pilot.json). Its source always creates temporary state; it does not accept a production database or network/credential configuration. It uses actual service/database logic, synthetic GPS and a labelled native RPC test double.
- [Compatibility comparison](compatibility.json) loads original modules from `e94be6c` and verifies unchanged normal-day Plzeň zone arrays, complete native manifests and publication arguments on three dates. The active CityPack file and UI assets are unchanged.
- Operator and graph-import CLI commands were invoked against temporary fixtures. Custom-pack preview is read-only and does not activate a CityPack.
- A bounded live OSM source-fetch attempt hit its 30-second timeout. No live graph proof, new reviewed Plzeň snapshot or field access certification is claimed. Node/way fixtures exercise graph/planner integration; the active Plzeň pack stays unchanged.

## Results by task

1. Unavailable map data yields an empty usable world; concurrent or background recovery creates one finite coin set without duplicate funding. Stale data retains its observation age. Late replies cannot revive expired allocations.
2. Original OSM node identity controls connectivity; coordinate-overlaid bridges stay disconnected. Access restrictions, barriers, one-way foot travel, exclusion masks and unreachable candidate targets are tested.
3. Trusted CLI closures have durable receipts, optimistic versions and history. New visits are blocked, historical results/pending settlements survive, and old published geography remains immutable. The optional schema reopens under the normal compatibility guard.
4. Bounded viewport/page reads preserve IDs, eligibility/count semantics and balances. Cursor/world/viewport mismatch and invalid coordinates are rejected; concurrent claims do not repeat page IDs.
5. The three-day pilot includes DST, lease takeover, competition, result/equip replay, closure/reopen, lost chain reply and a consistent SQLite snapshot/reopen. Six accepted native receipts require six claim sends and preserve conservation.

No files under `src/`, `contracts/` or `public/` were changed. No player/service keys, production state or live game RPC were accessed. The only live network attempt was read-only public OSM data. No deployment or real-device testing occurred. Remaining activation/field/contract gates are documented in the [implementation handoff](../../../docs/MAP-BACKEND-CONTINUATION-2026-11-01.md).
