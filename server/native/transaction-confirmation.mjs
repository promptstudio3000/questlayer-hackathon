import {
  readTransactionAnchor,
  requireTransactionAfter,
  validReceiptStatus,
} from "./transaction-anchor.mjs";
import { isDeepStrictEqual } from "node:util";
import { assert } from "../domain.mjs";
import { nearAccountId } from "../identity/near.mjs";
import { FACTORY_ID, VAULT_POOLS } from "./vaults.mjs";
import { SOCIAL_TESTNET, SOCIAL_CODE_HASH } from "./social-profile.mjs";

import { existsSync, readFileSync } from "node:fs";
import { NETWORK, NETWORK_LABEL, MANIFEST_SET } from "./network.mjs";
import { isNativeAuraTokenId, isNativeEdition } from "../aura-catalog.mjs";
// Contract identities are pinned by the reviewed public manifests, so a redeploy
// under a new account only changes the manifests and their recorded code hashes.
// A network may lack a slice (mainnet ships without market and rewards, see
// docs/MAINNET-PLAN.md §1): its id is then null, no receiver matches it and
// any action that would need it answers "configuration unavailable".
const manifest = (name) => {
  const url = new URL(`../../public/${name}.json`, import.meta.url);
  return existsSync(url) ? JSON.parse(readFileSync(url, "utf8")) : {};
};
const MARKET_ID = manifest(`native-market-${MANIFEST_SET}`).marketContract ?? null;
const NFT_ID = manifest(`native-claims-${MANIFEST_SET}`).contractId ?? null;
const REWARDS_ID = manifest(`native-rewards-${MANIFEST_SET}`).contractId ?? null;
const integer = (value) => Number.isSafeInteger(value) && value >= 0;
const amount = (value) =>
  typeof value === "string" &&
  /^(0|[1-9]\d{0,38})$/.test(value) &&
  BigInt(value) < 2n ** 128n;
const aura = (value) =>
  typeof value === "string" &&
  isNativeAuraTokenId(value);
const keys = (value, expected) =>
  value &&
  typeof value === "object" &&
  !Array.isArray(value) &&
  isDeepStrictEqual(Object.keys(value).sort(), [...expected].sort());
export function nativeCodeFingerprint(hex) {
  assert(
    typeof hex === "string" && /^[a-f0-9]{64}$/i.test(hex),
    "A reviewed native code fingerprint is required.",
    503,
  );
  const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  let n = BigInt("0x" + hex),
    result = "";
  while (n > 0n) {
    result = alphabet[Number(n % 58n)] + result;
    n /= 58n;
  }
  for (let i = 0; i < hex.length && hex.slice(i, i + 2) === "00"; i += 2)
    result = "1" + result;
  return result;
}
function decodeJson(value) {
  assert(
    typeof value === "string" &&
      value.length <= 32768 &&
      value.length % 4 === 0 &&
      /^[A-Za-z0-9+/]*={0,2}$/.test(value),
    "Invalid native receipt encoding.",
    409,
  );
  const bytes = Buffer.from(value, "base64");
  assert(
    bytes.toString("base64") === value,
    "Invalid native receipt encoding.",
    409,
  );
  try {
    return JSON.parse(bytes.toString("utf8"));
  } catch {
    assert(false, "Invalid native receipt data.", 409);
  }
}

// Read-only confirmation. Reviewed quotes are comparison context, never spending
// authority. No key, signer, transfer or local credit mutation is available here.
export class NativeTransactionConfirmation {
  constructor(
    db,
    provider,
    {
      rewardsConfig,
      marketManifest,
      claimsManifest,
      vaults,
      timeoutMs = 12000,
      clock = Date.now,
    } = {},
  ) {
    this.db = db;
    this.provider = provider;
    this.rewards = rewardsConfig;
    this.market = marketManifest;
    this.claims = claimsManifest;
    this.vaults = vaults;
    this.timeoutMs = timeoutMs;
    this.clock = clock;
    assert(
      integer(timeoutMs) && timeoutMs > 0 && timeoutMs <= 30000,
      "Invalid confirmation timeout.",
    );
  }
  linked(player, accountId) {
    nearAccountId(accountId);
    assert(
      this.db
        .prepare(
          "SELECT 1 FROM wallet_links WHERE player_id=? AND account_id=?",
        )
        .get(player, accountId),
      "Link this NEAR wallet before checking its transaction.",
      403,
    );
  }
  async bounded(promise, deadline) {
    let timer;
    try {
      return await Promise.race([
        promise,
        new Promise((_, reject) => {
          timer = setTimeout(
            () => {
              const error = new Error(
                "NEAR confirmation is unavailable. Keep the transaction reference and refresh before retrying.",
              );
              error.status = 503;
              error.code = "NATIVE_CONFIRMATION_UNAVAILABLE";
              reject(error);
            },
            Math.max(0, deadline - Date.now()),
          );
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }
  rewardConfiguration() {
    assert(
      this.rewards?.network === NETWORK &&
        this.rewards.contractId === REWARDS_ID &&
        typeof this.rewards.codeHash === "string",
      "The reviewed reward configuration is unavailable.",
      503,
    );
    return this.rewards;
  }
  nftConfiguration() {
    assert(
      this.claims?.network === NETWORK && this.claims.contractId === NFT_ID,
      "The reviewed collection configuration is unavailable.",
      503,
    );
    return nativeCodeFingerprint(this.claims.wasmSha256);
  }
  marketConfiguration() {
    assert(
      this.market?.network === NETWORK &&
        this.market.marketContract === MARKET_ID &&
        this.market.nftContract === NFT_ID,
      "The reviewed market configuration is unavailable.",
      503,
    );
    return nativeCodeFingerprint(this.market.wasmSha256);
  }
  async policy(accountId, quote, deadline) {
    const { receiverId, methodName: method, args, deposit, gas } = quote;
    const pinned = new Map();
    let result = "true";
    if (
      FACTORY_ID &&
      (receiverId === FACTORY_ID || receiverId.endsWith("." + FACTORY_ID))
    ) {
      const cfg = this.rewardConfiguration();
      assert(
        cfg.factory?.contractId === FACTORY_ID &&
          this.vaults?.contractId === FACTORY_ID,
        "The reviewed vault factory is unavailable.",
        503,
      );
      await this.bounded(this.vaults.validate(), deadline);
      pinned.set(FACTORY_ID, { code: cfg.factory.codeHash });
      pinned.set(REWARDS_ID, { code: cfg.codeHash });
      if (receiverId === FACTORY_ID) {
        if (method === "create_position") {
          assert(
            keys(args, ["pool_id", "contribution_bps"]) &&
              VAULT_POOLS.some((p) => p.id === args.pool_id) &&
              integer(args.contribution_bps) &&
              args.contribution_bps <= 10000 &&
              deposit === cfg.factory.setupDeposit,
            "Invalid reviewed position creation.",
            409,
          );
        } else if (method === "register_position") {
          assert(
            keys(args, ["id"]) &&
              typeof args.id === "string" &&
              /^\d{1,20}$/.test(args.id) &&
              deposit === "0",
            "Invalid reviewed position registration.",
            409,
          );
          const positions = await this.bounded(
            this.vaults.positions(accountId, true),
            deadline,
          );
          assert(
            positions.some(
              (p) => p.id === args.id && p.beneficiary === accountId,
            ),
            "Only your own factory position can be confirmed.",
            403,
          );
        } else
          assert(
            method === "withdraw_refund" && keys(args, []) && deposit === "1",
            "Unsupported factory confirmation.",
            409,
          );
      } else {
        const v2 = ["request_partial_exit", "set_contribution"].includes(method);
        assert(
          ([
            "deposit_and_stake",
            "request_exit",
            "withdraw_owner",
            "refresh",
            "advance",
          ].includes(method) &&
            keys(args, [])) ||
            (method === "request_partial_exit" &&
              keys(args, ["amount"]) &&
              typeof args.amount === "string" &&
              /^[1-9]\d{0,38}$/.test(args.amount) &&
              BigInt(args.amount) >= 10n ** 21n &&
              BigInt(args.amount) < 2n ** 128n) ||
            (method === "set_contribution" &&
              keys(args, ["contribution_bps"]) &&
              Number.isInteger(args.contribution_bps) &&
              args.contribution_bps >= 0 &&
              args.contribution_bps <= 10000),
          "Unsupported vault confirmation.",
          409,
        );
        const positions = await this.bounded(
          this.vaults.positions(accountId, true),
          deadline,
        );
        const position = positions.find(
          (p) =>
            p.account_id === receiverId &&
            p.beneficiary === accountId &&
            p.state === "ready",
        );
        assert(
          position,
          "Only your own registered factory position can be confirmed.",
          403,
        );
        const state = await this.bounded(this.vaults.state(position), deadline);
        assert(
          !v2 || state?.version === 2,
          "This position has no partial exit or contribution change.",
          409,
        );
        pinned.set(receiverId, {
          code: cfg.factory.vaultCodeHash,
          keyless: true,
        });
        if (method === "deposit_and_stake")
          assert(
            BigInt(deposit) >= 10n ** 21n &&
              BigInt(deposit) <= 1000n * 10n ** 24n,
            "Invalid staking deposit.",
            409,
          );
        else
          assert(
            deposit ===
              ([
                "request_exit",
                "withdraw_owner",
                "request_partial_exit",
                "set_contribution",
              ].includes(method)
                ? "1"
                : "0"),
            "Invalid staking authorization deposit.",
            409,
          );
      }
    } else if (receiverId === MARKET_ID) {
      pinned.set(MARKET_ID, { code: this.marketConfiguration() });
      pinned.set(NFT_ID, { code: this.nftConfiguration() });
      // Version 2 signed orders: the contract re-verifies every signature,
      // nonce, epoch and deadline; this check pins shape, target and amounts.
      const signedOrder = (o) =>
        keys(o, [
          "message",
          "nonce",
          "recipient",
          "callback_url",
          "public_key",
          "signature",
        ]) &&
        o.recipient === MARKET_ID &&
        o.callback_url === null &&
        typeof o.message === "string" &&
        o.message.length <= 1024 &&
        typeof o.nonce === "string" &&
        typeof o.signature === "string" &&
        typeof o.public_key === "string" &&
        o.public_key.startsWith("ed25519:");
      const orderTerms = (o) => {
        try {
          return JSON.parse(o.message);
        } catch {
          return null;
        }
      };
      if (method === "withdraw")
        assert(
          keys(args, []) && deposit === "1",
          "Invalid market withdrawal.",
          409,
        );
      else if (method === "add_signing_key" || method === "remove_signing_key") {
        result = "unit";
        assert(
          keys(args, ["public_key"]) &&
            /^ed25519:[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(String(args.public_key)) &&
            deposit === "1",
          "Invalid order signing key change.",
          409,
        );
      } else if (method === "cancel_all_orders") {
        result = "any";
        assert(
          keys(args, []) && deposit === "1",
          "Invalid order cancellation.",
          409,
        );
      } else if (method === "deposit_near") {
        result = "any";
        assert(
          keys(args, []) && amount(deposit) && BigInt(deposit) >= 10n ** 21n,
          "Invalid market deposit.",
          409,
        );
      } else if (
        method === "cancel_order" ||
        method === "fill_buy_order" ||
        method === "fill_sell_order"
      ) {
        const terms =
          keys(args, ["order"]) && signedOrder(args.order)
            ? orderTerms(args.order)
            : null;
        assert(
          terms &&
            terms.market === MARKET_ID &&
            aura(terms.token_id) &&
            amount(terms.price) &&
            (method === "fill_sell_order"
              ? terms.kind === "sell" && deposit === terms.price
              : deposit === "1") &&
            (method !== "fill_buy_order" || terms.kind === "buy"),
          "Invalid signed market order.",
          409,
        );
        if (method === "cancel_order") result = "unit";
      } else {
        assert(
          ["buy", "cancel"].includes(method) &&
            keys(args, ["token_id", "listing_id"]) &&
            aura(args.token_id) &&
            integer(args.listing_id) &&
            args.listing_id > 0,
          "Invalid market action.",
          409,
        );
        assert(
          method === "buy" ? BigInt(deposit) > 0n : deposit === "1",
          "Invalid market deposit.",
          409,
        );
      }
    } else if (receiverId === NFT_ID) {
      pinned.set(NFT_ID, { code: this.nftConfiguration() });
      if (method === "nft_transfer_call") {
        pinned.set(MARKET_ID, { code: this.marketConfiguration() });
        assert(
          deposit === "1" &&
            keys(args, [
              "receiver_id",
              "token_id",
              "approval_id",
              "memo",
              "msg",
            ]) &&
            args.receiver_id === MARKET_ID &&
            aura(args.token_id) &&
            args.approval_id === null &&
            args.memo === null &&
            typeof args.msg === "string" &&
            args.msg.length < 256,
          "Invalid reviewed Aura listing.",
          409,
        );
        let message;
        try {
          message = JSON.parse(args.msg);
        } catch {
          assert(false, "Invalid Aura listing terms.", 409);
        }
        assert(
          (keys(message, ["deposit"]) && message.deposit === true) ||
            (keys(message, ["price"]) &&
              amount(message.price) &&
              BigInt(message.price) > 0n),
          "Invalid Aura listing price.",
          409,
        );
        // near-contract-standards 5.30 resolver returns true when the receiver
        // keeps the token, false when ownership is returned. Not nft_on_transfer.
      } else {
        if (method === "mint_avatar") {
          assert(
            keys(args, []) && deposit === "50000000000000000000000",
            "Invalid avatar mint.",
            409,
          );
          result = "avatar";
        } else if (method === "redeem_aura") {
          assert(
            keys(args, [
              "claim_id",
              "edition",
              "receiver_id",
              "expires_at_ms",
              "signature",
            ]) &&
              args.receiver_id === accountId &&
              typeof args.claim_id === "string" &&
              args.claim_id.startsWith("earned:") &&
              args.claim_id.length <= 160 &&
              isNativeEdition(args.edition) &&
              integer(args.expires_at_ms) &&
              typeof args.signature === "string" &&
              args.signature.length === 88 &&
              deposit === "50000000000000000000000",
            "Invalid Aura claim.",
            409,
          );
          result = "aura";
        } else {
          assert(
            ["equip_aura", "unequip_aura"].includes(method) &&
              keys(
                args,
                method === "equip_aura" ? ["token_id", "slot"] : ["slot"],
              ) &&
              ["above", "below"].includes(args.slot) &&
              (method !== "equip_aura" || aura(args.token_id)) &&
              deposit === "0",
            "Invalid equipment action.",
            409,
          );
          result = "unit";
        }
      }
    } else if (receiverId === REWARDS_ID) {
      const cfg = this.rewardConfiguration();
      pinned.set(REWARDS_ID, { code: cfg.codeHash });
      assert(
        method === "withdraw" && keys(args, []) && deposit === "1",
        "Unsupported native reward confirmation.",
        409,
      );
    } else if (receiverId === SOCIAL_TESTNET) {
      pinned.set(SOCIAL_TESTNET, { code: SOCIAL_CODE_HASH });
      const profile = args?.data?.[accountId]?.questlayer?.profile;
      assert(
        method === "set" &&
          ["1", "50000000000000000000000"].includes(deposit) &&
          keys(args, ["data"]) &&
          keys(args.data, [accountId]) &&
          keys(args.data[accountId], ["questlayer"]) &&
          keys(args.data[accountId].questlayer, ["profile"]) &&
          keys(profile, [
            "schema",
            "name",
            "avatar_contract",
            "avatar_token_id",
            "updated_at",
            "mutation_id",
          ]) &&
          profile.schema === "1" &&
          Object.values(profile).every(
            (value) => typeof value === "string" && value.length <= 256,
          ) &&
          profile.name.length >= 2 &&
          profile.name.length <= 24 &&
          !/[\u0000-\u001f\u007f]/.test(profile.name) &&
          /^\d{1,20}$/.test(profile.updated_at) &&
          ((profile.avatar_contract === "" && profile.avatar_token_id === "") ||
            (profile.avatar_contract === NFT_ID &&
              profile.avatar_token_id === `avatar:${accountId}`)) &&
          /^profile_[a-f0-9-]{36}$/.test(profile.mutation_id || ""),
        "Invalid public-profile action.",
        409,
      );
      result = "profile";
    } else
      assert(
        false,
        "This contract is not supported by native confirmation.",
        409,
      );
    return { pinned, result };
  }
  async anchor(player, accountId) {
    this.linked(player, accountId);
    const deadline = Date.now() + this.timeoutMs;
    const afterBlock = await readTransactionAnchor(
      this.provider,
      (value) => this.bounded(value, deadline),
      this.clock,
    );
    this.linked(player, accountId);
    return { network: NETWORK, accountId, afterBlock };
  }
  async confirm(player, input) {
    assert(input && typeof input === "object", "Choose a native transaction.");
    const { accountId, transactionHash, quote } = input;
    this.linked(player, accountId);
    assert(
      typeof transactionHash === "string" &&
        /^[1-9A-HJ-NP-Za-km-z]{32,64}$/.test(transactionHash),
      "The wallet did not return a valid transaction reference.",
    );
    assert(
      quote &&
        quote.network === NETWORK &&
        quote.signerId === accountId &&
        typeof quote.receiverId === "string" &&
        typeof quote.methodName === "string" &&
        amount(quote.deposit) &&
        typeof quote.gas === "string" &&
        /^[1-9]\d{0,14}$/.test(quote.gas) &&
        BigInt(quote.gas) >= 1000000000000n &&
        BigInt(quote.gas) <= 300000000000000n &&
        quote.args &&
        typeof quote.args === "object" &&
        !Array.isArray(quote.args) &&
        JSON.stringify(quote.args).length <= 8192,
      "Invalid reviewed native transaction.",
      409,
    );
    nearAccountId(quote.receiverId);
    const deadline = Date.now() + this.timeoutMs;
    const status = await this.bounded(this.provider.viewNodeStatus(), deadline);
    assert(
      status.chain_id === NETWORK && !status.sync_info?.syncing,
      `${NETWORK_LABEL} confirmation is unavailable.`,
      503,
    );
    const block = await this.bounded(
      this.provider.viewBlock({ finality: "final" }),
      deadline,
    );
    const stamp = Number(
      BigInt(block.header.timestamp_nanosec ?? block.header.timestamp) /
        1000000n,
    );
    assert(
      integer(stamp) &&
        stamp >= this.clock() - 120000 &&
        stamp <= this.clock() + 10000 &&
        typeof block.header.hash === "string",
      "The finalized confirmation observation is stale.",
      503,
    );
    const policy = await this.policy(accountId, quote, deadline);
    this.linked(player, accountId);
    const pin = async (id, expected, blockId) => {
      const code = await this.bounded(
        this.provider.query({
          request_type: "view_account",
          account_id: id,
          block_id: blockId,
        }),
        deadline,
      );
      assert(
        code.code_hash === expected.code &&
          code.block_hash === blockId &&
          integer(code.block_height),
        "The native contract code differs from the reviewed version.",
        503,
      );
      if (expected.keyless) {
        const keys = await this.bounded(
          this.provider.query({
            request_type: "view_access_key_list",
            account_id: id,
            block_id: blockId,
          }),
          deadline,
        );
        assert(
          Array.isArray(keys.keys) &&
            keys.keys.length === 0 &&
            keys.block_hash === blockId &&
            integer(keys.block_height),
          "The native position is no longer keyless.",
          503,
        );
      }
    };
    await Promise.all(
      [...policy.pinned].map(([id, expected]) =>
        pin(id, expected, block.header.hash),
      ),
    );
    if (policy.pinned.has(MARKET_ID)) {
      const response = await this.bounded(
        this.provider.query({
          request_type: "call_function",
          account_id: MARKET_ID,
          method_name: "get_stats",
          args_base64: "e30=",
          block_id: block.header.hash,
        }),
        deadline,
      );
      assert(
        response.block_hash === block.header.hash &&
          Array.isArray(response.result) &&
          response.result.length <= 20000,
        "Invalid market configuration observation.",
        503,
      );
      let stats;
      try {
        stats = JSON.parse(Buffer.from(response.result).toString());
      } catch {
        assert(false, "Invalid market configuration.", 503);
      }
      assert(
        stats.network === NETWORK &&
          (stats.version === 1 || stats.version === 2) &&
          stats.nft_contract === NFT_ID,
        "The market collection configuration changed.",
        503,
      );
    }
    const outcome = await this.bounded(
      this.provider.viewTransactionStatus({
        txHash: transactionHash,
        accountId,
        waitUntil: "FINAL",
      }),
      deadline,
    );
    this.linked(player, accountId);
    assert(
      outcome?.final_execution_status === "FINAL",
      "The transaction is still awaiting final confirmation. Refresh before retrying.",
      409,
      "NATIVE_TRANSACTION_PENDING",
    );
    const tx = outcome.transaction;
    assert(
      tx?.hash === transactionHash &&
        tx.signer_id === accountId &&
        tx.receiver_id === quote.receiverId &&
        Array.isArray(tx.actions) &&
        tx.actions.length === 1 &&
        keys(tx.actions[0], ["FunctionCall"]),
      "The receipt belongs to a different wallet, contract or operation.",
      409,
    );
    const call = tx.actions[0].FunctionCall;
    assert(
      call?.method_name === quote.methodName &&
        (typeof call.gas === "string" || integer(call.gas)) &&
        String(call.gas) === quote.gas &&
        call.deposit === quote.deposit &&
        isDeepStrictEqual(decodeJson(call.args), quote.args),
      "The native receipt differs from the reviewed transaction.",
      409,
    );
    await requireTransactionAfter(
      this.provider,
      outcome,
      input.afterBlock,
      (value) => this.bounded(value, deadline),
    );
    assert(
      Array.isArray(outcome.receipts_outcome) &&
        outcome.receipts_outcome.length > 0 &&
        outcome.receipts_outcome.length <= 128 &&
        outcome.transaction_outcome,
      "The finalized receipt chain is incomplete.",
      503,
    );
    const receipts = [outcome.transaction_outcome, ...outcome.receipts_outcome];
    assert(
      receipts.every((r) => validReceiptStatus(r?.outcome?.status)),
      "The finalized receipt chain is incomplete.",
      503,
    );
    // Pin the executed receiver code as well as its current deployment. A mutable
    // testnet account's present code alone cannot establish historical execution.
    const executed = outcome.receipts_outcome.filter(
      (r) => r.outcome.executor_id === quote.receiverId,
    );
    assert(
      executed.length > 0,
      "The receiver's execution receipt is missing.",
      503,
    );
    const receiptBlocks = [...new Set(executed.map((r) => r.block_hash))];
    assert(
      receiptBlocks.length <= 16 &&
        receiptBlocks.every((v) => typeof v === "string" && v.length >= 32),
      "Invalid native execution anchors.",
      503,
    );
    await Promise.all(
      receiptBlocks.map((hash) =>
        pin(quote.receiverId, policy.pinned.get(quote.receiverId), hash),
      ),
    );
    this.linked(player, accountId);
    assert(
      validReceiptStatus(outcome.status),
      "The final transaction outcome is unavailable. Keep its receipt.",
      503,
    );
    assert(
      !Object.hasOwn(outcome.status, "Failure"),
      "The native operation failed. Refresh its current state before retrying.",
      409,
      "NATIVE_TRANSACTION_FAILED",
    );
    assert(
      keys(outcome.status, ["SuccessValue"]) &&
        typeof outcome.status.SuccessValue === "string",
      "The final transaction outcome is unavailable. Keep its receipt.",
      503,
    );
    assert(
      receipts.every((r) => !Object.hasOwn(r.outcome.status, "Failure")),
      "A native receipt failed. Refresh the current state before retrying.",
      409,
      "NATIVE_TRANSACTION_FAILED",
    );
    if (policy.result === "true") {
      const completed = decodeJson(outcome.status.SuccessValue);
      assert(
        typeof completed === "boolean",
        "The native callback result is invalid. Keep its receipt.",
        503,
      );
      assert(
        completed === true,
        "The transaction finished, but the requested operation did not complete. Refresh its current balance or position before retrying.",
        409,
        "NATIVE_OPERATION_NOT_COMPLETED",
      );
    }
    if (policy.result === "unit")
      assert(
        outcome.status.SuccessValue === "",
        "Unexpected native operation result.",
        409,
      );
    if (policy.result === "profile") {
      const published = decodeJson(outcome.status.SuccessValue);
      assert(
        keys(published, ["block_height"]) &&
          typeof published.block_height === "string" &&
          /^[1-9]\d{0,19}$/.test(published.block_height),
        "Unexpected SocialDB publication result.",
        409,
      );
    }
    if (["avatar", "aura"].includes(policy.result)) {
      const token = decodeJson(outcome.status.SuccessValue);
      assert(
        token?.owner_id === accountId &&
          (policy.result === "avatar"
            ? token.token_id === `avatar:${accountId}`
            : aura(token.token_id) &&
              token.token_id.startsWith(`aura:${quote.args.edition}:`)),
        "The confirmed collectible belongs to a different account or edition.",
        409,
      );
    }
    this.linked(player, accountId);
    return {
      confirmed: true,
      network: NETWORK,
      accountId,
      transactionHash,
      contractId: quote.receiverId,
      receiverId: quote.receiverId,
      methodName: quote.methodName,
    };
  }
}
