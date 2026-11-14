// Prepaid gas of the reward worker's calls (server/native/reward-worker.mjs).
// A function-call key's allowance must cover the prepaid gas at the pessimistic
// gas price, so each call attaches only what its method needs.
import test from "node:test";
import assert from "node:assert/strict";
import { workerGas } from "../server/native/reward-worker.mjs";

const T = 10n ** 12n;

test("claim_payout attaches what the contract asserts for its batch, plus headroom", () => {
  // contracts/rewards payouts.rs: 20 + leaves x (15 + 10 + 6) TGas.
  for (const n of [1, 3, 8]) {
    const gas = workerGas("claim_payout", { day_id: "payout-2026-11-14-v1", claims: Array(n).fill({}) });
    assert.ok(gas >= BigInt(20 + 31 * n) * T, `batch ${n}`);
    assert.ok(gas <= 300n * T);
  }
  assert.equal(workerGas("claim_payout", { claims: [{}] }), 61n * T);
});

test("state-only calls attach 100 TGas, closes 150, vault maintenance its forward", () => {
  for (const m of ["publish_day", "publish_map_day", "claim_map", "publish_payout_day", "reserve_world_day", "record_world_earned"])
    assert.equal(workerGas(m, {}), 100n * T, m);
  for (const m of ["close_day", "close_map_day", "close_payout_day", "close_world_day", "move_world_to_payout"])
    assert.equal(workerGas(m, {}), 150n * T, m);
  assert.equal(workerGas("claim", {}), 100n * T);
  assert.equal(workerGas("maintain_vault", {}), 280n * T);
});
