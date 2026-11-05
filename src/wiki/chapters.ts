// The QuestLayer wiki (/wiki): every mechanism that is in force, one chapter
// per system. Maintenance rules live in docs/WIKI.md. In short:
//   - each chapter lists the repository files it explains in `sources`;
//   - docs/wiki-stamps.json stores a hash of every source doc, and
//     tests/wiki.test.mjs fails when a doc changed but the wiki was not
//     reviewed (`npm run wiki:stamp` after updating the chapter);
//   - numbers that live in rules files (level table, staker gates, GOLD
//     prices, Aura catalog) are imported, never copied.
// Text uses **bold**, `code` and [label](/path) only. English only: this is
// a reference page outside the translated game UI.
import levelTable from "../../server/data/level-table.json" with { type: "json" };
import stakerGates from "../../server/data/staker-gates.json" with { type: "json" };
import goldSpend from "../../server/data/gold-spend.json" with { type: "json" };
import auraCatalog from "../../server/data/aura-catalog.json" with { type: "json" };
import placeBadges from "../../server/data/place-badges.json" with { type: "json" };
import cities from "../../server/data/cities.json" with { type: "json" };

export type VizId =
  | "architecture"
  | "money-modes"
  | "core-loop"
  | "coverage-tiers"
  | "poi-pipeline"
  | "day-clock"
  | "quest-kinds"
  | "xp-curve"
  | "level-unlocks"
  | "actor-dialog"
  | "monster-flow"
  | "wisp-roll"
  | "aura-catalog"
  | "aura-secure"
  | "money-flow"
  | "treasury-mix"
  | "yield-sim"
  | "staking-vault"
  | "qgold-sim"
  | "qgold-exit"
  | "qgold-keeper"
  | "map-formula"
  | "map-merkle"
  | "map-coins"
  | "fees"
  | "gold-prices"
  | "staker-ladder"
  | "patron-rank"
  | "chain-states"
  | "chain-split"
  | "account-seq"
  | "intents-seq"
  | "ai-chain"
  | "fair-play"
  | "daily-jobs"
  | "ci-gates"
  | "wiki-loop";

export type Block =
  | { h: string }
  | { p: string }
  | { list: string[] }
  | { table: { head: string[]; rows: string[][] } }
  | { facts: [string, string][] }
  | { viz: VizId }
  | { note: string; tone?: "info" | "warn" };

export type Status = "live" | "partial" | "off" | "planned";
export type Chapter = {
  id: string;
  group: (typeof GROUPS)[number]["id"];
  title: string;
  summary: string;
  status: Status;
  /** Day the chapter was last checked against the code (YYYY-MM-DD). */
  updated: string;
  /** Repository files this chapter explains. Docs listed here are stamped. */
  sources: string[];
  blocks: Block[];
};

export const GROUPS = [
  { id: "start", title: "Start here" },
  { id: "play", title: "Play" },
  { id: "world", title: "World" },
  { id: "economy", title: "Economy" },
  { id: "chain", title: "On chain" },
  { id: "platform", title: "Platform" },
] as const;

export const STATUS_LABEL: Record<Status, string> = {
  live: "Live on testnet",
  partial: "Partly live",
  off: "Built, switched off",
  planned: "Planned",
};

// ------------------------------------------------------ derived numbers ----

export const LEVELS = levelTable.levels.map((l) => ({
  level: l.level,
  xp: l.requiredXp,
  unlock: l.unlock.title,
  item: (l as { item?: { name?: string } }).item?.name ?? null,
}));
export const MAX_LEVEL = levelTable.maxLevel;
export const STAKER_MIN_NEAR = Number(stakerGates.stakerMinNear);
export const STAKER_GATES = Object.entries(stakerGates.gates).map(([id, g]) => ({ id, ...g }));
export const PLACE_BADGES = placeBadges.badges.length;
export const LIVE_CITIES = cities.cities.filter((c) => c.status === "live").map((c) => c.id);
export const GOLD = goldSpend;

type Edition = { id: string; rarity: string; source?: string };
export const EDITIONS = (auraCatalog.editions as Edition[]).map((e) => ({ id: e.id, rarity: e.rarity, source: e.source ?? "chest" }));
export const SUPPLY_PER_EDITION = Number((auraCatalog as { supplyPerEdition?: number }).supplyPerEdition ?? 256);

const levelRows = LEVELS.map((l) => [`L${l.level}`, l.xp.toLocaleString("en-US"), l.unlock, l.item ?? "–"]);
const gateRows = STAKER_GATES.map((g) => [
  g.label,
  g.step === "staker" ? `Staker (≥ ${STAKER_MIN_NEAR} NEAR matured)` : g.step === "tier2" ? "Tier 2" : "Tier 3",
  `L${g.level}`,
]);
const premiumEmotes = GOLD.emotes.premium.map((e) => `${e.id} ${e.price}`).join(", ");

// -------------------------------------------------------------- chapters ----

export const CHAPTERS: Chapter[] = [
  {
    id: "overview",
    group: "start",
    title: "What QuestLayer is",
    summary: "A location game on real streets: walk, collect, meet NPCs, earn collectibles, with a real prize pool settled on NEAR.",
    status: "live",
    updated: "2026-11-04",
    sources: ["docs/ARCHITECTURE.md", "docs/GAME-RULES.md", "docs/SOURCES-AND-INTEGRATIONS.md", "README.md", "server/index.mjs", "src/main.tsx"],
    blocks: [
      {
        p: "QuestLayer turns the streets around you into a daily adventure. Coins lie along public paths, six quest zones open across the city every day, NPCs walk the map and offer errands, monsters guard chests, and everything you earn becomes yours: XP and levels on your account, Auras as NFTs, and coin rewards paid from one global prize pool that is funded by staking yield and sponsors, never by players losing money.",
      },
      {
        p: "This wiki is the know-how center of the project. Every chapter describes a mechanism **that is in force today**, the numbers it uses, how it connects to the rest and where it lives in the code. Status chips say honestly what is live on testnet, what is built but switched off and what is only planned.",
      },
      { viz: "architecture" },
      { h: "Three kinds of value" },
      {
        p: "The game deliberately keeps three ledgers apart so a player always knows what is practice and what is real.",
      },
      { viz: "money-modes" },
      {
        table: {
          head: ["Unit", "What it is", "Where it lives", "Transferable"],
          rows: [
            ["XP / QXP", "Experience from play. Drives levels and gates.", "Game DB; QXP mirror contract on NEAR", "Never (soulbound)"],
            ["GOLD (practice)", "Display denomination of the practice ledger. 1 GOLD = 10⁶ micro-GOLD.", "Game DB (`players.gold_u`)", "Only inside the game"],
            ["QGOLD", "Token fully backed by NEAR in the QGOLD vault. Its rate R only rises.", "`questlayer-qgold-vault-20261104.testnet`", "Yes (NEP-141)"],
            ["NEAR / test NEAR", "Prize pool money, stake, fees, Aura prices.", "Rewards, vault, market and Intents contracts", "Yes"],
          ],
        },
      },
      { h: "Where to look next" },
      {
        list: [
          "[How it works](/how-it-works) is the short animated player intro.",
          "[Economy](/economy) is the public ledger: treasury, realized yield, payouts with transaction links.",
          "[Treasury](/treasury) is the treasury dashboard and its votes.",
          "This wiki explains the machinery behind all three.",
        ],
      },
    ],
  },
  // ------------------------------------------------------------------ play
  {
    id: "walk-and-collect",
    group: "play",
    title: "Walking, coins and finds",
    summary: "GPS-only movement, street coins in daily waves, street finds and calm reward feedback.",
    status: "live",
    updated: "2026-11-05",
    sources: ["docs/MAP-REWARDS.md", "docs/NATIVE-AUTO-COLLECT.md", "docs/NATIVE-GAME-MAP.md", "docs/PEER-APPEARANCES.md", "docs/FIRST-SESSION.md", "src/useDemoWalk.ts", "src/map-motion.ts", "src/RewardBursts.tsx"],
    blocks: [
      { viz: "core-loop" },
      { h: "Movement" },
      {
        list: [
          "**Real play moves only with the phone's GPS.** There is no tap-to-walk anywhere.",
          "The city demo has a small pad (arrows / WASD). Up and down walk along the character's facing, left and right turn it. Running (14 m/s) is the default and Shift walks (5 m/s), both under the 15 m/s fair-play jump cap.",
          "Quest buttons only turn the explorer toward the target. Within 3 m the demo snaps onto it so thin path zones count.",
          "The 3D character follows map rotation and, in GPS play, the device heading.",
        ],
      },
      { h: "Coins" },
      {
        p: "Coins sit on mapped public paths, spaced 95–120 m apart (60 m within 300 m of a zone). Every coin of a day is backed QGOLD of the same value (a pioneer coin counts twice). They appear in **six waves between 07:00 and 22:00 local time**, each start shifted by up to ±30 min from the day seed; a later wave's coins stay hidden and cannot be claimed early. The demo arena has no waves so remote visitors in any time zone can play; its coins give XP only.",
      },
      { viz: "map-coins" },
      {
        p: "Coins near the player are collected automatically. Every claim is confirmed by the server before a floating reward chip appears, and each claim is exactly-once: retrying a request returns the original receipt.",
      },
      { h: "Street finds and the first session" },
      {
        list: [
          "Street finds are bonus objects next to paths. Lurker monsters hide next to them (60 m reveal).",
          "A newcomer anywhere in Czechia gets a coach: nearest find, first coin, first chest, an Aura to try on, then the nearest quest with a map pin and a numbered route for multi-stop quests.",
          "\"Search this area\" plans the cell you panned to; walking 650 m from searched spots searches automatically.",
        ],
      },
      { h: "Practice mode, NEAR mode and other explorers" },
      {
        list: [
          "Explore has two modes. Practice (default for guests) uses practice GOLD; NEAR mode projects the funded, published day onto the map and collects as you walk with fresh GPS, one request at a time, showing only confirmed results.",
          "Other explorers appear only if they opt in: sharing publishes a name, look and position for at most 15 minutes and stops when the tab is hidden. Wallets, balances and inventory are never exposed.",
        ],
      },
    ],
  },
  {
    id: "zones-and-quests",
    group: "play",
    title: "Zones, quests and the daily board",
    summary: "Six city zones a day, POI quests in every street cell, landmark clues, NPC errands and three daily goals.",
    status: "live",
    updated: "2026-11-04",
    sources: ["docs/WORLD-GENERATION.md", "docs/LANDMARK-ERRANDS.md", "docs/DAILY-BOARD.md", "docs/QUEST-TEMPLATES.md", "server/world-planner.mjs", "server/poi-quests.mjs", "server/landmark-clue.mjs"],
    blocks: [
      {
        p: "A reviewed city (Plzeň today) gets **six citywide zone slots** every day: varied, non-overlapping polygons that need real movement between them. A zone is marked by a tall 3D totem showing its type, a translucent wall, an aura on the ground and the loot it holds. Rarer zones open for a shorter window, and the countdown is visible to everybody.",
      },
      { viz: "day-clock" },
      {
        table: {
          head: ["Zone tier", "Open window", "Typical reward"],
          rows: [
            ["Tier 1", "All day", "XP, chest Aura while stock lasts, prize share"],
            ["Tier 2 (one timed slot)", "3 h from 12:00", "Bigger prize, rare chest"],
            ["Tier 3", "1 h from 18:00", "Largest prize, epic/legendary chest"],
          ],
        },
      },
      { viz: "quest-kinds" },
      { h: "POI quests in every street cell" },
      {
        list: [
          "Every H3 res-7 cell (about 5 km²) can hold **up to 6 quests a day**, at least 250 m apart, chosen from checked public places. At most 2 are category hunts (visit any 3 cafés, for example).",
          "Open 08:00–20:00 local. They rotate every 72 h. Rewards are XP only: 40 visit, 90 hunt, 60 chest (one chest per cell and day).",
          "An empty cell says \"Nothing here yet\" instead of inventing content.",
          "Nightly AI flavour texts (see AI chapter) give each quest a short line; the template text is the fallback.",
        ],
      },
      { h: "Landmark clues and errands" },
      {
        list: [
          "Up to 2 landmark clues per cell and day. The answer is a Wikidata fact (for example the century a building dates from). One answer per player: 70 XP right, 20 XP wrong.",
          "Quest givers hand out one errand per day each: visit a place, then come back for a fresh encounter to turn it in. 40 XP, +10 for a right clue.",
          "Guarded chests return `423 GUARDED` until the player beats that zone's guardian monster.",
        ],
      },
      { h: "Today's board" },
      {
        p: "Three small goals per world day picked from today's world (default: 10 coins, 1 monster, 1 NPC; fallback finds, a quest, 20 coins). Finishing all three pays **+50 XP once**. There is no streak and no penalty for skipping a day.",
      },
    ],
  },
  {
    id: "progression",
    group: "play",
    title: "XP, levels, season and badges",
    summary: `A ${MAX_LEVEL}-level curve where every level unlocks something to do or wear, cosmetic season ranks and ${PLACE_BADGES} place badges.`,
    status: "live",
    updated: "2026-11-04",
    sources: ["docs/LEVELS.md", "docs/GAME-LOOPS.md", "docs/NATIVE-PROGRESSION.md", "docs/SEASON.md", "docs/BADGES.md", "server/data/level-table.json", "server/data/place-badges.json", "src/levels.ts"],
    blocks: [
      {
        p: "Required XP follows `100 × (level − 1)²`. Levels never change odds, damage, GOLD or payouts; each one unlocks a thing to do or wear. The table is read directly from `server/data/level-table.json`, the same file the server uses.",
      },
      { viz: "xp-curve" },
      { table: { head: ["Level", "XP needed", "Unlock", "Level Aura"], rows: levelRows } },
      {
        p: "A linked NEAR account keeps its own confirmed XP read from the rewards contract; practice XP is never added to it, so simulated play cannot look like native progress.",
      },
      { h: "Season" },
      {
        list: [
          "A two-week season with a cosmetic leaderboard. Points: monster hunt 1, zone visit 2, NPC line 3. Goal 30.",
          "Ranks: Explorer, Season finisher (goal), Trailblazer (2×), Season legend (3×). A rank changes how the row looks and nothing else.",
          "Finishers claim a season mark and the season Aura once. Only play counts: never GOLD, NEAR, stake or purchases.",
        ],
      },
      { h: "Badges" },
      {
        list: [
          `**Place badges:** ${PLACE_BADGES} curated notable places (peaks, viewpoints, landmarks, bigger cities). GPS only, never in the arena. Each earned badge is minted as a soulbound NFT on \`questlayer-badges-20261102.testnet\`.`,
          "**Player badges:** POAP-like soulbound badges players design for visited places or finished quests, claimed with a server-signed claim.",
          "Badges are decorations: not sellable and never part of the inventory economy.",
        ],
      },
    ],
  },
  {
    id: "npcs-and-monsters",
    group: "play",
    title: "NPCs, monsters and mini-games",
    summary: "Roaming NPCs with AI voices, monsters beaten by skill, an altar for crafting and earned dice rolls on chain.",
    status: "live",
    updated: "2026-11-04",
    sources: ["docs/NPC-PLAN.md", "docs/ACTORS-API.md", "docs/MONSTER-CHALLENGES.md", "docs/MONSTER-HUNT.md", "docs/NPC-GAMES.md", "docs/NPC-TRADERS.md", "docs/KEEPER-VAULT.md", "server/actors/service.mjs", "server/npc/service.mjs"],
    blocks: [
      {
        p: "Actors walk real pedestrian paths on a schedule. Reviewed cities have a hand-cast list; every other city and street cell gets a generic cast (quest giver, storyteller, wandering rare, one roamer, two lurkers). Actors are out **07:00–22:00 local** and switch between day and night casts by the real sun.",
      },
      {
        table: {
          head: ["Archetype", "What it does"],
          rows: [
            ["Quest giver", "Quest lines and one errand a day; patron lines for stakers"],
            ["Storyteller", "Story chapters; patron chapter for stakers"],
            ["Trader", "Buys and sells Auras on NEAR Intents with a purse that must grow"],
            ["Keeper", "Shows the player's stake, ceremonies and the inner vault (read-only)"],
            ["Wandering rare", "Rare encounter with a patron option at Tier 3"],
            ["Roamer / guardian / lurker / boss", "Monsters: roam, guard a zone chest, hide by finds, weekly shared boss"],
          ],
        },
      },
      { h: "How a conversation works" },
      {
        p: "The server first computes the **offer menu** (quests, errands, trades) from game rules. The AI model only phrases the reply and may pick from that menu; it can never invent a reward, a price or an item.",
      },
      { viz: "actor-dialog" },
      { h: "Monsters" },
      {
        list: [
          "Beaten by a quiz, a rhythm mini-game or a stance duel. Power = level (capped at 20) + skill. Auras and items are flavour only and never change odds.",
          "A loss means a 1 h cooldown; one defeat per monster per day. No wagering of any kind.",
          "Rewards: XP, element shards (max 12 a day) and roll tickets from lurkers.",
          "The weekly boss has shared HP (1200); each player lands one hit every 10 minutes. Three or more hits on a defeated boss earn the Bossbane Aura once.",
        ],
      },
      { viz: "monster-flow" },
      { h: "Golden Altar" },
      {
        p: "Shards plus common Auras craft rarer existing editions: Wardbreaker (10 shards + 1 common + a guardian win), Polar (6 frost + 1 common), Comet, Storm and Moon (8 element shards + 2 commons + a guardian win). The daily offering limit rises at L6.",
      },
      { h: "Wisp rolls (npc-games contract)" },
      {
        p: "A lurker quiz win earns a roll ticket. The roll is played on chain with **commit-reveal** and NEAR's block randomness, so neither the server nor the player can bias it. Tickets are earned only; nothing can be bought or wagered.",
      },
      { viz: "wisp-roll" },
      { h: "Traders" },
      {
        list: [
          "Sell price ≥ cost × 1.10. Premium buys only with ≥ 10 % resale margin; the premium budget is 50 % of the 7-day profit.",
          "Patron rates (Staker + L4): sales at max(market × 0.85, cost × 1.10), buys at min(market × 1.20, resale / 1.10), 3 rares → 1 epic trade-up.",
          "3 trades per player, trader and day. 10 trades with one trader earn the Merchant's Ledger Aura.",
          "A keeper worker (every 10 min) restocks up to 3 rare/epic Auras, sweeps profit above the float into the prize pool and refills the float.",
        ],
      },
    ],
  },
  {
    id: "collectibles",
    group: "play",
    title: "Auras and collectibles",
    summary: `${EDITIONS.length} Aura editions, ${SUPPLY_PER_EDITION} per edition, minted on NEAR and secured automatically.`,
    status: "live",
    updated: "2026-11-04",
    sources: ["docs/NATIVE-AURA-CLAIMS.md", "docs/COLLECTIBLES-REVIEW.md", "docs/ASSET-CATALOG.md", "server/data/aura-catalog.json", "server/earned-editions.mjs"],
    blocks: [
      {
        p: "Auras are wearable effects in two slots (above and below the character). Each edition is capped on chain. The catalog in `server/data/aura-catalog.json` is the single source for the server, the client and this page.",
      },
      { viz: "aura-catalog" },
      {
        table: {
          head: ["Source", "How you get it", "Claim prefix"],
          rows: [
            ["chest", "Zone chests, gated by zone tier and level", "server award"],
            ["level", "Reaching L5–L10, once", "`earned:level:`"],
            ["npc", "NPC lines, chapters, trades, wisp rolls, patron path", "`earned:npc:`"],
            ["monster", "First guardian win, boss hits", "`earned:monster:`"],
            ["season", "Reaching the season goal", "`earned:season:`"],
          ],
        },
      },
      {
        list: [
          "Claim-only editions mint only for their claim prefix; the oracle cannot mint them and chests never drop them.",
          "Earned editions are awarded **once per player ever** through the `earned_editions` ledger.",
          "Set bonuses are cosmetic only.",
        ],
      },
      { h: "Securing and trading" },
      { viz: "aura-secure" },
      {
        list: [
          "Chest, roll and level Auras are secured automatically: the device key signs `redeem_aura` and the relayer pays gas. A worn Aura waits until it is taken off.",
          "Collection Sell lists the Aura on NEAR Intents (see the Intents chapter). A 2 % NEP-199 royalty goes to the treasury on outside marketplaces such as Mintbase.",
        ],
      },
    ],
  },
  {
    id: "wearables-and-explorers",
    group: "play",
    title: "Wearables and explorer cards",
    summary: "Free Aavegotchi wearable clones on the map, a gold check for owned originals, and explorer cards with waves.",
    status: "live",
    updated: "2026-11-04",
    sources: ["docs/PLAYER-CARDS.md", "server/gotchi-wearables.mjs", "server/player-waves.mjs"],
    blocks: [
      {
        p: "About one street find in three becomes a **wearable find** (at most 12 per world): a free in-game clone of one of 301 official Aavegotchi wearables. The catalogue is read from the Aavegotchi contract on Base and the artwork is served from the contract, never copied. Picking one up is a normal street coin claim (GPS check, travel guard, XP caps).",
      },
      {
        table: {
          head: ["Rarity", "Share of wearable finds"],
          rows: [["Common", "40 %"], ["Uncommon", "26 %"], ["Rare", "18 %"], ["Legendary", "10 %"], ["Mythical", "5 %"], ["Godlike", "1 %"]],
        },
      },
      {
        list: [
          "A clone is a cosmetic row: not an NFT, not tradable, no GOLD value. Rewards, XP and the economy do not change.",
          "One item per slot (head, face, eyes, body, hand, pet), drawn on the character at its official canvas place.",
          "**Verified originals:** a player who links a Base wallet with a signed message gets a gold check on every clone whose original sits in that wallet. The check lasts 24 hours after the last wallet read. Other players see only \"verified\", never the address.",
        ],
      },
      { h: "Explorer cards and waves" },
      {
        list: [
          "Tapping another explorer opens a card with name, level, worn wearables, verified flags and Aura colours. It works only while that explorer shares their position and neither side blocked the other.",
          "Waves are six ready phrases, no free text. Limits: one per pair per minute, 20 sent and 30 received per hour; delivered by the presence poll and deleted after an hour.",
          "Block hides presence, notes, waves and the card both ways. Free-text chat is only a proposal and is not built.",
        ],
      },
    ],
  },
  // ----------------------------------------------------------------- world
  {
    id: "world-and-places",
    group: "world",
    title: "Cities, cells and places",
    summary: "Reviewed cities, automatic cities and every H3 cell of Czechia, built from a safety-filtered POI database.",
    status: "live",
    updated: "2026-11-04",
    sources: ["docs/WORLDS-PLAN.md", "docs/POI-PIPELINE.md", "docs/POI-SAFETY.md", "docs/WORLD-COVERAGE.md", "docs/SECOND-CITY-PLAYBOOK.md", "docs/WORLD-WORKER.md", "docs/OPERATOR-WORLD-CONTROLS.md", "server/data/cities.json", "server/spatial/auto-cities.mjs", "server/poi/index.mjs"],
    blocks: [
      {
        p: `Live reviewed cities: **${LIVE_CITIES.join(", ")}**. Before mid-November the world covers Czechia only.`,
      },
      { viz: "coverage-tiers" },
      {
        table: {
          head: ["Tier", "What", "Content", "Money"],
          rows: [
            ["A · reviewed city", "Hand-checked city pack (Plzeň)", "Six city zones, cast NPCs, POI quests", "Funded NEAR days"],
            ["B · auto city", "GeoNames towns ≥ 15,000 people (85 cities)", "Zones with an \"Unverified map\" notice, generic cast", "Practice only, never funded"],
            ["C · street cell", "Every H3 res-7 cell", "Up to 6 POI quests, generic cast, cell zones", "Map rewards plan"],
          ],
        },
      },
      { h: "The POI pipeline" },
      { viz: "poi-pipeline" },
      {
        list: [
          "A weekly worker builds a SQLite file from OpenStreetMap (ODbL), Overture (CDLA-P-2.0) and Wikidata (CC0). The first Czech import held about 290,000 places, 198,000 of them quest-ready.",
          "Every place passes a taxonomy and a safety filter: snapped within 40 m of a public path, 25 m buffer from excluded areas (schools, private grounds, dangerous sites), stable reason codes.",
          "The game reads the file read-only. A missing file simply means no POI quests.",
        ],
      },
      { h: "Daily preparation and operator controls" },
      {
        list: [
          "A worker prepares today's and tomorrow's geography per local date under a database lease: six separated zones, their mapped targets and opening windows. Preparation creates no money; funding is a separate step.",
          "Daylight-saving days keep their real 23 or 25 hours.",
          "An operator with server access can pause a day or zone, close a place or adjust a future unpublished day. There is no web route for these changes.",
        ],
      },
      { h: "Theme layers" },
      {
        p: "A world layer is a JSON pack (default `aavegotchi-v1`) that sets actor models, object kinds and design tokens over the place layer. Layers never create money: the validator refuses any pack whose rewards are not `none`. Published plan hashes are pinned so a day never changes after the fact.",
      },
      { h: "Day and night" },
      {
        p: "The map follows the real sun at the city (day, dusk, dawn, night palettes), and actors have day, night or any-time casts.",
      },
    ],
  },
  {
    id: "map-rewards",
    group: "world",
    title: "Map rewards plan",
    summary: "One daily plan for all 16,346 cells of Czechia: every coin backed and equal, a published Merkle root and claims verified on chain.",
    status: "live",
    updated: "2026-11-05",
    sources: ["docs/MAP-REWARDS.md", "docs/GLOBAL-TREASURY.md", "server/map-rewards/policy.mjs", "server/map-rewards/budget.mjs", "server/map-rewards/chain.mjs"],
    blocks: [
      {
        p: "At the first request of a local day the server builds the day plan once from the **real daily budget**: the map's share of the rewards contract's per-date cap, priced in micro-QGOLD at the vault's backing rate R. There is no practice money: **every coin on the map is backed and all coins of a day are worth the same**.",
      },
      {
        p: "Every cell holds 400 coin shares (a pioneer cell 800), so one coin = coin budget ÷ all shares. At the testnet default of 0.05 NEAR and R = 0.001 NEAR that is 50 QGOLD over 6.5 to 13 million shares, a few micro-QGOLD per coin. The value grows with the treasury; shares a cell's paths cannot hold stay in the treasury.",
      },
      { viz: "map-formula" },
      {
        list: [
          "Zone prizes follow the formula: votes may steer up to 50 %; with no voters their share goes to the other parts.",
          "Zone caps: at most 1 % of the zone budget per cell and 25 % per H3 res-5 area. What a capped cell cannot take is offered to the others.",
          "**Pioneer cells** (nobody visited for 30 days) show gold fog; their first drop pays two shares per coin and adds a pioneer chest. New places get more, not less.",
          "The demo arena (no GPS) gives XP only. Outside Czechia a cell gets no coins until more countries have a plan.",
        ],
      },
      { h: "Proof on chain" },
      { viz: "map-merkle" },
      {
        list: [
          "One leaf per funded cell, sorted, hashed with sha256. `GET /api/map/rewards/day` shows the root, `GET /api/map/rewards/proof?cell=` the leaf and its proof.",
          "The reward worker calls `publish_map_day`, `claim_map` and `close_map_day` on the rewards contract, which verifies every claim against the root. Only GPS-world coins and cell zones of players with a linked NEAR account, max 240 claims a day; the demo arena gives XP only and never goes on chain.",
          "Each published day holds 256 storage slots (≈ 2.6 NEAR) until it is closed.",
        ],
      },
      { h: "Caps grow with the treasury" },
      {
        list: [
          "The rewards contract caps each date at **max(0.1 NEAR, 10 % of each bucket's funding)**.",
          "City days together take at most max(0.006 NEAR, 4 % of a bucket's funding); a map day at most half of the date cap, within what the city days left.",
          "With 0.2 NEAR funded nothing changes. With 1,000 NEAR a date may commit 50 NEAR per bucket: 20 to cities, 25 to the map.",
        ],
      },
      { h: "Plzeň's native days" },
      {
        p: "The reviewed city also publishes native NEAR days: exactly six slots with fixed coin denominations and backed reservations, funding split 50/50 between street coins and zones. A published day is never rewritten. The daily budget is split between live cities by demand (1 + distinct claimers in the last 7 days), never by fixed city pots.",
      },
    ],
  },
  // --------------------------------------------------------------- economy
  {
    id: "economy",
    group: "economy",
    title: "The money model",
    summary: "One global treasury, funded by yield and fees, paying players through daily budgets. Nobody pays to win.",
    status: "live",
    updated: "2026-11-04",
    sources: ["docs/GLOBAL-TREASURY.md", "docs/ECONOMY-RULES.md", "docs/ECONOMY-PAGE.md", "IMPLEMENTATION-PLAN.md", "server/native/public-ledger.mjs"],
    blocks: [
      {
        p: "All money flows through **one global treasury**. It earns staking and lending yield, collects fees and sponsor funds, and every day releases a budget that players collect as coins and zone prizes. Unclaimed budget simply stays for later days. Per-city pots do not exist: money follows players.",
      },
      { viz: "money-flow" },
      {
        list: [
          "**No paid chance.** Randomness is free or earned (wisp rolls, chests), never bought, in line with Czech gambling law.",
          "**No streaks, energy or loot purchases.** Spending only burns GOLD for cosmetics and conveniences.",
          "**Players never fund the prizes.** Principal you stake stays yours; only the yield share you choose goes to the game.",
          "Everything is published: [Economy](/economy) lists the treasury, audits and every payout with a transaction link; [Treasury](/treasury) shows the treasury dashboard.",
        ],
      },
      { note: "This page runs on NEAR testnet. Test NEAR has no monetary value and mainnet needs an explicit go from the owner plus external review of the new contracts.", tone: "warn" },
    ],
  },
  {
    id: "treasury-and-yield",
    group: "economy",
    title: "Treasury, yield and the mix",
    summary: "The treasury holds liquid staking tokens, lent stablecoins and a NEAR reserve, and only the yield is ever spent.",
    status: "live",
    updated: "2026-11-04",
    sources: ["docs/STNEAR-TREASURY.md", "docs/TREASURY-MIX.md", "docs/TREASURY-PAGE.md", "docs/YIELD-VAULT.md", "docs/YIELD-VAULT-PLAN.md", "docs/NATIVE-REWARDS-AND-VAULT.md", "docs/LIQUID-STAKE.md", "server/native/treasury-mix.mjs"],
    blocks: [
      {
        p: "The treasury targets **50 % liquid staking tokens, 40 % stablecoins lent on Rhea and 10 % NEAR**. A daily job on the operator machine first harvests stNEAR growth above the principal, then rebalances towards the target, then keeps the reserve. The live split below comes from `/api/treasury/mix`.",
      },
      { viz: "treasury-mix" },
      {
        table: {
          head: ["Limit", "Value"],
          rows: [
            ["Max per protocol", "40 % (USDC + USDT both count as Rhea Lend)"],
            ["No supply when market utilization is", "≥ 95 %"],
            ["Max moved per run", "25 % of the treasury"],
            ["Rebalance when drift exceeds", "3 percentage points"],
          ],
        },
      },
      { h: "From yield to a daily budget" },
      { p: "Play with the numbers: the treasury size and the blended yield decide how much the map can pay every day without touching principal." },
      { viz: "yield-sim" },
      { h: "Three yield sources" },
      {
        list: [
          "**stNEAR treasury.** The operator holds stNEAR (Meta Pool). Harvest sells only growth above the recorded principal and funds the rewards contract (`fund_rewards`, source sponsor).",
          "**Yield vault** `questlayer-yield-20261102.testnet`. Players or the treasury deposit stNEAR, LiNEAR, USDC or USDT. A deposit makes the player a Staker at once; withdrawal opens after 24 h. Stables keep a 20 % buffer and are supplied to Rhea only below 95 % utilization; LST growth goes to the treasury.",
          "**Staking vaults.** A personal keyless vault per player stakes NEAR with a validator and gives a chosen 0–100 % share of the yield to the game. Harvest → unlock (4+ epochs) → withdraw → flush to the treasury, all permissionless calls.",
        ],
      },
      { viz: "staking-vault" },
      {
        p: "The [Treasury](/treasury) dashboard shows all of this live: the money flow, the mix, the daily budget, QGOLD backing and its own model.",
      },
      {
        p: "The first prize day paid entirely from realized staking yield was proven on testnet (day `plzen-2026-11-05-v2`, proof `public/native-yield-day-proof.json`). Testnet LST prices are frozen, so stNEAR growth there is zero; mainnet LSTs earn about 4 %.",
      },
    ],
  },
  {
    id: "qgold",
    group: "economy",
    title: "QGOLD token and vault",
    summary: "A transferable token that is always fully backed by NEAR. Burns and fees only push its rate up.",
    status: "live",
    updated: "2026-11-04",
    sources: ["docs/QGOLD-VAULT.md", "docs/QGOLD-MARKET.md", "contracts/qgold/src/lib.rs", "server/qgold/keeper.mjs", "server/qgold/token-page.mjs"],
    blocks: [
      {
        p: "QGOLD is the player's share of the game's daily yield. One contract is both the token and the vault that backs it, so a burn, a payout and the rate are decided in one synchronous call. **R = backing / supply** (NEAR per QGOLD). It started at 0.001 NEAR.",
      },
      {
        table: {
          head: ["Action", "Who", "Price", "Fee"],
          rows: [
            ["`mint_for` (claim a coin as QGOLD)", "Only the rewards contract", "exactly R", "none"],
            ["`deposit` (buy at the vault)", "Anyone", "R + 1 %", "1 %"],
            ["`redeem` (sell back)", "Holder, own balance only", "R − 1 %", "1 %"],
            ["`ft_burn` (spend in game)", "Holder", "–", "burned: R rises for everyone"],
          ],
        },
      },
      { p: "Try it: mints never change R, burns raise it, fees add to the backing." },
      { viz: "qgold-sim" },
      { h: "Exits and safety" },
      { viz: "qgold-exit" },
      {
        list: [
          "Instant exits: at most 5 % of the backing per 24 h (at least 1 NEAR) and 1 % per account (at least 0.2 NEAR). The rest queues for a 24–48 h safe window; `claim_exit` pays only the account that burned.",
          "Every payout follows a burn of the payee's own QGOLD. There is **no admin withdraw**, and the vault account has no access keys.",
          "After every change the contract asserts balance ≥ backing + insurance + treasury due + queued exits + storage. If anything ever drains NEAR, every later call fails and the vault freezes.",
          "10 % of fees build an insurance fund; `reconcile` books any loss against insurance first and refills R to its peak.",
          "A guardian can pause for at most 72 h. Upgrades and parameter changes need the council multisig and a fixed 48 h timelock.",
        ],
      },
      { h: "Market and keeper" },
      { viz: "qgold-keeper" },
      {
        list: [
          "A Rhea (Ref) testnet pool #2895 pairs wNEAR and QGOLD near R + 1 %.",
          "A keeper acts at 12 secret times a day, committed in advance and revealed from NEAR block randomness: inverse buy-and-burn below R, buyback-and-burn from 20 % of fees below 1.1 R, sales on a 1.1 / 1.2 / 1.3 R ladder above it.",
          "The keeper stays idle while the pool is too small (threshold set on the server).",
        ],
      },
      { note: "QGOLD is not an investment product. The vault is unaudited testnet code; mainnet needs an external audit and a legal opinion.", tone: "warn" },
    ],
  },
  {
    id: "fees-and-spending",
    group: "economy",
    title: "Fees, spending and the task market",
    summary: "Where fees go, what GOLD can buy, and how tasks, Secrets and conditional sends settle.",
    status: "partial",
    updated: "2026-11-05",
    sources: ["docs/GOLD-SPENDING.md", "docs/TASK-MARKET.md", "docs/QGOLD-ESCROW.md", "docs/CREATOR-BONUS-VOTE.md", "docs/NATIVE-TASK-ESCROW.md", "docs/NATIVE-TASKS-UI.md", "CREATOR-ECONOMY-PLAN.md", "server/data/gold-spend.json"],
    blocks: [
      { viz: "fees" },
      {
        p: "All fees go to the treasury and come back to players through the daily budget. Sends between players and conditional escrow sends are free. There is no 24 h lock on anything a player owns.",
      },
      { h: "What GOLD buys (every spend is a burn)" },
      { viz: "gold-prices" },
      {
        list: [
          `Emotes: ${GOLD.emotes.free.length} free, premium ones shown to others for ${GOLD.emotes.showSeconds} s (${premiumEmotes}).`,
          `NPC gear: one chest-edition Aura a day from a trader (rare ${GOLD.gear.price.rare}, epic ${GOLD.gear.price.epic} GOLD).`,
          `Lures: ${GOLD.lures.minutes} minutes, GPS only, ${GOLD.lures.hours.join("–")}, at least ${GOLD.lures.spacingM} m apart, snapped to a safe place within ${GOLD.lures.poiSnapM} m. They attract actors; they never change odds.`,
          "Place messages: paid shouts live up to 7 days; a topic with posts from 6 distinct authors becomes free forever and is archived after 90 days without activity.",
          "Every spend burns real QGOLD: the player's own account calls `ft_burn` on the QGOLD token with the game's memo (sponsored, no popup on the explorer account), the server verifies that transaction on chain, and only then the purchase happens. The backing stays in the vault, so every burn raises R for all holders.",
        ],
      },
      { h: "Task market, Secrets and conditional sends" },
      {
        list: [
          "A poster pays the reward plus 10 % on top. The fee reaches the treasury only on payout; a refund returns both.",
          "**Secrets:** a creator hides a place; finders pay to reveal it and the creator gets 90 % after a GPS visit or 7 days without dispute. A sponsor can prepay finder rewards so the reveal is free.",
          "**Conditional sends:** escrow that releases on a condition, no fee.",
          "Everything settles in real QGOLD. The poster, buyer or sender pays it from their own NEAR account into the `qgold-escrow` contract with one sponsored `ft_transfer_call` (no popup on the explorer account); the task, Secret or send opens once the escrow shows it.",
          "The game server is the escrow's publisher: it approves GPS-checked or reviewed completions, confirms Secret visits, releases or refunds sends and pushes each payout to the receiver's account (`withdraw_for`). It can only pay the named counterparty or refund the funder; there is no admin withdrawal and the escrow has no access keys.",
          "A proof waiting for review holds its slot on chain, so the poster cannot cancel it away. One escrow task pays at most 50 completions, and each account once per task.",
          "Sponsored NEAR tasks already run on a separate escrow contract that holds each sponsor's exact reward until a reviewed completion; it never touches stake, yield or prize money.",
        ],
      },
      { h: "Creators" },
      {
        p: "Players can publish their own quests by committing earned XP (200 on testnet) while a quest is live. Verified explorers vote each UTC day on which community quests earn the next day's creator bonus (3 votes each, top 3 win). Creator money is paid from a bounded on-chain round.",
      },
    ],
  },
  {
    id: "staking-and-gates",
    group: "economy",
    title: "Staker step, tiers and patron perks",
    summary: `Become a Staker from ${STAKER_MIN_NEAR} NEAR (about 5 €) and open patron content gradually by step and level.`,
    status: "live",
    updated: "2026-11-04",
    sources: ["docs/KEEPER-VAULT.md", "docs/LIQUID-STAKE.md", "docs/NATIVE-STAKING-FOUNDATION.md", "server/data/staker-gates.json", "server/staker-gates.mjs", "server/npc/patron-rank.mjs"],
    blocks: [
      {
        p: `A player becomes a **Staker** with at least ${STAKER_MIN_NEAR} NEAR of matured stake (or an instant yield-vault deposit). Tier 2 and Tier 3 follow the vault's weighted stake. Content opens by step **and** level so beginners are never blocked, and every perk is something to do or wear, never odds or payouts.`,
      },
      { viz: "staker-ladder" },
      { table: { head: ["Perk", "Step", "Level"], rows: gateRows } },
      { h: "Patron rank" },
      {
        p: "Rank 0 is the Staker step. One point per epoch of matured stake climbs the ladder Spark (1), Ember (4), Lantern (14), Beacon (28), Hearthfire (60). There is no decay.",
      },
      { viz: "patron-rank" },
      {
        list: [
          "**Patron's Path:** three patron lines across NPCs, each revealing a story chapter; the third awards the Patron's Lantern Aura once.",
          "**Keeper:** shows stake, maturity countdown (E+2 epochs), ceremonies at Tier 2/3 and the inner vault chapters.",
          "**Liquid staking** (stNEAR/LiNEAR held 24 h) can count toward the Staker step only; that reader is built and switched off.",
          "€ labels use a cached NEAR price feed.",
        ],
      },
    ],
  },
  // ----------------------------------------------------------------- chain
  {
    id: "on-chain",
    group: "chain",
    title: "What is on chain",
    summary: "Contracts, proof icons, the QXP ledger and how private location stays private.",
    status: "partial",
    updated: "2026-11-04",
    sources: ["docs/CHAIN-PROOF.md", "docs/CHAIN-LEDGER.md", "docs/NEAR-INTEGRATION-STATUS.md", "docs/MAINNET-PLAN.md", "contracts/wasm-sha256.json", "src/ChainLink.tsx"],
    blocks: [
      { viz: "chain-split" },
      { h: "Contracts on NEAR testnet" },
      {
        table: {
          head: ["Contract", "Account", "Role"],
          rows: [
            ["Rewards", "`questlayer-rewards-20261101b.testnet`", "Treasury, daily days, map days, daily QGOLD payouts, claims"],
            ["QGOLD vault", "`questlayer-qgold-vault-20261104.testnet`", "Backed token, exits, insurance"],
            ["Collectibles", "`nfts.questlayer-dev-20261101.testnet`", "Aura NFTs (NEP-171/199), wardrobe"],
            ["Badges", "`questlayer-badges-20261102.testnet`", "Soulbound place and player badges"],
            ["NPC games", "`questlayer-npc-games-20261101.testnet`", "Commit-reveal wisp rolls"],
            ["Intents verifier", "`intents.questlayer-dev-20261101.testnet`", "Self-deployed NEAR Intents (experimental)"],
            ["Market v2", "`questlayer-market-20261101b.testnet`", "Signed Aura orders (fallback market)"],
            ["Yield vault", "`questlayer-yield-20261102.testnet`", "LST / stablecoin deposits"],
            ["Ledger (QXP)", "`questlayer-ledger-20261104.testnet`", "Soulbound XP mirror, record batches, day roots"],
            ["Creators", "`questlayer-creators-20261101b.testnet`", "Creator money rounds"],
          ],
        },
      },
      { h: "The proof icon" },
      { p: "One cube icon follows every on-chain action through four stages." },
      { viz: "chain-states" },
      { h: "The QXP ledger" },
      {
        list: [
          "Every earning action (coin, find, quest, chest, clue, monster, boss, errand, board, roll) can be recorded with its XP, a **geohash-7 cell (about 150 m)** and the sha256 of the evidence. The exact GPS fix never goes on chain.",
          "Daily Merkle roots let anyone verify a record against the day. Players without a NEAR account are back-filled once they register.",
          "The ledger contract is deployed; the recorder is currently switched off on testnet while the token model is finalized.",
        ],
      },
      { h: "Reproducible builds" },
      {
        p: "Every contract WASM is built in Docker (Rust 1.97.0, linux/amd64) and its sha256 is pinned in `contracts/wasm-sha256.json`. CI fails when a build or a deployed manifest does not match. Collectibles changes also need an independent re-review.",
      },
    ],
  },
  {
    id: "daily-payouts",
    group: "chain",
    title: "Daily QGOLD payouts",
    summary: "One Merkle root per day of what every account earned, paid straight into the QGOLD vault with no daily claim limit.",
    status: "off",
    updated: "2026-11-05",
    sources: ["docs/DAILY-PAYOUTS.md", "contracts/rewards/src/payouts.rs", "server/payouts/payout-tree.mjs", "server/payouts/worker.mjs"],
    blocks: [
      {
        p: "Every backed coin is real QGOLD. After the day ends the server sums each account's earnings in NEAR and the rewards contract pays every account once from a single published root, instead of one receipt per coin (which allowed only 240 claims a day).",
      },
      {
        list: [
          "`publish_payout_day` commits the root and reserves the day's total from the coin and zone treasury, under the same per-date cap as city and map days.",
          "`claim_payout` (anyone, 10 leaves per transaction) checks each leaf against the root and calls the vault's `mint_for` for exactly that account and amount. A repeated leaf is skipped; a refused mint reopens the leaf, so nothing is lost or paid twice.",
          "`close_payout_day` returns what nobody claimed to the treasury three days after publication.",
          "Amounts below 0.00000001 NEAR carry over to the next day: the vault cannot mint less than one QGOLD unit.",
        ],
      },
      {
        facts: [
          ["Leaf", "`sha256(\"payout|<day_id>|<index>|<account>|<amount_yocto>\")`"],
          ["Tree", "Sorted-pair sha256, the same as map days and the QXP ledger"],
          ["Storage", "Root, totals and a bitmap of claimed leaves; no receipt per account"],
          ["Limits", "Up to 262,144 accounts a day; 10 leaves per claim transaction"],
        ],
      },
      { h: "The nightly worker" },
      {
        list: [
          "After local midnight (Europe/Prague) the reward worker collects every backed map coin and cell-zone prize of GPS worlds that is not paid yet, prices it in NEAR at the rate its day was planned with, sums it per account and publishes the day.",
          "Then it sends `claim_payout` in batches of 10 until every leaf is paid, and closes the day after the grace period.",
          "A player without a NEAR account yet keeps their coins waiting; they join the first payout after the account exists. `GET /api/qgold/pending` shows what is still on its way (in micro-QGOLD `units`, with `awaitingAccount` for coins collected before an account existed).",
          "Profile · Wallet shows the QGOLD balance on the linked NEAR account and the amount the next payout brings. Pickup messages count QGOLD; there is no practice GOLD. The old practice stake for zone tiers stays as a labelled simulation.",
          "While payouts are on, map days no longer send `claim_map`, so a coin is never paid twice. The demo arena gives XP only and never pays.",
        ],
      },
      {
        note: "Switched on with `MAP_PAYOUTS=1` once the testnet rewards contract is upgraded and the worker key holds the three payout methods.",
        tone: "info",
      },
    ],
  },
  {
    id: "accounts",
    group: "chain",
    title: "Accounts, wallets and the relayer",
    summary: "Play without a wallet: an invisible NEAR account with a key that never leaves the device, and gas paid by the game.",
    status: "live",
    updated: "2026-11-04",
    sources: ["docs/RELAYER.md", "docs/IDENTITY-RECOVERY.md", "docs/NATIVE-TRANSACTION-CONFIRMATION.md", "docs/DURABLE-NATIVE-RECOVERY.md", "docs/ETH-WALLETS.md", "docs/NATIVE-PROFILES.md", "server/relayer/policy.mjs"],
    blocks: [
      { viz: "account-seq" },
      {
        list: [
          "A new explorer gets `<name>.play-…testnet`, funded with 0.1 NEAR. Its only full-access key is generated on the device; the server never holds a player key.",
          "Game actions are signed as NEP-366 meta-transactions. The relayer checks a strict policy (one action, allowed receiver + method + deposit, nonce, expiry, gas) and pays the gas.",
          "Attached deposits are capped at 0.5 NEAR per account per day; a failed relayed call refunds the deposit to the player.",
          "A NEAR wallet links with a NEP-413 signature; MetaMask or Rabby sign in with SIWE and can sign Intents trades (erc191). A SocialDB profile is published once per account.",
          "Passkeys sign in to the game identity; they are not NEAR keys. Recovery restores the explorer by signing again with the linked wallet.",
          "A wallet transaction counts only after the server reads it as FINAL and matches it against the terms reviewed before signing. Unresolved transactions survive reloads in a local journal so a retry never signs twice.",
        ],
      },
    ],
  },
  {
    id: "intents-market",
    group: "chain",
    title: "NEAR Intents market",
    summary: "Auras trade peer to peer through a NEAR Intents verifier, with a 2 % fee to the treasury.",
    status: "live",
    updated: "2026-11-04",
    sources: ["docs/NEAR-INTENTS-MARKET.md", "docs/ONCHAIN-TRADES.md", "docs/SIGNED-AURA-ORDERS.md", "docs/NATIVE-MARKET.md", "src/intents-order.ts"],
    blocks: [
      {
        p: "The verifier is the open-source NEAR Intents (defuse) contract v0.4.5, deployed by the project on testnet and labelled experimental. Both sides sign a `token_diff`; the solver (the relayer account) settles both intents in one transaction, so nobody can take the Aura without paying or the reverse.",
      },
      { viz: "intents-seq" },
      {
        list: [
          "Fee: 20,000 pips (2 %) on the buyer's wNEAR leg, collected for the treasury.",
          "NPC traders keep their stock and purse inside the verifier; a fill pairs the player's signed diff with a server-signed trader intent.",
          "Signed market-v2 orders (NEP-413) remain as a fallback. The old practice GOLD market is closed (`410 MARKET_ON_CHAIN`).",
          "Mainnet `intents.near` is planned; it needs the owner's go.",
        ],
      },
    ],
  },
  // -------------------------------------------------------------- platform
  {
    id: "ai",
    group: "platform",
    title: "AI in the game",
    summary: "NPC voices on NEAR AI Cloud with attestation, nightly quest texts and bounded quest drafts.",
    status: "live",
    updated: "2026-11-04",
    sources: ["docs/NEAR-AI-CLOUD.md", "docs/QUEST-FLAVOUR.md", "docs/AI-QUEST-DRAFTS.md", "server/ai/near-ai.mjs", "server/ai/flavour.mjs"],
    blocks: [
      { viz: "ai-chain" },
      {
        list: [
          "**NPC talk:** NEAR AI Cloud first (a DeepSeek model running in a trusted execution environment, about 2 s and a fraction of a cent per reply), then Ollama, then a template. Each reply's ed25519 signature is checked against the attestation report in the background.",
          "**Quest flavour:** a nightly batch after 01:00 UTC writes short texts for places in active regions; the player path only reads the cache, so no model call ever slows play. Rejected texts are logged with reasons.",
          "**Creator drafts:** an editor helper suggests quest drafts; suggestions are never saved or published automatically and pass the normal review.",
          "Rule for every model: it picks from options the server computed, by index. It never sets rewards, links or prices; outputs are filtered for unsafe text and prompt leaks.",
        ],
      },
    ],
  },
  {
    id: "safety",
    group: "platform",
    title: "Fair play and safety",
    summary: "Travel guard, XP caps, safe places, moderation and the money invariants.",
    status: "live",
    updated: "2026-11-04",
    sources: ["docs/FAIR-PLAY.md", "docs/POI-SAFETY.md", "docs/SOCIAL-CONTROLS.md", "docs/MAP-NOTES-UI.md", "docs/MODERATION-AND-EVIDENCE.md", "server/fair-play.mjs"],
    blocks: [
      { viz: "fair-play" },
      {
        list: [
          "Travel guard in GPS worlds: faster than 15 m/s returns `422 IMPLAUSIBLE_MOVE` (wait capped at 2 h).",
          "Location XP caps: 600 per cell per day, 3000 per day, 12 cells per day. The claim still succeeds; the XP is trimmed and the response says so.",
          "Rate limits on sign-up and APIs; all quests sit on safety-filtered public places.",
          "Map notes, place messages and creator quests have reports, blocks and moderators.",
          "Money paths use database transactions with exactly-once ids, and contracts keep their own invariants independent of the server.",
          "GPS can be spoofed: the server is the trusted validator of physical evidence, and the contracts bound what a compromised validator could do.",
        ],
      },
    ],
  },
  {
    id: "operations",
    group: "platform",
    title: "Runtime and operations",
    summary: "One Node service with SQLite, background workers, daily jobs and the CI gates every change passes.",
    status: "live",
    updated: "2026-11-04",
    sources: ["docs/RUNTIME-RELIABILITY.md", "docs/PERFORMANCE-BUDGET.md", "docs/STATE-RECOVERY.md", "docs/OWNER-RUNBOOK.md", "docs/TEST-SEED.md", ".github/workflows/check.yml", "scripts/check-bundle-budget.mjs"],
    blocks: [
      {
        p: "A React + MapLibre client talks to one Node 24 service on a VPS (systemd, Caddy). SQLite in WAL mode is the durable store with strict schema modules. Server-sent events push coins and quests to nearby players.",
      },
      { viz: "daily-jobs" },
      {
        list: [
          "Reward worker every 30 s (claims, publications, map days); trader and QGOLD keepers every 10 min; badge mint queue every 15 s.",
          "Backups at 03:20 UTC, after Prague midnight publication. After a restore, days whose chain count is ahead refuse new claims (`NATIVE_RECONCILING`) until they end.",
          "Load test: 500 walkers at p95 under 60 ms on one process; the ceiling is about 700–800 players.",
          "Phone budget: welcome-screen JS and CSS are capped; every big screen, this wiki included, loads lazily.",
          "English is the default language; other languages are opt-in dictionaries, checked on 390 px phones in CI.",
          "The testnet runs a removable test seed (bots, quests, starter kit); every seeded row has a `seed-` id.",
        ],
      },
      { viz: "ci-gates" },
    ],
  },
  {
    id: "maintaining",
    group: "platform",
    title: "How this wiki stays current",
    summary: "Every change to a mechanism updates its chapter, and CI refuses changes that skip it.",
    status: "live",
    updated: "2026-11-04",
    sources: ["docs/WIKI.md", "AGENTS.md", "scripts/wiki-check.mjs", "tests/wiki.test.mjs"],
    blocks: [
      { viz: "wiki-loop" },
      {
        list: [
          "Each chapter lists its sources. A hash of every source doc is kept in `docs/wiki-stamps.json`.",
          "When a mechanism doc changes, `npm test` fails until the matching chapter is reviewed and `npm run wiki:stamp` records the new hashes.",
          "A new doc must be added to a chapter's sources or explicitly marked as not a mechanism (plans, audits, hand-offs) in `docs/wiki-coverage.json`.",
          "Numbers that live in rules files are imported, so they can never drift.",
          "The page never names events or contains secrets, keys or private hosts; the test checks the copy.",
        ],
      },
    ],
  },
];
