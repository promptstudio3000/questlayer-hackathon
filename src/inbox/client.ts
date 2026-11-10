// Game-side inbox flow (docs/PLAYER-INBOX.md). Encryption happens in the
// secure signing origin; this file only moves public keys, ciphertext and the
// SocialDB writes the relayer sponsors.
import { api } from "../api";
import { NEAR_NETWORK, SOCIAL_CONTRACT_ID } from "../near-network";
import type { NativeSigner } from "../native-signer";
import type { InboxRecord } from "../../server/inbox/crypto.mjs";

export type InboxRelation = "none" | "requested" | "incoming" | "open" | "declined";
export type InboxOverview = {
  enabled: boolean;
  accountId?: string | null;
  publicKey?: string | null;
  muted?: boolean;
  unread: number;
  requests: number;
  conversations?: { playerId: string; name: string; state: InboxRelation; unread: number; lastAt: number; lastMine: boolean | null }[];
  incoming?: { id: string; name: string; at: number }[];
};
export type InboxThread = {
  peer: { id: string; name: string; accountId: string | null; inbox: boolean };
  state: InboxRelation;
  muted: boolean;
  messages: { id: string; mine: boolean; sender: string; recipient: string; state: "pending" | "delivered"; at: number }[];
};
export type InboxKeyState = { accountId: string; publicKey: string; published: boolean; elsewhere: boolean };
type Quote = { receiverId: string; accountId: string; methodName: string; gas: string; deposit: string; args: Record<string, unknown> };

const vault = async <T>(method: string, input: unknown = {}) =>
  (await import("../signing-vault/client.ts")).vaultRequest<T>(method, input);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function publish(signer: NativeSigner, playerId: string, quote: Quote) {
  if (quote.receiverId !== SOCIAL_CONTRACT_ID || quote.accountId !== signer.accountId || quote.methodName !== "set")
    throw Error("The inbox record does not match your account.");
  await signer.send(
    {
      network: NEAR_NETWORK,
      signerId: signer.accountId,
      receiverId: SOCIAL_CONTRACT_ID,
      actions: [
        { type: "FunctionCall", params: { methodName: "set", args: quote.args, gas: quote.gas, deposit: quote.deposit } },
      ],
    },
    { playerId },
  );
}

/**
 * Makes sure this device holds the published inbox key. Publishes a new one
 * when the account has none; with `rotate` replaces a key held by another device.
 */
export async function ensureInboxKey(signer: NativeSigner, playerId: string, rotate = false): Promise<InboxKeyState> {
  if (signer.kind !== "managed") throw Error("Messages need your explorer account.");
  const key = await vault<InboxKeyState>("inboxKey", { rotate });
  if (key.accountId !== signer.accountId) throw Error("The secure account belongs to another explorer.");
  if (key.published) {
    await api("/inbox/key/sync", {});
    return key;
  }
  if (key.elsewhere && !rotate) return key;
  const quote = await api<Quote & { record: { key: string } }>("/inbox/key/prepare", { publicKey: key.publicKey });
  if (quote.record.key !== key.publicKey) throw Error("The inbox key changed. Try again.");
  await publish(signer, playerId, quote);
  for (let attempt = 0; attempt < 8; attempt++) {
    const r = await api<{ published: boolean; publicKey: string | null }>("/inbox/key/sync", {});
    if (r.publicKey === key.publicKey) return { ...key, published: true, elsewhere: false };
    await sleep(1500);
  }
  return key;
}

export async function sendInboxMessage(signer: NativeSigner, playerId: string, peer: { id: string; accountId: string }, text: string) {
  const messageId = `msg_${crypto.randomUUID()}`;
  const record = await vault<InboxRecord>("inboxSeal", { peerAccountId: peer.accountId, messageId, text });
  const quote = await api<Quote & { messageId: string }>("/inbox/send", { playerId: peer.id, messageId, record });
  if (quote.messageId !== messageId) throw Error("The message changed. Try again.");
  await publish(signer, playerId, quote);
  for (let attempt = 0; attempt < 6; attempt++) {
    const r = await api<{ state: string }>("/inbox/confirm", { messageId });
    if (r.state !== "pending") return { messageId, state: r.state };
    await sleep(1500);
  }
  return { messageId, state: "pending" };
}

export type OpenedMessage = { messageId: string; text?: string; error?: "pending" | "other-device" | "unreadable" };
export async function openInboxMessages(items: { sender: string; recipient: string; messageId: string }[]) {
  const out: OpenedMessage[] = [];
  for (let i = 0; i < items.length; i += 40) out.push(...(await vault<OpenedMessage[]>("inboxOpen", { items: items.slice(i, i + 40) })));
  return out;
}

export async function reportInboxMessage(item: { sender: string; recipient: string; messageId: string }, reason: string) {
  let messageKey: string | undefined;
  try {
    messageKey = (await vault<{ messageKey: string }>("inboxReveal", { items: [item] })).messageKey;
  } catch {
    // Still report; the moderator then sees the report without the text.
  }
  return api<{ verified: boolean }>("/inbox/report", { messageId: item.messageId, reason, messageKey });
}
