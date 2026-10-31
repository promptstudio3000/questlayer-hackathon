import test from "node:test";
import assert from "node:assert/strict";
import { openDatabase, createPlayer } from "../server/database.mjs";
import { hash } from "../server/domain.mjs";
import { PLZEN } from "../server/spatial/city-pack.mjs";
import {
  buildCityPlan,
  getOrPrepareCityPlan,
} from "../server/world-planner.mjs";
import { ensureWorld, worldView, HOME } from "../server/world.mjs";
import { advanceRoute, claimQuest } from "../server/game.mjs";
import { nativeManifest } from "../server/native/reward-manifest.mjs";
import {
  QUEST_POLICY,
  instantiateQuestTemplate,
  zoneQuestTemplates,
  questTemplateCatalog,
  describeNativeQuest,
} from "../server/quest-templates.mjs";

const NOW = Date.parse("2026-11-02T12:00:00Z");
const ZONE = {
  slot: 0,
  geometry: {
    type: "Polygon",
    coordinates: [
      [
        [-0.01, -0.01],
        [0.01, -0.01],
        [0.01, 0.01],
        [-0.01, 0.01],
        [-0.01, -0.01],
      ],
    ],
  },
  targets: [
    { lat: 0, lng: 0 },
    { lat: 0, lng: 0.001 },
    { lat: 0.001, lng: 0.001 },
  ],
};

test("catalog exposes enforceable mechanics, capability gaps and no invented durations", () => {
  const catalog = questTemplateCatalog();
  assert.deepEqual(
    catalog.templates.map((t) => t.id),
    ["path-visit", "ordered-trail", "return-trail", "cosmetic-chest"],
  );
  assert.ok(
    catalog.templates.every(
      (t) => t.status === "implemented" && t.durationMinutes === null,
    ),
  );
  assert.ok(catalog.planned.every((t) => t.status === "planned" && t.requires));
  catalog.templates[0].stepLabels[0] = "Unsafe mutation";
  catalog.templates[0].safety.access = "anything";
  assert.notEqual(
    questTemplateCatalog().templates[0].stepLabels[0],
    "Unsafe mutation",
  );
  assert.equal(
    questTemplateCatalog().templates[0].safety.access,
    "mapped-paths-only",
  );
  assert.equal(
    instantiateQuestTemplate("path-visit", {
      ...ZONE,
      targets: [ZONE.targets[0]],
    }).activity.steps.length,
    1,
  );
});

test("templates refuse missing, malformed, excluded and overlapping targets", () => {
  assert.throws(
    () => instantiateQuestTemplate("photo-observation", ZONE),
    /Unknown/,
  );
  assert.throws(
    () =>
      instantiateQuestTemplate("ordered-trail", {
        ...ZONE,
        targets: ZONE.targets.slice(0, 2),
      }),
    /more mapped/,
  );
  assert.throws(
    () =>
      instantiateQuestTemplate("path-visit", {
        ...ZONE,
        targets: [{ lat: NaN, lng: 0 }],
      }),
    /location/,
  );
  assert.throws(
    () =>
      instantiateQuestTemplate("path-visit", {
        ...ZONE,
        targets: [{ lat: 1, lng: 0 }],
      }),
    /outside/,
  );
  assert.throws(
    () =>
      instantiateQuestTemplate("ordered-trail", {
        ...ZONE,
        targets: [ZONE.targets[0], ZONE.targets[0], ZONE.targets[2]],
      }),
    /too close/,
  );
  const withHole = structuredClone(ZONE);
  withHole.geometry.coordinates.push([
    [-0.0001, -0.0001],
    [-0.0001, 0.0001],
    [0.0001, 0.0001],
    [0.0001, -0.0001],
    [-0.0001, -0.0001],
  ]);
  assert.throws(
    () => instantiateQuestTemplate("path-visit", withHole),
    /outside/,
  );
});

test("city/day templates are deterministic and offer both trail mechanics without reward authority", () => {
  const plan = buildCityPlan(PLZEN, "2026-11-02");
  assert.equal(plan.questPolicy, QUEST_POLICY);
  assert.deepEqual(plan, buildCityPlan(PLZEN, "2026-11-02"));
  const routes = plan.zones.map((z) => z.questActivities[1]);
  assert.equal(
    routes.filter((q) => q.activity.templateId === "return-trail").length,
    3,
  );
  assert.equal(
    routes.filter((q) => q.activity.templateId === "ordered-trail").length,
    3,
  );
  for (const zone of plan.zones) {
    const definitions = zoneQuestTemplates(zone, {
      cityId: plan.cityId,
      day: plan.day,
    });
    assert.deepEqual(zone.questActivities, definitions);
    assert.equal(definitions.length, 3);
    assert.ok(
      definitions.every(
        (q) =>
          q.reward === undefined && q.xp === undefined && q.tier === undefined,
      ),
    );
    assert.ok(definitions.every((q) => q.activity.durationMinutes === null));
    const route = definitions[1];
    assert.deepEqual(route.target, route.checkpoints.at(-1));
    if (route.activity.templateId === "return-trail")
      assert.deepEqual(route.checkpoints[0], route.checkpoints.at(-1));
  }
  assert.ok(
    buildCityPlan(PLZEN, "2026-11-01").zones.every(
      (z) => z.questActivities === undefined,
    ),
  );
});

test("already prepared future plans and already materialized worlds never gain new requirements", async () => {
  const db = openDatabase(":memory:");
  try {
    const legacy = buildCityPlan(PLZEN, "2026-11-02");
    delete legacy.questPolicy;
    for (const z of legacy.zones) delete z.questActivities;
    const body = JSON.stringify(legacy);
    db.prepare("INSERT INTO world_blueprints VALUES(?,?,?,?,?,?,?)").run(
      legacy.id,
      legacy.cityId,
      legacy.day,
      legacy.sourceHash,
      body,
      hash(body),
      NOW - 86400000,
    );
    assert.deepEqual(getOrPrepareCityPlan(db, PLZEN, legacy.day, NOW), legacy);
    const world = await ensureWorld(db, HOME, true, NOW);
    const saved = db
      .prepare("SELECT * FROM quests WHERE world_id=? ORDER BY id")
      .all(world.id);
    assert.ok(
      saved
        .filter((q) => q.kind === "route")
        .every((q) => JSON.parse(q.metadata).checkpoints.length === 3),
    );
    assert.ok(
      worldView(db, world.id).quests.every(
        (q) => q.activity.policy === "legacy-demo-v2",
      ),
    );
    assert.equal(
      db.prepare("SELECT body FROM world_blueprints WHERE id=?").get(legacy.id)
        .body,
      body,
    );
    await ensureWorld(db, { ...HOME, lng: HOME.lng + 0.001 }, true, NOW + 100);
    assert.deepEqual(
      db
        .prepare("SELECT * FROM quests WHERE world_id=? ORDER BY id")
        .all(world.id),
      saved,
    );
  } finally {
    db.close();
  }
});

test("native v1 content commitments stay byte compatible across demo template activation", () => {
  const treasury = {
    coins: { available: "6000000000000000000000" },
    zones: { available: "6000000000000000000000" },
  };
  const goldenHashes = {
    "2026-10-31":
      "d3a12178c84e1e42215ca8c4f3ca08b8ae4f409d881fdd42f1e729d3f6cb4371",
    "2026-11-01":
      "e6343b68ed8c4db3c8c99a03aa05f4bfc66909d04a048b9f8b2952defe513589",
    "2026-11-02":
      "e27951a3020ff8d7243af38dce506b27cbe9beb0d326bea8a234f038518b2669",
  };
  for (const [day, expected] of Object.entries(goldenHashes)) {
    const plan = buildCityPlan(PLZEN, day),
      manifest = nativeManifest(plan, treasury);
    assert.equal(manifest.hash, expected, day);
    const before = JSON.stringify(manifest);
    const enrichment = manifest.quests.map(describeNativeQuest);
    assert.ok(
      enrichment.every(
        (a) => a.policy === "native-city-v1" && a.steps.length === 3,
      ),
    );
    assert.equal(JSON.stringify(manifest), before);
    delete plan.questPolicy;
    for (const z of plan.zones) delete z.questActivities;
    assert.deepEqual(nativeManifest(plan, treasury), manifest);
  }
});

test("return trail requires ordered departure and return; retries and another player cannot duplicate XP", async () => {
  const db = openDatabase(":memory:");
  try {
    const player = createPlayer(db, "Return walker"),
      other = createPlayer(db, "Second walker");
    const world = await ensureWorld(db, HOME, true, NOW);
    const q = worldView(db, world.id, player).quests.find(
      (q) => q.tier === 1 && q.activity.templateId === "return-trail",
    );
    assert.ok(q);
    const points = q.activity.steps.map((s) => s.point);
    assert.equal(points.length, 4);
    assert.throws(() => claimQuest(db, player, q.id, q, NOW), /checkpoints/);
    assert.throws(
      () => advanceRoute(db, player, q.id, points[2], 2, NOW),
      /Refresh/,
    );
    advanceRoute(db, player, q.id, points[0], 0, NOW);
    assert.throws(
      () => advanceRoute(db, player, q.id, points[0], 0, NOW),
      /Refresh/,
    );
    assert.throws(
      () => advanceRoute(db, player, q.id, points[0], 1, NOW),
      /destination/,
    );
    assert.throws(
      () => advanceRoute(db, other, q.id, points[1], 1, NOW),
      /Refresh/,
    );
    advanceRoute(db, player, q.id, points[1], 1, NOW);
    advanceRoute(db, player, q.id, points[2], 2, NOW);
    assert.equal(
      db.prepare("SELECT xp FROM players WHERE id=?").get(player).xp,
      0,
    );
    const result = advanceRoute(db, player, q.id, points[3], 3, NOW);
    assert.equal(result.xp, 100);
    assert.equal(result.reward, 0);
    assert.equal(result.item, null);
    assert.throws(
      () => advanceRoute(db, player, q.id, points[3], 3, NOW),
      /already completed/,
    );
    assert.equal(
      db.prepare("SELECT xp FROM players WHERE id=?").get(player).xp,
      100,
    );
  } finally {
    db.close();
  }
});

test("physical return rejects reusing the starting GPS fix and preserves progress until fresh evidence", async () => {
  const db = openDatabase(":memory:");
  try {
    const player = createPlayer(db, "GPS return walker"),
      world = await ensureWorld(db, HOME, false, NOW);
    const q = worldView(db, world.id, player).quests.find(
      (q) => q.tier === 1 && q.activity.templateId === "return-trail",
    );
    const points = q.activity.steps.map((s) => s.point);
    for (let i = 0; i < 3; i++)
      advanceRoute(
        db,
        player,
        q.id,
        { ...points[i], accuracy: 5, timestamp: NOW + i * 1000 },
        i,
        NOW + i * 1000,
      );
    assert.throws(
      () =>
        advanceRoute(
          db,
          player,
          q.id,
          { ...points[0], accuracy: 5, timestamp: NOW },
          3,
          NOW + 3000,
        ),
      (e) => e.code === "GPS_REPLAY",
    );
    assert.equal(
      worldView(db, world.id, player).quests.find((x) => x.id === q.id)
        .checkpoint,
      3,
    );
    const result = advanceRoute(
      db,
      player,
      q.id,
      { ...points[0], accuracy: 5, timestamp: NOW + 4000 },
      3,
      NOW + 4000,
    );
    assert.equal(result.xp, 100);
  } finally {
    db.close();
  }
});

test("final checkpoint and award roll back together when receipt persistence fails", async () => {
  const db = openDatabase(":memory:");
  try {
    const player = createPlayer(db, "Recovery walker"),
      world = await ensureWorld(db, HOME, true, NOW);
    const q = worldView(db, world.id, player).quests.find(
      (q) => q.tier === 1 && q.activity.templateId === "return-trail",
    );
    const points = q.activity.steps.map((s) => s.point);
    for (let i = 0; i < points.length - 1; i++)
      advanceRoute(db, player, q.id, points[i], i, NOW);
    db.exec(
      "CREATE TRIGGER reject_quest_history BEFORE INSERT ON history WHEN NEW.kind='quest' BEGIN SELECT RAISE(ABORT, 'Receipt store unavailable'); END",
    );
    assert.throws(
      () =>
        advanceRoute(db, player, q.id, points.at(-1), points.length - 1, NOW),
      /Receipt store unavailable/,
    );
    assert.equal(
      worldView(db, world.id, player).quests.find((x) => x.id === q.id)
        .checkpoint,
      points.length - 1,
    );
    assert.equal(
      db.prepare("SELECT xp FROM players WHERE id=?").get(player).xp,
      0,
    );
    assert.equal(
      db.prepare("SELECT claimant FROM quests WHERE id=?").get(q.id).claimant,
      null,
    );
    assert.equal(
      db
        .prepare("SELECT count(*) n FROM quest_claims WHERE quest_id=?")
        .get(q.id).n,
      0,
    );
    db.exec("DROP TRIGGER reject_quest_history");
    assert.equal(
      advanceRoute(db, player, q.id, points.at(-1), points.length - 1, NOW).xp,
      100,
    );
    assert.equal(
      db
        .prepare("SELECT count(*) n FROM quest_claims WHERE quest_id=?")
        .get(q.id).n,
      1,
    );
  } finally {
    db.close();
  }
});
