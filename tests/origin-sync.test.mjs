import test from "node:test";
import assert from "node:assert/strict";
import { openDatabase, createPlayer } from "../server/database.mjs";
import { createOriginSync, dressDefault } from "../server/origin-sync.mjs";
import { defaultGotchi, decodeGotchiName } from "../server/aavegotchi.mjs";

const ADDRESS = "0x" + "a".repeat(40);
const snapshot = (at) => ({
  gotchis: [
    { tokenId: "3270", svg: null, brs: null, claimed: false },
    { tokenId: "3269", svg: "<svg/>", brs: 551, claimed: true },
    { tokenId: "1126", svg: "<svg/>", brs: 630, claimed: true },
    { tokenId: "9", svg: "<svg/>", brs: 630, claimed: true },
  ],
  wearables: [{ itemId: "26", quantity: "1" }],
  verifiedAt: at,
});

test("default gotchi is the highest rarity score, ties to the lowest id, never a portal", () => {
  assert.equal(defaultGotchi(snapshot(0).gotchis).tokenId, "9");
  assert.equal(defaultGotchi([{ tokenId: "1", svg: null, claimed: false }]), null);
  assert.equal(defaultGotchi([]), null);
});

test("decodes only the name from a getAavegotchi tuple", () => {
  const word = (n) => n.toString(16).padStart(64, "0");
  const name = Buffer.from("Coinmandeer").toString("hex").padEnd(64, "0");
  // offset to tuple, tokenId, offset of name inside the tuple, length, bytes
  const hex = "0x" + word(32) + word(1126) + word(64) + word(11) + name;
  assert.equal(decodeGotchiName(hex), "Coinmandeer");
  assert.equal(decodeGotchiName("0x" + word(32) + word(1) + word(64) + word(0)), "");
});

test("first snapshot dresses the explorer; the starter ghost choice is kept", async () => {
  let now = 1_800_000_000_000;
  const db = openDatabase(":memory:");
  try {
    const me = createPlayer(db, "Owner", now);
    db.prepare("INSERT INTO external_links VALUES (?,?,?,?)").run(ADDRESS, me, "{}", 0);
    let reads = 0;
    const sync = createOriginSync(db, { read: async () => (reads++, snapshot(now)), now: () => now });
    await sync.touch(me);
    assert.equal(reads, 1);
    const look = JSON.parse(db.prepare("SELECT appearance FROM players WHERE id=?").get(me).appearance);
    assert.deepEqual(look, { originTokenId: "9", address: ADDRESS, auto: true });
    assert.equal(db.prepare("SELECT verified_at FROM external_links WHERE address=?").get(ADDRESS).verified_at, now);
    // Fresh snapshot: nothing to do; touches are also throttled.
    assert.equal(sync.touch(me), null);
    now += 5 * 60_000;
    await sync.touch(me);
    assert.equal(reads, 2);
    // Explicit starter ghost stays, also after the next refresh.
    db.prepare("UPDATE players SET appearance=? WHERE id=?").run('{"starter":true}', me);
    assert.equal(dressDefault(db, me, ADDRESS, snapshot(now)), null);
    // A failed read keeps the old snapshot and does not throw.
    now += 5 * 60_000;
    const failing = createOriginSync(db, { read: async () => { throw Error("rpc down"); }, now: () => now });
    await failing.touch(me);
    await failing.settle(me, 10);
  } finally {
    db.close();
  }
});
