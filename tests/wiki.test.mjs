// The /wiki know-how center must stay in step with the mechanisms it explains
// (docs/WIKI.md). When this fails after a docs change: update the chapter in
// src/wiki/chapters.ts, then run `npm run wiki:stamp`.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import levelTable from "../server/data/level-table.json" with { type: "json" };
import stakerGates from "../server/data/staker-gates.json" with { type: "json" };
import auraCatalog from "../server/data/aura-catalog.json" with { type: "json" };
import { problems, wikiState } from "../scripts/wiki-check.mjs";
import { CHAPTERS, EDITIONS, GROUPS, LEVELS, STAKER_GATES } from "../src/wiki/chapters.ts";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

test("wiki sources exist, docs are classified and the wiki was reviewed after every doc change", async () => {
  const found = problems(await wikiState());
  assert.deepEqual(found, [], "\n" + found.join("\n"));
});

test("chapters have unique ids, a known group, a status, a date and sources", () => {
  const ids = CHAPTERS.map((c) => c.id);
  assert.equal(new Set(ids).size, ids.length);
  const groups = new Set(GROUPS.map((g) => g.id));
  for (const c of CHAPTERS) {
    assert.ok(groups.has(c.group), `${c.id} group`);
    assert.match(c.updated, /^\d{4}-\d{2}-\d{2}$/, `${c.id} updated`);
    assert.ok(c.sources.length > 0, `${c.id} sources`);
    assert.ok(c.blocks.length > 0, `${c.id} blocks`);
  }
});

test("every picture a chapter names exists", () => {
  const diagrams = read("src/wiki/diagrams.tsx");
  for (const c of CHAPTERS)
    for (const b of c.blocks) if ("viz" in b) assert.match(diagrams, new RegExp(`"?${b.viz}"?: `), `${c.id} → ${b.viz}`);
});

test("numbers come from the rules files", () => {
  assert.equal(LEVELS.length, levelTable.levels.length);
  for (const l of LEVELS) assert.equal(l.xp, 100 * (l.level - 1) ** 2);
  assert.equal(STAKER_GATES.length, Object.keys(stakerGates.gates).length);
  assert.equal(EDITIONS.length, auraCatalog.editions.length);
});

test("the page names no events and leaks no secrets", () => {
  const texts = ["src/wiki/chapters.ts", "src/wiki/diagrams.tsx", "src/wiki/WikiPage.tsx"].map(read);
  for (const t of texts) {
    assert.doesNotMatch(t, /hackathon|judge|demo day|presentation|pitch/i);
    assert.doesNotMatch(t, /ed25519:[1-9A-HJ-NP-Za-km-z]{40,}|secret_key|private_key|\.pem\b|runtime\.env|\.data\//);
  }
});

test("/wiki is a lazy route", () => {
  const main = read("src/main.tsx");
  assert.match(main, /lazy\(\(\) => import\("\.\/wiki\/WikiPage"\)\)/);
  assert.match(read("scripts/check-bundle-budget.mjs"), /\/WikiPage\//);
});
