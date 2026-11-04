# Zone/map worker continuation — 1 November 2026

Local continuation of cloud checkpoint `cb8ddcd` on `claude/upbeat-gauss-5czir7`.
Scope: CityPack preparation, map diagnostics, retained geometry, durable native-day publication and its read-side checks. Claude's UI, assets, product direction, contracts, relayer, economy rules and deployed configuration are preserved. No deployment or full milestone completion is claimed.

## Delivered

- Map preparation requests six slots and safely returns 0–6 suitable zones. Bad candidate data is rejected independently with operator diagnostics; no replacement site is invented.
- Explicit city registries use each pack's local dates. Old-source/yesterday retries do not occupy the current preparation queue. Expired historical leases can be cleaned up without removing referenced world/native geometry.
- Readiness validates stored body hashes and identities before reporting ready. Public health adds counts/reasons, not future targets or candidate details. GeoJSON previews include coverage and candidate/sector provenance.
- One explicitly selected pack owns the native publisher's ID, timezone and path samples. Plzeň is still the only enabled city; the second-city tests are synthetic fixtures.
- Native publication and retry use the original durable intent. A lost acknowledgement recovers by reading the existing day; a missing local intent requires restoration rather than repricing from remaining funds.
- Publication, current-day audit, visit admission, collection availability and closure compare the exact committed terms and receipt storage. Fewer than six suitable slots stops native v1 publication before a send. Contract code/policy is unchanged.
- Midnight-crossing preparation does not send an expired manifest or erase its intent. Existing receipt-order, lease-takeover and independent maintenance checks still pass.

## Verification

- `npm ci` with Node **24.21.0**, npm **11.19.0**.
- `npm run check`: TypeScript/Vite build and **545/545** application tests, zero failures/skips; see [check.txt](check.txt).
- Focused world/publication/map/template suites: **48/48**, zero failures/skips; see [focused-tests.txt](focused-tests.txt). The complete suite also includes the existing 365-date geometry checks and isolated HTTP journeys.
- Actual `server/prepare-worlds.mjs --once` executed twice against one temporary SQLite database: identical ready results for Plzeň local dates 2026-11-01/02, one attempt each, unchanged treasury, zero materialized worlds and zero coins. A real `--preview 2026-11-02` returned six Polygon features with source/sector metadata and `financialAllocation: none`; see [cli-smoke.json](cli-smoke.json).
- Before/after comparison loaded the original generator/planner/manifest modules from Git checkpoint `cb8ddcd`. For 2026-10-31, 2026-11-02 and 2026-12-31, zone arrays, complete native manifests/hashes and publication arguments matched exactly; see [compatibility.json](compatibility.json).
- No changes under `src/`, `contracts/`, `public/` or `.github/`. No signing keys, production state or live RPC were accessed. Contract tests were not rerun because contracts were outside this delivery.

The initial unprivileged full-suite attempt could not bind local HTTP ports (`EPERM`). The final recorded check ran with local-port access; it did not substitute mocks for the existing HTTP suites. Native-chain interactions in the new tests use fake RPC/transports; they are not new testnet proofs.

## Handoff and remaining boundaries

Use [WORLD-WORKER.md](../../../docs/WORLD-WORKER.md) for the lifecycle and extension interface. No additional city/funding policy is activated. A reduced map plan does not change the deployed contract's six-slot policy. Keep existing funded bodies during source updates and restore them before retrying a host that lost intent.

Still separate: pedestrian graph/routing, field-reviewed public access, physical phones/GPS, multi-host/PostGIS work, full treasury liquidity reconciliation, actual yield/exit proof and any contract changes. The advance-against-future-yield cloud idea is documentation-only; current publication still requires received backing. No UI or real-device verification is claimed for this backend-only continuation.
