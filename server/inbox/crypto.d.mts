// Types for crypto.mjs (the encrypted player inbox, docs/PLAYER-INBOX.md).
export declare const INBOX_SCHEMA = "questlayer.inbox/1";
export declare const INBOX_KEY_SCHEMA = "questlayer.inbox-key/1";
export declare const INBOX_MAX_CHARS = 500;
export declare const MESSAGE_ID: RegExp;
export declare const KEY_MUTATION: RegExp;
export declare const PUBLIC_KEY: RegExp;
export declare const NONCE: RegExp;
export declare const TAG: RegExp;
export declare const MAX_BOX_CHARS = 2752;
/** The message record exactly as it is stored on NEAR Social. */
export type InboxRecord = {
  schema: string;
  to: string;
  from_key: string;
  to_key: string;
  nonce: string;
  box: string;
  created_at: string;
};
export declare const RECORD_FIELDS: readonly ["schema", "to", "from_key", "to_key", "nonce", "box", "created_at"];
export type InboxKeyRecord = {
  schema: string;
  key: string;
  created_at: string;
  mutation_id: string;
};
export declare const KEY_FIELDS: readonly ["schema", "key", "created_at", "mutation_id"];
export declare function toBase64Url(bytes: Uint8Array): string;
export declare function fromBase64Url(value: string): Uint8Array;
/** Text a player may send: 1–500 characters, no control characters except new lines. */
export declare function validInboxText(text: unknown): text is string;
export declare function generateInboxKey(): {
  secret: Uint8Array;
  publicKey: Uint8Array;
};
export declare function inboxPublicKey(secret: Uint8Array): Uint8Array;
export type SealInput = {
  secret: Uint8Array;
  accountId: string;
  peerAccountId: string;
  peerPublicKey: Uint8Array;
  messageId: string;
  text: string;
  createdAt: number;
  nonce?: Uint8Array;
};
/** Encrypts one message from `accountId` to `peerAccountId`. */
export declare function sealInboxMessage(input: SealInput): InboxRecord;
/** Shape check, no keys needed. Used by the relayer policy and the server. */
export declare function validInboxRecord(r: unknown): r is InboxRecord;
export type OpenInput = {
  secret: Uint8Array;
  accountId: string;
  senderAccountId: string;
  recipientAccountId: string;
  messageId: string;
  record: InboxRecord;
};
/** Decrypts a message the holder of `secret` sent or received. Throws when it does not authenticate. */
export declare function openInboxMessage(input: OpenInput): string;
/** The single-message key a recipient may disclose with a report. */
export declare function inboxMessageKey(input: OpenInput): string;
/** Decrypts with a disclosed single-message key (moderation). */
export declare function openWithMessageKey(
  key: Uint8Array,
  senderAccountId: string,
  messageId: string,
  record: InboxRecord,
): string;
export declare function validInboxKeyRecord(r: unknown): r is InboxKeyRecord;
