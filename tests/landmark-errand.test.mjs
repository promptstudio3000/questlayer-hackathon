// Landmark clues and NPC errands (docs/WORLDS-PLAN.md C.4).
import test from "node:test";
import assert from "node:assert/strict";
import { latLngToCell, cellToLatLng } from "h3-js";
import { openDatabase, createPlayer } from "../server/database.mjs";
import { ensureWorld, worldView } from "../server/world.mjs";
import { claimQuest } from "../server/game.mjs";
import { planCellPoiQuests, staticPoiSource } from "../server/poi-quests.mjs";
import {
  CLUE_XP,
  MAX_CLUES_PER_CELL,
  buildLandmarkClue,
  centuryOf,
} from "../server/landmark-clue.mjs";
import { buildMenu, ERRAND_XP, ERRAND_CLUE_BONUS_XP } from "../server/npc/offers.mjs";
import { personaFor } from "../server/npc/personas.mjs";
import { createNpcService } from "../server/npc/service.mjs";
import { wikidataYear, parseWikidataBindings } from "../scripts/poi/fetch.mjs";
import { applyWikidata } from "../scripts/poi/merge.mjs";

const NOW = Date.parse("2026-11-02T11:00:00Z"); // 12:00 in Prague
const cell = latLngToCell(49.75, 13.2, 7); // outside reviewed city boxes
const [clat, clng] = cellToLatLng(cell);
const CATS = ["fountain", "park", "church_like", "monument", "artwork", "museum", "castle", "bridge"];
const DESCRIPTIONS = {
  fountain: ["kašna na návsi", "fountain on the village green"],
  park: ["městský park", "town park"],
  church_like: ["gotický kostel", "Gothic church"],
  monument: ["pomník padlým", "war memorial"],
  artwork: ["socha z pískovce", "sandstone statue"],
  museum: ["regionální muzeum", "regional museum"],
  castle: ["zřícenina hradu", "castle ruin"],
  bridge: ["kamenný most", "stone bridge"],
};

function fixturePois() {
  const out = [];
  let n = 0;
  for (let i = -8; i <= 8; i++)
    for (let j = -8; j <= 8; j++) {
      const lat = clat + (i * 150) / 110540,
        lng = clng + (j * 150) / (111320 * Math.cos((clat * Math.PI) / 180));
      if (latLngToCell(lat, lng, 7) !== cell) continue;
      const category = CATS[n % CATS.length];
      const [cs, en] = DESCRIPTIONS[category];
      out.push({
        id: `osm:node/${5000 + n}`,
        category: category === "church_like" ? "historic_building" : category,
        name: `Place ${n}`,
        notability: n % 7 === 0 ? 30 : n % 5,
        lat,
        lng,
        h3r7: cell,
        wikidata: `Q${100 + n}`,
        facts: { cs: `${cs} ${n}`, en: `${en} ${n}`, ...(n % 3 === 0 ? { inception: 1200 + n * 7 } : {}) },
      });
      n++;
    }
  return out;
}
const POIS = fixturePois();
const mapData = {
  fetcher: async () =>
    new Response(
      JSON.stringify({
        elements: [
          {
            type: "way",
            id: 1,
            tags: { highway: "footway" },
            geometry: [
              { lat: clat, lon: clng },
              { lat: clat + 0.002, lon: clng },
            ],
          },
        ],
      }),
      { headers: { "content-type": "application/json" } },
    ),
};
const fix = (p, t) => ({ lat: p.lat, lng: p.lng, accuracy: 5, timestamp: t });

test("Wikidata inception years are parsed and kept as facts", () => {
  assert.equal(wikidataYear("1350-01-01T00:00:00Z"), 1350);
  assert.equal(wikidataYear("-0500-01-01T00:00:00Z"), -500);
  assert.equal(wikidataYear("+1890-05-01T00:00:00Z"), 1890);
  assert.equal(wikidataYear("garbage"), null);
  const [item] = parseWikidataBindings({
    results: {
      bindings: [
        { item: { value: "http://www.wikidata.org/entity/Q9" }, sitelinks: { value: "4" }, inception: { value: "1400-01-01T00:00:00Z" }, lang: { value: "cs" }, label: { value: "Kostel" }, description: { value: "kostel v Plzni" } },
        { item: { value: "http://www.wikidata.org/entity/Q9" }, sitelinks: { value: "4" }, inception: { value: "1352-01-01T00:00:00Z" }, lang: { value: "en" }, label: { value: "Church" } },
      ],
    },
  });
  assert.equal(item.inception, 1352, "the earliest inception wins");
  assert.equal(item.v, 2);
  const record = { wikidata: "Q9", names: {}, name: null, sources: [] };
  applyWikidata([record], new Map([["Q9", item]]));
  assert.deepEqual(record.facts, { cs: "kostel v Plzni", inception: 1352 });
});

test("a clue's answer is the Wikidata fact; options are deterministic and never leak the answer by shape", () => {
  const poi = { id: "osm:node/1", name: "Old Tower", category: "landmark_tower", facts: { inception: 1350, cs: "věž" } };
  const a = buildLandmarkClue({ poi, seed: "s", nowYear: 2026 });
  const b = buildLandmarkClue({ poi, seed: "s", nowYear: 2026 });
  assert.deepEqual(a, b);
  assert.equal(a.kind, "inception");
  assert.equal(a.answer, `c${centuryOf(1350)}`);
  assert.equal(a.options.length, 4);
  assert.ok(a.options.some((o) => o.id === a.answer));
  assert.equal(new Set(a.options.map((o) => o.id)).size, 4);
  assert.match(a.options.find((o) => o.id === a.answer).text.cs, /14\. století/);
  assert.ok(a.options.every((o) => !/BC|př\. n\. l\./.test(o.text.en + o.text.cs)), "no BC option next to an AD answer");
  const modern = buildLandmarkClue({ poi: { ...poi, facts: { inception: 2010 } }, seed: "s", nowYear: 2026 });
  assert.ok(modern.options.every((o) => Number(o.id.slice(1)) <= 21), "never a future century");
  // Description clue: wrong options from other kinds of places.
  const d = buildLandmarkClue({
    poi: { id: "p", name: "Kašna", category: "fountain", facts: { cs: "barokní kašna", en: "Baroque fountain" } },
    pool: POIS,
    seed: "s",
  });
  assert.equal(d.kind, "description");
  assert.equal(d.options.length, 4);
  assert.equal(d.options.find((o) => o.id === d.answer).text.en, "Baroque fountain");
  assert.ok(d.options.filter((o) => o.id !== d.answer).every((o) => !/fountain/.test(o.text.en)));
  // Too few distinct other places: no clue rather than a weak one.
  assert.equal(
    buildLandmarkClue({ poi: { id: "p", name: "X", category: "fountain", facts: { cs: "kašna" } }, pool: POIS.slice(0, 1), seed: "s" }),
    null,
  );
  assert.equal(buildLandmarkClue({ poi: { id: "p", name: null, facts: { inception: 1300 } }, seed: "s" }), null);
  assert.equal(
    buildLandmarkClue({ poi: { id: "p", name: "X", category: "park", facts: { en: "Wikimedia category" } }, pool: POIS, seed: "s" }),
    null,
  );
});

test("the cell plan turns at most two notable visits into clues, never the chest", () => {
  const plan = planCellPoiQuests({ cell, day: "2026-11-02", pois: POIS, nowYear: 2026 });
  const clues = plan.quests.filter((q) => q.template === "landmark-clue");
  assert.ok(clues.length >= 1 && clues.length <= MAX_CLUES_PER_CELL);
  assert.ok(clues.every((q) => !q.chest && q.clue?.answer));
  assert.deepEqual(plan, planCellPoiQuests({ cell, day: "2026-11-02", pois: [...POIS].reverse(), nowYear: 2026 }));
  // Places without facts stay plain visits.
  const bare = POIS.map(({ facts, ...p }) => p);
  assert.equal(planCellPoiQuests({ cell, day: "2026-11-02", pois: bare }).quests.filter((q) => q.clue).length, 0);
});

async function streetWorld(t) {
  const db = openDatabase(":memory:");
  t.after(() => db.close());
  const w = await ensureWorld(db, { lat: clat, lng: clng }, false, NOW, { mapData, poiSource: staticPoiSource(POIS) });
  return { db, w };
}

test("a clue takes one answer with the visit: right pays more, wrong shows the answer, no GOLD", async (t) => {
  const { db, w } = await streetWorld(t);
  const alice = createPlayer(db, "Alice", NOW),
    bob = createPlayer(db, "Bob", NOW);
  const view = worldView(db, w.id, alice, { now: NOW });
  const q = view.quests.find((x) => x.clue);
  assert.ok(q, "a clue quest exists");
  assert.equal(q.activity.templateId, "landmark-clue");
  assert.equal(q.xp, CLUE_XP.correct);
  assert.equal(q.gold_u, 0);
  assert.equal(q.clue.result, undefined);
  assert.ok(!JSON.stringify(q).includes('"answer"'), "the answer is not in the player view");
  const stored = JSON.parse(db.prepare("SELECT metadata FROM quests WHERE id=?").get(q.id).metadata).clue;
  const wrong = q.clue.options.find((o) => o.id !== stored.answer).id;
  assert.throws(() => claimQuest(db, alice, q.id, fix(q, NOW), NOW), /Pick one answer/);
  assert.throws(() => claimQuest(db, alice, q.id, fix(q, NOW), NOW, { answer: "c99" }), /Pick one answer/);
  const miss = claimQuest(db, alice, q.id, fix(q, NOW), NOW, { answer: wrong });
  assert.equal(miss.xp, CLUE_XP.miss);
  assert.deepEqual(miss.clue, { correct: false, xp: CLUE_XP.miss, answer: stored.answer });
  // One answer: a second claim replays and never re-scores.
  const replay = claimQuest(db, alice, q.id, fix(q, NOW + 1000), NOW + 1000, { answer: stored.answer });
  assert.equal(replay.replayed, true);
  const after = worldView(db, w.id, alice, { now: NOW + 2000 }).quests.find((x) => x.id === q.id);
  assert.deepEqual(after.clue.result, { choice: wrong, correct: false, answer: stored.answer });
  const right = claimQuest(db, bob, q.id, fix(q, NOW + 3000), NOW + 3000, { answer: stored.answer });
  assert.equal(right.xp, CLUE_XP.correct);
  assert.equal(right.reward, 0);
  // Czech view.
  const cs = worldView(db, w.id, bob, { now: NOW, lang: "cs" }).quests.find((x) => x.id === q.id);
  assert.match(cs.clue.question, /Ve kterém století|Který krátký popis/);
  // A clue quest keeps its rule text (no flavour that could give the answer away).
  assert.match(after.title, /^Clue at /);
});

test("NPC errand: accept, do the place's quest, come back to the NPC to report", async (t) => {
  const { db, w } = await streetWorld(t);
  const player = createPlayer(db, "Walker", NOW);
  let clock = NOW;
  const service = createNpcService(db, {
    env: {},
    config: { provider: "template", perHour: 20, perMinute: 6, dailyCalls: 2000 },
    provider: null,
    clock: () => clock,
  });
  const LENKA = { id: "wayfinder-lenka-abc123", kind: "npc", archetype: "quest_giver", name: "Lenka the Wayfinder", persona: "wayfinder-lenka" };
  const view = () => worldView(db, w.id, player, { now: clock });
  const menu = buildMenu({ actor: LENKA, persona: personaFor(LENKA), world: view(), now: clock });
  const errand = menu.find((o) => o.terms.errand);
  assert.ok(errand, "a quest giver offers an errand to a POI quest");
  assert.equal(errand.kind, "quest");
  assert.equal(errand.terms.steps.length, 1);
  assert.equal(errand.terms.xp, ERRAND_XP);
  assert.equal(errand.terms.aura, false);
  const step = view().quests.find((q) => q.id === errand.terms.steps[0].questId);
  assert.ok(step.clue, "a landmark clue is the preferred errand");
  assert.match(errand.label, /^Errand: find out about .+ and come back$/);
  // Errands do not use up the daily quest lines.
  assert.ok(menu.filter((o) => !o.terms.errand).length >= 1);

  const meet = (at) => {
    const id = `enc-${at}`;
    db.prepare(
      "INSERT INTO actor_encounters(id,player_id,actor_id,world_id,day_id,segment_index,menu_hash,distance_m,arena,data,created_at,expires_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
    ).run(id, player, LENKA.id, w.id, w.day, 0, "h", 5, 0, JSON.stringify({ menu }), at, at + 300_000);
    return { encounterId: id, menu };
  };
  const first = meet(clock);
  assert.equal(service.accept({ player, actor: LENKA, world: view(), encounter: first, offerId: errand.id }).state, "accepted");
  const active = service.active({ player, actor: LENKA, world: view() }).find((l) => l.offerId === errand.id);
  assert.deepEqual(active.errand, { returnRequired: true, clueBonusXp: ERRAND_CLUE_BONUS_XP });
  assert.throws(() => service.complete({ player, actor: LENKA, world: view(), encounter: first, offerId: errand.id }), /Finish/);
  clock += 60_000;
  const stored = JSON.parse(db.prepare("SELECT metadata FROM quests WHERE id=?").get(step.id).metadata).clue;
  claimQuest(db, player, step.id, fix(step, clock), clock, { answer: stored.answer });
  // The meeting from before the visit is not a return.
  assert.throws(
    () => service.complete({ player, actor: LENKA, world: view(), encounter: first, offerId: errand.id }),
    (e) => e.code === "NPC_ERRAND_RETURN",
  );
  clock += 60_000;
  const xp0 = db.prepare("SELECT xp FROM players WHERE id=?").get(player).xp;
  const done = service.complete({ player, actor: LENKA, world: view(), encounter: meet(clock), offerId: errand.id });
  assert.equal(done.state, "completed");
  assert.equal(done.xp, ERRAND_XP + ERRAND_CLUE_BONUS_XP);
  assert.equal(db.prepare("SELECT xp FROM players WHERE id=?").get(player).xp - xp0, ERRAND_XP + ERRAND_CLUE_BONUS_XP);
  assert.equal(done.aura, null);
  // One errand per NPC and day.
  const later = buildMenu({ actor: LENKA, persona: personaFor(LENKA), world: view(), now: clock, errandsToday: 1 });
  assert.ok(!later.some((o) => o.terms.errand));
});

test("a city world without POI quests offers no errand", async (t) => {
  const db = openDatabase(":memory:");
  t.after(() => db.close());
  const w = await ensureWorld(db, { lat: 49.7475, lng: 13.3776 }, true, NOW);
  const player = createPlayer(db, "Arena", NOW);
  const RADA = { id: "rada", kind: "npc", archetype: "quest_giver", name: "Ráda", persona: "poutnice-rada" };
  const menu = buildMenu({ actor: RADA, persona: personaFor(RADA), world: worldView(db, w.id, player, { now: NOW }), now: NOW });
  assert.ok(!menu.some((o) => o.terms.errand));
});
