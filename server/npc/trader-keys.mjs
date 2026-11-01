// NPC trader identities (N3). A private JSON file (mode 0600, never in git)
// names each trader's NEAR account and two keys:
//   signingKey  ed25519 key registered with market `add_signing_key`; signs
//               NEP-413 orders. It can only commit the trader's market credit.
//   accountKey  optional full-access key of the trader account, used only by
//               the keeper (escrow stock, sweep surplus to rewards, restore the
//               float). Without it the keeper reports what it would do.
//
// {
//   "network": "testnet",
//   "traders": [{ "actorId": "kupec-vojtech", "accountId": "npc-kupec-vojtech.<operator>.testnet",
//                 "signingKey": "ed25519:…", "accountKey": "ed25519:…", "fundedAt": "2026-11-01T…Z" }]
// }
// Default path: <state dir>/npc-traders.json, override with NPC_TRADERS_PATH.
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { randomBytes } from "node:crypto";
import { KeyPair } from "near-api-js";
import { assert } from "../domain.mjs";
import { defaultDatabasePath } from "../state-path.mjs";
import { nep413Digest, orderMessage, orderTerms, signedOrder } from "../native/signed-orders.mjs";

const ACTOR = /^[a-z0-9-]{3,40}$/;
const ACCOUNT = /^(?=.{2,64}$)(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/;

export const traderKeysPath = (env = process.env) =>
  env.NPC_TRADERS_PATH || resolve(dirname(defaultDatabasePath()), "npc-traders.json");

/** Validate a parsed traders file; returns a Map actorId → trader. */
export function parseTraders(config, { network = "testnet" } = {}) {
  assert(config && config.network === network, "NPC traders are testnet-only.", 503);
  assert(network === "testnet", "NPC traders are testnet-only.", 503);
  assert(Array.isArray(config.traders) && config.traders.length <= 8, "Invalid NPC traders file.", 503);
  const traders = new Map();
  for (const t of config.traders) {
    assert(ACTOR.test(String(t?.actorId)) && !traders.has(t.actorId), "Invalid NPC trader id.", 503);
    assert(ACCOUNT.test(String(t.accountId)) && t.accountId.endsWith(".testnet"), "Invalid NPC trader account.", 503);
    const signing = KeyPair.fromString(t.signingKey);
    const account = t.accountKey ? KeyPair.fromString(t.accountKey) : null;
    traders.set(t.actorId, {
      actorId: t.actorId,
      accountId: t.accountId,
      signing,
      signingPublicKey: signing.getPublicKey().toString(),
      accountKey: t.accountKey || null,
      accountPublicKey: account ? account.getPublicKey().toString() : null,
      fundedAt: Date.parse(t.fundedAt || "") || null,
    });
  }
  return traders;
}

/** Load the traders file, or null when it does not exist (feature stays off). */
export function loadTraders(path = traderKeysPath(), options = {}) {
  if (!existsSync(path)) return null;
  assert((statSync(path).mode & 0o077) === 0, "NPC trader keys must be private (chmod 600).", 503);
  return parseTraders(JSON.parse(readFileSync(path, "utf8")), options);
}

/** Sign a market v2 order for a trader (NEP-413, standard questlayer_aura_order). */
export function signTraderOrder(trader, { kind, market, nftContract, tokenId, price, deadlineMs, epoch = 0, nonce = randomBytes(32) }) {
  const message = orderMessage(
    orderTerms({ kind, market, nftContract, maker: trader.accountId, tokenId, price, deadlineMs, epoch }),
  );
  const { signature } = trader.signing.sign(nep413Digest({ message, nonce, recipient: market }));
  return signedOrder({ message, nonce, recipient: market, publicKey: trader.signingPublicKey, signature });
}
