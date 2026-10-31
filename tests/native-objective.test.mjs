import test from "node:test";
import assert from "node:assert/strict";
import {
  makeNativeObjective,
  nativeObjectiveKey,
  nativeAccountKey,
  parseNativeObjective,
  resolveNativeObjective,
  restoreNativeAccount,
  nativeVisitReadReason,
} from "../src/native-objective.ts";

const now = Date.parse("2026-10-31T12:00:00Z");
function fixture(kind = "quest") {
  const state = {
    status: "ready",
    network: "testnet",
    accountId: "alice.testnet",
    contractId: "rewards.testnet",
    generatedAt: now,
    collection: { available: true, paused: false },
    access: { tier: 1 },
    day: {
      id: "plzen-day",
      hash: "manifest-1",
      startsAt: now - 1000,
      endsAt: now + 86400000,
      quests: [
        {
          index: 4,
          title: "Riverbank expedition",
          tier: 1,
          opensAt: now - 1000,
          closesAt: now + 3600000,
          checkpoint: 1,
          targets: [
            { lat: 49.747, lng: 13.377 },
            { lat: 49.748, lng: 13.378 },
            { lat: 49.749, lng: 13.379 },
          ],
        },
      ],
      coins: [{ index: 17, lat: 49.747, lng: 13.377, distance: 20 }],
    },
    receipts: [],
  };
  const reference = makeNativeObjective(
    "player-a",
    "alice.testnet",
    state,
    kind,
    kind === "coin" ? 17 : 4,
    now,
  );
  return { state, reference };
}
const resolve = (reference, state, error = "", time = now) =>
  resolveNativeObjective(
    reference,
    "player-a",
    "alice.testnet",
    state,
    error,
    time,
  );
function receipt(reference, state = "queued") {
  return {
    id: "accepted-visit",
    dayId: reference.dayId,
    accountId: reference.accountId,
    kind: reference.kind,
    index: reference.index,
    state,
    amount: state === "confirmed" ? "500000000000000000000" : null,
    xp: state === "confirmed" ? 60 : null,
  };
}

test("native reload restores identity and takes the next checkpoint exclusively from the current snapshot", () => {
  const { reference, state } = fixture();
  const saved = parseNativeObjective(
    JSON.stringify({
      ...reference,
      checkpoint: 0,
      target: { lat: 1, lng: 1 },
      reward: "999999",
    }),
    "player-a",
    "alice.testnet",
  );
  assert.deepEqual(saved, reference);
  assert.deepEqual(resolve(saved, state).target, {
    ...state.day.quests[0].targets[1],
    label: "Riverbank expedition · stop 2",
  });
  state.day.quests[0].checkpoint = 2;
  assert.equal(
    resolve(saved, state).target.lat,
    state.day.quests[0].targets[2].lat,
  );
  assert.match(resolve(saved, state).message, /Stop 3 of 3/);
});

test("player, account, network, contract, manifest and stable day identities cannot be silently substituted", () => {
  const { reference, state } = fixture();
  assert.notEqual(
    nativeObjectiveKey("player-a", null),
    nativeObjectiveKey("player-a", "alice.testnet"),
  );
  assert.notEqual(
    nativeObjectiveKey("player-b", "alice.testnet"),
    nativeObjectiveKey("player-a", "alice.testnet"),
  );
  assert.equal(
    parseNativeObjective(
      JSON.stringify(reference),
      "player-b",
      "alice.testnet",
    ),
    null,
  );
  assert.equal(
    parseNativeObjective(JSON.stringify(reference), "player-a", "bob.testnet"),
    null,
  );
  for (const change of [
    { playerId: "player-b" },
    { accountId: "bob.testnet" },
    { network: "mainnet" },
  ])
    assert.equal(
      resolve({ ...reference, ...change }, state).status,
      "unavailable",
    );
  for (const change of [
    { accountId: "bob.testnet" },
    { network: "mainnet" },
    { contractId: "other.testnet" },
  ])
    assert.equal(resolve(reference, { ...state, ...change }).target, null);
  assert.equal(
    resolve(reference, { ...state, day: { ...state.day, hash: "changed" } })
      .status,
    "unavailable",
  );
  assert.equal(
    resolve(reference, { ...state, day: { ...state.day, id: "next-day" } })
      .status,
    "expired",
  );
});

test("a failed, preparing, stale or wrong-clock snapshot hides the marker without losing the reference", () => {
  const { reference, state } = fixture();
  const before = JSON.stringify(reference);
  for (const s of [
    null,
    { status: "not-configured" },
    { ...state, day: null, status: "preparing" },
    { ...state, generatedAt: now - 30001 },
    { ...state, generatedAt: now + 2001 },
  ]) {
    assert.equal(resolve(reference, s).status, "waiting");
    assert.equal(resolve(reference, s).target, null);
  }
  assert.equal(resolve(reference, state, "RPC unavailable").status, "waiting");
  assert.equal(JSON.stringify(reference), before);
  assert.equal(resolve(reference, state).status, "active");
});

test("pending and retrying receipts prevent presenting a new marker or confirmed reward", () => {
  const { reference, state } = fixture();
  for (const phase of ["queued", "retrying"]) {
    state.receipts = [receipt(reference, phase)];
    const view = resolve(reference, state);
    assert.equal(view.status, "pending");
    assert.equal(view.target, null);
    assert.equal(view.receipt.amount, null);
    assert.match(view.message, phase === "retrying" ? /retrying/ : /Waiting/);
  }
  state.receipts = [receipt(reference, "confirmed")];
  assert.equal(resolve(reference, state).status, "confirmed");
  assert.equal(
    resolve(reference, state).receipt.amount,
    "500000000000000000000",
  );
});

test("another player's shared prize or mismatched receipt does not erase personal checkpoint eligibility", () => {
  const { reference, state } = fixture();
  state.day.quests[0].prizeClaimed = true;
  state.day.quests[0].prizePending = true;
  for (const change of [
    { accountId: "bob.testnet" },
    { dayId: "old-day" },
    { kind: "coin" },
    { index: 5 },
  ]) {
    state.receipts = [{ ...receipt(reference), ...change }];
    assert.equal(resolve(reference, state).status, "active");
  }
});

test("own durable receipts remain visible after day rollover and missing nearby objects", () => {
  for (const kind of ["quest", "coin"]) {
    const { reference, state } = fixture(kind);
    state.day = {
      ...state.day,
      id: "next-day",
      hash: "next-hash",
      quests: [],
      coins: [],
    };
    state.receipts = [receipt(reference)];
    assert.equal(resolve(reference, state).status, "pending");
    state.receipts = [receipt(reference, "confirmed")];
    assert.equal(resolve(reference, state).status, "confirmed");
    assert.equal(resolve(reference, state).target, null);
  }
});

test("a missing coin is not evidence of collection; a matching receipt establishes its actual state", () => {
  const { reference, state } = fixture("coin");
  assert.equal(resolve(reference, state).status, "active");
  state.day.coins = [];
  assert.equal(resolve(reference, state).status, "not-nearby");
  assert.match(
    resolve(reference, state).message,
    /farther away or already collected/,
  );
  state.receipts = [receipt(reference)];
  assert.equal(resolve(reference, state).status, "pending");
  state.receipts = [receipt(reference, "confirmed")];
  assert.equal(resolve(reference, state).status, "confirmed");
});

test("expired, completed, removed and invalid checkpoints never restore an actionable location", () => {
  const { reference, state } = fixture();
  const q = state.day.quests[0];
  for (const [change, expected] of [
    [{ closesAt: now }, "expired"],
    [{ checkpoint: 3 }, "recorded"],
    [{ checkpoint: -1 }, "unavailable"],
    [{ targets: [] }, "unavailable"],
    [
      {
        targets: [
          { lat: 0, lng: 0 },
          { lat: NaN, lng: 0 },
        ],
      },
      "unavailable",
    ],
  ]) {
    const view = resolve(reference, {
      ...state,
      day: { ...state.day, quests: [{ ...q, ...change }] },
    });
    assert.equal(view.status, expected);
    assert.equal(view.target, null);
  }
  assert.equal(
    resolve(reference, { ...state, day: { ...state.day, quests: [] } }).status,
    "unavailable",
  );
  assert.equal(resolve(reference, state, "", state.day.endsAt).target, null);
});

test("future and tier-locked walks remain browseable and disclose the requirement", () => {
  const { reference, state } = fixture();
  state.day.quests[0].opensAt = now + 60000;
  assert.match(resolve(reference, state).message, /Opens later/);
  state.day.quests[0].opensAt = now - 1000;
  state.day.quests[0].tier = 2;
  assert.match(resolve(reference, state).message, /Requires Tier 2/);
});

test("stored account preference can select only a currently linked wallet and stays scoped per player", () => {
  assert.equal(
    restoreNativeAccount("bob.testnet", ["alice.testnet", "bob.testnet"]),
    "bob.testnet",
  );
  assert.equal(
    restoreNativeAccount("removed.testnet", ["alice.testnet"]),
    "alice.testnet",
  );
  assert.equal(restoreNativeAccount("alice.testnet", []), "");
  assert.notEqual(nativeAccountKey("player-a"), nativeAccountKey("player-b"));
});

test("guest browsing has its own bookmark and cannot acquire a linked account's visit rights", () => {
  const { state } = fixture();
  state.accountId = null;
  const reference = makeNativeObjective(
    "player-a",
    null,
    state,
    "quest",
    4,
    now,
  );
  assert.equal(reference.accountId, null);
  assert.equal(
    parseNativeObjective(
      JSON.stringify(reference),
      "player-a",
      "alice.testnet",
    ),
    null,
  );
  assert.equal(
    resolveNativeObjective(reference, "player-a", null, state, "", now).status,
    "active",
  );
  assert.equal(
    resolveNativeObjective(
      reference,
      "player-a",
      "alice.testnet",
      { ...state, accountId: "alice.testnet" },
      "",
      now,
    ).target,
    null,
  );
});

test("manual visit controls stop at exact day boundaries, stale reads, paused publication and mismatched accounts", () => {
  const { state } = fixture();
  assert.equal(nativeVisitReadReason(state, "alice.testnet", now), "");
  assert.match(
    nativeVisitReadReason(state, "bob.testnet", now),
    /selected testnet account/,
  );
  for (const [changed, pattern] of [
    [{ ...state, generatedAt: now - 30001 }, /Refresh/],
    [{ ...state, network: "mainnet" }, /selected testnet account/],
    [{ ...state, day: null }, /published/],
    [{ ...state, day: { ...state.day, startsAt: now + 1 } }, /not open/],
    [{ ...state, day: { ...state.day, endsAt: now } }, /ended/],
    [{ ...state, collection: { available: false, paused: true } }, /paused/],
  ])
    assert.match(nativeVisitReadReason(changed, "alice.testnet", now), pattern);
});

test("corrupted or invented navigation data never supplies a target or claim authority", () => {
  const { reference, state } = fixture();
  for (const raw of [
    null,
    "{",
    "null",
    "x".repeat(4097),
    JSON.stringify({ ...reference, version: 2 }),
    JSON.stringify({ ...reference, index: -1 }),
    JSON.stringify({ ...reference, network: "mainnet" }),
  ])
    assert.equal(parseNativeObjective(raw, "player-a", "alice.testnet"), null);
  for (const s of [
    null,
    { ...state, generatedAt: now - 30001 },
    { ...state, accountId: "bob.testnet" },
    { ...state, day: { ...state.day, hash: "" } },
  ])
    assert.equal(
      makeNativeObjective("player-a", "alice.testnet", s, "quest", 4, now),
      null,
    );
  assert.equal(
    makeNativeObjective("player-a", "alice.testnet", state, "quest", 999, now),
    null,
  );
  assert.equal(resolve(null, state).status, "empty");
});
