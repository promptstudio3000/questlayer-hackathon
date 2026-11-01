import test from "node:test";
import assert from "node:assert/strict";
import {
  assertRecordQuote,
  publishNoteRecord,
  recordView,
} from "../src/note-record.ts";
import { NEAR_NETWORK, SOCIAL_CONTRACT_ID } from "../src/near-network.ts";

const accountId = "explorer-1.testnet";
const noteId = "message_00000000-0000-4000-8000-000000000001";
const mutation = "record_00000000-0000-4000-8000-000000000002";
const record = (state = "published") => ({
  schema: "1",
  note_id: noteId,
  state,
  text: state === "published" ? "Great view" : "",
  lat: state === "published" ? "50.08804" : "",
  lng: state === "published" ? "14.42076" : "",
  anchor: "map",
  author_fix: "",
  image: "",
  image_sha256: "",
  created_at: "1761990000000",
  updated_at: "1761990001000",
  mutation_id: mutation,
});
const quote = (
  kind = "note",
  r = record(kind === "note" ? "published" : "removed"),
) => ({
  network: NEAR_NETWORK,
  receiverId: SOCIAL_CONTRACT_ID,
  accountId,
  methodName: "set",
  gas: "80000000000000",
  deposit: "1",
  kind,
  record: r,
  args: {
    data: { [accountId]: { questlayer: { notes: { [noteId]: { ...r } } } } },
  },
  permanence: "public",
});

test("record quote accepts the exact reviewed note and tombstone", () => {
  assertRecordQuote(quote("note"), { accountId, noteId, kind: "note" });
  assertRecordQuote(quote("tombstone"), {
    accountId,
    noteId,
    kind: "tombstone",
  });
});

test("record quote refuses other namespaces, extra fields and money", () => {
  const extra = quote();
  extra.args.data[accountId].questlayer.profile = {};
  assert.throws(() =>
    assertRecordQuote(extra, { accountId, noteId, kind: "note" }),
  );
  const other = quote();
  other.args.data["someone.testnet"] = other.args.data[accountId];
  assert.throws(() =>
    assertRecordQuote(other, { accountId, noteId, kind: "note" }),
  );
  assert.throws(() =>
    assertRecordQuote(
      { ...quote(), deposit: "1000000000000000000000000" },
      { accountId, noteId, kind: "note" },
    ),
  );
  const changed = quote();
  changed.args.data[accountId].questlayer.notes[noteId].text = "Swapped";
  assert.throws(() =>
    assertRecordQuote(changed, { accountId, noteId, kind: "note" }),
  );
  const leaky = quote("tombstone", {
    ...record("removed"),
    text: "still here",
  });
  assert.throws(() =>
    assertRecordQuote(leaky, { accountId, noteId, kind: "tombstone" }),
  );
  assert.throws(() =>
    assertRecordQuote(quote("note"), { accountId, noteId, kind: "tombstone" }),
  );
});

test("record view maps chain and journal to author states", () => {
  assert.equal(recordView(null), "none");
  assert.equal(recordView({ chain: null, publications: [] }), "none");
  assert.equal(
    recordView({ chain: null, publications: [{ state: "prepared" }] }),
    "pending",
  );
  assert.equal(
    recordView({ chain: record(), publications: [] }, "Great view"),
    "published",
  );
  assert.equal(
    recordView({ chain: record(), publications: [] }, "Edited"),
    "outdated",
  );
  assert.equal(
    recordView({ chain: record("removed"), publications: [] }),
    "removed",
  );
});

test("publish sends the reviewed set once and confirms by mutation id", async () => {
  const calls = [],
    sent = [];
  let confirms = 0;
  const result = await publishNoteRecord({
    call: async (path, body) => {
      calls.push([path, body]);
      if (path.endsWith("/prepare")) return quote();
      confirms++;
      return { confirmed: confirms > 1 };
    },
    signer: {
      kind: "managed",
      accountId,
      send: async (tx) => void sent.push(tx),
    },
    accountId,
    playerId: "player_1",
    noteId,
    kind: "note",
    wait: async () => {},
  });
  assert.deepEqual(result, { confirmed: true, mutationId: mutation });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].receiverId, SOCIAL_CONTRACT_ID);
  assert.equal(sent[0].actions[0].params.deposit, "1");
  assert.equal(calls[0][1].publicConsent, true);
  assert.equal(calls[0][1].permanenceAcknowledged, true);
  assert.equal(calls.at(-1)[1].mutationId, mutation);
});

test("a refused quote is never signed", async () => {
  const sent = [];
  await assert.rejects(
    publishNoteRecord({
      call: async () => ({ ...quote(), receiverId: "evil.testnet" }),
      signer: {
        kind: "managed",
        accountId,
        send: async (tx) => void sent.push(tx),
      },
      accountId,
      playerId: "player_1",
      noteId,
      kind: "note",
      wait: async () => {},
    }),
  );
  assert.equal(sent.length, 0);
});
