// Identity tables. Version 2 widens identity_sessions.kind for Ethereum
// wallet (SIWE) sign-ins; no stored row changes. evm-identity owns the
// links between an Ethereum address and an explorer.
import {
  registerModuleSchema,
  ensureModuleVersion,
} from "../schema-compatibility.mjs";

export const IDENTITY_SCHEMA = registerModuleSchema({
  name: "identity",
  version: 2,
  sql: `
      CREATE TABLE IF NOT EXISTS identity_sessions(
        token_hash TEXT PRIMARY KEY REFERENCES sessions(token_hash) ON DELETE CASCADE,
        public_id TEXT NOT NULL UNIQUE,
        kind TEXT NOT NULL CHECK(kind IN ('guest','near-wallet','evm-wallet','demo-passkey','legacy')),
        account_id TEXT,
        created_at INTEGER,
        last_seen_at INTEGER,
        verified_at INTEGER
      );
      CREATE TABLE IF NOT EXISTS identity_recovery_events(
        id TEXT PRIMARY KEY,
        player_id TEXT NOT NULL REFERENCES players(id),
        session_id TEXT NOT NULL,
        account_id TEXT NOT NULL,
        revoked_sessions INTEGER NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS sessions_player ON sessions(player_id);
  `,
  upgrades: [
    {
      from: 1,
      loosen: {
        identity_sessions: [
          [
            "CHECK(kind IN ('guest','near-wallet','demo-passkey','legacy'))",
            "CHECK(kind IN ('guest','near-wallet','evm-wallet','demo-passkey','legacy'))",
          ],
        ],
      },
    },
  ],
});

// One Ethereum address belongs to at most one explorer. public_key is the
// uncompressed secp256k1 key recovered from the sign-in signature, in the
// NEAR Intents format ("secp256k1:<base58 of 64 bytes>"), so the wallet can
// be registered as an intents signer of the explorer's NEAR account.
export const EVM_IDENTITY_SCHEMA = registerModuleSchema({
  name: "evm-identity",
  version: 1,
  sql: `
CREATE TABLE IF NOT EXISTS evm_links(
 address TEXT PRIMARY KEY CHECK(address GLOB '0x[0-9a-f]*' AND length(address)=42),
 player_id TEXT NOT NULL REFERENCES players(id),
 public_key TEXT NOT NULL CHECK(public_key GLOB 'secp256k1:*'),
 wallet TEXT,
 created_at INTEGER NOT NULL,
 verified_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS evm_links_player ON evm_links(player_id);
`,
});

export function initializeIdentity(db) {
  ensureModuleVersion(db, IDENTITY_SCHEMA);
  ensureModuleVersion(db, EVM_IDENTITY_SCHEMA);
}
