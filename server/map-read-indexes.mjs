// Indexes for the map reads (docs/PERFORMANCE-BUDGET.md). Every /api/world
// call reads the open coins and the quests of one world; without these SQLite
// scans every coin and quest of every past day, and the scan grows daily.
// Core tables keep their recorded baseline, so the indexes ship as a module
// with one marker table of its own.
import {
  registerModuleSchema,
  ensureModuleVersion,
} from "./schema-compatibility.mjs";

export const MAP_READ_INDEXES_SCHEMA = registerModuleSchema({
  name: "map-read-indexes",
  version: 1,
  sql: `
CREATE TABLE IF NOT EXISTS map_read_indexes(version INTEGER PRIMARY KEY);
CREATE INDEX IF NOT EXISTS coins_world_open ON coins(world_id,lat) WHERE claimant IS NULL;
CREATE INDEX IF NOT EXISTS quests_world ON quests(world_id)
`,
});

export function ensureMapReadIndexes(db) {
  return ensureModuleVersion(db, MAP_READ_INDEXES_SCHEMA);
}
