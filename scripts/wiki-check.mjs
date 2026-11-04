// Keeps the /wiki know-how center in step with the mechanisms it explains
// (docs/WIKI.md).
//
//   npm run wiki:check   report what is stale or unclassified (exit 1 if any)
//   npm run wiki:stamp   after updating the wiki: record the current hashes
//
// Rules:
//   1. Every path in a chapter's `sources` exists.
//   2. Every docs/*.md is either a source of some chapter or listed in
//      docs/wiki-coverage.json `notMechanisms` (plans, audits, hand-offs).
//   3. Every docs/*.md source has a hash in docs/wiki-stamps.json equal to
//      the file today. A changed doc means the mechanism changed: update its
//      chapter in src/wiki/chapters.ts, then run `npm run wiki:stamp`.
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = resolve(import.meta.dirname, "..");
const STAMPS = join(ROOT, "docs", "wiki-stamps.json");
const COVERAGE = join(ROOT, "docs", "wiki-coverage.json");

export const hashFile = (path) =>
  createHash("sha256").update(readFileSync(path, "utf8").replace(/\r\n/g, "\n")).digest("hex").slice(0, 16);

export async function loadChapters() {
  const mod = await import(pathToFileURL(join(ROOT, "src", "wiki", "chapters.ts")).href);
  return mod.CHAPTERS;
}

const stamped = (path) => /^docs\/[^/]+\.md$/.test(path);

export async function wikiState() {
  const chapters = await loadChapters();
  const owners = new Map();
  for (const c of chapters)
    for (const s of c.sources) owners.set(s, [...(owners.get(s) ?? []), c.id]);
  const coverage = JSON.parse(readFileSync(COVERAGE, "utf8"));
  const excluded = new Set(Object.keys(coverage.notMechanisms));
  const stamps = existsSync(STAMPS) ? JSON.parse(readFileSync(STAMPS, "utf8")).docs : {};
  const docs = readdirSync(join(ROOT, "docs"))
    .filter((f) => f.endsWith(".md"))
    .map((f) => `docs/${f}`);

  const missing = [...owners.keys()].filter((p) => !existsSync(join(ROOT, p)));
  const unclassified = docs.filter((d) => !owners.has(d) && !excluded.has(d));
  const both = docs.filter((d) => owners.has(d) && excluded.has(d));
  const goneExcluded = [...excluded].filter((d) => !existsSync(join(ROOT, d)));
  const current = {};
  for (const p of [...owners.keys()].filter(stamped).sort()) if (existsSync(join(ROOT, p))) current[p] = hashFile(join(ROOT, p));
  const stale = Object.keys(current).filter((p) => stamps[p] !== current[p]);
  const extraStamps = Object.keys(stamps).filter((p) => !(p in current));
  return { chapters, owners, current, missing, unclassified, both, goneExcluded, stale, extraStamps };
}

export function problems(s) {
  const out = [];
  for (const p of s.missing) out.push(`${p} is listed in src/wiki/chapters.ts sources but does not exist.`);
  for (const d of s.unclassified)
    out.push(`${d} is new: add it to the sources of the wiki chapter it explains (src/wiki/chapters.ts), or to docs/wiki-coverage.json notMechanisms if it is a plan, audit or hand-off.`);
  for (const d of s.both) out.push(`${d} is both a chapter source and in notMechanisms; pick one.`);
  for (const d of s.goneExcluded) out.push(`${d} is in docs/wiki-coverage.json but no longer exists; remove it.`);
  for (const p of s.stale)
    out.push(`${p} changed since the wiki was last reviewed: update chapter "${s.owners.get(p).join(", ")}" in src/wiki/chapters.ts, then run npm run wiki:stamp.`);
  for (const p of s.extraStamps) out.push(`docs/wiki-stamps.json has ${p}, which no chapter lists; run npm run wiki:stamp.`);
  return out;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const s = await wikiState();
  if (process.argv.includes("--write")) {
    writeFileSync(STAMPS, JSON.stringify({ note: "Written by npm run wiki:stamp (docs/WIKI.md). Do not edit by hand.", docs: s.current }, null, 2) + "\n");
    const left = problems({ ...s, stale: [], extraStamps: [] });
    console.log(`Stamped ${Object.keys(s.current).length} wiki source docs.`);
    if (left.length) {
      console.error("\nStill to fix:\n  " + left.join("\n  "));
      process.exit(1);
    }
  } else {
    const p = problems(s);
    if (p.length) {
      console.error("Wiki check failed:\n  " + p.join("\n  "));
      process.exit(1);
    }
    console.log(`Wiki OK: ${s.chapters.length} chapters, ${Object.keys(s.current).length} stamped docs.`);
  }
}
