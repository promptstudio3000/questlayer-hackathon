import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
  symlinkSync,
  utimesSync,
  existsSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { resolvePublicFile } from "../server/static-files.mjs";
const retention = resolve("deploy/retain-static-assets.py");
function setup(t) {
  const directory = mkdtempSync(join(tmpdir(), "questlayer-static-")),
    root = join(directory, "dist"),
    pool = join(directory, "assets");
  mkdirSync(join(root, "assets"), { recursive: true });
  mkdirSync(pool);
  writeFileSync(join(root, "index.html"), "<title>QuestLayer</title>");
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return { directory, root, pool };
}
test("hashed files are immutable while page routes still receive uncached HTML", (t) => {
  const { root } = setup(t);
  writeFileSync(join(root, "assets", "index-abcdefgh.js"), "export{};");
  assert.match(
    resolvePublicFile(root, "/assets/index-abcdefgh.js").cacheControl,
    /31536000,immutable/,
  );
  assert.equal(
    resolvePublicFile(root, "/explorer/welcome").file,
    join(root, "index.html"),
  );
  assert.equal(resolvePublicFile(root, "/").cacheControl, "no-cache");
  assert.throws(
    () => resolvePublicFile(root, "/assets/missing-abcdefgh.js"),
    (e) => e.status === 404,
  );
  assert.throws(
    () => resolvePublicFile(root, "/missing.json"),
    (e) => e.status === 404,
  );
});
test("an open tab can load a retained chunk but cannot ask the pool for arbitrary files", (t) => {
  const { root, pool } = setup(t);
  writeFileSync(join(pool, "wallet-abcdefgh.js"), "export const version=1;");
  writeFileSync(join(pool, "notes.txt"), "not a retained build asset");
  const file = resolvePublicFile(root, "/assets/wallet-abcdefgh.js", pool);
  assert.equal(file.retained, true);
  assert.equal(readFileSync(file.file, "utf8"), "export const version=1;");
  assert.throws(
    () => resolvePublicFile(root, "/assets/notes.txt", pool),
    (e) => e.status === 404,
  );
});
test("public file paths reject traversal, malformed encoding and escaping symlinks", (t) => {
  const { directory, root, pool } = setup(t),
    outside = join(directory, "private.txt");
  writeFileSync(outside, "not public");
  writeFileSync(join(root, ".env"), "not a real credential");
  assert.throws(
    () => resolvePublicFile(root, "/.env", pool),
    (e) => e.status === 403,
  );
  assert.throws(
    () => resolvePublicFile(root, "/%2e%2e/private.txt", pool),
    (e) => e.status === 403,
  );
  assert.throws(
    () => resolvePublicFile(root, "/%zz", pool),
    (e) => e.status === 400,
  );
  symlinkSync(outside, join(root, "assets", "escape-abcdefgh.js"));
  assert.throws(
    () => resolvePublicFile(root, "/assets/escape-abcdefgh.js", pool),
    (e) => e.status === 403,
  );
  symlinkSync(outside, join(pool, "shared-abcdefgh.js"));
  assert.throws(
    () => resolvePublicFile(root, "/assets/shared-abcdefgh.js", pool),
    (e) => e.status === 403,
  );
});
test("release retention copies public hashed assets and refuses changed contents under an existing hash", (t) => {
  const { directory } = setup(t),
    app = join(directory, "app"),
    release = join(app, "releases", "20261031T070000Z"),
    assets = join(release, "dist", "assets");
  mkdirSync(assets, { recursive: true });
  writeFileSync(join(assets, "map-abcdefgh.js"), "version one");
  writeFileSync(join(assets, "private.key"), "excluded");
  const run = () =>
    JSON.parse(
      execFileSync(
        "python3",
        [retention, "--app-root", app, "--release", release],
        { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
      ),
    );
  assert.equal(run().publicAssetsCopied, 1);
  assert.equal(existsSync(join(app, "assets", "private.key")), false);
  assert.equal(run().publicAssetsCopied, 0);
  writeFileSync(join(assets, "map-abcdefgh.js"), "changed under the same hash");
  assert.throws(run);
  assert.equal(
    readFileSync(join(app, "assets", "map-abcdefgh.js"), "utf8"),
    "version one",
  );
});
test("retention expires old unreferenced assets but protects current and five recent releases", (t) => {
  const { directory } = setup(t),
    app = join(directory, "app"),
    old = new Date(Date.now() - 9 * 86400000),
    names = [
      "20261020T070000Z",
      "20261021T070000Z",
      "20261022T070000Z",
      "20261023T070000Z",
      "20261024T070000Z",
      "20261031T070000Z",
    ];
  for (const [name, index] of names.map((name, index) => [name, index])) {
    const release = join(app, "releases", name),
      assets = join(release, "dist", "assets");
    mkdirSync(assets, { recursive: true });
    writeFileSync(join(assets, `map${index}-abcdefgh.js`), `version ${index}`);
    utimesSync(release, old, old);
  }
  const pool = join(app, "assets");
  mkdirSync(pool);
  writeFileSync(join(pool, "map0-abcdefgh.js"), "version 0");
  utimesSync(join(pool, "map0-abcdefgh.js"), old, old);
  const result = JSON.parse(
    execFileSync(
      "python3",
      [
        retention,
        "--app-root",
        app,
        "--release",
        join(app, "releases", names.at(-1)),
      ],
      { encoding: "utf8" },
    ),
  );
  assert.equal(result.expiredAssetsRemoved, 1);
  assert.equal(existsSync(join(pool, "map0-abcdefgh.js")), false);
  for (let i = 1; i < 6; i++)
    assert.equal(existsSync(join(pool, `map${i}-abcdefgh.js`)), true);
});
