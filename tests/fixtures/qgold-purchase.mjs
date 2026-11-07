import { randomUUID } from "node:crypto";
import { createPlayer, openDatabase } from "../../server/database.mjs";
import { BURN_KINDS } from "../../server/gold-spend/ledger.mjs";
import { createGoldSpend } from "../../server/gold-spend/service.mjs";
import {
  runPurchase,
  purchaseRow,
} from "../../server/gold-spend/purchases.mjs";
import {
  prepareQgoldBurn,
  confirmQgoldBurn,
  ensureQgoldBurns,
} from "../../server/gold-spend/qgold-burn.mjs";
export const TOKEN = "qgold.testnet",
  OWNER = "alice.testnet",
  RELAYER = "relay.testnet",
  HASH = "8".repeat(44);
const node = (id, executor_id, status, receipt_ids = [], logs = []) => ({
  id,
  outcome: { executor_id, status, receipt_ids, logs },
});
export function burnOutcome(
  p,
  { hash = HASH, delegated = false, failed = false, expired = false } = {},
) {
  const action = {
    FunctionCall: {
      method_name: "ft_burn",
      deposit: "1",
      gas: 30_000_000_000_000,
      args: Buffer.from(
        JSON.stringify({ amount: String(p.amount_u), memo: p.memo }),
      ).toString("base64"),
    },
  };
  const failure = {
    ActionError: {
      kind: expired
        ? { DelegateActionExpired: {} }
        : { FunctionCallError: "balance" },
    },
  };
  const burn = node(
    "burn",
    p.contract_id,
    failed ? { Failure: failure } : { SuccessValue: "" },
    ["refund"],
    [
      `EVENT_JSON:${JSON.stringify({ standard: "nep141", version: "1.0.0", event: "ft_burn", data: [{ owner_id: p.account_id, amount: String(p.amount_u), memo: p.memo }] })}`,
    ],
  );
  const root = delegated ? "delegate" : "burn";
  return {
    final_execution_status: "FINAL",
    transaction: {
      hash,
      signer_id: delegated ? RELAYER : p.account_id,
      receiver_id: delegated ? p.account_id : p.contract_id,
      actions: [
        delegated
          ? {
              Delegate: {
                delegate_action: {
                  sender_id: p.account_id,
                  receiver_id: p.contract_id,
                  actions: [action],
                  nonce: 7,
                  max_block_height: 100,
                },
              },
            }
          : action,
      ],
    },
    transaction_outcome: node(
      hash,
      delegated ? RELAYER : p.account_id,
      { SuccessReceiptId: root },
      [root],
    ),
    status: failed || expired ? { Failure: failure } : { SuccessValue: "" },
    receipts_outcome: [
      ...(delegated
        ? [
            node(
              "delegate",
              p.account_id,
              expired ? { Failure: failure } : { SuccessValue: "" },
              expired ? [] : ["burn"],
            ),
          ]
        : []),
      ...(!expired
        ? [burn, node("refund", p.account_id, { SuccessValue: "" })]
        : []),
    ],
  };
}
export function purchaseFixture({
  file = ":memory:",
  db = openDatabase(file),
  player = createPlayer(db, "Buyer"),
  owner = OWNER,
  token = TOKEN,
} = {}) {
  ensureQgoldBurns(db);
  const gold = createGoldSpend(db),
    id = randomUUID(),
    submitterId = randomUUID();
  const run = (
    input = { sku: "emote:dragon" },
    purchaseId = id,
    work = () => gold.buy(player, input),
  ) =>
    runPurchase(
      db,
      { player, id: purchaseId, path: "/api/gold/buy", input },
      work,
    );
  return {
    db,
    player,
    gold,
    id,
    submitterId,
    run,
    row: () => purchaseRow(db, player, id),
    prepare: (options = {}) =>
      prepareQgoldBurn({
        db,
        player,
        intentId: id,
        submitterId,
        contract: token,
        accountId: owner,
        kinds: BURN_KINDS,
        ...options,
      }),
    confirm: (outcome, options = {}) =>
      confirmQgoldBurn(db, {
        player,
        intentId: id,
        accountIds: [owner],
        contract: token,
        txHash: HASH,
        relayerId: RELAYER,
        txStatus: async () => outcome,
        ...options,
      }),
  };
}
