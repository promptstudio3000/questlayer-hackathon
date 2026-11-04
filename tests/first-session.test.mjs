import test from "node:test";
import assert from "node:assert/strict";
import { openDatabase, createPlayer } from "../server/database.mjs";
import { ensureWorld, HOME, worldView } from "../server/world.mjs";
import { guideHint } from "../server/ai/guide.mjs";
import { distance as distanceTo } from "../server/domain.mjs";
import {
  FIRST_STEPS,
  firstSessionProgress,
  newlyCompleted,
} from "../src/first-session.ts";
import {
  DEFAULT_FEEDBACK,
  parseFeedbackPreferences,
  resolveReducedMotion,
} from "../src/feedback.ts";

const NOW = Date.parse("2026-11-02T12:00:00Z");
const CHAIN = /\b(wallet|testnet|transaction|NEAR|mint|NFT|on-chain|contract|blockchain)\b/i;
const base = { id: "p1", name: "Mira", history: [], inventory: [] };

test("first session follows name, find, coin, chest, aura, secure", () => {
  assert.deepEqual(
    FIRST_STEPS.map((s) => s.id),
    ["name", "find", "coin", "chest", "aura", "secure"],
  );
  assert.equal(firstSessionProgress(null).current?.id, "name");
  const named = firstSessionProgress(base);
  assert.equal(named.current?.id, "find");
  assert.equal(named.completed, 1);
  const found = firstSessionProgress({
    ...base,
    history: [{ kind: "coin", title: "Street find" }],
  });
  assert.equal(found.current?.id, "coin");
  const coin = firstSessionProgress({
    ...base,
    history: [
      { kind: "coin", title: "Street find" },
      { kind: "coin", title: "Street coin" },
    ],
  });
  assert.equal(coin.current?.id, "chest");
  const chest = {
    ...base,
    history: [
      { kind: "coin", title: "Street find" },
      { kind: "coin", title: "Street coin" },
    ],
    inventory: [
      { kind: "avatar", equipped: 1 },
      { kind: "aura", equipped: 0 },
    ],
  };
  assert.equal(firstSessionProgress(chest).current?.id, "aura");
  const worn = { ...chest, inventory: [{ kind: "aura", equipped: 1 }] };
  assert.equal(firstSessionProgress(worn).current?.id, "secure");
  const shared = firstSessionProgress(worn, { secure: true });
  assert.equal(shared.current, null);
  assert.equal(shared.completed, shared.total);
  const secured = firstSessionProgress({
    ...worn,
    inventory: [{ kind: "aura", equipped: 1, native_claim_state: "minted" }],
  });
  assert.equal(secured.current, null);
});

test("the default explorer avatar does not count as wearing an Aura", () => {
  const p = firstSessionProgress({
    ...base,
    inventory: [{ kind: "avatar", equipped: 1 }],
  });
  assert.equal(p.steps.find((s) => s.step.id === "aura").done, false);
});

test("a testnet starter kit does not skip the chest and Aura steps", () => {
  const kit = { id: "seed-kit-p1-polar", kind: "aura", equipped: 1 };
  const p = firstSessionProgress({ ...base, inventory: [kit] });
  assert.equal(p.completed, 1);
  assert.equal(p.current.id, "find");
  const earned = firstSessionProgress({
    ...base,
    inventory: [kit, { id: "item_x", kind: "aura", equipped: 1 }],
  });
  assert.equal(earned.steps.find((s) => s.step.id === "chest").done, true);
  assert.equal(earned.steps.find((s) => s.step.id === "aura").done, true);
});

test("local marks keep steps done after the history window rolls over", () => {
  const p = firstSessionProgress(base, { find: true, coin: true });
  assert.equal(p.current?.id, "chest");
});

test("newly completed steps are reported once", () => {
  const before = firstSessionProgress(base);
  const after = firstSessionProgress({
    ...base,
    history: [{ kind: "coin", title: "Street find" }],
  });
  assert.deepEqual(newlyCompleted(before, after).map((s) => s.id), ["find"]);
  assert.deepEqual(newlyCompleted(after, after), []);
  assert.deepEqual(newlyCompleted(null, after), []);
});

test("first-session copy keeps chain words out of the core loop", () => {
  for (const step of FIRST_STEPS)
    for (const text of [step.title, step.hint, step.action, step.done])
      assert.doesNotMatch(text, CHAIN, text);
});

test("feedback preferences parse safely and respect the system motion setting", () => {
  assert.deepEqual(parseFeedbackPreferences(null), DEFAULT_FEEDBACK);
  assert.deepEqual(parseFeedbackPreferences("{bad"), DEFAULT_FEEDBACK);
  assert.deepEqual(
    parseFeedbackPreferences('{"haptics":false,"sound":true,"motion":"reduce"}'),
    { haptics: false, sound: true, motion: "reduce" },
  );
  assert.equal(parseFeedbackPreferences('{"motion":"wild"}').motion, "system");
  assert.equal(DEFAULT_FEEDBACK.sound, false);
  assert.equal(resolveReducedMotion("system", true), true);
  assert.equal(resolveReducedMotion("system", false), false);
  assert.equal(resolveReducedMotion("reduce", false), true);
});

async function worldFixture(t) {
  const db = openDatabase(":memory:");
  t.after(() => db.close());
  const player = createPlayer(db, "Walker", NOW);
  const world = await ensureWorld(db, HOME, true, NOW);
  return { db, player, view: worldView(db, world.id, player, { now: NOW }) };
}

test("guide hints are grounded in the live world and free of chain words", async (t) => {
  const { view } = await worldFixture(t);
  const find = guideHint("find", { world: view, location: HOME, now: NOW });
  assert.match(find.hint, /nearest (street find|coin) is \d+ m away/);
  const nearestFind = Math.min(
    ...view.coins
      .filter((c) => c.find)
      .map((c) => Math.round(distanceTo(HOME, c))),
  );
  assert.ok(find.hint.includes(`${nearestFind} m`), find.hint);
  const coin = guideHint("coin", { world: view, location: HOME, now: NOW });
  assert.match(coin.hint, /nearest coin is \d+ m away/);
  const chest = guideHint("chest", { world: view, location: HOME, now: NOW });
  assert.match(chest.hint, /chest/);
  for (const h of [find, coin, chest]) assert.doesNotMatch(h.hint, CHAIN);
  assert.equal(guideHint("aura", { world: view }), null);
  assert.equal(guideHint("secure", { world: view }), null);
  assert.equal(guideHint("bogus", { world: view }), null);
  assert.match(
    guideHint("chest", { world: { ...view, operatorPause: true }, location: HOME }).hint,
    /paused/,
  );
  const none = guideHint("chest", {
    world: { ...view, quests: view.quests.map((q) => ({ ...q, completed: true })) },
    location: HOME,
    now: NOW,
  });
  assert.match(none.hint, /No chest is open/);
  const noLocation = guideHint("coin", { world: view, now: NOW });
  assert.match(noLocation.hint, /waiting in view/);
});
