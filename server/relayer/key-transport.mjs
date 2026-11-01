import { readFileSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import {
  Account,
  KeyPairSigner,
  baseEncode,
  encodeTransaction,
} from "near-api-js";
import { assert } from "../domain.mjs";
import { assertTestnetRpc, nearAccountId } from "../identity/near.mjs";
import { NETWORK } from "../native/network.mjs";

// Loads a service key file {network:"testnet", accountId, secretKey, publicKey?}.
// Mirrors the reward worker: private file mode, testnet RPC and an on-chain key check.
export async function loadServiceAccount(
  provider,
  keyPath,
  { expectAccountId, requireFullAccess = true } = {},
) {
  assert(
    typeof keyPath === "string" && keyPath.length > 0,
    "A service key path is required.",
    503,
  );
  assert(
    (statSync(keyPath).mode & 0o077) === 0,
    "Service key permissions must be private.",
    503,
  );
  let config;
  try {
    config = JSON.parse(readFileSync(keyPath, "utf8"));
  } catch {
    assert(false, "The service key file is unreadable.", 503);
  }
  assert(
    config?.network === NETWORK &&
      typeof config.accountId === "string" &&
      typeof config.secretKey === "string",
    "Wrong service identity.",
    503,
  );
  nearAccountId(config.accountId);
  assert(
    !expectAccountId || config.accountId === expectAccountId,
    "Wrong service identity.",
    503,
  );
  await assertTestnetRpc(provider);
  const signer = KeyPairSigner.fromSecretKey(config.secretKey);
  const publicKey = (await signer.getPublicKey()).toString();
  assert(
    !config.publicKey || config.publicKey === publicKey,
    "The service key file is inconsistent.",
    503,
  );
  const access = await provider.query({
    request_type: "view_access_key",
    account_id: config.accountId,
    public_key: publicKey,
    finality: "final",
  });
  assert(
    access &&
      (access.permission === "FullAccess" ||
        (!requireFullAccess && access.permission?.FunctionCall)),
    requireFullAccess
      ? "The service key must have full access."
      : "The service key is not registered on its account.",
    503,
  );
  return {
    account: new Account(config.accountId, provider, signer),
    accountId: config.accountId,
    publicKey,
    permission: access.permission,
  };
}

// Signs first and sends second so the transaction hash is durable before any
// network call; a lost response is reconciled by hash, never by re-signing blindly.
export function relayTransport(service) {
  const { account, accountId, publicKey } = service;
  const provider = account.provider;
  return {
    accountId,
    publicKey,
    async sign({ receiverId, actions }) {
      const signedTx = await account.createSignedTransaction({
        receiverId,
        actions,
      });
      const hash = baseEncode(
        createHash("sha256")
          .update(encodeTransaction(signedTx.transaction))
          .digest(),
      );
      return {
        hash,
        async send(waitUntil = "FINAL") {
          try {
            return await provider.sendTransactionUntil(signedTx, waitUntil);
          } catch (error) {
            if (error?.name === "InvalidNonceError")
              await account.nonceManager?.invalidate?.(
                signedTx.transaction.publicKey,
                signedTx.transaction.nonceIndex,
              );
            throw error;
          }
        },
      };
    },
    status(hash) {
      return provider.viewTransactionStatus({
        txHash: hash,
        accountId,
        waitUntil: "FINAL",
      });
    },
  };
}
