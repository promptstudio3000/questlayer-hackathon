import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, sign, verify } from "node:crypto";
import { openDatabase, createPlayer } from "../server/database.mjs";
import { listItem } from "../server/game.mjs";
import {
  AwardVouchers,
  awardMessage,
  loadAwardSigner,
} from "../server/native/award-vouchers.mjs";
const now = Date.parse("2026-10-31T03:00:00Z");
function setup() {
  const db = openDatabase(":memory:"),
    player = createPlayer(db, "Native Explorer", now),
    pair = generateKeyPairSync("ed25519"),
    publicKey = pair.publicKey
      .export({ type: "spki", format: "der" })
      .subarray(-32)
      .toString("base64");
  db.prepare("INSERT INTO wallet_links VALUES(?,?,?)").run(
    "alice.testnet",
    player,
    now,
  );
  db.prepare("INSERT INTO inventory VALUES(?,?,?,?,?,?,?,?,?,?)").run(
    "aura-test",
    player,
    "aura",
    "Northern Lights",
    "rare",
    "above",
    "#9edfc5",
    1,
    0,
    now,
  );
  let snapshot = { tokenId: null, blockTimestampMs: now },
    minted = 0,
    key = publicKey,
    supported = null;
  const native = {
    contractId: "nfts.project.testnet",
    view: async (method) => {
      if (method === "supported_editions") {
        if (!supported) throw new Error("MethodNotFound");
        return supported;
      }
      return method === "get_award_signer"
        ? key
        : method === "edition_minted"
          ? minted
          : { token_id: "aura:polar:2", owner_id: "bob.testnet" };
    },
    claimSnapshot: async () => snapshot,
  };
  const issuer = {
    publicKey,
    sign: (message) =>
      sign(null, Buffer.from(message), pair.privateKey).toString("base64"),
  };
  const vouchers = new AwardVouchers(db, native, issuer, { clock: () => now });
  return {
    db,
    player,
    pair,
    issuer,
    vouchers,
    native,
    setSnapshot: (v) => (snapshot = v),
    setMinted: (v) => (minted = v),
    setKey: (v) => (key = v),
    setSupported: (v) => (supported = v),
  };
}
test("catalog v2 editions get a voucher only once the deployed contract supports them", async () => {
  const s = setup();
  try {
    s.db.prepare("INSERT INTO inventory VALUES(?,?,?,?,?,?,?,?,?,?)").run(
      "aura-ember",
      s.player,
      "aura",
      "Ember Wisp",
      "common",
      "above",
      "#ff8a4c",
      0,
      1,
      now,
    );
    await assert.rejects(
      s.vouchers.issue(s.player, "aura-ember", "alice.testnet"),
      (e) => e.status === 503 && /next contract upgrade/.test(e.message),
    );
    assert.equal(
      s.db.prepare("SELECT COUNT(*) AS n FROM native_awards").get().n,
      0,
    );
    s.setSupported(["polar", "moon", "gold", "ember"]);
    const claim = await s.vouchers.issue(s.player, "aura-ember", "alice.testnet");
    assert.equal(claim.edition, "ember");
    assert.match(claim.message, /\nEdition: ember\n/);
  } finally {
    s.db.close();
  }
});
test("earned vouchers bind contract, receiver, edition and expiry and lock the demo market", async () => {
  const s = setup();
  try {
    const claim = await s.vouchers.issue(
      s.player,
      "aura-test",
      "alice.testnet",
    );
    assert.equal(claim.state, "issued");
    assert.ok(
      verify(
        null,
        Buffer.from(claim.message),
        s.pair.publicKey,
        Buffer.from(claim.signature, "base64"),
      ),
    );
    assert.equal(
      verify(
        null,
        Buffer.from(claim.message.replace("alice.testnet", "bob.testnet")),
        s.pair.publicKey,
        Buffer.from(claim.signature, "base64"),
      ),
      false,
    );
    const again = await s.vouchers.issue(
      s.player,
      "aura-test",
      "alice.testnet",
    );
    assert.equal(again.claim_id, claim.claim_id);
    assert.equal(
      s.db.prepare("SELECT count(*) AS n FROM native_awards").get().n,
      1,
    );
    assert.throws(
      () => listItem(s.db, s.player, "aura-test", 100),
      /being secured, so it cannot be listed/,
    );
    s.db
      .prepare("INSERT INTO wallet_links VALUES(?,?,?)")
      .run("bob.testnet", s.player, now);
    await assert.rejects(
      s.vouchers.issue(s.player, "aura-test", "bob.testnet"),
      /original NEAR wallet/,
    );
  } finally {
    s.db.close();
  }
});
test("ownership, open listings, signer configuration and full editions prevent issuance", async () => {
  const s = setup();
  try {
    await assert.rejects(
      s.vouchers.issue(s.player, "aura-test", "bob.testnet"),
      /Link/,
    );
    s.setKey(null);
    await assert.rejects(
      s.vouchers.issue(s.player, "aura-test", "alice.testnet"),
      /not enabled/,
    );
    s.setKey(s.issuer.publicKey);
    // Editions are uncapped on chain; only an invalid supply reading blocks.
    s.setMinted(-1);
    await assert.rejects(
      s.vouchers.issue(s.player, "aura-test", "alice.testnet"),
      /fully minted/,
    );
    s.setMinted(0);
    listItem(s.db, s.player, "aura-test", 100);
    await assert.rejects(
      s.vouchers.issue(s.player, "aura-test", "alice.testnet"),
      /Cancel its demo listing/,
    );
    assert.equal(
      s.db.prepare("SELECT count(*) AS n FROM native_awards").get().n,
      0,
    );
  } finally {
    s.db.close();
  }
});
test("confirmed mint is recorded once even after its native NFT transfers", async () => {
  const s = setup();
  try {
    await s.vouchers.issue(s.player, "aura-test", "alice.testnet");
    s.setSnapshot({
      tokenId: "aura:polar:2",
      receiverId: "alice.testnet",
      edition: "polar",
      blockTimestampMs: now,
    });
    const claim = await s.vouchers.confirm(s.player, "aura-test");
    assert.equal(claim.state, "minted");
    await s.vouchers.confirm(s.player, "aura-test");
    assert.equal(
      s.db
        .prepare("SELECT count(*) AS n FROM history WHERE kind='native-aura'")
        .get().n,
      1,
    );
    await assert.rejects(
      s.vouchers.restoreDemo(s.player, "aura-test"),
      /not waiting/,
    );
  } finally {
    s.db.close();
  }
});
test("a claim cannot restore a demo item until a finalized post-expiry block proves no mint", async () => {
  const s = setup();
  try {
    const claim = await s.vouchers.issue(
      s.player,
      "aura-test",
      "alice.testnet",
    );
    s.setSnapshot({ tokenId: null, blockTimestampMs: claim.expires_at });
    await assert.rejects(
      s.vouchers.restoreDemo(s.player, "aura-test"),
      /finalized/,
    );
    s.setSnapshot({
      tokenId: "aura:polar:2",
      blockTimestampMs: claim.expires_at + 1,
    });
    await assert.rejects(
      s.vouchers.restoreDemo(s.player, "aura-test"),
      /already minted/,
    );
    s.setSnapshot({ tokenId: null, blockTimestampMs: claim.expires_at + 1 });
    assert.deepEqual(await s.vouchers.restoreDemo(s.player, "aura-test"), {
      restored: true,
    });
    assert.equal(
      s.db.prepare("SELECT count(*) AS n FROM native_awards").get().n,
      0,
    );
    assert.ok(listItem(s.db, s.player, "aura-test", 100).listing);
  } finally {
    s.db.close();
  }
});
test("claim confirmation rejects a mismatched on-chain recipient", async () => {
  const s = setup();
  try {
    await s.vouchers.issue(s.player, "aura-test", "alice.testnet");
    s.setSnapshot({
      tokenId: "aura:polar:2",
      receiverId: "mallory.testnet",
      edition: "polar",
      blockTimestampMs: now,
    });
    await assert.rejects(
      s.vouchers.confirm(s.player, "aura-test"),
      /recipient/,
    );
    assert.equal(
      s.db.prepare("SELECT state FROM native_awards").get().state,
      "issued",
    );
  } finally {
    s.db.close();
  }
});
test("the application attestation key persists privately without being a wallet access key", async () => {
  const { mkdtempSync, rmSync, chmodSync } = await import("node:fs"),
    { tmpdir } = await import("node:os"),
    { join } = await import("node:path");
  const dir = mkdtempSync(join(tmpdir(), "questlayer-attestor-")),
    path = join(dir, "signer.pem");
  try {
    const a = loadAwardSigner(path),
      b = loadAwardSigner(path);
    assert.equal(a.publicKey, b.publicKey);
    assert.equal(a.sign("proof"), b.sign("proof"));
    assert.equal(Buffer.from(a.publicKey, "base64").length, 32);
    chmodSync(path, 0o644);
    assert.throws(() => loadAwardSigner(path), /private file permissions/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
