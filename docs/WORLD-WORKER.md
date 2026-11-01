# Daily city preparation

Latest continuation: [five map/backend tasks](MAP-BACKEND-CONTINUATION-2026-11-01.md) adds street-data recovery, configured pedestrian graph validation, audited closures, optional viewport reads and a repeatable pilot. Its [566-test report](../output/qa/2026-11-map-backend/README.md) supersedes the suite count in the earlier delivery evidence below; it does not close field or release gates.

QuestLayer prepares today's and tomorrow's Plzeň geography in Europe/Prague time. Preparation is separate from financial world activation. It creates no coins, quests, staking positions, payouts or treasury reservations.

## Lifecycle

1. Startup and a one-minute process timer enqueue one unique job per local date, CityPack source hash and plan version.
2. A SQLite transaction claims a due job with a unique lease token. Expired work can be reclaimed after process failure.
3. The offline CityPack generator requests six separated zones, their three mapped targets, opening windows and exact local-date boundaries. If suitable candidates run out, it prepares 0–6 zones with explicit coverage counts. Invalid candidate data is rejected with a diagnostic reason instead of crashing all other sectors. Spring and autumn clock changes retain their actual 23/25-hour days.
4. Only the current lease may atomically save the immutable blueprint and mark its job ready. A late worker cannot overwrite a reclaimed result.
5. Failed work retries with exponential backoff capped at 30 minutes. Only the selected packs' current and next local-date jobs are eligible; obsolete sources and old failed dates cannot starve the current queue. Normal preparation requires no remote map/RPC request.
6. The first active world request reads the blueprint, or prepares the same deterministic plan synchronously if the worker has not completed it. Before reserving available demo backing, it expires prior worlds and returns their unclaimed rewards once.
7. The existing client date rollover loads the next world. Each pack has its own 14-day preparation-cache cutoff. Blueprints referenced by a materialized world or a durable native day are retained, including their historical display geometry.

The worker runs inside the application process and also supports a standalone once command. SQL leases make multiple processes safe. The process timer is not a guarantee that work runs at an exact wall-clock second; prepared geography and request fallback cover that boundary.

## Operation

- `npm run world:prepare`: prepare the current and next local date in the configured SQLite database; print readiness without future coordinates.
- `npm run world:preview -- YYYY-MM-DD`: print a GeoJSON operator preview with coverage, rejected-candidate reasons, original candidate IDs, sectors and shape families, without opening or changing a database and without allocating money.
- `/api/health`: integrity-checked readiness dates/states, coverage counts, source plan version and demo mode. A corrupt stored blueprint reports failure. Future zone geometry, candidate diagnostics and targets are not exposed by this readiness response.
- An intentionally supplied historical/future clock is a test/helper facility, not a public activation API.

The generator source hash changes when the CityPack changes. Already published worlds retain their original geometry for the rest of their day. New compatible plans are prepared under the new hash. Blueprints carry an integrity hash; invalid stored content fails closed.

`startWorldPlanner(db, { cities, maxJobs, clock })` accepts an explicit bounded registry of unique CityPacks. Plzeň remains the only enabled pack. Registry/timezone tests use a synthetic second pack and do not establish reviewed additional-city geography or funding.

## Native publication boundary

The native worker delegates city-day preparation/publication to `server/native/day-publication.mjs`. `NativeRewards` accepts one explicitly supplied `city` option; the default remains Plzeň. That pack supplies the local dates, public-path samples and day ID. Plzeň retains `plzen-YYYY-MM-DD-v1` and unchanged manifest bytes. No new city is automatically enabled and no global multi-city financial allocation policy is adopted.

The current reward contract requires exactly six slots. A reduced map preparation is useful demo/map coverage, but native publication stops before sending when fewer than six suitable sites exist. Coin backing must also be positive. The contract and its reward/XP/budget policy are unchanged.

Before sending, the worker saves the exact manifest as durable intent. A retry checks that body's ID, local date and hash and reads the existing chain day before deciding whether to publish. It never recomputes an already prepared day's reward from newer funds or a changed CityPack. If the chain has a day but the local intent is missing, restore the original intent; the worker refuses to invent its contents. An unpublished intent that expires during preparation is retained for reconciliation and is not sent after its window ends.

Publication confirmation compares the hash **and** exact windows, coin count/unit, quest rewards/XP/tiers and receipt-storage capacity. Already published current/next days are checked again; closure verifies the same original commitment before and after sending. New visit admission and collection availability use the same verifier. A mismatch cannot be advertised as a usable funded publication. This is a publication audit, not a full treasury/account-liquidity audit or proof of physical presence.

All publication writes/sends retain the existing lease fences. Accepted claims still settle in their original order and existing vault maintenance remains independent of settlement failure. No account, signing key, contract manifest or financial settlement rule was changed by this continuation.

## Deferred cloud funding idea

The cloud discussion proposed paying ahead against future staking yield. This is recorded as a future funding design only. Current publication uses already received reward-bucket liquidity. Estimated/unrealized yield, player principal and retained player yield do not back prizes. Any later advance would need explicit separately funded backing, attribution, repayment/loss policy and contract review owned by the financial lane; no advance, credit balance, new income allocation or automatic repayment is implemented here.

## Evidence and remaining gates

The [1 November local evidence](../output/qa/2026-11-world-worker/README.md) records **545/545** application tests and a passing TypeScript/Vite build. Focused world/publication/map/template tests cover shortfalls down to zero, bad candidates, integrity-aware readiness, multiple explicit timezones, obsolete jobs, retained published geometry, lost publication acknowledgements, missing restore intents, exact chain mismatches and native six-slot compatibility. Existing DST, lease, restart and conservation cases also pass. The real standalone preparation CLI was repeated against an isolated database without creating worlds/coins or changing treasury balances; the GeoJSON preview was inspected structurally.

Selected normal-day Plzeň zone geometry and complete native manifests/publication arguments were compared with cloud checkpoint `cb8ddcd` and remain byte compatible. No UI source, contracts, relayer, deployments or production state were changed; no live RPC/signing operation was used for these checks.

This remains a bounded OSM preview. Graph import/routing, configured-pack reachability/exclusion checks and trusted place-closure operations are now implemented in the continuation above. Adoption of a complete reviewed Plzeň topology/entries, field review, additional polygon families, signed operator publication and a visual operator console remain open. The once/GeoJSON tools do not complete those gates. Native realized-yield budgeting remains W05/W06 work; this worker does not turn demo backing into real yield.
