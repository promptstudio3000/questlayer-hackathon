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

// Quest flavour cache (W8, docs/QUEST-FLAVOUR.md). Texts are written only by
// the nightly batch, after validation; player requests only read them.
export const FLAVOUR_SCHEMA = registerModuleSchema({
  name: "ai-flavour",
  version: 1,
  sql: `
CREATE TABLE IF NOT EXISTS ai_flavour_cache(poi_id TEXT NOT NULL,template TEXT NOT NULL,layer_id TEXT NOT NULL,lang TEXT NOT NULL,prompt_version TEXT NOT NULL,title TEXT NOT NULL,description TEXT NOT NULL,provider TEXT NOT NULL,model TEXT,input_hash TEXT NOT NULL,batch_id TEXT NOT NULL,created_at INTEGER NOT NULL,PRIMARY KEY(poi_id,template,layer_id,lang,prompt_version));
CREATE TABLE IF NOT EXISTS ai_flavour_batches(id TEXT PRIMARY KEY,trigger TEXT NOT NULL CHECK(trigger IN('nightly','manual')),provider TEXT NOT NULL,model TEXT,prompt_version TEXT NOT NULL,layer_id TEXT NOT NULL,since_ms INTEGER NOT NULL,regions INTEGER NOT NULL DEFAULT 0,cells INTEGER NOT NULL DEFAULT 0,pois INTEGER NOT NULL DEFAULT 0,requested INTEGER NOT NULL DEFAULT 0,generated INTEGER NOT NULL DEFAULT 0,rejected INTEGER NOT NULL DEFAULT 0,failed_calls INTEGER NOT NULL DEFAULT 0,calls INTEGER NOT NULL DEFAULT 0,tokens_used INTEGER NOT NULL DEFAULT 0,token_budget INTEGER NOT NULL,outcome TEXT NOT NULL CHECK(outcome IN('running','completed','budget','skipped','failed')),reason TEXT,started_at INTEGER NOT NULL,finished_at INTEGER);
CREATE INDEX IF NOT EXISTS ai_flavour_batches_time ON ai_flavour_batches(started_at)
`,
});
