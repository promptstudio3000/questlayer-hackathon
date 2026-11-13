// Automatic check of a sample of POI quest targets against today's
// OpenStreetMap (task W12 "field review", docs/WORLD-COVERAGE.md). Nobody walks
// the list by hand: each sampled place is looked up again through Overpass
// with the same taxonomy and safety filter as the import, and the report says
// whether it still exists, is still safe, kept its name and still has its
// check-in point on a public path.
import { classifyPois, osmToInputs } from "./index.mjs";
import { distance, hash } from "../domain.mjs";

/** A target that moved further than this is reported as moved. */
export const SAMPLE_MOVED_M = 30;

/**
 * Seeded sample of `size` quest-ready rows ({ id, h3r7, name, lat, lng }),
 * grouped by cell so one Overpass request answers a cell. Same file and seed,
 * same sample. Only OpenStreetMap ids can be checked live.
 */
export function pickSample(db, { size = 50, seed = "poi-sample" } = {}) {
  const rows = db
    .prepare("SELECT id,h3r7,name,path_ref FROM poi WHERE safety='ok' AND path_ref IS NOT NULL AND id LIKE 'osm:%'")
    .all();
  const scored = rows.map((r) => ({ r, k: hash(`${seed}|${r.id}`) })).sort((a, b) => (a.k < b.k ? -1 : a.k > b.k ? 1 : 0));
  const out = [];
  for (const { r } of scored) {
    if (out.length >= size) break;
    let t;
    try {
      t = JSON.parse(r.path_ref);
    } catch {
      continue;
    }
    if (!Number.isFinite(t?.lat) || !Number.isFinite(t?.lng)) continue;
    out.push({ id: String(r.id), h3r7: r.h3r7, name: r.name || null, lat: t.lat, lng: t.lng });
  }
  return out;
}

const norm = (s) => String(s || "").replace(/\s+/g, " ").trim().toLowerCase();

/**
 * Compare sampled rows of one cell with that cell's Overpass elements.
 * Returns [{ ...row, status, reasons?, movedM?, liveName? }] where status is
 * confirmed | renamed | moved | now-excluded | gone.
 */
export function compareCell(rows, elements) {
  const { records } = classifyPois(osmToInputs(elements || []));
  const live = new Map(records.map((r) => [r.id, r]));
  return rows.map((row) => {
    const r = live.get(row.id);
    if (!r) return { ...row, status: "gone" };
    if (r.safety !== "ok" || !r.target) return { ...row, status: "now-excluded", reasons: r.reasons || [] };
    const movedM = Math.round(distance(row, r.target));
    if (movedM > SAMPLE_MOVED_M) return { ...row, status: "moved", movedM };
    if (row.name && r.name && norm(row.name) !== norm(r.name)) return { ...row, status: "renamed", liveName: String(r.name) };
    return { ...row, status: "confirmed" };
  });
}

/** Summary counts and the share of sampled places that are still fine. */
export function summarize(results) {
  const byStatus = {};
  for (const r of results) byStatus[r.status] = (byStatus[r.status] || 0) + 1;
  const checked = results.filter((r) => r.status !== "unchecked").length;
  const fine = (byStatus.confirmed || 0) + (byStatus.renamed || 0);
  return { sampled: results.length, checked, byStatus, okShare: checked ? Math.round((fine / checked) * 1000) / 1000 : null };
}
