// Inbox keys inside the secure signing origin (docs/PLAYER-INBOX.md).
//
// The X25519 secret is generated here and never leaves this origin: the game
// receives public keys, ciphertext records to publish and the plaintext of
// messages it asked to open. Peer keys and the records to open are read from
// NEAR Social directly by this origin, never taken from the game server, so a
// compromised server can neither swap a recipient's key nor forge a message.
import {
  fromBase64Url,
  generateInboxKey,
  inboxMessageKey,
  openInboxMessage,
  sealInboxMessage,
  toBase64Url,
  validInboxKeyRecord,
  validInboxRecord,
  MESSAGE_ID,
  type InboxRecord,
} from "../../server/inbox/crypto.mjs";
import { vaultRecord } from "./store.ts";

type StoredKey = { secret: string; publicKey: string; createdAt: number };
type Stored = { keys: StoredKey[] };
export type InboxVaultContext = {
  accountId: string;
  socialContract: string;
  view: (args: { keys: string[] }) => Promise<unknown>;
  now?: () => number;
};
const ACCOUNT = /^(?=.{2,64}$)[a-z0-9]+(?:[-_][a-z0-9]+)*(?:\.[a-z0-9]+(?:[-_][a-z0-9]+)*)*$/;
const need = (ok: unknown, message: string) => {
  if (!ok) throw Error(message);
};
const leaf = (o: unknown, ...path: string[]) =>
  path.reduce<unknown>((v, k) => (v && typeof v === "object" ? (v as Record<string, unknown>)[k] : undefined), o);

async function load(accountId: string): Promise<Stored> {
  return (await vaultRecord<Stored>(`inbox:${accountId}`)) ?? { keys: [] };
}
async function save(accountId: string, stored: Stored) {
  await vaultRecord(`inbox:${accountId}`, { keys: stored.keys.slice(0, 8) });
}
async function chainKey(ctx: InboxVaultContext, accountId: string) {
  const r = leaf(await ctx.view({ keys: [`${accountId}/questlayer/inbox_key/**`] }), accountId, "questlayer", "inbox_key");
  return validInboxKeyRecord(r) ? r.key : null;
}

/** Current inbox key of the bound account; creates one on first use. */
export async function inboxKey(ctx: InboxVaultContext, input: { rotate?: boolean }) {
  return navigator.locks.request(`vault-inbox:${ctx.accountId}`, async () => {
    const stored = await load(ctx.accountId),
      onChain = await chainKey(ctx, ctx.accountId);
    const held = onChain ? stored.keys.findIndex((k) => k.publicKey === onChain) : -1;
    if (held > 0) stored.keys.unshift(...stored.keys.splice(held, 1));
    // A key published from another device stays in force unless the player
    // explicitly sets up the inbox on this device (rotate).
    if (!stored.keys.length || (input.rotate === true && held !== 0)) {
      const fresh = generateInboxKey();
      stored.keys.unshift({
        secret: toBase64Url(fresh.secret),
        publicKey: toBase64Url(fresh.publicKey),
        createdAt: (ctx.now ?? Date.now)(),
      });
    }
    await save(ctx.accountId, stored);
    const current = stored.keys[0].publicKey;
    return {
      accountId: ctx.accountId,
      publicKey: current,
      published: onChain === current,
      // Another device holds the published key: this device cannot read
      // messages sent to it.
      elsewhere: !!onChain && onChain !== current && !stored.keys.some((k) => k.publicKey === onChain),
    };
  });
}

export async function inboxSeal(
  ctx: InboxVaultContext,
  input: { peerAccountId?: unknown; messageId?: unknown; text?: unknown },
) {
  need(typeof input.peerAccountId === "string" && ACCOUNT.test(input.peerAccountId), "Invalid recipient.");
  need(input.peerAccountId !== ctx.accountId, "You cannot message yourself.");
  need(typeof input.messageId === "string" && MESSAGE_ID.test(input.messageId), "Invalid message id.");
  need(typeof input.text === "string", "Write a message first.");
  const stored = await load(ctx.accountId),
    [mine, peer] = await Promise.all([chainKey(ctx, ctx.accountId), chainKey(ctx, input.peerAccountId as string)]);
  const own = stored.keys.find((k) => k.publicKey === mine);
  need(own, "Set up your inbox on this device first.");
  need(peer, "This explorer has not opened their inbox yet.");
  return sealInboxMessage({
    secret: fromBase64Url(own!.secret),
    accountId: ctx.accountId,
    peerAccountId: input.peerAccountId as string,
    peerPublicKey: fromBase64Url(peer!),
    messageId: input.messageId as string,
    text: input.text as string,
    createdAt: (ctx.now ?? Date.now)(),
  });
}

type Item = { sender: string; recipient: string; messageId: string };
function items(input: { items?: unknown }, max: number): Item[] {
  need(Array.isArray(input.items) && input.items.length >= 1 && input.items.length <= max, "Invalid message list.");
  return (input.items as Record<string, unknown>[]).map((i) => {
    need(
      i &&
        typeof i.sender === "string" &&
        ACCOUNT.test(i.sender) &&
        typeof i.recipient === "string" &&
        ACCOUNT.test(i.recipient) &&
        typeof i.messageId === "string" &&
        MESSAGE_ID.test(i.messageId),
      "Invalid message.",
    );
    return { sender: i.sender as string, recipient: i.recipient as string, messageId: i.messageId as string };
  });
}
async function records(ctx: InboxVaultContext, list: Item[]) {
  const data = await ctx.view({ keys: list.map((i) => `${i.sender}/questlayer/inbox/${i.messageId}/**`) });
  return list.map((i) => {
    const r = leaf(data, i.sender, "questlayer", "inbox", i.messageId);
    return validInboxRecord(r) ? (r as InboxRecord) : null;
  });
}
function openOne(stored: Stored, accountId: string, item: Item, record: InboxRecord | null) {
  if (!record) return { error: "pending" as const };
  const mine = accountId === item.sender ? record.from_key : record.to_key;
  const key = stored.keys.find((k) => k.publicKey === mine);
  if (!key) return { error: "other-device" as const };
  return {
    input: {
      secret: fromBase64Url(key.secret),
      accountId,
      senderAccountId: item.sender,
      recipientAccountId: item.recipient,
      messageId: item.messageId,
      record,
    },
  };
}

/** Opens up to 40 messages of the bound account, read from NEAR Social. */
export async function inboxOpen(ctx: InboxVaultContext, input: { items?: unknown }) {
  const list = items(input, 40);
  const stored = await load(ctx.accountId),
    found = await records(ctx, list);
  return list.map((item, n) => {
    const r = openOne(stored, ctx.accountId, item, found[n]);
    if (!("input" in r)) return { messageId: item.messageId, error: r.error };
    try {
      return { messageId: item.messageId, text: openInboxMessage(r.input!) };
    } catch {
      return { messageId: item.messageId, error: "unreadable" };
    }
  });
}

/** The single-message key the recipient discloses with a report. */
export async function inboxReveal(ctx: InboxVaultContext, input: { items?: unknown }) {
  const [item] = items(input, 1);
  need(item.recipient === ctx.accountId, "Only received messages can be reported.");
  const stored = await load(ctx.accountId),
    [record] = await records(ctx, [item]);
  const r = openOne(stored, ctx.accountId, item, record);
  need("input" in r, "This message cannot be opened on this device.");
  return { messageId: item.messageId, messageKey: inboxMessageKey(r.input!) };
}
