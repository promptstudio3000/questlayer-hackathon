import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  M4_PAYOUT_CONFIG,
  compareRewardsSnapshots,
  isM4PayoutConfig,
  liquidAfterDeploy,
  m4ManifestFields,
  pragueHour,
  rewardsBusyReasons,
  snapshotTargets,
  treasuryMismatches,
  utcDates,
  worldDayId,
} from "../scripts/lib/rewards-upgrade.mjs";
import { base58Hex, recordReplacedDeployment } from "../scripts/lib/vault-rollout.mjs";

// Read-only dry-run snapshot of questlayer-rewards-20261101b.testnet
// (10 Nov 2026, old code 2JEV...): public chain views, no keys.
const snapshot = JSON.parse(readFileSync(new URL("./fixtures/rewards-m4-snapshot-20261110.json", import.meta.url)));
const read = (p) => JSON.parse(readFileSync(new URL(`../${p}`, import.meta.url)));

test("the live treasury snapshot is conserved and has no mint in flight", () => {
  assert.deepEqual(treasuryMismatches(snapshot.views.treasury), []);
  assert.deepEqual(rewardsBusyReasons({ treasury: snapshot.views.treasury, progress: snapshot.views.progress }), []);
});

test("treasury conservation catches a broken bucket or award", () => {
  const t = structuredClone(snapshot.views.treasury);
  t.coins.available = (BigInt(t.coins.available) + 1n).toString();
  assert.equal(treasuryMismatches(t).length, 1);
  const u = structuredClone(snapshot.views.treasury);
  u.zones.awarded = "1";
  assert.match(treasuryMismatches(u)[0], /awarded/);
});

test("busy reasons: pending mint, pending leaves, server worker, payout window", () => {
  const t = { ...snapshot.views.treasury, pending: "5" };
  assert.match(rewardsBusyReasons({ treasury: t })[0], /in flight/);
  assert.match(rewardsBusyReasons({ treasury: snapshot.views.treasury, progress: { "payout-2026-11-09-v1": { pending_leaves: 2 } } })[0], /2 payout leaf/);
  assert.deepEqual(rewardsBusyReasons({ treasury: snapshot.views.treasury, progress: { "payout-x": null } }), []);
  const health = { nativeRewards: { queued: 3, last_error: null } };
  assert.match(rewardsBusyReasons({ treasury: snapshot.views.treasury, health })[0], /3 native reward claim/);
  const payouts = [
    { dayId: "payout-2026-11-09-v1", state: "published", leaves: 4, sent: 1 },
    { dayId: "payout-2026-11-08-v1", state: "published", leaves: 4, sent: 4 },
    { dayId: "payout-2026-11-07-v1", state: "empty", leaves: 0, sent: 0 },
  ];
  assert.deepEqual(rewardsBusyReasons({ treasury: snapshot.views.treasury, payouts }).length, 1);
  assert.match(rewardsBusyReasons({ treasury: snapshot.views.treasury, distribution: { status: "failed", reconciling: [] } })[0], /audit failed/);
  assert.match(rewardsBusyReasons({ treasury: snapshot.views.treasury, pragueHour: 0 })[0], /payout worker/);
  assert.deepEqual(rewardsBusyReasons({ treasury: snapshot.views.treasury, pragueHour: 14 }), []);
});

test("Prague hour follows the time zone, including DST", () => {
  assert.equal(pragueHour(Date.UTC(2026, 10, 9, 23, 30)), 0); // CET = UTC+1
  assert.equal(pragueHour(Date.UTC(2026, 6, 1, 22, 30)), 0); // CEST = UTC+2
  assert.equal(pragueHour(Date.UTC(2026, 10, 10, 12, 0)), 13);
});

test("world day ids and UTC dates", () => {
  assert.equal(worldDayId("2026-11-10"), "world-2026-11-10-v1");
  assert.throws(() => worldDayId("10.11.2026"));
  assert.deepEqual(utcDates(Date.UTC(2026, 10, 10, 0, 5)), ["2026-11-08", "2026-11-09", "2026-11-10", "2026-11-11"]);
});

test("snapshot targets come from the public endpoints plus flags", () => {
  const distribution = {
    days: [
      { id: "plzen-2026-11-10-v2" },
      { id: "plzen-2026-11-09-v2" },
      { id: "map-2026-11-04-v1", kind: "map" },
    ],
    checks: [{ name: "date-totals-match-publications", dates: [{ date: "2026-11-01" }] }],
  };
  const mapDay = {
    payouts: [
      { dayId: "payout-2026-11-09-v1", state: "empty", leaves: 0 },
      { dayId: "payout-2026-11-08-v1", state: "closed", leaves: 3 },
    ],
  };
  const t = snapshotTargets({ distribution, mapDay, extraDays: ["plzen-2026-11-11-v2"], extraPayoutDays: ["payout-2026-11-01-v1"], nowMs: Date.UTC(2026, 10, 10, 12) });
  assert.deepEqual(t.days, ["plzen-2026-11-09-v2", "plzen-2026-11-10-v2", "plzen-2026-11-11-v2"]);
  assert.deepEqual(t.mapDays, ["map-2026-11-04-v1"]);
  assert.deepEqual(t.payoutDays, ["payout-2026-11-01-v1", "payout-2026-11-08-v1"]);
  assert.equal(t.dates[0], "2026-11-01");
  assert.ok(t.dates.includes("2026-11-11"));
  assert.deepEqual(snapshotTargets({ nowMs: 0 }).days, []);
});

test("an M4 deploy may change only the payout config and balance-derived budget fields", () => {
  const after = structuredClone(snapshot);
  after.views.payoutConfig = { ...after.views.payoutConfig, ...M4_PAYOUT_CONFIG };
  after.views.worldBudget.liquid_backing = "1";
  after.views.worldBudget.operating_and_storage = "2";
  assert.deepEqual(compareRewardsSnapshots(snapshot, after), []);
  assert.ok(isM4PayoutConfig(after.views.payoutConfig));
  assert.ok(!isM4PayoutConfig(snapshot.views.payoutConfig));
});

test("snapshot comparison catches state drift and a wrong payout config", () => {
  const ok = structuredClone(snapshot);
  ok.views.payoutConfig = { ...ok.views.payoutConfig, ...M4_PAYOUT_CONFIG };
  const t = structuredClone(ok);
  t.views.treasury.owed = "0";
  assert.deepEqual(compareRewardsSnapshots(snapshot, t).map((d) => d.path), ["views.treasury.owed"]);
  const day = structuredClone(ok);
  day.views.days["plzen-2026-11-10-v2"].remaining = "0";
  assert.deepEqual(compareRewardsSnapshots(snapshot, day).map((d) => d.path), ["views.days.plzen-2026-11-10-v2.remaining"]);
  const batch = structuredClone(ok);
  batch.views.payoutConfig.max_batch = 10;
  assert.deepEqual(compareRewardsSnapshots(snapshot, batch).map((d) => d.path), ["views.payoutConfig.max_batch"]);
  const missing = structuredClone(snapshot);
  assert.deepEqual(
    compareRewardsSnapshots(snapshot, missing).map((d) => d.path).sort(),
    ["views.payoutConfig.callback_tgas", "views.payoutConfig.max_batch", "views.payoutConfig.mint_tgas", "views.payoutConfig.reconcile_after_ms"],
  );
  const leaf = structuredClone(ok);
  leaf.views.payoutConfig.min_yocto = "1";
  assert.deepEqual(compareRewardsSnapshots(snapshot, leaf).map((d) => d.path), ["views.payoutConfig.min_yocto"]);
  const raw = structuredClone(ok);
  raw.rawState = { digest: "other" };
  assert.deepEqual(compareRewardsSnapshots(snapshot, raw).map((d) => d.path), ["rawState.STATE"]);
  const noRaw = structuredClone(ok);
  noRaw.rawState = { unavailable: "too large" };
  assert.deepEqual(compareRewardsSnapshots(snapshot, noRaw), []);
});

test("liquid backing after the code size change", () => {
  const wb = { liquid_backing: "1000000000000000000000000" };
  assert.equal(liquidAfterDeploy(wb, 400_000, 410_000), 10n ** 24n - 10_000n * 10n ** 19n);
  assert.equal(liquidAfterDeploy(wb, 410_000, 400_000), 10n ** 24n + 10_000n * 10n ** 19n);
  assert.ok(liquidAfterDeploy({ liquid_backing: "0" }, 1, 2) < 0n);
});

test("manifest record: old rewards build to previousDeployments, pins stay consistent with check-wasm-hashes", () => {
  const manifest = read("public/native-rewards-testnet.json");
  const pins = read("contracts/wasm-sha256.json");
  const file = "public/native-rewards-testnet.json";
  const newSha = pins.contracts.questlayer_rewards;
  const newCodeHash = base58Hex(newSha);
  const oldEntry = pins.testnetDeploymentsNotFromThisBuild[`${file}:wasmSha256`];
  if (manifest.wasmSha256 === newSha) {
    // The M4 upgrade is recorded: the live record matches the build, and the
    // pre-M4 build is kept under previousDeployments as a listed exception.
    assert.equal(oldEntry, undefined);
    assert.equal(manifest.codeHash, newCodeHash);
    assert.equal(manifest.globalRewards.rewardsCodeHash, newCodeHash);
    const prev = manifest.previousDeployments.at(-1);
    assert.equal(base58Hex(prev.wasmSha256), prev.codeHash);
    assert.equal(pins.testnetDeploymentsNotFromThisBuild[`${file}:previousDeployments.${manifest.previousDeployments.length - 1}.wasmSha256`]?.sha256, prev.wasmSha256);
    return;
  }
  // The live record still pins the pre-M4 build, listed as an exception.
  assert.equal(oldEntry?.sha256, manifest.wasmSha256);
  const recorded = recordReplacedDeployment({
    manifest,
    exceptions: pins.testnetDeploymentsNotFromThisBuild,
    manifestFile: file,
    currentPath: "",
    historyKey: "previousDeployments",
    record: { contractId: manifest.contractId, codeHash: manifest.codeHash, wasmSha256: manifest.wasmSha256 },
    extra: { replacedAt: "2026-11-10T12:00:00.000Z", replacedBy: "TX", backup: ".data/contract-backups/x.wasm" },
    hashKeys: { wasmSha256: "questlayer_rewards" },
    newHashes: { wasmSha256: newSha },
    built: pins.contracts,
  });
  const out = m4ManifestFields(recorded.manifest, {
    codeHash: newCodeHash,
    wasmSha256: newSha,
    previousCodeHash: manifest.codeHash,
    transactionHash: "TX",
    verifiedAt: "2026-11-10T12:00:00.000Z",
    sourceCommit: "abc",
    payoutConfig: M4_PAYOUT_CONFIG,
  });
  assert.equal(out.codeHash, newCodeHash);
  assert.equal(base58Hex(out.wasmSha256), out.codeHash);
  assert.equal(out.globalRewards.rewardsCodeHash, newCodeHash, "the global worker and the VPS cron pin the same code hash");
  const prev = out.previousDeployments.at(-1);
  assert.equal(prev.codeHash, manifest.codeHash);
  assert.equal(base58Hex(prev.wasmSha256), prev.codeHash);
  assert.equal(recorded.exceptions[`${file}:wasmSha256`], undefined);
  assert.equal(recorded.exceptions[`${file}:previousDeployments.${recorded.index}.wasmSha256`].sha256, manifest.wasmSha256);
  assert.equal(out.transactions.at(-1).transaction, "TX");
  assert.equal(out.callbackRecoveryUpgrade.payoutMaxBatch, 8);
  // Untouched: worker methods, factory, the earlier upgrade record.
  assert.deepEqual(out.workerMethods, manifest.workerMethods);
  assert.deepEqual(out.factory, manifest.factory);
  assert.deepEqual(out.worldReservationUpgrade, manifest.worldReservationUpgrade);
  // A global pin that already moved elsewhere is not overwritten.
  const other = m4ManifestFields({ ...manifest, globalRewards: { rewardsCodeHash: "X" } }, { codeHash: newCodeHash, wasmSha256: newSha, previousCodeHash: manifest.codeHash, transactionHash: "TX", verifiedAt: "t", sourceCommit: null, payoutConfig: M4_PAYOUT_CONFIG });
  assert.equal(other.globalRewards.rewardsCodeHash, "X");
});
