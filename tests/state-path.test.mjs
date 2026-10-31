import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaultDatabasePath } from "../server/state-path.mjs";

test("new naming preserves existing state and rejects ambiguous databases", () => {
  const directory = mkdtempSync(join(tmpdir(), "questlayer-state-path-"));
  const prior = process.env.DATABASE_PATH;
  delete process.env.DATABASE_PATH;
  try {
    const current = join(directory, "questlayer-hackathon.sqlite");
    const legacy = join(directory, "auratrail.sqlite");
    assert.equal(defaultDatabasePath(directory), current);
    writeFileSync(legacy, "fixture");
    assert.equal(defaultDatabasePath(directory), legacy);
    writeFileSync(current, "fixture");
    assert.throws(() => defaultDatabasePath(directory), /Two state databases/);
    process.env.DATABASE_PATH = current;
    assert.equal(defaultDatabasePath(directory), current);
  } finally {
    if (prior === undefined) delete process.env.DATABASE_PATH;
    else process.env.DATABASE_PATH = prior;
    rmSync(directory, { recursive: true, force: true });
  }
});
