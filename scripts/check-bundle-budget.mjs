// Bundle budget for the welcome screen. Reads dist/ after `npm run build` and
// follows everything the browser loads before the name step: the entry
// script, its modulepreloads and their static imports, plus the entry
// stylesheets. Fails when that grows past the budget, or when MapLibre, the
// map, near-api-js or one of the split-off screens slips back into it.
//
// Usage:  npm run build && npm run budget
// Overrides: BUNDLE_BUDGET_JS_GZIP_KB, BUNDLE_BUDGET_CSS_GZIP_KB.
import { existsSync, readFileSync } from "node:fs";
import { join, posix, resolve } from "node:path";
import { gzipSync } from "node:zlib";

const DIST = resolve(import.meta.dirname, "..", "dist");
// November 2026: 181 KB gzip JS after the split (was 762 KB with the map).
const BUDGET = {
  jsGzipKb: Number(process.env.BUNDLE_BUDGET_JS_GZIP_KB || 220),
  cssGzipKb: Number(process.env.BUNDLE_BUDGET_CSS_GZIP_KB || 36),
};
// Chunk names that must stay out of the first load.
const DEFERRED = [
  /maplibre/i,
  /GameMap/,
  /character-3d-scene/,
  /CreatorCommunity/,
  /CommunityBonusVote/,
  /NativeMarketPanel/,
  /NativeWardrobe/,
  /SignedOrdersPanel/,
  /Inventory/,
  /NativeTasks/,
  /MapNotes/,
  /MonsterChallenge/,
];
// Code that must stay out of the first load, by a string only it contains.
const DEFERRED_CODE = [
  {
    name: "near-api-js and its crypto",
    pattern: /sig type is not supported for cofactor/,
  },
  { name: "MapLibre", pattern: /maplibregl-boxzoom/ },
];

const indexPath = join(DIST, "index.html");
if (!existsSync(indexPath)) {
  console.error("dist/index.html is missing. Run `npm run build` first.");
  process.exit(1);
}
const html = readFileSync(indexPath, "utf8");
const attr = (tag, name) => tag.match(new RegExp(`${name}="([^"]+)"`))?.[1];
const tags = html.match(/<(script|link)\b[^>]*>/g) || [];
const scripts = new Set();
const styles = new Set();
for (const tag of tags) {
  if (tag.startsWith("<script") && /type="module"/.test(tag)) {
    const src = attr(tag, "src");
    if (src) scripts.add(src.replace(/^\//, ""));
  } else if (/rel="modulepreload"/.test(tag)) {
    scripts.add(attr(tag, "href").replace(/^\//, ""));
  } else if (/rel="stylesheet"/.test(tag)) {
    const href = attr(tag, "href");
    if (href?.startsWith("/assets/")) styles.add(href.replace(/^\//, ""));
  }
}

// Static imports only: `import(...)` is a split point and is not followed.
const STATIC_IMPORT =
  /(?:^|[;}\s])(?:import|export)\s*(?:[\w*{}\s,$]*?from\s*)?["'](\.{1,2}\/[^"']+\.js)["']/g;
const queue = [...scripts];
while (queue.length) {
  const file = queue.shift();
  const code = readFileSync(join(DIST, file), "utf8");
  for (const [, spec] of code.matchAll(STATIC_IMPORT)) {
    const dep = posix.normalize(posix.join(posix.dirname(file), spec));
    if (!scripts.has(dep)) {
      scripts.add(dep);
      queue.push(dep);
    }
  }
}

const size = (file) => {
  const body = readFileSync(join(DIST, file));
  return { file, raw: body.length, gzip: gzipSync(body).length, body };
};
const js = [...scripts].map(size).sort((a, b) => b.gzip - a.gzip);
const css = [...styles].map(size);
const kb = (n) => Math.round(n / 1024);
const total = (list, key) => list.reduce((sum, f) => sum + f[key], 0);
const jsGzip = kb(total(js, "gzip"));
const cssGzip = kb(total(css, "gzip"));

console.log("Welcome screen first load (gzip):");
for (const f of [...js, ...css])
  console.log(`  ${String(kb(f.gzip)).padStart(5)} KB  ${f.file}`);
console.log(
  `  JS ${jsGzip} KB gzip (${kb(total(js, "raw"))} KB raw, ${js.length} files), ` +
    `CSS ${cssGzip} KB gzip. Budget: JS ${BUDGET.jsGzipKb} KB, CSS ${BUDGET.cssGzipKb} KB.`,
);

const problems = [];
if (jsGzip > BUDGET.jsGzipKb)
  problems.push(
    `JS ${jsGzip} KB gzip is over the ${BUDGET.jsGzipKb} KB budget.`,
  );
if (cssGzip > BUDGET.cssGzipKb)
  problems.push(
    `CSS ${cssGzip} KB gzip is over the ${BUDGET.cssGzipKb} KB budget.`,
  );
for (const f of js) {
  const name = DEFERRED.find((p) => p.test(f.file));
  if (name) problems.push(`${f.file} must load after the name step (${name}).`);
  const text = f.body.toString("utf8");
  for (const c of DEFERRED_CODE)
    if (c.pattern.test(text))
      problems.push(
        `${c.name} is bundled into ${f.file}; load it with import().`,
      );
}
if (problems.length) {
  console.error("\nBundle budget failed:\n  " + problems.join("\n  "));
  console.error(
    "Move the new code behind a dynamic import (see src/lazy-panels.tsx), " +
      "or raise the budget on purpose in scripts/check-bundle-budget.mjs.",
  );
  process.exit(1);
}
console.log("Bundle budget OK.");
