// Who signs signed Aura orders and who sends the related market calls.
// Device: the invisible explorer's key signs silently (no popup); free calls
// are relayed and money moves in self-paid transactions. Wallet: an external
// NEAR wallet signs the same NEP-413 terms with signMessage (one approval per
// order) and sends market calls through the reviewed wallet flow.
import { signOrder, type OrderTerms, type SignedOrder } from "./signed-order.ts";
import type { PlayerKeyRecord } from "./player-key.ts";
import type { MarketCall } from "./SignedOrdersPanel.tsx";

export type OrderSigner = {
  accountId: string;
  kind: "device" | "wallet";
  /** The ed25519 key that signs orders; a wallet may need one approval. */
  publicKey(market: string): Promise<string>;
  knownPublicKey(): string | null;
  sign(terms: OrderTerms): Promise<SignedOrder>;
  /** Sends one market call; resolves with its hash when known. */
  call(call: MarketCall): Promise<string | null>;
};

export function deviceOrderSigner(
  key: PlayerKeyRecord,
  call: (c: MarketCall) => Promise<string | null>,
): OrderSigner {
  return {
    accountId: key.accountId!,
    kind: "device",
    publicKey: async () => key.publicKey,
    knownPublicKey: () => key.publicKey,
    sign: (terms) => signOrder(key, terms),
    call,
  };
}

type SignedMessage = { accountId: string; publicKey: string; signature: string };
export type MessageWallet = {
  signMessage(params: {
    message: string;
    recipient: string;
    nonce: Uint8Array;
    network?: "testnet" | "mainnet";
    signerId?: string;
  }): Promise<SignedMessage>;
};
const toBase64 = (bytes: Uint8Array) => {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
};
const keyStorage = (accountId: string) => `questlayer-order-key:${accountId}`;
function remembered(accountId: string) {
  try {
    return localStorage.getItem(keyStorage(accountId));
  } catch {
    return null;
  }
}
function remember(accountId: string, publicKey: string) {
  try {
    localStorage.setItem(keyStorage(accountId), publicKey);
  } catch {
    /* Only saves one wallet approval next time. */
  }
}
function checkSigned(signed: SignedMessage, accountId: string) {
  if (!signed || signed.accountId !== accountId)
    throw Error("The wallet signed with a different account. Nothing was published.");
  if (!/^ed25519:/.test(signed.publicKey))
    throw Error("Signed offers need an ed25519 wallet key.");
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(signed.signature))
    throw Error("The wallet returned an unsupported signature.");
}

export function walletOrderSigner(
  accountId: string,
  wallet: () => Promise<MessageWallet>,
  call: (c: MarketCall) => Promise<string | null>,
): OrderSigner {
  return {
    accountId,
    kind: "wallet",
    knownPublicKey: () => remembered(accountId),
    async publicKey(market) {
      const known = remembered(accountId);
      if (known) return known;
      // One approval tells us which wallet key signs messages.
      const signed = await (await wallet()).signMessage({
        message: "QuestLayer: use this key for signed Aura offers on the test network.",
        recipient: market,
        nonce: crypto.getRandomValues(new Uint8Array(32)),
        network: "testnet",
        signerId: accountId,
      });
      checkSigned(signed, accountId);
      remember(accountId, signed.publicKey);
      return signed.publicKey;
    },
    async sign(terms) {
      if (terms.maker !== accountId) throw Error("This wallet cannot sign for that account.");
      const message = JSON.stringify(terms),
        nonce = crypto.getRandomValues(new Uint8Array(32));
      const signed = await (await wallet()).signMessage({
        message,
        recipient: terms.market,
        nonce,
        network: "testnet",
        signerId: accountId,
      });
      checkSigned(signed, accountId);
      remember(accountId, signed.publicKey);
      return {
        message,
        nonce: toBase64(nonce),
        recipient: terms.market,
        callback_url: null,
        public_key: signed.publicKey,
        signature: signed.signature,
      };
    },
    call,
  };
}
