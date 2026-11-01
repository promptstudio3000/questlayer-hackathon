import test from "node:test";
import assert from "node:assert/strict";
import {
  INSTALL_CHOICE_KEY,
  installOfferKind,
  isIosDevice,
  isNewerRelease,
  isPhoneLike,
  readInstallChoice,
  releaseSignature,
  rememberInstallChoice,
} from "../src/pwa-state.ts";

function memoryStorage() {
  const data = new Map();
  return {
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => data.set(key, String(value)),
  };
}
const throwing = {
  getItem() {
    throw new Error("blocked");
  },
  setItem() {
    throw new Error("blocked");
  },
};

test("a dismissal is remembered and blocked storage never throws", () => {
  const storage = memoryStorage();
  assert.equal(readInstallChoice(storage), null);
  rememberInstallChoice(storage, "dismissed");
  assert.equal(storage.getItem(INSTALL_CHOICE_KEY), "dismissed");
  assert.equal(readInstallChoice(storage), "dismissed");
  storage.setItem(INSTALL_CHOICE_KEY, "something-else");
  assert.equal(readInstallChoice(storage), null);
  assert.doesNotThrow(() => rememberInstallChoice(throwing, "installed"));
  assert.equal(readInstallChoice(throwing), null);
  assert.equal(readInstallChoice(null), null);
});

test("the install offer never returns after a choice or inside the installed app", () => {
  const base = { standalone: false, choice: null, hasPrompt: true, ios: false };
  assert.equal(installOfferKind(base), "prompt");
  assert.equal(installOfferKind({ ...base, choice: "dismissed" }), null);
  assert.equal(installOfferKind({ ...base, choice: "installed" }), null);
  assert.equal(installOfferKind({ ...base, standalone: true }), null);
  assert.equal(installOfferKind({ ...base, hasPrompt: false }), null);
  assert.equal(
    installOfferKind({ ...base, hasPrompt: false, ios: true }),
    "ios",
  );
  assert.equal(
    installOfferKind({
      ...base,
      hasPrompt: false,
      ios: true,
      choice: "dismissed",
    }),
    null,
  );
});

test("iOS guidance targets iPhone and iPadOS, not Android or desktop", () => {
  const iphone =
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
  const android =
    "Mozilla/5.0 (Linux; Android 15; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36";
  const mac =
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15";
  assert.equal(isIosDevice(iphone), true);
  assert.equal(isIosDevice(android, "Linux armv8l", 5), false);
  assert.equal(isIosDevice(mac, "MacIntel", 0), false);
  assert.equal(isIosDevice(mac, "MacIntel", 5), true); // iPadOS desktop mode
  assert.equal(isPhoneLike(android, false), true);
  assert.equal(isPhoneLike(mac, false), false);
});

test("a release is newer only when the served shell references other assets", () => {
  const built = `<!doctype html><html><head><title>QuestLayer</title>
  <script type="module" crossorigin src="/assets/index-DF_bFAFy.js"></script>
  <link rel="modulepreload" crossorigin href="/assets/rolldown-runtime-WkwZ5CU-.js">
  <link rel="stylesheet" crossorigin href="/assets/index-C5za-zNu.css">
  <link rel="icon" href="/icon.svg"></head><body></body></html>`;
  const signature = releaseSignature(built);
  assert.equal(
    signature,
    "/assets/index-C5za-zNu.css /assets/index-DF_bFAFy.js",
  );
  // The live document serialises boolean attributes differently.
  const live = built.replaceAll("crossorigin ", 'crossorigin="" ');
  assert.equal(releaseSignature(live), signature);
  const next = built.replace("index-C5za-zNu.css", "index-Zz9Yy8Xx.css");
  assert.equal(isNewerRelease(signature, releaseSignature(next)), true);
  assert.equal(isNewerRelease(signature, signature), false);
  // Development shells and failed fetches never produce a notice.
  assert.equal(
    releaseSignature('<script type="module" src="/src/main.tsx"></script>'),
    null,
  );
  assert.equal(isNewerRelease(signature, null), false);
  assert.equal(isNewerRelease(null, signature), false);
});
