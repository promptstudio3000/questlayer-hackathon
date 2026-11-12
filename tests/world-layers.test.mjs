import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import {
  ACTOR_MODELS,
  OBJECT_KINDS,
  QUEST_TEMPLATE_IDS,
  TOKEN_KEYS,
  contrastRatio,
  validateWorldPack,
  validateWorldPackFile,
} from "../server/worlds/validate.mjs";
import {
  DEFAULT_LAYER,
  WORLD_REGISTRY,
  layerSummary,
  loadWorldRegistry,
} from "../server/worlds/registry.mjs";
import { checkSchema, MAX_PACK_BYTES } from "../server/worlds/schema.mjs";
import { PLZEN } from "../server/spatial/city-pack.mjs";
import { buildCityPlan } from "../server/world-planner.mjs";

const read = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), "utf8");
const aavegotchiText = read("server/data/worlds/aavegotchi-v1.json");
const aavegotchi = JSON.parse(aavegotchiText);
const clone = () => structuredClone(aavegotchi);
// A small valid community pack to mutate in failure cases.
function punk() {
  const p = clone();
  p.id = "punks-city";
  p.version = "2026-11-05.1";
  p.name = { en: "Punk City", cs: "Punkové město" };
  p.lore = {
    en: "Street musicians and painters turn plazas into a daytime festival.",
    cs: "Pouliční muzikanti a malíři mění náměstí v denní festival.",
    tone: ["streetwise", "friendly"],
    forbidden: ["violence"],
  };
  p.rights = { assets: [], trademarks: [], ownershipSource: null };
  p.skin.avatar = "starter-template";
  p.actors = [{ archetype: "roamer", model: "punks-city/glitch-rat", density: "low" }];
  p.rewards.editions = [{ id: "punk-halo", supply: 500, slot: "above" }];
  p.rules.killSwitch = "WORLD_PUNKS_CITY=0";
  return p;
}
const rulesOf = (report) => report.failures.map((f) => f.rule);
const noFiles = { fileExists: () => false, fileSize: () => 0 };

test("every pack under server/data/worlds validates (CI gate)", () => {
  const files = readdirSync(new URL("../server/data/worlds/", import.meta.url)).filter((f) => f.endsWith(".json"));
  assert.ok(files.length >= 1);
  for (const f of files) {
    const report = validateWorldPackFile(`server/data/worlds/${f}`);
    assert.deepEqual(report.failures, [], f);
    assert.equal(report.ok, true);
  }
});

test("server lookups equal the client sources", () => {
  const ts = (file, name) => [
    ...read(file).match(new RegExp(`export const ${name} = \\[([\\s\\S]*?)\\] as const`))[1].matchAll(/"([^"]+)"/g),
  ].map((m) => m[1]);
  const lookups = JSON.parse(read("server/data/world-lookups.json"));
  const design = JSON.parse(read("docs/design-tokens.json"));
  assert.deepEqual(lookups.objectKinds, ts("src/game-object-art-data.ts", "GAME_OBJECT_KINDS"));
  assert.deepEqual(lookups.actorModels, ts("src/actor-models.ts", "ACTOR_MODELS"));
  assert.deepEqual(lookups.color, design.color);
  assert.deepEqual(lookups.textPairsToVerify, design.textPairsToVerify);

  assert.deepEqual(OBJECT_KINDS, ["coin", "chest", "discovery", "route", "place"]);
  assert.ok(ACTOR_MODELS.includes("chronicler") && ACTOR_MODELS.includes("lick-boss"));
  assert.ok(QUEST_TEMPLATE_IDS.includes("path-visit"));
  assert.ok(TOKEN_KEYS.includes("--ink-secondary") && TOKEN_KEYS.includes("--action"));
});

test("aavegotchi is the live default layer and its file is pinned", () => {
  assert.equal(DEFAULT_LAYER.id, "aavegotchi");
  assert.equal(WORLD_REGISTRY.statusOf("aavegotchi"), "live");
  assert.deepEqual(WORLD_REGISTRY.liveLayers({}).map((l) => l.id), ["aavegotchi"]);
  // Published layer files are immutable: a change is a new -v<n> file.
  assert.equal(
    createHash("sha256").update(aavegotchiText).digest("hex"),
    "47e656bc1a79907cbdfb51d25d788bea473ddd30bd6be27621a6eb80db11d4e0",
  );
  assert.equal(DEFAULT_LAYER.hash, layerSummary(DEFAULT_LAYER).hash);
  // The default theme cannot be switched off by its kill switch.
  assert.deepEqual(WORLD_REGISTRY.liveLayers({ WORLD_AAVEGOTCHI: "0" }).map((l) => l.id), ["aavegotchi"]);
});

test("aavegotchi layer mirrors the current world data", () => {
  const catalog = JSON.parse(read("server/data/aura-catalog.json"));
  assert.deepEqual(
    aavegotchi.rewards.editions,
    catalog.editions.map((e) => ({ id: e.id, supply: catalog.supplyPerEdition, slot: e.slot })),
  );
  assert.equal(aavegotchi.rewards.money, "none");
  const actors = JSON.parse(read("server/data/actors/plzen.json")).actors;
  assert.deepEqual(
    aavegotchi.actors.map((a) => [a.archetype, a.model]),
    actors.map((a) => [a.archetype, a.model]),
  );
  // Zone tier colours are the ones server/world.mjs paints today.
  const world = read("server/world.mjs");
  for (const c of Object.values(aavegotchi.skin.zoneColors)) assert.ok(world.includes(`"${c}"`), c);
  assert.deepEqual(
    aavegotchi.questTypes.map((q) => q.template),
    QUEST_TEMPLATE_IDS,
  );
});

test("plans, world ids and hashes for 2 and 3 November are unchanged", () => {
  // Captured before layers existed (a14fca0). Layers add nothing to plans.
  const expected = {
    "2026-11-02": "b6dd3733c641b0941eb9e33a16daf41b0c75afdec92dd2fdb32128ef91dd8383",
    "2026-11-03": "d26580c262c3eb19cf3a373765c0760d3844bcfe6330a4d10275bd6e9cf370a7",
  };
  for (const [day, hash] of Object.entries(expected)) {
    const plan = buildCityPlan(PLZEN, day);
    assert.equal(createHash("sha256").update(JSON.stringify(plan)).digest("hex"), hash, day);
    assert.ok(!JSON.stringify(plan).includes("layer"), day);
  }
});

test("a valid community pack passes", () => {
  const report = validateWorldPack({ ...punk(), kind: "official" }, noFiles);
  assert.deepEqual(report.failures, []);
});

test("schema: unknown keys, sizes and reserved ids are refused", () => {
  assert.ok(checkSchema({ ...clone(), extra: 1 }).some((f) => f.path === "$.extra" && f.reason === "unknown key"));
  assert.ok(checkSchema(clone(), { bytes: MAX_PACK_BYTES + 1 }).some((f) => f.path === "$"));
  const p = clone();
  delete p.rules;
  assert.ok(checkSchema(p).some((f) => f.path === "$.rules"));
  assert.ok(rulesOf(validateWorldPack({ ...clone(), kind: "community" }, noFiles)).includes("schema"));
  const bad = clone();
  bad.questTypes[0].params = { stops: 9 };
  assert.ok(rulesOf(validateWorldPack(bad, noFiles)).includes("schema"));
  assert.equal(validateWorldPack(null).ok, false);
});

test("rights: unlisted marks, endorsement wording, assets and third-party evidence", () => {
  const mark = punk();
  mark.lore.en = "CryptoPunks gather on the square.";
  assert.ok(validateWorldPack(mark, noFiles).failures.some((f) => f.rule === "rights" && /CryptoPunks/.test(f.reason)));
  const official = punk();
  official.name.en = "Official Punk City";
  assert.ok(rulesOf(validateWorldPack(official, noFiles)).includes("rights"));
  const unlisted = punk();
  unlisted.skin.objects.coin = "public/worlds/punks-city/coin.svg";
  assert.ok(rulesOf(validateWorldPack(unlisted, noFiles)).includes("rights"));
  const third = punk();
  third.rights.assets = [{ path: "public/worlds/punks-city/coin.svg", source: "third-party", licence: "CC-BY-4.0" }];
  third.skin.objects.coin = "public/worlds/punks-city/coin.svg";
  const r = validateWorldPack(third, { fileExists: (p) => p.endsWith("coin.svg"), fileSize: () => 900 });
  assert.ok(r.failures.some((f) => /provenance\.json/.test(f.reason)));
  const ok = validateWorldPack(third, { fileExists: () => true, fileSize: () => 900 });
  assert.deepEqual(ok.failures.filter((f) => f.rule === "rights"), []);
  const big = validateWorldPack(third, { fileExists: () => true, fileSize: () => 900_000 });
  assert.ok(rulesOf(big).includes("skin"));
  const nft = punk();
  nft.skin.avatar = "owned-nft";
  assert.ok(rulesOf(validateWorldPack(nft, noFiles)).includes("rights"));
});

test("text policy rejects links, money promises and unsafe instructions", () => {
  for (const line of [
    "Visit www.example.com for more",
    "Win NEAR on every corner",
    "Climb the fence behind the station",
    "Send your seed phrase to the keeper",
  ]) {
    const p = punk();
    p.questTypes[0].flavour.en = line.slice(0, 80);
    assert.ok(rulesOf(validateWorldPack(p, noFiles)).includes("text"), line);
  }
});

test("economy: money must be none, xp capped, editions finite and official only", () => {
  const money = punk();
  money.rewards.money = "near";
  assert.ok(rulesOf(validateWorldPack(money, noFiles)).includes("economy"));
  const xp = punk();
  xp.rewards.xpWeight = 1.5;
  assert.ok(rulesOf(validateWorldPack(xp, noFiles)).includes("schema"));
  const supply = punk();
  supply.rewards.editions[0].supply = 1e9;
  assert.ok(rulesOf(validateWorldPack(supply, noFiles)).includes("schema"));
  const community = { ...punk(), kind: "community" };
  assert.ok(rulesOf(validateWorldPack(community, noFiles)).includes("economy"));
  const dup = { ...punk(), kind: "official" };
  dup.rewards.editions.push({ ...dup.rewards.editions[0] });
  assert.ok(rulesOf(validateWorldPack(dup, noFiles)).includes("economy"));
});

test("quest types must be registered templates", () => {
  const p = punk();
  p.questTypes.push({ template: "poi-category-hunt" });
  assert.ok(rulesOf(validateWorldPack(p, noFiles)).includes("quest-types"));
});

test("skin: token keys, AA contrast, object kinds and remote URLs", () => {
  const key = punk();
  key.skin.tokens = { "--frame": "#ff2d55" };
  assert.ok(rulesOf(validateWorldPack(key, noFiles)).includes("skin"));
  const low = punk();
  low.skin.tokens = { "--action": "#ffd0ff" };
  const report = validateWorldPack(low, noFiles);
  assert.ok(report.failures.some((f) => f.rule === "skin" && /contrast/.test(f.reason)));
  assert.ok(contrastRatio("#000000", "#ffffff") > 20);
  const kind = punk();
  kind.skin.objects.lamp = "builtin:lamp";
  assert.ok(rulesOf(validateWorldPack(kind, noFiles)).includes("skin"));
  const remote = punk();
  remote.skin.objects.coin = "https://example.com/coin.svg";
  assert.ok(rulesOf(validateWorldPack(remote, noFiles)).includes("skin"));
});

test("actors: archetypes from code, models and personas reviewed", () => {
  const arch = punk();
  arch.actors.push({ archetype: "dragon", density: "low" });
  assert.ok(rulesOf(validateWorldPack(arch, noFiles)).includes("actors"));
  const model = punk();
  model.actors.push({ archetype: "roamer", model: "other-world/rat", density: "low" });
  assert.ok(rulesOf(validateWorldPack(model, noFiles)).includes("actors"));
  const persona = punk();
  persona.actors.push({ archetype: "quest_giver", persona: "plzen/nobody", density: "1-per-city" });
  assert.ok(rulesOf(validateWorldPack(persona, noFiles)).includes("actors"));
  const density = punk();
  density.actors[0].density = "1-per-city";
  assert.ok(rulesOf(validateWorldPack(density, noFiles)).includes("actors"));
});

test("rules: private worlds name their cities, hours are ordered", () => {
  const priv = { ...punk(), kind: "private" };
  priv.rewards.editions = [];
  assert.ok(rulesOf(validateWorldPack(priv, noFiles)).includes("rules"));
  priv.rules.cities = ["plzen"];
  assert.deepEqual(validateWorldPack(priv, noFiles).failures, []);
  const hours = punk();
  hours.rules.hours = ["20:00", "08:00"];
  assert.ok(rulesOf(validateWorldPack(hours, noFiles)).includes("schema"));
});

test("registry refuses duplicates, invalid packs, bad defaults and live private worlds", () => {
  const packs = {
    "worlds/aavegotchi-v1.json": aavegotchiText,
    "worlds/punks-city-v1.json": JSON.stringify({ ...punk(), kind: "official" }),
  };
  const readPack = (f) => packs[f];
  const ok = { fileExists: () => false, fileSize: () => 0 };
  const validate = (p, o) => validateWorldPack(p, { ...o, ...ok });
  const base = { id: "aavegotchi", pack: "worlds/aavegotchi-v1.json", status: "live", default: true };
  const punkEntry = { id: "punks-city", pack: "worlds/punks-city-v1.json", status: "preview" };
  const load = (layers) => loadWorldRegistry({ version: 1, layers }, readPack, validate);

  const reg = load([base, punkEntry]);
  assert.equal(reg.statusOf("punks-city"), "preview");
  assert.deepEqual(reg.liveLayers({}).map((l) => l.id), ["aavegotchi"]);
  const live = load([base, { ...punkEntry, status: "live" }]);
  assert.deepEqual(live.liveLayers({}).map((l) => l.id), ["aavegotchi", "punks-city"]);
  assert.deepEqual(live.liveLayers({ WORLD_PUNKS_CITY: "0" }).map((l) => l.id), ["aavegotchi"]);

  assert.throws(() => load([base, base]), /Duplicate/);
  assert.throws(() => load([{ ...base, default: false }]), /default/);
  assert.throws(() => load([{ ...base, status: "preview" }]), /default/);
  assert.throws(() => load([base, { ...punkEntry, default: true }]), /default/);
  assert.throws(() => load([base, { ...punkEntry, status: "gone" }]), /status/);
  assert.throws(() => load([base, { ...punkEntry, pack: "../secrets.json" }]), /pack file/);
  assert.throws(() => load([base, { ...punkEntry, id: "other-city" }]), /expected other-city/);
  packs["worlds/punks-city-v1.json"] = JSON.stringify({ ...punk(), rewards: { ...punk().rewards, money: "gold" } });
  assert.throws(() => load([base, punkEntry]), /invalid: economy/);
  const priv = { ...punk(), kind: "private", rules: { ...punk().rules, cities: ["plzen"] } };
  priv.rewards.editions = [];
  packs["worlds/punks-city-v1.json"] = JSON.stringify(priv);
  assert.equal(load([base, punkEntry]).statusOf("punks-city"), "preview");
  assert.throws(() => load([base, { ...punkEntry, status: "live" }]), /private/);
  assert.throws(() => loadWorldRegistry({ version: 2, layers: [] }), /version: 1/);
});
