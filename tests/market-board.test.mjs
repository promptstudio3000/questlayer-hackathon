import test from "node:test";
import assert from "node:assert/strict";
import { arrangeListings, shortNear } from "../src/market-board.ts";

const NEAR = 10n ** 24n;
const listing = (over) => ({
  key: over.title,
  source: "intents",
  id: over.title,
  tokenId: over.title,
  edition: null,
  color: null,
  price: over.pays,
  seller: "x.testnet",
  mine: false,
  slot: "above",
  rarity: "common",
  ...over,
});
const list = () => [
  listing({ title: "Moon Ring", rarity: "epic", pays: String(NEAR / 10n), order: 2 }),
  listing({ title: "Ember Wisp", rarity: "common", pays: String(NEAR / 50n), order: 3, slot: "below", mine: true }),
  listing({ title: "Golden Dust", rarity: "legendary", pays: String(NEAR / 20n), order: 1 }),
];
const titles = (rows) => rows.map((l) => l.title);

test("market sorts by newest, name, rarity and price", () => {
  assert.deepEqual(titles(arrangeListings(list(), "all", "newest")), ["Ember Wisp", "Moon Ring", "Golden Dust"]);
  assert.deepEqual(titles(arrangeListings(list(), "all", "name")), ["Ember Wisp", "Golden Dust", "Moon Ring"]);
  assert.deepEqual(titles(arrangeListings(list(), "all", "rarity")), ["Golden Dust", "Moon Ring", "Ember Wisp"]);
  assert.deepEqual(titles(arrangeListings(list(), "all", "price-up")), ["Ember Wisp", "Golden Dust", "Moon Ring"]);
  assert.deepEqual(titles(arrangeListings(list(), "all", "price-down")), ["Moon Ring", "Golden Dust", "Ember Wisp"]);
});

test("market filters by slot and by own listings", () => {
  assert.deepEqual(titles(arrangeListings(list(), "below", "name")), ["Ember Wisp"]);
  assert.deepEqual(titles(arrangeListings(list(), "above", "name")), ["Golden Dust", "Moon Ring"]);
  assert.deepEqual(titles(arrangeListings(list(), "mine", "name")), ["Ember Wisp"]);
});

test("card prices round up to 4 decimals so the buyer never pays more than shown", () => {
  // 0.02 NEAR plus a 2 % fee on top: 0.020408163… → 0.0205
  assert.equal(shortNear("20408163265306122448980"), "0.0205");
  assert.equal(shortNear(String(NEAR / 20n)), "0.05");
  assert.equal(shortNear(String(3n * NEAR)), "3");
  // Below 0.0001 the exact amount is shown instead of a rounded one.
  assert.equal(shortNear("50000000000000000000"), "0.00005");
});
