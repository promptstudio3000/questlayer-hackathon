import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveBuildId } from "../server/build-id.mjs";
import { schemaStatus } from "../server/schema-compatibility.mjs";
import { DatabaseSync } from "node:sqlite";

test("health build id comes from the env, else the deployed build-id.txt, else stays unrecorded", () => {
  const dir = mkdtempSync(join(tmpdir(), "ql-build-")),
    file = join(dir, "build-id.txt"),
    sha = "42631f1c2d0eb6da4b620113dc32e6a45480bfe1";
  assert.equal(resolveBuildId({ env: {}, file }), undefined);
  writeFileSync(file, `${sha}\n`);
  assert.equal(resolveBuildId({ env: {}, file }), sha);
  assert.equal(resolveBuildId({ env: { QUESTLAYER_BUILD_ID: "reviewed-1" }, file }), "reviewed-1");
  writeFileSync(file, "");
  assert.equal(resolveBuildId({ env: {}, file }), undefined);
  const db = new DatabaseSync(":memory:");
  assert.deepEqual(schemaStatus(db, { buildId: sha }).source, { buildId: sha, recorded: true });
  assert.deepEqual(schemaStatus(db, { buildId: undefined }).source, { buildId: "development-unrecorded", recorded: false });
});
