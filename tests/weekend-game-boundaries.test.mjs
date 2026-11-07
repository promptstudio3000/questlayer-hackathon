import test from "node:test";
import assert from "node:assert/strict";
import { openDatabase } from "../server/database.mjs";
import { buildLandmarkClue, answerClue, clueView, ensureLandmarkClueSchema } from "../server/landmark-clue.mjs";
import { createTrace, scoreTrace } from "../server/actors/challenges/minigames.mjs";
import { moveTraceCursor, addSample } from "../src/monster-challenge.ts";

test("keyboard trace coordinates can finish real server-scored paths without a pointer", () => {
  for (const seed of ["corner", "zigzag", "short", "long"]) {
    const c = createTrace(seed), samples = [];
    let cursor = [...c.points[0]], time = 0;
    addSample(samples, cursor, time);
    for (const target of c.points.slice(1)) {
      let moves = 0;
      while (Math.hypot(target[0]-cursor[0], target[1]-cursor[1]) > 0.018) {
        assert.ok(++moves < 300, "cursor can reach the next rune");
        const x = target[0]-cursor[0], y = target[1]-cursor[1];
        cursor = moveTraceCursor(cursor, Math.abs(x)>Math.abs(y) ? x>0 ? "ArrowRight":"ArrowLeft" : y>0 ? "ArrowDown":"ArrowUp");
        time += 35;
        addSample(samples, cursor, time);
      }
    }
    assert.equal(scoreTrace(c, { samples }).won, true, seed);
  }
});

test("cursor stays on the board and unrelated keys cannot record an invented move", () => {
  assert.deepEqual(moveTraceCursor([0,0], "ArrowLeft"), [0,0]);
  assert.deepEqual(moveTraceCursor([1,1], "ArrowDown"), [1,1]);
  assert.deepEqual(moveTraceCursor([0.5,0.5], "Tab"), [0.5,0.5]);
});

test("unverified future or out-of-range inception dates never invent a clue", () => {
  for (const inception of [2027,-2001,Infinity,NaN,"1350"]) {
    assert.equal(buildLandmarkClue({ poi:{id:"x",name:"A place",facts:{inception}},seed:"fixed",nowYear:2026 }),null);
  }
});

test("a clue answer is private to its explorer and an invalid choice writes nothing", () => {
  const db = openDatabase(":memory:");
  db.exec(`INSERT INTO players(id,name,created_at) VALUES ('alice','Alice',0),('bob','Bob',0);
    INSERT INTO worlds(id,day,region,timezone,manifest,created_at) VALUES ('world','2026-11-05','fixture','UTC','{}',0);
    INSERT INTO quests(id,world_id,title,description,lat,lng,tier,gold_u,xp,kind,opens_at,closes_at) VALUES ('quest','world','Clue','Fixture',0,0,1,0,0,'visit',0,10000);`);
  ensureLandmarkClueSchema(db);
  try {
    const clue = buildLandmarkClue({poi:{id:"place",name:"Old tower",facts:{inception:1350}},seed:"fixed",nowYear:2026});
    const input = {questId:"quest",player:"alice",clue,choice:clue.answer,now:1000};
    assert.equal(clueView(db,"quest",clue,"alice","ar").result,undefined);
    assert.throws(()=>answerClue(db,{...input,choice:"not-an-option"}));
    assert.equal(db.prepare("SELECT COUNT(*) n FROM landmark_clue_answers").get().n,0);
    const first = answerClue(db,input);
    assert.equal(first.correct,true);
    assert.throws(()=>answerClue(db,{...input,now:2000}),/UNIQUE/);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM landmark_clue_answers").get().n,1);
    assert.ok(clueView(db,"quest",clue,"alice").result);
    assert.equal(clueView(db,"quest",clue,"bob").result,undefined);
  } finally { db.close(); }
});
