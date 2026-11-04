import test from "node:test";
import assert from "node:assert/strict";
import { runWorldPilot } from "../server/qa/world-pilot.mjs";
test("three local days integrate map recovery, DST, competition, closures, pending receipts and consistent restore", async () => {
  const report = await runWorldPilot();
  assert.equal(report.status, "passed");
  assert.deepEqual(report.localDayHours, [24, 25, 24]);
  assert.equal(report.native.confirmedReceipts, 6);
  assert.equal(report.native.claimSends, 6);
  assert.ok(report.native.closedDays >= 1);
  assert.ok(
    report.events.includes(
      "consistent-backup-restart-recovered-lost-chain-reply",
    ),
  );
  assert.equal(report.demo.closureOperations, 2);
});
