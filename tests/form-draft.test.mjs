import test from "node:test";
import assert from "node:assert/strict";
import { createFormDraftStore, formDraftKey } from "../src/form-draft.ts";
import { createNotePublicationJournal } from "../src/note-publication-journal.ts";

function memoryStorage() {
  const values = new Map();
  return {
    values,
    get length() {
      return values.size;
    },
    key(index) {
      return [...values.keys()][index] ?? null;
    },
    getItem(key) {
      return values.get(key) ?? null;
    },
    setItem(key, value) {
      values.set(key, value);
    },
    removeItem(key) {
      values.delete(key);
    },
  };
}
const scope = { playerId: "explorer-a", form: "map-note", realm: "arena" };
const fields = { text: 500 };
function fixture(storage = memoryStorage(), chosenScope = scope) {
  let revision = 0;
  return {
    storage,
    store: createFormDraftStore({
      scope: chosenScope,
      fields,
      storage,
      clock: () => 1000,
      newRevision: () => `revision-${++revision}`,
    }),
  };
}

test("text draft survives a new store instance, copying only explicitly allowed strings", () => {
  const { store, storage } = fixture();
  const saved = store.save({
    text: "Public path beside the river",
    publicConsent: true,
    shareGps: true,
    fix: { lat: 49, lng: 13 },
    image: "private-photo",
    clientId: "operation",
  });
  assert.equal(saved.revision, "revision-1");
  const restored = fixture(storage).store.load();
  assert.deepEqual(restored.draft.values, {
    text: "Public path beside the river",
  });
  const raw = storage.getItem(store.key);
  for (const forbidden of [
    "publicConsent",
    "shareGps",
    "fix",
    "private-photo",
    "clientId",
  ])
    assert(!raw.includes(forbidden));
});

test("player, realm and form boundaries never restore another draft", () => {
  const { store, storage } = fixture();
  store.save({ text: "My retained note" });
  for (const change of [
    { playerId: "explorer-b" },
    { realm: "physical" },
    { form: "creator-profile" },
  ]) {
    assert.equal(
      fixture(storage, { ...scope, ...change }).store.load().draft,
      null,
    );
    assert.notEqual(formDraftKey({ ...scope, ...change }), store.key);
  }
});

test("corrupt, future-schema, wrong-scope and overlong draft data are not trusted", () => {
  const { store, storage } = fixture();
  const valid = store.save({ text: "A saved note" });
  const raw = JSON.parse(storage.getItem(store.key));
  for (const bad of [
    "{",
    "null",
    "[]",
    "x".repeat(65537),
    JSON.stringify({ ...raw, version: 99 }),
    JSON.stringify({ ...raw, scope: { ...scope, realm: "physical" } }),
    JSON.stringify({ ...raw, values: { text: "x".repeat(501) } }),
    JSON.stringify({ ...raw, values: { text: 1 } }),
  ]) {
    storage.setItem(store.key, bad);
    assert.equal(store.load().draft, null);
  }
  assert(valid);
  assert.equal(store.save({ text: "x".repeat(501) }), null);
});

test("a completion for an old revision cannot erase a more recent draft", () => {
  const { store } = fixture();
  const submitted = store.save({ text: "Submitted note" });
  const newer = store.save({ text: "Another idea typed later" });
  assert.equal(store.remove(submitted.revision), false);
  assert.equal(store.load().draft.revision, newer.revision);
  assert.equal(store.remove(newer.revision), true);
  assert.equal(store.load().draft, null);
});

test("storage failure is explicit and does not falsely claim a durable save", () => {
  const denied = {
    getItem() {
      throw Error("blocked");
    },
    setItem() {
      throw Error("quota");
    },
    removeItem() {
      throw Error("blocked");
    },
  };
  const { store } = fixture(denied);
  assert.deepEqual(store.load(), { draft: null, available: false });
  assert.equal(store.save({ text: "Retain this in memory" }), null);
  assert.equal(store.remove(), false);
  assert.equal(fixture(null).store.save({ text: "No storage" }), null);
});

test("draft fields require an explicit bounded schema and a nonempty scope", () => {
  assert.throws(
    () => createFormDraftStore({ scope, fields: { text: 0 }, storage: null }),
    /bounded/,
  );
  assert.throws(
    () =>
      createFormDraftStore({
        scope: { ...scope, playerId: "" },
        fields,
        storage: null,
      }),
    /scope/,
  );
});

test("publication journal survives reload with only the operation identity and draft revision", () => {
  const storage = memoryStorage();
  createNotePublicationJournal("explorer-a", true, storage).remember(
    "operation-a",
    "revision-a",
  );
  const intent = createNotePublicationJournal(
    "explorer-a",
    true,
    storage,
  ).loadFirst();
  assert.deepEqual(intent, {
    clientId: "operation-a",
    draftRevision: "revision-a",
  });
  assert.equal(
    createNotePublicationJournal("explorer-a", false, storage).loadFirst(),
    null,
  );
  assert.equal(
    createNotePublicationJournal("explorer-b", true, storage).loadFirst(),
    null,
  );
  assert.equal(storage.values.size, 1);
});

test("concurrent operation identities remain recoverable instead of replacing unknown outcomes", () => {
  const storage = memoryStorage();
  const journal = createNotePublicationJournal("explorer-a", true, storage);
  journal.remember("operation-a", "revision-a");
  journal.remember("operation-b", "revision-b");
  const first = journal.loadFirst();
  journal.clear(first.clientId);
  const second = journal.loadFirst();
  assert(second);
  assert.notEqual(second.clientId, first.clientId);
  journal.clear(second.clientId);
  assert.equal(journal.loadFirst(), null);
});

test("journal corruption cannot fabricate a receipt and blocked storage prevents a new send intent", () => {
  const storage = memoryStorage();
  const journal = createNotePublicationJournal("explorer-a", true, storage);
  journal.remember("operation-a", null);
  const key = [...storage.values.keys()][0];
  storage.setItem(
    key,
    JSON.stringify({
      version: 2,
      clientId: "other-operation",
      draftRevision: null,
      createdAt: 1000,
      state: "published",
    }),
  );
  assert.equal(journal.loadFirst(), null);
  journal.remember("operation-a", "revision-a");
  assert.deepEqual(journal.loadFirst(), {
    clientId: "operation-a",
    draftRevision: "revision-a",
  });
  const denied = {
    get length() {
      throw Error("blocked");
    },
    key() {
      return null;
    },
    getItem() {
      throw Error("blocked");
    },
    setItem() {
      throw Error("quota");
    },
    removeItem() {
      throw Error("blocked");
    },
  };
  assert.equal(
    createNotePublicationJournal("explorer-a", true, denied).loadFirst(),
    null,
  );
  assert.throws(
    () =>
      createNotePublicationJournal("explorer-a", true, denied).remember(
        "operation-a",
        null,
      ),
    /quota/,
  );
});
