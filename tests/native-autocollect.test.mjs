import test from "node:test";
import assert from "node:assert/strict";
import { createNativeAutoCollector } from "../src/native-autocollect.ts";

const deferred = () => {
  let resolve, reject;
  const promise = new Promise((a, b) => {
    resolve = a;
    reject = b;
  });
  return { promise, resolve, reject };
};
const memoryStorage = () => {
  const values = new Map();
  return {
    values,
    getItem: (key) => values.get(key) || null,
    setItem: (key, value) => values.set(key, value),
  };
};
const rejection = (status, code) =>
  Object.assign(Error(code), { status, code });
const receipt = (request, state = "queued", extra = {}) => ({
  id: `native:${request.accountId}:${request.dayId}:${request.index}`,
  accountId: request.accountId,
  dayId: request.dayId,
  kind: "coin",
  index: request.index,
  state,
  amount: state === "confirmed" ? "999999999999999999999999" : null,
  xp: state === "confirmed" ? 2 : null,
  transaction: state === "confirmed" ? "transaction" : null,
  createdAt: 0,
  error: null,
  ...extra,
});
function fixture(options = {}) {
  let now = Date.UTC(2026, 9, 31, 12),
    refreshes = 0;
  const storage =
    options.storage === undefined ? memoryStorage() : options.storage;
  const calls = [],
    feedback = [];
  let context = {
    playerId: "player-1",
    accountId: "alice.testnet",
    linked: true,
    nativeMode: true,
    active: true,
    arena: false,
    visible: true,
    online: true,
    fix: { lat: 49.74713, lng: 13.377, accuracy: 10, timestamp: now },
    state: {
      status: "ready",
      network: "testnet",
      accountId: "alice.testnet",
      contractId: "game.testnet",
      generatedAt: now,
      enrolled: true,
      balance: { credit: "0", pending: "0", withdrawn: "0", xp: 0 },
      collection: {
        available: true,
        paused: false,
        coinsAcceptedToday: 0,
        pendingCoinsToday: 0,
        coinLimit: 100,
        minimumIntervalMs: 3000,
      },
      day: {
        id: "day-1",
        startsAt: now - 1000,
        endsAt: now + 86400000,
        claimsAccepted: 0,
        claimsLimit: 256,
        coins: Array.from({ length: 12 }, (_, index) => ({
          index,
          lat: 49.74713 + index * 0.000003,
          lng: 13.377,
          distance: 99999,
        })),
      },
      receipts: [],
    },
  };
  const controller = createNativeAutoCollector({
    storage,
    clock: () => now,
    submit: (request) => {
      calls.push(structuredClone(request));
      return options.submit
        ? options.submit(request)
        : Promise.resolve(receipt(request));
    },
    refresh: async () => {
      refreshes++;
    },
    onConfirmed: (delta) => feedback.push(delta),
  });
  controller.update(context);
  return {
    controller,
    calls,
    feedback,
    storage,
    context: () => context,
    refreshes: () => refreshes,
    update(patch = {}) {
      context = { ...context, ...patch };
      controller.update(context);
    },
    observe(patch = {}) {
      context = {
        ...context,
        state: { ...context.state, ...patch, generatedAt: now },
      };
      controller.update(context);
    },
    advance(ms, fresh = true) {
      now += ms;
      if (fresh) {
        context = {
          ...context,
          fix: { ...context.fix, timestamp: now },
          state: context.state && { ...context.state, generatedAt: now },
        };
        controller.update(context);
      }
    },
    enable() {
      controller.setEnabled(true);
    },
    view: () => controller.getView(),
    tick: () => controller.tick(),
  };
}

test("wallet linking and valid GPS never opt a player into automatic collection", async () => {
  const f = fixture();
  await f.tick();
  assert.equal(f.calls.length, 0);
  assert.equal(f.view().status, "off");
  f.enable();
  await f.tick();
  assert.equal(f.calls.length, 1);
  assert.equal(f.view().pending, 1);
  assert.deepEqual(f.feedback, []);
  assert.deepEqual(f.view().confirmed, { count: 0, amount: "0", xp: 0 });
});

for (const [name, patch, expected] of [
  ["hidden tab", { visible: false }, "hidden"],
  ["offline", { online: false }, "offline"],
  ["other application surface", { active: false }, "inactive"],
  ["demo mode", { nativeMode: false }, "inactive"],
  ["arena coordinates", { arena: true }, "gps_required"],
  ["unlinked account", { linked: false }, "wallet"],
  ["missing GPS", { fix: null }, "gps_required"],
])
  test(`${name} stops submissions without silently re-enabling later`, async () => {
    const f = fixture();
    f.enable();
    f.update(patch);
    await f.tick();
    assert.equal(f.calls.length, 0);
    assert.equal(f.view().status, expected);
  });

test("only fresh finite accurate GPS and locally measured proximity permit a visit", async () => {
  for (const [changes, expected] of [
    [{ accuracy: 35.001 }, "gps_inaccurate"],
    [{ accuracy: -1 }, "gps_inaccurate"],
    [{ accuracy: NaN }, "gps_inaccurate"],
    [{ timestamp: 0 }, "gps_stale"],
    [{ timestamp: Infinity }, "gps_stale"],
    [{ lat: NaN }, "gps_required"],
    [{ lat: 49.8 }, "walking"],
  ]) {
    const f = fixture();
    f.enable();
    f.update({ fix: { ...f.context().fix, ...changes } });
    await f.tick();
    assert.equal(f.calls.length, 0);
    assert.equal(f.view().status, expected);
  }
  const stale = fixture();
  stale.enable();
  stale.advance(15001, false);
  await stale.tick();
  assert.equal(stale.view().status, "gps_stale");
  const future = fixture();
  future.enable();
  future.update({
    fix: {
      ...future.context().fix,
      timestamp: future.context().fix.timestamp + 2001,
    },
  });
  await future.tick();
  assert.equal(future.view().status, "gps_stale");
  const exact = fixture();
  exact.enable();
  exact.update({ fix: { ...exact.context().fix, accuracy: 35 } });
  await exact.tick();
  assert.equal(
    exact.calls.length,
    1,
    "The server distance hint is ignored; coordinates are authoritative for proximity",
  );
});

test("unknown, stale, mismatched or unbacked observations never masquerade as available", async () => {
  for (const patch of [
    { collection: undefined },
    { collection: { available: true } },
    { network: "mainnet" },
    { accountId: "bob.testnet" },
    { enrolled: false },
    { collection: { available: false } },
    { status: "preparing" },
  ]) {
    const f = fixture();
    f.enable();
    f.observe(patch);
    await f.tick();
    assert.equal(f.calls.length, 0);
  }
  const f = fixture();
  f.enable();
  f.advance(30001, false);
  f.update({
    fix: { ...f.context().fix, timestamp: f.context().fix.timestamp + 30001 },
  });
  await f.tick();
  assert.equal(f.view().status, "loading");
  assert.equal(f.calls.length, 0);
});

test("one in-flight request, three-second pacing and three-pending backpressure bound walking", async () => {
  const first = deferred();
  let initial = true;
  const f = fixture({
    submit: (request) => {
      if (initial) {
        initial = false;
        return first.promise;
      }
      return Promise.resolve(receipt(request));
    },
  });
  f.enable();
  const running = f.tick();
  for (let n = 0; n < 10; n++) await f.tick();
  assert.equal(f.calls.length, 1);
  first.resolve(receipt(f.calls[0]));
  await running;
  f.advance(2999);
  await f.tick();
  assert.equal(f.calls.length, 1);
  f.advance(1);
  await f.tick();
  f.advance(3000);
  await f.tick();
  f.advance(3000);
  await f.tick();
  assert.equal(f.calls.length, 3);
  assert.equal(f.view().status, "pending");
  assert.deepEqual(
    f.calls.map((r) => r.index),
    [0, 1, 2],
  );
});

test("day/account capacity and global pause stop before any request", async () => {
  for (const [change, expected] of [
    [{ day: { claimsAccepted: 256 } }, "day_limit"],
    [{ collection: { coinsAcceptedToday: 100 } }, "account_limit"],
    [{ collection: { paused: true } }, "paused"],
    [{ collection: { pendingCoinsToday: 3 } }, "pending"],
  ]) {
    const f = fixture();
    f.enable();
    f.observe({
      ...(change.day
        ? { day: { ...f.context().state.day, ...change.day } }
        : {}),
      ...(change.collection
        ? {
            collection: {
              ...f.context().state.collection,
              ...change.collection,
            },
          }
        : {}),
    });
    await f.tick();
    assert.equal(f.calls.length, 0);
    assert.equal(f.view().status, expected);
  }
});

test("accepted receipts stay pending; only exact confirmed amounts coalesce once", async () => {
  const f = fixture();
  f.enable();
  await f.tick();
  f.advance(3000);
  await f.tick();
  assert.equal(f.feedback.length, 0);
  const confirmed = f.calls.map((r) => receipt(r, "confirmed"));
  f.observe({ receipts: confirmed });
  assert.equal(f.feedback.length, 0);
  f.advance(2000);
  assert.equal(f.feedback.length, 1);
  assert.deepEqual(f.feedback[0], {
    count: 2,
    amount: "1999999999999999999999998",
    xp: 4,
    accountId: "alice.testnet",
    dayId: "day-1",
    receiptIds: confirmed.map((r) => r.id),
  });
  f.update({ online: false });
  f.observe({ receipts: confirmed });
  f.advance(10000);
  f.update({ online: true });
  assert.equal(f.feedback.length, 1);
  assert.equal(f.view().confirmed.count, 2);
});

test("existing ledger receipts and restored accepted history never replay a celebration", async () => {
  const storage = memoryStorage(),
    f = fixture({ storage });
  f.enable();
  await f.tick();
  const pending = receipt(f.calls[0]);
  f.controller.dispose();
  const restored = fixture({ storage });
  restored.observe({
    receipts: [{ ...pending, state: "confirmed", amount: "10", xp: 2 }],
  });
  restored.advance(3000);
  await restored.tick();
  assert.equal(restored.calls.length, 0);
  assert.equal(restored.view().enabled, false);
  assert.equal(restored.feedback.length, 0);
  restored.enable();
  await restored.tick();
  assert.equal(restored.calls[0].index, 1);
  assert.ok(
    ![...storage.values.values()].some((data) =>
      /accuracy|timestamp|49\.747/.test(data),
    ),
    "Journal never persists GPS",
  );
});

test("accepted ambiguous response is recovered by its durable receipt without resubmission", async () => {
  const f = fixture({
    submit: async () => {
      throw new TypeError("Connection lost after acceptance");
    },
  });
  f.enable();
  await f.tick();
  assert.equal(f.view().pending, 1);
  f.observe({ receipts: [receipt(f.calls[0])] });
  f.advance(15000);
  await f.tick();
  assert.deepEqual(
    f.calls.map((r) => r.index),
    [0, 1],
  );
  assert.equal(f.feedback.length, 0);
});

test("uncertain network failures retry the same identity with bounded exponential delays", async () => {
  const f = fixture({
    submit: async () => {
      throw new TypeError("Network unavailable");
    },
  });
  f.enable();
  await f.tick();
  for (let n = 0; n < 25; n++) await f.tick();
  assert.equal(f.calls.length, 1);
  f.advance(14999);
  await f.tick();
  assert.equal(f.calls.length, 1);
  f.advance(1);
  await f.tick();
  assert.equal(f.calls.length, 2);
  f.advance(29999);
  await f.tick();
  assert.equal(f.calls.length, 2);
  f.advance(1);
  await f.tick();
  assert.equal(f.calls.length, 3);
  f.advance(120000);
  await f.tick();
  assert.equal(f.calls.length, 3);
  assert.deepEqual(
    f.calls.map((r) => r.index),
    [0, 0, 0],
  );
  assert.equal(f.view().status, "review");
});

test("rate limits pause, shared-coin rejection is skipped, caps and pause do not loop", async () => {
  const limited = fixture({
    submit: async () => {
      throw rejection(429, "RATE_LIMIT");
    },
  });
  limited.enable();
  await limited.tick();
  limited.advance(59999);
  await limited.tick();
  assert.equal(limited.calls.length, 1);
  limited.advance(1);
  await limited.tick();
  assert.equal(limited.calls.length, 2);
  const taken = fixture({
    submit: async () => {
      throw rejection(409, "NATIVE_ALREADY_CLAIMED");
    },
  });
  taken.enable();
  await taken.tick();
  taken.advance(3000);
  await taken.tick();
  assert.deepEqual(
    taken.calls.map((r) => r.index),
    [0, 1],
  );
  assert.equal(taken.view().pending, 0);
  for (const [status, code, expected] of [
    [429, "NATIVE_ACCOUNT_LIMIT", "account_limit"],
    [409, "NATIVE_DAY_LIMIT", "day_limit"],
    [503, "NATIVE_PAUSED", "paused"],
    [403, "INVALID_ACTION", "review"],
  ]) {
    const f = fixture({
      submit: async () => {
        throw rejection(status, code);
      },
    });
    f.enable();
    await f.tick();
    f.advance(120000);
    await f.tick();
    assert.equal(f.calls.length, 1);
    assert.equal(f.view().status, expected);
    assert.equal(f.view().pending, 0);
  }
});

test("server GPS rejection requires a newer fix instead of replaying rejected evidence", async () => {
  const f = fixture({
    submit: async () => {
      throw rejection(422, "NATIVE_LOCATION_SPEED");
    },
  });
  f.enable();
  await f.tick();
  f.advance(5000, false);
  await f.tick();
  assert.equal(f.calls.length, 1);
  assert.equal(f.view().status, "gps_stale");
  f.advance(1);
  await f.tick();
  assert.equal(f.calls.length, 2);
});

test("delayed receipt after account switch never refreshes or credits the new account", async () => {
  const delayed = deferred();
  const f = fixture({ submit: () => delayed.promise });
  f.enable();
  const old = f.tick();
  const state = { ...f.context().state, accountId: "bob.testnet" };
  f.update({ accountId: "bob.testnet", state });
  assert.equal(f.view().enabled, false);
  f.enable();
  await f.tick();
  assert.equal(f.calls.length, 1);
  delayed.resolve(receipt(f.calls[0], "confirmed"));
  await old;
  assert.equal(f.refreshes(), 0);
  assert.equal(f.feedback.length, 0);
  await f.tick();
  assert.equal(f.view().status, "gps_stale");
  f.advance(3001);
  await f.tick();
  assert.equal(f.calls[1].accountId, "bob.testnet");
  assert.equal(f.view().confirmed.count, 0);
});

test("transient unavailable state preserves opt-in; a known new day resets it and old GPS", async () => {
  const f = fixture();
  f.enable();
  const state = f.context().state;
  f.update({ state: null });
  await f.tick();
  assert.equal(f.view().enabled, true);
  assert.equal(f.view().status, "loading");
  f.update({ state });
  assert.equal(f.view().enabled, true);
  f.observe({ day: { ...state.day, id: "day-2" } });
  assert.equal(f.view().enabled, false);
  f.enable();
  await f.tick();
  assert.equal(f.calls.length, 0);
  assert.equal(f.view().status, "gps_stale");
  f.advance(1);
  await f.tick();
  assert.equal(f.calls[0].dayId, "day-2");
});

test("invalid receipt binding and unavailable durable storage fail closed", async () => {
  const wrong = fixture({
    submit: async (r) =>
      receipt(r, "confirmed", { accountId: "other.testnet" }),
  });
  wrong.enable();
  await wrong.tick();
  assert.equal(wrong.view().status, "review");
  assert.equal(wrong.feedback.length, 0);
  const f = fixture({ storage: null });
  f.enable();
  await f.tick();
  assert.equal(f.calls.length, 0);
  assert.equal(f.view().status, "storage");
});

test("stale response and activity changes cannot mutate copied GPS evidence", async () => {
  let request;
  const delayed = deferred();
  const f = fixture({
    submit: (r) => {
      request = r;
      return delayed.promise;
    },
  });
  f.enable();
  const pending = f.tick();
  const latitude = request.fix.lat;
  f.context().fix.lat = 0;
  assert.equal(request.fix.lat, latitude);
  f.update({ active: false });
  delayed.resolve(receipt(request));
  await pending;
  f.advance(3000);
  await f.tick();
  assert.equal(f.calls.length, 1);
});
