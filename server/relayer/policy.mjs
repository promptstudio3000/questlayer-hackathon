import { isDeepStrictEqual } from "node:util";
import { GameError } from "../domain.mjs";
import { publicKeyString } from "./delegate.mjs";
import { SOCIAL_CONTRACT_ID } from "../native/network.mjs";

export const SOCIAL_CONTRACT = SOCIAL_CONTRACT_ID;
export const STORAGE_DEPOSIT = 50000000000000000000000n; // 0.05 NEAR
export const MAX_ARGS_BYTES = 8192;
export const MAX_METHOD_NAME = 64;

export class RelayPolicyError extends GameError {
  constructor(code, message, status = 409) {
    super(message, status, code);
    this.name = "RelayPolicyError";
  }
}
const fail = (code, message, status) => {
  throw new RelayPolicyError(code, message, status);
};
const demand = (condition, code, message, status) => {
  if (!condition) fail(code, message, status);
};
const yocto = (value) => {
  try {
    const n = BigInt(value);
    if (n < 0n || n >= 2n ** 128n) throw Error();
    return n;
  } catch {
    throw Error("Relay policy context amount is invalid.");
  }
};
const plainObject = (value) =>
  !!value && typeof value === "object" && !Array.isArray(value);
const keysOf = (value, expected) =>
  plainObject(value) &&
  isDeepStrictEqual(Object.keys(value).sort(), [...expected].sort());
const integer = (value) => Number.isSafeInteger(value) && value >= 0;

function checkContext(ctx) {
  const ok =
    plainObject(ctx) &&
    typeof ctx.accountId === "string" &&
    Array.isArray(ctx.keys) &&
    Array.isArray(ctx.pendingKeys ?? []) &&
    Array.isArray(ctx.addKeys ?? []) &&
    Array.isArray(ctx.removeKeys ?? []) &&
    Array.isArray(ctx.linkedWallets ?? []) &&
    integer(ctx.blockHeight) &&
    Number.isSafeInteger(ctx.blockTtl) &&
    ctx.blockTtl > 0 &&
    plainObject(ctx.contracts) &&
    typeof ctx.contracts.collectibles === "string" &&
    !!ctx.contracts.collectibles &&
    // Market and rewards are optional slices (absent on a mainnet host
    // without them); when present they must be account ids.
    ["market", "rewards"].every(
      (name) =>
        ctx.contracts[name] == null ||
        (typeof ctx.contracts[name] === "string" && ctx.contracts[name]),
    );
  if (!ok)
    throw new GameError(
      "Relay policy context is unavailable.",
      503,
      "RELAY_UNAVAILABLE",
    );
  return {
    accountId: ctx.accountId,
    keys: ctx.keys,
    pendingKeys: ctx.pendingKeys ?? [],
    // When the relayer separates them, a registered addition can only be
    // added and a registered removal only removed.
    addKeys: ctx.addKeys ?? ctx.pendingKeys ?? [],
    removeKeys: ctx.removeKeys ?? ctx.pendingKeys ?? [],
    linkedWallets: ctx.linkedWallets ?? [],
    nonce: yocto(ctx.nonce),
    blockHeight: BigInt(ctx.blockHeight),
    blockTtl: BigInt(ctx.blockTtl),
    maxGas: yocto(ctx.maxGas ?? 300000000000000n),
    contracts: {
      collectibles: ctx.contracts.collectibles,
      market: ctx.contracts.market || null,
      rewards: ctx.contracts.rewards || null,
      social: ctx.contracts.social || SOCIAL_CONTRACT,
      factory:
        typeof ctx.contracts.factory === "string"
          ? ctx.contracts.factory
          : null,
      creators:
        typeof ctx.contracts.creators === "string"
          ? ctx.contracts.creators
          : null,
    },
    factorySetupDeposit:
      ctx.factorySetupDeposit === undefined || ctx.factorySetupDeposit === null
        ? null
        : yocto(ctx.factorySetupDeposit),
    factoryPools: Array.isArray(ctx.factoryPools) ? ctx.factoryPools : [],
    ownedVaults: Array.isArray(ctx.ownedVaults) ? ctx.ownedVaults : [],
  };
}
function parseArgs(bytes) {
  const buffer = Buffer.from(bytes ?? []);
  demand(
    buffer.length > 0 && buffer.length <= MAX_ARGS_BYTES,
    "RELAY_ARGS",
    "Call arguments must be a JSON object of at most 8 KiB.",
    400,
  );
  let args;
  try {
    args = JSON.parse(buffer.toString("utf8"));
  } catch {
    fail("RELAY_ARGS", "Call arguments must be valid JSON.", 400);
  }
  demand(
    plainObject(args),
    "RELAY_ARGS",
    "Call arguments must be a JSON object.",
    400,
  );
  return args;
}
function keyActionPublicKey(value) {
  try {
    return publicKeyString(value);
  } catch {
    fail("RELAY_KEY_TARGET", "The key action names an unsupported key.", 400);
  }
}

// Pure allowlist. Accepts the decoded SignedDelegate (see delegate.mjs) and the
// server-observed context, returns the single sponsored call or throws.
//
// Who pays: in a NEP-366 meta-transaction the relayer's own transaction carries
// every attached deposit of the delegated actions (verified on testnet, receipt
// chain in output/qa/2026-11-testnet). The player's balance is never touched.
// Therefore only storage-class deposits (0, 1 yocto, 0.05 NEAR) are relayed;
// money actions (market purchase, creator payments, staking) are refused with
// RELAY_SELF_PAID and signed by the player's device key as ordinary
// transactions, where the player pays both the deposit and the gas.
export const RELAYED_DEPOSITS = [0n, 1n, STORAGE_DEPOSIT];
const selfPaid = (label) =>
  fail(
    "RELAY_SELF_PAID",
    `${label} is paid from your own account, not through the relayer.`,
  );
export function validateDelegate(decoded, context) {
  const ctx = checkContext(context);
  const delegateAction =
    decoded?.delegateAction ?? decoded?.signedDelegate?.delegateAction;
  demand(
    plainObject(delegateAction),
    "RELAY_SHAPE",
    "A signed delegate action is required.",
    400,
  );
  const { senderId, receiverId, actions, nonce, maxBlockHeight } =
    delegateAction;
  demand(
    senderId === ctx.accountId,
    "RELAY_SENDER",
    "The delegate must be signed by your managed account.",
    403,
  );
  const publicKey =
    decoded.publicKey ?? keyActionPublicKey(delegateAction.publicKey);
  demand(
    ctx.keys.includes(publicKey),
    "RELAY_KEY",
    "The signing key is not an active key of this account.",
    403,
  );
  demand(
    typeof nonce === "bigint" && nonce === ctx.nonce + 1n,
    "RELAY_NONCE",
    "The delegate nonce is stale. Prepare the action again.",
  );
  demand(
    typeof maxBlockHeight === "bigint" &&
      maxBlockHeight > ctx.blockHeight &&
      maxBlockHeight <= ctx.blockHeight + ctx.blockTtl,
    "RELAY_EXPIRY",
    "The delegate expiry is outside the sponsored window. Prepare the action again.",
  );
  demand(
    Array.isArray(actions) && actions.length === 1 && plainObject(actions[0]),
    "RELAY_SHAPE",
    "Exactly one action can be sponsored per request.",
    400,
  );
  const [action] = actions,
    actionKeys = Object.keys(action);
  demand(
    actionKeys.length === 1,
    "RELAY_SHAPE",
    "Invalid delegate action.",
    400,
  );
  const [kind] = actionKeys;
  demand(
    kind !== "signedDelegate",
    "RELAY_SHAPE",
    "Nested delegates are not sponsored.",
    400,
  );
  demand(
    typeof receiverId === "string" &&
      receiverId.length >= 2 &&
      receiverId.length <= 64,
    "RELAY_RECEIVER",
    "Invalid receiver.",
    400,
  );
  const base = {
    senderId,
    receiverId,
    publicKey,
    nonce: nonce.toString(),
    maxBlockHeight: maxBlockHeight.toString(),
  };
  if (kind === "addKey" || kind === "deleteKey") {
    demand(
      receiverId === senderId,
      "RELAY_RECEIVER",
      "Key changes are sponsored only on your own account.",
    );
    const target = keyActionPublicKey(action[kind].publicKey);
    demand(
      (kind === "addKey" ? ctx.addKeys : ctx.removeKeys).includes(target),
      "RELAY_KEY_TARGET",
      "Register the key change before signing it.",
    );
    if (kind === "addKey") {
      const accessKey = action.addKey.accessKey;
      demand(
        plainObject(accessKey) &&
          accessKey.nonce === 0n &&
          keysOf(accessKey.permission, ["fullAccess"]),
        "RELAY_KEY_TARGET",
        "Only a fresh full-access device key can be added.",
      );
    } else
      demand(
        target !== publicKey,
        "RELAY_KEY_TARGET",
        "A key cannot remove itself through the relayer.",
      );
    return {
      ...base,
      kind,
      methodName: null,
      args: { publicKey: target },
      gas: "0",
      deposit: "0",
      sponsorDeposit: true,
    };
  }
  demand(
    kind === "functionCall",
    "RELAY_SHAPE",
    "Only contract calls and key changes are sponsored.",
    400,
  );
  demand(
    receiverId !== senderId,
    "RELAY_RECEIVER",
    "Calls to your own account are not sponsored.",
  );
  const call = action.functionCall;
  demand(
    plainObject(call) &&
      typeof call.methodName === "string" &&
      call.methodName.length > 0 &&
      call.methodName.length <= MAX_METHOD_NAME &&
      typeof call.gas === "bigint" &&
      typeof call.deposit === "bigint",
    "RELAY_SHAPE",
    "Invalid contract call.",
    400,
  );
  demand(
    call.gas > 0n && call.gas <= ctx.maxGas,
    "RELAY_GAS",
    "The attached gas exceeds the sponsored limit.",
  );
  const method = call.methodName,
    deposit = call.deposit,
    args = parseArgs(call.args),
    c = ctx.contracts;
  const depositIs = (expected, label) =>
    demand(
      deposit === expected,
      "RELAY_DEPOSIT",
      `${label} requires a deposit of ${expected} yoctoNEAR.`,
    );
  const unsupported = () =>
    fail("RELAY_METHOD", `${method} on ${receiverId} is not sponsored.`);
  if (receiverId === c.collectibles) {
    if (method === "mint_avatar") {
      depositIs(STORAGE_DEPOSIT, "Avatar minting");
      demand(
        keysOf(args, []),
        "RELAY_ARGS",
        "Avatar minting takes no arguments.",
      );
    } else if (method === "redeem_aura") {
      depositIs(STORAGE_DEPOSIT, "Aura redemption");
      demand(
        args.receiver_id === senderId && typeof args.claim_id === "string",
        "RELAY_ARGS",
        "An Aura can be redeemed only to the signing account.",
      );
    } else if (method === "equip_aura" || method === "unequip_aura")
      depositIs(0n, "Equipment");
    else if (method === "nft_transfer_call") {
      depositIs(1n, "Listing");
      demand(
        args.receiver_id === c.market,
        "RELAY_TRANSFER_TARGET",
        "Listings go only to the reviewed market.",
      );
    } else if (method === "nft_transfer") {
      depositIs(1n, "Transfer");
      demand(
        typeof args.receiver_id === "string" &&
          ctx.linkedWallets.includes(args.receiver_id),
        "RELAY_TRANSFER_TARGET",
        "Collectibles can be moved only to a wallet linked to your explorer.",
      );
    } else unsupported();
  } else if (receiverId === c.market) {
    if (method === "buy") selfPaid("A purchase");
    else if (method === "cancel" || method === "withdraw")
      depositIs(1n, "Market action");
    else unsupported();
  } else if (receiverId === c.rewards) {
    if (method === "withdraw") depositIs(1n, "Reward withdrawal");
    else unsupported();
  } else if (c.creators && receiverId === c.creators) {
    // Creator money moves only in self-paid transactions; withdrawals are relayed.
    if (method === "buy_access" || method === "donate")
      selfPaid("A creator payment");
    else if (method === "withdraw") {
      depositIs(1n, "Creator withdrawal");
      demand(keysOf(args, []), "RELAY_ARGS", "Withdrawal takes no arguments.");
    } else unsupported();
  } else if (c.factory && receiverId === c.factory) {
    // Staking money (setup deposit, stake) is self-paid; maintenance is relayed.
    if (method === "create_position") selfPaid("Opening a staking position");
    else if (method === "register_position") {
      depositIs(0n, "Position registration");
      demand(
        keysOf(args, ["id"]) &&
          typeof args.id === "string" &&
          /^\d{1,20}$/.test(args.id),
        "RELAY_ARGS",
        "Position registration takes one position id.",
      );
    } else if (method === "withdraw_refund") {
      depositIs(1n, "Refund withdrawal");
      demand(
        keysOf(args, []),
        "RELAY_ARGS",
        "Refund withdrawal takes no arguments.",
      );
    } else unsupported();
  } else if (c.factory && receiverId.endsWith("." + c.factory)) {
    demand(
      ctx.ownedVaults.includes(receiverId),
      "RELAY_RECEIVER",
      "Only your own staking position can be operated.",
    );
    demand(keysOf(args, []), "RELAY_ARGS", "Vault actions take no arguments.");
    if (method === "deposit_and_stake") selfPaid("A stake deposit");
    else if (method === "request_exit" || method === "withdraw_owner")
      depositIs(1n, "Position authorization");
    else if (
      method === "refresh" ||
      method === "advance" ||
      method === "harvest"
    )
      depositIs(0n, "Position maintenance");
    else unsupported();
  } else if (receiverId === c.social) {
    demand(
      method === "set",
      "RELAY_METHOD",
      `${method} on ${receiverId} is not sponsored.`,
    );
    demand(
      deposit === 1n || deposit === STORAGE_DEPOSIT,
      "RELAY_DEPOSIT",
      "Profile publication requires a 1 yocto or 0.05 NEAR deposit.",
    );
    demand(
      keysOf(args, ["data"]) && keysOf(args.data, [senderId]),
      "RELAY_ARGS",
      "Only your own SocialDB namespace can be published.",
    );
  } else fail("RELAY_RECEIVER", "This contract is not sponsored.");
  // Defense in depth: the branches above only accept these amounts.
  demand(
    RELAYED_DEPOSITS.includes(deposit),
    "RELAY_DEPOSIT",
    "Only storage-class deposits are relayed.",
  );
  return {
    ...base,
    kind: "call",
    methodName: method,
    args,
    gas: call.gas.toString(),
    deposit: deposit.toString(),
    // The relayer's transaction carries the deposit; this is always true.
    sponsorDeposit: true,
  };
}
