# Test Layer and QuestLayer World

12 November 2026, decided by the owner: the game runs as two worlds that look and play exactly the same.

| | Test Layer | QuestLayer World |
| --- | --- | --- |
| What | Plzeň demo: compact zones, bots and seed content, the guided tour (helper Pip). The place where every new feature is tried first | The real game: GPS everywhere, zones on their timetable, no bots, no seed |
| Coin | **Test QGOLD**: its own testnet token, no backing, no treasury; shown as QGOLD with a TEST tag | QGOLD backed by treasury yield |
| Chain | Real testnet transactions on the Test Layer's **own contract set** (`public/*-testlayer.json`) | The network's contract set (`public/*-testnet.json`, later `-mainnet`) |
| Explorers | Temporary: a session lasts 4 hours | Permanent |
| Network | **Testnet only.** Mainnet has no Test Layer and refuses `QL_LAYER=test` | Testnet now, mainnet later (with the other layers) |

## Test Layer first until launch

Until launch (Lubos, 13 Nov 2026) the main address opens the Test Layer. World's runtime.env sets
`DEFAULT_TEST_LAYER=1` and `TEST_LAYER_ORIGIN=https://questlayer-test.promptstudio3000.com`. `/api/config`
then reports `gameLayer.defaultTest`, and a visitor without a saved choice is sent to the Test Layer.
In the Test Layer, the world picker (logo, top left) links to QuestLayer World with `?world=1`. That
choice is saved on the device (`questlayer.stayWorld`), so World stays put from then on. There is no
redirect while `TEST_LAYER_ORIGIN` is missing. Remove `DEFAULT_TEST_LAYER` at launch.

## City demo from the address

Lubos, 13 Nov 2026: `/?newyork`, `/?praha` or `/?city=Buenos Aires` opens the Test Layer's demo in that city, to
see how the game looks elsewhere. The name is matched against the reviewed cities and the auto cities (Czech
towns, the demo cities abroad and the capitals), ignoring case, spaces, dashes and diacritics; a reviewed city
wins, then the bigger auto city. An unknown name quietly keeps Plzeň. The address keeps the name, so a reload
stays in that city, and the Demo switch returns there after Use GPS.

- Client: `src/demo-city.ts` reads the name (a value-less key other than `tester`, or `city=`), asks
  `GET /api/demo-city?q=` and sends `city: <id>` with the arena `POST /api/world`.
- Server: `server/spatial/demo-city.mjs` finds the city; `ensureWorld(..., { arenaCity })` builds that city's
  arena world (`demo:arena-city-<id>:<day>`). Only the Test Layer honours it: an arena world skips the travel
  checks, so World always keeps its Plzeň arena and `/api/demo-city` answers `null` there.
- World (GotchiGO) sends such an address to the Test Layer as `?city=<name>`, unless it also has `?world=1`.

## How it is built

Same code, one switch: `QL_LAYER=test` (server, `server/native/network.mjs`) and `VITE_QL_LAYER=test`
(client build, `vite.config.ts`).

- **Manifests.** `manifestName()` returns `<name>-testlayer.json` in the Test Layer instead of
  `<name>-testnet.json`. Every contract id the server or the client uses comes from these records, so the
  Test Layer never addresses a World contract. The client build redirects each import of a
  `public/*-testnet.json` record to its `-testlayer` twin and fails if one is missing.
- **Own service.** `deploy/questlayer-testlayer.service`: port 7093, its own state directory and database
  (`/var/lib/questlayer-testlayer`), `https://questlayer-test.promptstudio3000.com`, its own signing vault
  (`https://questlayer-test-signer.promptstudio3000.com`, port 7094) and its own relayer budget
  (10 NEAR and 10,000 sponsored operations a day, separate from World). Both host names sit under the
  `*.promptstudio3000.com` wildcard, so no DNS change is needed.
- **Test-only switches live here.** `TEST_SEED=1` (bots and seed content, docs/TEST-SEED.md) and
  `DEMO_ZONES=plzen-compact` (docs/DEMO-ZONES.md) are set in the Test Layer unit. They are removed from the
  World unit when the Test Layer goes live, which also purges the seed rows from World. `MAP_PAYOUTS=1` is set
  here too: map coins, finds and zone prizes are minted as Test QGOLD in payout rounds (every
  `PAYOUT_ROUND_MINUTES`, default 5) from the Test Layer's rewards contract, so a new explorer can pay the
  tour's shop, shout, topic and task steps. Its liquid backing (about 1.6 test NEAR on 13 Nov 2026) caps how
  much Test QGOLD all explorers together can receive; top it up when it runs low.
- **Demo first.** The Test Layer opens in the Plzeň demo for every visitor, also with location allowed far
  from Plzeň (`src/play-here.ts`). GPS starts only after the visitor taps Use GPS there; that choice is
  remembered on the device until they switch back to the demo. GotchiGO (World) is the real GPS game: its Demo
  switch opens the Test Layer instead of a local demo. A device that picked the demo on World before keeps it
  until Use GPS in Map settings.
- **Intents market.** The Test Layer shares World's NEAR Intents verifier record, but its Auras live in its own
  collectibles contract, so the server trades the market's collection (`nativeMarket.nfts`), not the record's
  `nftContract`.
- **World picker.** `/api/config` returns `gameLayer {id, test, testLayerUrl, worldUrl}`. World links to the
  Test Layer only on testnet (`TEST_LAYER_ORIGIN`); the Test Layer links back (`WORLD_ORIGIN`). Each has its
  own explorer and cookie, so balances never mix.
- **Temporary explorers.** Sessions last 4 hours in the Test Layer (30 days in World). Each new account
  costs 0.02 test NEAR of storage from the Test Layer's player factory. Test QGOLD has no value, so it is
  never collected back.

## Deploying the contract set

The Test Layer uses no new contract code. `scripts/deploy-testlayer.mjs` runs the existing, reviewed deploy
scripts in an isolated work tree (`.data/testlayer/work`) with the Test Layer's own account ids
(`questlayer-*-tl1112.testnet`, the shape the vault factory contract requires, and `*-tl1112.<operator>`). This is also a rehearsal of a full fresh deployment, which
mainnet needs later.

1. `node scripts/deploy-testlayer.mjs` prints the plan; `--execute` runs it on the Mac (operator key):
   funds the operator from the faucet accounts in `scripts/data/testlayer-funds-testnet.txt` (60 test NEAR),
   deploys the collectibles slice (collectibles, player factory, relayer, badges, npc-games), rewards and
   vault factory, QGOLD vault, ledger and soulbound QGOLD, market, QGOLD escrow and creators, then writes
   `public/*-testlayer.json`. The Intents verifier record is shared (it only verifies signed intents).
2. `bash scripts/install-testlayer-keys-vps.sh` (on the VPS runner as root: `DEPLOY_HOST=local`) installs the keys the scripts created into the Test Layer's
   state directory and writes its runtime.env.
3. Commit the `-testlayer` records, then `bash scripts/deploy-vps.sh --testlayer` (it also installs the Test
   Layer's signing vault).
4. Cut-over: in `deploy/questlayer-hackathon.service` set `TEST_LAYER_ORIGIN=https://questlayer-test.promptstudio3000.com`
   and delete `TEST_SEED=1` and `DEMO_ZONES=plzen-compact`, then deploy World.
