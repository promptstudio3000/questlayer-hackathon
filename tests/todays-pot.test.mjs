import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  localDate,
  nativePot,
  practicePot,
  sourceLabel,
  yoctoToGold,
} from "../src/todays-pot.ts";

const proof = JSON.parse(
  readFileSync(new URL("../public/native-distribution-proof.json", import.meta.url)),
);
const NOV1 = Date.parse("2026-11-01T10:00:00Z");

test("yoctoNEAR converts to display GOLD at 1 NEAR = 1,000 GOLD", () => {
  assert.equal(yoctoToGold("1000000000000000000000000"), 1000);
  assert.equal(yoctoToGold("6000000000000000000000"), 6);
  assert.equal(yoctoToGold("1000000000000000000"), 0.001);
  assert.equal(yoctoToGold(null), 0);
  assert.equal(yoctoToGold("not-a-number"), 0);
});

test("local date follows the city time zone, not UTC", () => {
  const lateUtc = Date.parse("2026-11-01T23:30:00Z");
  assert.equal(localDate(lateUtc, "Europe/Prague"), "2026-11-02");
  assert.equal(localDate(lateUtc, "UTC"), "2026-11-01");
});

test("test-network pot reads today's published day and the verified audit", () => {
  const pot = nativePot(proof, null, NOV1, "Europe/Prague");
  assert.equal(pot.ledger, "test-network");
  assert.equal(pot.date, "2026-11-01");
  assert.equal(pot.fundedGold, 12);
  assert.equal(pot.leftGold, 12);
  assert.equal(pot.booksChecked, true);
  assert.equal(pot.source, "sponsor");
  assert.equal(sourceLabel(pot), "Sponsor");
});

test("books are only called checked when the audit verified", () => {
  const pot = nativePot({ ...proof, status: "drift" }, null, NOV1, "Europe/Prague");
  assert.equal(pot.booksChecked, false);
});

test("a day with no publication has no funded number instead of zero", () => {
  const pot = nativePot(proof, null, Date.parse("2026-11-05T10:00:00Z"), "Europe/Prague");
  assert.equal(pot.fundedGold, null);
  assert.equal(pot.leftGold, 0);
});

test("realized yield is named as a source with its share", () => {
  const economy = {
    treasury: { data: { funded: "200000000000000000000000" } },
    staking: { data: { totals: { realizedGameYieldPaid: "50000000000000000000000" } } },
  };
  const pot = nativePot(proof, economy, NOV1, "Europe/Prague");
  assert.equal(pot.source, "sponsor-and-yield");
  assert.equal(pot.yieldShare, 0.25);
  assert.equal(sourceLabel(pot), "Sponsor + staking yield (25 %)");
});

test("practice pot counts reserved backing and today's top-ups only", () => {
  const dashboard = {
    buckets: [
      { bucket: "coins", available_u: 9e9, reserved_u: 3_000_000, paid_u: 0 },
      { bucket: "zones", available_u: 9e9, reserved_u: 6_000_000_000, paid_u: 0 },
    ],
    events: [
      { kind: "simulated-yield", coins_u: 500_000, zones_u: 500_000, created_at: NOV1 - 3600e3 },
      { kind: "simulated-yield", coins_u: 9e9, zones_u: 9e9, created_at: NOV1 - 3 * 86400e3 },
    ],
  };
  const pot = practicePot(dashboard, NOV1, "Europe/Prague");
  assert.equal(pot.ledger, "practice");
  assert.equal(pot.leftGold, 6003);
  assert.equal(pot.fundedGold, null);
  assert.equal(pot.toppedUpGold, 1);
  assert.equal(pot.source, "sponsor-and-yield");
  assert.equal(pot.booksChecked, false);
  assert.equal(sourceLabel(pot), "Sponsor fund + practice yield");
});
