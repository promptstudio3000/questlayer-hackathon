// Wallet words: twelve new words whose key is added to the player's account as
// one more full-access key, so the same account opens in Meteor or any other
// NEAR wallet. The device key never leaves the vault, and the words exist only
// in the memory of the secure window that shows them: never in storage, a
// request result, a log, the clipboard, the game or the server.
import {
  RecoveryError,
  WALLET_WORDS_LABEL,
  readRecoveryPasskey,
  relayKeyChange,
  type ApiCall,
  type CredentialsApi,
} from "../account-recovery.ts";
import type { PlayerKeyRecord } from "../player-key.ts";
import { loadNearApi } from "../near-api.ts";
import { generateMnemonic, mnemonicToSeedSync } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english";
import { hmac } from "@noble/hashes/hmac.js";
import { sha512 } from "@noble/hashes/sha2.js";

// The NEAR wallets' own recipe (near-seed-phrase): BIP-39 words, then SLIP-10
// ed25519 at m/44'/397'/0'. Written with the audited noble/scure primitives
// because near-seed-phrase needs Node's Buffer, which a browser lacks.
const NEAR_PATH = [44, 397, 0];
export function walletSecretFromWords(phrase: string) {
  let node = hmac(sha512, new TextEncoder().encode("ed25519 seed"), mnemonicToSeedSync(phrase));
  for (const index of NEAR_PATH) {
    const data = new Uint8Array(37);
    data.set(node.subarray(0, 32), 1);
    new DataView(data.buffer).setUint32(33, (index | 0x80000000) >>> 0);
    node = hmac(sha512, node.subarray(32), data);
  }
  return node.slice(0, 32);
}
export async function newWalletWords() {
  const phrase = generateMnemonic(wordlist, 128);
  const { KeyPairEd25519, baseEncode } = await loadNearApi();
  const secret = walletSecretFromWords(phrase);
  const publicKey = new KeyPairEd25519(baseEncode(secret))
    .getPublicKey()
    .toString();
  secret.fill(0);
  return { words: phrase.split(" "), publicKey };
}

const pick = (n: number) =>
  crypto.getRandomValues(new Uint32Array(1))[0] % n;
function shuffled<T>(items: T[], random: (n: number) => number) {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = random(i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
export type WordCheck = { position: number; answer: string; options: string[] };
// Two "which is word N?" rounds, each with the right word and three others
// from the same phrase. Proves the player can read their own copy back.
export function wordChecks(
  words: string[],
  random: (n: number) => number = pick,
  rounds = 2,
): WordCheck[] {
  return shuffled(
    words.map((_, i) => i),
    random,
  )
    .slice(0, rounds)
    .sort((a, b) => a - b)
    .map((index) => {
      const answer = words[index];
      const others = shuffled(
        [...new Set(words)].filter((w) => w !== answer),
        random,
      ).slice(0, 3);
      return {
        position: index + 1,
        answer,
        options: shuffled([answer, ...others], random),
      };
    });
}

// Registers the words' public key with the game and adds it on chain, signed
// by this device's key and sponsored like every other key change.
export async function activateWalletWords({
  deviceKey,
  accountId,
  publicKey,
  api,
  intervalMs,
}: {
  deviceKey: PlayerKeyRecord;
  accountId: string;
  publicKey: string;
  api: ApiCall;
  intervalMs?: number;
}) {
  await api("/account/keys", {
    publicKey,
    kind: "device",
    label: WALLET_WORDS_LABEL,
  });
  await relayKeyChange(
    deviceKey,
    { accountId, change: "add", publicKey },
    { api, intervalMs },
  );
  return { publicKey };
}

// Players with a recovery passkey unlock it (fingerprint, face or PIN) before
// any word is shown. The passkey must re-derive a key that is live on this
// very account, so another person's passkey does not pass.
export async function confirmWithPasskey({
  accountId,
  credentials,
  rpId,
  isFullAccessKey,
}: {
  accountId: string;
  credentials: CredentialsApi;
  rpId: string;
  isFullAccessKey: (accountId: string, publicKey: string) => Promise<boolean>;
}) {
  const read = await readRecoveryPasskey({ credentials, rpId });
  if (
    read.accountId !== accountId ||
    !(await isFullAccessKey(accountId, read.recovery.publicKey))
  )
    throw new RecoveryError(
      "That passkey does not belong to this account.",
      "RECOVERY_ACCOUNT",
    );
}
