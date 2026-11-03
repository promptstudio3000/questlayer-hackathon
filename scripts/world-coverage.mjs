#!/usr/bin/env node
// Global coverage QA report (W12, docs/WORLD-COVERAGE.md).
//
//   npm run world:coverage -- [--poi <current.sqlite>] [--cities 20] [--days 30]
//                             [--sample 50] [--seed <text>] [--out <dir>] [--fixture]
//
// --poi defaults to POI_DB_PATH or /var/lib/questlayer-poi/current.sqlite.
// --fixture builds the small Czechia fixture (tests/fixtures/world-coverage)
// and reports on it, so the report runs anywhere without the VPS file.
// Writes report.json, report.md and map.html into
// <out>/<poi version>/ (default output/qa/worlds-coverage/).
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { cellToBoundary } from "h3-js";
import {
  cellCapacities,
  coverageReport,
  openPoiDb,
  poiFiles,
} from "../server/poi/coverage.mjs";

const ROOT = resolve(import.meta.dirname, "..");
const PLACES = [
  { name: "Brno, náměstí Svobody", lat: 49.19522, lng: 16.60796 },
  { name: "Holašovice (village)", lat: 48.96965, lng: 14.2736 },
  { name: "Plzeň, náměstí Republiky", lat: 49.74747, lng: 13.37759 },
  { name: "Praha, Staroměstské náměstí", lat: 50.08746, lng: 14.42125 },
  { name: "Šumava forest (no places expected)", lat: 48.985, lng: 13.6 },
];

function args(argv) {
  const out = new Map();
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const [k, v] = a.slice(2).split("=");
    if (v !== undefined) out.set(k, v);
    else if (argv[i + 1] && !argv[i + 1].startsWith("--"))
      out.set(k, argv[++i]);
    else out.set(k, "1");
  }
  return out;
}

const esc = (s) =>
  String(s ?? "").replace(
    /[&<>"]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c],
  );

export function markdown(r) {
  const pct = (v) =>
    v === null || v === undefined ? "n/a" : `${Math.round(v * 1000) / 10} %`;
  const lines = [
    `# World coverage: ${r.poi.version}`,
    "",
    `POI schema ${r.poi.schema}, taxonomy ${r.poi.taxonomyVersion}, safety ${r.poi.safetyVersion}. ` +
      `Rules: ≤${r.rules.maxPerCell} POI quests per H3 res-7 cell per day, ≥${r.rules.minSpacingM} m apart, ≤${r.rules.maxTrails} trails.`,
    "",
    "## Totals",
    "",
    "| | |",
    "| --- | --- |",
    `| Places in the file | ${r.poi.pois} (ok ${r.poi.bySafety.ok || 0}, review ${r.poi.bySafety.review || 0}, excluded ${r.poi.bySafety.excluded || 0}) |`,
    `| Excluded share | ${pct(r.poi.excludedShare)} |`,
    `| Cells with places / with ≥1 POI quest | ${r.cells.withPois} / ${r.cells.withQuests} |`,
    `| Country cells (area / 5.161 km²) | ${r.cells.countryCells ?? "n/a"} |`,
    `| Country share with ≥1 POI quest | ${pct(r.cells.countryShare)} |`,
    `| POI quests per day, whole region | ${r.cells.dailyQuestCapacity} |`,
    `| Random spots with a quest in their cell | ${pct(r.randomSpots.withQuestInCell)} |`,
    `| Random spots with a quest within 1 km / 3 km | ${pct(r.randomSpots.questWithin1km)} / ${pct(r.randomSpots.questWithin3km)} |`,
    `| Top cities with all six sectors | ${r.cities.allSixSectors} of ${r.cities.checked} |`,
    "",
    "## Quests per cell (cells with places)",
    "",
    "| Quests | Cells |",
    "| --- | --- |",
    ...Object.entries(r.cells.questsPerCell).map(([k, v]) => `| ${k} | ${v} |`),
    "",
    "## Excluded places by reason",
    "",
    "| Reason | Places |",
    "| --- | --- |",
    ...Object.entries(r.poi.byReason).map(([k, v]) => `| ${k} | ${v} |`),
    "",
    "## Checked places",
    "",
    "| Place | Cell | Quests in cell | Nearest quest |",
    "| --- | --- | --- | --- |",
    ...r.places.map(
      (p) =>
        `| [${p.name}](${p.mapLink}) | ${p.cell} | ${p.questsInCell} | ${p.nearestQuestM === null ? "none within ~6 km" : `${p.nearestQuestM} m`} |`,
    ),
    "",
    "## Cities (six 60° sectors within 3 km)",
    "",
    "| City | Population | Quest-ready ≤3 km | Quests/day | Empty sectors |",
    "| --- | --- | --- | --- | --- |",
    ...r.cities.list.map(
      (c) =>
        `| [${c.name}](${c.mapLink}) | ${c.population} | ${c.questReadyWithin3km} | ${c.dailyQuestCapacity} | ${c.emptySectors.join(", ") || "none"} |`,
    ),
    "",
    `## Rotation over ${r.rotation.days} days (${r.rotation.cells} cells: top cities and random spots)`,
    "",
    `Quests ${r.rotation.quests}, reuses within 72 h ${r.rotation.reusesWithin72h}, short days ${r.rotation.shortDays}, ` +
      `distinct POIs per cell min ${r.rotation.distinctPerCell.min} / median ${r.rotation.distinctPerCell.median} / max ${r.rotation.distinctPerCell.max}.`,
    "",
    `## Sample of ${r.questSample.length} POI quests for manual review`,
    "",
    "| # | Place | Category | Map | Source |",
    "| --- | --- | --- | --- | --- |",
    ...r.questSample.map(
      (q, i) =>
        `| ${i + 1} | ${esc(q.name || "(unnamed)")} | ${q.category} | [map](${q.mapLink}) | ${q.sourceLink ? `[osm](${q.sourceLink})` : q.id} |`,
    ),
    "",
    `## Random spots (${r.randomSpots.count})`,
    "",
    "| Spot | Quests in cell | Nearest quest |",
    "| --- | --- | --- |",
    ...r.randomSpots.spots.map(
      (s) =>
        `| [${s.lat}, ${s.lng}](${s.mapLink}) | ${s.questsInCell} | ${s.nearestQuestM === null ? "none within ~6 km" : `${s.nearestQuestM} m`} |`,
    ),
    "",
  ];
  return lines.join("\n");
}

const COLORS = [
  "#d9d4c7",
  "#c6e2b8",
  "#9fd08c",
  "#6fb85f",
  "#3f9a46",
  "#1f7a3a",
  "#0d5b2c",
];

/** Self-contained SVG map: cells coloured by quest capacity. */
export function mapHtml(r, cells) {
  const all = [...cells.entries()];
  const pts = all.flatMap(([cell]) => cellToBoundary(cell));
  const extra = [...r.randomSpots.spots, ...r.places, ...r.cities.list].map(
    (p) => [p.lat, p.lng],
  );
  const lats = [...pts, ...extra].map((p) => p[0]),
    lngs = [...pts, ...extra].map((p) => p[1]);
  const [s, n, w, e] = [
    Math.min(...lats),
    Math.max(...lats),
    Math.min(...lngs),
    Math.max(...lngs),
  ];
  const pad = 0.02;
  const k = Math.cos((((s + n) / 2) * Math.PI) / 180);
  const W = 1200,
    span = Math.max((e - w + 2 * pad) * k, 1e-6),
    H = Math.round((W * (n - s + 2 * pad)) / span);
  const x = (lng) => (((lng - w + pad) * k) / span) * W,
    y = (lat) => ((n + pad - lat) / (n - s + 2 * pad)) * H;
  const f = (v) => v.toFixed(1);
  const hexes = all
    .map(([cell, cap]) => {
      const d = cellToBoundary(cell)
        .map(([la, ln], i) => `${i ? "L" : "M"}${f(x(ln))} ${f(y(la))}`)
        .join("");
      return `<path d="${d}Z" fill="${COLORS[Math.min(cap, 6)]}"><title>${cell}: ${cap} quests/day</title></path>`;
    })
    .join("");
  const dots = r.randomSpots.spots
    .map(
      (p) =>
        `<circle cx="${f(x(p.lng))}" cy="${f(y(p.lat))}" r="4" class="${p.questsInCell ? "hit" : "miss"}"><title>random spot: ${p.questsInCell} in cell, nearest ${p.nearestQuestM ?? "none"} m</title></circle>`,
    )
    .join("");
  const labels = [...r.cities.list, ...r.places]
    .map(
      (c) =>
        `<g><circle cx="${f(x(c.lng))}" cy="${f(y(c.lat))}" r="3" class="city"/><text x="${f(x(c.lng) + 6)}" y="${f(y(c.lat) + 4)}">${esc(c.name)}</text></g>`,
    )
    .join("");
  const legend = COLORS.map(
    (c, i) =>
      `<span><i style="background:${c}"></i>${i}${i === 6 ? " (max)" : ""}</span>`,
  ).join("");
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>World coverage map</title>
<style>
:root{--bg:#f7f5ef;--fg:#1d1d1b;--muted:#6b675e}
@media (prefers-color-scheme:dark){:root{--bg:#161614;--fg:#eceae4;--muted:#a19c90}}
body{margin:0;padding:16px;background:var(--bg);color:var(--fg);font:14px/1.45 system-ui,sans-serif}
h1{font-size:20px;margin:0 0 4px}p{margin:0 0 12px;color:var(--muted)}
svg{width:100%;height:auto;max-width:${W}px;display:block}
text{font-size:11px;fill:var(--fg);paint-order:stroke;stroke:var(--bg);stroke-width:3px}
.hit{fill:#2563eb;stroke:#fff}.miss{fill:#dc2626;stroke:#fff}.city{fill:var(--fg)}
.legend{display:flex;flex-wrap:wrap;gap:10px;margin:8px 0}.legend i{display:inline-block;width:12px;height:12px;margin-right:4px;vertical-align:-2px;border-radius:2px}
</style></head><body>
<h1>World coverage: ${esc(r.poi.version)}</h1>
<p>${r.cells.withQuests} cells with ≥1 POI quest of ${r.cells.countryCells ?? "?"} country cells; ${r.cells.dailyQuestCapacity} POI quests per day. Blue dots: random spots with a quest in their cell; red: without.</p>
<div class="legend">${legend}</div>
<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Map of POI quest capacity per H3 cell">${hexes}${dots}${labels}</svg>
<p>Places © OpenStreetMap contributors (ODbL), Overture Maps Foundation (CDLA-Permissive-2.0), Wikidata (CC0), GeoNames (CC BY 4.0).</p>
</body></html>
`;
}

export async function run(argv = process.argv.slice(2), log = console.log) {
  const a = args(argv);
  let dbPath = a.get("poi") || poiFiles().db;
  if (a.has("fixture")) {
    const { buildCzechiaFixture } =
      await import("../tests/fixtures/world-coverage/czechia.mjs");
    dbPath = (
      await buildCzechiaFixture(
        mkdtempSync(join(tmpdir(), "coverage-fixture-")),
      )
    ).dbPath;
  }
  const db = openPoiDb(dbPath);
  try {
    const report = coverageReport(db, {
      cities: Number(a.get("cities") || 20),
      days: Number(a.get("days") || 30),
      sample: Number(a.get("sample") || 50),
      seed: a.get("seed") || undefined,
      spotsList: PLACES,
    });
    const caps = new Map(
      [...cellCapacities(db)].map(([c, l]) => [c, l.length]),
    );
    for (const row of db.prepare("SELECT DISTINCT h3r7 FROM poi").all())
      if (!caps.has(row.h3r7)) caps.set(row.h3r7, 0);
    const out = resolve(
      a.get("out") || join(ROOT, "output/qa/worlds-coverage"),
      String(report.poi.version || "unknown").replace(/[^\w.-]/g, "_"),
    );
    mkdirSync(out, { recursive: true });
    writeFileSync(
      join(out, "report.json"),
      JSON.stringify(report, null, 2) + "\n",
    );
    writeFileSync(join(out, "report.md"), markdown(report));
    writeFileSync(join(out, "map.html"), mapHtml(report, caps));
    log(
      JSON.stringify({
        out,
        version: report.poi.version,
        cellsWithQuests: report.cells.withQuests,
        countryShare: report.cells.countryShare,
        dailyQuestCapacity: report.cells.dailyQuestCapacity,
        randomSpotsWithQuest: report.randomSpots.withQuestInCell,
        citiesAllSixSectors: `${report.cities.allSixSectors}/${report.cities.checked}`,
      }),
    );
    return { out, report };
  } finally {
    db.close();
  }
}

if (import.meta.url === `file://${process.argv[1]}`)
  run().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
