// Schema definitions for the AI modules. database.mjs imports this file so
// every process that opens the database (server, CLIs, QA scripts) recognises
// these tables, whichever AI feature created them.
import { registerModuleSchema } from "../schema-compatibility.mjs";

export const QUEST_DRAFTS_SCHEMA = registerModuleSchema({
  name: "ai-quest-drafts",
  version: 1,
  sql: `
CREATE TABLE IF NOT EXISTS ai_quest_draft_requests(id TEXT PRIMARY KEY,actor TEXT NOT NULL,city_id TEXT NOT NULL,candidate_id TEXT NOT NULL,template TEXT NOT NULL,provider TEXT NOT NULL,model TEXT,outcome TEXT NOT NULL CHECK(outcome IN('drafted','fallback','rejected','limited')),reason TEXT,input_hash TEXT NOT NULL,output_hash TEXT,created_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS ai_quest_draft_actor ON ai_quest_draft_requests(actor,created_at);
CREATE INDEX IF NOT EXISTS ai_quest_draft_time ON ai_quest_draft_requests(created_at)
`,
});

export const AI_OPERATIONS_SCHEMA = registerModuleSchema({
  name: "ai-operations",
  version: 1,
  sql: `
CREATE TABLE IF NOT EXISTS ai_guide_requests(id TEXT PRIMARY KEY,actor TEXT NOT NULL,provider TEXT NOT NULL,model TEXT,outcome TEXT NOT NULL CHECK(outcome IN('answered','fallback','rules','limited')),reason TEXT,facts_hash TEXT NOT NULL,output_hash TEXT NOT NULL,created_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS ai_guide_actor ON ai_guide_requests(actor,created_at);
CREATE TABLE IF NOT EXISTS ai_proposals(id TEXT PRIMARY KEY,city_id TEXT NOT NULL,candidate_id TEXT NOT NULL,template TEXT NOT NULL,content TEXT NOT NULL CHECK(json_valid(content)),provenance TEXT NOT NULL CHECK(json_valid(provenance)),state TEXT NOT NULL CHECK(state IN('previewed','approved','rejected')),created_by TEXT NOT NULL,decided_by TEXT,reason TEXT,created_at INTEGER NOT NULL,decided_at INTEGER);
CREATE TABLE IF NOT EXISTS ai_operator_audit(seq INTEGER PRIMARY KEY,id TEXT NOT NULL UNIQUE,operator TEXT NOT NULL,action TEXT NOT NULL,target TEXT NOT NULL,detail TEXT NOT NULL CHECK(json_valid(detail)),created_at INTEGER NOT NULL,prev_hash TEXT NOT NULL,hash TEXT NOT NULL)
`,
});
