// End-to-end encryption for the player inbox (docs/PLAYER-INBOX.md).
//
// Each NEAR account has an X25519 inbox key generated inside the secure
// signing origin; its public half is published on NEAR Social at
// `<account>/questlayer/inbox_key`. A message is written by the sender, in the
// sender's own SocialDB namespace, as `<sender>/questlayer/inbox/msg_<uuid>`:
//
//   shared   = X25519(own secret, peer public)              (both sides agree)
//   context  = both account ids and both public keys, sorted by account
//   key      = HKDF-SHA256(shared, "questlayer-inbox/1", "msg|context|msg id")
//   box      = XChaCha20-Poly1305(key, random 24 byte nonce, padded text,
//              AAD = schema|sender|msg id|tag)
//   to (tag) = HKDF(shared, …, "tag|context"), 16 bytes hex
//
// This is the NaCl "box" construction (X25519 + an extended-nonce AEAD) with
// a per-message key, so a single message can be disclosed for a report
// without exposing the rest of the conversation. The recipient appears on
// chain only as the tag, which only the two explorers can compute. Text is
// padded to 128 byte buckets so the length reveals little.
//
// Pure module: used by the signing origin, by tests and by the server (which
// only ever holds a disclosed single-message key, never an inbox secret).
import { x25519 } from "@noble/curves/ed25519.js";
import { xchacha20poly1305 } from "@noble/ciphers/chacha.js";
import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { randomBytes } from "@noble/hashes/utils.js";
export const INBOX_SCHEMA = "questlayer.inbox/1";
export const INBOX_KEY_SCHEMA = "questlayer.inbox-key/1";
export const INBOX_MAX_CHARS = 500;
const PAD = 128,
  MAX_PADDED = 2048,
  SALT = new TextEncoder().encode("questlayer-inbox/1");
export const MESSAGE_ID = /^msg_[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
export const KEY_MUTATION = /^inboxkey_[a-f0-9-]{36}$/;
const B64URL = /^[A-Za-z0-9_-]+$/;
// 32 bytes = 43 base64url characters, 24 bytes = 32.
export const PUBLIC_KEY = /^[A-Za-z0-9_-]{43}$/;
export const NONCE = /^[A-Za-z0-9_-]{32}$/;
export const TAG = /^[a-f0-9]{32}$/;
// Largest box: 2048 padded bytes + 16 byte tag = 2064 bytes → 2752 chars.
export const MAX_BOX_CHARS = 2752;
export const RECORD_FIELDS = ["schema", "to", "from_key", "to_key", "nonce", "box", "created_at"];
export const KEY_FIELDS = ["schema", "key", "created_at", "mutation_id"];
const utf8 = new TextEncoder(),
  strictUtf8 = new TextDecoder("utf-8", { fatal: true });
export function toBase64Url(bytes) {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
export function fromBase64Url(value) {
  if (typeof value !== "string" || !B64URL.test(value) || value.length % 4 === 1) throw Error("Invalid encoding.");
  const s = atob(
    value
      .replace(/-/g, "+")
      .replace(/_/g, "/")
      .padEnd(Math.ceil(value.length / 4) * 4, "="),
  );
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
}
const hex = (b) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
/** Text a player may send: 1–500 characters, no control characters except new lines. */
export function validInboxText(text) {
  return (
    typeof text === "string" &&
    text.trim().length > 0 &&
    [...text].length <= INBOX_MAX_CHARS &&
    !/[\u0000-\u0009\u000B-\u001F\u007F\u2028\u2029]/.test(text)
  );
}
export function generateInboxKey() {
  const secret = x25519.utils.randomSecretKey();
  return { secret, publicKey: x25519.getPublicKey(secret) };
}
export function inboxPublicKey(secret) {
  return x25519.getPublicKey(secret);
}
function pad(text) {
  const body = utf8.encode(text);
  if (body.length + 2 > MAX_PADDED) throw Error("The message is too long.");
  const out = new Uint8Array(Math.ceil((body.length + 2) / PAD) * PAD);
  out[0] = body.length >> 8;
  out[1] = body.length & 255;
  out.set(body, 2);
  return out;
}
function unpad(bytes) {
  if (bytes.length < PAD || bytes.length > MAX_PADDED || bytes.length % PAD) throw Error("Invalid message.");
  const n = (bytes[0] << 8) | bytes[1];
  if (n + 2 > bytes.length || bytes.subarray(2 + n).some((b) => b !== 0)) throw Error("Invalid message.");
  const text = strictUtf8.decode(bytes.subarray(2, 2 + n));
  if (!validInboxText(text)) throw Error("Invalid message.");
  return text;
}
function context(a, b) {
  const [first, second] = a.accountId < b.accountId ? [a, b] : [b, a];
  if (first.accountId === second.accountId) throw Error("A message needs two explorers.");
  return `${first.accountId}|${toBase64Url(first.publicKey)}|${second.accountId}|${toBase64Url(second.publicKey)}`;
}
function shared(secret, peer) {
  const s = x25519.getSharedSecret(secret, peer);
  if (s.every((b) => b === 0)) throw Error("Invalid inbox key.");
  return s;
}
const derive = (ikm, info, length) => hkdf(sha256, ikm, SALT, utf8.encode(info), length);
const aad = (sender, messageId, tag) => utf8.encode(`${INBOX_SCHEMA}|${sender}|${messageId}|${tag}`);
/** Encrypts one message from `accountId` to `peerAccountId`. */
export function sealInboxMessage(input) {
  if (!MESSAGE_ID.test(input.messageId)) throw Error("Invalid message id.");
  if (!validInboxText(input.text)) throw Error("A message has 1–500 characters.");
  const mine = inboxPublicKey(input.secret),
    ctx = context(
      { accountId: input.accountId, publicKey: mine },
      { accountId: input.peerAccountId, publicKey: input.peerPublicKey },
    ),
    s = shared(input.secret, input.peerPublicKey),
    tag = hex(derive(s, `tag|${ctx}`, 16)),
    key = derive(s, `msg|${ctx}|${input.messageId}`, 32),
    nonce = input.nonce ?? randomBytes(24);
  const box = xchacha20poly1305(key, nonce, aad(input.accountId, input.messageId, tag)).encrypt(pad(input.text));
  return {
    schema: INBOX_SCHEMA,
    to: tag,
    from_key: toBase64Url(mine),
    to_key: toBase64Url(input.peerPublicKey),
    nonce: toBase64Url(nonce),
    box: toBase64Url(box),
    created_at: String(input.createdAt),
  };
}
/** Shape check, no keys needed. Used by the relayer policy and the server. */
export function validInboxRecord(r) {
  if (!r || typeof r !== "object" || Array.isArray(r)) return false;
  const o = r;
  const keys = Object.keys(o);
  return (
    keys.length === RECORD_FIELDS.length &&
    RECORD_FIELDS.every((f) => typeof o[f] === "string") &&
    o.schema === INBOX_SCHEMA &&
    TAG.test(o.to) &&
    PUBLIC_KEY.test(o.from_key) &&
    PUBLIC_KEY.test(o.to_key) &&
    o.from_key !== o.to_key &&
    NONCE.test(o.nonce) &&
    B64URL.test(o.box) &&
    o.box.length >= 192 &&
    o.box.length <= MAX_BOX_CHARS &&
    /^[1-9][0-9]{0,15}$/.test(o.created_at)
  );
}
function messageKeyFor(input) {
  if (!validInboxRecord(input.record) || !MESSAGE_ID.test(input.messageId)) throw Error("Invalid message.");
  const sent = input.accountId === input.senderAccountId;
  if (!sent && input.accountId !== input.recipientAccountId) throw Error("This message is not yours.");
  const fromKey = fromBase64Url(input.record.from_key),
    toKey = fromBase64Url(input.record.to_key),
    mine = inboxPublicKey(input.secret);
  if (toBase64Url(mine) !== (sent ? input.record.from_key : input.record.to_key))
    throw Error("This message was sent to another inbox key.");
  const ctx = context(
    { accountId: input.senderAccountId, publicKey: fromKey },
    { accountId: input.recipientAccountId, publicKey: toKey },
  );
  const s = shared(input.secret, sent ? toKey : fromKey);
  if (hex(derive(s, `tag|${ctx}`, 16)) !== input.record.to) throw Error("This message is not for this conversation.");
  return derive(s, `msg|${ctx}|${input.messageId}`, 32);
}
/** Decrypts a message the holder of `secret` sent or received. Throws when it does not authenticate. */
export function openInboxMessage(input) {
  return openWithMessageKey(messageKeyFor(input), input.senderAccountId, input.messageId, input.record);
}
/** The single-message key a recipient may disclose with a report. */
export function inboxMessageKey(input) {
  return toBase64Url(messageKeyFor(input));
}
/** Decrypts with a disclosed single-message key (moderation). */
export function openWithMessageKey(key, senderAccountId, messageId, record) {
  if (key.length !== 32 || !validInboxRecord(record)) throw Error("Invalid message.");
  const plain = xchacha20poly1305(key, fromBase64Url(record.nonce), aad(senderAccountId, messageId, record.to)).decrypt(
    fromBase64Url(record.box),
  );
  return unpad(plain);
}
export function validInboxKeyRecord(r) {
  if (!r || typeof r !== "object" || Array.isArray(r)) return false;
  const o = r;
  return (
    Object.keys(o).length === KEY_FIELDS.length &&
    KEY_FIELDS.every((f) => typeof o[f] === "string") &&
    o.schema === INBOX_KEY_SCHEMA &&
    PUBLIC_KEY.test(o.key) &&
    /^[1-9][0-9]{0,15}$/.test(o.created_at) &&
    KEY_MUTATION.test(o.mutation_id)
  );
}
