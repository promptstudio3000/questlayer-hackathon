import {
  generateKeyPairSync,
  createPrivateKey,
  createPublicKey,
  sign,
} from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  statSync,
} from "node:fs";
import { dirname } from "node:path";
import { assert, id } from "../domain.mjs";
import { atomic, history } from "../database.mjs";
import { nearAccountId } from "../identity/near.mjs";
import { NETWORK } from "./network.mjs";
import {
  LEGACY_NATIVE_EDITIONS,
  awardClaimPrefix,
  nativeEditionForName,
} from "../aura-catalog.mjs";
export function awardMessage(contractId, claim) {
  return `QuestLayer Aura claim v1\nContract: ${contractId}\nNetwork: ${NETWORK}\nClaim: ${claim.claim_id}\nReceiver: ${claim.receiver_id}\nEdition: ${claim.edition}\nExpires: ${claim.expires_at}`;
}
export function loadAwardSigner(path) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  if (!existsSync(path)) {
    const pair = generateKeyPairSync("ed25519");
    try {
      writeFileSync(
        path,
        pair.privateKey.export({ type: "pkcs8", format: "pem" }),
        { flag: "wx", mode: 0o600 },
      );
    } catch (e) {
      if (e.code !== "EEXIST") throw e;
    }
  }
  assert(
    (statSync(path).mode & 0o077) === 0,
    "The award signing key must have private file permissions.",
    503,
  );
  const key = createPrivateKey(readFileSync(path)),
    publicKey = createPublicKey(key)
      .export({ type: "spki", format: "der" })
      .subarray(-32)
      .toString("base64");
  return {
    publicKey,
    sign: (message) => sign(null, Buffer.from(message), key).toString("base64"),
  };
}
export class AwardVouchers {
  constructor(
    db,
    native,
    signer,
    { clock = Date.now, ttlMs = 15 * 60000 } = {},
  ) {
    this.db = db;
    this.native = native;
    this.signer = signer;
    this.clock = clock;
    this.ttlMs = ttlMs;
  }
  publicInfo() {
    return {
      network: NETWORK,
      contractId: this.native.contractId,
      publicKey: this.signer.publicKey,
      purpose:
        "Earned Aura attestations; this key is not registered as a NEAR wallet access key.",
    };
  }
  async issue(player, itemId, receiverId) {
    assert(
      typeof itemId === "string" && itemId.length <= 128,
      "Choose an earned Aura.",
    );
    nearAccountId(receiverId);
    const db = this.db;
    assert(
      db
        .prepare(
          "SELECT 1 FROM wallet_links WHERE player_id=? AND account_id=?",
        )
        .get(player, receiverId),
      "Link the NEAR wallet receiving this Aura first.",
      403,
    );
    let key;
    try {
      key = await this.native.view("get_award_signer", {}, true);
    } catch {
      assert(false, "Native Aura claims are temporarily unavailable.", 503);
    }
    assert(
      key === this.signer.publicKey,
      "Native Aura claims are not enabled on this deployment yet.",
      503,
    );
    const item = db
      .prepare(
        "SELECT * FROM inventory WHERE id=? AND player_id=? AND kind='aura'",
      )
      .get(itemId, player);
    assert(item, "Only your own earned Aura can be claimed.", 403);
    const edition = nativeEditionForName(item.name);
    assert(edition, "This item cannot become a native Aura.");
    const old = db
      .prepare("SELECT * FROM native_awards WHERE item_id=?")
      .get(itemId);
    if (old?.state === "minted")
      return { ...old, network: NETWORK, contractId: this.native.contractId };
    if (!old && !LEGACY_NATIVE_EDITIONS.includes(edition)) {
      // Catalog v2 editions need the upgraded contract; never sign a voucher
      // an older deployment would reject.
      let supported = [];
      try {
        supported = await this.native.view("supported_editions", {}, true);
      } catch {
        supported = [];
      }
      assert(
        Array.isArray(supported) && supported.includes(edition),
        "This Aura edition can be secured on NEAR after the next contract upgrade. Keep your demo Aura for now.",
        503,
      );
    }
    if (!old) {
      const minted = await this.native.view(
        "edition_minted",
        { edition },
        true,
      );
      assert(
        minted < 256,
        "This native edition is fully minted. Keep your demo Aura.",
        409,
      );
    }
    const now = this.clock();
    const claim = atomic(db, () => {
      const current = db
        .prepare("SELECT * FROM inventory WHERE id=? AND player_id=?")
        .get(itemId, player);
      assert(current, "This Aura changed owner.", 409);
      assert(
        !db
          .prepare("SELECT 1 FROM listings WHERE item_id=? AND state='open'")
          .get(itemId),
        "Cancel its demo listing before claiming it on NEAR.",
        409,
      );
      const prior = db
        .prepare("SELECT * FROM native_awards WHERE item_id=?")
        .get(itemId);
      assert(
        !prior || prior.receiver_id === receiverId,
        "This claim is reserved for its original NEAR wallet.",
        409,
      );
      if (prior?.state === "minted") return prior;
      if (prior) {
        db.prepare("UPDATE native_awards SET expires_at=? WHERE item_id=?").run(
          Math.max(prior.expires_at, now + this.ttlMs),
          itemId,
        );
      } else
        db.prepare(
          "INSERT INTO native_awards(item_id,claim_id,player_id,receiver_id,edition,state,expires_at,created_at) VALUES(?,?,?,?,?,'issued',?,?)",
        ).run(
          itemId,
          // NPC and monster editions need earned:npc: / earned:monster: on-chain.
          awardClaimPrefix(edition) + id("aura"),
          player,
          receiverId,
          edition,
          now + this.ttlMs,
          now,
        );
      return db
        .prepare("SELECT * FROM native_awards WHERE item_id=?")
        .get(itemId);
    });
    const message = awardMessage(this.native.contractId, claim);
    return {
      ...claim,
      network: NETWORK,
      contractId: this.native.contractId,
      message,
      signature: this.signer.sign(message),
    };
  }
  async confirm(player, itemId) {
    const db = this.db,
      claim = db
        .prepare("SELECT * FROM native_awards WHERE item_id=? AND player_id=?")
        .get(itemId, player);
    assert(claim, "No native claim exists for this Aura.", 404);
    if (claim.state === "minted") return claim;
    const snapshot = await this.native.claimSnapshot(claim.claim_id);
    if (!snapshot.tokenId) return { ...claim, state: "issued" };
    assert(
      snapshot.receiverId === claim.receiver_id &&
        snapshot.edition === claim.edition,
      "The native claim recipient does not match this reward.",
      503,
    );
    const token = await this.native.view(
      "nft_token",
      { token_id: snapshot.tokenId },
      true,
    );
    assert(
      token?.token_id?.startsWith("aura:" + claim.edition + ":"),
      "The native claim token does not match this edition.",
      503,
    );
    atomic(db, () => {
      const current = db
        .prepare("SELECT state FROM native_awards WHERE item_id=?")
        .get(itemId);
      if (current.state === "minted") return;
      db.prepare(
        "UPDATE native_awards SET state='minted',token_id=?,confirmed_at=? WHERE item_id=?",
      ).run(snapshot.tokenId, this.clock(), itemId);
      db.prepare("UPDATE inventory SET equipped=0 WHERE id=?").run(itemId);
      history(db, player, "native-aura", "Aura claimed on NEAR", 0, {
        network: NETWORK,
        tokenId: snapshot.tokenId,
        receiver: claim.receiver_id,
      });
    });
    return db
      .prepare("SELECT * FROM native_awards WHERE item_id=?")
      .get(itemId);
  }
  async restoreDemo(player, itemId) {
    const db = this.db,
      claim = db
        .prepare("SELECT * FROM native_awards WHERE item_id=? AND player_id=?")
        .get(itemId, player);
    assert(
      claim && claim.state === "issued",
      "This Aura is not waiting for a native claim.",
      409,
    );
    const snapshot = await this.native.claimSnapshot(claim.claim_id);
    assert(
      !snapshot.tokenId,
      "This Aura has already minted on NEAR. Check its claim status.",
      409,
    );
    assert(
      snapshot.blockTimestampMs > claim.expires_at,
      "Wait until the claim has expired on a finalized NEAR block.",
      409,
    );
    atomic(db, () => {
      const current = db
        .prepare("SELECT * FROM native_awards WHERE item_id=?")
        .get(itemId);
      assert(
        current?.state === "issued" &&
          current.claim_id === claim.claim_id &&
          current.expires_at === claim.expires_at,
        "The claim was renewed. Refresh its status.",
        409,
      );
      db.prepare("DELETE FROM native_awards WHERE item_id=?").run(itemId);
    });
    return { restored: true };
  }
}
