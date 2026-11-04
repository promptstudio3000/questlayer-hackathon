import test from "node:test";
import assert from "node:assert/strict";
import {
  assertNativeLevelClaim,
  NATIVE_LEVEL_POLICY,
} from "../src/native-level-claim.ts";
const account = "alice.testnet",
  now = 1_000_000;
const c = {
  network: "testnet",
  contractId: "nfts.questlayer-dev-20261101.testnet",
  sourceContractId: "questlayer-rewards-20261101b.testnet",
  policy: NATIVE_LEVEL_POLICY,
  level: 2,
  xp: "100",
  state: "issued",
  claim_id: "earned:level:" + "a".repeat(64),
  edition: "polar",
  receiver_id: account,
  expires_at: now + 900_000,
  signature: Buffer.alloc(64).toString("base64"),
};
test("native level signing review binds exact network, contracts, receiver, milestone and expiry", () => {
  assert.doesNotThrow(() =>
    assertNativeLevelClaim(c, account, 2, "polar", now),
  );
  for (const patch of [
    { network: "mainnet" },
    { contractId: "other.testnet" },
    { sourceContractId: "other.testnet" },
    { policy: "old-policy" },
    { level: 3 },
    { edition: "gold" },
    { receiver_id: "bob.testnet" },
    { state: "unknown" },
    { claim_id: "earned:demo:item" },
    { expires_at: now },
    { expires_at: now + 999_999_999 },
    { signature: "bad" },
  ])
    assert.throws(() =>
      assertNativeLevelClaim({ ...c, ...patch }, account, 2, "polar", now),
    );
  assert.doesNotThrow(() =>
    assertNativeLevelClaim(
      { ...c, state: "minted", signature: "", expires_at: now - 1 },
      account,
      2,
      "polar",
      now,
    ),
  );
});
