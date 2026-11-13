#!/usr/bin/env node
// Exit 0 when the POI release lacks a demo city the code lists (a worker run
// is needed), 1 when it is current. A city the last run skipped (source
// unreachable) does not count, so a dead source never restarts the worker on
// every deploy. Used by scripts/vps-activate-release.sh.
import { existsSync, readFileSync } from "node:fs";
import { parseDemoCities } from "./demo-cities.mjs";

export function staleDemoCities(manifest, lastRun, wanted) {
  const built = new Set(manifest?.demoCities || []),
    skipped = new Set((lastRun?.demoCities?.skipped || []).map((s) => s.id));
  return wanted.filter((c) => !built.has(c.cityId) && !skipped.has(c.id));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const dir = process.argv[2] || "/var/lib/questlayer-poi";
  const read = (f) => (existsSync(f) ? JSON.parse(readFileSync(f, "utf8")) : null);
  let wanted;
  try {
    wanted = parseDemoCities(process.env.WORLD_CITIES ?? "demo");
  } catch {
    process.exit(1);
  }
  const missing = staleDemoCities(
    read(`${dir}/current.manifest.json`),
    read(`${dir}/last-run.json`),
    wanted,
  );
  if (missing.length) console.log(`demo cities missing: ${missing.map((c) => c.cityId).join(",")}`);
  process.exit(missing.length ? 0 : 1);
}
