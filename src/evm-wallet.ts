// Ethereum wallets (MetaMask, Rabby and any EIP-1193 wallet) for QuestLayer:
// sign in with Ethereum (EIP-4361 text, personal_sign) and sign NEAR Intents
// with the ERC-191 standard the verifier supports. Loaded on demand only, and
// it talks to the wallet with plain EIP-1193 requests (no wallet SDK).
//
// The wallet only ever signs readable text. It never sends an Ethereum
// transaction, never approves a token and never sees a NEAR key.
import { api } from "./api";
import { loadNearApi } from "./near-api";
import type { Player } from "./types";
import type { IntentsConfig } from "./intents-order";
import { versionedNonce, INTENT_TTL_MS } from "./intents-order";

type Eip1193 = {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
};
export type EvmWalletChoice = {
  id: string;
  name: string;
  icon: string;
  website: string;
  provider: Eip1193;
};
export type LinkedEvmWallet = {
  address: string;
  intentsPublicKey: string;
  wallet: string | null;
  verifiedAt: number;
};
export type SignedErc191Intent = { standard: "erc191"; payload: string; signature: string };

const FALLBACK_ICON =
  "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'><path fill='%23627eea' d='M12 1 5 12.2l7 4.1 7-4.1zM5 13.6 12 23l7-9.4-7 4.1z'/></svg>";

/** Wallets the browser announces (EIP-6963), or the injected one. */
export async function discoverEvmWallets(waitMs = 250): Promise<EvmWalletChoice[]> {
  const found = new Map<string, EvmWalletChoice>();
  const onAnnounce = (event: Event) => {
    const detail = (event as CustomEvent).detail as
      | { info?: { uuid?: string; name?: string; icon?: string; rdns?: string }; provider?: Eip1193 }
      | undefined;
    if (!detail?.provider || !detail.info?.uuid) return;
    const icon = String(detail.info.icon || "");
    found.set(detail.info.uuid, {
      id: detail.info.uuid,
      name: String(detail.info.name || "Ethereum wallet").slice(0, 32),
      icon: /^data:image\//.test(icon) ? icon : FALLBACK_ICON,
      website: String(detail.info.rdns || "").split(".").reverse().join("."),
      provider: detail.provider,
    });
  };
  window.addEventListener("eip6963:announceProvider", onAnnounce);
  window.dispatchEvent(new Event("eip6963:requestProvider"));
  await new Promise((r) => setTimeout(r, waitMs));
  window.removeEventListener("eip6963:announceProvider", onAnnounce);
  const injected = (window as unknown as { ethereum?: Eip1193 & { isRabby?: boolean; isMetaMask?: boolean } }).ethereum;
  if (!found.size && injected)
    found.set("injected", {
      id: "injected",
      name: injected.isRabby ? "Rabby" : injected.isMetaMask ? "MetaMask" : "Ethereum wallet",
      icon: FALLBACK_ICON,
      website: "",
      provider: injected,
    });
  return [...found.values()];
}

async function accountOf(provider: Eip1193) {
  const accounts = (await provider.request({ method: "eth_requestAccounts" })) as string[];
  const address = accounts?.[0];
  if (!address || !/^0x[0-9a-fA-F]{40}$/.test(address)) throw Error("The wallet did not return an account.");
  return address;
}

function utf8Hex(text: string) {
  let hex = "0x";
  for (const b of new TextEncoder().encode(text)) hex += b.toString(16).padStart(2, "0");
  return hex;
}

async function personalSign(provider: Eip1193, address: string, message: string) {
  const signature = (await provider.request({ method: "personal_sign", params: [utf8Hex(message), address] })) as string;
  if (!/^0x[0-9a-fA-F]{130}$/.test(String(signature))) throw Error("The wallet returned an invalid signature.");
  return signature;
}

/**
 * Signs in (or links, when `link`) with an Ethereum wallet. A returning
 * wallet restores the same explorer.
 */
export async function signInWithEthereum(choice: EvmWalletChoice, options: { name?: string; link?: boolean } = {}) {
  const address = await accountOf(choice.provider);
  const chainId = parseInt(String(await choice.provider.request({ method: "eth_chainId" }).catch(() => "0x1")), 16) || 1;
  const c = await api<{ challengeId: string; message: string }>("/auth/evm/challenge", {
    address,
    chainId,
    name: options.name,
    wallet: choice.name,
    link: !!options.link,
  });
  const signature = await personalSign(choice.provider, address, c.message);
  return api<{ player: Player; returning: boolean; address: string; intentsPublicKey: string }>("/auth/evm/verify", {
    challengeId: c.challengeId,
    signature,
  });
}

export const linkedEvmWallets = () =>
  api<{ wallets: LinkedEvmWallet[] }>("/identity/evm").then((r) => r.wallets);

/** Finds a connected wallet that controls `address`, asking the user if needed. */
export async function walletFor(address: string): Promise<EvmWalletChoice> {
  const wallets = await discoverEvmWallets();
  for (const w of wallets) {
    const accounts = ((await w.provider.request({ method: "eth_accounts" }).catch(() => [])) as string[]) || [];
    if (accounts.some((a) => a.toLowerCase() === address)) return w;
  }
  for (const w of wallets) {
    const accounts = ((await w.provider.request({ method: "eth_requestAccounts" }).catch(() => [])) as string[]) || [];
    if (accounts.some((a) => a.toLowerCase() === address)) return w;
  }
  throw Error(`Open the wallet with ${address.slice(0, 6)}…${address.slice(-4)} and try again.`);
}

function toBase64(bytes: Uint8Array) {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

/**
 * Signs intents for the explorer's NEAR account (`signerId`) with an
 * Ethereum wallet, as a MultiPayload "erc191". The wallet shows the exact
 * JSON it signs. The verifier recovers the wallet's key and accepts it once
 * that key is registered for `signerId` (add_public_key).
 */
export async function signIntentsWithEthereum(
  wallet: LinkedEvmWallet,
  signerId: string,
  config: Pick<IntentsConfig, "verifier" | "salt">,
  intents: unknown[],
  ttlMs = INTENT_TTL_MS,
): Promise<SignedErc191Intent> {
  const deadlineMs = Date.now() + ttlMs;
  const nonce = versionedNonce(config.salt, deadlineMs);
  const payload = JSON.stringify({
    signer_id: signerId,
    verifying_contract: config.verifier,
    deadline: new Date(deadlineMs).toISOString(),
    nonce: toBase64(nonce),
    intents,
  });
  const choice = await walletFor(wallet.address);
  const hex = await personalSign(choice.provider, wallet.address, payload);
  const bytes = new Uint8Array(65);
  for (let i = 0; i < 65; i++) bytes[i] = parseInt(hex.slice(2 + i * 2, 4 + i * 2), 16);
  if (bytes[64] >= 27) bytes[64] -= 27;
  const { baseEncode } = await loadNearApi();
  return { standard: "erc191", payload, signature: `secp256k1:${baseEncode(bytes)}` };
}

export const shortAddress = (address: string) => `${address.slice(0, 6)}…${address.slice(-4)}`;
