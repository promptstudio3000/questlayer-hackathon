import test from "node:test";
import assert from "node:assert/strict";
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { buildCzechiaFixture } from "./fixtures/world-coverage/czechia.mjs";
import { validateRelease } from "../scripts/poi/validate-release.mjs";

let fixture;
test.before(async () => {
  fixture = await buildCzechiaFixture(mkdtempSync(join(tmpdir(), "poi-validate-")), {
    version: "cz-20261102-0123abcd",
  });
  const manifestPath = join(fixture.dir, "current.manifest.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  manifest.inputs = [{ source: "fixture", url: "file:", version: "1", sha256: "n/a", licence: "ODbL-1.0" }];
  writeFileSync(manifestPath, JSON.stringify(manifest));
  fixture.manifestPath = manifestPath;
});
test.after(() => rmSync(fixture.dir, { recursive: true, force: true }));

test("a release built by scripts/poi/build.mjs is accepted", () => {
  const result = validateRelease(fixture.dbPath, { manifestPath: fixture.manifestPath });
  assert.deepEqual(result.errors, []);
  assert.equal(result.ok, true);
  assert.equal(result.stats.pois, 19);
  assert.ok(result.stats.pathCells > 0);
});

function broken(mutate) {
  const path = join(fixture.dir, `broken-${Math.random().toString(16).slice(2)}.sqlite`);
  copyFileSync(fixture.dbPath, path);
  const db = new DatabaseSync(path);
  mutate(db);
  db.close();
  return validateRelease(path);
}

test("contract violations are rejected with a reason", () => {
  const cases = [
    [(db) => db.exec("UPDATE meta SET value='questlayer.poi/2' WHERE key='schema'"), /meta.schema/],
    [(db) => db.exec("UPDATE meta SET value='world-latest' WHERE key='version'"), /meta.version/],
    [(db) => db.exec("UPDATE poi SET category='pub' WHERE id=(SELECT id FROM poi ORDER BY id LIMIT 1)"), /category pub/],
    [(db) => db.exec("UPDATE poi SET safety_reason='nice' WHERE id=(SELECT id FROM poi WHERE safety='excluded' LIMIT 1)"), /unknown safety_reason/],
    [(db) => db.exec("UPDATE poi SET path_ref=NULL WHERE id=(SELECT id FROM poi WHERE safety='ok' ORDER BY id LIMIT 1)"), /ok row needs path_ref|hash/],
    [(db) => db.exec("UPDATE poi SET lat=lat+1 WHERE id=(SELECT id FROM poi ORDER BY id LIMIT 1)"), /h3r7 is not/],
    [(db) => db.exec("UPDATE partition SET ok=ok+1 WHERE h3r5=(SELECT h3r5 FROM partition LIMIT 1)"), /partition .*\.ok/],
    [(db) => db.exec("ALTER TABLE poi ADD COLUMN extra TEXT"), /table poi columns/],
  ];
  for (const [mutate, pattern] of cases) {
    const result = broken(mutate);
    assert.equal(result.ok, false, String(pattern));
    assert.ok(result.errors.some((e) => pattern.test(e)), `${pattern} not in ${result.errors.join(" | ")}`);
  }
});
