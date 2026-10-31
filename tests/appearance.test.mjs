import test from "node:test";
import assert from "node:assert/strict";
import { openDatabase, createPlayer } from "../server/database.mjs";
import { publicAppearance } from "../server/appearance.mjs";
import { characterMarkerMarkup } from "../src/character-art.ts";
const now = Date.parse("2026-10-31T04:00:00Z");
function setup() {
  const db = openDatabase(":memory:"),
    id = createPlayer(db, "Appearance Explorer", now);
  return {
    db,
    id,
    player: () => db.prepare("SELECT * FROM players WHERE id=?").get(id),
  };
}
test("peer appearance resolves both demo Aura slots without returning wallet or item identifiers", async () => {
  const s = setup();
  try {
    for (const [id, slot, color] of [
      ["a", "above", "#9edfc5"],
      ["b", "below", "#c2a0df"],
    ])
      s.db
        .prepare("INSERT INTO inventory VALUES(?,?,?,?,?,?,?,?,?,?)")
        .run(id, s.id, "aura", "Fixture Aura", "rare", slot, color, 1, 1, now);
    const look = await publicAppearance(s.db, s.player(), null, { now });
    assert.equal(look.above, "#9edfc5");
    assert.equal(look.below, "#c2a0df");
    assert.equal(look.source, "demo");
    assert.ok(!JSON.stringify(look).includes("item_id"));
    assert.equal(Object.hasOwn(look, "accountId"), false);
  } finally {
    s.db.close();
  }
});
test("native peer looks verify current token ownership and hide the account and NFT IDs", async () => {
  const s = setup();
  try {
    s.db
      .prepare("INSERT INTO wallet_links VALUES(?,?,?)")
      .run("alice.testnet", s.id, now);
    s.db
      .prepare("UPDATE players SET native_outfit=1,native_account=? WHERE id=?")
      .run("alice.testnet", s.id);
    const native = {
      view: async (method, args) =>
        method === "get_equipment"
          ? { above: "aura:polar:1", below: "aura:moon:1" }
          : {
              token_id: args.token_id,
              owner_id: args.token_id.includes("polar")
                ? "alice.testnet"
                : "buyer.testnet",
              metadata: {},
            },
    };
    const look = await publicAppearance(s.db, s.player(), native, { now });
    assert.equal(look.source, "native");
    assert.equal(look.above, "#9edfc5");
    assert.equal(look.below, null);
    assert.ok(!JSON.stringify(look).includes("alice.testnet"));
    assert.ok(!JSON.stringify(look).includes("aura:"));
  } finally {
    s.db.close();
  }
});
test("missing native linkage or failed reads never claim a stale native Aura is equipped", async () => {
  const s = setup();
  try {
    s.db
      .prepare("UPDATE players SET native_outfit=1,native_account=? WHERE id=?")
      .run("alice.testnet", s.id);
    const native = {
      view: async () => {
        throw Error("offline");
      },
    };
    let look = await publicAppearance(s.db, s.player(), native, { now });
    assert.equal(look.source, "unavailable");
    s.db
      .prepare("INSERT INTO wallet_links VALUES(?,?,?)")
      .run("alice.testnet", s.id, now);
    look = await publicAppearance(s.db, s.player(), native, { now });
    assert.equal(look.source, "unavailable");
    assert.equal(look.above, null);
    assert.equal(look.below, null);
  } finally {
    s.db.close();
  }
});
test("an original appearance is shared only while the ownership snapshot is current", async () => {
  const s = setup();
  try {
    s.db
      .prepare("UPDATE players SET appearance=? WHERE id=?")
      .run(JSON.stringify({ originTokenId: "123", address: "0x123" }), s.id);
    s.db
      .prepare("INSERT INTO external_links VALUES(?,?,?,?)")
      .run(
        "0x123",
        s.id,
        JSON.stringify({ gotchis: [{ tokenId: "123" }] }),
        now,
      );
    assert.equal(
      (await publicAppearance(s.db, s.player(), null, { now })).skinTokenId,
      "123",
    );
    assert.equal(
      (await publicAppearance(s.db, s.player(), null, { now: now + 300001 }))
        .skinTokenId,
      null,
    );
  } finally {
    s.db.close();
  }
});
test("shared map markup accepts only controlled colors and same-origin original-skin URLs", () => {
  const safe = characterMarkerMarkup({
    above: "#9edfc5",
    below: "#c2a0df",
    skinUrl: "/api/aavegotchi/skin?tokenId=123",
  });
  assert.ok(safe.includes("marker-aura top"));
  assert.ok(safe.includes("marker-aura bottom"));
  assert.ok(safe.includes("origin-player"));
  const unsafe = characterMarkerMarkup({
    color: '"><script>',
    above: "red;url(https://evil)",
    skinUrl: "https://example.com/tracker.svg",
  });
  assert.ok(!unsafe.includes("<script>"));
  assert.ok(!unsafe.includes("evil"));
  assert.ok(!unsafe.includes("tracker"));
});
