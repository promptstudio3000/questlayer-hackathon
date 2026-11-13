// The QuestLayer wiki (/wiki): every mechanism that is in force, one chapter
// per system. Maintenance rules live in docs/WIKI.md. In short:
//   - each chapter reads short first: a TL;DR, up to four key numbers and one
//     picture; everything else is a detail block folded under "More details";
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
import CREATOR_XP from "../../server/data/creator-xp.json" with { type: "json" };

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
  | "wiki-loop"
  | "payout-round"
  | "wearable-rarity"
  | "inbox-seq"
  | "phone-hud"
  | "screen-map"
  | "dao-flow";

export type Block =
  | { h: string }
  | { p: string }
  | { list: string[] }
  | { table: { head: string[]; rows: string[][] } }
  | { facts: [string, string][] }
  | { viz: VizId }
  | { note: string; tone?: "info" | "warn" };

/** A key number shown as a tile: [value, what it means]. */
export type KeyFact = [value: string, label: string];

export type Status = "live" | "partial" | "off" | "planned";
export type Chapter = {
  id: string;
  group: (typeof GROUPS)[number]["id"];
  title: string;
  /** TL;DR: one or two sentences that say what the mechanism does for a player. */
  tldr: string;
  /** Up to four key numbers or facts, shown as tiles under the TL;DR. */
  keyFacts: KeyFact[];
  /** The one picture shown above the fold; more pictures can sit in the details. */
  hero?: VizId;
  status: Status;
  /** Day the chapter was last checked against the code (YYYY-MM-DD). */
  updated: string;
  /** Repository files this chapter explains. Docs listed here are stamped. */
  sources: string[];
  /** Everything else, folded under "More details". */
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
/** Copies per edition the deployed collectibles contract can number on NEAR (the game itself is uncapped). */

const levelRows = LEVELS.map((l) => [`L${l.level}`, l.xp.toLocaleString("en-US"), l.unlock, l.item ?? "–"]);
const gateRows = STAKER_GATES.map((g) => [
  g.label,
  g.step === "staker" ? `Staker (≥ ${STAKER_MIN_NEAR} NEAR matured)` : g.step === "tier2" ? "Tier 2" : "Tier 3",
  `L${g.level}`,
]);
const premiumEmotes = GOLD.emotes.premium.map((e) => `${e.id} ${e.price}`).join(", ");
const topXp = LEVELS[LEVELS.length - 1]?.xp ?? 0;
const cityNames = LIVE_CITIES.map((c) => (c === "plzen" ? "Plzeň" : c)).join(", ");

/** Contracts the project deployed on testnet (the on-chain chapter's table). */
const CONTRACT_ROWS: string[][] = [
  ["Rewards", "`questlayer-rewards-20261101b.testnet`", "Treasury, city and map days, QGOLD payout rounds, claims"],
  ["QGOLD vault", "`questlayer-qgold-vault-20261104.testnet`", "Backed token, exits, insurance"],
  ["QGOLD escrow", "`questlayer-qgold-escrow-20261109.testnet`", "Player-funded tasks, Secrets and sends"],
  ["NEAR task escrow", "`questlayer-tasks-20261031.testnet`", "Sponsored NEAR tasks with reviewed completions"],
  ["Staking vault factory", "`questlayer-vaults-20261101b.testnet`", "Personal keyless staking vaults"],
  ["Yield vault", "`questlayer-yield-20261102.testnet`", "LST / stablecoin deposits"],
  ["Collectibles", "`nfts.questlayer-dev-20261101.testnet`", "Aura NFTs (NEP-171/199), wardrobe"],
  ["Badges", "`questlayer-badges-20261102.testnet`", "Soulbound place and player badges"],
  ["NPC games", "`questlayer-npc-games-20261101.testnet`", "Commit-reveal wisp rolls"],
  ["Intents verifier", "`intents.questlayer-dev-20261101.testnet`", "Self-deployed NEAR Intents (experimental)"],
  ["Market v2", "`questlayer-market-20261101b.testnet`", "Signed Aura orders (fallback market)"],
  ["Ledger (QXP)", "`questlayer-ledger-20261104.testnet`", "Soulbound XP mirror, record batches, day roots"],
  ["Creators", "`questlayer-creators-20261101b.testnet`", "Creator money rounds"],
];

// -------------------------------------------------------------- chapters ----

export const CHAPTERS: Chapter[] = [
  {
    id: "overview",
    group: "start",
    title: "What QuestLayer is",
    tldr: "Pokémon GO, Geocaching and PoolTogether in one: **stake to play and lose nothing**. Your principal stays yours, a share of its yield goes to one global treasury, and every day that yield becomes rewards on real streets, paid as **QGOLD**, fully backed by NEAR.",
    keyFacts: [
      ["100 %", "of your stake's principal stays yours"],
      ["1 coin", "QGOLD in every layer, whatever a layer names it"],
      ["5 min", "between QGOLD payout rounds"],
      ["100 %", "of QGOLD backed by NEAR"],
    ],
    hero: "phone-hud",
    status: "live",
    updated: "2026-11-11",
    sources: ["docs/ARCHITECTURE.md", "docs/GAME-RULES.md", "docs/SOURCES-AND-INTEGRATIONS.md", "README.md", "server/index.mjs", "src/main.tsx", "src/App.tsx", "src/DemoControls.tsx", "src/useDemoWalk.ts", "src/MapSurface.tsx", "src/nearby-action.ts", "src/Dialog.tsx", "src/QuestBrief.tsx", "src/activity-view.ts", "src/GameIntro.tsx", "src/learning-store.ts", "src/activity-help.ts", "src/FirstSession.tsx", "src/AdventureResults.tsx", "src/WearableMoment.tsx", "src/zone-presence.ts", "src/ZonePresence.tsx", "src/MapSettings.tsx", "src/MapActions.tsx", "src/InfoTip.tsx", "src/PotRow.tsx", "src/useHudCard.ts", "src/screens.tsx", "src/nearby-list.ts"],
    blocks: [
      { h: "Where everything lives" },
      { viz: "screen-map" },
      {
        list: [
          "**Explore** opens the Nearby list: a row with today's unclaimed coins (within 10 km or everywhere; later waves not counted) and what is left in today's pot, then one list of everything around you. Chips filter All, Zones, Quests, NPCs and Community, each with its count. Sort by Nearest (default), Most XP or Top reward; the choice is remembered on the device.",
          "Locked rows (higher tier, not open yet, resting monsters) always sit below open ones. Hidden lurkers stay out of the list until you are within their reveal range. A row opens exactly what its map pin opens.",
          "Community rows cover player tasks and community tasks within 5 km, Secrets, place topics and shouts within 3 km, map notes and community places.",
          "Lists use compact two-line rows. Explanations sit behind small i buttons; required disclosures (unverified maps, requirements) stay visible.",
        ],
      },
      { h: "One next action at a time" },
      {
        list: [
          "One dismissible objective holds the next action. Confirmed results, recovery notices and the first equipment step come before nearby suggestions.",
          "One tap on a quest (in Nearby, in a zone, from an NPC or from Today's board) goes straight to the map: the target is marked, a direction line points to it, other map content dims, and the X on the target chip clears it. No reward is reserved or claimed by choosing. At the place the same tap opens one confirm button. A plain map point (a tour stop, for example) can be the target too: it gets a pulsing ring and the same chip with distance and X, and clears itself within 15 m.",
          "A zone dialog is the title, one row of icon facts (tier, open window, done today, XP, QGOLD and Auras left) and a list of one-tap quests.",
          "Notes, shouts and topics sit on the map as closed icons; a tap opens the text, a second tap opens the thread and the X folds it again.",
          "Only game elements sit on the map. Community quests, player tasks and Secrets have no map markers; they are reached from Community and Nearby.",
          "Each step shows its requirement (location, footprint, question) before confirmation. A minimum distance between stops is never described as a walking route; an unknown duration stays unknown.",
          "The confirmed result replaces the quest overlay; it is never stacked or repeated. Receipts, proofs and optional share actions sit under Learn more.",
          "Browsing Explore never replaces the active adventure; closing the list restores it and its server checkpoint.",
          "The zone you stand in gets a stronger outline and a short activity cue. It is a hint only: it never proves presence or grants a reward.",
        ],
      },
      { h: "First play and teaching" },
      {
        list: [
          "A new explorer without a deep link sees one skippable, illustrated guide before the map. Restored sessions and deep links never open it.",
          "First-time tips teach one action each, independent of any AI reply. They belong to this browser and player and never mark progress or grant rewards.",
          "Profile → Settings → Help reopens the guide, toggles first-time tips and shows the first steps again; the links to How it works, Wiki, Economy and Treasury sit at the bottom of Settings.",
          "A picked-up coin flies to the QGOLD counter (a fade under reduced motion). A new wearable opens a short, closable item moment once.",
          "On desktop, Inventory, Community and Profile open as a centred card over the dimmed map; on phones they are full screen.",
          "The logo button at the top left opens the world menu: a dropdown under the button on desktop, a bottom sheet on phones. Its first row links to **How it works**, **Wiki** and **Treasury**; below are the worlds to switch between.",
        ],
      },
      { h: "Three kinds of value" },
      { viz: "money-modes" },
      {
        table: {
          head: ["Unit", "What it is", "Where it lives", "Transferable"],
          rows: [
            ["XP / QXP", "Experience from play. Drives levels and gates.", "Game DB; QXP mirror contract on NEAR", "Never (soulbound)"],
            ["QGOLD", "Token fully backed by NEAR, 6 decimals. The game counts it in its smallest unit, so every amount on screen is a whole number: 1,000,000 QGOLD in the game is 1 QGOLD token in a NEAR wallet, and 1 NEAR reads as 1B QGOLD (stake, prices and rewards all use this one scale). Coins and zone prizes earn it, payout rounds mint it, every purchase burns it. Its rate R only rises.", "`questlayer-qgold-vault-20261104.testnet`; unpaid amounts wait in the game DB", "Yes (NEP-141)"],
            ["NEAR / test NEAR", "Prize pool money, stake, fees, Aura prices.", "Rewards, vault, market and Intents contracts", "Yes"],
          ],
        },
      },
      { h: "How the parts connect" },
      { viz: "architecture" },
      { h: "Where to look next" },
      {
        list: [
          "[How it works](/how-it-works): the short animated player intro.",
          "[Economy](/economy): the public ledger with transaction links.",
          "[Treasury](/treasury): the treasury dashboard and its model.",
        ],
      },
    ],
  },
  // ------------------------------------------------------------------ play
  {
    id: "walk-and-collect",
    group: "play",
    title: "Walking, coins and finds",
    tldr: "Real play moves **only with your phone's GPS**; the city demo walks with a joystick. Coins lie on public paths, appear in six daily waves and collect themselves as you pass. The server confirms each one exactly once.",
    keyFacts: [
      ["95–120 m", "between coins on a path (60 m near a zone)"],
      ["6 waves", "of coins between 07:00 and 22:00 local"],
      ["15 km/h", "GPS travel cap (the demo is exempt)"],
      ["25 m", "range to confirm a quest stop"],
    ],
    hero: "core-loop",
    status: "live",
    updated: "2026-11-11",
    sources: ["docs/MAP-REWARDS.md", "docs/NATIVE-AUTO-COLLECT.md", "docs/NATIVE-GAME-MAP.md", "docs/PEER-APPEARANCES.md", "docs/FIRST-SESSION.md", "src/useDemoWalk.ts", "src/play-here.ts", "server/poi/live-source.mjs", "src/map-motion.ts", "src/gps-facing.ts", "src/quest-route.ts", "src/QuestBrief.tsx", "src/GameMap.tsx", "src/RewardBursts.tsx"],
    blocks: [
      { h: "Movement" },
      {
        list: [
          "**GPS play:** no tap-to-walk anywhere. The character and the follow camera use your moving course; stationary jitter, stale or inaccurate fixes and big jumps never invent a turn. Manual panning pauses follow; My location or walking on restores it.",
          "**City demo:** a collapsible joystick (drag the knob: up walks the way you face, sideways turns, down steps back at 0.6× speed); arrows and WASD work too. A Run toggle, on by default, moves at 14 m/s; walking is 5 m/s. The demo is exempt from the GPS travel cap (about 15 km/h).",
          "**Start where you are:** after sign-in the game asks for location and opens the world around you: POI quests and backed coins of your street cell anywhere on Earth (funded cell zones in Czechia). The Plzeň city demo is the fallback when location is refused or unavailable, or when you pick Demo in Map settings; that choice is remembered until you pick Use GPS again. A refused start-up request keeps the demo without a warning.",
          "Opening a dialog releases held movement; closing it never resumes an old key press.",
          "Quest buttons only turn the explorer toward the target; within 3 m the demo snaps onto it so thin path zones count.",
          "Multi-stop walks keep their stop numbers. Ordered walks accept only the server's next stop; any-order hunts say **Any order** and use the nearest remaining stop. Confirmation needs the 25 m range, the zone footprint and fresh GPS; the server alone advances progress.",
          "Reduced motion moves the camera without animated travel.",
        ],
      },
      { h: "Coins" },
      { viz: "map-coins" },
      {
        list: [
          "Coins sit on mapped public paths, 95–120 m apart (60 m within 300 m of a zone). Every coin of a day is backed QGOLD of the same value; a pioneer coin counts twice.",
          "Six waves between 07:00 and 22:00 local time, each start shifted by up to ±30 min from the day seed. A later wave's coins stay hidden and cannot be claimed early.",
          "The city demo has no waves, so visitors in any time zone can play; its coins carry the same backed value.",
          "**One coin, one pick-up.** A coin can show in more than one world at the same spot (the GPS city map and the city demo share their street cells). Whoever picks it up first, in any world, takes it: every other explorer gets \"Another explorer got this coin first\", and the coin leaves their map at once.",
          "Every claim is confirmed by the server before the floating reward chip appears. Retrying a request returns the original receipt.",
        ],
      },
      { h: "Street finds and the first session" },
      {
        list: [
          "Street finds are bonus objects next to paths. Lurker monsters hide next to them (60 m reveal).",
          "A newcomer anywhere in Czechia gets a coach: nearest find, first coin, first chest, an Aura to try on, then the nearest quest with a pin and a numbered route.",
          "Search this area plans the cell you panned to; walking 650 m from searched spots searches automatically.",
        ],
      },
      { h: "Reward ledgers and other explorers" },
      {
        list: [
          "**Map coins (default):** every coin and zone prize is backed QGOLD. It shows as on its way in Profile → Stake → Earnings and the next payout round mints it to your NEAR account, created automatically. This stays the ledger after any wallet sign-in.",
          "**Test network ledger:** projects the funded Plzeň NEAR day onto the map and collects with fresh GPS, one request at a time. It runs only when you pick it in Settings → Developer or open Expeditions.",
          "Other explorers within about 1.5 km appear live on the map (name, look, position) while their game is open on screen; Settings → Show me to nearby explorers turns it off. GPS and demo players see only their own kind. Profiles never show a position; wallets, balances and inventory are never shown.",
        ],
      },
    ],
  },
  {
    id: "zones-and-quests",
    group: "play",
    title: "Zones, quests and the daily board",
    tldr: "Every day Plzeň gets **six quest zones**, and every street cell can hold up to six POI quests, two landmark clues and NPC errands. Three small daily goals pay **+50 XP**; there are no streaks and no penalty for skipping a day.",
    keyFacts: [
      ["6", "city zones a day"],
      ["≈ 400 m", "demo zones from náměstí Republiky"],
      ["≤ 6", "POI quests per street cell a day"],
      ["+50 XP", "for today's three goals"],
    ],
    hero: "day-clock",
    status: "live",
    updated: "2026-11-11",
    sources: ["docs/WORLD-GENERATION.md", "docs/DEMO-ZONES.md", "server/demo-zones.mjs", "docs/LANDMARK-ERRANDS.md", "docs/DAILY-BOARD.md", "docs/QUEST-TEMPLATES.md", "server/world-planner.mjs", "server/poi-quests.mjs", "server/landmark-clue.mjs", "server/npc/routes.mjs", "src/DailyBoard.tsx", "src/actors-layer.ts", "src/ZoneActivities.tsx", "src/zone-landmarks.ts", "server/spatial/organic-shape.mjs", "src/LockedZone.tsx"],
    blocks: [
      { h: "City zones" },
      {
        p: "A reviewed city gets six citywide zone slots a day: varied, non-overlapping polygons that need real walking between them. A zone shows a tall 3D totem of its type, a translucent wall, an aura on the ground and the loot it holds. Rarer zones open for a shorter window, with a countdown everyone sees.",
      },
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
      {
        list: [
          "**Tap the altar** in the middle of a zone (or its pin) to open the zone detail: whether it is open now or when it opens, how many of today's activities you have done, the XP, QGOLD and chest Auras still to win, and when the zone gets new activities and rewards (the next local midnight, when the daily world swaps).",
          "**The round icons floating inside a zone** are the chest Auras its chest can hold today (ring colour = rarity) and a gold coin when an activity there pays QGOLD. Tap one to see what it is and jump to the zone's activities. They disappear once the zone is closed or cleared; the zone itself stays on the map all day with a low, dimmed wall and the chip “Closed · new zones tomorrow”.",
        ],
      },
      {
        note: "Demo layout on testnet now (`DEMO_ZONES`): the six Plzeň zones follow their OpenStreetMap park or square outlines (an irregular blob where OpenStreetMap has no usable area), about 55–85 m across, at least 80 m apart, on the park ring around náměstí Republiky (náměstí Republiky, sady Pětatřicátníků North and West, Smetanovy sady, Šafaříkovy sady, sady 5. května), each within about 400 m of the start on a loop of about 2 km. All of them are open the whole day with no countdown, and chests, guardians, NPCs and monsters stay near the centre. Each compact day is its own world, mainnet refuses the switch, and the table above returns when it is off.",
      },
      {
        p: "Tier 3 zones are always on the map but locked until the explorer reaches Tier 3 in the vault (50 NEAR of matured weighted stake): a dashed edge, a lock on the pin and a \"🔒 Tier 3\" plate. Walking into one opens a dialog that says which tier it needs and how much to stake, with a Stake button and a How it works link. Tier 2 places stay open to everyone. Outside reviewed cities, one plain visit per street cell is such a Tier 3 place (70 m, double visit XP, never a funded cell zone). Zones outside reviewed cities are irregular blobs, not circles.",
      },
      { h: "Quest kinds" },
      { viz: "quest-kinds" },
      {
        list: [
          "**POI quests:** every H3 res-7 cell (about 5 km²) holds up to 6 a day, at least 250 m apart, from checked public places; at most 2 are category hunts (visit any 3 cafés). Open 08:00–20:00 local, rotating every 72 h. XP only: 40 visit, 90 hunt, 60 chest (one chest per cell and day). An empty cell says Nothing here yet.",
          "**Landmark clues:** up to 2 per cell and day; the answer is a Wikidata fact. One answer per player: 70 XP right, 20 XP wrong.",
          "**Errands:** each quest giver hands out one a day: visit a place, come back for a fresh encounter. 40 XP, +10 for a right clue. When every step is done, the NPC carries a gold **Report back** sign until the turn-in.",
          "**Guardians:** a zone guardian stands on its zone's chest. The chest answers `423 GUARDED` until you win; the win drops the chest right there and **Open the chest** points the map at it.",
          "Nightly AI flavour gives each quest a short line; short action-led template text is the fallback.",
        ],
      },
      { h: "Today's board" },
      {
        p: "Three small goals a world day, picked from today's world (default: 10 coins, 1 monster, 1 NPC; fallback finds, a quest, 20 coins). All three pay **+50 XP once**. Each unfinished goal has **Show me**, which points the map at the nearest monster, NPC, boss, open quest, find or coin; hidden lurkers are never revealed.",
      },
    ],
  },
  {
    id: "progression",
    group: "play",
    title: "XP, levels, season and badges",
    tldr: `${MAX_LEVEL} levels on a \`100 × (level − 1)²\` curve. Every level unlocks something to do or wear, **never better odds or bigger payouts**. Seasons and badges are cosmetic.`,
    keyFacts: [
      [String(MAX_LEVEL), "levels"],
      [topXp.toLocaleString("en-US"), "XP for the top level"],
      ["2 weeks", "per season, goal 30 points"],
      [String(PLACE_BADGES), "place badges, soulbound NFTs"],
    ],
    hero: "xp-curve",
    status: "live",
    updated: "2026-11-11",
    sources: ["docs/LEVELS.md", "docs/GAME-LOOPS.md", "docs/NATIVE-PROGRESSION.md", "docs/SEASON.md", "docs/BADGES.md", "server/data/level-table.json", "server/data/place-badges.json", "src/levels.ts"],
    blocks: [
      { h: "Levels" },
      { p: "Levels add to monster duel power alongside skill. Equipment stays cosmetic. The table comes straight from `server/data/level-table.json`, the file the server uses." },
      { table: { head: ["Level", "XP needed", "Unlock", "Level Aura"], rows: levelRows } },
      { p: "A linked NEAR account shows its own confirmed XP, read from the rewards contract." },
      { h: "Season" },
      {
        list: [
          "Two weeks, cosmetic leaderboard. Points: monster hunt 1, zone visit 2, NPC line 3. Goal 30.",
          "Ranks: Explorer, Season finisher (goal), Trailblazer (2×), Season legend (3×). A rank changes how the row looks and nothing else.",
          "Finishers claim a season mark and the season Aura once. Only play counts: never QGOLD, NEAR, stake or purchases.",
        ],
      },
      { h: "Badges" },
      {
        list: [
          `**Place badges:** ${PLACE_BADGES} curated notable places (peaks, viewpoints, landmarks, bigger cities). GPS only, never in the demo. Minted as soulbound NFTs on \`questlayer-badges-20261102.testnet\`.`,
          "**Player badges:** POAP-like soulbound badges players design for places or finished quests, claimed with a server-signed claim.",
          "Badges are decorations: not sellable and never part of the inventory economy.",
        ],
      },
    ],
  },
  {
    id: "npcs-and-monsters",
    group: "play",
    title: "NPCs, monsters and mini-games",
    tldr: "NPCs walk real paths **around the clock** and offer quests, errands, trades and stories. **The server decides every offer; the AI only phrases it.** Monsters are beaten by skill, never by paying or wagering.",
    keyFacts: [
      ["24/7", "NPCs and monsters on the map, day and night"],
      ["1 h", "cooldown after a lost duel"],
      ["1,200 HP", "weekly shared boss"],
      ["12", "element shards a day at most"],
    ],
    hero: "actor-dialog",
    status: "live",
    updated: "2026-11-11",
    sources: ["src/MonsterChallenge.tsx", "src/BossFight.tsx", "src/ChallengeExample.tsx", "docs/NPC-PLAN.md", "src/NpcSheet.tsx", "src/come-back.ts", "src/ActorPortrait.tsx", "src/nearby-action.ts", "src/useFormDraft.ts", "docs/ACTORS-API.md", "docs/MONSTER-CHALLENGES.md", "docs/MONSTER-HUNT.md", "docs/NPC-GAMES.md", "docs/NPC-TRADERS.md", "docs/KEEPER-VAULT.md", "server/actors/service.mjs", "server/npc/service.mjs"],
    blocks: [
      { h: "Who walks the map" },
      {
        table: {
          head: ["Archetype", "What it does"],
          rows: [
            ["Quest giver", "Quest lines and one errand a day; patron lines for stakers. Out day and night, around the clock"],
            ["Storyteller", "Story chapters; a patron chapter for stakers"],
            ["Trader", "Buys and sells Auras on NEAR Intents with a purse that must grow"],
            ["Keeper", "Shows your stake, ceremonies and the inner vault (read-only)"],
            ["Wandering rare", "Rare encounter with a patron option at Tier 3"],
            ["Roamer / guardian / lurker / boss", "Monsters: roam, guard a zone chest, hide by finds, weekly shared boss"],
          ],
        },
      },
      { p: "Reviewed cities have a hand-cast list; every other city and cell gets a generic cast (quest giver, storyteller, wandering rare, one roamer, two lurkers). Day and night casts switch with the real sun." },
      { h: "Encounters" },
      {
        list: [
          "A greeting shows up to two current quest offers with a compact portrait; tapping one calls the real accept endpoint and, once confirmed, returns to the map guided to the first stop.",
          "The full menu, active tasks, trader and keeper surfaces and the chat input sit under More (folded on a phone, open on desktop).",
          "Unsent NPC messages are kept as local drafts per explorer, world and actor; they never store tokens or prove anything.",
          "Nearby Open cues only open the encounter; the server still checks location, timing and availability.",
        ],
      },
      { h: "Monsters" },
      { viz: "monster-flow" },
      {
        list: [
          "Formats: quiz, rhythm, rune path, memory and stance duel. An encounter shows today's formats as icon buttons with a short name (Riddles, Rhythm, Rune path, Rune song, Duel); picking one starts it. Traders and keepers open their counter right away, with no Continue step. Power = level (capped at 20) + skill; Auras never change odds.",
          "A new format can show a short example first (local, no request, no reward). Timed challenges never open help automatically. Touch and keyboard both work.",
          "A loss means a 1 h cooldown; one defeat per monster per day. No wagering of any kind.",
          "A monster or NPC with nothing for you says so and when to come back: after a lost try, the cooldown end; after a win, its first active minute tomorrow (same hours and day/night phase); a beaten weekly boss, next Monday. The server sends the time (`comeBack` on the encounter); the NPC chat stays open.",
          "Rewards: XP, element shards (max 12 a day) and roll tickets from lurkers.",
          "The weekly boss has 1,200 shared HP; each player lands one hit every 10 minutes. Three or more hits on a defeated boss earn the Bossbane Aura once.",
        ],
      },
      { h: "Golden Altar" },
      { p: "The Golden Altar is a crafting spot. An **offering** is what you lay on it: shards plus common Auras, which the altar consumes and turns into one rarer existing edition. Recipes: Wardbreaker (10 shards + 1 common + a guardian win), Polar (6 frost + 1 common), Comet, Storm and Moon (8 element shards + 2 commons + a guardian win). You can make a few offerings a day; the limit rises at L6." },
      { h: "Wisp rolls" },
      { viz: "wisp-roll" },
      { p: "A lurker quiz win earns a roll ticket. The roll runs on chain with commit-reveal and NEAR block randomness, so neither the server nor the player can bias it. Tickets are earned only; nothing can be bought or wagered." },
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
    tldr: `Auras are wearable effects in two slots, ${EDITIONS.length} designs minted as NFTs on NEAR. They **come as rewards**: for quests, from zone chests and monsters, and waiting on the map, more of them in harder places. Chest, level and roll Auras are **secured to your account automatically**, with no wallet pop-up.`,
    keyFacts: [
      [String(EDITIONS.length), "Aura editions"],
      ["Rewards", "the only way Auras enter the game"],
      ["2", "slots: above and below the character"],
      ["2 %", "royalty to the treasury on resales"],
    ],
    hero: "aura-catalog",
    status: "live",
    updated: "2026-11-11",
    sources: ["docs/NATIVE-AURA-CLAIMS.md", "docs/COLLECTIBLES-REVIEW.md", "docs/ASSET-CATALOG.md", "server/data/aura-catalog.json", "server/earned-editions.mjs", "src/Inventory.tsx", "src/MarketBoard.tsx", "src/GoldShop.tsx", "src/AdventureResults.tsx", "src/WearableMoment.tsx"],
    blocks: [
      { h: "Inventory: Wardrobe and Shop" },
      {
        list: [
          "**Wardrobe** shows the character with its two Aura slots, then one grid of everything owned: game Auras, Auras secured on NEAR (wallet badge) and Aavegotchi wearables (Clone tag or gold check). Worn items first; filters All, Auras, Wearables, Worn.",
          "Tap an item for Try it on / Take it off and Sell. Sell asks for a price in QGOLD (1M to 1,000B, the same QGOLD as rewards; 1 NEAR reads as 1B QGOLD and the trade settles in NEAR) and lists the Aura in Shop → Market (a game Aura is secured first). A worn secured Aura must be taken off first.",
          "Unowned editions sit in a separate catalog; catalog art never implies ownership or current availability.",
          "**Shop → Items:** everything QGOLD buys as illustrated cards, priced in QGOLD (emotes, marker frames, lures, trader gear); every purchase burns QGOLD.",
          "**Shop → Market:** every Aura for sale as a card, from the NEAR Intents book (NPC traders included) and the market contract. Filters All, Above, Below, Mine; sort by newest, name, rarity or price. Buying signs with the explorer account; card prices are rounded up to 4 decimals. Before a buy the game checks the paying account: with no explorer account yet or too little NEAR (price plus a little gas; wNEAR already in Intents counts), **Buy** opens a **Why you can't buy this yet** dialog instead of an error. It is one line (what the payment needs and what you have, in QGOLD, paid in NEAR) and one main button: **Use my QGOLD** when your QGOLD covers it, otherwise **Get test NEAR** or **Connect a NEAR wallet**; Copy address and Check again sit below, and **More ways** folds the wallets to install (Meteor, HOT, MyNearWallet) and NEAR Intents (opens at mainnet). Market prices read in QGOLD too. The same dialog backs the Intents **Buy** under More trading tools and the Stake page.",
        ],
      },
      { h: "Where Auras come from" },
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
          "Claim-only editions mint only for their claim prefix; chests never drop them.",
          `Auras have no capped supply: they keep appearing as quest and map rewards. The collectibles contract numbers serials without a limit too (upgraded on testnet 12 Nov 2026).`,
          "Earned editions are awarded **once per player ever** (`earned_editions` ledger). Set bonuses are cosmetic.",
          "Confirmed results show the set, serial and edition limit; that limit is never labelled as remaining stock.",
        ],
      },
      { h: "Securing and trading" },
      { viz: "aura-secure" },
      {
        list: [
          "Chest, roll and level Auras are secured automatically: the device key signs `redeem_aura` and the relayer pays gas. A worn Aura waits until it is taken off.",
          "Selling lists the Aura on NEAR Intents (see the Intents chapter). A 2 % NEP-199 royalty goes to the treasury on outside marketplaces such as Mintbase.",
          "Planned: trading real Aavegotchi wearables through the Aavegotchi marketplace and its engine. Today wearables on the map are free clones and originals stay in the wallet.",
        ],
      },
    ],
  },
  {
    id: "wearables-and-explorers",
    group: "play",
    title: "Wearables, explorer cards and your profile",
    tldr: "About **one street find in three** is a free clone of an official Aavegotchi wearable; a linked Base wallet adds a gold check to originals you own. Tap any explorer for a public profile; your own Profile holds your story, your stake and settings.",
    keyFacts: [
      ["≈ 1 in 3", "street finds is a wearable"],
      ["12", "wearable finds per world at most"],
      ["6", "ready wave phrases, no free text"],
      ["512 px", "texture limit so every gotchi fits a phone in 3D"],
    ],
    hero: "wearable-rarity",
    status: "live",
    updated: "2026-11-11",
    sources: ["docs/PLAYER-CARDS.md", "server/gotchi-wearables.mjs", "server/player-waves.mjs", "server/demo-bot-chat.mjs", "src/PlayerCard.tsx", "server/origin-sync.mjs", "server/aavegotchi.mjs", "src/WearableMoment.tsx", "src/Inventory.tsx", "src/OwnedGotchis.tsx", "server/player-journey.mjs", "src/CharacterJourney.tsx", "src/StakeEarn.tsx", "src/FuelTheCity.tsx", "server/gotchi-models.mjs"],
    blocks: [
      { h: "Wearable finds" },
      {
        list: [
          "The catalogue is read from the Aavegotchi contract on Base and the artwork is served from the contract, never copied. A find shows that pixel art inside the rarity ring of its map marker; unreadable art falls back to a sparkle.",
          "Picking one up is a normal street claim (GPS check, travel guard, XP caps). The clone is a database row, never an NFT: not tradable, no QGOLD value. It lands in Inventory → Wardrobe.",
          "One item per slot (head, face, eyes, body, hand, pet), drawn at its official canvas place.",
          "**Verified originals:** link a Base wallet with a signed message and every clone whose original is in that wallet gets a gold check for 24 hours after the last read. Others see only verified, never the address.",
        ],
      },
      { h: "Why Aavegotchi" },
      {
        list: [
          "**Open dataset.** Every wearable, its slot, rarity and pixel art lives openly in the Aavegotchi contract on Base, so the game reads it live instead of drawing or licensing its own catalogue.",
          "**A community that makes games.** Aavegotchi players already build and play games together (the Gotchiverse and many community titles), so QuestLayer joins an ecosystem instead of starting one. The team behind QuestLayer is part of that community.",
          "**It looks good.** The pixel ghosts and wearables read well on a small phone map and match the game's style.",
          "**Room to grow.** Real ownership (originals verified in a wallet), a working renderer for restyled looks, and a marketplace that later lets real wearables move between games. The same ghosts can walk the map, a voxel layer and other community games.",
        ],
      },
      { h: "Your own Aavegotchis" },
      {
        list: [
          "Signing in with an ETH wallet (or linking one) reads its Aavegotchis on Base. You are dressed in the one with the highest rarity score (BRS) unless you chose the starter ghost; Inventory → Wardrobe lists them, best first, to switch in one tap.",
          "The wallet is re-read every few minutes while you play; a gotchi that left the wallet is taken off.",
          "Restyle your gotchi with anything you own (map clones and wallet originals). The outfit is a look in the game only and changes nothing on Base.",
          "**3D:** a Settings switch turns 3D characters on. The official Aavegotchi renderer draws a restyled look (at most once per 15 minutes per look, 40 looks an hour); a new combination shows in 2D until it is ready. Textures are shrunk to 512 px so every owned gotchi fits a phone.",
        ],
      },
      { h: "Explorer cards and waves" },
      {
        list: [
          "Tap any explorer for their profile: name, level, the original Aavegotchi they wear with its BRS, play stats and equipment slots. A gold seal marks an original their wallet holds. A profile never shows a position, a wallet or the rest of a collection.",
          "Waves are six ready phrases. Limits: one per pair per minute, 20 sent and 30 received per hour; deleted after an hour.",
          "**Write a message** opens the encrypted inbox. Block hides presence, notes, waves, messages and the card both ways.",
          "Demo bots in the test world carry a **demo-bot** tag; they take no waves and cannot be blocked. **Message** on a demo bot opens a short demo chat: the bot answers with ready in-character lines, nothing is stored and nothing goes on chain (bots have no inbox key). At most 12 lines a minute.",
          "Without a usable explorer account on this device **Message** stays off and the card says why: still being set up, earned with the first find, or the device is not linked yet (then **Link this device** opens Account and devices for the recovery passkey or, on testnet, a new account).",
        ],
      },
      { h: "Your Profile" },
      {
        table: {
          head: ["Tab", "What it holds"],
          rows: [
            ["Character", "Avatar, level and XP, your totals (finds, quests, tasks, monsters, wearables, badges, QGOLD earned), Badges, a Messages tile for the inbox, and **Your story**: what happened, newest first (`GET /api/me/journey`)"],
            ["Stake", "One screen (Earnings was merged in on 12 Nov). On top, three small numbers: **your QGOLD** (with what the next payout adds), **QGOLD on the map today** and, once you have staked, **from your stake** (the yield kept for you). The page shows at once and fills its numbers as the chain answers: the tier ladder with the **yield share to the prize pool** (25 / 50 / 100 %) right under it, then one **Stake 2 NEAR** button. The first tap sets up your personal vault (a one-time setup fee that is not returned), the next tap stakes; each money step asks for one Yes in a small QuestLayer confirmation window; when staking is not possible yet (no explorer account, too little test NEAR), the button opens a **Why you can't stake yet** dialog instead of an error: the same one-line dialog as in the Market, with one main button (use your QGOLD, get test NEAR or connect a NEAR wallet, which then pays the stake). There is **one stake per explorer**: afterwards the only action is **Withdraw** (about 1–7 days, 4 epochs; the game moves the unlocked NEAR back and you withdraw it to your balance). Once you have staked, a collapsed **Your vault** shows the vault address, owner, validator, staked NEAR and your yield share. Payment receipts live in **Settings → Receipts**. Stake amounts, tier requirements and locked-zone prices read in the same QGOLD as rewards (2 NEAR shows as 2B QGOLD); the payment itself still leaves in NEAR and the signing window shows that."],
            ["Settings", "Game, Help (How to play, the guide, Game economy, first-time tips), Account and devices, Sign out, then the reference links; the reward ledger switch sits in a small Developer section"],
          ],
        },
      },
    ],
  },
  {
    id: "community-local",
    group: "play",
    title: "Community: local chat and places",
    tldr: "Local chat is **the chat of the place you are in**: a distance filter (1–100 km), the most active shouts and topics on top, free messages below. Everything is created from **small dialogs over the map**. Messages and places are free; shouts and topics are paid. Reports and blocks work both ways.",
    keyFacts: [
      ["1–100 km", "how far Local chat reaches"],
      ["1 day · 1 week · keep", "how long a chat message stays"],
      ["7 days", "longest shout"],
      ["6 authors", "make a topic free for good"],
    ],
    status: "live",
    updated: "2026-11-11",
    sources: ["docs/MAP-NOTES-UI.md", "server/social-content.mjs", "server/social-note-expiry.mjs", "server/community-places.mjs", "server/gold-spend/places.mjs", "src/LocalChat.tsx", "src/MapNotes.tsx", "src/gold-map-layer.ts", "src/PlaceMessages.tsx", "src/CommunityPlaces.tsx", "src/MapPeek.tsx", "src/PinLine.tsx"],
    blocks: [
      { h: "Create from the map" },
      {
        p: "Three of the seven items in the map's Actions menu, **Leave a note**, **Open a topic** and **Add a place**, open small dialogs: a pin in the ground, a text field, one switch and one button. The map stays where it was. Community holds the lists: Quests, Tasks, **Local chat**, **Places** and Creators.",
      },
      { h: "Local chat" },
      {
        p: "Local chat reads like the chat of the place you stand in. On top, one **distance filter** (1, 3, 10 (default), 25, 50 or 100 km; the choice is remembered on the device) decides how far away posts may be for everything below it. Then **Active around you**: the most active shouts and topics in that distance as swipeable cards (posts, author, distance), with Shout and Topic buttons and **See all** for every sort (latest, following, popular, recommended). Below it the **Chat**: free messages, oldest at the top and newest at the bottom like a chat, each with the author's avatar, how long ago, and the GPS line. **Write a message** at the bottom opens the small dialog; the message stays pinned where it was written.",
      },
      {
        list: [
          "**Chat messages** (map notes) are free. The author picks 1 day, 1 week (default) or Keep until removed; expired messages leave every list. Authors can edit their own text; pin, photo and time stay.",
          "Every message near you (about 3 km) also stands **on the map** as a small paper pin with its text (your own with a coloured edge), refreshed every 30 seconds and right after you leave, edit or remove one. Tapping a pin opens Local chat with that message highlighted.",
          "Every message shows author, how long ago, time left, the text and a **GPS line** with the pin and its distance. Tapping it shows the spot on a plain map with only the pin and your position.",
          "**Shouts** are short paid bubbles for up to 7 days; a **topic** becomes free for good once 6 different players wrote in it (see Fees and spending). The game checks your QGOLD before anything is paid: if it does not cover the price, you see **Not enough QGOLD in your account** and nothing is taken.",
          "**Keep on NEAR Social** saves a message as your own public record in one tap; the game covers the small storage cost the first time.",
          "**Community places** are free recommendations: nearest first within 10 km, each as a card with a large coloured picture of its kind (view, nature, history, art, food & drink, hidden gem, walk & play) and its distance, kind chips to filter and sorting. Three reports from different players hide a place until a moderator looks. No links, contacts or private addresses; no QGOLD or XP moves.",
          "Demo maps and the real GPS map keep separate messages and places. The test world seeds chat messages around náměstí Republiky and in towns 15–85 km away (Rokycany, Klatovy, Domažlice, Prague), so the distance filter has something to show.",
        ],
      },
      { h: "Quests, tasks and creators" },
      {
        list: [
          "**Quests** is one compact list with filter chips: All, Near me (5 km), Following and Started. Each row shows the quest's pixel icon (visit, trail, chest or story), the creator's own avatar and name, the distance and type on one line, and the price or Free.",
          "**Tasks** lists the QGOLD tasks explorers post for each other in the same rows, with a type badge, who posted it, the reward and places left. **Post a task** takes three short steps; the reward is at least 100 QGOLD per completion and the form says so if it is lower.",
          "**Creators** shows each creator's avatar (their map character), short bio, quests and followers, and a Follow button. Tapping a creator opens their profile as a dialog: level, quests, followers, finished runs and creator XP, a large Follow button, an (i) button with the safety notes and Block, and their quests in the same rows as the Quests list.",
          "The test world adds demo-bot creators, quests and example tasks labelled demo-bot; example tasks hold no QGOLD and cannot be taken.",
        ],
      },
    ],
  },
  {
    id: "player-inbox",
    group: "play",
    title: "Encrypted player inbox",
    tldr: "Private messages between explorers, **end-to-end encrypted on the device** and stored on NEAR Social as ciphertext. Only the two explorers can read them: not other players, not the network, not the game server.",
    keyFacts: [
      ["1–500", "characters per message"],
      ["1 km", "apart: write at once, no request"],
      ["128 B", "padding steps hide the length"],
      ["< 0.01 NEAR", "storage, sponsored by the relayer"],
    ],
    hero: "inbox-seq",
    status: "live",
    updated: "2026-11-11",
    sources: ["docs/PLAYER-INBOX.md", "server/inbox/crypto.mjs", "src/signing-vault/inbox.ts", "server/inbox/service.mjs", "server/inbox/routes.mjs", "src/inbox/Inbox.tsx", "server/relayer/accounts.mjs", "src/DeviceKeys.tsx"],
    blocks: [
      { h: "Where to find it" },
      { p: "The inbox opens from the map's inbox pill, from the Messages tile in Profile → Character and from **Write a message** on an explorer's profile." },
      { h: "Who may write" },
      {
        list: [
          "Explorers **within 1 km** of each other (both sharing a position in the same realm) can write right away, and that conversation stays open afterwards. Farther away, a conversation opens after both **waved at each other** within the last hour, or after one tapped **Ask to message** and the other accepted. A declined request stays declined.",
          "Messages need the explorer account on this device. **Test network:** an account whose keys are on no device you still have, with no recovery passkey (accounts from before the secure signing window, 8 Nov), can **Start with a new account** under Profile → Settings → Account and devices, once a day. Explorer, XP, finds and items stay; tokens on the old NEAR account stay there and the game stops using it.",
          "**Block** stops requests, messages and delivery both ways. Demo explorers cannot write or receive.",
          "Limits: 10 new requests a day (20 unanswered at most), 30 messages an hour and 150 a day per sender, 120 received an hour, one message every 2 seconds per pair.",
          "**Report** discloses the key of that one message only; three different reporters within 7 days pause the sender until a moderator decides.",
        ],
      },
      { h: "How the encryption works" },
      {
        list: [
          "Every explorer has an X25519 inbox key made in the separate secure signing origin; the secret never leaves it. The public key is published at `<account>/questlayer/inbox_key`.",
          "A message is sealed with X25519 + HKDF-SHA256 + XChaCha20-Poly1305 with a fresh key per message and written to `<sender>/questlayer/inbox/msg_<id>`.",
          "On chain anyone sees that the sender wrote, when and roughly how long. The recipient appears only as a tag the two explorers can compute.",
          "The signing origin reads keys and records from NEAR Social itself, so the server cannot swap a key or forge a message. The server keeps only the delivery index.",
        ],
      },
      { note: "The inbox key lives in one browser. A new device can take over for new messages, but older messages stay readable only where they were received. A wallet-based key backup is proposed, not built.", tone: "warn" },
    ],
  },
  {
    id: "virtual-layer",
    group: "play",
    title: "The Layer (virtual voxel world)",
    tldr: "The name says it: every community will build its own **layer**, its own world with its own rules, on the same stake-to-play mechanics and QGOLD. The first is the **Space Layer**, a shared 3D voxel world on testnet with a free home plot for every explorer.",
    keyFacts: [
      ["16 × 16", "free home plot per explorer"],
      ["10", "block types to build with"],
      ["128 blocks", "range to see other explorers"],
      ["0", "coins paid or spent in a layer yet"],
    ],
    status: "partial",
    updated: "2026-11-11",
    sources: ["docs/LAYER.md", "server/layer/world.mjs", "server/layer/store.mjs", "server/layer/routes.mjs", "server/layer/layers.mjs", "src/layer/Layer.tsx", "src/layer/engine.ts", "src/WorldSwitcher.tsx"],
    blocks: [
      { h: "Space Layer today" },
      {
        list: [
          "**Switch:** off unless the server runs with `LAYER_ENABLED=1` (never on mainnet). Then the logo opens a world picker with QuestLayer and the **Space Layer**.",
          "**Play:** walk and jump through one shared 3D world generated from a seed. Every explorer gets a free 16 × 16 home plot in a settlement and builds with ten blocks; only the owner can change a plot. Light pillars lead to beacons that activate when you stand on them. Daily goals: 8 blocks built, 3 beacons.",
          "**Explorers:** others within 128 blocks appear with name and a blocky outfit (six colour sets; an equipped Aura shows as a halo). Positions are kept in memory for 15 seconds and fast jumps are corrected.",
          "**Storage:** SQLite tables for plots, changed blocks, edit receipts and beacon activations. Edits carry a request id, so a retry never applies twice. When the connection or the server fails, the blocks stay and the same request is retried; only a refusal (for example outside your plot) undoes them. Leaving the layer or closing the app still sends unsaved blocks. Others see a plot's new blocks within about 5 seconds. Virtual movement never counts as GPS.",
        ],
      },
      { h: "Community layers (agreed, not active)" },
      {
        list: [
          "Each community gets its own layer: its own seed, name and coin name. The first is Space Layer with the coin MINECOIN.",
          "Every layer uses the QGOLD mechanics; its share of the daily staking yield follows what its players staked, and its coin pays for tasks made in the layer.",
          "A layer can call its coin whatever it likes (MINECOIN, for example), but it is always the same coin: QGOLD, backed by the same vault, at the same rate R.",
          "**None of this is active.** Nothing in a layer pays or costs anything yet: no coin balance, staking, treasury, task payment, XP or items.",
        ],
      },
    ],
  },
  // ----------------------------------------------------------------- world
  {
    id: "world-and-places",
    group: "world",
    title: "Cities, cells and places",
    tldr: `${cityNames} is the reviewed city; the reward map covers **all of Czechia** and street cells everywhere else get live OpenStreetMap quests and backed coins; prepared Atlas discoveries can open in other supplied regions with personal XP only. Every quest place sits on a public path and passes a safety filter.`,
    keyFacts: [
      [String(LIVE_CITIES.length), `reviewed live city (${cityNames})`],
      ["≈ 290,000", "places in the first Czech import"],
      ["40 m", "max snap to a public path"],
      ["27", "EU countries in the first Atlas collection"],
    ],
    hero: "coverage-tiers",
    status: "live",
    updated: "2026-11-13",
    sources: ["docs/WORLDS-PLAN.md", "docs/POI-PIPELINE.md", "scripts/poi/demo-cities.mjs", "scripts/poi/demo-capitals.json", "docs/POI-SAFETY.md", "docs/WORLD-COVERAGE.md", "docs/SECOND-CITY-PLAYBOOK.md", "docs/WORLD-WORKER.md", "docs/OPERATOR-WORLD-CONTROLS.md", "docs/GLOBAL-WORLD-PREPARATION.md", "server/world-preparation/worker.mjs", "server/world-preparation/geography.mjs", "server/world-preparation/export.mjs", "server/world-preparation/collector.mjs", "server/world-preparation/launch-scope.mjs", "server/world-preparation/source-audit.mjs", "server/global-activities.mjs", "server/data/cities.json", "server/spatial/auto-cities.mjs", "server/poi/index.mjs"],
    blocks: [
      { h: "Coverage tiers" },
      {
        table: {
          head: ["Tier", "What", "Content", "Money"],
          rows: [
            ["A · reviewed city", "Hand-checked city pack (Plzeň)", "Six city zones, cast NPCs, POI quests", "Funded NEAR days"],
            ["B · auto city", "GeoNames towns ≥ 15,000 people in Czechia (85 cities) and demo cities abroad (28 from New York to Sydney, plus the capital of every country and every US state)", "Zones with an Unverified map notice, generic cast, POI quests, street coins", "No funded NEAR days"],
            ["C · street cell", "Every H3 res-7 cell", "Up to 6 POI quests, generic cast, cell zones", "Map rewards plan"],
          ],
        },
      },
      { h: "The POI pipeline" },
      { viz: "poi-pipeline" },
      {
        list: [
          "A weekly worker builds a SQLite file from OpenStreetMap (ODbL), Overture (CDLA-P-2.0) and Wikidata (CC0). The first Czech import held about 290,000 places, 198,000 of them quest-ready.",
          "Every place is snapped within 40 m of a public path and kept 25 m from excluded areas (schools, private grounds, dangerous sites), with stable reason codes.",
          "The game reads the file read-only; a missing file simply means no POI quests.",
          "Demo cities abroad (New York, San Francisco, London, Berlin, Zürich, Lisbon, Singapore, Kuala Lumpur, Cochabamba, Paris, Zug, Amsterdam, Toronto, Mumbai, Bengaluru, Tokyo, Seoul, Taipei, Hong Kong, Buenos Aires, Chicago, Barcelona, Warsaw, Denver, Bangkok, Ho Chi Minh City, Lagos, Sydney): the same worker cuts an 8 × 8 km OpenStreetMap clip around a central square or park and builds POI quests, offline street paths and an auto city with Tier 1–3 zones from it. Zone prizes stay 0; street coins come only from the shared daily budget.",
          "The same worker also prepares the capital of every country and of every US state (a 6 × 6 km clip each), plus the main city where a country splits its capital, such as La Paz, Abidjan or Istanbul.",
        ],
      },
      { h: "Daily preparation" },
      {
        list: [
          "A worker prepares today's and tomorrow's geography per local date under a database lease: six separated zones, targets and opening windows. Preparation creates no money; funding is a separate step.",
          "Daylight-saving days keep their real 23 or 25 hours.",
          "An operator with server access can pause a day or zone, close a place or adjust a future unpublished day. There is no web route for these changes.",
        ],
      },
      { h: "Global Atlas discoveries" },
      {
        list: [
          "With a connected geographic catalog, a background worker prepares mapped zones and Atlas quests for today and tomorrow before players load them. Only a completely imported UTC day opens; an interrupted import resumes without duplicates.",
          "Everywhere on Earth the normal street world takes over whenever no prepared day covers the spot. Outside Czechia its places come live from OpenStreetMap: one query per cell, the same taxonomy and safety filter as the import, kept for a week. `GLOBAL_STREET_FALLBACK=czechia` limits this to Czechia, `=off` disables it.",
          "Atlas visits and three-stop hunts use the normal GPS checks and give personal XP. Without a separately confirmed financial day they promise no money or item.",
          "The launch selection covers European and US extracts with national-capital footprints elsewhere (Russia, North Korea and Iran excluded). The first active phase is EU-only: all 27 member countries. Completing it never reports a complete planet.",
          "A bulk collector continues from verified map downloads to real polygon selection and isolated checks, and reports unsafe or oversized areas instead of dropping them. This is map-derived coverage, not field verification.",
        ],
      },
      { h: "Theme layers, day and night" },
      {
        list: [
          "A world layer is a JSON pack (default `aavegotchi-v1`) that sets actor models, object kinds and design tokens. Layers never create money: the validator refuses any pack whose rewards are not `none`.",
          "The map follows the real sun at the city (day, dusk, dawn, night), and actors have day, night or any-time casts.",
          "Buildings rise in 3D up to 16 m so pins stay readable over the roofs. Churches, castles and monuments keep their real height from OpenStreetMap (St. Bartholomew in Plzeň: 102 m) or are lifted to at least 22–30 m, in a warmer colour, so you can find your way by them.",
        ],
      },
    ],
  },
  {
    id: "map-rewards",
    group: "world",
    title: "Map rewards plan",
    tldr: "One plan a day for all **16,346 cells of Czechia**, built from the real budget: every coin of the day is backed and worth the same, and the plan's Merkle root is published so anyone can check a cell.",
    keyFacts: [
      ["16,346", "cells in Czechia"],
      ["400", "coin shares per cell (pioneer cell 800)"],
      ["≤ 50 %", "of zone prizes steered by votes"],
      ["1 %", "of the zone budget per cell at most"],
    ],
    hero: "map-formula",
    status: "live",
    updated: "2026-11-11",
    sources: ["docs/MAP-REWARDS.md", "docs/GLOBAL-TREASURY.md", "server/map-rewards/policy.mjs", "server/map-rewards/budget.mjs", "server/map-rewards/chain.mjs"],
    blocks: [
      { h: "How a day is planned" },
      {
        list: [
          "At the first request of a local day the server builds the plan once from the **real daily budget**: the map's share of the rewards contract's per-date cap, priced in micro-QGOLD at the vault's rate R.",
          "**Few coins, each worth something.** One coin = the day's coin budget ÷ 200 (`MAP_COIN_TARGET`). An opened street cell places 10 coins, the Plzeň city demo 50, and placement stops once the whole day budget is on the map, so every coin is covered. With yield-only days (`NATIVE_YIELD_BACKED_DAYS=1`) the budget is the day's drip of realized staking yield, shared with city days: 0.0005 NEAR for coins at 1 QGOLD = 1 microNEAR is 500 QGOLD, 2.5 QGOLD a coin.",
          "Zone caps: at most 1 % of the zone budget per cell and 25 % per H3 res-5 area; what a capped cell cannot take goes to the others.",
          "**Pioneer cells** (nobody visited for 30 days) show gold fog; their first drop pays two shares per coin and adds a pioneer chest.",
          "The city demo pays the same backed coins. Outside Czechia a street cell gets up to 10 coins of the same value, drawn from the same day budget until it is placed, and paid through the payout rounds (`MAP_WORLD_COINS=off` stops it). Funded cell zones and pioneer bonuses stay in Czechia.",
        ],
      },
      { viz: "map-coins" },
      { h: "Proof on chain" },
      { viz: "map-merkle" },
      {
        list: [
          "One leaf per funded cell, sorted, hashed with sha256. `GET /api/map/rewards/day` shows the root, `GET /api/map/rewards/proof?cell=` a leaf and its proof.",
          "The map-day contract supports `publish_map_day`, `claim_map` and `close_map_day`. While payout rounds run, map days record budgets without per-coin `claim_map`; see Daily QGOLD payouts.",
          "Each published day holds 256 storage slots (≈ 2.6 NEAR) until it is closed.",
        ],
      },
      { h: "Caps grow with the treasury" },
      {
        list: [
          "The rewards contract caps each date at **max(0.1 NEAR, 10 % of each bucket's funding)**.",
          "City days together take at most max(0.006 NEAR, 4 % of a bucket's funding); a map day at most half of the date cap, within what city days left.",
          "With 1,000 NEAR funded a date may commit 50 NEAR per bucket: 20 to cities, 25 to the map.",
        ],
      },
      { h: "Plzeň's native days" },
      { p: "The reviewed city also publishes native NEAR days: exactly six slots with fixed coin denominations and backed reservations, funding split 50/50 between street coins and zones. A published day is never rewritten. The daily budget is split between live cities by demand (1 + distinct claimers in the last 7 days)." },
    ],
  },
  // --------------------------------------------------------------- economy
  {
    id: "economy",
    group: "economy",
    title: "The money model",
    tldr: "Stake-to-play, PoolTogether style: stakers keep their principal, a chosen share of the yield goes to **one global treasury**, and its daily budget is collected by players as coins and prizes. Fees add to it; principal is never spent. **Nobody pays to win.**",
    keyFacts: [
      ["1", "global treasury, no city pots"],
      ["100 %", "of map coins backed by NEAR"],
      ["yield only", "is spent; principal stays"],
      ["0", "paid chance, streaks or energy"],
    ],
    hero: "money-flow",
    status: "live",
    updated: "2026-11-11",
    sources: ["docs/GLOBAL-TREASURY.md", "docs/ECONOMY-RULES.md", "docs/ECONOMY-PAGE.md", "IMPLEMENTATION-PLAN.md", "server/native/public-ledger.mjs"],
    blocks: [
      { h: "The rules" },
      {
        list: [
          "**No paid chance.** Randomness is free or earned (wisp rolls, chests), never bought or wagered.",
          "**No streaks, energy or loot purchases.** Spending only burns your own QGOLD (`ft_burn`) for cosmetics and conveniences; the backing stays in the vault, so every burn raises R for all holders.",
          "**No practice money and no welcome credit.** A new explorer starts at 0 QGOLD; every coin and zone prize is backed by the day's budget and paid as QGOLD within minutes.",
          "**Players never fund the prizes.** Stake principal stays yours; only the yield share you choose goes to the game.",
          "**City days run on yield only** (`NATIVE_YIELD_BACKED_DAYS=1`, set in the testnet unit since 13 Nov 2026, after the first realized yield reached the treasury). A day may spend one seventh (`NATIVE_YIELD_DRIP_DAYS`) of the realized staking yield that is still free: what the vaults paid into the pool, minus what open yield days hold and what closed ones actually awarded. Yield arrives in lumps every few epochs, so the drip keeps every day funded, however small the coin. A date that cannot be funded shows in `/api/health` under `unfundedDays`. Map coins take their drip from the same yield (map days count against it first).",
          "Unclaimed budget stays for later days. Money follows players, not cities.",
          "Everything is published: [Economy](/economy) lists treasury, audits and payouts with transaction links; [Treasury](/treasury) shows the dashboard.",
        ],
      },
      { note: "This page runs on NEAR testnet. Test NEAR has no monetary value; mainnet needs an explicit go from the owner plus external review of the new contracts.", tone: "warn" },
    ],
  },
  {
    id: "treasury-and-yield",
    group: "economy",
    title: "Treasury, yield and the mix",
    tldr: "Target since 11 Nov 2026: **90 % staked NEAR, 5 % USDC, 5 % USDT** (on Rhea Lend), because on testnet only validator staking earns; it applies once the DAO council adopts it. A DAO-approved daily run rebalances within hard limits; only the yield becomes the map budget.",
    keyFacts: [
      ["90 / 5 / 5", "% target: staked NEAR / USDC / USDT"],
      ["40 %", "max with any one protocol"],
      ["25 %", "of the treasury moved per run at most"],
      ["3 points", "of drift before a rebalance"],
    ],
    hero: "treasury-mix",
    status: "live",
    updated: "2026-11-11",
    sources: ["docs/STNEAR-TREASURY.md", "docs/TREASURY-MIX.md", "docs/TREASURY-PAGE.md", "docs/YIELD-VAULT.md", "docs/YIELD-VAULT-PLAN.md", "docs/NATIVE-REWARDS-AND-VAULT.md", "docs/LIQUID-STAKE.md", "server/native/treasury-mix.mjs", "scripts/faucet-to-treasury-testnet.mjs", "scripts/treasury-stake-testnet.mjs"],
    blocks: [
      { h: "Limits" },
      {
        table: {
          head: ["Limit", "Value"],
          rows: [
            ["Max per protocol", "40 % (each validator pool is its own protocol; USDC + USDT both count as Rhea Lend)"],
            ["No supply when market utilization is", "≥ 95 %"],
            ["Max moved per run", "25 % of the treasury"],
            ["Rebalance when drift exceeds", "3 percentage points"],
          ],
        },
      },
      { p: "**Staked NEAR** sits in the treasury's keyless staking vaults (validator pools, 100 % of the yield to the prize pool). The mix counts these positions, valued at staked + unstaked, but never moves them: new stake goes through the staking script, spread over several validators. The liquid rest (stablecoins, liquid staking tokens, wNEAR) is what a daily run rebalances; with most of the treasury staked, its drift is measured against the liquid part. The stablecoin share is split evenly between USDC and USDT." },
      { p: "Order of a daily run: harvest stNEAR growth above the principal, rebalance toward the target, keep the reserve. The target is the mix the treasury DAO adopted, and a rebalance runs only on a day whose run the DAO approved (see the next chapter). The live split comes from `/api/treasury/mix`." },
      { p: "The daily run is a timer on the game server (06:30 Prague time, plus an hourly retry of the rebalance once the DAO approved the day), not on anyone's laptop. It signs with a dedicated **treasury-ops** account that holds only the mix and its gas, and with DAO-only function-call keys for the keeper and the council; the operator key that deploys the contracts never leaves the owner's machine." },
      { h: "From yield to a daily budget" },
      { p: "Try it: the treasury size and the yield of the 90 / 5 / 5 mix decide how much the map can pay every day without touching principal. On testnet only validator staking earns (about 9.8 % a year), so the stablecoin slider starts at 0." },
      { viz: "yield-sim" },
      { h: "Three yield sources" },
      {
        list: [
          "**stNEAR treasury.** The treasury-ops account holds stNEAR (Meta Pool). Harvest sells only growth above the recorded principal and funds the rewards contract (`fund_rewards`, source sponsor).",
          "**Yield vault** `questlayer-yield-20261102.testnet`. Deposit stNEAR, LiNEAR, USDC or USDT and you are a Staker at once; withdrawal opens after 24 h. Stables keep a 20 % buffer and are lent to Rhea only below 95 % utilization and never while a Rhea withdrawal is still on its way back.",
          "**Staking vaults.** A personal keyless vault per player stakes NEAR with a validator and gives a chosen 0–100 % share of the yield to the game. Harvest → unlock (4+ epochs) → withdraw → flush to the treasury, all permissionless. A lost callback can be settled by anyone after 2 epochs (`recover_stuck`), never paying twice.",
        ],
      },
      { viz: "staking-vault" },
      { h: "Funding and proof" },
      {
        list: [
          "The first prize day paid entirely from realized staking yield was proven on testnet (day `plzen-2026-11-05-v2`, `public/native-yield-day-proof.json`).",
          "Testnet LST prices are frozen, so stNEAR growth there is zero; mainnet LSTs earn about 4 %. Testnet lending (Burrow/Rhea) pays about 0 % too.",
          "**Treasury staking vault** `stake-20261111.questlayer-dev-20261101.testnet` (setup started 11 Nov): the one testnet asset that really earns. Faucet test NEAR is staked with the Stakely validator (3 % fee, about 9.5 % APR, rewards every ~7 h epoch) through a keyless vault that gives **100 %** of its gain to the treasury. The principal is never counted as yield; only realized validator rewards reach the prize pool, each step a public transaction (`scripts/treasury-stake-testnet.mjs`, record `public/treasury-stake-testnet.json`). The pool unlocks unstaked NEAR only after 4 epochs, so further vaults staked one epoch apart take turns and bring fresh yield about every epoch; unclaimed rewards return to the treasury and are offered again in later days, never restaked.",
          "An operator script can sweep throwaway testnet faucet accounts (12 × 10 test NEAR) into the rewards contract as sponsor funding (`fund_rewards`) and then delete them.",
          "A keyless vault never changes code after creation; the yield vault gets fixes only by an in-place upgrade that must leave every position byte for byte unchanged.",
        ],
      },
      { p: "The [Treasury](/treasury) page shows all of this live. The headline adds up the three on-chain accounts that hold the game's NEAR (treasury, prize pool, QGOLD vault), each linked to the NEAR explorer, next to a QGOLD ⇄ NEAR swap card. Overview has a four-step animated loop, a one-year projection at today's yield (staked NEAR at an estimated validator rate after the pool fee, stablecoins at Rhea's live rate), the mix, the treasury history from 1 Nov 2026 (the 31 Oct pilot test is left out of all public history) and an FAQ accordion; numbers carry an info button that explains them. Further tabs: Vote, Money flow, QGOLD, Model and Safety." },
    ],
  },
  {
    id: "treasury-dao",
    group: "economy",
    title: "Who decides: the treasury DAO",
    tldr: "Explorers vote every week on how the treasury is held, one explorer one vote. A **Sputnik DAO** council approves every daily run, and only after checking it against the adopted mix and the safety limits.",
    keyFacts: [
      ["2 of 3", "council approvals pass a proposal"],
      ["L3+", "and played in the last 7 days to vote"],
      ["3", "mix options each week"],
      ["1 : 1", "one explorer, one vote; XP cannot be bought"],
    ],
    hero: "dao-flow",
    status: "live",
    updated: "2026-11-11",
    sources: ["docs/TREASURY-DAO.md", "docs/TREASURY-WORKERS-VPS.md", "server/native/treasury-dao.mjs", "scripts/treasury-dao-testnet.mjs", "scripts/treasury-worker-vps.sh", "src/economy/TreasuryVoteCard.tsx"],
    blocks: [
      { p: "The treasury follows a stock **Sputnik DAO v2**, `questlayer-treasury.sputnik-v2.testnet`, with the role names Trezu uses: a keeper that only files proposals (Requestor), a council of three that approves with **2 of 3** (Admin, Approver), and **Explorers**, the players who may vote." },
      {
        table: {
          head: ["Step", "Who", "On chain"],
          rows: [
            ["Weekly mix vote opens (Monday)", "keeper", "one `Vote` proposal per option; the recommended option gets one automatic vote"],
            ["Explorers vote", "players at level 3+ who played in the last 7 days", "`act_proposal(VoteApprove)` from the explorer account, sponsored, no pop-up"],
            ["Tally (next Monday)", "keeper files the result, council approves", "an approved Adopt treasury mix proposal with the counts"],
            ["Every morning", "keeper files the day's run, two council keys approve", "the run happens only once it is approved"],
          ],
        },
      },
      {
        list: [
          "**Options** (staked NEAR / stablecoins / NEAR reserve): Staking first 90 / 10 / 0 (recommended, the stables split 5 % USDC + 5 % USDT), More stables 70 / 20 / 10, Bigger reserve 60 / 20 / 20. Every option stays inside the treasury limits. Polls filed before 11 Nov 2026 (50 / 40 / 10 and friends) still tally to their own targets.",
          "**Owner decision:** `treasury-dao-testnet.mjs adopt <preset> --execute` has the council adopt a preset at once (prepared on 11 Nov 2026 for 90 / 5 / 5); it closes this week's open mix poll and re-files today's run with the new target.",
          "**Checked automatic approval:** the council keys approve a daily run only when its target is the adopted mix and it moves at most 25 % of the treasury.",
          "Extra votes of the week appear under the mix vote and are counted the same way. New voters join the DAO once a day.",
          "Custody stays with the treasury-ops account on testnet for now; the DAO decides the target and approves every run. The QGOLD vault council moves to the DAO next.",
          "**Where it runs:** the keeper and the automatic council keys run on the game server every morning, each a function-call key that can only file or vote on DAO proposals. If only council-a runs there, the second approval comes from the owner (`approve-pending` re-checks every open proposal first) and the day's rebalance waits for it.",
        ],
      },
      { p: "Vote on the [Treasury](/treasury#vote) page, tab **Vote**: each option shows its mix, votes and tags, and an explorer signed in on that device votes right there with no wallet popup. The same tab shows who decides and the decision log." },
    ],
  },
  {
    id: "qgold",
    group: "economy",
    title: "QGOLD token and vault",
    tldr: "QGOLD is the gold you earn, always fully backed by NEAR in one vault contract. **R = backing ÷ supply**: mints keep R flat, burns and fees raise it, and there is **no admin withdraw**. New QGOLD's NEAR comes from treasury yield; stablecoins steady the treasury, not the vault.",
    keyFacts: [
      ["1 NEAR", "starting backing per 1B QGOLD"],
      ["±1 %", "to buy from or sell to the vault"],
      ["5 % / 24 h", "of the backing as instant exits"],
      ["0", "access keys on the vault account"],
    ],
    hero: "qgold-sim",
    status: "live",
    updated: "2026-11-13",
    sources: ["docs/QGOLD-VAULT.md", "docs/QGOLD-MARKET.md", "contracts/qgold/src/lib.rs", "server/qgold/keeper.mjs", "server/qgold/token-page.mjs"],
    blocks: [
      { p: "**One coin, many names.** The game shows one name, QGOLD, everywhere, and every layer may give it its own name (Space Layer plans MINECOIN). Whatever the label, it is the same QGOLD token with the same backing and the same rate R." },
      { p: "**One unit on screen (13 Nov).** Every screen counts QGOLD in its smallest unit, so **1 NEAR ≈ 1B QGOLD**: Stake, the map, [Treasury](/treasury) and [Economy](/economy) all show the same numbers. The vault's rate R is per whole token (1,000,000 units), so the pages show it per 1B QGOLD (about 1.02 NEAR today); the swap card reads \"1B QGOLD = … NEAR\" and takes amounts like 967.5M. Profile → Stake → On the map today and Treasury → Today on the map → Coins are the same number (the coins placed on today's map). Display only: the token, R and the economy are unchanged." },
      { h: "Actions" },
      {
        table: {
          head: ["Action", "Who", "Price", "Fee"],
          rows: [
            ["`mint_for` (pay out a coin)", "Only the rewards contract", "exactly R", "none"],
            ["`deposit` (buy at the vault)", "Anyone", "R + 1 %", "1 %"],
            ["`redeem` (sell back)", "Holder, own balance only", "R − 1 %", "1 %"],
            ["`ft_burn` (spend in game)", "Holder", "–", "burned: R rises for everyone"],
          ],
        },
      },
      { h: "Exits and safety" },
      { viz: "qgold-exit" },
      {
        list: [
          "Instant exits: at most 5 % of the backing per 24 h (at least 1 NEAR) and 1 % per account (at least 0.2 NEAR). The rest queues for a 24–48 h safe window; `claim_exit` pays only the account that burned.",
          "After every change the contract asserts balance ≥ backing + insurance + treasury due + queued exits + storage; if anything drains NEAR, the vault freezes.",
          "10 % of fees build an insurance fund; `reconcile` books a loss against insurance first and refills R to its peak.",
          "A guardian can pause for at most 72 h, once per 7 days. Upgrades and parameter changes need the council multisig and a 48 h timelock.",
        ],
      },
      {
        note: "Pending upgrade on testnet: council proposal 4 (executable from 11 November 2026, 23:52 UTC) moves the vault to the reviewed build with a dust-supply rule (a burn leaves no supply or at least 1 QGOLD), a 0.005 NEAR storage bond on queued exits, an operating-balance refill (`fund_operating`) and a timelock the council can set (10 min–48 h on testnet, 24–48 h elsewhere). Until it is applied, the deployed build and its 48 h timelock are in force.",
      },
      { h: "Market and keeper" },
      { viz: "qgold-keeper" },
      {
        list: [
          "A Rhea (Ref) testnet pool #2895 pairs wNEAR and QGOLD near R + 1 %.",
          "A keeper acts at 12 secret times a day, committed in advance and revealed from NEAR block randomness: buy-and-burn below R, buyback-and-burn from 20 % of fees below 1.1 R, sales on a 1.1 / 1.2 / 1.3 R ladder above it. It stays idle while the pool is too small.",
          "The keeper records each step before spending, so a restart never repeats a purchase; uncertain outcomes wait for reconciliation.",
        ],
      },
      { note: "QGOLD is not an investment product. The vault is unaudited testnet code; mainnet needs an external audit and a legal opinion.", tone: "warn" },
    ],
  },
  {
    id: "fees-and-spending",
    group: "economy",
    title: "Fees, spending and the task market",
    tldr: "Every fee goes to the treasury and comes back through the daily budget. QGOLD buys cosmetics and conveniences, and **every purchase burns QGOLD on chain**. Tasks, Secrets and conditional sends settle in a QGOLD escrow.",
    keyFacts: [
      ["10 %", "on top of a paid task's reward"],
      ["2 %", "on Aura trades"],
      ["90 %", "of a Secret's reveal price to its creator"],
      ["0 %", "on sends, earning and spending"],
    ],
    hero: "fees",
    status: "partial",
    updated: "2026-11-11",
    sources: ["docs/GOLD-SPENDING.md", "docs/TASK-MARKET.md", "docs/QGOLD-ESCROW.md", "docs/CREATOR-BONUS-VOTE.md", "server/data/creator-xp.json", "server/creators/creator-xp.mjs", "docs/NATIVE-TASK-ESCROW.md", "docs/NATIVE-TASKS-UI.md", "CREATOR-ECONOMY-PLAN.md", "server/data/gold-spend.json", "src/signing-vault/policy.ts", "src/GameMap.tsx"],
    blocks: [
      { h: "What QGOLD buys (every spend is a burn)" },
      { viz: "gold-prices" },
      {
        list: [
          `Emotes: ${GOLD.emotes.free.length} free; premium ones are shown to others for ${GOLD.emotes.showSeconds} s (${premiumEmotes}).`,
          `NPC gear: one chest-edition Aura a day from a trader (rare ${GOLD.gear.price.rare.toLocaleString("en-US")}, epic ${GOLD.gear.price.epic.toLocaleString("en-US")} QGOLD).`,
          `Lures: ${GOLD.lures.minutes} minutes, GPS only, ${GOLD.lures.hours.join("–")}, at least ${GOLD.lures.spacingM} m apart, snapped to a safe place within ${GOLD.lures.poiSnapM} m. They attract actors and never change odds.`,
          "Place messages: paid shouts live up to 7 days; a topic with posts from 6 distinct authors becomes free and is archived after 90 days without activity.",
          "Every spend calls `ft_burn` from your own account (sponsored, no pop-up), the server verifies it on chain, and only then the purchase happens. One saved reference follows each purchase from quote to delivery; retries return the saved result.",
        ],
      },
      { h: "Tasks, Secrets and conditional sends" },
      {
        list: [
          "A poster pays the reward plus 10 % on top. The fee reaches the treasury only on payout; a refund returns both.",
          "**Secrets:** a creator hides a place; finders pay to reveal it and the creator gets 90 % after a GPS visit or 7 days without dispute. A sponsor can prepay finder rewards so the reveal is free.",
          "**Conditional sends:** escrow that releases on a condition, no fee.",
          "Open tasks (scroll pin) and Secrets (magnifier pin at the centre of their fog circle, never the hidden place) show on the GPS map and open in Explore · Nearby.",
          "Funds move with one sponsored `ft_transfer_call` from your account into the QGOLD escrow; with the secure account the approval window names contract, method, amount and payee. The server confirms the exact payment before opening anything.",
          "The game server is the escrow's publisher: it approves GPS-checked or reviewed completions and pushes each payout (`withdraw_for`). It can only pay the named counterparty or refund the funder; the escrow has no admin withdrawal and no access keys.",
          "One escrow task pays at most 50 completions, each account once. A proof waiting for review holds its slot, so a poster cannot cancel it away.",
          "Failed transfers keep the credit and retry after verification; only payments with an unknown outcome pause the queue.",
          "The funder holds a small NEAR storage deposit on the escrow (about 0.01 NEAR per agreement record); the relayer can top it up in 0.05 NEAR steps, at most 0.5 NEAR.",
          "**Community · Tasks** is one list of these player tasks: open nearby, the ones you are taking, the ones you posted, and a type filter. Every row shows who posted it with their avatar. The older practice-QGOLD tasks and the separate sponsored NEAR task contract are no longer in the app.",
        ],
      },
      { h: "Creators" },
      {
        list: [
          "Players publish their own quests after a moderator review. A live quest holds 200 earned XP (testnet), returned when it closes.",
          `**The game pays creators in XP, never in QGOLD:** a first publication earns ${CREATOR_XP.publish.story} XP for a story, ${CREATOR_XP.publish.visit} for a visit, ${CREATOR_XP.publish.chest} for a chest and ${CREATOR_XP.publish.trail} for a trail (+${CREATOR_XP.trailStopBonus} per stop after the second), and every completion by another explorer adds ${CREATOR_XP.completion} XP, up to ${CREATOR_XP.completionsPerDay} a day. That makes building quests the best XP source in the game.`,
          "A creator earns QGOLD only from QGOLD they put into a quest themselves (a paid task or a sponsored Secret).",
          "The daily creator-bonus vote is no longer shown in the app (11 Nov 2026). Without votes the server gates nothing, so every community quest counts the same.",
        ],
      },
    ],
  },
  {
    id: "staking-and-gates",
    group: "economy",
    title: "Staker step, tiers and patron perks",
    tldr: `Stake **${STAKER_MIN_NEAR} NEAR** (about 5 €) to become a Staker; Tier 2 and Tier 3 follow your weighted stake. Perks open by step **and** level, are things to do or wear, and never change odds or payouts. Your principal stays yours.`,
    keyFacts: [
      [`${STAKER_MIN_NEAR} NEAR`, "matured stake for the Staker step"],
      ["10 / 50 NEAR", "for Tier 2 / Tier 3"],
      ["0–100 %", "of your yield you choose to give"],
      ["60 epochs", "to the top patron rank, Hearthfire"],
    ],
    hero: "staker-ladder",
    status: "live",
    updated: "2026-11-05",
    sources: ["docs/KEEPER-VAULT.md", "docs/LIQUID-STAKE.md", "docs/NATIVE-STAKING-FOUNDATION.md", "server/data/staker-gates.json", "server/staker-gates.mjs", "server/npc/patron-rank.mjs"],
    blocks: [
      { h: "Perks by step and level" },
      { table: { head: ["Perk", "Step", "Level"], rows: gateRows } },
      { p: "A yield-vault deposit makes you a Staker at once. Content opens by step and level so beginners are never blocked. Tier 2 places on the map are open to everyone until launch; Tier 3 places stay locked until the vault shows Tier 3." },
      { h: "Patron rank" },
      { viz: "patron-rank" },
      {
        list: [
          "Rank 0 is the Staker step. One point per epoch of matured stake climbs Spark (1), Ember (4), Lantern (14), Beacon (28), Hearthfire (60). There is no decay.",
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
    tldr: `Ownership and money settle on **NEAR testnet** across ${CONTRACT_ROWS.length} project contracts. GPS fixes never go on chain: only a ~150 m cell and a hash of the evidence. Every contract build is reproducible and its hash pinned.`,
    keyFacts: [
      [String(CONTRACT_ROWS.length), "project contracts on testnet"],
      ["≈ 150 m", "geohash cell on chain, never the GPS fix"],
      ["4", "stages of the proof icon"],
      ["0", "contracts on mainnet yet"],
    ],
    hero: "chain-states",
    status: "partial",
    updated: "2026-11-11",
    sources: ["docs/CHAIN-PROOF.md", "docs/CHAIN-LEDGER.md", "docs/NEAR-INTEGRATION-STATUS.md", "docs/MAINNET-PLAN.md", "contracts/wasm-sha256.json", "src/ChainLink.tsx", "public/native-qgold-escrow-testnet.json", "public/native-rewards-testnet.json", "public/native-tasks-testnet.json"],
    blocks: [
      { h: "What settles where" },
      { viz: "chain-split" },
      { h: "Contracts on NEAR testnet" },
      { table: { head: ["Contract", "Account", "Role"], rows: CONTRACT_ROWS } },
      { p: "Profiles, map-note records and the encrypted inbox are written to NEAR Social (`v1.social08.testnet`), a shared contract the project does not run. The player factory and the relayer are accounts, not contracts." },
      { note: "Mainnet: nothing is deployed yet. Every contract goes to mainnet only with the owner's explicit go; the one-command deploy covers collectibles, the player factory and relayer, badges, NPC games and the stNEAR treasury today. Sponsored actions are capped at 2 NEAR a day (500 operations).", tone: "warn" },
      { note: "Retired: the first-alpha game contract `game.questlayer-dev-20261101.testnet` (10 November 2026) and the first QGOLD escrow `questlayer-qgold-escrow-20261105.testnet`, which is empty. The live game never called the game contract; its source and WASM pin stay in the repository as history." },
      { h: "The proof icon and the QXP ledger" },
      {
        list: [
          "One cube icon follows every on-chain action through four stages, from signing to final.",
          "Every earning action (coin, find, quest, chest, clue, monster, boss, errand, board, roll) can be recorded with its XP, a **geohash-7 cell (about 150 m)** and the sha256 of the evidence.",
          "Daily Merkle roots let anyone verify a record against the day. Players without a NEAR account are back-filled once they register.",
        ],
      },
      { h: "Reproducible builds" },
      { p: "Every contract WASM is built in Docker (Rust 1.97.0, linux/amd64) and its sha256 is pinned in `contracts/wasm-sha256.json`. CI fails when a build or a deployed manifest does not match. Collectibles changes also need an independent re-review." },
    ],
  },
  {
    id: "daily-payouts",
    group: "chain",
    title: "QGOLD payout rounds",
    tldr: "Every 5 minutes the reward worker sums what each account earned, publishes **one Merkle root** for the round, and the rewards contract mints each account's QGOLD. Nothing is paid twice and nothing is lost.",
    keyFacts: [
      ["5 min", "between payout rounds on testnet"],
      ["8", "accounts per claim transaction"],
      ["262,144", "accounts per day at most"],
      ["3 days", "before a fully paid day can close"],
    ],
    hero: "payout-round",
    status: "live",
    updated: "2026-11-11",
    sources: ["docs/DAILY-PAYOUTS.md", "contracts/rewards/src/payouts.rs", "contracts/rewards/src/reconcile.rs", "contracts/rewards/src/world_days.rs", "contracts/qgold/src/lib.rs", "server/global-rewards.mjs", "server/global-reward-worker.mjs", "server/map-rewards/global-plan.mjs", "server/payouts/payout-tree.mjs", "server/payouts/worker.mjs"],
    blocks: [
      { h: "The contract side" },
      {
        list: [
          "`publish_payout_day` commits the root and reserves the total from the coin and zone treasury, under the same per-date cap as city and map days.",
          "`claim_payout` (anyone, 8 leaves per transaction) checks each leaf and calls the vault's `mint_for` for exactly that account and amount. A repeated leaf is skipped; a refused mint reopens the leaf.",
          "Gas comes from an actual-WASM sandbox run: 15 TGas per mint and 10 TGas per callback. A batch without enough gas for every leaf is refused before anything changes.",
          "Each mint records an attempt with a nonce, so a callback settles it at most once; a failed callback can be settled a day later from the finalized receipt.",
          "`close_payout_day` closes a day after three days only when every leaf has a finalized successful mint.",
          "Amounts below 0.00000001 NEAR carry over: the vault cannot mint less than one QGOLD unit.",
        ],
      },
      {
        facts: [
          ["Leaf", "`sha256(\"payout|<day_id>|<index>|<account>|<amount_yocto>\")`"],
          ["Tree", "Sorted-pair sha256, the same as map days and the QXP ledger"],
          ["Storage", "Root, totals and a bitmap of claimed leaves; no receipt per account"],
          ["Recovery", "Attempts older than 1 day; world receipts decide within 29 days of the claim"],
        ],
      },
      { h: "The payout worker" },
      {
        list: [
          "Every `PAYOUT_ROUND_MINUTES` (5 on testnet; 0 = once after local midnight) it collects every backed coin and cell-zone prize not paid yet and at least a minute old, prices it at the rate its day was planned with, sums it per account and publishes `payout-<date>-v<n>`. A round with nothing to pay publishes nothing.",
          "Submission is not payment: finalized per-leaf chain status confirms each receipt. Restart recovery reconciles pending leaves first; an exclusive fenced lease prevents overlapping workers.",
          "A player without a NEAR account yet keeps their coins waiting and joins the first payout after the account exists. `GET /api/qgold/pending` shows what is on its way.",
          "Profile → Stake → Earnings shows the QGOLD balance and what the next payout brings. While payouts run, map days no longer send `claim_map`, so a coin is never paid twice.",
        ],
      },
      { note: "The prepared Atlas adapter separately reserves a UTC day before opening and needs two reviewed testnet contract upgrades, including QGOLD's governance timelock. Until confirmed activation, Atlas quests award personal XP only." },
      { p: "Funding inputs are refreshed from finalized NEAR receipts and reconciled against the treasury. [NearBlocks](https://testnet.nearblocks.io) supplies discovery hints; its indexed amounts never authorize a reward." },
    ],
  },
  {
    id: "accounts",
    group: "chain",
    title: "Accounts, wallets and the relayer",
    tldr: "The blockchain is invisible: every explorer automatically gets an **own NEAR account** whose key never leaves the device, the game pays the gas for every game action, and recovery works with a passkey or a linked wallet.",
    keyFacts: [
      ["1 ×", "small NEAR deposit, only when the account is created"],
      ["0", "gas paid by the player for game actions"],
      ["0", "player keys held by the server"],
      ["2 NEAR/day", "sponsorship cap planned for mainnet"],
    ],
    hero: "account-seq",
    status: "live",
    updated: "2026-11-11",
    sources: ["docs/RELAYER.md", "docs/IDENTITY-RECOVERY.md", "docs/NATIVE-TRANSACTION-CONFIRMATION.md", "docs/DURABLE-NATIVE-RECOVERY.md", "docs/ETH-WALLETS.md", "docs/NATIVE-PROFILES.md", "server/relayer/policy.mjs", "server/relayer/accounts.mjs", "src/FuelCard.tsx"],
    blocks: [
      { h: "Your explorer account" },
      {
        list: [
          "A new explorer gets `<name>.play-…testnet`, funded with a small NEAR deposit once, when the account is created, after they earned their first XP on the map; the first steps play solo without it. New accounts per network address are capped per day.",
          "Gas is always sponsored. The small balance only covers the account's storage and the player's own payments (Aura buys, deposits), which the relayer never sponsors. Starting NEAR comes **once**, when the account is created; there is no daily refuel (`PLAYER_REFUEL=1` turns it back on for tests). Profile → Stake → Earnings offers **Convert QGOLD to NEAR** at the vault or **Add your own NEAR** from any wallet.",
          "Every in-game action (tasks, Secrets, Aura listings and equipment, staking, level rewards, badges, profile and note records) signs with this account, without a wallet pop-up. Before it exists, **Activate my account** prepares it.",
          "The device key lives in a separate signing origin, deployed with the game. If a browser blocks its storage, no account is created, Profile → Settings → Account and devices says so, and free play continues. Keys made before that origin are not rotated yet.",
          "Purchases, equipment, earned mini-games and getting ready to trade sign silently. Anything that can pay someone else (a sale or purchase, a task, Secret or send, a withdrawal, an asset transfer) and account recovery ask one plain Yes / No question in a small separate window, which a compromised game page cannot answer.",
        ],
      },
      { h: "Sign-in methods" },
      {
        list: [
          "A NEAR wallet links with a NEP-413 signature; MetaMask or Rabby sign in with SIWE and can sign Intents trades (erc191).",
          "Passkeys sign in to the game identity; they are not NEAR keys. Recovery restores the explorer by signing again with the linked wallet.",
          "Adding a sign-in method to a secured explorer needs a recent sign-in with an existing one.",
          "On the test network one owner test explorer can also sign in with a name and password (salted scrypt hash); mainnet refuses that sign-in.",
        ],
      },
      { h: "The relayer" },
      {
        list: [
          "Game actions are NEP-366 meta-transactions. The relayer checks a strict policy (one action, allowed receiver + method + deposit, nonce, expiry, gas) and pays the gas.",
          "Some calls are checked against game and chain state first: NEAR Social writes only for the game's own records (≤ 4 KiB), `redeem_aura` only for a valid unredeemed voucher, cancelling a market order only for your own open order (4 a day).",
          "A service-wide daily budget covers new accounts, relays and top-ups; unknown payments keep their reservation, and a transaction is re-signed only after the network provably rejected it. Nothing is paid twice.",
          "A wallet transaction counts only after the server reads it as FINAL and it matches the terms reviewed before signing; unresolved transactions survive reloads in a local journal.",
        ],
      },
    ],
  },
  {
    id: "intents-market",
    group: "chain",
    title: "NEAR Intents market",
    tldr: "Auras trade peer to peer through a **NEAR Intents** verifier: both sides sign, one transaction settles both, and 2 % of the buyer's leg goes to the treasury. Nobody can take the Aura without paying, or the reverse.",
    keyFacts: [
      ["2 %", "fee to the treasury"],
      ["1 tx", "settles both sides"],
      ["v0.4.5", "open-source verifier, self-deployed"],
      ["3", "trades per player, trader and day with NPCs"],
    ],
    hero: "intents-seq",
    status: "live",
    updated: "2026-11-11",
    sources: ["docs/NEAR-INTENTS-MARKET.md", "docs/ONCHAIN-TRADES.md", "docs/SIGNED-AURA-ORDERS.md", "docs/NATIVE-MARKET.md", "src/intents-order.ts"],
    blocks: [
      {
        list: [
          "The verifier is the open-source NEAR Intents (defuse) contract v0.4.5, deployed by the project on testnet and labelled experimental. Both sides sign a `token_diff`; the solver (the relayer account) settles both intents in one transaction.",
          "Fee: 20,000 pips (2 %) on the buyer's wNEAR leg, collected for the treasury.",
          "NPC traders keep their stock and purse inside the verifier; a fill pairs the player's signed diff with a server-signed trader intent.",
          "The solver's gas counts against the shared daily sponsorship budget. When it is used up, fills and withdrawals wait for the next day; signed orders stay in the book.",
          "Every settled trade and withdrawal is a History row for both explorers with the settlement transaction (Settings → Account and devices → On chain); Shop → Market → More trading tools lists your own trades.",
          "Aavegotchi wearables are never traded: originals stay in the wallet, map clones are not NFTs.",
          "Signed market-v2 orders (NEP-413) remain as a fallback. The old practice QGOLD market is closed (`410 MARKET_ON_CHAIN`). Mainnet `intents.near` is planned and needs the owner's go.",
        ],
      },
    ],
  },
  // -------------------------------------------------------------- platform
  {
    id: "ai",
    group: "platform",
    title: "AI in the game",
    tldr: "AI phrases NPC replies and writes nightly quest flavour, but it **only ever picks from options the server computed**. It never sets rewards, prices or links, and no model call slows play.",
    keyFacts: [
      ["2", "providers in order: NEAR AI Cloud, template"],
      ["01:00 UTC", "nightly flavour batch"],
      ["0", "model calls on the player's path for quest texts"],
      ["0", "drafts published without review"],
    ],
    hero: "ai-chain",
    status: "live",
    updated: "2026-11-05",
    sources: ["docs/NEAR-AI-CLOUD.md", "docs/QUEST-FLAVOUR.md", "docs/AI-QUEST-DRAFTS.md", "server/ai/near-ai.mjs", "server/ai/flavour.mjs"],
    blocks: [
      {
        list: [
          "**NPC talk:** NEAR AI Cloud, then a deterministic template (NEAR AI is the only model provider; Ollama was removed). Signed responses are checked against their attestation report in the background; the reply shows its verification state.",
          "**Quest flavour:** a nightly batch after 01:00 UTC writes short texts for places in active regions; play only reads the cache. Rejected texts are logged with reasons.",
          "**Creator drafts:** an editor helper suggests quest drafts; suggestions are never saved or published automatically and pass the normal review.",
          "Rule for every model: it picks from options the server computed, by index. Outputs are filtered for unsafe text and prompt leaks.",
        ],
      },
    ],
  },
  {
    id: "safety",
    group: "platform",
    title: "Fair play and safety",
    tldr: "The server is the trusted validator of GPS evidence, with a travel guard, XP caps and safety-filtered public places. The contracts bound what even a compromised server could pay.",
    keyFacts: [
      ["15 km/h", "travel guard in GPS worlds"],
      ["600 XP", "per cell a day from location play"],
      ["3,000 XP", "a day from location play"],
      ["12", "cells a day count for XP"],
    ],
    hero: "fair-play",
    status: "live",
    updated: "2026-11-13",
    sources: ["docs/FAIR-PLAY.md", "docs/POI-SAFETY.md", "docs/SOCIAL-CONTROLS.md", "docs/MAP-NOTES-UI.md", "docs/MODERATION-AND-EVIDENCE.md", "server/fair-play.mjs"],
    blocks: [
      {
        list: [
          "Faster than about 15 km/h (on foot or by bike, `FAIR_PLAY_MAX_SPEED_KMH`) returns `422 IMPLAUSIBLE_MOVE` (wait capped at 2 h).",
          "XP caps: the claim still succeeds, extra XP is trimmed and the response says so.",
          "Rate limits on sign-up and APIs; all quests sit on safety-filtered public places. Places tagged or named as staff, members or residents only (for example \"Staff only\", \"Untuk Kakitangan Sahaja\", \"関係者以外\") never become quests.",
          "Map notes, place messages, places and creator quests have reports, blocks and moderators.",
          "Money paths use database transactions with exactly-once ids; contracts keep their own invariants independent of the server.",
          "GPS can be spoofed: the server validates physical evidence, and the contracts bound what a compromised validator could do.",
        ],
      },
    ],
  },
  {
    id: "operations",
    group: "platform",
    title: "Runtime and operations",
    tldr: "One Node 24 service with SQLite on a VPS, background workers on fixed rhythms, a daily backup, and CI gates every change must pass before it can merge.",
    keyFacts: [
      ["5 min", "payout rounds and QGOLD keeper"],
      ["10 min", "trader keeper"],
      ["03:20 UTC", "daily backup"],
      ["220 KB", "first-load JS budget (gzip)"],
    ],
    hero: "daily-jobs",
    status: "live",
    updated: "2026-11-12",
    sources: ["docs/RUNTIME-RELIABILITY.md", "docs/PERFORMANCE-BUDGET.md", "docs/STATE-RECOVERY.md", "docs/OWNER-RUNBOOK.md", "docs/TEST-SEED.md", "docs/TEST-LAYER.md", "docs/GUIDED-TOUR.md", "docs/NEAR-RPC-CACHE.md", "docs/VPS-RELEASE-RUNNER.md", "scripts/release-runner.mjs", ".github/workflows/check.yml", "scripts/check-bundle-budget.mjs", "server/cli/tester-account.mjs"],
    blocks: [
      { p: "A React + MapLibre client talks to one Node 24 service (systemd, Caddy). SQLite in WAL mode is the durable store with strict schema modules. Server-sent events push coins and quests to nearby players." },
      {
        table: {
          head: ["Worker", "Rhythm"],
          rows: [
            ["Reward worker (claims, publications, map days)", "every 30 s"],
            ["QGOLD payout rounds", "every 5 min (inside the reward worker)"],
            ["QGOLD keeper", "every 5 min"],
            ["Trader keeper", "every 10 min"],
            ["Relay and market escrow", "every 15 s"],
            ["Badge mint queue", "every 15 s"],
            ["Creator money, signed-order index", "every 30 s"],
            ["Intents reconcile", "every 60 s"],
          ],
        },
      },
      {
        list: [
          "Mainnet runs as a separate service with its own database and keys, and is not started yet.",
          "Backups at 03:20 UTC, after Prague midnight publication. After a restore, days whose chain count is ahead refuse new claims (`NATIVE_RECONCILING`) until they end.",
          "Phone budget: first-load JS and CSS are capped; every big screen, this wiki included, loads lazily.",
          "English is the default language; other languages are opt-in dictionaries, checked on 390 px phones in CI.",
          "The testnet runs a removable test seed (bots, quests, community tasks, free Secrets); every seeded row has a `seed-` id. Starter kits for real explorers are off unless `TEST_SEED_KIT=1`.",
          "A guided tour (helper Pip, top-right card) walks a new explorer through every quest type, encounter, trade and community action in Plzeň; each step ticks only from the game's own records (ledger actions, sponsored transactions, burns), and the end lists every transaction with its explorer link. Show me marks characters on the map for the explorer to walk up to, and opens screens such as the treasury vote right away.",
          "Two worlds, one code: QuestLayer World is the real game, and the **Test Layer** (testnet only, its own service, database, signing vault and contract set, Test QGOLD shown with a TEST tag, 4-hour explorers) holds the bots, the seed content, the compact Plzeň zones and every feature under test. Mainnet refuses the Test Layer. Until launch the main address opens the Test Layer; its world picker switches to World, and the device remembers that choice.",
          "A tester-account command line sets the owner test explorer's password, removes the old practice-QGOLD credit from explorers created before 10 November and retires duplicate test explorers (QGOLD 0, sessions revoked).",
          "A deploy reinstalls the separate signing-vault origin whenever its code or contract list changed.",
          "Releases and testnet operator jobs run on the VPS itself. A release runner follows the deploy branch every minute (build, tests, database backup, switch, automatic rollback) and runs queued operator jobs from an allowlist, one at a time, after a read-only plan; contract upgrades only with a WASM hash that matches the reviewed build. It refuses mainnet. Its public status is at `/api/release/status`.",
          "Chain reads go through free public NEAR RPC endpoints (three on testnet). The server merges equal reads, reuses a result for 3 s, paces reads to about 8 per second, backs off after a rate limit and drops cached reads whenever a transaction goes out.",
        ],
      },
      { viz: "ci-gates" },
    ],
  },
];
