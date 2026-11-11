// How long a map note stays (Lubos, 10 Nov 2026): a note can fade after one
// day or one week, or stay until its author removes it. A note without a row
// here stays. Expired notes leave every list; the row is kept for audit.
import { ensureModuleVersion, registerModuleSchema } from "./schema-compatibility.mjs";

export const NOTE_DAYS = Object.freeze([1, 7, 0]);
export const SOCIAL_NOTE_EXPIRY_SCHEMA = registerModuleSchema({
  name: "social-note-expiry",
  version: 1,
  sql: `
CREATE TABLE IF NOT EXISTS social_note_expiry(
 note_id TEXT PRIMARY KEY,
 expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS social_note_expiry_at ON social_note_expiry(expires_at);
`,
});

export function initSocialNoteExpiry(db) {
  ensureModuleVersion(db, SOCIAL_NOTE_EXPIRY_SCHEMA);
}
