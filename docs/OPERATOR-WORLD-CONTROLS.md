# Operator world controls (W11)

`scripts/world-operator.mjs` lets a trusted operator with OS access to the
database pause a day or a zone, close or reopen a place, adjust a future day
that is not published yet, and read world and treasury health in one report.
The logic lives in `server/operator/world-controls.mjs`. There is no HTTP
mutation route, the same rule as place closures and note moderation.

```sh
DB=/var/lib/questlayer/questlayer.sqlite   # always explicit
node scripts/world-operator.mjs report --database $DB [--chain]
node scripts/world-operator.mjs audit  --database $DB
node scripts/world-operator.mjs pause            --database $DB --input op.json --apply
node scripts/world-operator.mjs resume           --database $DB --input op.json --apply
node scripts/world-operator.mjs adjust           --database $DB --input op.json   # preview only
node scripts/world-operator.mjs adjust           --database $DB --input op.json --apply
node scripts/world-operator.mjs clear-adjustment --database $DB --input op.json --apply
node scripts/world-operator.mjs close-place      --database $DB --input op.json --apply
node scripts/world-operator.mjs reopen-place     --database $DB --input op.json --apply
```

Every input carries `actor`, `operationId`, `reason` and `expectedVersion`
(from the latest report; 0 for a first change). Re-running the same
operation id returns the first receipt; the same id with other terms is refused.

| Command | Input fields |
| --- | --- |
| pause / resume | `cityId`, `day` (YYYY-MM-DD), `zone` (`null` = whole day, or slot 0-5), `action` `pause`/`resume` |
| adjust / clear-adjustment | `cityId`, `day`, `action` `set`/`clear`, `excludeCandidates` (candidate ids; empty for clear) |
| close-place / reopen-place | `cityId`, `candidateId`, `action` `close`/`reopen` |

Example pause of zone 2 today:

```json
{"actor":"lubos","operationId":"pause-2026-11-02-z2","cityId":"plzen","day":"2026-11-02","zone":2,"action":"pause","reason":"Street festival","expectedVersion":0}
```

## What each control does and does not do

- **Pause** (today or up to 14 days ahead). While paused, the server accepts no
  new coin pickups (day pause) or expedition visits (day or zone pause), for
  demo worlds and native visit attestations alike. Players see the zone as
  closed with `operatorPause.reason`. Stored worlds, published native
  manifests, on-chain commitments, accepted receipts and payouts are not
  changed. Resume restores collection.
- **Adjust** (tomorrow up to 14 days ahead). Swaps out reviewed places for that
  date; the planner then picks other candidates for those slots. The command
  builds the adjusted day first and refuses when any slot would stay empty,
  because a native day needs six zones. Refused once the date has a live world
  or a native manifest (`DAY_PUBLISHED`). Native publication prepares tomorrow
  ahead of time, so on a host with native rewards running, tomorrow may already
  be published; dates further ahead stay adjustable. Tiers, rewards and budgets
  are never touched.
- **Close / reopen place** wraps the existing place-safety operation and also
  writes it to the shared operator audit.
- **Report** is read only: today's worlds (coins and quests claimed), world
  preparation for today and tomorrow, active pauses and adjustments, closed
  places, native day states, the demo treasury buckets and funding, optionally
  the native rewards treasury and paused flag (`--chain`, read through RPC), the
  last 20 audit entries, and a `warnings` list with `status` ok/attention.
