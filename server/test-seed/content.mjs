// Testnet test world content (docs/TEST-SEED.md). Every row this seed writes
// carries an id starting with SEED_PREFIX so one purge can find all of it.
import { GOLD } from "../domain.mjs";
import { OBSERVATION_POLICY } from "../creators/completion-policy.mjs";

export const SEED_VERSION = "testnet-world-v1";
export const SEED_PREFIX = "seed-";

// Plzeň, náměstí Republiky (the arena and city pack centre).
export const SEED_CENTER = Object.freeze({ lat: 49.74745, lng: 13.3774 });

// Simulated explorers. `walk` explorers follow real pedestrian paths from the
// city pack; `companion` stays near the most recently active real explorer.
export const SEED_PLAYERS = Object.freeze([
  { id: "seed-p-vera", name: "Vera", color: "#ff9fc8", xp: 2400, gold: 400_000, walk: true, auras: ["Northern Lights", "Meadow Bloom"] },
  { id: "seed-p-tomas", name: "Tomas", color: "#8fd3ff", xp: 1600, gold: 300_000, walk: true, auras: ["Stormcrown"] },
  { id: "seed-p-jana", name: "Jana", color: "#9bd17a", xp: 900, gold: 250_000, walk: true, auras: ["Dewfall Ring"] },
  { id: "seed-p-marek", name: "Marek", color: "#e0a94a", xp: 700, gold: 900_000, walk: true, auras: ["Ember Wisp"] },
  { id: "seed-p-lucie", name: "Lucie", color: "#c2a0df", xp: 300, gold: 150_000, walk: true, auras: [] },
  { id: "seed-p-ondra", name: "Ondra", color: "#7cf0b0", xp: 500, gold: 200_000, companion: true, auras: ["Comet Trail"] },
  // Creators who do not walk the map: they build quests and post tasks.
  { id: "seed-p-klara", name: "Klara", color: "#ffb36b", xp: 3100, gold: 0, auras: ["Golden Dust", "Moon Ring"] },
  { id: "seed-p-petr", name: "Petr", color: "#6bc7ff", xp: 1900, gold: 0, auras: ["Stormcrown"] },
  { id: "seed-p-eva", name: "Eva", color: "#f28bd2", xp: 1400, gold: 0, auras: ["Meadow Bloom", "Dewfall Ring"] },
  { id: "seed-p-honza", name: "Honza", color: "#a7e06b", xp: 2600, gold: 0, auras: ["Ember Wisp", "Moon Ring"] },
]);

// The explorer who buys what real players list on the practice market.
export const SEED_BUYER = "seed-p-marek";
// Seed explorers who finish the daily board every world day, each this many
// hours after the day starts, so "explorers finished today" grows during the
// day (docs/DAILY-BOARD.md). They get no XP for it.
export const SEED_BOARD_FINISHERS = Object.freeze([
  { id: "seed-p-vera", afterHours: 7 },
  { id: "seed-p-tomas", afterHours: 11 },
  { id: "seed-p-jana", afterHours: 16 },
]);
export const BUYER_MAX_PRICE_U = 60_000 * GOLD;
export const BUYER_DELAY_MS = 45_000;
// How long a seed author "takes" to approve a task or creator completion.
export const REVIEW_DELAY_MS = 30_000;

const near = (dLat, dLng) => ({
  lat: Math.round((SEED_CENTER.lat + dLat) * 1e5) / 1e5,
  lng: Math.round((SEED_CENTER.lng + dLng) * 1e5) / 1e5,
});

export const SEED_NOTES = Object.freeze([
  { slug: "cathedral", author: "seed-p-vera", text: "The tower of St Bartholomew is open today, 301 steps to the top. Worth it!", at: near(0.0001, 0.0002) },
  { slug: "fountain", author: "seed-p-tomas", text: "Golden fountain on the square: a wisp was hanging around here at noon.", at: near(-0.0006, -0.0009) },
  { slug: "brewery", author: "seed-p-jana", text: "Coins near the brewery gate are easy, watch out for the guardian by the river.", at: near(-0.0011, 0.0098) },
  { slug: "park", author: "seed-p-lucie", text: "Kopecký park is quiet, good place to read the chronicler's stories.", at: near(-0.0035, 0.0015) },
  { slug: "synagogue", author: "seed-p-marek", text: "Buying Auras on the market today, list yours and I'll take a look.", at: near(-0.0012, -0.0068) },
  { slug: "radbuza", author: "seed-p-ondra", text: "Radbuza riverbank walk: three monsters spotted, bring friends for the boss.", at: near(-0.0042, -0.0085) },
]);

// Community places (Community · Places): spots seed explorers recommend
// around the square. Free; no QGOLD or XP moves.
export const SEED_COMMUNITY_PLACES = Object.freeze([
  { slug: "tower-view", author: "seed-p-vera", kind: "view", name: "St Bartholomew's tower", note: "The highest church tower in Czechia. On a clear day you see the Šumava hills from the top.", at: near(0.0001, 0.0002) },
  { slug: "courtyard", author: "seed-p-jana", kind: "hidden", name: "Courtyard behind the bookshop", note: "A quiet passage off the square with a stone well. Nice place to sit down for a minute.", at: near(-0.0009, 0.0021) },
  { slug: "kopecky", author: "seed-p-lucie", kind: "nature", name: "Kopecký park", note: "Shady benches, ducks in the pond and almost no traffic noise.", at: near(-0.0035, 0.0015) },
  { slug: "synagogue", author: "seed-p-marek", kind: "history", name: "Great Synagogue", note: "The third largest synagogue in the world. The facade is worth a slow walk around.", at: near(-0.0012, -0.0068) },
  { slug: "mural", author: "seed-p-tomas", kind: "art", name: "Purple ghost mural", note: "A tiny ghost painted under a window on the corner house. Look up!", at: near(0.0016, -0.0024) },
  { slug: "coffee", author: "seed-p-ondra", kind: "food", name: "Coffee by the fountains", note: "Good flat white and a window seat with a view of the golden fountains.", at: near(-0.0005, -0.0012) },
  { slug: "riverside", author: "seed-p-jana", kind: "play", name: "Radbuza riverside path", note: "Flat gravel path along the river, great for a walking hunt with friends.", at: near(-0.0042, -0.0085) },
]);

// Shouts and topics (Community · Local chat). Seed topics stay free for good;
// seed shouts are kept on the map for the next 7 days on every start.
export const SEED_PLACE_THREADS = Object.freeze([
  { slug: "shout-fountain", kind: "shout", author: "seed-p-tomas", text: "Wisp spotted by the golden fountain right now! 👻", at: near(-0.0006, -0.0009) },
  { slug: "shout-boss", kind: "shout", author: "seed-p-ondra", text: "Boss hunt at the Radbuza at 6 pm, who's in?", at: near(-0.0042, -0.0085) },
  {
    slug: "topic-routes",
    kind: "topic",
    author: "seed-p-vera",
    title: "Best walking loop around the old town?",
    text: "Share your favourite loop for a 30 minute evening walk. Mine starts at the square and ends in Kopecký park.",
    at: near(0.0002, 0.0004),
    replies: [
      { author: "seed-p-jana", text: "Square, synagogue, then back along the park ring. Lots of coins on the way." },
      { author: "seed-p-lucie", text: "I add the riverside path when the weather is good." },
    ],
  },
  {
    slug: "topic-trade",
    kind: "topic",
    author: "seed-p-marek",
    title: "Aura swap meetup",
    text: "Bring the Auras you want to swap. Saturday afternoon by the fountains.",
    at: near(-0.0006, -0.0011),
    replies: [{ author: "seed-p-tomas", text: "I have a spare Stormcrown, looking for Meadow Bloom." }],
  },
]);

// Auras seed explorers keep listed on the practice market. Restocked when sold.
export const SEED_LISTINGS = Object.freeze([
  { slug: "ember", seller: "seed-p-jana", aura: "Ember Wisp", price: 2_500 },
  { slug: "dew", seller: "seed-p-lucie", aura: "Dewfall Ring", price: 3_000 },
  { slug: "polar", seller: "seed-p-vera", aura: "Northern Lights", price: 12_000 },
  { slug: "storm", seller: "seed-p-tomas", aura: "Stormcrown", price: 35_000 },
]);

// Player tasks (Community · Tasks) posted by demo bots, so the list shows how
// explorers post paid work for each other. Examples only: no QGOLD is held for
// them and they cannot be taken (server/market/service.mjs refuses seed- tasks).
export const SEED_TASKS = Object.freeze([
  { slug: "tower-photo", poster: "seed-p-vera", type: "photo", title: "Photo of the square from the tower", description: "Climb St Bartholomew's tower and take one photo of the whole square.", reward: 40, slots: 3, at: near(0.0001, 0.0002) },
  { slug: "bells", poster: "seed-p-klara", type: "answer", title: "How many bells hang in the tower?", description: "Count the bells you can see from the gallery and write the number.", reward: 15, slots: 5, at: near(0.0001, 0.0002) },
  { slug: "soup", poster: "seed-p-tomas", type: "go", title: "Check today's soup at the brewery canteen", description: "Walk to the brewery gate canteen and tell me which soup they serve today.", reward: 10, slots: 2, at: near(-0.0011, 0.0098) },
  { slug: "book", poster: "seed-p-eva", type: "deliver", title: "Bring a book to the bookshop courtyard", description: "Leave a book you have read on the bench in the courtyard behind the bookshop.", reward: 25, slots: 1, at: near(-0.0009, 0.0021) },
  { slug: "boss", poster: "seed-p-ondra", type: "meet", title: "Boss hunt team at the Radbuza", description: "Meet by the riverside path at 6 pm, we need four explorers for the boss.", reward: 20, slots: 4, at: near(-0.0042, -0.0085) },
  { slug: "litter", poster: "seed-p-honza", type: "collect", title: "Pick up litter in Kopecký park", description: "Fill one bag with litter around the pond and send a photo of the full bag.", reward: 30, slots: 5, at: near(-0.0035, 0.0015) },
  { slug: "mural", poster: "seed-p-petr", type: "create", title: "Draw the ghost mural", description: "Sketch the little purple ghost on the corner house and share the drawing.", reward: 35, slots: 2, at: near(0.0016, -0.0024) },
]);

// Free Secrets around the demo square, so the Nearby list is never empty.
// Price 0 and no visit reward: revealing one moves no QGOLD.
export const SEED_SECRETS = Object.freeze([
  { slug: "courtyard", creator: "seed-p-vera", title: "The quiet courtyard", teaser: "A hidden courtyard a few steps off the square.", reveal: "Walk through the passage next to the bookshop: the courtyard behind it has a stone well and a bench in the shade.", at: near(-0.0009, 0.0021) },
  { slug: "mural", creator: "seed-p-tomas", title: "Ghost mural", teaser: "Somebody painted a friendly ghost on a wall nearby.", reveal: "Look up at the side wall of the corner house: a small purple ghost is painted under the window.", at: near(0.0016, -0.0024) },
  { slug: "viewpoint", creator: "seed-p-jana", title: "Riverside viewpoint", teaser: "The best view of the river bend, if you know where to stand.", reveal: "Stand on the low wall at the end of the riverside path: you see both bridges and the cathedral tower at once.", at: near(-0.0038, -0.0079) },
]);

export const SEED_CREATORS = Object.freeze([
  { player: "seed-p-vera", displayName: "Vera's Walks", bio: "Short walks around the old town, one story per street." },
  { player: "seed-p-tomas", displayName: "Tomas the Tinkerer", bio: "Puzzles, riddles and chests hidden by the river." },
  { player: "seed-p-klara", displayName: "Klara Maps Plzeň", bio: "Trails for a slow evening: towers, courtyards and views." },
  { player: "seed-p-jana", displayName: "Jana's Parks", bio: "Green corners of the city, best with a coffee." },
  { player: "seed-p-honza", displayName: "Honza Hunts", bio: "Chests and monster trails for groups of friends." },
  { player: "seed-p-eva", displayName: "Eva Draws", bio: "Murals, statues and small details nobody looks up at." },
  { player: "seed-p-petr", displayName: "Petr's History", bio: "Five minutes of history at every stop." },
  { player: "seed-p-lucie", displayName: "Lucie Reads", bio: "Quiet places to read the chronicler's stories." },
]);

// Explorers who follow seed creators, so creator cards show followers.
export const SEED_FOLLOWS = Object.freeze([
  ["seed-p-marek", "seed-p-vera"], ["seed-p-jana", "seed-p-vera"], ["seed-p-ondra", "seed-p-vera"], ["seed-p-lucie", "seed-p-vera"],
  ["seed-p-vera", "seed-p-klara"], ["seed-p-tomas", "seed-p-klara"], ["seed-p-petr", "seed-p-klara"],
  ["seed-p-ondra", "seed-p-honza"], ["seed-p-marek", "seed-p-honza"], ["seed-p-vera", "seed-p-tomas"],
  ["seed-p-eva", "seed-p-jana"], ["seed-p-klara", "seed-p-eva"], ["seed-p-honza", "seed-p-petr"],
]);

const requirement = (prompt) => ({
  template: OBSERVATION_POLICY.template,
  policyVersion: OBSERVATION_POLICY.version,
  prompt,
});

export const SEED_CREATOR_QUESTS = Object.freeze([
  {
    id: "seed-q-square-hello",
    author: "seed-p-vera",
    draft: {
      title: "Hello from the square",
      description: "Stand in the middle of náměstí Republiky and look for the three golden fountains.",
      place: { template: "visit", points: [near(-0.0004, -0.0006)] },
      requirement: requirement("Which animal sits on top of one of the golden fountains?"),
    },
  },
  {
    id: "seed-q-old-town-trail",
    author: "seed-p-vera",
    draft: {
      title: "Old town trail",
      description: "A gentle loop: the square, the Great Synagogue and back along the park ring.",
      place: { template: "trail", points: [near(0, 0), near(-0.0012, -0.0068), near(-0.0035, 0.0015)] },
      requirement: requirement("What colour is the synagogue's facade?"),
    },
  },
  {
    id: "seed-q-river-chest",
    author: "seed-p-tomas",
    draft: {
      title: "Chest by the Radbuza",
      description: "Somebody hid a chest near the river bend. Find it before the monsters do.",
      place: { template: "chest", points: [near(-0.0042, -0.0085)] },
      requirement: requirement("Name the bridge you can see from the chest."),
    },
  },
  {
    id: "seed-q-brewery-gate",
    author: "seed-p-tomas",
    draft: {
      title: "The brewery gate riddle",
      description: "Walk to the brewery gate and solve the riddle written above it.",
      place: { template: "visit", points: [near(-0.0011, 0.0098)] },
      requirement: requirement("Which year is written on the brewery gate?"),
    },
  },
  {
    id: "seed-q-tower-trail",
    author: "seed-p-klara",
    draft: {
      title: "Towers of the old town",
      description: "Four stops, four towers: the cathedral, the town hall, the synagogue and the water tower.",
      place: { template: "trail", points: [near(0.0001, 0.0002), near(0.0004, -0.0006), near(-0.0012, -0.0068), near(-0.0025, -0.0035)] },
      requirement: requirement("Which tower did you like most and why?"),
    },
  },
  {
    id: "seed-q-courtyard",
    author: "seed-p-klara",
    draft: {
      title: "The courtyard behind the bookshop",
      description: "Find the quiet passage off the square and the stone well behind it.",
      place: { template: "visit", points: [near(-0.0009, 0.0021)] },
      requirement: requirement("What is carved on the stone well?"),
    },
  },
  {
    id: "seed-q-park-pond",
    author: "seed-p-jana",
    draft: {
      title: "Ducks of Kopecký park",
      description: "Sit by the pond in Kopecký park for five minutes and count the ducks.",
      place: { template: "visit", points: [near(-0.0035, 0.0015)] },
      requirement: requirement("How many ducks did you count?"),
    },
  },
  {
    id: "seed-q-guardian-chest",
    author: "seed-p-honza",
    draft: {
      title: "Chest of the river guardian",
      description: "A chest waits where the guardian roams. Bring friends, it is safer.",
      place: { template: "chest", points: [near(-0.0038, -0.0079)] },
      requirement: requirement("What did you see written on the chest?"),
    },
  },
  {
    id: "seed-q-ghost-mural",
    author: "seed-p-eva",
    draft: {
      title: "The tiny purple ghost",
      description: "Look up at the corner house: a small ghost is painted under a window.",
      place: { template: "visit", points: [near(0.0016, -0.0024)] },
      requirement: requirement("Which window is the ghost painted under?"),
    },
  },
  {
    id: "seed-q-history-loop",
    author: "seed-p-petr",
    draft: {
      title: "Five minutes of history",
      description: "Three stops between the square and the synagogue, each with one fact to find.",
      place: { template: "trail", points: [near(0, 0), near(-0.0006, -0.0011), near(-0.0012, -0.0068)] },
      requirement: requirement("Write one fact you learned on the way."),
    },
  },
  {
    id: "seed-q-reading-bench",
    author: "seed-p-lucie",
    draft: {
      title: "A bench for reading",
      description: "Find the bench with the brass plaque in the park and read one story there.",
      place: { template: "visit", points: [near(-0.0031, 0.0011)] },
      requirement: requirement("What does the brass plaque say?"),
    },
  },
  {
    id: "seed-q-free-story",
    author: "seed-p-tomas",
    draft: {
      title: "Tell me a city story",
      description: "No place needed. Tell a short story about your favourite spot in Plzeň.",
      requirement: requirement("Write two or three sentences about your favourite spot."),
    },
  },
]);

// Granted once to every real explorer while the seed is active. Enough Auras
// to fill a backpack row or two across every rarity and both slots (Ember Wisp
// twice, so stacked duplicates show up), and XP that lands a new explorer in
// the middle of level 3 (400-900 XP) so the level bar is visibly part filled.
// `equip` pairs Northern Lights and Moon Ring (Night Sky set) only when the
// explorer has nothing worn in that slot yet.
export const STARTER_KIT = Object.freeze({
  auras: Object.freeze([
    "Northern Lights",
    "Ember Wisp",
    "Ember Wisp",
    "Dewfall Ring",
    "Meadow Bloom",
    "Moon Ring",
    "Stormcrown",
    "Comet Trail",
    "Golden Dust",
  ]),
  equip: Object.freeze(["Northern Lights", "Moon Ring"]),
  xp: 650,
  shards: Object.freeze({ ember: 4, frost: 3, storm: 3 }),
});
