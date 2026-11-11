import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { PLZEN, contains, polygonGap } from "../server/spatial/city-pack.mjs";
import { localDateBounds, localDateStart } from "../server/spatial/calendar.mjs";
import { distance } from "../server/domain.mjs";
import { buildCityPlan, planDescriptor } from "../server/world-planner.mjs";
import { openDatabase, createPlayer } from "../server/database.mjs";
import { ensureWorld, worldView, HOME } from "../server/world.mjs";
import { createActorService } from "../server/actors/service.mjs";
import {
  ACTOR_HOME_RADIUS_M,
  ACTOR_RANGE_M,
  demoLayoutFor,
  demoWorldSuffix,
  demoZoneMode,
  withDemoZones,
} from "../server/demo-zones.mjs";
import { buildDemoZones } from "../scripts/build-demo-zones.mjs";

const ON = { DEMO_ZONES: "plzen-compact" },
  START = { lat: 49.74745, lng: 13.3774 },
  DAY = "2026-11-11";

test("DEMO_ZONES is off by default, validated and refused on mainnet", () => {
  assert.equal(demoZoneMode({}), null);
  assert.equal(demoZoneMode({ DEMO_ZONES: "off" }), null);
  assert.equal(demoZoneMode(ON), "plzen-compact");
  assert.throws(() => demoZoneMode({ DEMO_ZONES: "everywhere" }), /DEMO_ZONES must be/);
  assert.throws(() => demoZoneMode(ON, "mainnet"), /only allowed on testnet/);
  assert.equal(demoLayoutFor("plzen", { ...ON, NEAR_NETWORK: "mainnet" }), null);
  assert.equal(demoLayoutFor("brno", ON), null);
  assert.equal(withDemoZones(PLZEN, {}), PLZEN);
  assert.equal(demoWorldSuffix("plzen", {}), "");
  assert.equal(demoWorldSuffix("plzen", ON), "-compact");
});

test("the committed layout matches its generator", () => {
  const file = readFileSync(new URL("../server/data/demo-zones/plzen-compact.json", import.meta.url), "utf8");
  assert.equal(file, JSON.stringify(buildDemoZones(PLZEN), null, 1) + "\n");
});

test("compact plans put six always-open zones within 450 m of the start", () => {
  const pack = withDemoZones(PLZEN, ON);
  assert.notEqual(planDescriptor(pack, DAY).id, planDescriptor(PLZEN, DAY).id);
  for (const day of ["2026-11-11", "2026-11-12", "2026-11-13", "2026-12-24"]) {
    const plan = buildCityPlan(pack, day),
      { startsAt, endsAt } = localDateBounds(day, PLZEN.timezone);
    assert.equal(plan.zones.length, 6, day);
    assert.equal(plan.demoZones, "plzen-compact-v1");
    assert.deepEqual(plan.zones.map((z) => z.tier).sort(), [1, 1, 1, 2, 2, 3]);
    for (const z of plan.zones) {
      assert.equal(z.opensAt, startsAt, `${day} ${z.name} opens at the start of the day`);
      assert.equal(z.closesAt, endsAt, `${day} ${z.name} stays open until the end`);
      assert.equal(z.targets.length, 3);
      for (const t of z.targets) {
        assert.ok(contains(z.geometry, t));
        assert.ok(distance(t, START) <= 450, `${z.name} target ${Math.round(distance(t, START))} m away`);
      }
    }
    for (let i = 0; i < 6; i++)
      for (let j = i + 1; j < 6; j++)
        assert.ok(polygonGap(plan.zones[i].geometry, plan.zones[j].geometry) >= 80);
  }
  // Without the flag the rarer zones keep their windows.
  const normal = buildCityPlan(PLZEN, DAY);
  assert.ok(normal.zones.some((z) => z.closesAt - z.opensAt < 12 * 3600_000));
});

// The mainnet suite (npm run test:mainnet) refuses DEMO_ZONES, which the
// first test covers; a compact world exists only on testnet.
test("a compact world is its own world id and every zone quest is open now", { skip: process.env.NEAR_NETWORK === "mainnet" }, async () => {
  const saved = process.env.DEMO_ZONES;
  process.env.DEMO_ZONES = "plzen-compact";
  try {
    const db = openDatabase(":memory:"),
      player = createPlayer(db, "Judge"),
      now = Date.parse("2026-11-11T05:30:00Z"); // 06:30 in Plzeň
    const w = await ensureWorld(db, HOME, true, now);
    assert.match(w.id, /:v2-compact$/);
    assert.equal(w.demoZones, "plzen-compact-v1");
    const view = worldView(db, w.id, player, { now });
    assert.equal(view.zones.length, 6);
    const zoneQuests = view.quests.filter((q) => q.zone_id);
    assert.equal(zoneQuests.length, 18);
    for (const q of zoneQuests) assert.ok(q.opens_at <= now && q.closes_at > now, q.id);
    for (const z of view.zones) assert.ok(distance(z.targets[0], START) <= 450);
  } finally {
    if (saved === undefined) delete process.env.DEMO_ZONES;
    else process.env.DEMO_ZONES = saved;
  }
});

test("compact worlds keep NPCs and monsters near the centre", async () => {
  const db = new DatabaseSync(":memory:"),
    day = "2026-11-02",
    dayStart = localDateStart(day, "Europe/Prague"),
    now = dayStart + 12 * 3600_000;
  const service = createActorService(db, { clock: () => now, allDay: true });
  db.exec("CREATE TABLE IF NOT EXISTS worlds(id TEXT PRIMARY KEY, day TEXT, region TEXT, timezone TEXT, manifest TEXT, created_at INTEGER)");
  const manifest = (id, extra) => {
    const m = { id, day, cityId: "plzen", timezone: "Europe/Prague", arena: true, endsAt: dayStart + 86_400_000, zones: [], ...extra };
    db.prepare("INSERT INTO worlds VALUES(?,?,?,?,?,?)").run(id, day, "city-plzen", "Europe/Prague", JSON.stringify(m), 0);
    return m;
  };
  const compact = manifest(`demo:arena-city-plzen:${day}:v2-compact`, { demoZones: "plzen-compact-v1" }),
    normal = manifest(`demo:arena-city-plzen:${day}:v2`, {});
  const far = (list) =>
    Math.max(
      ...list.actors.flatMap((a) => a.segments.flatMap((s) => s.path.map(([lng, lat]) => distance({ lat, lng }, START)))),
    );
  const small = await service.list({ player: "p1", worldId: compact.id }),
    wide = await service.list({ player: "p1", worldId: normal.id });
  assert.ok(small.actors.some((a) => a.archetype === "trader"));
  assert.ok(small.actors.some((a) => a.archetype === "roamer"));
  // Home radius plus walking range, with slack for path detours.
  assert.ok(far(small) <= ACTOR_HOME_RADIUS_M + ACTOR_RANGE_M + 150, `compact reach ${Math.round(far(small))} m`);
  assert.ok(far(wide) > far(small), "the normal cast still roams the city");
});
