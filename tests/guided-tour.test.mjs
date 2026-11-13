// Guided tour (docs/GUIDED-TOUR.md): steps tick only from the game's own records.
import test from "node:test";
import assert from "node:assert/strict";
import { openDatabase, createPlayer } from "../server/database.mjs";
import { tourState, tourAction, tourMark, TOUR_STEPS, TOUR_CHAPTERS } from "../server/tour/tour.mjs";
import { CHAIN_LEDGER_SCHEMA } from "../server/chain-ledger/schema.mjs";
import { ensureModuleVersion } from "../server/schema-compatibility.mjs";
const ensureChainSchema = (db) => ensureModuleVersion(db, CHAIN_LEDGER_SCHEMA);

test("off outside the Test Layer, and nothing shows before the explorer starts", () => {
  const db = openDatabase(":memory:");
  const p = createPlayer(db, "Tess", Date.now());
  assert.deepEqual(tourState(db, p, { enabled: false }), { enabled: false });
  const s = tourState(db, p, { enabled: true });
  assert.equal(s.started, false);
  assert.equal(s.current, null);
  assert.equal(s.total, TOUR_STEPS.length);
});

test("steps follow the ledger, skips never block, and the end lists the transactions", () => {
  const db = openDatabase(":memory:");
  ensureChainSchema(db);
  const p = createPlayer(db, "Tess", Date.now());
  tourAction(db, p, { action: "start" });
  assert.equal(tourState(db, p, { enabled: true }).current.id, "coin");
  db.prepare("INSERT INTO chain_actions(id,player_id,kind,xp,gold_u,cell,at,day,evidence,evidence_json,created_at) VALUES('ca1',?,'coin',3,5000,'u2fkb7x',?,'2026-11-12','e','{}',1)").run(p, Date.now() + 1);
  let s = tourState(db, p, { enabled: true });
  assert.equal(s.current.id, "find");
  assert.equal(s.last.id, "coin");
  tourAction(db, p, { action: "skip", step: "find" });
  assert.equal(tourState(db, p, { enabled: true }).current.id, "visit");
  assert.equal(s.transactions.count, 1);
  assert.throws(() => tourAction(db, p, { action: "skip", step: "nope" }), /Unknown tour step/);
  for (const step of TOUR_STEPS) tourAction(db, p, { action: "skip", step: step.id });
  s = tourState(db, p, { enabled: true });
  assert.equal(s.finished, true);
  assert.equal(s.done, 1);
  // A restart (the client sends one on every page load) begins at step one: what was done
  // in an earlier run no longer counts.
  tourAction(db, p, { action: "restart" }, Date.now() + 5);
  s = tourState(db, p, { enabled: true });
  assert.equal(s.current.id, "coin");
  assert.equal(s.current.number, 1);
  assert.equal(s.done, 0);
});

test("Settings switches Pip off and on, also before the tour began", () => {
  const db = openDatabase(":memory:");
  const p = createPlayer(db, "Tess", Date.now());
  tourAction(db, p, { action: "hide" });
  let s = tourState(db, p, { enabled: true });
  assert.equal(s.hidden, true);
  assert.equal(s.started, false);
  assert.throws(() => tourAction(db, p, { action: "skip", step: "coin" }), /Start the tour first/);
  tourAction(db, p, { action: "show" });
  s = tourState(db, p, { enabled: true });
  assert.equal(s.hidden, false);
  assert.equal(s.started, false);
  tourAction(db, p, { action: "start" });
  s = tourState(db, p, { enabled: true });
  assert.equal(s.started, true);
  assert.equal(s.current.id, "coin");
  tourAction(db, p, { action: "hide" });
  assert.equal(tourState(db, p, { enabled: true }).current.id, "coin");
  assert.equal(tourState(db, p, { enabled: true }).hidden, true);
});

test("every chapter has a step and every step points somewhere", () => {
  for (const c of TOUR_CHAPTERS) assert.ok(TOUR_STEPS.some((s) => s.chapter === c), c);
  for (const s of TOUR_STEPS) {
    assert.ok(TOUR_CHAPTERS.includes(s.chapter), s.id);
    assert.ok(s.target?.kind, s.id);
    assert.ok(s.say.length <= 40 && s.next.length <= 60 && (s.hint?.length ?? 0) <= 70, s.id);
  }
});

test("a chat with the companion bot counts as the message step", () => {
  const db = openDatabase(":memory:");
  const p = createPlayer(db, "Tess", Date.now());
  tourAction(db, p, { action: "start" });
  const done = () => tourState(db, p, { enabled: true }).steps.find((s) => s.id === "message").done;
  assert.equal(done(), false);
  tourMark(db, p, "message");
  tourMark(db, p, "message");
  assert.equal(done(), true);
});

test("a roll ticket from a Pocket Wisp ticks the ticket step, and the roll step points at the wisp roll", () => {
  const db = openDatabase(":memory:");
  const p = createPlayer(db, "Tess", Date.now());
  tourAction(db, p, { action: "start" });
  const done = () => tourState(db, p, { enabled: true }).steps.find((s) => s.id === "ticket").done;
  assert.equal(done(), false);
  db.exec("CREATE TABLE IF NOT EXISTS monster_rewards(player_id TEXT,source TEXT,kind TEXT,amount INTEGER,day_id TEXT,data TEXT,created_at INTEGER)");
  db.prepare("INSERT INTO monster_rewards VALUES(?,?,?,?,?,?,?)").run(p, "lurker:pocket-wisp-1", "roll", 1, "d", "{}", Date.now() + 1);
  assert.equal(done(), true);
  assert.deepEqual(TOUR_STEPS.find((s) => s.id === "roll").target, { kind: "screen", screen: "rolls" });
});

test("every step can be finished on World: a trail instead of a clue, no secure step, the vote by looking", () => {
  const db = openDatabase(":memory:");
  ensureChainSchema(db);
  const p = createPlayer(db, "Tess", Date.now());
  const ids = TOUR_STEPS.map((s) => s.id);
  assert.ok(!ids.includes("clue") && !ids.includes("secure"));
  assert.deepEqual(TOUR_STEPS.find((s) => s.id === "trail").target, { kind: "quest", quest: "route" });
  tourAction(db, p, { action: "start" });
  const step = (id) => tourState(db, p, { enabled: true }).steps.find((s) => s.id === id);
  // A finished trail is a claimed quest of kind route.
  db.prepare("INSERT INTO worlds(id,day,region,timezone,manifest,created_at) VALUES('w','2026-11-13','r','UTC','{}',1)").run();
  db.prepare("INSERT INTO quests(id,world_id,title,description,lat,lng,tier,gold_u,xp,kind,opens_at,closes_at) VALUES('q1','w','Three-stop trail','d',0,0,1,0,10,'route',0,9e15)").run();
  assert.equal(step("trail").done, false);
  db.prepare("INSERT INTO quest_claims VALUES('q1',?,?)").run(p, Date.now() + 1);
  assert.equal(step("trail").done, true);
  // Opening the vote finishes the last step for an explorer who cannot vote yet.
  assert.equal(step("vote").done, false);
  assert.throws(() => tourAction(db, p, { action: "seen", step: "coin" }), /Unknown tour step/);
  tourAction(db, p, { action: "seen", step: "vote" });
  assert.equal(step("vote").done, true);
});

test("the helper gets the step's place, its near hint and what it costs, and no chain words", () => {
  const db = openDatabase(":memory:");
  const p = createPlayer(db, "Tess", Date.now());
  tourAction(db, p, { action: "start" });
  for (const id of ["coin", "find"]) tourAction(db, p, { action: "skip", step: id });
  const s = tourState(db, p, { enabled: true });
  assert.equal(s.current.id, "visit");
  assert.equal(s.current.number, 3);
  assert.match(s.current.near, /confirm your visit/);
  assert.ok(TOUR_STEPS.find((x) => x.id === "shout").needs > 0);
  for (const x of TOUR_STEPS)
    assert.doesNotMatch(`${x.say} ${x.hint || ""} ${x.near || ""} ${x.next}`, /\bNEAR\b|NFT|Intents|escrow|on chain|\bburn/, x.id);
});
