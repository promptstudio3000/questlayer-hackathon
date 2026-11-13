# Map rewards: coins and zones across the whole map

QGOLD build plan, stream 5 (approved by Lubos on 4 Nov 2026). Code: `server/map-rewards/`,
client overlay `src/map-rewards-layer.ts`, tests `tests/map-rewards.test.mjs`.
Policy id: `map-rewards-v1` (`server/map-rewards/policy.mjs`). Numbers are tuning values; a change bumps the
policy id so a published day never changes meaning.

Since policy `map-rewards-v2` (5 Nov 2026, Lubos) there is no practice money on the map: **every coin is
backed QGOLD and all coins of a day are worth the same**. Since 10 Nov 2026 the city demo (demo arena) pays the same backed coins, and cells outside the
plan (outside Czechia) get no coins. Plzeň's native NEAR days (`server/native/`) are unchanged.

## 1. One plan per day for all of Czechia

At the first request of a local day (Europe/Prague) the server builds the day plan once and stores it
(`map_reward_days`, `map_reward_cells`):

- **Cells:** every H3 res-7 cell of Czechia (16,346 cells, coarse border outline in `czechia.mjs`).
- **Budget** (`server/map-rewards/budget.mjs`): the map's share of the rewards contract's per-date cap
  (half of it, within what city days left; the cap grows with treasury funding), priced in micro-QGOLD at the
  vault's backing rate R. The reward worker records both from chain (`map_budget`); until it has, the testnet
  defaults apply: 0.05 NEAR for coins, 0.05 NEAR for zones, R = 0.001 NEAR (`MAP_COIN_DAY_YOCTO`,
  `MAP_ZONE_DAY_YOCTO`, `QGOLD_RATE_YOCTO`). The game database's `treasury` table is not used by the map.
- **Yield only (13 Nov 2026).** With `NATIVE_YIELD_BACKED_DAYS=1` the worker records the lower of the chain
  cap and the yield drip (one seventh of the free realized staking yield, split 50/50 into coins and zones;
  `source: "realized_yield"`, zero when there is none). City days and map days share that yield:
  `mapYieldCommitted` (payout items since the first yield-backed map day plus today's whole budget) is
  subtracted before a city day takes its drip.
- **Coins: few and worth something** (owner, 13 Nov 2026: about 10 coins per city, more in Plzeň). One coin =
  coin budget ÷ `MAP_COIN_TARGET` (default 200), rounded down to whole micro-QGOLD, the same for every coin of
  the day (`summary.coinValueU`). An opened street cell places 10 coins (`CELL_COINS`), the Plzeň city demo
  50 (`ARENA_COINS`), and placement stops once the day's whole coin budget is placed (`coinRoom`, inside the
  placement transaction, pioneer doubles included), so every coin on the map is covered. Example: 0.0005 NEAR
  of yield at R = 1 microNEAR is 500 QGOLD, 2.5 QGOLD a coin.
- **Zones: formula.** The zone budget is split per cell:

| Part | Share | Score |
| --- | --- | --- |
| votes | up to 50 % | QGOLD votes (stream 7). No voters yet: its share goes to the other parts. |
| demand | 20 % | distinct players who collected in the cell, last 7 days |
| random | 15 % | 3 % of cells, picked from the day seed |
| potential | 10 % | 1 + √(checked public places in the cell, from the POI file) |
| stake | 5 % | distinct stakers who collected in the cell, last 30 days |

- **Zone caps:** at most 1 % of the zone budget per cell and 25 % per res-5 area. What a capped cell cannot
  take is offered to the others; the rest stays in the treasury.
- **Merkle root:** one leaf per funded cell,
  `sha256("qlmap1|policy|day|cell|coinsU|zonesU|zones|pioneer|cellSeed")`, sorted by cell, same tree as the
  chain ledger (`server/chain-ledger/merkle.mjs`). `GET /api/map/rewards/day` shows the root;
  `GET /api/map/rewards/proof?cell=` returns the leaf and its proof. The rewards contract
  verifies it on chain (see "On chain" below).

## 2. A cell's drop

When the first player opens a cell (GPS world, city world or the demo arena), `materializeCellRewards`
writes its rewards once (`map_cell_drops`):

1. **Zones per cell (1–3):** 1, plus one at 30 and one at 150 checked places. The chosen POI quests of the
   cell become funded *cell zones* (gold, 70 m) with the cell's zone budget as the first-finisher prize.
   Plzeň keeps its six reviewed city zones and gets no POI cell zones; instead its reviewed zones in the cell
   (Tier 3 first, up to the cell's zone count) share the cell's zone budget as their first-finisher prize
   (owner, 13 Nov 2026: every prize is paid out on chain). Only the first world to open the cell that day
   funds them, so the GPS city and the demo never spend it twice. With map rewards on, the game treasury
   funds no zone prize. Big cities (Praha, Brno, …) scale by their
   cells instead of six zones per city.
2. **Coins:** Poisson-disc spots on mapped public paths, 95–120 m apart, 60 m within 300 m of a zone
   (3× denser), never two coins closer than 60 m, at most the cell's 10 (50 in the city demo). Every coin has the day's one value;
   a pioneer coin (drawn as "medium") counts two shares.
3. **Waves:** each coin belongs to one of six waves between 07:00 and 22:00 local, each start moved by up
   to ±30 min from the day seed. A later wave's coins are hidden and cannot be claimed (`WAVE_NOT_OPEN`).
   The demo arena has no waves (remote visitors in any time zone). `MAP_COIN_WAVES=1..12|off`.
4. **Pioneer:** a cell nobody visited for 30 days (`map_cell_visits`) shows gold fog. Its first drop of the
   day pays two shares per coin and adds a pioneer chest (XP, Aura while edition supply lasts).
5. The demo arena (no GPS, arrow keys) places a fixed number of coins per cell at the same backed value as the map; payout rounds pay them in QGOLD (Lubos, 10 Nov 2026: the demo behaves like reality, only movement differs). Outside Czechia a cell gets no coins until more
   countries have a plan; its POI quests still give XP.

## 3. On the map

`GET /api/map/rewards?bbox=w,s,e,n&res=4..7` returns today's cells in view: coins left (planned before a
drop), value, zones, pioneer and opened. The client overlay draws a heatmap of H3 cells (purple to gold),
gold fog on pioneer cells and a coin count label per cell ("12 coins · 0.35 G"); zoomed out the cells are
summed into res 6/5/4 parents. At street zoom the real coins take over. Medium and rare coins are drawn
bigger. The sky chip shows the time of the next coin wave.

## 4. Switches

- `MAP_REWARDS=off`: new worlds use the old per-world coin seeding.
- `MAP_COIN_WAVES` (1–12, `off` = all at once).
- `MAP_REWARDS_SEED`: secret mixed into the day seed.
- `MAP_CHAIN=1` (off by default): the reward worker also publishes each day's root with
  `publish_map_day`, sends the coins and cell-zone prizes that players with a linked NEAR wallet
  collected in GPS worlds as `claim_map` (leaf fields, proof, coin or zone index, attestor signature;
  at most 240 a day), and closes the day after one day of grace (`server/map-rewards/chain.mjs`).
  It needs the rewards upgrade with `map_days.rs` and a worker key that allows the three map
  methods next to the four native ones. The demo arena never sends `claim_map`; its coins are paid by payout rounds. Status:
  `chain` in `GET /api/map/rewards/day`. Every published day (city or map) holds 256 receipt slots
  (about 2.6 NEAR of storage) until it closes, so the contract needs about five days of separate storage
  reserve; `node scripts/topup-rewards-storage.mjs [--send]` tops it up from the operator. Without it
  `publish_map_day` traps ("Top up separate storage and gas funding before publication").
- `MAP_PAYOUTS=1`: map coins and cell zones (GPS and the city demo) are paid by payout rounds every few minutes (docs/DAILY-PAYOUTS.md), one
  leaf per account per day, and `claim_map` is no longer sent (the map day worker only records the budget).
- **Caps grow with the treasury.** The rewards contract caps each date at max(0.1 NEAR, 10 % of each
  bucket's funding) (`date_cap`). City days together take at most max(0.006 NEAR, 4 % of a bucket's
  funding) (`scaledBucketCap`), and a map day at most half of the date cap, within what the city days
  left (`mapDayCaps`). With 0.2 NEAR funded nothing changes; with 1,000 NEAR a date may commit 50 NEAR
  per bucket: 20 to cities, 25 to the map.

Worlds created before the deploy keep their coins until midnight; the next day uses map rewards.

## 5. On chain (contracts/rewards `map_days.rs`)

- `publish_map_day({day_id: "map-YYYY-MM-DD-v<n>", policy, root, starts_at, ends_at, coins_u, zones_u,
  yocto_per_u})`: publisher only. It reserves `coins_u × yocto_per_u` and `zones_u × yocto_per_u` NEAR from
  the coin and zone treasury. The same per-date cap applies across cities and the map (0.1 NEAR each on
  testnet), together with the receipt storage reservation. `coins_u` includes the pioneer cells' second share.
- `claim_map({claim, signature})`: the attestor signs `map_claim_message(claim)`. A claim carries the leaf
  fields (`cell, coins_u, zones_u, zones, pioneer, seed`), the `proof`, `kind` ("coin" or "zone"),
  `index` and `value_u`. The contract:
  - rebuilds the leaf and checks it against the root;
  - pays a coin once per index, at most 2 GOLD (a rare coin: 10 × the 0.2 GOLD unit cap), while the cell's coins last (`coins_u`, twice that on a
    pioneer cell);
  - pays each zone index (`< zones`) once, while `zones_u` lasts;
  - never pays more than the day reserved.
  Credits are withdrawn like every reward: into the QGOLD vault, minted at R (docs/QGOLD-VAULT.md).
- `close_map_day(day_id)`: after a one-day grace period, returns the unclaimed budget to the available
  treasury.
- Views: `get_map_day(day_id)` and `get_map_cell(day_id, cell)`.

## Outside Czechia (11 Nov 2026)

The day plan covers the 16,346 Czech cells. A street cell anywhere else gets
backed coins too (`worldCoinCount` in `server/map-rewards/service.mjs`): up to
`CELL_COINS` (10) coins of the day's coin value, drawn from the same day coin
budget as Czech cells (`summary.unplacedU.coins`, `coinRoom`) until it is placed. The drop is
recorded in `map_cell_drops` under the day, so the payout rounds pay it at
that day's rate. It needs `MAP_PAYOUTS=1` (abroad cells have no Merkle leaf for
`claim_map`); `MAP_WORLD_COINS=off` turns it off. No funded cell zones and no
pioneer bonus outside Czechia.
