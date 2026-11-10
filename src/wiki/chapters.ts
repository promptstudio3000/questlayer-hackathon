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
    updated: "2026-11-08",
    sources: ["docs/ARCHITECTURE.md", "docs/GAME-RULES.md", "docs/SOURCES-AND-INTEGRATIONS.md", "README.md", "server/index.mjs", "src/main.tsx", "src/App.tsx", "src/DemoControls.tsx", "src/useDemoWalk.ts", "src/MapSurface.tsx", "src/nearby-action.ts", "src/Dialog.tsx", "src/QuestBrief.tsx", "src/activity-view.ts", "src/GameIntro.tsx", "src/learning-store.ts", "src/activity-help.ts", "src/FirstSession.tsx", "src/AdventureResults.tsx", "src/WearableMoment.tsx", "src/zone-presence.ts", "src/ZonePresence.tsx"],
    blocks: [
      {
        p: "QuestLayer turns the streets around you into a daily adventure. Coins lie along public paths, six quest zones open across the city every day, NPCs walk the map and offer errands, monsters guard chests, and everything you earn becomes yours: XP and levels on your account, Auras as NFTs, and coin rewards paid from one global prize pool that is funded by staking yield and sponsors, never by players losing money.",
      },
      {
        p: "This wiki is the know-how center of the project. Every chapter describes a mechanism **that is in force today**, the numbers it uses, how it connects to the rest and where it lives in the code. Status chips say honestly what is live on testnet, what is built but switched off and what is only planned.",
      },
      { p: "The map is home: the avatar opens Profile, and compact shortcuts open Explore, Inventory and Community. Explore browses available places without replacing the active adventure. Inspecting another place is temporary; Start quest or Show on map selects its objective. Closing the place list restores the current adventure and its server checkpoint. One dismissible objective holds the next action. Nearby actors, quest checkpoints and street finds offer an Open action without requiring a marker tap. Confirmed results, recovery notices and the first equipment step keep priority over nearby suggestions until the player explicitly hides that objective. Discovery details and encounters open content-sized overlays with a persistent close action; the desktop map remains visible around them. Map controls and camera framing never depend on overlay height. World-read guards follow the requested GPS/demo mode immediately, so a fast response before the next render cannot leave the map stuck loading; stale responses from the previous mode remain rejected. The demo starts with one open row of movement controls and remembers an explicit collapse or reopen. Opening a modal releases held demo movement; closing it does not resume the previous input. A dismissed first-steps objective can be restored from Profile Settings without resetting its progress. Inventory, Profile and Community keep their own screens. Returning from a confirmed completion releases that finished target. Profile has Character, Badges, Stake, Rewards and Settings; Community has Quests, Tasks, Local chat, Places and Creators." },
      { p: "Game moments use progressive disclosure. An activity opens with its illustration, objective, real reward availability and Start quest; starting only focuses that activity and never reserves or claims a reward. An active activity keeps its objective ahead of incidental nearby suggestions; its own nearby target or an explicit dismissal can still open the floating action. The next step shows its existing location or question requirement before confirmation. A nearby target still requires entering its actual zone footprint before the interface offers confirmation. Available activity choices appear above the objective. Visit, ordered trail, return trail, any-order hunt, landmark clue and chest keep distinct labels. A compact step diagram explains the published stop order; Learn more holds timing, safety and evidence. Duration stays unknown when the published activity has no duration; a minimum distance between stops is never described as a verified walking route. The confirmed result replaces the quest overlay rather than stacking dialogs or repeating success toasts. Confirmed Aura results prioritize the item, series limit when matched to the catalog, and one next action. Receipt history, ownership refresh, proofs and optional secure/share actions remain under Learn more; sharing stays an optional action from a confirmed receipt." },
      { p: "Creating a new explorer without a deep link opens one skippable, illustrated guide before map interaction. Continue enables brief first-time tips; Skip or Escape keeps automatic teaching quiet. Restored sessions and deep links never open this guide automatically. Profile Settings can reopen it without changing preferences, or toggle first-time tips; its Help group keeps How to play, the guide and one row of links to How it works, Wiki, Economy and Treasury. A picked-up coin flies to the GOLD counter (a plain fade with reduced motion), and the last first-session step shows a single congratulation card. These preferences and acknowledged topics belong only to this browser and player; GPS and demo controls have separate topics. They never mark an activity complete or grant a reward. Compact objectives teach one action with prepared translated copy, independent of an AI reply. Completing the taught action or dismissing its hint acknowledges that topic. Activity details also offer How this works manually. Offline, closed, distance, footprint and GPS requirements remain visible in a selected compact objective even when teaching is disabled; these are explanations of existing checks, never proof of eligibility. Optional secure/share actions are not an automatic first-adventure step." },
      { p: "A new server-confirmed wearable pickup opens a short, closable item moment when the map is free. Routine coins and duplicate wearables keep calm pickup feedback. This live moment is not reconstructed from inventory or replayed on reload. On desktop, Inventory, Community and Profile open as a centred card over the dimmed map (a click beside it closes it); on phones they stay full screen. The zone currently containing the map position receives a stronger static outline and a compact activity cue. In GPS mode this hint needs a fresh finite fix and reports uncertainty when its accuracy overlaps the boundary. Closed, paused, locked or completed zones do not advertise available activities. The hint never attests presence or changes server eligibility; no reward is granted merely by entering the footprint." },
      { viz: "architecture" },
      { h: "Three kinds of value" },
      {
        p: "There is no practice money. XP is soulbound experience; backed map coins and funded zone prizes settle as QGOLD to the player's NEAR account after midnight. XP, cosmetic wearables and Aura ownership remain distinct.",
      },
      { viz: "money-modes" },
      {
        table: {
          head: ["Unit", "What it is", "Where it lives", "Transferable"],
          rows: [
            ["XP / QXP", "Experience from play. Drives levels and gates.", "Game DB; QXP mirror contract on NEAR", "Never (soulbound)"],
            ["QGOLD (shown as GOLD in play)", "Token fully backed by NEAR in the QGOLD vault; 6 decimals. Map coins and zone prizes earn it, the nightly payout mints it to the player's account, every purchase burns it. Its rate R only rises.", "`questlayer-qgold-vault-20261104.testnet`; collected but unpaid amounts wait in the game DB", "Yes (NEP-141)"],
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
    updated: "2026-11-07",
    sources: ["docs/MAP-REWARDS.md", "docs/NATIVE-AUTO-COLLECT.md", "docs/NATIVE-GAME-MAP.md", "docs/PEER-APPEARANCES.md", "docs/FIRST-SESSION.md", "src/useDemoWalk.ts", "src/map-motion.ts", "src/gps-facing.ts", "src/quest-route.ts", "src/QuestBrief.tsx", "src/GameMap.tsx", "src/RewardBursts.tsx"],
    blocks: [
      { viz: "core-loop" },
      { h: "Movement" },
      {
        list: [
          "**Real play moves only with the phone's GPS.** There is no tap-to-walk anywhere.",
          "The city demo has an open, collapsible single row of controls (arrows / WASD). Up and down walk along the character's facing, left and right turn it. Running (14 m/s) is the default and Shift walks (5 m/s), both under the 15 m/s fair-play jump cap.",
          "Quest buttons only turn the explorer toward the target. Within 3 m the demo snaps onto it so thin path zones count.",
          "Starting demo movement or turning puts the camera behind the character, looking along its facing with room ahead. Movement after the city overview restores street zoom and perspective. Arrows and WASD still control the demo when the map canvas has focus; these keys do not pan the map, while native map zoom shortcuts remain available. Separate held keys and pointer contacts cannot cancel one another. Dialogs, editable fields, other interactive widgets, hidden pages and window blur release movement; closing them never resumes an old key press. The globe keeps map navigation instead of demo movement.",
          "In GPS play the character and follow camera share a fresh moving course. When the device omits it, meaningful successive accurate fixes supply a direction. Stationary jitter, stale/inaccurate observations and large jumps do not invent a turn. This is course over ground, not a stationary phone compass. Manual map exploration pauses follow; My location, resumed walking after a pause, or movement after showing a quest restores it. Reduced motion uses immediate camera updates without animated travel. GPS fixes and server eligibility checks are unchanged.",
          "Multi-stop walks keep their original checkpoint numbers after each confirmation. The next required stop is prominent; later stops are quieter. Co-located departure and return steps share a badge so a future number cannot cover the current one. Tapping a checkpoint opens the quest, never confirms it automatically. Ordered walks accept only the server's next point; any-order hunts explicitly say Any order and use the nearest remaining point consistently for the map, distance and confirmation. Confirmation still requires the existing 25 m range, zone footprint and current GPS evidence; the server alone advances progress and confirms the final reward.",
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
          "Explore has two ledgers. The default map pays backed QGOLD for every coin and zone prize: it waits as \"on its way\" in Profile · Rewards and the nightly payout mints it to the player's NEAR account (created automatically at sign-in). The test network ledger instead projects the funded Plzeň NEAR day onto the map and collects as you walk with fresh GPS, one request at a time, showing only confirmed results.",
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
    updated: "2026-11-09",
    sources: ["docs/WORLD-GENERATION.md", "docs/LANDMARK-ERRANDS.md", "docs/DAILY-BOARD.md", "docs/QUEST-TEMPLATES.md", "server/world-planner.mjs", "server/poi-quests.mjs", "server/landmark-clue.mjs", "server/npc/routes.mjs", "src/DailyBoard.tsx", "src/actors-layer.ts"],
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
          "Nightly AI flavour texts (see AI chapter) give each quest a short line; short action-led template text is the fallback when the batch is missing.",
        ],
      },
      { h: "Landmark clues and errands" },
      {
        list: [
          "Up to 2 landmark clues per cell and day. The answer is a Wikidata fact (for example the century a building dates from). One answer per player: 70 XP right, 20 XP wrong.",
          "Quest givers hand out one errand per day each: visit a place, then come back for a fresh encounter to turn it in. 40 XP, +10 for a right clue. Once every step of an errand or quest line is done, the result names the NPC to go back to and that NPC carries a gold **Report back** sign on the map until the turn-in (`GET /api/actors/tasks`, information only).",
          "A zone guardian stands on its zone's chest (zones without a chest get no guardian). The chest returns `423 GUARDED` until the player beats it; the win then drops the chest right there and **Open the chest** points the map at it.",
        ],
      },
      { h: "Today's board" },
      {
        p: "Three small goals per world day picked from today's world (default: 10 coins, 1 monster, 1 NPC; fallback finds, a quest, 20 coins). Finishing all three pays **+50 XP once**. There is no streak and no penalty for skipping a day. Each unfinished goal has **Show me**: it closes the board and points the map at the nearest monster, NPC, boss, open quest, street find or coin (hidden lurkers are never revealed).",
      },
    ],
  },
  {
    id: "progression",
    group: "play",
    title: "XP, levels, season and badges",
    summary: `A ${MAX_LEVEL}-level curve where every level unlocks something to do or wear, cosmetic season ranks and ${PLACE_BADGES} place badges.`,
    status: "live",
    updated: "2026-11-05",
    sources: ["docs/LEVELS.md", "docs/GAME-LOOPS.md", "docs/NATIVE-PROGRESSION.md", "docs/SEASON.md", "docs/BADGES.md", "server/data/level-table.json", "server/data/place-badges.json", "src/levels.ts"],
    blocks: [
      {
        p: "Required XP follows `100 × (level − 1)²`. Levels unlock things to do or wear and contribute to monster duel power alongside skill. They do not change reward odds or financial payouts; equipment remains cosmetic. The table is read directly from `server/data/level-table.json`, the same file the server uses.",
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
    updated: "2026-11-09",
    sources: ["src/MonsterChallenge.tsx", "src/BossFight.tsx", "src/ChallengeExample.tsx", "docs/NPC-PLAN.md", "src/NpcSheet.tsx", "src/ActorPortrait.tsx", "src/nearby-action.ts", "src/useFormDraft.ts", "docs/ACTORS-API.md", "docs/MONSTER-CHALLENGES.md", "docs/MONSTER-HUNT.md", "docs/NPC-GAMES.md", "docs/NPC-TRADERS.md", "docs/KEEPER-VAULT.md", "server/actors/service.mjs", "server/npc/service.mjs"],
    blocks: [
      { p: "A monster encounter lists today's challenge formats once, with a one-line hint each; picking one starts that challenge directly, so the same choice is never asked twice. A guardian win names the chest it guarded only while the player has not opened it." },
      { p: "NPC and monster portraits are shown completely in bounded, scrollable encounter dialogs. The title sits beside or below the image. The close control remains reachable when content scrolls; desktop encounters leave the map visible around the modal. Nearby Open cues only open the existing encounter: the server still checks location, timing and availability." },
      { p: "NPC greetings show up to two current quest offers directly, plus an active-tasks action when relevant. A compact original portrait keeps the task choices in view. Offers can be previewed before Start quest calls the existing accept endpoint; only its confirmed response shows acceptance. Returning to the map focuses the first unfinished step from that confirmed active task when it belongs to the current world. The full offer menu, active tasks, trader and keeper surfaces, conversation input and reply provenance remain under Learn more. Closing or folding that area preserves the current explorer/actor/world text draft. Financial actions and their terms keep their original handlers and checks." },
      { p: "Unsent NPC messages are kept as bounded local text drafts for the current explorer, world and actor. Returning or reloading restores the text; a successful send clears only that submitted revision. Drafts never store encounter tokens or prove consent, position or a completed action." },
      {
        p: "Actors walk real pedestrian paths on a schedule. Reviewed cities have a hand-cast list; every other city and street cell gets a generic cast (quest giver, storyteller, wandering rare, one roamer, two lurkers). Actors are out **07:00–22:00 local** and switch between day and night casts by the real sun.",
      },
      {
        table: {
          head: ["Archetype", "What it does"],
          rows: [
            ["Quest giver", "Quest lines and one errand a day; patron lines for stakers. Out day and night (07:00–22:00), so errands work on winter evenings too"],
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
      { p: "A new mini-game format can show a short translated explanation before Start challenge sends the real request. Play example runs only local synthetic quiz, rhythm, rune-path, memory or stance inputs; it has no encounter request, reward or attempt. Starting or closing this teaching acknowledges the format in the browser. Known formats start directly, with a question button to reopen an example. Timed challenges never open help automatically. Boss help explains shared progress and lets players choose local examples without sending a strike; the actual Strike action keeps its existing server checks and format selection." },
      { h: "Monsters" },
      { p: "Monster challenges support touch and keyboard input. The rune path has an arrow-key cursor; Space starts and finishes a trace. Both inputs send the same path samples for server scoring. A failed result request can retry the same input; a confirmed result is shown once." },
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
    updated: "2026-11-07",
    sources: ["docs/NATIVE-AURA-CLAIMS.md", "docs/COLLECTIBLES-REVIEW.md", "docs/ASSET-CATALOG.md", "server/data/aura-catalog.json", "server/earned-editions.mjs", "src/Inventory.tsx", "src/AdventureResults.tsx", "src/WearableMoment.tsx"],
    blocks: [
      { p: "Confirmed Aura results present the awarded item and one equipment or map action first. Matched catalog editions show their set, serial and configured edition limit; that limit is never labelled as remaining stock. Full receipts, ownership refresh, optional secure/share actions and outfit previews remain under Learn more. Newly collected wearable clones have a separate short live pickup moment, with the original-network distinction and proof available in its details. Neither a result preview nor zone entry changes ownership or claims another reward." },
      {
        p: "Auras are wearable effects in two slots (above and below the character). Each edition is capped on chain. The catalog in `server/data/aura-catalog.json` is the single source for the server, the client and this page.",
      },
      { p: "Inventory puts owned Auras and the two equipped slots first. Unowned editions remain available in a separate expandable catalog; catalog art does not imply ownership or current reward availability. Character details retain progression and the optional 3D preview. Item actions still wait for the existing server confirmation." },
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
    updated: "2026-11-10",
    sources: ["docs/PLAYER-CARDS.md", "server/gotchi-wearables.mjs", "server/player-waves.mjs", "src/WearableMoment.tsx", "src/Inventory.tsx"],
    blocks: [
      {
        p: "About one street find in three becomes a **wearable find** (at most 12 per world): a free in-game clone of the official Aavegotchi wearable catalogue. The catalogue is read from the Aavegotchi contract on Base and the artwork is served from the contract, never copied. Picking one up is a normal street coin claim (GPS check, travel guard, XP caps), logged like any street find. The clone is a database row, never an NFT, and lands in **Inventory → Wardrobe**, not in the Aura grid: the pickup moment's See it in your Wardrobe opens it there, and the backpack points to the Wardrobe too.",
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
          "Tapping any explorer on the map opens a dialog with name, level, XP, badges, the day they started, worn wearables, verified flags and Aura colours. It works only while that explorer shares their position and neither side blocked the other.",
          "Tapping **your own** explorer opens your profile overview (the same panel as the profile button in the top bar).",
          "**Demo bots:** the test world (TEST_SEED=1) keeps a few bots walking the map. Their dialog is the same, with a **demo-bot** tag after the name; they take no waves and cannot be blocked.",
          "**Write a message** opens the encrypted inbox (see the Encrypted player inbox chapter); it stays off for demo bots and for explorers whose account is not ready yet.",
          "Waves are six ready phrases, no free text. Limits: one per pair per minute, 20 sent and 30 received per hour; delivered by the presence poll and deleted after an hour.",
          "Block hides presence, notes, waves, messages and the card both ways. The Local chat tab is the existing public nearby-note feed, with the same publication consent, reporting and blocking rules.",
        ],
      },
    ],
  },
  {
    id: "player-inbox",
    group: "play",
    title: "Encrypted player inbox",
    summary: "Private messages between explorers, end-to-end encrypted on the device and stored on NEAR Social as ciphertext.",
    status: "live",
    updated: "2026-11-10",
    sources: ["docs/PLAYER-INBOX.md", "server/inbox/crypto.mjs", "src/signing-vault/inbox.ts", "server/inbox/service.mjs", "server/inbox/routes.mjs", "src/inbox/Inbox.tsx"],
    blocks: [
      {
        p: "Explorers can write short private messages (1–500 characters). Each message is encrypted on the sender's device and written by the sender's own NEAR account to NEAR Social, so it lives on chain, but only the two explorers can read it: not other players, not the network and not the QuestLayer server.",
      },
      { h: "Who may write" },
      {
        list: [
          "A conversation opens after both explorers **waved at each other** within the last hour, or after one tapped **Ask to message** and the other accepted. A declined request stays declined for the one who asked.",
          "**Block** stops requests, messages and delivery both ways. Demo explorers cannot write or receive.",
          "Limits: 10 new requests a day (20 unanswered at most), 30 messages an hour and 150 a day per sender, 120 received an hour, one message every 2 seconds per pair.",
          "**Report** on a received message discloses the key of that one message only; the server checks it opens the on-chain record, and moderators read exactly that text. Three different reporters within 7 days pause the sender until a moderator decides.",
        ],
      },
      { h: "How the encryption works" },
      {
        list: [
          "Every explorer account has an X25519 **inbox key** generated in the separate secure signing origin; the secret never leaves it. The public key is published at `<account>/questlayer/inbox_key`.",
          "A message is sealed with X25519 + HKDF-SHA256 + XChaCha20-Poly1305 (the NaCl box idea) using a fresh key per message, and written to `<sender>/questlayer/inbox/msg_<id>`. The text is padded to 128-byte steps so its length tells little.",
          "On chain anyone sees that the sender wrote a message, when and roughly how long. The recipient appears only as a tag that only the two explorers can compute, never as an account.",
          "The signing origin reads keys and records from NEAR Social itself, never from the game server, so the server cannot swap a key or forge a message. It only keeps the delivery index: who writes to whom and when.",
          "A message counts as delivered only once the server reads the exact record from chain; the relayer sponsors the gas and the small storage deposit (under 0.01 NEAR for a short message).",
        ],
      },
      {
        note: "The inbox key lives in one browser. A new device can take over for new messages, but older messages stay readable only on the device that received them. A wallet-based key backup is proposed, not built.",
        tone: "warn",
      },
    ],
  },
  // ----------------------------------------------------------------- world
  {
    id: "gotchiverse-test-app",
    group: "play",
    title: "Gotchiverse-test-app",
    summary: "A free 16 × 16 voxel workshop behind a server switch: shape terrain, place a lantern and build with invited friends.",
    status: "partial",
    updated: "2026-11-08",
    sources: ["docs/GOTCHIVERSE.md", "server/gotchiverse/store.mjs", "server/gotchiverse/routes.mjs", "src/Gotchiverse.tsx", "src/WorldSwitcher.tsx"],
    blocks: [
      {
        list: [
          "**Switch:** off unless the server runs with `GOTCHIVERSE_TEST_APP=1`. When it is on, the logo opens a world picker with QuestLayer and **Gotchiverse-test-app**; when it is off, the logo and the API routes behave as before.",
          "**Play:** each explorer opens one private workshop, raises and lowers blocks, paints grass, stone, sand or water and places a garden lantern. The first activity asks for three changed blocks and a lantern. Owners invite friends with a one-day link and can remove them again.",
          "**No money:** the workshop has no QGOLD, XP, item grants, land claims or permits. Virtual movement never counts as GPS and the outdoor map pauses its requests while the workshop is open.",
          "**Storage:** one JSON file per workshop in a `gotchiverse` folder next to the game database, written under a lock with an atomic rename. Edits carry a revision and a request id, so a retry never applies twice.",
        ],
      },
    ],
  },
  {
    id: "world-and-places",
    group: "world",
    title: "Cities, cells and places",
    summary: "Reviewed cities, Czech map rewards and optional prepared Atlas discoveries in supplied global regions.",
    status: "live",
    updated: "2026-11-09",
    sources: ["docs/WORLDS-PLAN.md", "docs/POI-PIPELINE.md", "docs/POI-SAFETY.md", "docs/WORLD-COVERAGE.md", "docs/SECOND-CITY-PLAYBOOK.md", "docs/WORLD-WORKER.md", "docs/OPERATOR-WORLD-CONTROLS.md", "docs/GLOBAL-WORLD-PREPARATION.md", "server/world-preparation/worker.mjs", "server/world-preparation/geography.mjs", "server/world-preparation/export.mjs", "server/world-preparation/collector.mjs", "server/world-preparation/launch-scope.mjs", "server/world-preparation/source-audit.mjs", "server/global-activities.mjs", "server/data/cities.json", "server/spatial/auto-cities.mjs", "server/poi/index.mjs"],
    blocks: [
      {
        p: `Live reviewed cities: **${LIVE_CITIES.join(", ")}**. The current reward map covers Czechia. Prepared Atlas discoveries can also run in supplied global regions with personal XP; worldwide funding and full data coverage remain separate release work.`,
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
      { h: "Global Atlas discoveries" },
      {
        p: "When a geographic catalog is connected, a background worker selects mapped zones and Atlas quests for today and tomorrow before players load them. It checks public-path targets, exclusions, polygon boundaries and the whole supplied region inventory. The live game opens only a completely imported UTC day. Already checked regions can form the next day while additional map-data processing waits for resources. Loading a place does not generate extra activities. Missing or incomplete regions remain unavailable outside Czechia; inside Czechia the normal street world (POI quests, landmark clues, coins) takes over whenever no ready prepared day covers the spot, so a missed daily manifest never empties the country (`GLOBAL_CZECHIA_FALLBACK=off` disables this).",
      },
      {
        p: "The game imports regions in separate steps so it can handle other requests between them. An interrupted import resumes the same day without opening partial content or duplicating quests. Preparation reports each date separately and identifies regions whose content failed validation. A failed date retries with increasing pauses and does not stop work on the next day.",
      },
      {
        p: "Atlas visits and three-stop hunts use the normal GPS checks, personal XP and durable completion receipts. Without a separately confirmed financial day they promise no money or item. The optional testnet financial adapter fixes one first-completion NEAR prize per prepared zone before opening; it requires reviewed contract upgrades, a complete received-funding inventory and an exact on-chain day reservation. Map-derived places remain unverified on foot, and known opening restrictions are excluded from this all-day mode. Plzen keeps its existing six shared slots; other cells select up to three actual polygons and explain missing slots. The collected catalog determines coverage: a pilot is not a fully seeded planet.",
      },
      {
        p: "An optional bulk collector continues from verified map downloads through export, real polygon selection and isolated gameplay checks without another AI prompt. It retains complete neighboring path and exclusion geometry, preserves polygon holes, and reports unsafe or oversized areas instead of dropping them. Accepted regions join the next unpublished preparation; a published day stays unchanged. The source worker plans every mapped candidate cell of each selected owner, including places without parks; an incomplete section withholds its owner. Complete neighboring geometry is indexed in compressed chunks. Incomplete unrestricted polygon candidates are rejected with source identities and reasons; an incomplete restricted ground blocks that source. This is map-derived coverage, not field verification.",
      },
      {
        p: "A versioned launch selection can cover European extracts and US extracts in full, with national-capital footprints elsewhere. Russia, North Korea and Iran are excluded from that selection. Capital coordinates and timezones come from a pinned GeoNames snapshot. The same hashed selection controls acquisition and owner planning; existing downloads are retained. The first active collection phase is EU-only: all 27 member countries, including Cyprus even though its extract is grouped under Asia. Non-EU collection is paused, with no automatic expansion after EU completion. EU daily outputs are kept separate from earlier global pilots. Missing capitals and incomplete sources remain explicit, and completing this selected footprint never reports a complete planet. Financial activation still requires separate confirmed reservations.",
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
          "The map-day contract supports cell proofs through `publish_map_day`, `claim_map` and `close_map_day`. When nightly payouts are enabled, the worker records map budgets without sending per-coin `claim_map`; the daily-payout chapter describes settlement without the former per-coin limit. The demo arena gives XP only.",
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
    updated: "2026-11-05",
    sources: ["docs/GLOBAL-TREASURY.md", "docs/ECONOMY-RULES.md", "docs/ECONOMY-PAGE.md", "IMPLEMENTATION-PLAN.md", "server/native/public-ledger.mjs"],
    blocks: [
      {
        p: "All money flows through **one global treasury**. It earns staking and lending yield, collects fees and sponsor funds, and every day releases a budget that players collect as coins and zone prizes. Unclaimed budget simply stays for later days. Per-city pots do not exist: money follows players.",
      },
      { viz: "money-flow" },
      {
        list: [
          "**No paid chance.** Randomness is free or earned (wisp rolls, chests), never bought or wagered.",
          "**No streaks, energy or loot purchases.** Spending only burns the player's own QGOLD (`ft_burn`) for cosmetics and conveniences; the backing stays in the vault, so every burn raises R for all holders.",
          "**No practice money.** Every map coin and zone prize is backed by the day's budget and paid as QGOLD by the nightly payout.",
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
    updated: "2026-11-09",
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
          "**Yield vault** `questlayer-yield-20261102.testnet`. Players or the treasury deposit stNEAR, LiNEAR, USDC or USDT. A deposit makes the player a Staker at once; withdrawal opens after 24 h. Stables keep a 20 % buffer and are supplied to Rhea only below 95 % utilization, and never while a Rhea withdrawal is still on its way back (that would make the withdrawal look bounced and strand it); LST growth goes to the treasury. The contract pays position storage (about 0.007 NEAR each, 1 000 at most) and refunds new deposits once that reserve is short; a permissionless `reconcile_idle` can only raise the tracked balance to what the token reports, so no held principal stays untracked.",
          "**Staking vaults.** A personal keyless vault per player stakes NEAR with a validator and gives a chosen 0–100 % share of the yield to the game. Harvest → unlock (4+ epochs) → withdraw → flush to the treasury, all permissionless calls. A harvest needs a fee of at least 0.001 test NEAR and waits 4 epochs after the previous one cashed; the basis then moves only by the gain whose fee was actually settled, so yield that grew during the unlock still pays its share later. An operation whose callback never ran can be settled by anyone after 2 epochs with `recover_stuck`, which settles a lost transfer from the account balance and a lost pool step from the next pool read, never paying twice. A position the pool no longer holds anything for closes instead of waiting for cash forever. A keyless vault never changes code after it is created: these rules reach the positions created after the factory is moved to the v3 vault build, and the yield vault gets its fixes by an in-place code upgrade that must leave every position byte for byte unchanged.",
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
    updated: "2026-11-08",
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
          "Instant exits: at most 5 % of the backing per 24 h (at least 1 NEAR) and 1 % per account (at least 0.2 NEAR). The rest queues for a 24–48 h safe window; `claim_exit` pays only the account that burned. A queued exit is at least 0.005 NEAR: that first 0.005 NEAR is a storage bond for its record and comes back with the claim.",
          "Every payout follows a burn of the payee's own QGOLD. There is **no admin withdraw**, and the vault account has no access keys.",
          "A burn or redeem leaves either no supply or at least 1 QGOLD, so one early holder cannot leave a single unit behind a large backing and price every coin at zero. When the last QGOLD leaves, the leftover backing goes to insurance and R returns to its initial value for the next minter.",
          "After every change the contract asserts balance ≥ backing + insurance + treasury due + queued exits + storage. If anything ever drains NEAR, every later call fails and the vault freezes.",
          "10 % of fees build an insurance fund; `reconcile` books a missing-money loss against insurance first and refills R to its peak. Storage that outgrew the operating balance is not a loss: sponsored records (coin payouts to new players, conversion receipts) stop first, `fund_operating` refills the balance, and old receipts can be pruned after 30 days.",
          "A guardian or council member can pause for at most 72 h, once per 7 days per account; ending a pause early, like cancelling a proposal, takes the council threshold (or the proposer). Upgrades and parameter changes need the council multisig and a timelock: 48 h by default. The council can change it through the same timelocked vote, to 10 min–48 h on testnet and 24–48 h on any other network; each proposal keeps the timelock in force when it was proposed. On testnet, the upgrade that adds this setting also sets it to 10 min if it was never set; other networks stay at 48 h.",
        ],
      },
      { h: "Market and keeper" },
      { viz: "qgold-keeper" },
      {
        list: [
          "A Rhea (Ref) testnet pool #2895 pairs wNEAR and QGOLD near R + 1 %.",
          "A keeper acts at 12 secret times a day, committed in advance and revealed from NEAR block randomness: inverse buy-and-burn below R, buyback-and-burn from 20 % of fees below 1.1 R, sales on a 1.1 / 1.2 / 1.3 R ladder above it.",
          "The keeper stays idle while the pool is too small (threshold set on the server).",
          "The keeper records each operation before spending and preserves completed steps after a restart. A failed burn does not repeat its purchase or erase money already committed from the limits. Uncertain outcomes wait for reconciliation; ordinary gameplay needs no extra confirmation.",
          "When Rhea retains an undelivered swap output, the keeper can register its token account and recover the exact verified amount automatically. Recovery has its own saved transaction record, so a restart does not repeat the purchase. Ambiguous or mixed balances wait for reconciliation without burning unrelated tokens.",
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
    updated: "2026-11-09",
    sources: ["docs/GOLD-SPENDING.md", "docs/TASK-MARKET.md", "docs/QGOLD-ESCROW.md", "docs/CREATOR-BONUS-VOTE.md", "docs/NATIVE-TASK-ESCROW.md", "docs/NATIVE-TASKS-UI.md", "CREATOR-ECONOMY-PLAN.md", "server/data/gold-spend.json", "src/signing-vault/policy.ts", "src/GameMap.tsx"],
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
          `NPC gear: one chest-edition Aura a day from a trader (rare ${GOLD.gear.price.rare}, epic ${GOLD.gear.price.epic} QGOLD).`,
          `Prices are in QGOLD and sized to play: a map coin is worth about 0.0004 QGOLD on testnet and a cell-zone prize a few hundredths, so a premium emote (${Math.min(...GOLD.emotes.premium.map((e) => e.price))}–${Math.max(...GOLD.emotes.premium.map((e) => e.price))} QGOLD) is about one good walk and a frame a few days of play.`,
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
          "Open player tasks (scroll pin) and Secrets (magnifier pin at the centre of their fog circle, never the hidden place) within the Nearby range are drawn on the GPS map; tapping one opens it in Explore · Nearby.",
          "**Conditional sends:** escrow that releases on a condition, no fee.",
          "In the security candidate, each shop purchase keeps one saved reference from price quote through burn and delivery. The server verifies direct or relayed payment receipts; retries return the saved result. If an item becomes unavailable after payment, its credit stays recorded for resolution.",
          "Everything settles in real QGOLD. The poster, buyer or sender pays it from their own NEAR account into the `qgold-escrow` contract with one sponsored `ft_transfer_call` (with the secure account, every escrow payment, whether a task, a Secret or a send, opens its approval window, which names the contract, method, amount and who can be paid, decoded from the exact message; a game page alone can never fund one). The server confirms the exact payment, recipient, deadline and conditions before opening the task, Secret or send.",
          "A returned payment never opens a paid Secret or creates a new reward. A completed payment stays completed after a restart, and existing confirmations are preserved. An uncertain payment waits for verification without another approval from the player; normal exploration stays available.",
          "In the security candidate, sponsored token registration is a lifetime grant that cannot be cashed out by unregistering; the escrow sponsors it only for workers and creators who earned a payout, never for the recipient of a send. A send or refund to an account the token does not know yet waits (the market shows this) until the account's first QGOLD payout registers it. The funder of a task, Secret or send holds a native NEAR storage deposit on the escrow: each agreement locks its storage headroom from that deposit, consumes about 0.01 NEAR for its permanent record and returns the rest when it closes, so dust agreements cannot exhaust the escrow's reserve. When the deposit is short, the funding response carries a `storage_deposit` the app signs first; the relayer pays it in 0.05 NEAR steps (at most 0.5 NEAR, only for the signer, only when the escrow does not already cover it) and the escrow keeps it as a grant that can never be withdrawn as NEAR. Genuine appeals remain available, while unrelated workers cannot freeze an unassigned slot.",
          "If a reward or refund transfer fails, the escrow keeps the credit and the worker retries after verifying the failure. Restart recovery checks the same payment before sending again. New rewards remain owed even while an earlier payment is in progress; no extra player confirmation is required.",
          "A publisher call the escrow contract rejects with a final receipt (for example an approval for a task its poster already cancelled on chain) is recorded as failed for the operator and never holds up other players' payouts; only payments with an unknown outcome pause the queue until they are verified.",
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
    updated: "2026-11-05",
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
    updated: "2026-11-05",
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
            ["QGOLD escrow", "`questlayer-qgold-escrow-20261105.testnet`", "Player-funded tasks, Secrets and sends"],
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
          "The public testnet health checkpoint on 5 November reports the recorder ready in per-action mode, with confirmed records and a confirmed daily root. This is a dated observation; readers should check the current health and public ledger for later state.",
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
    status: "live",
    updated: "2026-11-09",
    sources: ["docs/DAILY-PAYOUTS.md", "contracts/rewards/src/payouts.rs", "contracts/rewards/src/reconcile.rs", "contracts/rewards/src/world_days.rs", "contracts/qgold/src/lib.rs", "server/global-rewards.mjs", "server/global-reward-worker.mjs", "server/map-rewards/global-plan.mjs", "server/payouts/payout-tree.mjs", "server/payouts/worker.mjs"],
    blocks: [
      {
        p: "Every backed coin is real QGOLD. After the day ends the server sums each account's earnings in NEAR and the rewards contract pays every account once from a single published root, instead of one receipt per coin (which allowed only 240 claims a day).",
      },
      {
        list: [
          "`publish_payout_day` commits the root and reserves the day's total from the coin and zone treasury, under the same per-date cap as city and map days.",
          "`claim_payout` (anyone, 8 leaves per transaction) checks each leaf against the root and calls the vault's `mint_for` for exactly that account and amount. A repeated leaf is skipped; a refused mint reopens the leaf, so nothing is lost or paid twice.",
          "Gas allowances come from an actual-WASM sandbox run: 15 TGas per mint and 10 TGas per payout callback, about 5x and 3.7x what they burned there. A batch without enough gas for every leaf's mint and callback is refused before anything changes.",
          "Each mint records an attempt with a nonce, so a callback settles it at most once. If a callback itself fails (for example out of gas), the attempt can be settled a day later: anyone settles a world payout leaf from QGOLD's durable conversion receipt, and the owner settles a daily leaf or a withdrawal from the finalized mint receipt. A paid mint is booked paid; a refused one reopens the leaf or restores the credit for an ordinary retry.",
          "`close_payout_day` can close a day after three days only when every leaf has a finalized successful mint and no mint is pending. Unpaid earned rights remain available.",
          "Amounts below 0.00000001 NEAR carry over to the next day: the vault cannot mint less than one QGOLD unit.",
        ],
      },
      {
        facts: [
          ["Leaf", "`sha256(\"payout|<day_id>|<index>|<account>|<amount_yocto>\")`"],
          ["Tree", "Sorted-pair sha256, the same as map days and the QXP ledger"],
          ["Storage", "Root, totals and a bitmap of claimed leaves; no receipt per account"],
          ["Limits", "Up to 262,144 accounts a day; 8 leaves per claim transaction"],
          ["Recovery", "Attempts older than 1 day; world receipts decide within 29 days of the claim"],
        ],
      },
      { h: "The nightly worker" },
      {
        list: [
          "After local midnight (Europe/Prague) the reward worker collects every backed map coin and cell-zone prize of GPS worlds that is not paid yet, prices it in NEAR at the rate its day was planned with, sums it per account and publishes the day.",
          "Then it submits `claim_payout` in batches of 8. Submission is not payment: finalized per-leaf chain status confirms each receipt. Failed mints restore the same reservation for retry. Restart recovery reconciles pending leaves before sending new ones; an exclusive fenced lease prevents overlapping workers from changing the same payout. A fully paid day may close after the grace period.",
          "A player without a NEAR account yet keeps their coins waiting; they join the first payout after the account exists. `GET /api/qgold/pending` shows what is still on its way (in micro-QGOLD `units`, with `awaitingAccount` for coins collected before an account existed).",
          "Profile · Rewards shows the QGOLD balance on the linked NEAR account and the amount the next payout brings. Pickup messages count QGOLD; there is no practice GOLD. The old practice stake is closed (its fake yield could have become real QGOLD). Tier 2 and Tier 3 places on the map are open to everyone until launch; after that they can be gated by the real vault tier (50 / 100 NEAR matured).",
          "While payouts are on, map days no longer send `claim_map`, so a coin is never paid twice. The demo arena gives XP only and never pays.",
        ],
      },
      {
        note: "The existing nightly payout runs on testnet. The prepared Atlas adapter separately reserves a UTC day before opening, records exact earned NEAR, releases only unearned rewards and transfers original reservations into payouts without charging the date cap twice. Unlinked and small earnings retain their source and day. World payouts use a reviewed QGOLD conversion method that keeps fractional NEAR as account-bound credit and stores a durable conversion receipt. This requires both reviewed testnet contract upgrades, including QGOLD's existing 48-hour governance timelock. Until confirmed activation, Atlas quests award personal XP only; prepared coins and item stock are not yet supported by this adapter.",
        tone: "info",
      },
      {
        p: "Funding inputs are refreshed from finalized NEAR receipts and reconciled against the shared treasury, including prior liabilities. [NearBlocks](https://testnet.nearblocks.io) supplies transaction discovery hints; its indexed amounts never authorize a reward. Incomplete evidence blocks new financial activation. The refresh cannot sign transactions or change an already opened day's promises.",
      },
    ],
  },
  {
    id: "accounts",
    group: "chain",
    title: "Accounts, wallets and the relayer",
    summary: "Play without a wallet: an invisible NEAR account with a key that never leaves the device, and gas paid by the game.",
    status: "live",
    updated: "2026-11-10",
    sources: ["docs/RELAYER.md", "docs/IDENTITY-RECOVERY.md", "docs/NATIVE-TRANSACTION-CONFIRMATION.md", "docs/DURABLE-NATIVE-RECOVERY.md", "docs/ETH-WALLETS.md", "docs/NATIVE-PROFILES.md", "server/relayer/policy.mjs"],
    blocks: [
      { viz: "account-seq" },
      { p: "The local security candidate separates the signing key from the game page. Normal purchases, equipment and earned mini-games remain seamless. Withdrawals, asset transfers and account recovery require approval in a separate account window. This candidate has not been deployed or rotated into existing accounts." },
      {
        list: [
          "A new explorer gets `<name>.play-…testnet`, funded with 0.1 NEAR, once they have earned their first XP on the map (a find, coin or quest); the first steps play solo without it. Its only full-access key is generated on the device; the server never holds a player key. New accounts per network address are capped per day.",
          "Game actions are signed as NEP-366 meta-transactions. The relayer checks a strict policy (one action, allowed receiver + method + deposit, nonce, expiry, gas) and pays the gas.",
          "Attached deposits retain the per-account cap. The security candidate also reserves one service-wide budget for new accounts, relays and topups. Unknown payments retain their reservation across restarts and midnight; refunds are not counted as new allowance. A reservation for an action that never reached the chain is released back to the day's budget. Free solo play remains available without sponsorship.",
          "A saved sponsored transaction that a later one of the same service key overtook is signed again only after the network has rejected the exact bytes by nonce, does not know the transaction, and confirms the key nonce passed it, twice over at least 30 seconds. Nothing is paid twice.",
          "Some sponsored calls are checked against game and chain state first, so the relayer never pays for a call that only leaks its budget. NEAR Social writes are sponsored only for the game's own profile, map-note, place and encrypted inbox records (at most 4 KiB), and the 0.05 NEAR storage deposit only while the account's Social storage is short. `redeem_aura` is sponsored only for a voucher the game signed for that account, still valid and not yet redeemed. Cancelling one signed market order is sponsored only for your own open order in the game's book, at most 4 a day per account (16 across the game); Cancel all orders has no such limit.",
          "Adding a sign-in method to a secured explorer requires a recent sign-in with an existing method. Ordinary play uses the game session. A NEAR wallet links with a NEP-413 signature; MetaMask or Rabby sign in with SIWE and can sign Intents trades (erc191). A SocialDB profile is published once per account.",
          "Passkeys sign in to the game identity; they are not NEAR keys. Recovery restores the explorer by signing again with the linked wallet.",
          "A wallet transaction counts only after the server reads it as FINAL and matches it against the terms reviewed before signing. Unresolved transactions survive reloads in a local journal so a retry never signs twice.",
          "The device key lives in the signing origin's own storage, which browsers partition per game site. If a browser blocks that storage (some private windows, blocked site data), no account is created and Profile → Account and devices says so, with Try again; free play continues. `npm run e2e:signing-vault` covers creation, a sponsored signature, reload and blocked storage on Chromium and WebKit.",
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
    updated: "2026-11-08",
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
          "The solver's gas counts against the game's shared daily sponsorship budget, like every relayed action. When that budget is used up, fills and withdrawals wait for the next day (`SUBSIDY_BUDGET`); signed orders stay in the book.",
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
    updated: "2026-11-05",
    sources: ["docs/NEAR-AI-CLOUD.md", "docs/QUEST-FLAVOUR.md", "docs/AI-QUEST-DRAFTS.md", "server/ai/near-ai.mjs", "server/ai/flavour.mjs"],
    blocks: [
      { viz: "ai-chain" },
      {
        list: [
          "**NPC talk:** the configured provider order is NEAR AI Cloud, then Ollama, then a deterministic template. Signed responses are checked against their attestation report in the background. The reply shows its verification state; provider configuration alone does not establish attestation.",
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
    updated: "2026-11-05",
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
    updated: "2026-11-08",
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
          "Capacity depends on the build and workload. Dated load-test measurements are recorded in the performance report; physical-phone acceptance is a separate check.",
          "Phone budget: welcome-screen JS and CSS are capped; every big screen, this wiki included, loads lazily.",
          "English is the default language; other languages are opt-in dictionaries, checked on 390 px phones in CI.",
          "The testnet runs a removable test seed (bots, quests, starter kit); every seeded row has a `seed-` id.",
          "A deploy reinstalls the separate signing-vault origin by itself whenever its code or contract list changed.",
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
    updated: "2026-11-05",
    sources: ["docs/WIKI.md", "AGENTS.md", "scripts/wiki-check.mjs", "tests/wiki.test.mjs"],
    blocks: [
      { viz: "wiki-loop" },
      {
        list: [
          "Each chapter lists its sources. A hash of every source doc is kept in `docs/wiki-stamps.json`.",
          "When a mechanism doc changes, `npm test` fails until the matching chapter is reviewed and `npm run wiki:stamp` records the new hashes.",
          "A new doc must be added to a chapter's sources or explicitly marked as not a mechanism (plans, audits, hand-offs) in `docs/wiki-coverage.json`.",
          "Rule tables are imported from their owning files. Narrative examples and activation labels still need review against the current source and public checkpoint.",
          "The page never names events or contains secrets, keys or private hosts; the test checks the copy.",
          "Outside coding agents work from `docs/HANDOFF-WEEKEND.md`. A protected-paths CI guard lists every protected file a pull request touches (contracts, deploy or signing scripts, money code, sign-in and transaction signing, economy numbers, deployment records, CI and dependencies) for review, and fails any pull request that adds anything that looks like a secret.",
        ],
      },
    ],
  },
];
