# The Layer: a shared voxel world in space

11 November 2026. Replaces the Gotchiverse-test-app workshop (a private 2D 16 × 16
workshop), which is removed. Testnet only, behind a server switch.

## What a player does

The logo opens the world picker: **GotchiGO** (the GPS game, the real-world layer of the
QuestLayer app) or the **Space Layer**.
The layer is one infinite, shared 3D voxel world in a space style: alien turf,
spore forests, dust dunes, aether shallows, basalt peaks and crystal fields under a
starfield with a ringed planet. It is an original design; nothing is copied from
another game.

- **Move:** joystick (phone) or W A S D (desktop), jump button or Space, drag to look
  around, pinch or wheel to zoom. Gravity is low, so one-block steps are easy, and the
  explorer climbs single blocks automatically while walking.
- **Home plot:** every explorer gets one free 16 × 16 plot in a settlement, assigned
  outward from the first settlement's plaza. The own plot has a gold border.
- **Build:** the Build button opens a palette of ten blocks (plank, hull plate,
  basalt, glass, lamp, star moss, stardust, spore stalk, spore cap, crystal) and an
  eraser. Tap a block face to place next to it, or erase it. Desktop: click places,
  right-click erases, keys 1–9 pick blocks, B toggles building, X toggles the eraser,
  Enter builds at the screen centre. Building works only inside the own plot, up to
  three blocks below ground and to the world ceiling.
- **Beacons:** light pillars mark beacons in the wilderness (at most one per
  64 × 64 region). Standing on a beacon activates it; the server checks the position.
- **Daily goals:** build eight blocks on your plot and activate three beacons. They
  give no reward yet; they teach the loop.
- **Explorers:** other explorers within 128 blocks appear with their name and outfit.
  Everyone sees all plots; only the owner can change one.
- **Outfit:** a blocky space suit in six colour sets (Nebula, Solar, Comet, Moss,
  Void, Ember). An equipped Aura shows as a halo. Outfits are colours only and imply
  no wearable ownership.

Movement in the layer never counts as GPS movement in QuestLayer, and the outdoor
map pauses its presence while the layer is open.

## Community layers and the coin

A **layer** is one community's copy of the world, listed in `server/layer/layers.mjs`:
its own seed (so its own landscape), name and coin name. The first layer is
**Space Layer** with the coin **MINECOIN**.

The agreed long-term model (owner, 11 November 2026):

- Every layer uses the QGOLD mechanics (possibly the very same token) under its own
  name.
- Every layer gets its own treasury and QGOLD staking; the layer's share of the daily
  staking yield follows what its players staked.
- The coin pays for tasks created in the layer (or on the web) and for completing
  them. Free play in the layer does not mint coins.

**None of this is active.** The layer has no coin balance, staking, treasury, task
payment, XP or item grants. `economy.active` is `false` for every layer, the screen
says so, and turning it on needs its own reviewed change.

## How it works

- **World:** `server/layer/world.mjs` is a pure function of (seed, x, y, z) shared by
  browser and server. Chunks are 32 × 32 × 48 blocks; settlements sit every 384
  blocks, flat at height 14 with a plaza spire, roads and 32 plots; the land blends in
  around them. Trees, cacti, crystal spires and beacons are deterministic features.
- **Storage:** SQLite tables `layer_plots`, `layer_blocks` (only the blocks a player
  changed; restoring the natural block deletes the row), `layer_edit_receipts` and
  `layer_beacons`, registered as the `virtual-layer` module schema. They belong to
  the normal database backup.
- **Edits:** `POST /api/layer/edit` carries the plot, a request id and up to 32 block
  edits. The server checks the owner, the plot bounds, the height range and the
  block, and keeps the last 64 request ids per plot so a retry never applies twice
  and a reused id with other edits fails. A plot holds at most 8 192 changed blocks.
  The browser places blocks at once and undoes them only if the server refuses
  (4xx). A lost connection or a server error keeps the blocks and retries the same
  request id with backoff; leaving the layer, hiding the app or closing the page
  sends unsaved blocks with `keepalive`.
- **Presence:** `POST /api/layer/presence` once a second reports the position and
  outfit and returns nearby explorers (opaque keys, names, outfits, positions) and
  today's goals. Positions live only in memory for 15 seconds. A move faster than
  12 blocks per second is corrected back; "Go to your plot" is the only jump.
- **Other routes:** `POST /api/layer/home` (claim or return the home plot),
  `GET /api/layer/plots` (plots around a point), `GET /api/layer/plot` (one plot's
  blocks), `GET /api/layer/layers`, `POST /api/layer/leave`. All need the game
  session; a request body never selects the acting explorer.
- **Client:** `src/layer/` (lazy chunk with three.js). Chunks mesh on the main
  thread with culled faces, per-vertex ambient occlusion and colour; view radius 3
  chunks on phones and 4 on desktop.

## Switch

`LAYER_ENABLED=1` turns the layer on; it is ignored on mainnet. `/api/config`
reports `layer.layers`; only then does the logo become the world picker. With the
switch off, `/api/layer/*` is not served and no layer tables are created. The testnet
unit sets it.

## Not built yet

Live sockets instead of polling, plot invitations for co-builders, NPCs and quests
in the plazas, materials and crafting, bigger plots, visible Aavegotchi-style
blocky wearables, the coin, the per-layer treasury and the second community layer.
Real-phone performance is unverified; browser checks use software rendering.
