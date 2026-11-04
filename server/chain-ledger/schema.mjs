// Schema module "chain-ledger" v1 (docs/CHAIN-LEDGER.md): game actions waiting
// for the chain, the records sent to questlayer_ledger, per-account seq and
// daily Merkle roots. Imported by server/database.mjs so any process that opens
// the database recognizes these tables.
import { registerModuleSchema } from "../schema-compatibility.mjs";

export const CHAIN_LEDGER_SCHEMA = registerModuleSchema({
  name: "chain-ledger",
  version: 1,
  sql: `
CREATE TABLE IF NOT EXISTS chain_actions(id TEXT PRIMARY KEY,player_id TEXT NOT NULL,kind TEXT NOT NULL,xp INTEGER NOT NULL,gold_u INTEGER NOT NULL,cell TEXT,at INTEGER NOT NULL,day TEXT NOT NULL,evidence TEXT NOT NULL,evidence_json TEXT NOT NULL,account_id TEXT,record_id TEXT,leaf TEXT,created_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS chain_actions_player ON chain_actions(player_id,at);
CREATE INDEX IF NOT EXISTS chain_actions_unbound ON chain_actions(account_id,record_id);
CREATE INDEX IF NOT EXISTS chain_actions_day ON chain_actions(day,at);
CREATE TABLE IF NOT EXISTS chain_records(id TEXT PRIMARY KEY,account_id TEXT NOT NULL,seq INTEGER NOT NULL,kind TEXT NOT NULL,xp INTEGER NOT NULL,gold_u INTEGER NOT NULL,count INTEGER NOT NULL,cell TEXT,at INTEGER NOT NULL,ev TEXT NOT NULL,status TEXT NOT NULL CHECK(status IN('queued','confirmed','failed')),tx TEXT,attempts INTEGER NOT NULL DEFAULT 0,next_at INTEGER NOT NULL DEFAULT 0,error TEXT,created_at INTEGER NOT NULL,confirmed_at INTEGER,UNIQUE(account_id,seq));
CREATE INDEX IF NOT EXISTS chain_records_status ON chain_records(status,next_at,seq);
CREATE TABLE IF NOT EXISTS chain_seq(account_id TEXT PRIMARY KEY,last_seq INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS chain_days(day TEXT PRIMARY KEY,root TEXT NOT NULL,count INTEGER NOT NULL,xp INTEGER NOT NULL,gold_u INTEGER NOT NULL,status TEXT NOT NULL CHECK(status IN('queued','confirmed','failed')),tx TEXT,attempts INTEGER NOT NULL DEFAULT 0,next_at INTEGER NOT NULL DEFAULT 0,error TEXT,created_at INTEGER NOT NULL,confirmed_at INTEGER)
`,
});
