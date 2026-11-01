import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

// Every module that registers a schema must be in the catalog, so backup,
// restore and seed tools that open the DB through it accept its tables.
test("schema catalog lists every module that registers a schema", () => {
  const root = new URL("../server/", import.meta.url).pathname;
  const catalog = readFileSync(join(root, "schema-catalog.mjs"), "utf8");
  const files = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (name.endsWith(".mjs")) files.push(path);
    }
  };
  walk(root);
  const missing = files
    .filter((f) => !f.endsWith("schema-compatibility.mjs"))
    .filter((f) => /registerModuleSchema\(/.test(readFileSync(f, "utf8")))
    .map((f) => "./" + relative(root, f))
    .filter((rel) => !catalog.includes(`"${rel}"`));
  assert.deepEqual(missing, []);
});
