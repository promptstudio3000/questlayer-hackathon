# Map rewards: coins and zones across the whole map

QGOLD build plan, stream 5 (approved by Lubos on 4 Nov 2026). Code: `server/map-rewards/`,
client overlay `src/map-rewards-layer.ts`, tests `tests/map-rewards.test.mjs`.
Policy id: `map-rewards-v1` (`server/map-rewards/policy.mjs`). Numbers are tuning values; a change bumps the
policy id so a published day never changes meaning.

Everything here is **practice GOLD** until the QGOLD vault (stream 1) can mint real QGOLD for a claim.
Plzeň's native NEAR days (`server/native/`) are unchanged.

## 1. One plan per day for all of Czechia

At the first request of a local day (Europe/Prague) the server builds the day plan once and stores it
(`map_reward_days`, `map_reward_cells`):

- **Cells:** every H3 res-7 cell of Czechia (16,346 cells, coarse border outline in `czechia.mjs`).
- **Budget:** 10 % of the available coin treasury and 4 % of the zone treasury (`MAP_DAILY_SHARE_BPS`,
  `MAP_ZONE_SHARE_BPS`). Only cells a player opens reserve money, so the plan never drains the treasury;
  everything else stays for the next days.
- **Pioneer reserve:** 5 % off the top.
- **Formula** for the rest, per cell:

| Part | Share | Score |
| --- | --- | --- |
| votes | up to 50 % | QGOLD votes (stream 7). No voters yet: its share goes to the other parts. |
| demand | 20 % | distinct players who collected in the cell, last 7 days |
| random | 15 % | 3 % of cells, picked from the day seed |
| potential | 10 % | 1 + √(checked public places in the cell, from the POI file) |
| stake | 5 % | distinct stakers who collected in the cell, last 30 days |

- **Caps:** at most 1 % of the day per cell and 25 % per res-5 area. What a capped cell cannot take is
  offered to the others; the rest stays in the treasury.
- **Merkle root:** one leaf per funded cell,
  `sha256("qlmap1|policy|day|cell|coinsU|zonesU|zones|pioneer|cellSeed")`, sorted by cell, same tree as the
  chain ledger (`server/chain-ledger/merkle.mjs`). `GET /api/map/rewards/day` shows the root;
  `GET /api/map/rewards/proof?cell=` returns the leaf and its proof. Publishing the root on chain and
  checking the proof on a claim waits for the rewards/vault change of stream 1.

## 2. A cell's drop

When the first player opens a cell (GPS world, city world or the demo arena), `materializeCellRewards`
writes its rewards once (`map_cell_drops`):

1. **Zones per cell (1–3):** 1, plus one at 30 and one at 150 checked places. The chosen POI quests of the
   cell become funded *cell zones* (gold, 70 m) with the cell's zone budget as the first-finisher prize.
   Plzeň keeps its six reviewed city zones and gets no cell zones. Big cities (Praha, Brno, …) scale by their
   cells instead of six zones per city.
2. **Coins:** Poisson-disc spots on mapped public paths, 95–120 m apart, 60 m within 300 m of a zone
   (3× denser), never two coins closer than 60 m. Values are small ×1, medium ×3 and rare ×10 of one unit
   (rare more often near zones); the unit is at least 0.01 and at most 0.2 GOLD, and money that would need
   bigger coins stays in the treasury.
3. **Waves:** each coin belongs to one of six waves between 07:00 and 22:00 local, each start moved by up
   to ±30 min from the day seed. A later wave's coins are hidden and cannot be claimed (`WAVE_NOT_OPEN`).
   The demo arena has no waves (remote visitors in any time zone). `MAP_COIN_WAVES=1..12|off`.
4. **Pioneer:** a cell nobody visited for 30 days (`map_cell_visits`) shows gold fog. Its first drop of the
   day doubles the coins from the pioneer reserve and adds a pioneer chest (XP, Aura while edition supply
   lasts).
5. Outside Czechia a cell gets a small fixed practice budget (0.5 GOLD) until more countries have a plan.

## 3. On the map

`GET /api/map/rewards?bbox=w,s,e,n&res=4..7` returns today's cells in view: coins left (planned before a
drop), value, zones, pioneer and opened. The client overlay draws a heatmap of H3 cells (purple to gold),
gold fog on pioneer cells and a coin count label per cell ("12 coins · 0.35 G"); zoomed out the cells are
summed into res 6/5/4 parents. At street zoom the real coins take over. Medium and rare coins are drawn
bigger. The sky chip shows the time of the next coin wave.

## 4. Switches

- `MAP_REWARDS=off`: new worlds use the old per-world coin seeding.
- `MAP_DAILY_SHARE_BPS`, `MAP_ZONE_SHARE_BPS` (0–5000).
- `MAP_COIN_WAVES` (1–12, `off` = all at once).
- `MAP_REWARDS_SEED`: secret mixed into the day seed.

Worlds created before the deploy keep their coins until midnight; the next day uses map rewards.
