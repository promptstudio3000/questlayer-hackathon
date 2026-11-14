// The season was removed on 14 Nov 2026, but live databases already hold its
// schema module "season" v1 (season_finishers). A release must still start on
// such a database: the retired module stays registered (server/season/schema.mjs).
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { openDatabase, createPlayer } from "../server/database.mjs";
import { recordSchemaVersions, preflightDatabase } from "../server/schema-compatibility.mjs";

// The SQL live databases ran (schema module "season" v1, from 67b653ba).
// Copied here on purpose: the test must not register the module itself.
const SEASON_V1_SQL = `
CREATE TABLE IF NOT EXISTS season_finishers(season_id TEXT NOT NULL,player_id TEXT NOT NULL,points INTEGER NOT NULL CHECK(points>=0),edition TEXT,item_id TEXT,data TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(data)),created_at INTEGER NOT NULL,PRIMARY KEY(season_id,player_id));
CREATE INDEX IF NOT EXISTS season_finishers_time ON season_finishers(season_id,created_at)
`;

test("a database created with the season v1 schema still passes preflight and opens", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "questlayer-season-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, "live.sqlite");
  const db = openDatabase(path);
  // Exactly what the season service ran on live databases.
  db.exec(SEASON_V1_SQL);
  const player = createPlayer(db, "Season explorer");
  db.prepare("INSERT INTO season_finishers(season_id,player_id,points,created_at) VALUES('hackathon-2026',?,30,1)").run(player);
  recordSchemaVersions(db);
  db.close();
  const pre = preflightDatabase(path);
  assert.equal(pre.modules.find((m) => m.name === "season")?.version, 1);
  const again = openDatabase(path);
  t.after(() => again.close());
  assert.equal(again.prepare("SELECT count(*) n FROM season_finishers").get().n, 1);
  assert.equal(again.prepare("PRAGMA integrity_check").get().integrity_check, "ok");
});
