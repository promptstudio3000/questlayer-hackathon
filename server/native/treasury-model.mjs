import { assert } from "../domain.mjs";
import { nativeInteger } from "./staking-pool.mjs";

// Executable specification only. Incoming receipt verification belongs to a native adapter.
export class TreasuryModel {
  #state;
  constructor(snapshot) {
    this.#state = snapshot
      ? structuredClone(snapshot)
      : {
          version: 1,
          policy: { version: 1, creatorBps: 0 },
          receipts: [],
          rewards: [],
          available: { creator: "0", coins: "0", zones: "0" },
        };
    assert(this.#state.version === 1, "Unknown treasury model version.");
    this.#invariant();
  }
  snapshot() {
    return structuredClone(this.#state);
  }
  #invariant() {
    const s = this.#state;
    const validPolicy = (p) =>
      Number.isSafeInteger(p?.version) &&
      p.version >= 1 &&
      Number.isInteger(p.creatorBps) &&
      p.creatorBps >= 0 &&
      p.creatorBps <= 10000;
    assert(validPolicy(s.policy), "Invalid allocation policy.");
    for (const reward of s.rewards) {
      assert(
        ["creator", "coins", "zones"].includes(reward.bucket) &&
          ["held", "awarded", "expired"].includes(reward.state) &&
          nativeInteger(reward.amount) > 0n,
        "Invalid reward obligation.",
      );
      assert(
        reward.state === "awarded"
          ? typeof reward.beneficiary === "string" &&
              reward.beneficiary.length > 0
          : reward.beneficiary === null,
        "Invalid reward beneficiary.",
      );
    }
    for (const receipt of s.receipts) {
      assert(
        receipt.kind === "realized_game_yield" &&
          /^[a-f0-9]{64}$/.test(receipt.proofHash) &&
          validPolicy(receipt.policy),
        "Invalid recorded income evidence.",
      );
      const amount = nativeInteger(receipt.amount),
        creator = (amount * BigInt(receipt.policy.creatorBps)) / 10000n,
        coins = (amount - creator) / 2n;
      assert(
        amount > 0n &&
          nativeInteger(receipt.allocation.creator) === creator &&
          nativeInteger(receipt.allocation.coins) === coins &&
          nativeInteger(receipt.allocation.zones) === amount - creator - coins,
        "Recorded allocation does not match its policy.",
      );
    }
    assert(
      new Set(s.receipts.map((r) => r.id)).size === s.receipts.length &&
        new Set(s.rewards.map((r) => r.id)).size === s.rewards.length,
      "Duplicate treasury identifier.",
    );
    for (const bucket of ["creator", "coins", "zones"]) {
      const income = s.receipts.reduce(
        (sum, r) => sum + nativeInteger(r.allocation[bucket]),
        0n,
      );
      const assigned = s.rewards
        .filter((r) => r.bucket === bucket && r.state !== "expired")
        .reduce((sum, r) => sum + nativeInteger(r.amount), 0n);
      assert(
        income === nativeInteger(s.available[bucket]) + assigned,
        "Treasury bucket does not reconcile.",
      );
    }
    for (const receipt of s.receipts)
      assert(
        nativeInteger(receipt.amount) ===
          Object.values(receipt.allocation).reduce(
            (sum, a) => sum + nativeInteger(a),
            0n,
          ),
        "Receipt allocation does not conserve money.",
      );
  }
  #change(fn) {
    const old = this.snapshot();
    try {
      const result = fn();
      this.#invariant();
      return structuredClone(result);
    } catch (error) {
      this.#state = old;
      throw error;
    }
  }
  setPolicy(version, creatorBps) {
    return this.#change(() => {
      assert(
        Number.isSafeInteger(version) &&
          version > this.#state.policy.version &&
          Number.isInteger(creatorBps) &&
          creatorBps >= 0 &&
          creatorBps <= 10000,
        "Invalid future allocation policy.",
      );
      this.#state.policy = { version, creatorBps };
      return this.#state.policy;
    });
  }
  receive({ id, amount, kind, proofHash }) {
    return this.#change(() => {
      amount = nativeInteger(amount);
      assert(
        amount > 0n &&
          typeof id === "string" &&
          id.length > 0 &&
          /^[a-f0-9]{64}$/.test(proofHash),
        "Invalid modeled receipt.",
      );
      assert(
        kind === "realized_game_yield",
        "Principal, retained yield, recovery, refunds and rollover are not game income.",
      );
      const old = this.#state.receipts.find((r) => r.id === id);
      if (old) {
        assert(
          old.amount === amount.toString() &&
            old.kind === kind &&
            old.proofHash === proofHash,
          "Receipt replay changed its evidence.",
        );
        return old;
      }
      const policy = this.#state.policy,
        creator = (amount * BigInt(policy.creatorBps)) / 10000n,
        remaining = amount - creator,
        coins = remaining / 2n;
      const allocation = {
        creator: creator.toString(),
        coins: coins.toString(),
        zones: (remaining - coins).toString(),
      };
      const receipt = {
        id,
        amount: amount.toString(),
        kind,
        proofHash,
        policy: { ...policy },
        allocation,
      };
      this.#state.receipts.push(receipt);
      for (const bucket of Object.keys(allocation))
        this.#state.available[bucket] = (
          nativeInteger(this.#state.available[bucket]) +
          nativeInteger(allocation[bucket])
        ).toString();
      return receipt;
    });
  }
  reserve({ id, bucket, amount }) {
    return this.#change(() => {
      assert(
        ["creator", "coins", "zones"].includes(bucket) &&
          typeof id === "string" &&
          id.length > 0,
        "Invalid reward reservation.",
      );
      amount = nativeInteger(amount);
      const old = this.#state.rewards.find((r) => r.id === id);
      if (old) {
        assert(
          old.bucket === bucket && old.amount === amount.toString(),
          "A reward cannot change its backing.",
        );
        return old;
      }
      const available = nativeInteger(this.#state.available[bucket]);
      assert(
        amount > 0n && amount <= available,
        "Insufficient liquid bucket funding.",
      );
      const reward = {
        id,
        bucket,
        amount: amount.toString(),
        state: "held",
        beneficiary: null,
      };
      this.#state.rewards.push(reward);
      this.#state.available[bucket] = (available - amount).toString();
      return reward;
    });
  }
  award(id, beneficiary) {
    return this.#change(() => {
      const reward = this.#state.rewards.find((r) => r.id === id);
      assert(
        reward && typeof beneficiary === "string" && beneficiary.length > 0,
        "Unknown reward or beneficiary.",
      );
      if (reward.state === "awarded") {
        assert(
          reward.beneficiary === beneficiary,
          "Reward was already awarded to another explorer.",
        );
        return reward;
      }
      assert(reward.state === "held", "Expired backing cannot be awarded.");
      reward.state = "awarded";
      reward.beneficiary = beneficiary;
      return reward;
    });
  }
  expire(id) {
    return this.#change(() => {
      const reward = this.#state.rewards.find((r) => r.id === id);
      assert(reward, "Unknown reward.");
      if (reward.state === "expired") return reward;
      assert(reward.state === "held", "Awarded funds cannot be recycled.");
      reward.state = "expired";
      this.#state.available[reward.bucket] = (
        nativeInteger(this.#state.available[reward.bucket]) +
        nativeInteger(reward.amount)
      ).toString();
      return reward;
    });
  }
}
