import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkArt, groupFor, renderList } from "../scripts/art.mjs";
import { artKeyFromPath, artUrl, registerArt } from "../src/art-registry.ts";

const catalog = JSON.parse(readFileSync("art/catalog.json", "utf8"));
const keys = new Set(catalog.groups.flatMap((g) => g.items.map((i) => i.key)));

test("every NPC and monster model in the world data has an art entry", () => {
  const models = new Set();
  for (const f of readdirSync("server/data/actors"))
    for (const m of readFileSync(join("server/data/actors", f), "utf8").matchAll(/"model":\s*"([^"]+)"/g)) models.add(m[1]);
  for (const m of ["chronicler", "merchant", "keeper", "pilgrim", "wisp", "glitch-moth", "rune-warden", "pocket-wisp", "storm-golem", "sun-beetle"]) models.add(m);
  for (const m of models) {
    assert.ok(keys.has(`actors/${m}`), `actors/${m}`);
    assert.ok(keys.has(`portraits/${m}`) || /^lick-|portal|altar/.test(m), `portraits/${m}`);
  }
});

test("every Aura edition, object kind and badge kind has an art entry", () => {
  for (const e of JSON.parse(readFileSync("server/data/aura-catalog.json", "utf8")).editions) assert.ok(keys.has(`auras/${e.id}`), e.id);
  for (const k of ["coin", "chest", "discovery", "route", "place"]) assert.ok(keys.has(`objects/${k}`), k);
  const kinds = new Set(JSON.parse(readFileSync("server/data/place-badges.json", "utf8")).badges.map((b) => b.kind));
  for (const k of kinds) assert.ok(keys.has(`badges/${k}`), k);
});

test("docs/ART-LIST.md is generated from the catalog", () => {
  assert.equal(readFileSync("docs/ART-LIST.md", "utf8"), renderList(), "run npm run art:list");
});

test("file names map to keys and typos are refused", () => {
  assert.equal(artKeyFromPath("/art/actors/Merchant.PNG"), "actors/merchant");
  assert.equal(artKeyFromPath("/art/actors/merchant.gif"), null);
  assert.ok(groupFor("actors/merchant"));
  assert.ok(groupFor("objects/chest-open"));
  assert.ok(groupFor("auras/ember-below"));
  assert.ok(groupFor("badges/peak-snezka"));
  assert.equal(groupFor("actors/marchant"), null);
  assert.equal(groupFor("objects/chest-broken"), null);
});

test("the art check accepts good files and reports bad ones", () => {
  const dir = mkdtempSync(join(tmpdir(), "ql-art-"));
  mkdirSync(join(dir, "actors"));
  mkdirSync(join(dir, "brand"));
  const png = (w, h) => {
    const b = Buffer.alloc(33);
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b);
    b.write("IHDR", 12, "ascii");
    b.writeUInt32BE(w, 16);
    b.writeUInt32BE(h, 20);
    return b;
  };
  writeFileSync(join(dir, "actors/merchant.png"), png(512, 512));
  writeFileSync(join(dir, "actors/wisp.png"), png(100, 300));
  writeFileSync(join(dir, "actors/marchant.png"), png(512, 512));
  writeFileSync(join(dir, "brand/logo.svg"), '<svg onload="x()"/>');
  const r = checkArt(dir);
  assert.deepEqual(r.found.sort(), ["actors/merchant", "actors/wisp", "brand/logo"]);
  assert.ok(r.errors.some((e) => e.includes("marchant")));
  assert.ok(r.errors.some((e) => e.includes("logo.svg")));
  assert.ok(r.warnings.some((w) => w.includes("wisp.png")));
  assert.deepEqual(checkArt().errors, [], "files in art/ must pass npm run art:check");
});

test("the registry returns the first dropped-in key and nothing otherwise", () => {
  assert.equal(artUrl("actors/test-only"), null);
  registerArt({ "portraits/test-only": "/assets/p.png", "actors/test-only": "/assets/a.png" });
  assert.equal(artUrl("portraits/test-only", "actors/test-only"), "/assets/p.png");
  assert.equal(artUrl("objects/none", "actors/test-only"), "/assets/a.png");
});
