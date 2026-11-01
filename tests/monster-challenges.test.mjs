import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { loadQuizBank, createQuiz, quizView, scoreQuiz } from "../server/actors/challenges/quiz.mjs";
import { createRhythm, scoreRhythm, createTrace, scoreTrace, createMemory, scoreMemory, RHYTHM } from "../server/actors/challenges/minigames.mjs";
import { createDuel, duelStart, duelRound, duelOver, duelVerdict, tapSkill, playerPower, BEATS } from "../server/actors/challenges/duel.mjs";
import { createChallengeService, ATTEMPT_COOLDOWN_MS, formatsFor } from "../server/actors/challenges/service.mjs";
import { createChallengeRoutes } from "../server/actors/challenges/routes.mjs";

const bank = loadQuizBank();
const counter = Object.fromEntries(Object.entries(BEATS).map(([a, b]) => [b, a]));

test("quiz bank is valid and covers Plzeň, lore and the Aura catalog", () => {
  assert.ok(bank.cities.plzen.length >= 10);
  assert.ok(bank.lore.some((q) => q.id.startsWith("aura-set-")));
  assert.ok(bank.lore.some((q) => q.id === "lore-set-bonus"));
});

test("quiz prefers the place question and never sends answers", () => {
  const plan = createQuiz(bank, { seed: "s1", cityId: "plzen", placeName: "Smetanovy sady" });
  assert.equal(plan.length, 3);
  assert.equal(plan[0].id, "plzen-smetana");
  const view = quizView(bank, plan);
  assert.ok(view.every((q) => !("answer" in q) && q.choices.length === 4));
  assert.deepEqual(plan, createQuiz(bank, { seed: "s1", cityId: "plzen", placeName: "Smetanovy sady" }));
  const answers = plan.map(({ id, order }) => ({ id, choice: order.indexOf(bank.byId.get(id).answer) }));
  assert.equal(scoreQuiz(bank, plan, answers, { elapsedMs: 10000 }).won, true);
  assert.equal(scoreQuiz(bank, plan, answers, { elapsedMs: 120000 }).won, false);
  const wrong = answers.map((a) => ({ ...a, choice: (a.choice + 1) % 4 }));
  assert.equal(scoreQuiz(bank, plan, wrong, { elapsedMs: 10000 }).score, 0);
});

test("rhythm rewards human timing and gives bots no edge", () => {
  const r = createRhythm("seed-r");
  const human = r.beats.map((b, i) => b + (i % 2 ? 45 : -50));
  const bot = r.beats.slice();
  const h = scoreRhythm(r, { taps: human });
  const b = scoreRhythm(r, { taps: bot });
  assert.equal(h.won, true);
  assert.equal(h.score, b.score);
  const mash = Array.from({ length: 16 }, (_, i) => 1500 + i * 95);
  assert.equal(scoreRhythm(r, { taps: mash }).won, false);
  assert.equal(scoreRhythm(r, { taps: [1, 2, 3] }).reason, "too-fast");
  assert.ok(RHYTHM.pass <= r.beats.length);
});

function walk(points, msPerStep = 40) {
  const out = [];
  let t = 0;
  for (let i = 1; i < points.length; i++) {
    const [a, b] = [points[i - 1], points[i]];
    for (let k = 0; k <= 10; k++) {
      out.push([a[0] + ((b[0] - a[0]) * k) / 10, a[1] + ((b[1] - a[1]) * k) / 10, t]);
      t += msPerStep;
    }
  }
  return out;
}

test("trace accepts a path that follows the runes in order", () => {
  const c = createTrace("seed-t");
  assert.equal(scoreTrace(c, { samples: walk(c.points) }).won, true);
  assert.equal(scoreTrace(c, { samples: walk([...c.points].reverse()) }).won, false);
  assert.equal(scoreTrace(c, { samples: walk(c.points, 1) }).reason, "too-fast");
});

test("memory needs the exact sequence after the show", () => {
  const m = createMemory("seed-m");
  const taps = m.sequence.map((pad, i) => ({ pad, t: m.showEndsMs + 400 + i * 350 }));
  assert.equal(scoreMemory(m, { taps }).won, true);
  assert.equal(scoreMemory(m, { taps: taps.map((x, i) => (i === 3 ? { ...x, pad: (x.pad + 1) % 4 } : x)) }).won, false);
  assert.equal(scoreMemory(m, { taps: taps.map((x) => ({ ...x, t: x.t - m.showEndsMs })) }).reason, "too-early");
});

test("duel is deterministic, committed and driven by level and skill only", () => {
  const d = createDuel("seed-d", { archetype: "roamer" });
  const sha = createHash("sha256").update(`${d.picks.join(",")}:${d.salt}`).digest("hex");
  assert.equal(sha, d.commitment);
  assert.equal(tapSkill(0), tapSkill(35));
  assert.ok(tapSkill(40) > tapSkill(200));
  assert.ok(playerPower(10) > playerPower(1));
  assert.equal(playerPower(99), playerPower(20));
  const play = (level) => {
    let s = duelStart(d);
    while (!duelOver(s)) s = duelRound(d, s, { stance: counter[d.picks[s.round]], tapOffsetMs: 60 }, level);
    return duelVerdict(d, s);
  };
  assert.equal(play(1).won, true); // reading every stance wins even at level 1
  assert.deepEqual(play(5).reveal.picks, d.picks);
});

function harness({ archetype = "roamer" } = {}) {
  let t = 1_000_000;
  const results = [];
  const actor = { id: "glitch-moth-1", kind: "monster", archetype, name: "Glitch Moth" };
  const service = createChallengeService({
    secret: "test",
    now: () => t,
    levelOf: () => 3,
    onResult: (r) => results.push(r),
    encounters: {
      async requireEncounter({ token, player, actorId }) {
        if (token !== "enc_ok" || actorId !== actor.id) throw Object.assign(new Error("bad"), { status: 403 });
        return { encounterId: "enc_ok", actor, dayId: "2026-11-01", cityId: "plzen", placeName: "Husův park", expiresAt: t + 300000 };
      },
    },
  });
  return { service, actor, results, advance: (ms) => (t += ms) };
}

test("service runs a quiz end to end with cooldown and daily defeat", async () => {
  const { service, actor, results, advance } = harness();
  const menu = await service.menu({ player: "p1", actorId: actor.id, encounter: "enc_ok" });
  assert.deepEqual(menu.formats, formatsFor(actor, "2026-11-01"));
  assert.equal(menu.offers.length, 3);
  const { challenge } = await service.start({ player: "p1", actorId: actor.id, encounter: "enc_ok", format: "quiz" });
  assert.equal(challenge.questions[0].id, "plzen-hus");
  await assert.rejects(service.start({ player: "p1", actorId: actor.id, encounter: "enc_ok", format: "duel" }), { code: "COOLDOWN" });
  assert.throws(() => service.submit({ player: "p2", actorId: actor.id, challengeId: challenge.id, input: { answers: [] } }), { code: "CHALLENGE_NOT_FOUND" });
  advance(5000);
  const answers = challenge.questions.map((q) => {
    const real = bank.byId.get(q.id);
    return { id: q.id, choice: q.choices.indexOf(real.choices[real.answer]) };
  });
  const out = service.submit({ player: "p1", actorId: actor.id, challengeId: challenge.id, input: { answers } });
  assert.equal(out.result.outcome, "won");
  assert.equal(results[0].player, "p1");
  advance(ATTEMPT_COOLDOWN_MS + 1);
  await assert.rejects(service.start({ player: "p1", actorId: actor.id, encounter: "enc_ok", format: "quiz" }), { code: "ALREADY_DEFEATED" });
});

test("service rejects a mini-game submitted faster than it can be played", async () => {
  const { service, actor } = harness();
  const format = formatsFor(actor, "2026-11-01")[1];
  const { challenge } = await service.start({ player: "p1", actorId: actor.id, encounter: "enc_ok", format });
  const out = service.submit({ player: "p1", actorId: actor.id, challengeId: challenge.id, input: { taps: challenge.beats || [], samples: [] } });
  assert.equal(out.result.outcome, "lost");
  assert.equal(out.detail.reason, "too-fast");
});

test("service plays a duel round by round and reveals the commitment", async () => {
  const { service, actor, advance } = harness({ archetype: "lurker" });
  const { challenge } = await service.start({ player: "p1", actorId: actor.id, encounter: "enc_ok", format: "duel" });
  assert.equal(challenge.tendency, "trick");
  assert.ok(!("picks" in challenge));
  let out;
  let ring = challenge.ringMs;
  for (let i = 0; i < 3 && !out?.result; i++) {
    advance(ring + 20);
    out = service.round({ player: "p1", actorId: actor.id, challengeId: challenge.id, stance: "strike", tapOffsetMs: 20 });
    ring = out.duel.ringMs;
  }
  assert.ok(out.result);
  assert.equal(out.detail.reveal.commitment, challenge.commitment);
});

test("bosses and NPCs cannot be challenged here", async () => {
  const { service, actor } = harness({ archetype: "boss" });
  await assert.rejects(service.start({ player: "p1", actorId: actor.id, encounter: "enc_ok", format: "quiz" }), { code: "BOSS_EVENT" });
});

test("routes answer 503 when actors are off", async () => {
  const routes = createChallengeRoutes(null);
  const assertFn = (ok, message, status, code) => {
    if (!ok) throw Object.assign(new Error(message), { status, code });
  };
  await assert.rejects(
    routes.handle({ method: "POST" }, {}, new URL("http://x/api/actors/glitch-moth-1/challenge"), { assert: assertFn }),
    { status: 503 },
  );
  assert.equal(await routes.handle({ method: "GET" }, {}, new URL("http://x/api/actors"), { assert: assertFn }), false);
});

test("durable store keeps cooldowns and defeats in the actors v1 tables", async () => {
  const { DatabaseSync } = await import("node:sqlite");
  const { ACTORS_SCHEMA } = await import("../server/actors/schema.mjs");
  const { dbChallengeStore } = await import("../server/actors/challenges/store.mjs");
  const db = new DatabaseSync(":memory:");
  db.exec(ACTORS_SCHEMA.sql);
  const store = dbChallengeStore(db);
  store.recordAttempt("p1", "m1", "d1", 10, 100);
  store.openChallenge({ id: "chl_x", player: "p1", actorId: "m1", dayId: "d1", format: "trace", seed: "s", seedCommitment: "c", startedAt: 10, expiresAt: 50 });
  assert.equal(store.cooldownUntil("p1", "m1"), 100);
  assert.equal(store.defeated("p1", "m1", "d1"), false);
  store.recordOutcome("p1", "m1", "d1", true, 20);
  store.closeChallenge("chl_x", true, { outcome: "won" }, 20);
  assert.equal(store.defeated("p1", "m1", "d1"), true);
  const row = db.prepare("SELECT format,state FROM actor_challenges WHERE id='chl_x'").get();
  assert.deepEqual({ ...row }, { format: "minigame", state: "won" });
});

test("monster menu offers today's three formats and the place is found", async () => {
  const { nearestPlace, actorPosition } = await import("../server/actors/challenges/index.mjs");
  const at = actorPosition({ segments: [{ from: 0, to: 10, path: [[13.38, 49.74], [13.3775, 49.7469]] }] }, 5);
  assert.deepEqual(at, { lng: 13.3775, lat: 49.7469 });
  assert.equal(nearestPlace([{ name: "Smetanovy sady", lat: 49.747, lng: 13.3776 }], at), "Smetanovy sady");
  assert.equal(nearestPlace([{ name: "Far", lat: 49.8, lng: 13.3 }], at), null);
  const { service, actor } = harness();
  assert.deepEqual(service.offers("p9", actor, "2026-11-01", 1).map((o) => o.terms.format), formatsFor(actor, "2026-11-01"));
  assert.deepEqual(service.offers("p9", { ...actor, archetype: "boss" }, "2026-11-01", 1), []);
});
