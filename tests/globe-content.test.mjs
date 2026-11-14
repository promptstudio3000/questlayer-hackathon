import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import {
  createGlobeContent,
  globeSpots,
  playerQuestStarts,
} from "../server/globe-content.mjs";

function creatorDb() {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE creator_profiles(player_id TEXT PRIMARY KEY, public INTEGER NOT NULL);
    CREATE TABLE creator_quests(id TEXT PRIMARY KEY, author TEXT NOT NULL, state TEXT NOT NULL, published_revision INTEGER);
    CREATE TABLE creator_revisions(quest_id TEXT NOT NULL, revision INTEGER NOT NULL, content TEXT NOT NULL, state TEXT NOT NULL);
  `);
  const quest = (id, author, state, revState, place) => {
    db.prepare("INSERT INTO creator_quests VALUES(?,?,?,1)").run(id, author, state);
    db.prepare("INSERT INTO creator_revisions VALUES(?,1,?,?)").run(
      id,
      JSON.stringify({ title: "Secret title", place }),
      revState,
    );
  };
  db.prepare("INSERT INTO creator_profiles VALUES('pub',1),('priv',0)").run();
  const plzen = { points: [{ lat: 49.74745, lng: 13.3774 }] };
  quest("a", "pub", "published", "approved", plzen);
  quest("b", "pub", "published", "approved", { points: [{ lat: 49.7471, lng: 13.3779 }] });
  quest("c", "priv", "published", "approved", plzen); // private creator
  quest("d", "pub", "draft", "draft", plzen); // not published
  quest("e", "pub", "published", "approved", null); // no place
  quest("f", "pub", "published", "approved", { points: [{ lat: 200, lng: 0 }] });
  return db;
}

test("player quests count only published quests of public creators", () => {
  const starts = playerQuestStarts(creatorDb());
  assert.equal(starts.length, 2);
});

test("a host without creator tables has no player quests", () => {
  assert.deepEqual(playerQuestStarts(new DatabaseSync(":memory:")), []);
});

test("spots merge by rounded position and carry no names", () => {
  const spots = globeSpots({
    quests: playerQuestStarts(creatorDb()),
    cities: [
      { id: "plzen", name: "Plzeň", center: { lat: 49.74745, lng: 13.3774 } },
      { id: "plzen", center: { lat: 49.74745, lng: 13.3774 } }, // duplicate id
      { id: "lisbon", center: { lat: 38.7139, lng: -9.1394 } },
      { id: "broken" },
    ],
  });
  assert.deepEqual(spots, [
    [13.38, 49.75, 2, 1],
    [-9.14, 38.71, 0, 1],
  ]);
  assert.ok(!JSON.stringify(spots).includes("Secret"));
});

test("globe content is cached for five minutes", () => {
  let now = 0,
    reads = 0;
  const read = createGlobeContent({
    db: creatorDb(),
    cities: () => {
      reads++;
      return [{ id: "x", center: { lat: 1, lng: 2 } }];
    },
    clock: () => now,
  });
  const first = read();
  assert.deepEqual(first.totals, { playerQuests: 2, cities: 1 });
  now = 60_000;
  assert.equal(read(), first);
  now = 6 * 60_000;
  read();
  assert.equal(reads, 2);
});
