import test from "node:test";
import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, sign, verify } from "node:crypto";
import { latLngToCell } from "h3-js";
import { openDatabase, createPlayer } from "../server/database.mjs";
import { dayKey } from "../server/domain.mjs";
import { verifyProof } from "../server/chain-ledger/merkle.mjs";
import {
  readDay,
  setPotentialSource,
} from "../server/map-rewards/day-plan.mjs";
import {
  MAP_CHAIN_DAILY_CLAIMS,
  MAP_COIN_CAP_YOCTO,
  MAP_ZONE_CAP_YOCTO,
  mapChainStatus,
  mapClaimMessage,
  mapDayId,
  publishArgs,
  runMapChainWorker,
} from "../server/map-rewards/chain.mjs";
import { allowedWorkerMethods } from "../server/native/reward-worker.mjs";
import { ensureWorld, worldView } from "../server/world.mjs";
import { claimCoin } from "../server/game.mjs";

const NOW = Date.parse("2026-11-05T20:30:00Z"); // 21:30 in Prague: every wave is open
const PLZEN = { lat: 49.7477, lng: 13.3776 };
const CONTRACT = "rewards.questlayer.testnet";

function attestor() {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  return {
    publicKey,
    sign: (text) => sign(null, Buffer.from(text), privateKey).toString("base64"),
  };
}

// The contract's map_leaf, written out independently of day-plan.mjs.
const leafOf = (date, policy, c) =>
  createHash("sha256")
    .update(
      `qlmap1|${policy}|${date}|${c.cell}|${c.coins_u}|${c.zones_u}|${c.zones}|${c.pioneer ? 1 : 0}|${c.seed}`,
    )
    .digest("hex");

test("the worker key may hold the native methods alone or with the map methods", () => {
  const native = ["publish_day", "close_day", "claim", "maintain_vault"];
  assert.ok(allowedWorkerMethods(native));
  assert.ok(
    allowedWorkerMethods([...native, "publish_map_day", "claim_map", "close_map_day"]),
  );
  assert.equal(allowedWorkerMethods([...native, "claim_map"]), null);
  assert.equal(allowedWorkerMethods([...native, "withdraw"]), null);
  assert.equal(allowedWorkerMethods([...native, "claim"]), null);
});

test("publish args keep the day under the per-date cap and include the pioneer reserve", () => {
  const plan = {
    day: "2026-11-05",
    policy: "map-rewards-v1",
    root: "a".repeat(64),
    coinsU: 900_000_000,
    pioneerU: 50_000_000,
    zonesU: 400_000_000,
  };
  const args = publishArgs(plan);
  assert.equal(args.day_id, "map-2026-11-05-v1");
  assert.equal(args.coins_u, "950000000");
  const rate = BigInt(args.yocto_per_u);
  assert.ok(rate > 0n && rate <= 10n ** 18n);
  assert.ok(BigInt(args.coins_u) * rate <= MAP_COIN_CAP_YOCTO);
  assert.ok(BigInt(args.zones_u) * rate <= MAP_ZONE_CAP_YOCTO);
  // A Prague day: 23:00 UTC before to 23:00 UTC (winter time).
  assert.equal(args.starts_at, String(Date.parse("2026-11-04T23:00:00Z")));
  assert.equal(args.ends_at, String(Date.parse("2026-11-05T23:00:00Z")));
});

test("collected map coins go on chain with a proof the contract accepts", async () => {
  setPotentialSource(() => new Map());
  const db = openDatabase(":memory:");
  try {
    const player = createPlayer(db, "Chain walker", NOW);
    const w = await ensureWorld(db, PLZEN, false, NOW);
    const day = dayKey(NOW, "Europe/Prague"),
      cell = latLngToCell(PLZEN.lat, PLZEN.lng, 7);
    const view = worldView(db, w.id, player, { now: NOW });
    const coins = view.coins.filter(
      (c) => latLngToCell(c.lat, c.lng, 7) === cell,
    );
    assert.ok(coins.length >= 2);
    // Walk between coins at an honest pace (the travel guard).
    const at = (i) => NOW + i * 15 * 60_000;
    coins.slice(0, 2).forEach((c, i) =>
      claimCoin(db, player, c.id, { lat: c.lat, lng: c.lng, accuracy: 5, timestamp: at(i) }, at(i)),
    );
    db.prepare("INSERT INTO wallet_links VALUES(?,?,?)").run("walker.testnet", player, NOW);

    const calls = [];
    let n = 0;
    const call = async (method, args) => {
      calls.push({ method, args });
      return `tx${++n}`;
    };
    const signer = attestor();
    const first = await runMapChainWorker(db, { call, signer, contractId: CONTRACT, now: at(1) + 1000 });
    assert.ok(first.published);
    assert.equal(first.queued, 2);
    assert.equal(first.sent, 2);

    const plan = readDay(db, day);
    const publish = calls.find((c) => c.method === "publish_map_day").args;
    assert.equal(publish.day_id, mapDayId(day));
    assert.equal(publish.root, plan.root);
    assert.equal(publish.coins_u, String(plan.coinsU + plan.pioneerU));

    const claims = calls.filter((c) => c.method === "claim_map").map((c) => c.args);
    const indexes = new Set();
    for (const { claim, signature } of claims) {
      assert.equal(claim.kind, "coin");
      assert.equal(claim.cell, cell);
      assert.equal(claim.receiver_id, "walker.testnet");
      assert.match(claim.receipt_id, /^map-[0-9a-f]{40}$/);
      assert.match(claim.evidence_hash, /^[0-9a-f]{64}$/);
      const t = Number(claim.received_at);
      assert.ok(t >= Number(publish.starts_at) && t < Number(publish.ends_at));
      const leaf = leafOf(day, publish.policy, claim);
      assert.ok(verifyProof(leaf, claim.proof, publish.root), "leaf proves against the root");
      assert.ok(Number(claim.value_u) <= 2_000_000);
      indexes.add(claim.index);
      const text = mapClaimMessage(CONTRACT, claim);
      assert.ok(text.startsWith("QuestLayer map reward v1\nNetwork: testnet\nContract: rewards.questlayer.testnet\n"));
      assert.ok(verify(null, Buffer.from(text), signer.publicKey, Buffer.from(signature, "base64")));
    }
    assert.equal(indexes.size, 2, "each coin has its own index");

    // Nothing new: no second publish, no duplicate claim.
    const again = await runMapChainWorker(db, { call, signer, contractId: CONTRACT, now: at(1) + 2000 });
    assert.deepEqual([again.published, again.queued, again.sent], [null, 0, 0]);
    assert.equal(calls.filter((c) => c.method === "publish_map_day").length, 1);

    // A refused claim is final; a network error retries later.
    const third = coins[2];
    if (third) {
      claimCoin(db, player, third.id, { lat: third.lat, lng: third.lng, accuracy: 5, timestamp: at(2) }, at(2));
      const refuse = async () => {
        throw new Error("Smart contract panicked: Cell coin budget spent");
      };
      const r = await runMapChainWorker(db, { call: refuse, signer, contractId: CONTRACT, now: at(2) + 1000 });
      assert.equal(r.failed, 1);
      assert.equal(mapChainStatus(db, day).claims.failed, 1);
    }

    // The day closes after its end plus a day of grace.
    const late = Number(publish.ends_at) + 86_400_000 + 120_000;
    const closing = await runMapChainWorker(db, { call, signer, contractId: CONTRACT, now: late });
    assert.equal(closing.closed, 1);
    assert.equal(mapChainStatus(db, day).state, "closed");
    assert.ok(MAP_CHAIN_DAILY_CLAIMS < 256);
  } finally {
    setPotentialSource(null);
    db.close();
  }
});

test("arena coins and players without a wallet stay practice", async () => {
  setPotentialSource(() => new Map());
  const db = openDatabase(":memory:");
  try {
    const player = createPlayer(db, "Arena runner", NOW);
    const w = await ensureWorld(db, PLZEN, true, NOW);
    const coin = worldView(db, w.id, player, { now: NOW }).coins[0];
    claimCoin(db, player, coin.id, { lat: coin.lat, lng: coin.lng, accuracy: 5, timestamp: NOW }, NOW);
    db.prepare("INSERT INTO wallet_links VALUES(?,?,?)").run("runner.testnet", player, NOW);
    const calls = [];
    const r = await runMapChainWorker(db, {
      call: async (m, a) => (calls.push({ m, a }), "tx"),
      signer: attestor(),
      contractId: CONTRACT,
      now: NOW,
    });
    assert.equal(r.queued, 0);
    assert.ok(!calls.some((c) => c.m === "claim_map"));
  } finally {
    setPotentialSource(null);
    db.close();
  }
});
