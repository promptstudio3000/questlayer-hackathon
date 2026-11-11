import { isDeepStrictEqual } from "node:util";
import { GameError } from "../domain.mjs";
import { publicKeyString } from "./delegate.mjs";
import { SOCIAL_CONTRACT_ID } from "../native/network.mjs";
import { MESSAGE_ID, validInboxKeyRecord, validInboxRecord } from "../inbox/crypto.mjs";
import { isNativeEdition } from "../aura-catalog.mjs";

export const SOCIAL_CONTRACT = SOCIAL_CONTRACT_ID;
export const STORAGE_DEPOSIT = 50000000000000000000000n; // 0.05 NEAR
/**
 * Escrow storage deposits (contracts/qgold-escrow `storage_deposit`) are
 * relayed on a ladder of 0.05 NEAR steps up to 0.5 NEAR (a 50-slot task needs
 * about 0.43 NEAR): fixed storage-class amounts, like every other relayed deposit.
 */
export const ESCROW_STORAGE_DEPOSIT_MAX = 500000000000000000000000n; // 0.5 NEAR
export const escrowStorageLadder = (deposit) => {
  let d;
  try {
    d = BigInt(deposit);
  } catch {
    return false;
  }
  return d > 0n && d % STORAGE_DEPOSIT === 0n && d <= ESCROW_STORAGE_DEPOSIT_MAX;
};
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
      npcGames:
        typeof ctx.contracts.npcGames === "string"
          ? ctx.contracts.npcGames
          : null,
      // Experimental self-deployed NEAR Intents verifier and its wNEAR token.
      intents:
        typeof ctx.contracts.intents === "string"
          ? ctx.contracts.intents
          : null,
      wnear:
        typeof ctx.contracts.wnear === "string" ? ctx.contracts.wnear : null,
      // QGOLD vault token and the market escrow (contracts/qgold-escrow).
      qgold:
        typeof ctx.contracts.qgold === "string" ? ctx.contracts.qgold : null,
      qgoldEscrow:
        typeof ctx.contracts.qgoldEscrow === "string"
          ? ctx.contracts.qgoldEscrow
          : null,
      // Treasury DAO (docs/TREASURY-DAO.md): explorers vote on its polls.
      treasuryDao:
        typeof ctx.contracts.treasuryDao === "string"
          ? ctx.contracts.treasuryDao
          : null,
    },
    factorySetupDeposit:
      ctx.factorySetupDeposit === undefined || ctx.factorySetupDeposit === null
        ? null
        : yocto(ctx.factorySetupDeposit),
    factoryPools: Array.isArray(ctx.factoryPools) ? ctx.factoryPools : [],
    ownedVaults: Array.isArray(ctx.ownedVaults) ? ctx.ownedVaults : [],
    // Issued NPC trade-ups (server/npc/trader.mjs): the exact Auras this
    // account may hand to that trader account, so the hand-over is sponsored.
    tradeUpHandovers: Array.isArray(ctx.tradeUpHandovers)
      ? ctx.tradeUpHandovers.filter(
          (h) =>
            plainObject(h) &&
            typeof h.receiver === "string" &&
            Array.isArray(h.tokens) &&
            (h.accountId === undefined || h.accountId === ctx.accountId),
        )
      : [],
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
// SocialDB writes the game quotes itself (server/native/social-profile.mjs,
// server/native/social-records.mjs, server/gold-spend/social.mjs). Anything
// else under the player's namespace is not sponsored: the relayer would pay
// the gas and the storage of arbitrary writes.
export const SOCIAL_MAX_ARGS_BYTES = 4096;
const SOCIAL_RECORDS = {
  profile: {
    fields: ["schema", "name", "avatar_contract", "avatar_token_id", "updated_at", "mutation_id"],
    valid: (r) => r.schema === "1" && /^profile_[a-f0-9-]{36}$/.test(r.mutation_id),
  },
  notes: {
    key: /^message_[a-f0-9-]{36}$/,
    fields: ["schema", "note_id", "state", "text", "lat", "lng", "anchor", "author_fix", "image", "image_sha256", "created_at", "updated_at", "mutation_id"],
    valid: (r, key) =>
      r.schema === "1" &&
      r.note_id === key &&
      ["published", "removed"].includes(r.state) &&
      /^record_[a-f0-9-]{36}$/.test(r.mutation_id),
  },
  // Encrypted player inbox (docs/PLAYER-INBOX.md): the public X25519 inbox key
  // and one ciphertext message, both under the sender's own namespace.
  inbox_key: { whole: validInboxKeyRecord },
  inbox: { key: MESSAGE_ID, whole: validInboxRecord },
  places: {
    key: /^(place|post)_[a-f0-9-]{36}$/,
    fields: ["schema", "kind", "thread", "title", "text", "cell", "place", "paid", "created_at", "mutation_id"],
    valid: (r) =>
      r.schema === "questlayer.place/1" &&
      /^record_[a-f0-9-]{36}$/.test(r.mutation_id),
  },
};
function gameSocialWrite(namespace) {
  if (!keysOf(namespace, ["questlayer"]) || !plainObject(namespace.questlayer))
    return false;
  const sections = Object.keys(namespace.questlayer);
  if (sections.length !== 1 || !Object.hasOwn(SOCIAL_RECORDS, sections[0]))
    return false;
  const spec = SOCIAL_RECORDS[sections[0]],
    section = namespace.questlayer[sections[0]];
  const record = (r, key) =>
    spec.whole ? spec.whole(r) :
    keysOf(r, spec.fields) &&
    spec.fields.every((f) => typeof r[f] === "string") &&
    spec.valid(r, key);
  if (!spec.key) return record(section);
  if (!plainObject(section)) return false;
  const keys = Object.keys(section);
  return (
    keys.length === 1 && spec.key.test(keys[0]) && record(section[keys[0]], keys[0])
  );
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
    typeof maxBlockHeight !== "bigint" || maxBlockHeight > ctx.blockHeight,
    "RELAY_EXPIRED",
    "The signed action expired before admission. Prepare it again.",
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
      // The relayer checks the voucher itself before admission (relay.mjs).
      demand(
        keysOf(args, ["claim_id", "edition", "receiver_id", "expires_at_ms", "signature"]) &&
          /^earned:[!-~]{1,153}$/.test(args.claim_id) &&
          isNativeEdition(args.edition) &&
          integer(args.expires_at_ms) &&
          typeof args.signature === "string" &&
          /^[A-Za-z0-9+/]{86}==$/.test(args.signature),
        "RELAY_ARGS",
        "An Aura redemption takes one award-signed claim.",
      );
    } else if (method === "equip_aura" || method === "unequip_aura")
      depositIs(0n, "Equipment");
    else if (method === "nft_transfer_call") {
      depositIs(1n, "Listing");
      demand(
        args.receiver_id === c.market ||
          (c.intents != null &&
            args.receiver_id === c.intents &&
            // Deposit to the signer's own verifier account only.
            (args.msg === "" || args.msg === senderId)),
        "RELAY_TRANSFER_TARGET",
        "Listings go only to the reviewed market.",
      );
    } else if (method === "nft_transfer") {
      depositIs(1n, "Transfer");
      demand(
        typeof args.receiver_id === "string" &&
          (ctx.linkedWallets.includes(args.receiver_id) ||
            ctx.tradeUpHandovers.some(
              (h) =>
                h.receiver === args.receiver_id &&
                h.tokens.includes(args.token_id),
            )),
        "RELAY_TRANSFER_TARGET",
        "Collectibles can be moved only to a wallet linked to your explorer, or to the trader of an accepted trade-up.",
      );
    } else unsupported();
  } else if (receiverId === c.market) {
    // Anything that moves money (a purchase, filling a signed order, funding
    // offers) is self-paid. Fills stay self-paid even when only 1 yocto is
    // attached, because accepting an offer releases the buyer's escrowed NEAR.
    if (
      method === "buy" ||
      method === "fill_sell_order" ||
      method === "fill_buy_order" ||
      method === "deposit_near"
    )
      selfPaid("A purchase");
    else if (
      method === "cancel" ||
      method === "withdraw" ||
      method === "cancel_all_orders"
    )
      depositIs(1n, "Market action");
    else if (method === "add_signing_key" || method === "remove_signing_key") {
      depositIs(1n, "Order signing key");
      demand(
        keysOf(args, ["public_key"]) &&
          /^ed25519:[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(String(args.public_key)),
        "RELAY_ARGS",
        "A signing key change takes one ed25519 public key.",
      );
    } else if (method === "cancel_order") {
      depositIs(1n, "Order cancellation");
      demand(
        keysOf(args, ["order"]) && plainObject(args.order),
        "RELAY_ARGS",
        "An order cancellation takes the signed order.",
      );
    } else unsupported();
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
    if (method === "request_partial_exit") {
      // Vault v2: the principal to take out, as a u128 decimal string.
      demand(
        keysOf(args, ["amount"]) &&
          typeof args.amount === "string" &&
          /^[1-9]\d{0,38}$/.test(args.amount) &&
          BigInt(args.amount) >= 10n ** 21n &&
          BigInt(args.amount) < 2n ** 128n,
        "RELAY_ARGS",
        "A partial exit takes one amount of at least 0.001 NEAR.",
      );
      depositIs(1n, "Position authorization");
    } else if (method === "set_contribution") {
      demand(
        keysOf(args, ["contribution_bps"]) &&
          Number.isInteger(args.contribution_bps) &&
          args.contribution_bps >= 0 &&
          args.contribution_bps <= 10000,
        "RELAY_ARGS",
        "A contribution change takes one 0–10000 basis-point value.",
      );
      depositIs(1n, "Position authorization");
    } else {
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
    }
  } else if (c.treasuryDao && receiverId === c.treasuryDao) {
    // A vote on a treasury poll: approve only, never a deposit, never a
    // proposal or any other kind (the DAO's own roles enforce the rest).
    depositIs(0n, "A treasury vote");
    demand(
      method === "act_proposal" &&
        keysOf(args, ["id", "action", "proposal"]) &&
        Number.isSafeInteger(args.id) &&
        args.id >= 0 &&
        args.action === "VoteApprove" &&
        args.proposal === "Vote",
      "RELAY_ARGS",
      "Only a vote for a treasury poll option is sponsored.",
    );
  } else if (c.npcGames && receiverId === c.npcGames) {
    // Earned mini-game rolls (docs/NPC-GAMES.md): never a deposit, so never a wager.
    depositIs(0n, "A mini-game roll");
    const rollId = (v) =>
      typeof v === "string" && /^[A-Za-z0-9_:.-]{1,96}$/.test(v);
    const hex64 = (v) => typeof v === "string" && /^[0-9a-f]{64}$/.test(v);
    if (method === "start_roll")
      demand(
        keysOf(args, [
          "roll_id",
          "table_id",
          "commit",
          "expires_at_ms",
          "signature",
        ]) &&
          rollId(args.roll_id) &&
          rollId(args.table_id) &&
          hex64(args.commit) &&
          typeof args.expires_at_ms === "string" &&
          /^\d{1,20}$/.test(args.expires_at_ms) &&
          typeof args.signature === "string" &&
          args.signature.length === 88,
        "RELAY_ARGS",
        "A roll starts with one signed ticket.",
      );
    else if (method === "resolve_roll")
      demand(
        keysOf(args, ["roll_id", "secret"]) &&
          rollId(args.roll_id) &&
          hex64(args.secret),
        "RELAY_ARGS",
        "A roll reveal takes the roll id and its secret.",
      );
    else if (method === "claim_timeout")
      demand(
        keysOf(args, ["roll_id"]) && rollId(args.roll_id),
        "RELAY_ARGS",
        "A timeout claim takes one roll id.",
      );
    else unsupported();
  } else if (c.qgold != null && receiverId === c.qgold && method === "ft_burn") {
    // Spending in game: the player burns their own QGOLD with the game's memo
    // (server/gold-spend/qgold-burn.mjs). 1 yocto is the NEP-141 confirmation.
    depositIs(1n, "A QGOLD burn");
    demand(
      plainObject(args) &&
        keysOf(args, ["amount", "memo"]) &&
        typeof args.amount === "string" &&
        /^[1-9]\d{0,30}$/.test(args.amount) &&
        typeof args.memo === "string" &&
        /^questlayer:burn:[a-z]+:[0-9a-f]{16}$/.test(args.memo),
      "RELAY_ARGS",
      "A QGOLD burn takes an amount and the game's burn memo.",
    );
  } else if (
    c.qgold != null &&
    c.qgoldEscrow != null &&
    receiverId === c.qgold &&
    method === "ft_transfer_call"
  ) {
    // Funding a task, Secret or conditional send: the player's own QGOLD goes
    // into the market escrow (the token moves, not NEAR; 1 yocto is the NEP-141
    // confirmation). Nowhere else.
    depositIs(1n, "QGOLD escrow funding");
    demand(
      plainObject(args) &&
        Object.keys(args).every((k) => ["receiver_id", "amount", "memo", "msg"].includes(k)) &&
        args.receiver_id === c.qgoldEscrow &&
        typeof args.amount === "string" &&
        /^[1-9]\d{0,30}$/.test(args.amount) &&
        (args.memo == null || (typeof args.memo === "string" && args.memo.length <= 100)) &&
        typeof args.msg === "string" &&
        args.msg.length <= 2000,
      "RELAY_ARGS",
      "QGOLD can be sent only into the market escrow.",
    );
  } else if (c.qgoldEscrow != null && receiverId === c.qgoldEscrow) {
    // The funder's native storage deposit for one market agreement
    // (contracts/qgold-escrow `storage_deposit`). The relayer carries the NEAR
    // within its daily deposit budget; `grant: true` makes the escrow book it
    // as a grant the player can spend on agreements but never withdraw, so a
    // relayed call (predecessor = the player) cannot turn sponsorship into NEAR.
    demand(
      method === "storage_deposit",
      "RELAY_METHOD",
      `${method} on ${receiverId} is not sponsored.`,
    );
    demand(
      escrowStorageLadder(deposit),
      "RELAY_DEPOSIT",
      "An escrow storage deposit is a multiple of 0.05 NEAR, at most 0.5 NEAR.",
    );
    demand(
      keysOf(args, ["account_id", "grant"]) &&
        args.account_id === senderId &&
        args.grant === true,
      "RELAY_ARGS",
      "An escrow storage deposit is a grant for your own account.",
    );
  } else if (c.intents != null && receiverId === c.intents) {
    // Registering or removing the key that signs intents; trades and
    // withdrawals are signed intents the solver submits, never relayed calls.
    demand(
      method === "add_public_key" || method === "remove_public_key",
      "RELAY_METHOD",
      `${method} on ${receiverId} is not sponsored.`,
    );
    depositIs(1n, "Intents key registration");
    demand(
      keysOf(args, ["public_key"]) &&
        // ed25519 = the device key; secp256k1 (64-byte uncompressed point) =
        // a linked Ethereum wallet that signs ERC-191 intents.
        /^(ed25519:[1-9A-HJ-NP-Za-km-z]{32,44}|secp256k1:[1-9A-HJ-NP-Za-km-z]{80,90})$/.test(
          String(args.public_key),
        ),
      "RELAY_ARGS",
      "Register one ed25519 or secp256k1 key.",
    );
  } else if (c.intents != null && c.wnear != null && receiverId === c.wnear) {
    // Moving wNEAR the player already holds into their own verifier account.
    // Wrapping NEAR (near_deposit) and storage are self-paid.
    demand(
      method === "ft_transfer_call",
      "RELAY_METHOD",
      `${method} on ${receiverId} is not sponsored.`,
    );
    depositIs(1n, "wNEAR deposit");
    demand(
      keysOf(args, ["receiver_id", "amount", "msg"]) &&
        args.receiver_id === c.intents &&
        /^[1-9]\d{0,38}$/.test(String(args.amount)) &&
        (args.msg === "" || args.msg === senderId),
      "RELAY_ARGS",
      "wNEAR goes only to your own verifier account.",
    );
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
    demand(
      Buffer.byteLength(JSON.stringify(args)) <= SOCIAL_MAX_ARGS_BYTES &&
        gameSocialWrite(args.data[senderId]),
      "RELAY_SOCIAL_SHAPE",
      "Only the game's own profile, note, place and inbox records are published through the relayer.",
    );
  } else fail("RELAY_RECEIVER", "This contract is not sponsored.");
  // Defense in depth: the branches above only accept these amounts (plus the
  // escrow storage ladder, bounded above).
  demand(
    RELAYED_DEPOSITS.includes(deposit) ||
      (c.qgoldEscrow != null &&
        receiverId === c.qgoldEscrow &&
        method === "storage_deposit" &&
        escrowStorageLadder(deposit)),
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
