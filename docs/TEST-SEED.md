# Testnet test world (TEST_SEED)

A switchable, removable test world on the testnet server so the whole game can be
tried end to end without waiting for other people. Testnet only; remove it before
the real release.

## Switch

| Setting | Effect at server start |
| --- | --- |
| `TEST_SEED=1` (testnet) | Builds the test world (idempotent) and runs its bots. |
| anything else, or unset | Removes everything an earlier run seeded, in one transaction. |
| `TEST_SEED=1` on mainnet | The server refuses to start. |

The testnet unit `deploy/questlayer-hackathon.service` sets `TEST_SEED=1`.
To remove the world, delete that line and deploy, or put `TEST_SEED=0` in
`runtime.env` (it overrides the unit). `/api/health` reports `testSeed` with counts
while it is on and `{"status":"off"}` otherwise.

Command line (local or on the VPS, same database rules as the server):

```
npm run seed:test -- status   [--db path]
npm run seed:test -- apply    [--db path]   # testnet only
npm run seed:test -- remove   [--db path]
```

## What it contains (`server/test-seed/content.mjs`)

- **Ten explorers.** Five walk real Plzeň pedestrian paths near náměstí Republiky
  in the practice map (arena). Ondra stays about 30 m from the most recently active
  real explorer, in the same map mode, so shared presence shows up wherever you are.
  Klara, Petr, Eva and Honza never walk the map: they only create quests and post tasks.
- **Map notes** at six places, in both the practice and the GPS map.
- **Community places** (Community · Places): seven recommended spots around the square, in both maps.
- **Shouts and topics** (Community · Local chat): two shouts kept on the map for the next 7 days on every start, and two topics with replies that stay free for good.
- **Practice market.** Four Auras from seed explorers are always on sale; a sold
  one is restocked within 30 s. Marek buys anything a real explorer lists for up to
  60,000 practice GOLD once it has been listed for 45 s, so selling can be tried.
- **Tasks** (Community · Tasks). Seven example player tasks from demo bots (photo,
  answer, go, deliver, meet, collect, create) around the square. They hold no QGOLD
  and cannot be taken (the market refuses `seed-` tasks); they show how the list,
  the poster and the reward look. Practice-GOLD tasks of earlier seed versions are
  deleted on every start.
- **Secrets.** Three free place Secrets around the demo square (courtyard, mural,
  riverside viewpoint), so Explore · Nearby always has something to reveal. Price 0
  and no visit reward: revealing one moves no QGOLD.
- **Creator quests.** Eight public creator profiles with followers among the bots and
  twelve approved quests (visits, trails, chests, a free story) with observation
  requirements. Publishing gives the bots the game's creator XP (server/data/creator-xp.json). A completion submitted
  on a seed quest is accepted after 30 s by the configured completion authority.
  Needs `CREATOR_COMMUNITY_ENABLED=1`; otherwise this part is skipped.
  Each quest carries a header photo of the real place in Plzeň (`server/test-seed/photos/`,
  from Wikimedia Commons under CC BY-SA, cropped to 600×450; authors and licences in
  `photos/credits.json`). The seed copies the files into the quest photo store and names the
  photo and its credit in the quest, also for quests an earlier seed already published.
- **NPCs and monsters.** `TEST_SEED=1` turns the roaming actors on, as
  `ACTORS_ENABLED=1` does.
- **Daily board.** Vera, Tomas and Jana finish today's board 7, 11 and 16 hours
  into each world day, so the "explorers finished today" count moves
  (`docs/DAILY-BOARD.md`). No XP for them.
- **Starter kit (opt-in, `TEST_SEED_KIT=1`)**. Off by default since 10 Nov 2026:
  players read the kit Auras as their own finds. While it is off, every start
  takes earlier kits back (`revertKits`: kit Auras, kit XP and shards; bots,
  notes, quests and listings stay). With `TEST_SEED_KIT=1` every real explorer
  gets it once, on sign-up or the next app load,
  so the Inventory backpack grid is full and the level bar is part filled:
  - Nine practice Auras across every rarity and both slots: Northern Lights
    (can be secured as a NEAR Aura and sold on the signed-order market), Ember
    Wisp twice (a stacked duplicate; practice market or the monster altar),
    Dewfall Ring, Meadow Bloom, Moon Ring, Stormcrown, Comet Trail and Golden
    Dust. The six editions not in the kit show as locked slots in the grid.
  - Northern Lights and Moon Ring are worn (Night Sky set glow), but only in a
    slot where the explorer wears nothing yet; an Aura already worn stays.
  - 650 XP: a new explorer sits mid level 3 (400 to 900 XP) and can publish an
    own creator quest.
  - 10 monster shards.

  It appears in history as "Test kit". The first copy of each edition keeps the
  id `seed-kit-<player>-<edition>`; a duplicate adds `-2`.

Nothing in the seed signs a NEAR transaction. Seed authors have no NEAR account, so
seed quests are not mirrored to the creators contract; likes and paid access on them
stay local.

## Removal

Every row the seed writes has an id starting with `seed-`. Removal deletes every row
whose id or reference column (player, author, seller, buyer, item, quest, note, task,
submission, operation…) starts with `seed-`, then every row left pointing at a
removed row through a foreign key, and queued creator-money jobs for seed quests.
Starter kits are reverted: the kit Auras disappear, kit XP is subtracted (never below
the XP an explorer has locked in their own quests) and kit shards are subtracted.
Practice GOLD earned by selling to the seed buyer or from seed tasks stays. An Aura
already secured on NEAR stays in that wallet on testnet; only the local record goes.

Covered by `tests/test-seed.test.mjs`.
