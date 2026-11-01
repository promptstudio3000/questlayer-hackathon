// Three-day city pilot rehearsal (roadmap W13). Runs on a fresh clone with no
// keys and no network: a real on-disk database, the real reward worker, the
// real backup script and restore preflight, against a stateful chain double.
//
//   Day 1  publish, two players collect coins and a free zone, worker settles
//   Night  worker publishes day 3 after local midnight, then the backup runs
//   Day 2  a worker hangs after the chain accepted a claim; a second process
//          takes the expired lease and reconciles without resending; the late
//          worker is fenced out. More claims settle. Then the live database is
//          lost and the night snapshot is restored on a new state directory.
//          Chain acceptances made after the snapshot are unknown locally: the
//          day is frozen for new claims so nobody re-earns a paid coin.
//   Day 3  play continues normally; days 1 and 2 close and release reserves.
//
// Evidence of the server's recovery logic only. No physical GPS, wallet,
// testnet transaction, host replacement or offsite copy is involved.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { openDatabase, createPlayer } from "../database.mjs";
import { distance } from "../domain.mjs";
import "../schema-catalog.mjs";
import { restorePreflight } from "../schema-compatibility.mjs";
import { DEFAULT_CITY } from "../spatial/city-pack.mjs";
import { localDateBounds } from "../spatial/calendar.mjs";
import { loadAwardSigner } from "../native/award-vouchers.mjs";
import { NativeRewards } from "../native/rewards.mjs";
import { runRewardWorker } from "../native/reward-worker.mjs";
import { auditDistribution } from "../native/distribution.mjs";
import { rewardsChainDouble } from "./rewards-chain-double.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const BACKUP_SCRIPT = join(ROOT, "deploy", "backup-state.py");
const DB_NAME = "questlayer-hackathon.sqlite";
const HOUR = 3600000;

export async function runCityPilot({
  dates = ["2026-11-05", "2026-11-06", "2026-11-07"],
  city = DEFAULT_CITY,
  python = "python3",
} = {}) {
  assert.equal(dates.length, 3);
  const directory = mkdtempSync(join(tmpdir(), "questlayer-city-pilot-"));
  chmodSync(directory, 0o700);
  const live = join(directory, "state"),
    snapshots = join(directory, "snapshots"),
    contractId = "qa-rewards.testnet",
    codeHash = "qa-reviewed-code",
    accounts = { alice: "alice.pilot.testnet", bob: "bob.pilot.testnet" },
    events = [],
    hosts = [];
  const at = (index, localHour) =>
    localDateBounds(dates[index], city.timezone).startsAt + localHour * HOUR;
  let now = at(0, 9);
  const clock = () => now;
  mkdirSync(live, { mode: 0o700 });
  // The attestor lives in the state directory like on the VPS, so the backup
  // carries it and a restore must bring back the same public key.
  let signer = loadAwardSigner(join(live, "reward-attestor.pem"));
  const chain = rewardsChainDouble({
    contractId,
    attestorPublicKey: signer.publicKey,
    clock,
    codeHash,
  });
  const openHost = (state, label) => {
    const db = openDatabase(join(state, DB_NAME)),
      native = new NativeRewards(
        db,
        chain.provider,
        { contractId, codeHash, vaults: [] },
        signer,
        { clock, city },
      );
    const host = { db, native, label };
    hosts.push(host);
    return host;
  };
  const closeHost = (host) => {
    if (host.db.isOpen) host.db.close();
  };
  const tick = (host, send = chain.send) =>
    runRewardWorker(host.native, send, { clock });
  const dayId = (host, index) =>
    host.db
      .prepare("SELECT id FROM native_days WHERE day=? AND state='published'")
      .get(dates[index])?.id;
  const last = new Map();
  // Walk at a plausible pace from the player's previous native fix.
  const walkTo = (account, point) => {
    const before = last.get(account);
    if (before)
      now += Math.max(60000, Math.ceil(distance(before, point) / 4) * 1000);
    last.set(account, point);
  };
  const submit = async (
    host,
    player,
    account,
    day,
    kind,
    index,
    checkpoint,
  ) => {
    const m = host.native.day(day),
      target =
        kind === "coin" ? m.coins[index] : m.quests[index].targets[checkpoint];
    walkTo(account, target);
    return host.native.submit(player, {
      accountId: account,
      dayId: day,
      kind,
      index,
      ...(kind === "quest" ? { checkpoint } : {}),
      mode: "gps",
      fix: { lat: target.lat, lng: target.lng, accuracy: 5, timestamp: now },
    });
  };
  const completeFreeZone = async (host, player, account, day) => {
    const m = host.native.day(day),
      q = m.quests.find((q) => q.tier === 1 && q.closesAt > now + 2 * HOUR);
    assert.ok(q, "No free zone open for the rest of the day");
    if (now < q.opensAt) now = q.opensAt;
    let receipt;
    for (let checkpoint = 0; checkpoint < q.targets.length; checkpoint++)
      receipt = await submit(
        host,
        player,
        account,
        day,
        "quest",
        q.index,
        checkpoint,
      );
    assert.equal(receipt.state, "queued");
    return receipt;
  };
  const claimState = (host, id) =>
    host.db.prepare("SELECT * FROM native_reward_claims WHERE id=?").get(id);
  const audit = async (host) => {
    const a = await auditDistribution(host.native, { clock });
    assert.equal(a.status, "verified", JSON.stringify(a.failed));
    return a;
  };
  const backup = () => {
    const report = JSON.parse(
      execFileSync(
        python,
        [BACKUP_SCRIPT, "--state", live, "--destination", snapshots],
        { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
      ),
    );
    assert.equal(report.status, "ok");
    assert.equal(report.integrity, "ok");
    assert.deepEqual(report.nativeServiceKeysIncluded, ["reward-attestor.pem"]);
    return report;
  };
  const settledEverything = (host) =>
    host.db
      .prepare(
        "SELECT COUNT(*) n FROM native_reward_claims WHERE state!='confirmed'",
      )
      .get().n === 0;
  try {
    // ---------------- Day 1 ----------------
    let host = openHost(live, "primary");
    const alice = createPlayer(host.db, "Alice", now),
      bob = createPlayer(host.db, "Bob", now);
    for (const [player, account] of [
      [alice, accounts.alice],
      [bob, accounts.bob],
    ]) {
      host.db
        .prepare("INSERT INTO wallet_links VALUES(?,?,?)")
        .run(account, player, now);
      host.native.enroll(player, account, true);
    }
    await tick(host);
    const d1 = dayId(host, 0),
      d2 = dayId(host, 1);
    assert.ok(d1 && d2, "Day 1 and day 2 were not published");
    events.push("day1:published-today-and-tomorrow");
    const day1 = [
      await submit(host, alice, accounts.alice, d1, "coin", 0),
      await submit(host, bob, accounts.bob, d1, "coin", 1),
      await completeFreeZone(host, alice, accounts.alice, d1),
    ];
    // Another player cannot take a coin that is already accepted.
    await assert.rejects(
      submit(host, bob, accounts.bob, d1, "coin", 0),
      (e) => e.code === "NATIVE_ALREADY_CLAIMED",
    );
    now += 60000;
    assert.equal((await tick(host)).completed, 3);
    assert.ok(day1.every((r) => claimState(host, r.id).state === "confirmed"));
    await audit(host);
    events.push("day1:coins-and-free-zone-settled");

    // ---------------- Night 1 → 2 ----------------
    now = at(1, 0.5);
    await tick(host);
    const d3 = dayId(host, 2);
    assert.ok(d3, "Day 3 was not published after local midnight");
    now = at(1, 4.33);
    const snapshot = backup();
    events.push("night:day3-published-before-backup");
    events.push("night:private-snapshot-verified");

    // ---------------- Day 2 ----------------
    now = at(1, 9);
    const queued = [
      await submit(host, alice, accounts.alice, d2, "coin", 2),
      await submit(host, bob, accounts.bob, d2, "coin", 3),
    ];
    // Worker A: the chain accepts the claim, then the process stalls before
    // it can record the result (a hung RPC response or a frozen VM).
    let release;
    const stalled = new Promise((r) => (release = r));
    const stallingSend = async (method, args) => {
      const tx = await chain.send(method, args);
      if (method === "claim") await stalled;
      return tx;
    };
    const workerA = tick(host, stallingSend).then(
      () => ({ ok: true }),
      (error) => ({ ok: false, error: error.message }),
    );
    for (let i = 0; i < 1000 && !chain.state.receipts.has(queued[0].id); i++)
      await new Promise((r) => setImmediate(r));
    assert.ok(chain.state.receipts.has(queued[0].id));
    assert.equal(claimState(host, queued[0].id).state, "queued");
    // Worker B is a separate process on the same state after the lease ran out.
    const busy = openHost(live, "takeover");
    assert.deepEqual(await tick(busy), { busy: true });
    now += 3 * 60000;
    assert.equal((await tick(busy)).completed, 2);
    assert.equal(chain.claimSends(queued[0].id), 1, "Takeover resent a claim");
    const takenOver = claimState(busy, queued[0].id);
    assert.equal(takenOver.state, "confirmed");
    release();
    const late = await workerA;
    assert.equal(late.ok, false);
    assert.match(late.error, /lease expired/);
    assert.deepEqual(claimState(busy, queued[0].id), takenOver);
    const lease = busy.db
      .prepare("SELECT * FROM native_worker_lease WHERE id=1")
      .get();
    assert.equal(lease.owner, null);
    assert.equal(lease.last_error, null);
    events.push("day2:stalled-worker-taken-over-without-resend");
    events.push("day2:late-worker-fenced-out");
    closeHost(host);
    host = busy;
    const afterBackup = [
      ...queued,
      await submit(host, alice, accounts.alice, d2, "coin", 4),
    ];
    now += 60000;
    assert.equal((await tick(host)).completed, 1);
    // Bob's next coin is accepted locally but not yet sent when the host dies.
    const unsent = await submit(host, bob, accounts.bob, d2, "coin", 5);
    assert.equal(unsent.state, "queued");
    const paidBeforeLoss = chain.view("get_account", {
      account_id: accounts.alice,
    });

    // ---------------- Day 2: disaster and restore ----------------
    now = at(1, 12.5);
    closeHost(host);
    rmSync(live, { recursive: true, force: true });
    events.push("day2:live-state-lost");
    const restored = join(directory, "restored-state");
    const restoredReport = restore(snapshots, restored);
    assert.equal(restoredReport.snapshot, snapshot.snapshotId);
    signer = loadAwardSigner(join(restored, "reward-attestor.pem"));
    assert.equal(signer.publicKey, chain.view("get_config").attestor);
    host = openHost(restored, "restored");
    // Everything the chain published is still described by a local manifest.
    for (const id of chain.state.days.keys())
      assert.ok(
        host.db.prepare("SELECT 1 FROM native_days WHERE id=?").get(id),
        `Snapshot misses the manifest of ${id}`,
      );
    for (const r of afterBackup)
      assert.equal(claimState(host, r.id), undefined);
    events.push("day2:snapshot-restored-with-attestor");
    now += 60000;
    await tick(host);
    const reconciling = await audit(host);
    assert.deepEqual(
      reconciling.reconciling.map((d) => [d.id, d.unknownChainClaims]),
      [[d2, 3]],
    );
    // The chain already paid these; the restored server must not accept them
    // again, or the contract refuses them and the claim queue jams.
    const refusals = [];
    for (const [player, account, index] of [
      [alice, accounts.alice, 4],
      [bob, accounts.bob, 3],
      [bob, accounts.bob, 5],
    ])
      await assert.rejects(
        submit(host, player, account, d2, "coin", index),
        (e) => {
          refusals.push(e.code);
          return e.code === "NATIVE_RECONCILING";
        },
      );
    assert.equal(
      host.db
        .prepare("SELECT COUNT(*) n FROM native_reward_claims WHERE day_id=?")
        .get(d2).n,
      0,
    );
    assert.deepEqual(
      chain.view("get_account", { account_id: accounts.alice }),
      paidBeforeLoss,
    );
    events.push("day2:restored-day-frozen-chain-payments-kept");

    // ---------------- Day 3 ----------------
    now = at(2, 0.5);
    await tick(host);
    const closedDay1 = chain.view("get_day", { day_id: d1 }).closed;
    assert.equal(closedDay1, true);
    now = at(2, 9);
    const day3 = [
      await submit(host, alice, accounts.alice, d3, "coin", 0),
      await submit(host, bob, accounts.bob, d3, "coin", 1),
      await completeFreeZone(host, bob, accounts.bob, d3),
    ];
    now += 60000;
    assert.equal((await tick(host)).completed, 3);
    assert.ok(dayId(host, 2) && settledEverything(host));
    events.push("day3:play-continued-after-restore");
    // Day 2's grace period ends at local midnight after day 3.
    now = localDateBounds(dates[2], city.timezone).endsAt + HOUR / 2;
    await tick(host);
    assert.equal(chain.view("get_day", { day_id: d2 }).closed, true);
    const final = await audit(host);
    assert.deepEqual(final.reconciling, []);
    events.push("night:days1-2-closed-reserves-released");

    chain.check();
    const receipts = chain.state.receipts.size;
    assert.equal(chain.claimSends(), receipts, "A claim was transmitted twice");
    assert.deepEqual(
      chain.state.rejected.map((r) => r.error),
      [],
      "The contract refused a server transaction",
    );
    const local = host.db
      .prepare(
        "SELECT COUNT(*) n FROM native_reward_claims WHERE state='confirmed'",
      )
      .get().n;
    const player = (a) => chain.view("get_account", { account_id: a });
    return {
      version: 1,
      status: "passed",
      mode: "isolated-synthetic-rehearsal",
      city: city.id,
      dates,
      days: { day1: d1, day2: d2, day3: d3 },
      events,
      backup: {
        snapshot: snapshot.snapshotId,
        integrity: snapshot.integrity,
        nativeServiceKeysIncluded: snapshot.nativeServiceKeysIncluded,
        playerWalletSigningKeysIncluded:
          snapshot.playerWalletSigningKeysIncluded,
      },
      restore: restoredReport,
      takeover: {
        stalledWorkerResult: late.error,
        claimTransmissionsForStalledReceipt: chain.claimSends(queued[0].id),
      },
      reconciliation: {
        frozenDay: d2,
        chainClaimsUnknownAfterRestore: 3,
        lostUnsentClaims: 1,
        refusedResubmissions: refusals,
      },
      native: {
        chainReceipts: receipts,
        claimTransmissions: chain.claimSends(),
        contractRejections: chain.state.rejected.length,
        localConfirmedAfterRestore: local,
        closedDays: [...chain.state.days.values()].filter((d) => d.closed)
          .length,
        alice: player(accounts.alice),
        bob: player(accounts.bob),
        audit: final.status,
      },
      limits: [
        "chain double and generated rehearsal keys, no testnet transaction",
        "synthetic GPS fixes, no device or wallet",
        "same host and same disk, no offsite copy or host replacement",
      ],
    };
  } finally {
    for (const host of hosts) closeHost(host);
    rmSync(directory, { recursive: true, force: true });
  }
}

// Mirrors docs/STATE-RECOVERY.md "Before a real recovery": choose the newest
// verified snapshot, check it before anything opens it, copy database and
// service keys into a fresh private state directory.
function restore(snapshots, target) {
  const names = readdirSync(snapshots)
    .filter((n) => /^\d{8}T\d{6}Z-[a-f0-9]{8}$/.test(n))
    .sort();
  assert.ok(names.length, "No completed snapshot");
  const snapshot = join(snapshots, names.at(-1)),
    metadata = JSON.parse(readFileSync(join(snapshot, "metadata.json"))),
    file = join(snapshot, "database.sqlite");
  assert.equal(
    createHash("sha256").update(readFileSync(file)).digest("hex"),
    metadata.databaseSha256,
  );
  const compatibility = restorePreflight(file, metadata);
  mkdirSync(target, { mode: 0o700 });
  copyFileSync(file, join(target, DB_NAME));
  chmodSync(join(target, DB_NAME), 0o600);
  for (const name of metadata.nativeServiceKeysIncluded) {
    copyFileSync(join(snapshot, name), join(target, name));
    chmodSync(join(target, name), 0o600);
  }
  return {
    snapshot: metadata.snapshotId,
    checksumMatches: true,
    compatibility: compatibility?.status ?? "ok",
    serviceKeysRestored: metadata.nativeServiceKeysIncluded,
  };
}
