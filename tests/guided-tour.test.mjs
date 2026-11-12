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
  db.prepare("INSERT INTO chain_actions(id,player_id,kind,xp,gold_u,cell,at,day,evidence,evidence_json,created_at) VALUES('ca1',?,'coin',3,5000,'u2fkb7x',1,'2026-11-12','e','{}',1)").run(p);
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
  tourAction(db, p, { action: "restart" });
  assert.equal(tourState(db, p, { enabled: true }).current.id, "find");
});

test("every chapter has a step and every step points somewhere", () => {
  for (const c of TOUR_CHAPTERS) assert.ok(TOUR_STEPS.some((s) => s.chapter === c), c);
  for (const s of TOUR_STEPS) {
    assert.ok(TOUR_CHAPTERS.includes(s.chapter), s.id);
    assert.ok(s.target?.kind, s.id);
    assert.ok(s.say.length <= 40 && s.next.length <= 60, s.id);
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
