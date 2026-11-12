# Fair play and hardening for public play (3 Nov 2026)

Browser GPS is never proof of where a player is. These guards bound what a
spoofed location or a script can farm; they do not try to prove truth.

## Travel guard (GPS worlds only)

`server/fair-play.mjs` keeps each player's last accepted fix
(`fair_play_anchor`). A street coin, discovery or walk stop far from it is
accepted only after the time the trip needs at `FAIR_PLAY_MAX_SPEED_KMH`
(default 15 km/h, on foot or by bike; owner 11 Nov 2026), capped at `FAIR_PLAY_TRAVEL_COOLDOWN_MAX_MS` (default 2 h), so
a real train ride is a wait, not a lock-out. Both fixes' GPS accuracy counts as
slack. A rejected fix (`422 IMPLAUSIBLE_MOVE`) never moves the anchor, so
hopping between spoofed places gains nothing. The arena (practice) world skips
it. Monsters/NPCs (`actor_player_fixes`) and native walks keep their own checks.

## Location XP caps (all worlds)

Coins and discoveries record XP per H3 res-7 cell and Prague day
(`fair_play_xp`). Defaults, all env-tunable:

| Variable | Default | Meaning |
| --- | --- | --- |
| `FAIR_PLAY_CELL_XP_PER_DAY` | 600 | XP per cell per day (a full POI cell is ~480) |
| `FAIR_PLAY_DAILY_XP` | 3000 | location XP per day in total |
| `FAIR_PLAY_XP_CELLS_PER_DAY` | 12 | cells a player can earn XP in per day |

A capped claim still succeeds (coin or discovery collected, GOLD paid); only XP
is trimmed, and the response carries `xpCap` (`cell`, `daily`, `cells`) and a
short `note`.

## HTTP rate limits (per minute)

| Route | Limit |
| --- | --- |
| `POST /api/session` (new guest) | 30 per network address |
| `POST /api/world` | 30 per player |
| `GET /api/world` | 240 per player |
| `POST /api/coins/claim` | 240 per player |
| `POST /api/quests/checkpoint` + `/claim` | 60 per player (shared) |
| `POST /api/presence` | 30 per player |
| `GET /api/events` | 4 open streams per player |

The existing 600 writes/min per address limit stays. Finished minute windows are
now pruned instead of clearing every counter once the map held 1000 keys (a
flood of keys reset everyone's limits). The client coalesces broadcast quest
events into one map refresh per 2.5 s.

## Audits (3 Nov)

- `npm audit`: 0 vulnerabilities (393 packages).
- `cargo audit` (contracts): zstd/zstd-safe bumped to 0.13.4/7.4.0 in
  `Cargo.lock` (host-only test dependency of near-sdk, not in any WASM).
  Remaining: `crypto-bigint 0.5.5` (RUSTSEC-2026-0387, timing; host-only via
  near-sdk test tooling, fix needs 0.7), and unmaintained warnings for
  `wee_alloc` (in near-sdk WASM, upstream) and `unsafe-libyaml` (host-only).
- Secret scan of all 431 commits on all 80 remote branches (3422 blobs): no
  real secrets. Three pattern hits were reviewed and are false positives: a
  token contract id in `server/native/rhea-markets.mjs`, a PEM header check in
  `scripts/install-npc-ticket-key-vps.sh`, and a throwaway NEAR test key in
  `tests/self-paid-native-transaction.test.mjs` that is not an access key on its
  testnet account. No `.env`, `runtime.env`, `.pem` or credential file was ever
  committed.
