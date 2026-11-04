import { rpcErrorText } from "../near-provider.mjs";
import { verifyMessage } from "near-api-js/nep413";
import { assert } from "../domain.mjs";
import { NETWORK, NETWORK_LABEL } from "../native/network.mjs";

export function nearAccountId(value) {
  assert(
    typeof value === "string" &&
      value.length >= 2 &&
      value.length <= 64 &&
      /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/.test(value),
    "Enter a valid NEAR account ID.",
  );
  return value;
}

const verifiedNetworks = new WeakMap(),
  networkChecks = new WeakMap();
export async function assertTestnetRpc(provider) {
  if ((verifiedNetworks.get(provider) || 0) > Date.now()) return;
  if (networkChecks.has(provider)) return networkChecks.get(provider);
  const task = (async () => {
    let status;
    try {
      status = await provider.viewNodeStatus();
    } catch {
      assert(
        false,
        `The ${NETWORK_LABEL} verification service is unavailable.`,
        503,
        "RPC_UNAVAILABLE",
      );
    }
    assert(
      status.chain_id === NETWORK,
      `The verification service is not connected to ${NETWORK_LABEL}.`,
      503,
      "WRONG_NETWORK",
    );
    assert(
      !status.sync_info?.syncing,
      `The ${NETWORK_LABEL} node is still synchronizing.`,
      503,
      "RPC_UNAVAILABLE",
    );
    verifiedNetworks.set(provider, Date.now() + 60000);
  })();
  networkChecks.set(provider, task);
  try {
    await task;
  } finally {
    if (networkChecks.get(provider) === task) networkChecks.delete(provider);
  }
}

// NEP-413 proves current FullAccess-key ownership; no transaction or player key is stored.
export async function verifyNearIdentity(challenge, response, provider) {
  assert(
    challenge.network === NETWORK,
    "This challenge is for a different network.",
    401,
  );
  assert(
    typeof response.publicKey === "string" &&
      response.publicKey.length <= 8192 &&
      typeof response.signature === "string" &&
      response.signature.length <= 16384 &&
      /^[A-Za-z0-9+/]+={0,2}$/.test(response.signature),
    "The wallet returned an invalid signature.",
  );
  assert(
    !response.accountId || response.accountId === challenge.accountId,
    "The wallet signed for a different account.",
    401,
  );
  const signature = new Uint8Array(Buffer.from(response.signature, "base64"));
  assert(
    signature.length >= 64 && signature.length <= 8192,
    "The wallet returned an invalid signature.",
  );
  try {
    await assertTestnetRpc(provider);
    await verifyMessage({
      signerAccountId: challenge.accountId,
      signerPublicKey: response.publicKey,
      payload: {
        message: challenge.message,
        recipient: challenge.recipient,
        nonce: new Uint8Array(Buffer.from(challenge.nonce, "base64")),
      },
      signature,
      provider,
    });
  } catch (error) {
    if (error?.code === "WRONG_NETWORK" || error?.code === "RPC_UNAVAILABLE")
      throw error;
    const invalid =
      /signature verification|fullaccess|unknown_access_key|accesskeydoesnotexist|accountdoesnotexist|does not exist|invalid public key/i.test(
        rpcErrorText(error),
      );
    assert(
      false,
      invalid
        ? "NEAR ownership could not be verified. Use a current full-access wallet key."
        : "The NEAR verification service is unavailable. Please retry.",
      invalid ? 401 : 503,
    );
  }
}
