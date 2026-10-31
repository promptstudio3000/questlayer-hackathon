import test from "node:test";
import assert from "node:assert/strict";
import { createFormDraftStore, formDraftKey } from "../src/form-draft.ts";

test("new observation requirements preserve existing creator text drafts and remain owner scoped", () => {
  const saved = new Map();
  const storage = {
    getItem: (k) => saved.get(k) ?? null,
    setItem: (k, v) => saved.set(k, v),
    removeItem: (k) => saved.delete(k),
  };
  const scope = {
    playerId: "walker",
    form: "creator-quest",
    realm: "demo:quest:river",
  };
  // This is the exact persisted two-field format from before observation support.
  const old = {
    version: 1,
    scope,
    revision: "before-observations",
    updatedAt: 1,
    values: {
      title: "River arch",
      description: "An unfinished story retained before the upgrade.",
    },
  };
  storage.setItem(formDraftKey(scope), JSON.stringify(old));
  const originalRaw = storage.getItem(formDraftKey(scope));
  const oldText = createFormDraftStore({
    scope,
    fields: { title: 100, description: 4000 },
    storage,
  });
  const requirementScope = { ...scope, form: "creator-quest-requirement" };
  const requirement = createFormDraftStore({
    scope: requirementScope,
    fields: { prompt: 500 },
    storage,
  });
  assert.deepEqual(oldText.load().draft.values, old.values);
  assert.equal(requirement.load().draft, null);
  requirement.save({
    prompt: "Describe two contrasting shapes.",
    privateConsent: true,
  });
  assert.equal(storage.getItem(formDraftKey(scope)), originalRaw);
  assert.deepEqual(
    createFormDraftStore({
      scope: requirementScope,
      fields: { prompt: 500 },
      storage,
    }).load().draft.values,
    { prompt: "Describe two contrasting shapes." },
  );
  assert.equal(
    createFormDraftStore({
      scope: { ...requirementScope, playerId: "other" },
      fields: { prompt: 500 },
      storage,
    }).load().draft,
    null,
  );
  assert(!storage.getItem(requirement.key).includes("privateConsent"));
});
