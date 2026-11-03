import test from "node:test";
import assert from "node:assert/strict";
import { dictionaries, untranslatedJsx, usedKeys } from "../scripts/i18n-keys.mjs";
import { lang, tr } from "../src/i18n.ts";

const placeholders = (text) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

test("English is the default and untranslated text stays English", () => {
  assert.equal(lang, "en");
  assert.equal(tr("Explore"), "Explore");
  assert.equal(tr("Stop {0} of {1} confirmed.", { 0: 2, 1: 5 }), "Stop 2 of 5 confirmed.");
});

test("every dictionary keeps the placeholders of its English keys", () => {
  for (const { id, entries } of dictionaries()) {
    for (const [english, translated] of Object.entries(entries)) {
      assert.equal(typeof translated, "string", `${id}: ${english}`);
      assert.ok(translated.trim(), `${id}: empty translation for ${english}`);
      assert.deepEqual(placeholders(translated), placeholders(english), `${id}: ${english}`);
    }
  }
});

test("dictionaries only hold strings the app still uses", () => {
  const used = new Set(usedKeys());
  for (const { id, entries } of dictionaries()) {
    const unused = Object.keys(entries).filter((key) => !used.has(key));
    assert.deepEqual(unused, [], `${id} has unused keys`);
  }
});

test("every language translates every English string", () => {
  const keys = usedKeys();
  for (const { id, entries } of dictionaries()) {
    const missing = keys.filter((key) => !(key in entries));
    assert.deepEqual(missing, [], `${id} is missing ${missing.length} strings (npm run i18n:keys)`);
  }
});

test("text players read goes through tr()", () => {
  assert.deepEqual(untranslatedJsx(), [], "wrap these in tr() and add them to every dictionary");
});
