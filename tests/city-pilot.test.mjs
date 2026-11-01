import test from "node:test";
import assert from "node:assert/strict";
import { runCityPilot } from "../server/qa/city-pilot.mjs";
test("three-day city pilot: backup, restore, post-restore reconciliation and worker takeover", async () => {
  const report = await runCityPilot();
  assert.equal(report.status, "passed");
  assert.equal(report.restore.snapshot, report.backup.snapshot);
  assert.deepEqual(report.restore.serviceKeysRestored, ["reward-attestor.pem"]);
  assert.equal(report.takeover.claimTransmissionsForStalledReceipt, 1);
  assert.match(report.takeover.stalledWorkerResult, /lease expired/);
  assert.equal(report.reconciliation.chainClaimsUnknownAfterRestore, 3);
  assert.deepEqual(report.reconciliation.refusedResubmissions, [
    "NATIVE_RECONCILING",
    "NATIVE_RECONCILING",
    "NATIVE_RECONCILING",
  ]);
  assert.equal(report.native.claimTransmissions, report.native.chainReceipts);
  assert.equal(report.native.contractRejections, 0);
  assert.equal(report.native.closedDays, 2);
  assert.equal(report.native.audit, "verified");
});
