// How long a map note stays (Lubos, 10 Nov 2026; Keep removed 14 Nov 2026):
// every note fades after one day or one week, one week by default. Expired
// notes leave every list; the row is kept for audit.
import { ensureModuleVersion, registerModuleSchema } from "./schema-compatibility.mjs";

export const NOTE_DAYS = Object.freeze([1, 7]);
export const NOTE_DEFAULT_DAYS = 7;
const DAY_MS = 86_400_000;
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

// Call once messages and social_note_meta exist.
export function backfillNoteExpiry(db) {
  // A note never stays for good: one without a row (the old "Keep") fades a
  // week after it was written.
  db.prepare(
    `INSERT OR IGNORE INTO social_note_expiry(note_id,expires_at)
     SELECT m.id,m.created_at+? FROM messages m JOIN social_note_meta s ON s.note_id=m.id
     WHERE NOT EXISTS(SELECT 1 FROM social_note_expiry e WHERE e.note_id=m.id)`,
  ).run(NOTE_DEFAULT_DAYS * DAY_MS);
}
