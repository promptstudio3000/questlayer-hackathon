import test from "node:test";
import assert from "node:assert/strict";
import {
  PAYOUT_MIN_YOCTO,
  buildPayoutDay,
  claimBatches,
  payoutDayId,
  payoutLeaf,
  verifyPayoutClaim,
} from "../server/payouts/payout-tree.mjs";

test("leaf matches the contract's fixed vector", () => {
  assert.equal(
    payoutLeaf("payout-2026-11-05-v1", 7, "alice.testnet", 12345n),
    "52fab85dc3cbfbaffe1d994f86f635123b13482655c6cb1110e44507905c9235",
  );
});

test("a day sums per account, carries dust and proves every leaf", () => {
  const dayId = payoutDayId("2026-11-05");
  const Y = PAYOUT_MIN_YOCTO;
  const day = buildPayoutDay({
    dayId,
    coinsShareYocto: 10n * Y,
    entries: [
      { accountId: "bob.testnet", amountYocto: 2n * Y },
      { accountId: "alice.testnet", amountYocto: 3n * Y },
      { accountId: "bob.testnet", amountYocto: 3n * Y },
      { accountId: "carol.testnet", amountYocto: 4n * Y },
      { accountId: "dust.testnet", amountYocto: Y - 1n },
    ],
  });
  assert.deepEqual(
    day.claims.map((c) => [c.index, c.account_id, c.amount_yocto]),
    [
      [0, "alice.testnet", String(3n * Y)],
      [1, "bob.testnet", String(5n * Y)],
      [2, "carol.testnet", String(4n * Y)],
    ],
  );
  assert.deepEqual(day.carry, [{ accountId: "dust.testnet", amountYocto: Y - 1n }]);
  assert.equal(day.publish.leaves, 3);
  assert.equal(day.publish.coins_yocto, String(10n * Y));
  assert.equal(day.publish.zones_yocto, String(2n * Y));
  for (const c of day.claims) assert.ok(verifyPayoutClaim(dayId, day.root, c));
  assert.ok(!verifyPayoutClaim(dayId, day.root, { ...day.claims[0], account_id: "mallory.testnet" }));
  assert.ok(!verifyPayoutClaim(dayId, day.root, { ...day.claims[0], amount_yocto: String(9n * Y) }));
  // Same input in another order, same root.
  const again = buildPayoutDay({ dayId, entries: [...day.claims].reverse().map((c) => ({ accountId: c.account_id, amountYocto: c.amount_yocto })) });
  assert.equal(again.root, day.root);
});

test("claims go out in batches of eight", () => {
  const dayId = payoutDayId("2026-11-06");
  const entries = Array.from({ length: 23 }, (_, i) => ({ accountId: `p${String(i).padStart(2, "0")}.testnet`, amountYocto: PAYOUT_MIN_YOCTO }));
  const batches = claimBatches(buildPayoutDay({ dayId, entries }));
  assert.deepEqual(batches.map((b) => b.claims.length), [8, 8, 7]);
  assert.ok(batches.every((b) => b.day_id === dayId));
});
