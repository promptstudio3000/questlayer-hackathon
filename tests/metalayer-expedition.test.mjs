import test from "node:test";
import assert from "node:assert/strict";
import { openDatabase } from "../server/database.mjs";
import { createExpeditionStore } from "../server/layer/expedition.mjs";
import { LAYER_REGISTRY } from "../server/layer/layers.mjs";
import { SIGNAL_SITES, MARKER, WORLD_PLACES, placeById } from "../server/layer/story-world.mjs";
import { BLOCK } from "../server/layer/world.mjs";
import {
  DIAMOND_ORE,
  ORE_RENEW_MS,
  protectedPlaza,
  PLAZA_SPAWN,
  naturalExpeditionBlock,
} from "../server/layer/expedition-world.mjs";

function fixture(t) {
  const db = openDatabase(":memory:"),
    clock = { at: 100_000 };
  t.after(() => db.close());
  const actors = ["Alice", "Bob"].map((name) => {
    const id = `ml-${name}`;
    db.prepare("INSERT INTO players(id,name,created_at) VALUES(?,?,?)").run(
      id,
      name,
      1,
    );
    return { id, name };
  });
  const store = createExpeditionStore(db, { now: () => clock.at });
  const positions = new Map();
  for (const actor of actors) positions.set(actor.id, store.enter(actor).spawn);
  function walk(actor, target) {
    let from = positions.get(actor.id);
    for (let n = 0; n < 100; n++) {
      const distance = Math.hypot(target.x - from.x, target.z - from.z);
      const k = distance ? Math.min(1, 3 / distance) : 1;
      const next = {
        x: from.x + (target.x - from.x) * k,
        y: target.y ?? from.y,
        z: from.z + (target.z - from.z) * k,
      };
      clock.at += 500;
      assert.equal(store.move(actor, undefined, next).corrected, null);
      positions.set(actor.id, next);
      from = next;
      if (k === 1) return;
    }
    throw Error("Fixture walk did not converge");
  }
  return { db, clock, actors, store, walk };
}
const input = (values = {}) => ({
  requestId: "request-000000000001",
  ...values,
});

test("all explorers enter one square and share atlas discoveries without sharing resource balances", (t) => {
  const {
    store,
    actors: [alice, bob],
    walk,
  } = fixture(t);
  assert.ok(
    protectedPlaza(store.enter(alice).spawn.x, store.enter(alice).spawn.z),
  );
  walk(alice, { x: 0.5, y: 15, z: -48.5 });
  const bobMap = store.snapshot(bob, undefined, 0, -48);
  assert.ok(bobMap.tiles.some(([x, z]) => x === 0 && z === -4));
  assert.deepEqual(bobMap.inventory, { diamonds: 0, stone: 0 });
  assert.equal(store.snapshot(alice).quest.state, "available");
  assert.equal(
    store.startQuest(alice, {}).quest.state,
    "mine",
    "already discovered cave remains a useful accepted objective",
  );
});

test("world visits create personal, durable discoveries without starting a quest or granting an asset", (t) => {
  const {db, clock, store, actors:[alice,bob], walk} = fixture(t);
  const treasury=placeById("treasury");
  walk(alice,{x:12.5,z:-9.5});
  walk(alice,{x:treasury.x,z:-9.5});
  walk(alice,treasury);
  const first=store.snapshot(alice);
  assert.ok(first.discoveries.includes("nera"));
  assert.ok(first.discoveries.includes("treasury"));
  assert.equal(first.quest.state,"available");
  assert.ok(!store.snapshot(bob).discoveries.includes("treasury"));
  walk(alice,{x:treasury.x+1,z:treasury.z}); walk(alice,treasury);
  const visits=db.prepare("SELECT COUNT(*) AS n FROM ml_actions WHERE layer='space' AND player_id=? AND kind='place-found' AND json_extract(envelope,'$.data.place')='treasury'").get(alice.id);
  assert.equal(visits.n,1,"repeated presence keeps one discovery receipt");
  const reopened=createExpeditionStore(db,{now:()=>clock.at});
  assert.deepEqual(reopened.snapshot(alice).discoveries,first.discoveries);
  assert.deepEqual(reopened.snapshot(alice).inventory,{diamonds:0,stone:0});
  assert.equal(db.prepare("SELECT xp FROM players WHERE id=?").get(alice.id).xp,0);
  assert.ok(store.move(alice,undefined,{x:-22.5,y:15,z:32.5}).corrected);
  assert.ok(!store.snapshot(alice).discoveries.includes("workshop"),"rejected teleports cannot discover a place");
});

test("the guide, signs and demo workshop have protected clear approaches", () => {
  const seed=LAYER_REGISTRY[0].seed;
  for(const place of WORLD_PLACES) {
    if (place.id !== "quarry") assert.ok(protectedPlaza(Math.floor(place.x),Math.floor(place.z)),place.id);
    for(const y of [15,16]) assert.equal(naturalExpeditionBlock(seed,Math.floor(place.x),y,Math.floor(place.z)),BLOCK.air,place.id);
  }
  assert.equal(protectedPlaza(MARKER.x,MARKER.z),false,"protect the sign beside the editable shared-marker site");
});

test("public square edits are shared, compare their previous block and retry exactly once", (t) => {
  const {
    store,
    actors: [alice, bob],
    walk,
  } = fixture(t);
  walk(alice, { x: 7.5, y: 15, z: 11.5 });
  const edit = input({
    x: 9,
    y: 15,
    z: 11,
    block: BLOCK.plank,
    expected: BLOCK.air,
  });
  const saved = store.edit(alice, edit);
  assert.deepEqual(store.edit(alice, edit), saved);
  assert.ok(
    store
      .snapshot(bob)
      .changes.some(
        ([x, y, z, block]) =>
          x === 9 && y === 15 && z === 11 && block === BLOCK.plank,
      ),
  );
  walk(bob, { x: 14.5, y: 15, z: 14.5 });
  walk(bob, { x: 7.5, y: 15, z: 14.5 });
  walk(bob, { x: 7.5, y: 15, z: 11.5 });
  assert.throws(
    () => store.edit(bob, edit),
    (error) => error.status === 409,
  );
  assert.throws(
    () => store.edit(alice, { ...edit, block: BLOCK.glass }),
    (error) => error.status === 409,
  );
  store.edit(
    bob,
    input({ x: 9, y: 15, z: 11, block: BLOCK.air, expected: BLOCK.plank }),
  );
  assert.throws(
    () =>
      store.edit(
        alice,
        input({
          requestId: "request-protected000",
          x: 0,
          y: 16,
          z: 0,
          block: BLOCK.plank,
          expected: BLOCK.crystal,
        }),
      ),
    (error) => error.status === 403,
  );
  assert.throws(
    () =>
      store.edit(
        alice,
        input({
          requestId: "request-far-away000",
          x: 30,
          y: 15,
          z: 30,
          block: BLOCK.plank,
          expected: BLOCK.air,
        }),
      ),
    (error) => error.status === 403,
  );
});

test("a shared ore pays one resource once, enforces holding time and renews after its interval", (t) => {
  const {
    store,
    actors: [alice, bob],
    walk,
    clock,
  } = fixture(t);
  for (const actor of [alice, bob]) walk(actor, { x: 3.5, y: 15, z: -49.5 });
  const target = { x: 5, y: 15, z: -50 };
  assert.equal(
    naturalExpeditionBlock(LAYER_REGISTRY[0].seed, 5, 15, -50),
    DIAMOND_ORE,
  );
  const a = store.startMining(alice, target),
    b = store.startMining(bob, target);
  assert.throws(
    () => store.finishMining(alice, input({ token: a.token })),
    (error) => error.status === 409,
  );
  clock.at += a.durationMs;
  const receipt = store.finishMining(alice, input({ token: a.token }));
  assert.equal(receipt.inventory.diamonds, 1);
  assert.deepEqual(
    store.finishMining(alice, input({ token: a.token })),
    receipt,
  );
  assert.throws(
    () => store.finishMining(bob, input({ token: b.token })),
    (error) => error.status === 409,
  );
  assert.equal(store.snapshot(bob).inventory.diamonds, 0);
  clock.at += ORE_RENEW_MS;
  store.move(bob, undefined, { x: 3.5, y: 15, z: -49.5 });
  const renewed = store.startMining(bob, target);
  clock.at += renewed.durationMs;
  assert.equal(
    store.finishMining(
      bob,
      input({ requestId: "request-000000000002", token: renewed.token }),
    ).inventory.diamonds,
    1,
  );
});

test("the expedition counts ten natural diamonds and preserves its exact inventory through reopening", (t) => {
  const {
    db,
    clock,
    store,
    actors: [alice],
    walk,
  } = fixture(t);
  assert.equal(store.startQuest(alice, {}).quest.state, "discover");
  walk(alice, { x: 3.5, y: 15, z: -48.5 });
  let last;
  let n = 0;
  for (const z of [-50, -52, -54, -56, -58]) {
    walk(alice, { x: 3.5, y: 15, z: z + 0.5 });
    for (const y of [15, 17]) {
      const job = store.startMining(alice, { x: 5, y, z });
      clock.at += job.durationMs;
      last = store.finishMining(
        alice,
        input({
          requestId: `mine-request-${String(++n).padStart(8, "0")}`,
          token: job.token,
        }),
      );
    }
  }
  assert.equal(last.quest.state, "complete");
  assert.equal(last.quest.diamonds, 10);
  assert.equal(last.inventory.diamonds, 10);
  const reopened = createExpeditionStore(db, { now: () => clock.at });
  assert.equal(reopened.enter(alice).quest.state, "complete");
  assert.equal(reopened.snapshot(alice).inventory.diamonds, 10);
  assert.equal(last.settlement, "not-configured");
  assert.equal(
    db.prepare("SELECT xp FROM players WHERE id=?").get(alice.id).xp,
    0,
    "preview does not issue QuestLayer XP",
  );
  assert.equal(
    db
      .prepare("SELECT COUNT(*) AS n FROM inventory WHERE player_id=?")
      .get(alice.id).n,
    0,
    "preview resources stay outside QuestLayer items",
  );
});

test("teleports, stale positions, blocked rays, invented ore and mining another player's token fail", (t) => {
  const {
    store,
    actors: [alice, bob],
    clock,
    walk,
  } = fixture(t);
  const spawn = store.enter(alice).spawn;
  assert.deepEqual(
    store.move(alice, undefined, { x: 1e6, y: 15, z: 1e6 }).corrected,
    spawn,
    protectedPlaza,
    PLAZA_SPAWN,
  );
  clock.at += 60_000;
  assert.deepEqual(
    store.move(alice, undefined, { x: 0, y: 15, z: -60 }).corrected,
    spawn,
    protectedPlaza,
    PLAZA_SPAWN,
    "expired presence cannot skip travel",
  );
  assert.throws(
    () => store.startMining(alice, { x: 5, y: 15, z: -50 }),
    (error) => error.status === 409,
  );
  walk(alice, { x: 3.5, y: 15, z: -49.5 });
  assert.throws(
    () => store.startMining(alice, { x: 5, y: 15, z: -54 }),
    (error) => error.status === 403,
    "wall blocks a diagonal ray",
  );
  assert.throws(
    () => store.startMining(alice, { x: 0, y: 14, z: -50 }),
    (error) => error.status === 409,
    "mine floor stays intact",
  );
  const job = store.startMining(alice, { x: 5, y: 15, z: -50 });
  clock.at += job.durationMs;
  assert.throws(
    () => store.finishMining(bob, input({ token: job.token })),
    (error) => error.status === 409,
  );
});

test("atlas view bounds keep a far expedition from expanding every map response", (t) => {
  const {
    db,
    store,
    actors: [alice],
  } = fixture(t);
  db.prepare("INSERT INTO ml_atlas VALUES(?,?,?)").run(
    LAYER_REGISTRY[0].id,
    60_000,
    -60_000,
  );
  assert.ok(
    !store.snapshot(alice, undefined, 0, 0).tiles.some(([x]) => x === 60_000),
  );
  assert.ok(
    store
      .snapshot(alice, undefined, 960_000, -960_000)
      .tiles.some(([x]) => x === 60_000),
  );
  assert.throws(() => store.snapshot(alice, undefined, Infinity, 0));
});

test("breaking a player-placed decorative crystal removes the shared block without mining resources", (t) => {
  const {
    store,
    actors: [alice, bob],
    walk,
    clock,
  } = fixture(t);
  walk(alice, { x: 7.5, y: 15, z: 11.5 });
  store.edit(
    alice,
    input({ x: 9, y: 15, z: 11, block: BLOCK.crystal, expected: BLOCK.air }),
  );
  const job = store.startMining(alice, { x: 9, y: 15, z: 11 });
  clock.at += job.durationMs;
  const receipt = store.finishMining(
    alice,
    input({ requestId: "shared-break-00001", token: job.token }),
  );
  assert.deepEqual(receipt.inventory, { diamonds: 0, stone: 0 });
  assert.ok(
    store
      .snapshot(bob)
      .changes.some(
        ([x, y, z, block]) =>
          x === 9 && y === 15 && z === 11 && block === BLOCK.air,
      ),
  );
});

test("a vein waits to renew while an explorer occupies the extracted block", (t) => {
  const {
    store,
    actors: [alice],
    clock,
    walk,
  } = fixture(t);
  walk(alice, { x: 3.5, y: 15, z: -49.5 });
  const target = { x: 5, y: 15, z: -50 };
  const job = store.startMining(alice, target);
  clock.at += job.durationMs;
  store.finishMining(alice, input({ token: job.token }));
  const upper = store.startMining(alice, { x: 5, y: 16, z: -50 });
  clock.at += upper.durationMs;
  store.finishMining(
    alice,
    input({ requestId: "clear-headroom-0001", token: upper.token }),
  );
  walk(alice, { x: 5.5, y: 15, z: -49.5 });
  for (let i = 0; i < ORE_RENEW_MS / 10_000; i++) {
    clock.at += 10_000;
    store.move(alice, undefined, { x: 5.5, y: 15, z: -49.5 });
  }
  assert.ok(
    store
      .snapshot(alice, undefined, 5, -50)
      .changes.some(
        ([x, y, z, block]) =>
          x === 5 && y === 15 && z === -50 && block === BLOCK.air,
      ),
  );
  walk(alice, { x: 3.5, y: 15, z: -49.5 });
  clock.at += 2100;
  assert.ok(
    !store
      .snapshot(alice, undefined, 5, -50)
      .changes.some(([x, y, z]) => x === 5 && y === 15 && z === -50),
  );
});

test("new explorers arrive separately on protected, empty crossing tiles", (t) => {
  const {
    store,
    actors: [alice, bob],
  } = fixture(t);
  const a = store.enter(alice).spawn,
    b = store.enter(bob).spawn;
  assert.ok(protectedPlaza(a.x, a.z) && protectedPlaza(b.x, b.z));
  assert.ok(Math.hypot(a.x - b.x, a.z - b.z) >= 1.2);
  assert.throws(
    () =>
      store.edit(
        alice,
        input({
          x: Math.floor(a.x),
          y: 15,
          z: Math.floor(a.z),
          block: BLOCK.plank,
          expected: BLOCK.air,
        }),
      ),
    (error) => error.status === 403,
  );
});

test("the crowded-arrival fallback remains on an empty protected crossing", (t) => {
  const { store, db } = fixture(t);
  for (let i = 0; i < 10; i++) {
    const actor = { id: `arrival-${i}`, name: `Arrival ${i}` };
    db.prepare("INSERT INTO players(id,name,created_at) VALUES(?,?,?)").run(
      actor.id,
      actor.name,
      1,
    );
    const spawn = store.enter(actor).spawn;
    assert.ok(protectedPlaza(spawn.x, spawn.z));
    assert.equal(
      naturalExpeditionBlock(
        LAYER_REGISTRY[0].seed,
        Math.floor(spawn.x),
        15,
        Math.floor(spawn.z),
      ),
      BLOCK.air,
    );
  }
  assert.ok(protectedPlaza(PLAZA_SPAWN.x, PLAZA_SPAWN.z));
});

function firstExpedition(f, actor) {
  f.store.startQuest(actor, {});
  f.walk(actor, { x: 3.5, y: 15, z: -48.5 });
  let n = 0;
  for (const z of [-50, -52, -54, -56, -58]) {
    f.walk(actor, { x: 3.5, y: 15, z: z + 0.5 });
    for (const y of [15,17]) {
      const job = f.store.startMining(actor, { x:5,y,z });
      f.clock.at += job.durationMs;
      f.store.finishMining(actor, input({ token:job.token,requestId:`story-diamond-${String(++n).padStart(6,"0")}` }));
    }
  }
}

test("the authored campaign completes discovery, extraction, three clues and a shared build without minting rewards", t => {
  const f=fixture(t), [alice,bob]=f.actors, {store,walk,clock,db}=f;
  firstExpedition(f,alice);
  assert.equal(store.snapshot(alice).story.stage,"quarry");
  walk(alice,{x:3.5,y:15,z:-44.5});
  walk(alice,{x:42.5,y:15,z:-16.5});
  walk(alice,{x:54.5,y:15,z:-16.5});
  for (const x of [53,54,55]) for(const y of [15,17]) {
    const job=store.startMining(alice,{x,y,z:-19});clock.at+=job.durationMs;
    store.finishMining(alice,input({token:job.token,requestId:`story-basalt-${x}-${y}`}));
  }
  assert.equal(store.snapshot(alice).story.stage,"signals");
  const rune=input({action:"signal",site:"garden",symbol:"spore",requestId:"story-signal-garden"});
  assert.throws(()=>store.interact(alice,rune), e=>e.status===403);
  walk(alice,{x:42.5,y:15,z:-12.5});
  walk(alice,{x:-40.5,y:15,z:-12.5});
  walk(alice,{x:-40.5,y:15,z:18});
  for(const site of SIGNAL_SITES) {
    walk(alice,{x:site.x,y:15,z:site.z+(site.id==="observatory"?4:-4)});
    assert.throws(()=>store.interact(alice,input({action:"signal",site:site.id,symbol:"wrong"})),e=>e.status===409);
    const body=input({action:"signal",site:site.id,symbol:site.symbol,requestId:`story-signal-${site.id}`});
    const accepted=store.interact(alice,body);
    assert.deepEqual(store.interact(alice,body),accepted,"same accepted action recovers its receipt after the chapter advances");
  }
  assert.equal(store.snapshot(alice).story.stage,"marker");
  walk(alice,{x:18,y:15,z:22});
  walk(bob,{x:18.5,y:15,z:18.5});
  const marker=input({action:"build-marker",requestId:"story-shared-marker"});
  assert.throws(()=>store.interact(alice,marker),e=>e.status===409);
  assert.equal(store.snapshot(alice).story.markerReady,false,"failed template does not leave partial blocks");
  walk(bob,{x:22,y:15,z:22});
  const built=store.interact(alice,marker);
  assert.equal(built.story.stage,"beacon");assert.equal(built.changes.length,3);
  assert.equal(store.snapshot(bob).story.markerReady,true);
  assert.deepEqual(store.interact(alice,marker),built);
  walk(alice,{x:5.5,y:15,z:0.5});
  const finale=input({action:"beacon",requestId:"story-light-beacon"});
  const complete=store.interact(alice,finale);
  assert.equal(complete.story.stage,"complete");assert.equal(complete.story.sharedBeaconLit,true);
  assert.deepEqual(complete.inventory,{diamonds:10,stone:6},"story uses the collected material as a requirement, without spending or issuing currency");
  assert.deepEqual(store.interact(alice,finale),complete);
  assert.equal(store.snapshot(bob).story.sharedBeaconLit,true,"the restored beacon is shared");
  assert.equal(store.snapshot(bob).story.stage,"expedition","personal stories remain independent");
  const reopened=createExpeditionStore(db,{now:()=>clock.at});
  assert.equal(reopened.enter(alice).story.stage,"complete");
  assert.equal(db.prepare("SELECT xp FROM players WHERE id=?").get(alice.id).xp,0);
  assert.equal(store.activity(alice).actions.filter(a=>a.kind==="beacon-restored").length,1);
  assert.ok(store.activity(alice).actions.every(a=>a.chain===null));
});

test("story gates, stale presence and protected landmarks cannot be bypassed", t=>{
  const f=fixture(t),alice=f.actors[0];
  assert.throws(()=>f.store.interact(alice,input({action:"beacon"})),e=>e.status===409);
  assert.throws(()=>f.store.interact(alice,input({action:"build-marker"})),e=>e.status===409);
  f.walk(alice,{x:-28,y:15,z:18});
  assert.throws(()=>f.store.edit(alice,input({x:-28,y:17,z:22,expected:BLOCK.crystal,block:BLOCK.air})),e=>e.status===403);
  f.clock.at+=13000;
  assert.throws(()=>f.store.interact(alice,input({action:"signal",site:"garden",symbol:"spore"})),e=>e.status===409);
});

test("a body below the floor or above the sky is put back, not rejected (blank-world start)", (t) => {
  const { store, clock, actors: [alice] } = fixture(t);
  const saved = store.enter(alice).spawn;
  for (const y of [-3, 1e4]) {
    clock.at += 500;
    const result = store.move(alice, undefined, { x: saved.x, y, z: saved.z });
    assert.deepEqual(result.corrected, { x: saved.x, y: saved.y, z: saved.z });
  }
  assert.throws(() => store.move(alice, undefined, { x: NaN, y: 15, z: 0 }), /Invalid position/);
});

test("Nera's tour pays once after her four places, in any order", (t) => {
  const { db, store, actors: [alice], walk } = fixture(t);
  const tours = () => db.prepare("SELECT COUNT(*) n FROM ml_actions WHERE player_id=? AND kind='tour-complete'").get(alice.id).n;
  let at = { x: PLAZA_SPAWN.x, z: PLAZA_SPAWN.z };
  const visit = (id) => {
    const p = placeById(id), lane = p.z > 0 ? 9.5 : -9.5;
    walk(alice, { x: at.x, y: 15, z: lane });
    walk(alice, { x: p.x, y: 15, z: lane });
    walk(alice, { x: p.x, y: 15, z: p.z });
    at = p;
  };
  for (const id of ["treasury", "workshop", "garden"]) visit(id);
  assert.equal(tours(), 0, "three of four places are not the tour");
  visit("hollow");
  assert.equal(tours(), 1);
  visit("treasury");
  visit("hollow");
  assert.equal(tours(), 1, "the tour is recorded once");
});

test("own land opens building outside the square only for its owner", (t) => {
  const db = openDatabase(":memory:"), clock = { at: 100_000 };
  t.after(() => db.close());
  for (const id of ["ml-Alice", "ml-Bob"]) db.prepare("INSERT INTO players(id,name,created_at) VALUES(?,?,1)").run(id, id);
  const alice = { id: "ml-Alice", name: "Alice" }, bob = { id: "ml-Bob", name: "Bob" };
  const asked = [];
  const store = createExpeditionStore(db, {
    now: () => clock.at,
    ownsLand: (actor, x0, z0) => (asked.push([x0, z0]), actor.id === alice.id && x0 === 48 && z0 === 0),
  });
  const seed = LAYER_REGISTRY[0].seed;
  const ground = (x, z) => { for (let y = 60; y > 0; y--) if (naturalExpeditionBlock(seed, x, y, z) !== BLOCK.air) return y; return 0; };
  for (const actor of [alice, bob]) {
    let at = store.enter(actor).spawn;
    for (const x of [16.5, 24.5, 32.5, 40.5, 46.5, 50.5]) {
      const next = { x, y: ground(Math.floor(x), 0) + 1, z: 0.5 };
      clock.at += 2000;
      assert.equal(store.move(actor, undefined, next).corrected, null, `walk to ${x}`);
      at = next;
    }
    const y = ground(52, 0) + 1;
    const edit = { requestId: `request-own-land-${actor.id}`.padEnd(20, "0"), x: 52, y, z: 0, block: BLOCK.plank, expected: BLOCK.air };
    if (actor === alice) assert.ok(store.edit(actor, edit));
    else assert.throws(() => store.edit(actor, edit), /your own land/);
  }
  assert.deepEqual(asked.at(-1), [48, 0]);
});
