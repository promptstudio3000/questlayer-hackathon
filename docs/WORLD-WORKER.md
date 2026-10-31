# Daily city preparation

QuestLayer prepares today's and tomorrow's Plzeň geography in Europe/Prague time. Preparation is separate from financial world activation. It creates no coins, quests, staking positions, payouts or treasury reservations.

## Lifecycle

1. Startup and a one-minute process timer enqueue one unique job per local date, CityPack source hash and plan version.
2. A SQLite transaction claims a due job with a unique lease token. Expired work can be reclaimed after process failure.
3. The offline CityPack generator builds six separated zones, their three mapped targets, opening windows and exact local-date boundaries. Spring and autumn clock changes retain their actual 23/25-hour days.
4. Only the current lease may atomically save the immutable blueprint and mark its job ready. A late worker cannot overwrite a reclaimed result.
5. Failed work retries with exponential backoff capped at 30 minutes. Normal preparation requires no remote map/RPC request.
6. The first active world request reads the blueprint, or prepares the same deterministic plan synchronously if the worker has not completed it. Before reserving available demo backing, it expires prior worlds and returns their unclaimed rewards once.
7. The existing client date rollover loads the next world. Published world IDs, receipts and financial history remain independent of the 14-day preparation-cache retention.

The worker runs inside the application process and also supports a standalone once command. SQL leases make multiple processes safe. The process timer is not a guarantee that work runs at an exact wall-clock second; prepared geography and request fallback cover that boundary.

## Operation

- `npm run world:prepare`: prepare the current and next local date in the configured SQLite database; print readiness without future coordinates.
- `npm run world:preview -- YYYY-MM-DD`: print a GeoJSON operator preview without opening or changing a database and without allocating money.
- `/api/health`: readiness dates/states, source plan version and demo mode. Future zone geometry and targets are not exposed by this readiness response.
- An intentionally supplied historical/future clock is a test/helper facility, not a public activation API.

The generator source hash changes when the CityPack changes. Already published worlds retain their original geometry for the rest of their day. New compatible plans are prepared under the new hash. Blueprints carry an integrity hash; invalid stored content fails closed.

## Evidence and remaining gates

`tests/world-planner.test.mjs` verifies DST boundaries, deterministic daily variation, no early money reservation, idempotent scheduling, retry, stale-lease rejection, persisted SQLite restart and immediate midnight rollover conservation. The complete application suite currently has 40 passing tests.

This remains a bounded OSM preview: field review, a complete pedestrian routing graph, access/exclusion masks, additional polygon families, signed operator publication and a visual operator console remain open. The once/GeoJSON tools do not complete those gates. Native realized-yield budgeting remains W05/W06 work; this worker does not turn demo backing into real yield.
