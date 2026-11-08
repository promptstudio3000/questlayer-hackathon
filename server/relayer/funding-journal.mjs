import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import {
  PublicKey,
  actions,
  baseEncode,
  decodeSignedTransaction,
  encodeTransaction,
} from "near-api-js";
import { assert } from "../domain.mjs";
import {
  ensureModuleVersion,
  registerModuleSchema,
} from "../schema-compatibility.mjs";
import { retryLater } from "./errors.mjs";
import { rpcErrorText } from "../near-provider.mjs";
export const FUNDING_JOURNAL_SCHEMA = registerModuleSchema({
  name: "native-funding-journal",
  version: 1,
  sql: `
CREATE TABLE IF NOT EXISTS native_funding_attempts(
 id TEXT NOT NULL, attempt INTEGER NOT NULL, request TEXT NOT NULL, budget_id TEXT NOT NULL,
 hash TEXT NOT NULL UNIQUE, signed_tx TEXT NOT NULL, identity TEXT NOT NULL,
 state TEXT NOT NULL DEFAULT 'prepared', outcome TEXT, created_at INTEGER NOT NULL,
 PRIMARY KEY(id,attempt)
);`,
});
const missing = (e) =>
  /UNKNOWN_TRANSACTION|UnknownTransaction|does not exist/.test(
    `${e?.name}: ${rpcErrorText(e)}`,
  );
const invalidNonce = (e) =>
  /^InvalidNonceError\b|InvalidTxError.*InvalidNonce|Invalid nonce \(ak:/i.test(
    `${e?.name}: ${rpcErrorText(e)}`,
  );
// Same two-sighting rule as the relayer (server/relayer/relay.mjs).
export const FUNDING_SUPERSEDED_CONFIRM_MS = 30000;
const hash = (signed) =>
  baseEncode(
    createHash("sha256").update(encodeTransaction(signed.transaction)).digest(),
  );
const rpcActions = (r) =>
  r.kind === "create-account"
    ? [
        "CreateAccount",
        { Transfer: { deposit: r.principal } },
        {
          AddKey: {
            public_key: r.publicKey,
            access_key: { nonce: 0, permission: "FullAccess" },
          },
        },
      ]
    : [{ Transfer: { deposit: r.principal } }];
function fundingProof(row, response, factoryId, request) {
  const r = response?.final_execution_outcome ?? response;
  if (
    response?.final_execution_status !== "FINAL" ||
    r?.transaction?.hash !== row.hash ||
    r.transaction_outcome?.id !== row.hash ||
    r.transaction.signer_id !== factoryId ||
    r.transaction.receiver_id !== request.accountId ||
    !isDeepStrictEqual(r.transaction.actions, rpcActions(request))
  )
    return null;
  const nodes = new Map(),
    visited = new Set();
  for (const n of r.receipts_outcome ?? []) {
    if (!n.id || nodes.has(n.id)) return null;
    nodes.set(n.id, n);
  }
  const root = r.transaction_outcome.outcome.status?.SuccessReceiptId;
  if (
    !r.transaction_outcome.outcome.receipt_ids?.includes(root) ||
    nodes.get(root)?.outcome.executor_id !== request.accountId
  )
    return null;
  function complete(id) {
    if (visited.has(id)) return true;
    const n = nodes.get(id),
      s = n?.outcome.status;
    if (
      !n ||
      !s ||
      Object.keys(s).length !== 1 ||
      !(
        typeof s.SuccessValue === "string" ||
        s.Failure ||
        typeof s.SuccessReceiptId === "string"
      )
    )
      return false;
    if (
      s.SuccessReceiptId &&
      !n.outcome.receipt_ids?.includes(s.SuccessReceiptId)
    )
      return false;
    visited.add(id);
    return (n.outcome.receipt_ids ?? []).every(complete);
  }
  if (!r.transaction_outcome.outcome.receipt_ids.every(complete)) return null;
  if (nodes.get(root).outcome.status.Failure && r.status?.Failure)
    return "rejected";
  if (
    r.status?.SuccessValue === "" &&
    [...visited].every((id) => nodes.get(id).outcome.status.SuccessValue === "")
  )
    return "succeeded";
  return null;
}
async function transport(factory, request) {
  if (factory.fundingTransport) return factory.fundingTransport(request);
  const publicKey = (await factory.signer.getPublicKey()).toString(),
    identity = JSON.stringify({ account: factory.accountId, publicKey });
  const list =
    request.kind === "create-account"
      ? [
          actions.createAccount(),
          actions.transfer(BigInt(request.principal)),
          actions.addFullAccessKey(PublicKey.fromString(request.publicKey)),
        ]
      : [actions.transfer(BigInt(request.principal))];
  return {
    identity,
    async prepare() {
      const tx = await factory.createSignedTransaction({
        receiverId: request.accountId,
        actions: list,
      });
      return {
        hash: hash(tx),
        signed_tx: Buffer.from(tx.encode()).toString("base64"),
        identity,
      };
    },
    verify(row) {
      const signed = decodeSignedTransaction(
          Buffer.from(row.signed_tx, "base64"),
        ),
        tx = signed.transaction;
      assert(
        row.identity === identity &&
          hash(signed) === row.hash &&
          tx.signerId === factory.accountId &&
          tx.publicKey.toString() === publicKey &&
          tx.receiverId === request.accountId,
        "Saved funding identity changed.",
        503,
        "FUNDING_RECOVERY",
      );
      const old = tx.actions;
      tx.actions = list;
      const matches = hash(signed) === row.hash;
      tx.actions = old;
      assert(
        matches,
        "Saved funding actions changed.",
        503,
        "FUNDING_RECOVERY",
      );
      return signed;
    },
    // A saved transaction may never have been broadcast. Do not ask RPC to
    // wait for FINAL before deciding whether to replay those same bytes.
    status: (row) =>
      factory.provider.viewTransactionStatusWithReceipts({
        txHash: row.hash,
        accountId: factory.accountId,
        waitUntil: "NONE",
      }),
    send(row) {
      return factory.provider.sendTransactionUntil(this.verify(row), "FINAL");
    },
    nonce: (row) => BigInt(decodeSignedTransaction(Buffer.from(row.signed_tx, "base64")).transaction.nonce),
    async keyNonce() {
      const key = await factory.provider.query({
        request_type: "view_access_key",
        account_id: factory.accountId,
        public_key: publicKey,
        finality: "final",
      });
      return BigInt(key.nonce);
    },
  };
}
export class FundingJournal {
  constructor(db, factory, budget, clock = Date.now) {
    ensureModuleVersion(db, FUNDING_JOURNAL_SCHEMA);
    Object.assign(this, { db, factory, budget, clock });
  }
  latest(id) {
    return this.db
      .prepare(
        "SELECT * FROM native_funding_attempts WHERE id=? ORDER BY attempt DESC LIMIT 1",
      )
      .get(id);
  }
  async perform(id, request, { write }) {
    let row = this.latest(id),
      newlyPrepared = false;
    const serialized = JSON.stringify(request);
    assert(
      !row || row.request === serialized,
      "Funding request changed.",
      503,
      "FUNDING_RECOVERY",
    );
    if (row?.state === "succeeded") {
      const result = JSON.parse(row.outcome);
      return result.final_execution_outcome ?? result;
    }
    const t = await transport(this.factory, request);
    if (!row || row.state === "rejected") {
      const previous = row?.attempt ?? 0,
        attempt = previous + 1,
        budgetId = attempt === 1 ? id : `${id}:attempt:${attempt}`;
      const prepared = await t.prepare();
      write(() => {
        assert(
          (this.latest(id)?.attempt ?? 0) === previous,
          "Another worker saved this funding operation.",
          503,
          "FUNDING_RECOVERY",
        );
        this.budget.reserve(budgetId, {
          kind: request.kind,
          accountId: request.accountId,
          principal: request.principal,
        });
        this.db
          .prepare(
            "INSERT INTO native_funding_attempts(id,attempt,request,budget_id,hash,signed_tx,identity,created_at) VALUES(?,?,?,?,?,?,?,?)",
          )
          .run(
            id,
            attempt,
            serialized,
            budgetId,
            prepared.hash,
            prepared.signed_tx,
            prepared.identity,
            this.clock(),
          );
      });
      row = this.latest(id);
      newlyPrepared = true;
    }
    t.verify(row);
    let outcome;
    if (!newlyPrepared) {
      try {
        outcome = await t.status(row);
      } catch (error) {
        if (!missing(error))
          throw retryLater(
            "FUNDING_PENDING",
            "Funding status is unavailable; the saved transaction is retained.",
          );
      }
    }
    if (!outcome) {
      // Fence the send as well as writes after an asynchronous status read.
      write(() => {});
      try {
        outcome = await t.send(row);
      } catch (error) {
        if (error.transactionResult) outcome = error.transactionResult;
        else if (!newlyPrepared && (await this.superseded(t, row, error, write)))
          throw retryLater(
            "FUNDING_RESIGN",
            "The saved funding transaction was superseded by a later nonce; it will be signed again.",
          );
        else
          throw retryLater(
            "FUNDING_PENDING",
            "Funding may already have arrived. The saved transaction will be reconciled.",
          );
      }
    }
    const state = fundingProof(row, outcome, this.factory.accountId, request);
    if (!state)
      throw retryLater(
        "FUNDING_PENDING",
        "Funding does not yet have complete final receipts.",
      );
    write(() => {
      this.db
        .prepare(
          "UPDATE native_funding_attempts SET state=?,outcome=? WHERE id=? AND attempt=? AND state='prepared'",
        )
        .run(state, JSON.stringify(outcome), id, row.attempt);
      this.budget.settle(row.budget_id, row.hash, outcome);
    });
    return outcome.final_execution_outcome ?? outcome;
  }
  // A saved factory transaction that another funding of the same key overtook
  // (its nonce is now at or below the key's final nonce) cannot be included any
  // more. Only when RPC does not know its hash, the node rejects the bytes with
  // InvalidNonce and the key nonce confirms it, twice at least
  // FUNDING_SUPERSEDED_CONFIRM_MS apart, is the attempt `rejected`, its unspent
  // reservation released and a fresh attempt signed by the next perform().
  async superseded(t, row, error, write) {
    if (!invalidNonce(error) || typeof t.keyNonce !== "function" || typeof t.nonce !== "function") return false;
    let keyNonce, txNonce;
    try {
      txNonce = BigInt(t.nonce(row));
      keyNonce = BigInt(await t.keyNonce());
    } catch {
      return false;
    }
    if (keyNonce < txNonce) return false;
    const now = this.clock();
    let seen = null;
    try {
      seen = JSON.parse(row.outcome ?? "null")?.superseded ?? null;
    } catch {
      seen = null;
    }
    const proven = !!seen && now - seen.firstAt >= FUNDING_SUPERSEDED_CONFIRM_MS;
    const observation = {
      superseded: {
        firstAt: seen?.firstAt ?? now,
        lastAt: now,
        count: (seen?.count ?? 0) + 1,
        keyNonce: keyNonce.toString(),
        txNonce: txNonce.toString(),
        error: rpcErrorText(error).slice(0, 160),
      },
    };
    write(() => {
      assert(
        this.latest(row.id)?.hash === row.hash && this.latest(row.id).state === "prepared",
        "Saved funding attempt changed.",
        503,
        "FUNDING_RECOVERY",
      );
      this.db
        .prepare("UPDATE native_funding_attempts SET state=?,outcome=? WHERE id=? AND attempt=? AND state='prepared'")
        .run(proven ? "rejected" : "prepared", JSON.stringify(observation), row.id, row.attempt);
      if (proven) this.budget.release(row.budget_id);
    });
    return proven;
  }
}
