import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import {
  loadCityActors,
  validateActorDefinition,
  validateActorFile,
  instanceId,
} from "../server/actors/definitions.mjs";
import { ACTORS_SCHEMA } from "../server/actors/schema.mjs";
import { buildActorMenu, menuHash, registerMenuBuilder } from "../server/actors/menu.mjs";
import { createActorRoutes } from "../server/actors/routes.mjs";
import { ensureModuleVersion } from "../server/schema-compatibility.mjs";

test("the Plzeň actor file validates and uses the shared model keys", () => {
  const city = loadCityActors("plzen");
  const models = new Set(city.actors.map((a) => a.model));
  for (const m of ["chronicler", "merchant", "keeper", "pilgrim", "wisp", "glitch-moth", "rune-warden", "pocket-wisp", "storm-golem"])
    assert.ok(models.has(m), m);
  assert.equal(loadCityActors("nowhere"), null);
});

test("definitions reject unknown fields, wrong archetypes and stationary roamers", () => {
  const base = { id: "test-npc", kind: "npc", archetype: "trader", name: "T", model: "merchant", home: { lat: 49.7, lng: 13.3 }, rangeM: 100, speedMps: 1, dwellMin: [1, 2], enabled: true };
  assert.ok(validateActorDefinition(base));
  assert.throws(() => validateActorDefinition({ ...base, price: 1 }), /unknown field/);
  assert.throws(() => validateActorDefinition({ ...base, archetype: "roamer" }), /archetype/);
  assert.throws(() => validateActorDefinition({ ...base, speedMps: 0 }), /speed/);
  assert.throws(() => validateActorDefinition({ ...base, home: undefined }), /home/);
  assert.throws(() => validateActorFile({ version: 1, cityId: "plzen", hours: ["08:00", "20:00"], actors: [base, base] }, "plzen"), /duplicate/);
  assert.equal(instanceId({ id: "glitch-moth", count: 3 }, 2), "glitch-moth-2");
});

test("actors v1 schema initializes on an empty database", () => {
  const db = new DatabaseSync(":memory:");
  ensureModuleVersion(db, ACTORS_SCHEMA);
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE '%actor%' OR name='ai_npc_requests'").all().map((r) => r.name);
  for (const t of ["actor_encounters", "actor_offers", "actor_relationships", "actor_progress", "ai_npc_requests"])
    assert.ok(tables.includes(t), t);
});

test("monsters get a default challenge menu and registered builders win", async () => {
  const monster = { id: "rune-warden-1", kind: "monster", archetype: "guardian", name: "Rune Warden" };
  const menu = await buildActorMenu({ actor: monster, now: 1000 });
  assert.equal(menu[0].kind, "challenge");
  assert.equal(menuHash(menu), menuHash(structuredClone(menu)));
  registerMenuBuilder("storyteller", () => [{ id: "c1", kind: "chapter", label: "Chapter 1", terms: {}, expiresAt: 5 }]);
  assert.equal((await buildActorMenu({ actor: { kind: "npc", archetype: "storyteller" }, now: 0 }))[0].id, "c1");
  registerMenuBuilder("trader", () => [{ id: "x", kind: "mint_free", label: "", terms: {}, expiresAt: 1 }]);
  await assert.rejects(buildActorMenu({ actor: { kind: "npc", archetype: "trader" }, now: 0 }), /Invalid offer/);
});

test("disabled actors answer an empty list and 503 for encounters", async () => {
  const routes = createActorRoutes(null);
  let sent;
  const respond = (_res, data) => (sent = data);
  const check = (c, m, s, code) => { if (!c) throw Object.assign(new Error(m), { status: s, code }); };
  assert.equal(await routes.handle({ method: "GET" }, {}, new URL("http://x/api/actors"), { player: "p", respond, assert: check }), true);
  assert.deepEqual(sent.actors, []);
  assert.equal(sent.enabled, false);
  await assert.rejects(
    routes.handle({ method: "POST" }, {}, new URL("http://x/api/actors/kupec-vojtech/encounter"), { player: "p", respond, assert: check, body: async () => ({}) }),
    (e) => e.code === "ACTORS_DISABLED",
  );
  assert.equal(await routes.handle({ method: "GET" }, {}, new URL("http://x/api/other"), { player: "p", respond, assert: check }), false);
});
