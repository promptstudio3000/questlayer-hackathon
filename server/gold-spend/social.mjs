// Place messages on NEAR Social (SocialDB). The author keeps a shout, a topic
// or a post as a public record under their own account, so other NEAR apps
// can read the local feed too. Same flow as map note records
// (server/native/social-records.mjs): the server quotes the exact `set` call,
// the player's own account signs it (relayed for the invisible account), and
// confirm reads the chain back. The record carries a geohash-7 cell (~150 m),
// never the exact position, plus the burn memo that paid for the message.
import { assert, id } from "../domain.mjs";
import { nearAccountId } from "../identity/near.mjs";
import { geohash } from "../chain-ledger/merkle.mjs";
import { NETWORK } from "../native/network.mjs";
import { burnMemo } from "./ledger.mjs";

export const PLACE_RECORD_SCHEMA = "questlayer.place/1";
const MUTATION = /^record_[a-f0-9-]{36}$/;

export function placeRecord(t, { mutationId, postOf = null } = {}) {
  return {
    schema: PLACE_RECORD_SCHEMA,
    kind: postOf ? "post" : t.kind,
    thread: postOf ? postOf : t.id,
    title: postOf ? "" : t.title,
    text: t.text,
    cell: geohash(t.lat, t.lng, 7),
    place: postOf ? "" : t.place || "",
    paid: postOf ? "" : burnMemo(t.kind, t.id),
    created_at: String(t.created_at),
    mutation_id: mutationId,
  };
}

export function createPlaceSocial(db, socialRecords, { now = () => Date.now() } = {}) {
  const enabled = !!socialRecords;
  const read = async (accountId, key, fresh = true) => {
    const value = await socialRecords.reader.view("get", { keys: [`${accountId}/questlayer/places/${key}/**`] }, fresh);
    return value?.[accountId]?.questlayer?.places?.[key] || null;
  };
  const target = (player, targetId) => {
    if (/^post_/.test(targetId || "")) {
      const p = db.prepare("SELECT * FROM place_posts WHERE id=?").get(targetId);
      assert(p && p.author === player && p.state === "published", "Only the author can publish this.", 403, "PLACE_OWNER");
      const t = db.prepare("SELECT lat,lng FROM place_threads WHERE id=?").get(p.thread_id);
      return { key: p.id, row: { ...p, lat: t.lat, lng: t.lng }, postOf: p.thread_id };
    }
    const t = db.prepare("SELECT * FROM place_threads WHERE id=?").get(targetId);
    assert(t && t.author === player && t.state === "published", "Only the author can publish this.", 403, "PLACE_OWNER");
    return { key: t.id, row: t, postOf: null };
  };
  async function prepare(player, accountId, { targetId, publicConsent, permanenceAcknowledged } = {}) {
    assert(enabled, "Public records are not enabled here.", 503, "SOCIAL_DISABLED");
    nearAccountId(accountId);
    assert(publicConsent === true, "Confirm that this record will be public.");
    assert(permanenceAcknowledged === true, "Acknowledge that a public record cannot be fully erased later.");
    const { key, row, postOf } = target(player, targetId);
    const storage = await socialRecords.storage(accountId, true);
    assert(storage.publishEnabled, "Public records are temporarily unavailable.", 503);
    const record = placeRecord(row, { mutationId: id("record"), postOf });
    if (!postOf)
      db.prepare("UPDATE place_threads SET social_account=?,social_mutation=?,social_state='prepared' WHERE id=?").run(accountId, record.mutation_id, key);
    return {
      network: NETWORK,
      receiverId: socialRecords.contractId,
      accountId,
      methodName: "set",
      gas: "80000000000000",
      deposit: storage.deposit,
      key,
      record,
      args: { data: { [accountId]: { questlayer: { places: { [key]: record } } } } },
      permanence: "This writes a public, permanent record under your account on NEAR Social.",
    };
  }
  async function confirm(player, accountId, { targetId, mutationId } = {}) {
    assert(enabled, "Public records are not enabled here.", 503, "SOCIAL_DISABLED");
    nearAccountId(accountId);
    assert(MUTATION.test(mutationId || ""), "Invalid record publication.");
    const { key, postOf } = target(player, targetId);
    const chain = await read(accountId, key);
    const confirmed = !!chain && chain.mutation_id === mutationId;
    if (confirmed && !postOf)
      db.prepare("UPDATE place_threads SET social_state='confirmed',social_account=? WHERE id=? AND social_mutation=?").run(accountId, key, mutationId);
    return { confirmed, chain, at: now() };
  }
  return { enabled, prepare, confirm };
}
