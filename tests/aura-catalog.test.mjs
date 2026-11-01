import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as server from "../server/aura-catalog.mjs";
import {
  AURA_CATALOG,
  AURA_SETS,
  activeAuraSet,
  auraEntitled,
  catalogEditionFor,
  entitlementLabel,
} from "../src/aura-catalog.ts";
import { AURA_EDITIONS, auraEdition, auraRects } from "../src/aura-art-data.ts";
import { catalogProgress, filterAuras, sortAuras } from "../src/aura-wardrobe.ts";
import { openDatabase, createPlayer } from "../server/database.mjs";
import { chooseChestAura } from "../server/game.mjs";

test("client and server read the same catalog; every edition has authored art", () => {
  assert.deepEqual(
    server.AURA_CATALOG.map((e) => e.id),
    AURA_CATALOG.map((e) => e.id),
  );
  assert.deepEqual([...AURA_EDITIONS].sort(), AURA_CATALOG.map((e) => e.id).sort());
  assert.equal(new Set(AURA_CATALOG.map((e) => e.demoName)).size, AURA_CATALOG.length);
  for (const e of AURA_CATALOG) {
    assert.equal(auraEdition({ name: e.demoName }), e.id);
    assert.equal(auraEdition({ name: e.name }), e.id);
    assert.equal(auraEdition({ color: e.color }), e.id);
    assert.ok(AURA_SETS.some((s) => s.id === e.set));
    for (const slot of ["above", "below"])
      assert.ok(auraRects({ edition: e.id, slot }).length > 20);
  }
  // Both slots are covered at every rarity.
  for (const rarity of ["common", "rare", "epic", "legendary"])
    for (const slot of ["above", "below"])
      assert.ok(
        AURA_CATALOG.some((e) => e.rarity === rarity && e.slot === slot),
        `${rarity} ${slot}`,
      );
  // Native editions are exactly the contract's AURA_EDITIONS table, with the
  // same titles, in catalog-independent order.
  const rust = readFileSync(
      new URL("../contracts/collectibles/src/lib.rs", import.meta.url),
      "utf8",
    ),
    table = rust.slice(
      rust.indexOf("const AURA_EDITIONS"),
      rust.indexOf("];", rust.indexOf("const AURA_EDITIONS")),
    ),
    rows = [...table.matchAll(/\("([a-z]+)", "([^"]+)", include_str!\("\.\.\/assets\/aura-([a-z]+)-uri\.txt"\)\)/g)];
  assert.deepEqual(
    rows.map((r) => r[1]).sort(),
    AURA_CATALOG.filter((e) => e.native).map((e) => e.id).sort(),
  );
  for (const [, id, title, asset] of rows) {
    assert.equal(asset, id);
    assert.equal(AURA_CATALOG.find((e) => e.id === id).name, title);
  }
  assert.deepEqual(server.LEGACY_NATIVE_EDITIONS, ["polar", "moon", "gold"]);
});
test("rarity follows zone tier and level entitlements on client and server", () => {
  const byId = Object.fromEntries(AURA_CATALOG.map((e) => [e.id, e]));
  assert.ok(auraEntitled(byId.ember, 1, 1));
  assert.ok(!auraEntitled(byId.polar, 1, 1));
  assert.ok(auraEntitled(byId.polar, 1, 2));
  assert.ok(!auraEntitled(byId.storm, 1, 9));
  assert.ok(auraEntitled(byId.storm, 2, 3));
  assert.ok(!auraEntitled(byId.gold, 2, 9));
  assert.ok(auraEntitled(byId.gold, 3, 4));
  for (const tier of [1, 2, 3])
    for (const level of [1, 2, 3, 4, 5])
      assert.deepEqual(
        server.entitledEditions(tier, level).map((e) => e.id),
        AURA_CATALOG.filter((e) => auraEntitled(e, tier, level)).map((e) => e.id),
      );
  assert.equal(entitlementLabel("common"), "Any level · any zone chest");
  assert.equal(entitlementLabel("legendary"), "Level 4+ · gold zones");
});
test("chest drops stay within entitlements, prefer missing editions and respect supply", () => {
  const db = openDatabase(":memory:"),
    player = createPlayer(db, "Collector");
  const first = chooseChestAura(db, player, 1, 1);
  assert.equal(first.rarity, "common");
  for (let i = 0; i < 20; i++) {
    const pick = chooseChestAura(db, player, 2, 3);
    assert.ok(["common", "rare", "epic"].includes(pick.rarity));
  }
  db.prepare(
    "INSERT INTO inventory VALUES ('i1',?,'aura','Ember Wisp','common','above','#ff8a4c',0,1,0)",
  ).run(player);
  assert.equal(chooseChestAura(db, player, 1, 1).id, "dew");
  for (const name of server.DEMO_AURA_NAMES)
    db.prepare("INSERT INTO editions VALUES (?,256,256)").run(name);
  assert.equal(chooseChestAura(db, player, 3, 9), null);
  assert.equal(server.chestAuraAvailable(db, 3, 9), false);
  db.close();
});
test("set bonuses are cosmetic pairs of different editions from one set", () => {
  assert.equal(activeAuraSet({ name: "Northern Lights" }, { name: "Moon Ring" })?.id, "night-sky");
  assert.equal(activeAuraSet({ edition: "ember" }, { edition: "bloom" })?.id, "first-light");
  assert.equal(activeAuraSet({ edition: "ember" }, { edition: "moon" }), null);
  assert.equal(activeAuraSet({ edition: "ember" }, null), null);
  assert.equal(activeAuraSet({ name: "Festival" }, { name: "Festival" }), null);
  for (const set of AURA_SETS) {
    assert.doesNotMatch(set.bonus, /\b(xp|gold|reward|odds|bonus xp)\b|%/i);
    const members = AURA_CATALOG.filter((e) => e.set === set.id);
    assert.ok(members.some((e) => e.slot === "above"));
    assert.ok(members.some((e) => e.slot === "below"));
  }
});
test("wardrobe filters by slot, rarity and set; catalog progress counts editions", () => {
  const items = [
    { id: 1, name: "Ember Wisp", rarity: "common", slot: "above" },
    { id: 2, name: "Golden Dust", rarity: "legendary", slot: "above" },
    { id: 3, name: "Moon Ring", rarity: "epic", slot: "below" },
    { id: 4, name: "Golden Dust", rarity: "legendary", slot: "above" },
  ];
  const ids = (list) => list.map((i) => i.id);
  assert.deepEqual(ids(filterAuras(items, { slot: "below", rarity: "all", set: "all" })), [3]);
  assert.deepEqual(ids(filterAuras(items, { slot: "all", rarity: "legendary", set: "all" })), [2, 4]);
  assert.deepEqual(ids(filterAuras(items, { slot: "all", rarity: "all", set: "night-sky" })), [3]);
  assert.deepEqual(ids(sortAuras(items)), [2, 4, 3, 1]);
  const progress = catalogProgress(items);
  assert.equal(progress.found, 3);
  assert.equal(progress.total, AURA_CATALOG.length);
  assert.equal(progress.entries.find((e) => e.edition.id === "gold").owned, 2);
  assert.equal(catalogEditionFor({ name: "Golden Dust" }).id, "gold");
});
test("native token ids accept every catalog edition within the 256 cap", () => {
  assert.deepEqual(server.nativeAuraToken("aura:nova:256"), { edition: "nova", serial: 256 });
  assert.deepEqual(server.nativeAuraToken("aura:polar:1"), { edition: "polar", serial: 1 });
  for (const bad of ["aura:nova:0", "aura:nova:257", "aura:festival:1", "aura:polar:01", "avatar:x", null])
    assert.equal(server.nativeAuraToken(bad), null, String(bad));
  assert.equal(server.nativeEditionForName("Golden Dust"), "gold");
  assert.equal(server.nativeEditionForName("Ember Wisp"), "ember");
  assert.equal(server.nativeEditionForName("Mosslight"), null);
});
