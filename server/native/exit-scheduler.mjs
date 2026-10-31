import { assert } from "../domain.mjs";
import { nativeInteger } from "./staking-pool.mjs";

// Executable protocol specification. This does not submit transactions or verify receipts.
// A native adapter must authenticate callbacks, reconcile actual pool state and persist atomically.
export class ExitScheduler {
  #state;
  constructor(snapshot) {
    this.#state = snapshot
      ? structuredClone(snapshot)
      : { version: 1, next: 1, queued: [], batch: null, closed: [] };
    assert(this.#state.version === 1, "Unknown exit model version.");
    this.#invariant();
  }
  snapshot() {
    return structuredClone(this.#state);
  }
  #invariant() {
    const s = this.#state;
    assert(
      Number.isSafeInteger(s.next) &&
        s.next > 0 &&
        Array.isArray(s.queued) &&
        Array.isArray(s.closed),
      "Invalid exit state.",
    );
    const tickets = [
      ...s.queued,
      ...(s.batch?.tickets || []),
      ...s.closed.flatMap((b) => b.tickets),
    ];
    assert(
      new Set(tickets.map((t) => t.id)).size === tickets.length,
      "Duplicate exit ticket.",
    );
    for (const ticket of tickets) {
      assert(
        typeof ticket.id === "string" &&
          ticket.id.length > 0 &&
          typeof ticket.owner === "string" &&
          ticket.owner.length > 0 &&
          ["principal", "retained_yield", "game_yield"].includes(ticket.kind),
        "Invalid exit ticket.",
      );
      assert(nativeInteger(ticket.amount) > 0n, "Empty exit.");
    }
    const batches = [...(s.batch ? [s.batch] : []), ...s.closed];
    assert(
      new Set(batches.map((b) => b.id)).size === batches.length,
      "Duplicate batch identifier.",
    );
    assert(
      new Set(s.closed.map((b) => b.receiptId)).size === s.closed.length,
      "Duplicate received cash receipt.",
    );
    for (const batch of batches) {
      assert(
        typeof batch.id === "string" &&
          batch.tickets.length > 0 &&
          Number.isSafeInteger(batch.submittedEpoch) &&
          batch.submittedEpoch >= 0,
        "Invalid batch obligation.",
      );
      assert(
        nativeInteger(batch.amount) ===
          batch.tickets.reduce((sum, t) => sum + nativeInteger(t.amount), 0n),
        "Batch amount does not reconcile.",
      );
      if (s.closed.includes(batch)) {
        assert(
          batch.stage === "received" &&
            typeof batch.receiptId === "string" &&
            batch.receiptId.length > 0,
          "Invalid received batch.",
        );
        assert(
          nativeInteger(batch.received) ===
            nativeInteger(batch.amount) +
              nativeInteger(batch.unclassifiedSurplus),
          "Received cash does not reconcile.",
        );
        assert(
          Number.isSafeInteger(batch.unlockEpoch) &&
            batch.unlockEpoch >= batch.submittedEpoch + 4,
          "Invalid settled unlock epoch.",
        );
      }
    }
    if (s.batch) {
      assert(
        ["unstake_pending", "unlocking", "withdraw_pending"].includes(
          s.batch.stage,
        ),
        "Invalid batch stage.",
      );
      assert(
        nativeInteger(s.batch.amount) ===
          s.batch.tickets.reduce((sum, t) => sum + nativeInteger(t.amount), 0n),
        "Batch amount does not reconcile.",
      );
      if (s.batch.stage !== "unstake_pending")
        assert(
          Number.isSafeInteger(s.batch.unlockEpoch),
          "Missing unlock epoch.",
        );
    }
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
  enqueue({ id, owner, amount, kind }) {
    return this.#change(() => {
      amount = nativeInteger(amount).toString();
      const previous = [
        ...this.#state.queued,
        ...(this.#state.batch?.tickets || []),
        ...this.#state.closed.flatMap((b) => b.tickets),
      ].find((t) => t.id === id);
      if (previous) {
        assert(
          previous.owner === owner &&
            previous.amount === amount &&
            previous.kind === kind,
          "An exit identifier cannot change its obligation.",
        );
        return previous;
      }
      const ticket = { id, owner, amount, kind };
      this.#state.queued.push(ticket);
      return ticket;
    });
  }
  seal(epoch) {
    return this.#change(() => {
      assert(Number.isSafeInteger(epoch) && epoch >= 0, "Invalid epoch.");
      assert(
        !this.#state.batch,
        "An older batch must finish before another unstake.",
      );
      assert(this.#state.queued.length > 0, "No queued exits.");
      const tickets = this.#state.queued;
      const batch = {
        id: `exit-${this.#state.next++}`,
        stage: "unstake_pending",
        submittedEpoch: epoch,
        unlockEpoch: null,
        tickets,
        amount: tickets
          .reduce((sum, t) => sum + nativeInteger(t.amount), 0n)
          .toString(),
      };
      nativeInteger(batch.amount);
      this.#state.queued = [];
      this.#state.batch = batch;
      return batch;
    });
  }
  acknowledgeUnstake(id, { success, confirmedEpoch }) {
    return this.#change(() => {
      assert(typeof success === "boolean", "Invalid unstake outcome.");
      const batch = this.#state.batch;
      assert(
        batch?.id === id && batch.stage === "unstake_pending",
        "Unexpected unstake callback.",
      );
      assert(
        Number.isSafeInteger(confirmedEpoch) &&
          confirmedEpoch >= batch.submittedEpoch,
        "Invalid confirmation epoch.",
      );
      if (!success) {
        this.#state.queued = [...batch.tickets, ...this.#state.queued];
        this.#state.batch = null;
        return { retryable: true };
      }
      batch.unlockEpoch = confirmedEpoch + 4;
      batch.stage = "unlocking";
      return batch;
    });
  }
  beginWithdraw(id, { epoch, poolCanWithdraw }) {
    return this.#change(() => {
      const batch = this.#state.batch;
      assert(
        batch?.id === id && batch.stage === "unlocking",
        "No matching unlocking batch.",
      );
      assert(
        Number.isSafeInteger(epoch) &&
          epoch >= batch.unlockEpoch &&
          poolCanWithdraw === true,
        "The pool has not released this batch.",
      );
      batch.stage = "withdraw_pending";
      return batch;
    });
  }
  acknowledgeWithdraw(id, { success, receiptId, received }) {
    return this.#change(() => {
      assert(typeof success === "boolean", "Invalid withdrawal outcome.");
      const closed = this.#state.closed.find((b) => b.id === id);
      if (closed) {
        assert(
          success &&
            closed.receiptId === receiptId &&
            closed.received === nativeInteger(received).toString(),
          "Settled batch cannot be rewritten.",
        );
        return closed;
      }
      const batch = this.#state.batch;
      assert(
        batch?.id === id && batch.stage === "withdraw_pending",
        "Unexpected withdrawal callback.",
      );
      if (!success) {
        batch.stage = "unlocking";
        return { retryable: true };
      }
      assert(
        typeof receiptId === "string" &&
          receiptId.length > 0 &&
          !this.#state.closed.some((b) => b.receiptId === receiptId),
        "Withdrawal receipt already used.",
      );
      received = nativeInteger(received);
      assert(
        received >= nativeInteger(batch.amount),
        "Partial liquidity cannot settle the whole batch.",
      );
      const settled = {
        ...batch,
        stage: "received",
        receiptId,
        received: received.toString(),
        unclassifiedSurplus: (
          received - nativeInteger(batch.amount)
        ).toString(),
      };
      this.#state.closed.push(settled);
      this.#state.batch = null;
      return settled;
    });
  }
}
