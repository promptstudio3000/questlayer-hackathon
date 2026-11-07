// Deterministic transaction/receipt model, NOT a NEAR node or external DEX.
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { KeyPair, KeyPairSigner, Transaction, actions, baseEncode } from "near-api-js";
import { openDatabase } from "../../server/database.mjs";
import { QgoldKeeper, keeperSettings } from "../../server/qgold/keeper.mjs";
import { INITIAL_RATE, QGOLD_ONE, YOCTO } from "../../server/qgold/market-math.mjs";

export const NOW = Date.parse("2026-11-06T01:00:00Z");
const hash = (signed) => baseEncode(createHash("sha256").update(signed.transaction.encode()).digest());
const encoded = (v) => ({ SuccessValue: v === undefined ? "" : Buffer.from(JSON.stringify(v)).toString("base64") });
const event = (name, data) => `EVENT_JSON:${JSON.stringify({ standard: "nep141", version: "1.0.0", event: name, data: [data] })}`;
const node = (id, executor_id, status, logs = [], receipt_ids = []) => ({ id, outcome: { executor_id, status, logs, receipt_ids } });

export function keeperOutcome(signed, { reject = false, refund = false, legacy = true } = {}) {
  const tx = signed.transaction, a = tx.actions[0].functionCall, args = JSON.parse(Buffer.from(a.args).toString());
  const id = hash(signed), root = `${id}-root`, dex = `${id}-dex`, output = `${id}-output`, callback = `${id}-callback`;
  const mint = tx.receiverId === "wrap.testnet" ? a.deposit : a.deposit * 99n * QGOLD_ONE / (100n * INITIAL_RATE);
  const swap = a.methodName === "ft_transfer_call", swapAction = swap ? JSON.parse(args.msg).actions[0] : null;
  const amountOut = swap ? BigInt(swapAction.min_amount_out) + 1n : null;
  const failure = { Failure: { ActionError: { kind: "FunctionCallError" } } };
  let status = reject ? failure : swap ? encoded(refund ? "0" : args.amount) : a.methodName === "deposit" ? encoded(String(mint)) : encoded();
  const transferLog = (token, from, to, amount, refunded = false) => legacy && token === "wrap.testnet"
    ? `${refunded ? "Refund" : "Transfer"} ${amount} from ${from} to ${to}`
    : event("ft_transfer", { old_owner_id: from, new_owner_id: to, amount: String(amount) });
  let logs = [];
  if (!reject) {
    if (a.methodName === "near_deposit") logs = [`Deposit ${mint} NEAR to ${tx.signerId}`];
    if (a.methodName === "deposit") logs = [event("ft_mint", { owner_id: tx.signerId, amount: String(mint), memo: "deposit" })];
    if (a.methodName === "ft_burn") logs = [event("ft_burn", { owner_id: tx.signerId, amount: args.amount, memo: args.memo })];
    if (swap) logs = [transferLog(tx.receiverId, tx.signerId, "dex.testnet", args.amount)];
  }
  const receipts = [node(root, tx.receiverId, !reject && swap ? { SuccessReceiptId: callback } : status, logs, !reject && swap ? [dex, callback] : [])];
  if (swap && !reject) {
    receipts.push(node(dex, "dex.testnet", refund ? failure : encoded("0"), [], refund ? [] : [output]));
    if (!refund) receipts.push(node(output, swapAction.token_out, encoded(), [transferLog(swapAction.token_out, "dex.testnet", tx.signerId, amountOut)]));
    receipts.push(node(callback, tx.receiverId, status, refund ? [transferLog(tx.receiverId, "dex.testnet", tx.signerId, args.amount, true)] : []));
  }
  return { final_execution_status: "FINAL", status,
    transaction: { hash: id, signer_id: tx.signerId, public_key: tx.publicKey.toString(), receiver_id: tx.receiverId,
      actions: [{ FunctionCall: { method_name: a.methodName, args: Buffer.from(a.args).toString("base64"), gas: String(a.gas), deposit: String(a.deposit) } }] },
    transaction_outcome: node(id, tx.signerId, { SuccessReceiptId: root }, [], [root]), receipts_outcome: receipts };
}

export function keeperFixture({ dbPath = ":memory:", ledgerPath = ":memory:", secret, mode = "inverse", now = NOW,
  Keeper = QgoldKeeper, leaseClock = Date.now } = {}) {
  const db = openDatabase(dbPath), ledger = new DatabaseSync(ledgerPath);
  ledger.exec("PRAGMA busy_timeout=5000;CREATE TABLE IF NOT EXISTS receipts(tx TEXT PRIMARY KEY,nonce TEXT NOT NULL,method TEXT NOT NULL,request TEXT NOT NULL,outcome TEXT NOT NULL);CREATE TABLE IF NOT EXISTS balances(token TEXT PRIMARY KEY,amount TEXT NOT NULL)");
  for (const token of ["qgold.testnet", "wrap.testnet", "spent", "burned"]) ledger.prepare("INSERT OR IGNORE INTO balances VALUES(?,?)").run(token, "0");
  const balance = (token) => BigInt(ledger.prepare("SELECT amount FROM balances WHERE token=?").get(token).amount);
  const change = (token, delta) => ledger.prepare("UPDATE balances SET amount=? WHERE token=?").run(String(balance(token) + delta), token);
  const key = secret ? KeyPair.fromString(secret) : KeyPair.fromRandom("ed25519"), signer = KeyPairSigner.fromSecretKey(key.toString());
  const account = { accountId: "keeper.testnet", signer,
    async createSignedTransaction({ receiverId, actions: calls }) {
      const nonce = ledger.prepare("SELECT COUNT(*) n FROM receipts").get().n + 1;
      const tx = new Transaction({ signerId: this.accountId, receiverId, actions: calls, publicKey: key.getPublicKey(), nonce: BigInt(nonce), blockHash: new Uint8Array(32) });
      return (await signer.signTransaction(tx)).signedTransaction;
    },
    // Baseline compatibility for regression sensitivity against the original runner.
    async callFunctionRaw({ contractId, methodName, args, gas, deposit }) {
      const signed = await this.createSignedTransaction({ receiverId: contractId, actions: [actions.functionCall(methodName, args, gas, deposit)] });
      return provider.sendTransactionUntil(signed, "FINAL");
    },
  };
  const controls = { reject: null, refund: false, beforeSend: null, afterSend: null, beforeStatus: null, transform: null };
  const provider = {
    viewNodeStatus: async () => ({ chain_id: "test-keeper-model" }),
    viewBlock: async () => ({ header: { height: 101, random_value: "fixed-test-seed" } }),
    viewAccount: async () => ({ amount: String(100n * YOCTO) }),
    async viewTransactionStatusWithReceipts({ txHash }) {
      if (controls.beforeStatus) await controls.beforeStatus(txHash);
      const row = ledger.prepare("SELECT outcome FROM receipts WHERE tx=?").get(txHash);
      if (!row) throw Error("Unknown transaction");
      return JSON.parse(row.outcome);
    },
    async sendTransactionUntil(signed) {
      const tx = hash(signed), a = signed.transaction.actions[0].functionCall;
      if (controls.beforeSend) await controls.beforeSend(a.methodName, signed);
      const exists = ledger.prepare("SELECT outcome FROM receipts WHERE tx=?").get(tx);
      if (exists) return JSON.parse(exists.outcome);
      const reject = controls.reject === a.methodName, args = JSON.parse(Buffer.from(a.args).toString());
      const outcome = keeperOutcome(signed, { reject, refund: controls.refund && a.methodName === "ft_transfer_call" });
      ledger.exec("BEGIN IMMEDIATE");
      try {
        ledger.prepare("INSERT INTO receipts VALUES(?,?,?,?,?)").run(tx, String(signed.transaction.nonce), a.methodName, JSON.stringify(args), JSON.stringify(outcome));
        if (!reject) {
          if (["near_deposit", "deposit"].includes(a.methodName)) {
            change("spent", a.deposit);
            change(signed.transaction.receiverId, a.methodName === "near_deposit" ? a.deposit : a.deposit * 99n * QGOLD_ONE / (100n * INITIAL_RATE));
          } else if (a.methodName === "ft_transfer_call" && !controls.refund) {
            const swap = JSON.parse(args.msg).actions[0];
            if (balance(swap.token_in) < BigInt(args.amount)) throw Error("Model insufficient input balance");
            change(swap.token_in, -BigInt(args.amount)); change(swap.token_out, BigInt(swap.min_amount_out) + 1n);
          } else if (a.methodName === "ft_burn") {
            if (balance("qgold.testnet") < BigInt(args.amount)) throw Error("Model insufficient burn balance");
            change("qgold.testnet", -BigInt(args.amount)); change("burned", BigInt(args.amount));
          }
        }
        ledger.exec("COMMIT");
      } catch (error) { ledger.exec("ROLLBACK"); throw error; }
      if (controls.afterSend) await controls.afterSend(a.methodName, signed);
      return controls.transform ? controls.transform(structuredClone(outcome)) : outcome;
    },
  };
  const multiplier = mode === "sale" ? 1500n : mode === "buyback" ? 1050n : 800n;
  const pool = { near: 1000n * YOCTO, qgold: 1000n * YOCTO * QGOLD_ONE * 1000n / (INITIAL_RATE * multiplier), feeBps: 30 };
  const vault = { contractId: "qgold.testnet", view: async (method) => {
    if (method === "ft_balance_of") return String(balance("qgold.testnet"));
    if (method === "get_state") return { rate: String(INITIAL_RATE), supply: String(10_000_000n * QGOLD_ONE), backing: String(10_000n * YOCTO), fees_total: mode === "inverse" ? "0" : String(5n * YOCTO) };
    throw Error(method);
  } };
  const rhea = { contractId: "dex.testnet", view: async () => ({ token_account_ids: ["wrap.testnet", "qgold.testnet"], amounts: [String(pool.near), String(pool.qgold)], total_fee: 30 }) };
  const settings = { ...keeperSettings({}), execute: true, inverseBudgetYocto: mode === "inverse" ? YOCTO : 0n };
  const options = { vault, rhea, poolId: 7, wnear: "wrap.testnet", provider, account, settings, clock: () => now, leaseClock };
  const keeper = new Keeper(db, options);
  const day = new Date(now).toISOString().slice(0, 10);
  db.prepare("INSERT OR IGNORE INTO qgold_keeper_days VALUES(?,?,?,?,?,?,?,?)")
    .run(day, "model-commitment", "model-salt", now - 100_000, 100, "model-seed", 101, JSON.stringify([now - 1000, ...Array.from({ length: 11 }, (_, i) => now + (i + 1) * 7_200_000)]));
  return { db, ledger, keeper, options, controls, provider, account, balance, change, secret: key.toString(),
    calls: () => ledger.prepare("SELECT * FROM receipts ORDER BY rowid").all(),
    close: () => { if (db.isOpen) db.close(); if (ledger.isOpen) ledger.close(); } };
}
