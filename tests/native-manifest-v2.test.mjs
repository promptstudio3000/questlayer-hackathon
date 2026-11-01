// Native manifest v2: richer quest templates and street finds for future days,
// with v1 days left exactly as published.
import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import { openDatabase, createPlayer } from "../server/database.mjs";
import { NativeRewards } from "../server/native/rewards.mjs";
import {
  NATIVE_V2_START_DAY,
  NATIVE_V2_TEMPLATES,
  nativeDayId,
  nativeManifest,
  nativeManifestVersion,
  nativeV2Templates,
  publicationArgs,
  storedNativeManifest,
} from "../server/native/reward-manifest.mjs";
import { runRewardWorker } from "../server/native/reward-worker.mjs";
import {
  allocationSettings,
  manifestCost,
} from "../server/native/allocation.mjs";
import { nativeMapProjection } from "../server/native/map-projection.mjs";
import { describeNativeQuest } from "../server/quest-templates.mjs";
import {
  buildCityPlan,
  getOrPrepareCityPlan,
} from "../server/world-planner.mjs";
import { PLZEN, sampleCityPaths } from "../server/spatial/city-pack.mjs";
import { ACCOUNT_SUFFIX } from "../server/native/network.mjs";
import { distance } from "../server/domain.mjs";

const NEAR = 10n ** 24n;
const DAY = "2026-11-04";
const NOW = Date.parse(`${DAY}T10:00:00Z`);
const treasury = {
  coins: { available: (NEAR / 10n).toString() },
  zones: { available: (NEAR / 10n).toString() },
};

test("new dates take v2 from the activation day; off keeps v1", () => {
  assert.equal(nativeManifestVersion("2026-11-02"), 1);
  assert.equal(nativeManifestVersion(NATIVE_V2_START_DAY), 2);
  assert.equal(nativeManifestVersion("2026-11-10", "off"), 1);
  assert.equal(nativeManifestVersion("2026-11-10", "2026-11-11"), 1);
  assert.throws(() => nativeManifestVersion("2026-11-10", "soon"));
  assert.equal(nativeDayId("plzen", DAY, 2), `plzen-${DAY}-v2`);
  assert.throws(() => nativeDayId("plzen", DAY, 3));
  assert.equal(
    allocationSettings({ NATIVE_MANIFEST_V2_FROM: "off" }).manifestV2From,
    "off",
  );
  assert.equal(allocationSettings({}).manifestV2From, undefined);
  assert.throws(() =>
    allocationSettings({ NATIVE_MANIFEST_V2_FROM: "tomorrow" }),
  );
});

test("a v2 day carries every template within the contract's bounds", () => {
  const plan = buildCityPlan(PLZEN, DAY),
    points = sampleCityPaths(PLZEN),
    v1 = nativeManifest(plan, treasury, points),
    v2 = nativeManifest(plan, treasury, points, { version: 2 });
  assert.equal(v2.version, 2);
  assert.equal(v2.policy, "native-city-v2");
  assert.equal(v2.id, `plzen-${DAY}-v2`);
  assert.equal(v2.quests.length, 6);
  assert.deepEqual(
    v2.quests.map((q) => q.template),
    nativeV2Templates("plzen", DAY),
  );
  assert.deepEqual(
    new Set(v2.quests.map((q) => q.template)),
    new Set(Object.keys(NATIVE_V2_TEMPLATES)),
  );
  for (const q of v2.quests) {
    const zone = plan.zones[q.index];
    const known = zone.targets.map((p) => `${p.lat},${p.lng}`);
    assert.ok(q.targets.every((p) => known.includes(`${p.lat},${p.lng}`)));
    assert.ok(q.xp > 0 && q.xp <= 500);
    if (q.tier === 1) assert.equal(q.reward, "0");
    if (q.template === "path-visit" || q.template === "cosmetic-chest")
      assert.equal(q.targets.length, 1);
    if (q.template === "ordered-trail") assert.equal(q.targets.length, 3);
    if (q.template === "return-trail") {
      assert.equal(q.targets.length, 4);
      assert.deepEqual(q.targets[3], q.targets[0]);
    }
    const activity = describeNativeQuest(q);
    assert.equal(activity.policy, "native-city-v2");
    assert.equal(activity.templateId, q.template);
    assert.equal(activity.steps.length, q.targets.length);
  }
  // Same economy as v1: identical coins, coin unit and zone prizes.
  assert.equal(v2.coinUnit, v1.coinUnit);
  assert.deepEqual(v2.coins, v1.coins);
  assert.deepEqual(
    v2.quests.map((q) => q.reward),
    v1.quests.map((q) => q.reward),
  );
  const cost = manifestCost(v2);
  assert.ok(cost.coins <= NEAR / 10n && cost.zones <= NEAR / 10n);
  // Street finds are a spaced subset of the published coins.
  assert.ok(v2.finds.length > 0 && v2.finds.length <= 60);
  assert.ok(v2.finds.every((i) => Number.isInteger(i) && v2.coins[i]));
  assert.deepEqual(
    v2.finds,
    [...v2.finds].sort((a, b) => a - b),
  );
  // Publication arguments stay in the shape the unchanged contract accepts.
  const args = publicationArgs(v2);
  assert.equal(args.quests.length, 6);
  assert.deepEqual(Object.keys(args.quests[0]).sort(), [
    "closes_at",
    "opens_at",
    "reward",
    "tier",
    "xp",
  ]);
  // Deterministic: the same inputs give the same hash.
  assert.equal(
    nativeManifest(plan, treasury, points, { version: 2 }).hash,
    v2.hash,
  );
  // v1 is untouched by the v2 option's existence.
  assert.equal(v1.version, 1);
  assert.equal(v1.finds, undefined);
  assert.ok(v1.quests.every((q) => q.template === undefined));
});

test("the verified map projection accepts v2 template stops", () => {
  const db = openDatabase(":memory:"),
    plan = getOrPrepareCityPlan(db, PLZEN, DAY, NOW),
    m = nativeManifest(plan, treasury, sampleCityPaths(PLZEN), {
      version: 2,
    });
  assert.equal(nativeMapProjection(db, m).status, "verified");
  const moved = structuredClone(m);
  moved.quests[0].targets[0] = { lat: 49.7, lng: 13.3 };
  assert.equal(nativeMapProjection(db, moved).status, "unavailable");
});

function fixture() {
  const db = openDatabase(":memory:"),
    player = createPlayer(db, "Native v2 explorer", NOW),
    accountId = `alice${ACCOUNT_SUFFIX}`,
    contractId = `rewards${ACCOUNT_SUFFIX}`;
  db.prepare("INSERT INTO wallet_links VALUES(?,?,?)").run(
    accountId,
    player,
    NOW,
  );
  const keys = generateKeyPairSync("ed25519"),
    signer = {
      publicKey: keys.publicKey
        .export({ format: "der", type: "spki" })
        .subarray(-32)
        .toString("base64"),
      sign: (m) =>
        sign(null, Buffer.from(m), keys.privateKey).toString("base64"),
    };
  let now = NOW;
  const n = new NativeRewards(
    db,
    { query: async () => ({ code_hash: "reviewed" }) },
    { contractId, codeHash: "reviewed", vaults: [] },
    signer,
    { clock: () => now, city: PLZEN },
  );
  const days = new Map();
  n.view = async (method, args = {}) => {
    if (method === "get_config")
      return {
        attestor: signer.publicKey,
        publisher: contractId,
        paused: false,
      };
    if (method === "get_treasury") return treasury;
    if (method === "get_day") return days.get(args.day_id) || null;
    if (method === "get_account") return { credit: "0", xp: 0 };
    throw Error(method);
  };
  const sent = [];
  const send = async (method, args) => {
    sent.push(method);
    if (method === "publish_day")
      days.set(args.day_id, {
        ...args,
        closed: false,
        claims_accepted: 0,
        claims_limit: 256,
        storage_reserved: true,
      });
    return "tx";
  };
  return {
    db,
    n,
    days,
    sent,
    send,
    player,
    accountId,
    clock: () => now,
    advance: (ms) => (now += ms),
    fix: (p) => ({ ...p, accuracy: 5, timestamp: now }),
  };
}
const stored = (db) =>
  db
    .prepare("SELECT * FROM native_days ORDER BY day")
    .all()
    .map(storedNativeManifest);

test("the worker publishes new dates as v2 and the snapshot shows templates and finds", async () => {
  const f = fixture();
  await runRewardWorker(f.n, f.send, { clock: f.clock });
  const days = stored(f.db);
  assert.deepEqual(
    days.map((m) => m.id),
    [`plzen-${DAY}-v2`, "plzen-2026-11-05-v2"],
  );
  const snap = await f.n.snapshot(f.player, {
    accountId: f.accountId,
    location: days[0].coins[days[0].finds[0]],
  });
  assert.equal(snap.day.id, `plzen-${DAY}-v2`);
  assert.equal(snap.day.version, 2);
  assert.equal(snap.day.findCount, days[0].finds.length);
  assert.ok(snap.day.coins.some((c) => c.find === true));
  assert.equal(snap.day.map.status, "verified");
  assert.deepEqual(
    snap.day.quests.map((q) => q.activity.templateId),
    days[0].quests.map((q) => q.template),
  );
});

test("an existing v1 date is never re-prepared as v2", async () => {
  const f = fixture();
  f.n.manifestV2From = "off";
  await runRewardWorker(f.n, f.send, { clock: f.clock });
  f.n.manifestV2From = undefined;
  await runRewardWorker(f.n, f.send, { clock: f.clock });
  assert.deepEqual(
    stored(f.db).map((m) => m.id),
    [`plzen-${DAY}-v1`, "plzen-2026-11-05-v1"],
  );
  const snap = await f.n.snapshot(f.player);
  assert.equal(snap.day.id, `plzen-${DAY}-v1`);
  assert.ok(
    snap.day.quests.every((q) => q.activity.policy === "native-city-v1"),
  );
});

test("a v1 chain day without its durable manifest blocks a v2 publication", async () => {
  const f = fixture();
  f.days.set(`plzen-${DAY}-v1`, { manifest_hash: "x".repeat(64) });
  await assert.rejects(async () => {
    const { publishNativeDays } =
      await import("../server/native/day-publication.mjs");
    await publishNativeDays(f.n, {
      clock: f.clock,
      renew: () => {},
      writeOwned: (sql, ...args) => f.db.prepare(sql).run(...args),
      sendOwned: f.send,
    });
  }, /no durable manifest/);
  assert.equal(f.sent.length, 0);
});

test("v2 visit and return trail are attested through the same ordered checkpoints", async () => {
  const f = fixture();
  await runRewardWorker(f.n, f.send, { clock: f.clock });
  f.n.enroll(f.player, f.accountId, true);
  const m = f.n.day(`plzen-${DAY}-v2`);
  const open = (q) => q.tier === 1 && q.opensAt <= NOW && q.closesAt > NOW;
  const submit = (q, checkpoint, p) =>
    f.n.submit(f.player, {
      accountId: f.accountId,
      dayId: m.id,
      kind: "quest",
      index: q.index,
      checkpoint,
      mode: "gps",
      fix: f.fix(p),
    });
  let last = null;
  for (const q of m.quests.filter(open)) {
    for (let i = 0; i < q.targets.length; i++) {
      // Walk there at the attestor's speed bound.
      f.advance(
        last
          ? Math.ceil((distance(last, q.targets[i]) / 8) * 1000) + 5000
          : 5000,
      );
      last = q.targets[i];
      const r = await submit(q, i, q.targets[i]);
      if (i + 1 < q.targets.length) {
        assert.equal(r.state, "progress");
        assert.equal(r.checkpoint, i + 1);
        assert.equal(r.total, q.targets.length);
      } else assert.equal(r.state, "queued");
    }
  }
  const returnTrail = m.quests.find(
    (q) => q.template === "return-trail" && open(q),
  );
  if (returnTrail) {
    // Skipping straight to the return stop is refused on a fresh account.
    const g = fixture();
    await runRewardWorker(g.n, g.send, { clock: g.clock });
    g.n.enroll(g.player, g.accountId, true);
    await assert.rejects(
      g.n.submit(g.player, {
        accountId: g.accountId,
        dayId: m.id,
        kind: "quest",
        index: returnTrail.index,
        checkpoint: 3,
        mode: "gps",
        fix: g.fix(returnTrail.targets[3]),
      }),
      /in order/,
    );
  }
  const claims = f.db
    .prepare("SELECT item_index FROM native_reward_claims WHERE kind='quest'")
    .all()
    .map((r) => r.item_index);
  assert.deepEqual(
    claims.sort(),
    m.quests
      .filter(open)
      .map((q) => q.index)
      .sort(),
  );
});
