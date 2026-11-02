import test from "node:test";
import assert from "node:assert/strict";
import {
  createAppNavigationHistory,
  initialAppNavigation,
  parseAppNavigation,
  NAVIGATION_STATE_KEY,
} from "../src/app-navigation.ts";

class FakeHistory {
  constructor(state = {}) {
    this.entries = [structuredClone(state)];
    this.index = 0;
    this.writes = [];
    this.fail = null;
  }
  get state() {
    return this.entries[this.index];
  }
  replaceState(state, title) {
    if (this.fail === "replace")
      throw new DOMException("History unavailable", "SecurityError");
    this.entries[this.index] = structuredClone(state);
    this.writes.push({ method: "replace", title });
  }
  pushState(state, title) {
    if (this.fail === "push")
      throw new DOMException("History quota reached", "SecurityError");
    this.entries.splice(this.index + 1);
    this.entries.push(structuredClone(state));
    this.index++;
    this.writes.push({ method: "push", title });
  }
  back() {
    if (this.index > 0) this.index--;
  }
  forward() {
    if (this.index + 1 < this.entries.length) this.index++;
  }
}
const nav = (patch) => ({ ...initialAppNavigation(), ...patch });
const entry = (history) => history.state[NAVIGATION_STATE_KEY];
const fixture = (state) => {
  const history = new FakeHistory(state),
    journal = createAppNavigationHistory(history, "player-a", () => "qa-root");
  return { history, journal };
};
const native = () => ({
  version: 1,
  network: "testnet",
  playerId: "player-a",
  accountId: "alice.testnet",
  contractId: "rewards.testnet",
  dayId: "published-day",
  manifestHash: "published-hash",
  kind: "quest",
  index: 2,
});

test("initial root replaces rather than traps browser Back and preserves external wallet state", () => {
  const external = {
    walletConnector: { requestId: "external-opaque-value" },
    externalRoute: "return",
  };
  const { history, journal } = fixture(external);
  assert.equal(journal.initial, null);
  assert.equal(journal.write(nav()), true);
  assert.equal(history.entries.length, 1);
  assert.equal(entry(history).depth, 0);
  assert.equal(entry(history).rootId, "qa-root");
  assert.deepEqual(history.state.walletConnector, external.walletConnector);
  assert.equal(history.state.externalRoute, "return");
  assert.deepEqual(history.writes, [{ method: "replace", title: "" }]);
});

test("multiple navigation writes use one root, stable depths and deduplicate identical state", () => {
  const { history, journal } = fixture();
  journal.write(nav());
  journal.write(nav({ tab: "inventory" }));
  journal.write(nav({ tab: "inventory" }));
  journal.write(nav({ tab: "market" }));
  assert.equal(history.entries.length, 3);
  assert.deepEqual(
    history.entries.map((e) => e[NAVIGATION_STATE_KEY].depth),
    [0, 1, 2],
  );
  assert.deepEqual(
    history.entries.map((e) => e[NAVIGATION_STATE_KEY].rootId),
    ["qa-root", "qa-root", "qa-root"],
  );
  journal.write(nav({ tab: "market", sheetExpanded: true }), "replace");
  assert.equal(history.entries.length, 3);
  assert.equal(entry(history).depth, 2);
  assert.equal(entry(history).value.sheetExpanded, true);
});

test("Back/Forward restores screens and safe target identity without replaying actions or consent", () => {
  const { history, journal } = fixture();
  const demoTarget = {
    worldId: "demo-day",
    zoneId: "park",
    questId: "chest",
    realm: "arena",
  };
  journal.write(nav({ demoTarget }));
  journal.write(
    nav({
      tab: "community",
      creatorView: { page: "edit", questId: "my-quest" },
      demoTarget,
    }),
  );
  journal.write(nav({ tab: "wallet", walletView: "staking", demoTarget }));
  history.back();
  const restored = journal.restore(history.state);
  assert.equal(restored.tab, "community");
  assert.deepEqual(restored.creatorView, { page: "edit", questId: "my-quest" });
  assert.deepEqual(restored.demoTarget, demoTarget);
  history.forward();
  assert.equal(journal.restore(history.state).walletView, "staking");
  assert.equal(
    journal.write(nav({ tab: "wallet", walletView: "staking", demoTarget })),
    true,
  );
  assert.equal(history.entries.length, 3);
});

test("reload restores the same actor but cross-actor and malformed entries reset presentation safely", () => {
  const { history, journal } = fixture();
  journal.write(nav());
  journal.write(nav({ tab: "messages", notesView: "compose" }));
  assert.equal(
    createAppNavigationHistory(history, "player-a", () => "new").initial
      .notesView,
    "compose",
  );
  const other = createAppNavigationHistory(
    history,
    "player-b",
    () => "new-owner-root",
  );
  assert.equal(other.initial, null);
  assert.equal(other.restore(history.state).tab, "explore");
  other.write(nav());
  assert.equal(entry(history).playerId, "player-b");
  for (const bad of [
    null,
    [],
    {},
    { [NAVIGATION_STATE_KEY]: { ...entry(history), playerId: "player-a" } },
    ...[-1, 1.5, 1001].map((depth) => ({
      [NAVIGATION_STATE_KEY]: { ...entry(history), depth },
    })),
  ]) {
    assert.equal(other.restore(bad).tab, "explore");
  }
  const valid = { ...entry(history), value: nav({ tab: "inventory" }) };
  const array = [];
  array[NAVIGATION_STATE_KEY] = valid;
  for (const raw of [
    Object.create({ [NAVIGATION_STATE_KEY]: valid }),
    array,
    ...[{ version: 2 }, { rootId: "" }, { rootId: "x".repeat(513) }].map(
      (patch) => ({ [NAVIGATION_STATE_KEY]: { ...valid, ...patch } }),
    ),
  ]) {
    // Exercise parsing directly: structuredClone itself strips inherited fields.
    const forged = new FakeHistory();
    forged.entries[0] = raw;
    assert.equal(
      createAppNavigationHistory(forged, "player-b", () => "clean-root")
        .initial,
      null,
    );
  }
});

test("navigation parser refuses coercing enum objects without executing coercion", () => {
  let calls = 0;
  for (const [field, value] of [
    ["tab", "inventory"],
    ["walletView", "demo"],
    ["taskRealm", "near"],
    ["notesView", "compose"],
  ]) {
    assert.equal(
      parseAppNavigation(
        nav({
          [field]: {
            toString() {
              calls++;
              return value;
            },
          },
        }),
        "player-a",
      ),
      null,
    );
    assert.equal(
      parseAppNavigation(nav({ [field]: new String(value) }), "player-a"),
      null,
    );
  }
  assert.equal(
    parseAppNavigation(
      nav({ creatorView: { page: new String("profile") } }),
      "player-a",
    ),
    null,
  );
  assert.equal(calls, 0);
});

test("history stores only presentation and IDs, never draft content, GPS, settlement or accepted consent", () => {
  let replayed = 0;
  const input = nav({
    tab: "messages",
    notesView: "compose",
    consent: true,
    gps: { lat: 49, lng: 13 },
    draft: "private draft text",
    operationId: "never-replay",
    balance: 999999,
    onRestore() {
      replayed++;
    },
  });
  const parsed = parseAppNavigation(input, "player-a");
  assert.equal(parsed.notesView, "compose");
  for (const key of [
    "consent",
    "gps",
    "draft",
    "operationId",
    "balance",
    "onRestore",
  ])
    assert.equal(Object.hasOwn(parsed, key), false);
  const { history, journal } = fixture({
    walletConnector: { opaque: "preserve" },
  });
  journal.write(input);
  journal.restore(history.state);
  assert.equal(replayed, 0);
  assert(!JSON.stringify(entry(history)).includes("private draft text"));
  assert.deepEqual(history.state.walletConnector, { opaque: "preserve" });
});

test("native history IDs remain account/day/hash-bound and strip saved coordinates, rewards and checkpoints", () => {
  const n = native();
  const parsed = parseAppNavigation(
    nav({
      nativeTarget: { ...n, lat: 0, lng: 0, reward: "999", checkpoint: 100 },
    }),
    "player-a",
  );
  assert.deepEqual(parsed.nativeTarget, n);
  assert.equal(
    parseAppNavigation(
      nav({ nativeTarget: { ...n, playerId: "player-b" } }),
      "player-a",
    ),
    null,
  );
  assert.equal(
    parseAppNavigation(
      nav({ nativeTarget: { ...n, network: "mainnet" } }),
      "player-a",
    ),
    null,
  );
  assert.equal(
    parseAppNavigation(nav({ nativeTarget: { ...n, index: -1 } }), "player-a"),
    null,
  );
  assert.equal(
    parseAppNavigation(
      nav({ nativeTarget: { ...n, manifestHash: "" } }),
      "player-a",
    ),
    null,
  );
});

test("structured-clone cyclic metadata is ignored or rejected without crashing popstate parsing", () => {
  const extra = {};
  extra.self = extra;
  const n = { ...native(), extra };
  assert.deepEqual(
    parseAppNavigation(nav({ nativeTarget: n }), "player-a").nativeTarget,
    native(),
  );
  assert.equal(
    parseAppNavigation(
      nav({ nativeTarget: { ...native(), contractId: extra } }),
      "player-a",
    ),
    null,
  );
  assert.equal(
    parseAppNavigation(
      nav({ nativeTarget: { ...native(), contractId: 1n } }),
      "player-a",
    ),
    null,
  );
});

test("creator route parsing accepts current presentation states and refuses unsupported/private data", () => {
  for (const creatorView of [
    { page: "following" },
    { page: "participations" },
    { page: "edit", questId: null },
    { page: "edit", questId: "quest:1" },
    { page: "quest", questId: "quest:1" },
    { page: "creator", creatorId: "creator:1" },
  ])
    assert.deepEqual(
      parseAppNavigation(nav({ creatorView }), "player-a").creatorView,
      creatorView,
    );
  for (const creatorView of [
    { page: "review" },
    { page: "profile", publicConsent: true },
    { page: "edit", questId: "../../private" },
    { page: "quest", questId: "quest", paidAnswer: "secret" },
  ])
    assert.equal(parseAppNavigation(nav({ creatorView }), "player-a"), null);
});

test("a normal modal close can append its chosen destination while preserving Explore as the prior root", () => {
  const { history, journal } = fixture({
    walletConnector: { callback: "opaque" },
  });
  journal.write(nav());
  history.pushState(
    { ...history.state, questlayerDialogV1: "modal-token" },
    "",
  );
  // Hook holds persistence while a dialog/normal-close traversal owns history.
  const latest = nav({ tab: "inventory" });
  history.back();
  const base = journal.restore(history.state);
  assert.equal(base.tab, "explore");
  journal.write(latest, "push");
  assert.equal(history.entries.length, 2);
  assert.equal(entry(history).depth, 1);
  assert.equal(history.state.questlayerDialogV1, undefined);
  assert.deepEqual(history.state.walletConnector, { callback: "opaque" });
  history.back();
  assert.equal(journal.restore(history.state).tab, "explore");
  history.forward();
  assert.equal(journal.restore(history.state).tab, "inventory");
});

test("blocked history writes retain the last durable depth/signature and can retry without crashing navigation", () => {
  const { history, journal } = fixture({ walletConnector: { id: "external" } });
  history.fail = "replace";
  assert.equal(journal.write(nav()), false);
  assert.equal(history.entries.length, 1);
  assert.equal(history.state[NAVIGATION_STATE_KEY], undefined);
  history.fail = null;
  assert.equal(journal.write(nav()), true);
  history.fail = "push";
  assert.equal(journal.write(nav({ tab: "inventory" })), false);
  assert.equal(entry(history).depth, 0);
  assert.equal(entry(history).value.tab, "explore");
  history.fail = null;
  assert.equal(journal.write(nav({ tab: "inventory" })), true);
  assert.equal(entry(history).depth, 1);
  assert.equal(history.entries.length, 2);
  assert.deepEqual(history.state.walletConnector, { id: "external" });
});

test("history depth is bounded by replacement without trapping or dropping external state", () => {
  const { history, journal } = fixture({ walletConnector: "preserve" });
  journal.write(nav());
  const full = structuredClone(history.state);
  full[NAVIGATION_STATE_KEY].depth = 1000;
  journal.restore(full);
  history.replaceState(full, "");
  journal.write(nav({ tab: "settings" }));
  assert.equal(entry(history).depth, 1000);
  assert.equal(history.entries.length, 1);
  assert.equal(history.state.walletConnector, "preserve");
});

test("screen sub-tabs persist, and entries stored before sub-tabs existed still restore", () => {
  const { history, journal } = fixture();
  journal.write(nav({ tab: "settings", profileView: "settings" }));
  journal.write(nav({ tab: "market", marketView: "offers" }));
  history.back();
  assert.equal(journal.restore(history.state).profileView, "settings");
  history.forward();
  assert.equal(journal.restore(history.state).marketView, "offers");

  const legacy = { ...initialAppNavigation(), tab: "market" };
  delete legacy.profileView;
  delete legacy.marketView;
  const parsed = parseAppNavigation(legacy, "player-a");
  assert.equal(parsed.tab, "market");
  assert.equal(parsed.profileView, "character");
  assert.equal(parsed.marketView, "practice");
  const old = fixture({
    [NAVIGATION_STATE_KEY]: {
      version: 1,
      playerId: "player-a",
      rootId: "old-root",
      depth: 0,
      value: legacy,
    },
  });
  assert.equal(old.journal.initial.tab, "market");
  assert.equal(old.journal.initial.marketView, "practice");

  for (const patch of [
    { profileView: "wallet" },
    { profileView: 1 },
    { marketView: "auction" },
    { marketView: null },
  ])
    assert.equal(parseAppNavigation(nav(patch), "player-a"), null);
});
