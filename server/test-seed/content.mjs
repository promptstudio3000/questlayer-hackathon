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
]);

// The explorer who buys what real players list on the practice market.
export const SEED_BUYER = "seed-p-marek";
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

// Auras seed explorers keep listed on the practice market. Restocked when sold.
export const SEED_LISTINGS = Object.freeze([
  { slug: "ember", seller: "seed-p-jana", aura: "Ember Wisp", price: 2_500 },
  { slug: "dew", seller: "seed-p-lucie", aura: "Dewfall Ring", price: 3_000 },
  { slug: "polar", seller: "seed-p-vera", aura: "Northern Lights", price: 12_000 },
  { slug: "storm", seller: "seed-p-tomas", aura: "Stormcrown", price: 35_000 },
]);

// Practice-GOLD tasks; the seed author approves the first submission and the
// task is reposted, so it can be tried again.
export const SEED_BOUNTIES = Object.freeze([
  { slug: "tower", creator: "seed-p-vera", title: "Count the bells in the cathedral tower", description: "Climb the tower and tell me how many bells you saw.", reward: 1_500, at: near(0.0001, 0.0002) },
  { slug: "menu", creator: "seed-p-tomas", title: "Today's soup at the brewery canteen", description: "Write which soup they serve today at the brewery canteen.", reward: 800, at: near(-0.0011, 0.0098) },
  { slug: "bench", creator: "seed-p-jana", title: "Find the bench with the brass plaque", description: "Somewhere in the park is a bench with a brass plaque. What does it say?", reward: 1_200, at: near(-0.0035, 0.0015) },
]);

export const SEED_CREATORS = Object.freeze([
  { player: "seed-p-vera", displayName: "Vera's Walks", bio: "Test creator. Short walks around the old town." },
  { player: "seed-p-tomas", displayName: "Tomas the Tinkerer", bio: "Test creator. Puzzles, trails and chests." },
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
