// Builds extra place badges from the global POI pipeline (docs/WORLDS-PLAN.md
// C.2.2 records, JSON array or JSON lines) for PLACE_BADGES_EXTRA_PATH.
// Only notable, safe POIs of badge-worthy categories become badges; the
// curated server/data/place-badges.json always wins on id or nearby duplicates.
//
//   node scripts/build-place-badges.mjs <pois.json|.jsonl> <out.json> [--min-notability 20]
import { readFileSync, writeFileSync } from "node:fs";
import { distance } from "../server/domain.mjs";
import { loadPlaceBadges } from "../server/badges/place-catalog.mjs";

// POI category (C.2.4) -> badge kind, base radius and rarity by notability.
export const CATEGORY_KINDS = {
  viewpoint: ["viewpoint", 100],
  observatory: ["viewpoint", 100],
  landmark_tower: ["viewpoint", 100],
  castle: ["landmark", 200],
  ruins: ["landmark", 150],
  monument: ["landmark", 100],
  memorial: ["landmark", 100],
  historic_building: ["landmark", 120],
  bridge: ["landmark", 120],
  peak: ["peak", 120],
};
const rarity = (n) => (n >= 120 ? "epic" : n >= 50 ? "rare" : "common");
const slug = (s) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40).replace(/-+$/g, "");

export function poiBadges(records, { minNotability = 20, curated = loadPlaceBadges().badges } = {}) {
  const out = [];
  const taken = new Set(curated.map((b) => b.id));
  const near = (p, list) => list.some((b) => distance(p, b) < Math.max(150, b.radiusM));
  for (const r of records) {
    const map = CATEGORY_KINDS[r.category];
    if (!map || r.safety !== "ok" || !(r.notability >= minNotability) || !r.name) continue;
    if (!(Math.abs(r.lat) <= 85 && Math.abs(r.lng) <= 180)) continue;
    const [kind, radiusM] = map;
    const point = { lat: r.lat, lng: r.lng };
    if (near(point, curated) || near(point, out)) continue;
    let id = `${kind === "viewpoint" ? "view" : kind}-${slug(r.name) || "place"}`;
    if (taken.has(id)) id = `${id}-${(r.h3r7 || r.id || "").replace(/[^a-z0-9]/gi, "").slice(-6).toLowerCase() || out.length}`;
    if (taken.has(id)) continue;
    taken.add(id);
    const names = r.names && typeof r.names === "object" ? r.names : {};
    out.push({ id, name: r.name, nameCs: names.cs || r.name, kind, lat: r.lat, lng: r.lng, radiusM, country: r.country || "", region: r.region || "", rarity: rarity(r.notability), source: r.id });
  }
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [input, output] = process.argv.slice(2);
  if (!input || !output) throw new Error("usage: build-place-badges.mjs <pois.json|.jsonl> <out.json> [--min-notability N]");
  const i = process.argv.indexOf("--min-notability");
  const text = readFileSync(input, "utf8").trim();
  const records = text.startsWith("[") ? JSON.parse(text) : text.split("\n").filter(Boolean).map((l) => JSON.parse(l));
  const badges = poiBadges(records, { minNotability: i > 0 ? Number(process.argv[i + 1]) : 20 });
  writeFileSync(output, JSON.stringify({ version: `poi-${new Date().toISOString().slice(0, 10)}`, badges }, null, 1) + "\n");
  console.log(JSON.stringify({ input: records.length, badges: badges.length, output }));
}
