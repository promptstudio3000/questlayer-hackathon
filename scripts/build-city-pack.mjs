// Build a reviewable CityPack from downloaded Overpass fixtures, then preview it.
// Usage:
//   node scripts/build-city-pack.mjs --id brno --name Brno --version 2026-11-02.1 \
//     --timezone Europe/Prague --center 49.1951,16.6068 --coverage west,south,east,north
//   node scripts/build-city-pack.mjs --synthetic   (dry run with the test fixture)
// Writes .data/city-packs/<id>-<version>.json and a report; it never activates a city.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { buildCityPack } from "../server/spatial/city-pack-builder.mjs";
import { buildCityPlan } from "../server/world-planner.mjs";
const arg = (name) => {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? "" : process.argv[i + 1] || "";
};
let input;
if (process.argv.includes("--synthetic")) {
  const f = await import("../tests/fixtures/synthetic-city.mjs");
  input = {
    id: "dryrun",
    name: "Dry run city",
    version: "2026-11-01.1",
    timezone: "Europe/Prague",
    center: f.SYNTHETIC_CENTER,
    coverage: f.SYNTHETIC_COVERAGE,
    importedAt: "2026-11-01T00:00:00.000Z",
    ...f.syntheticOverpass(),
  };
} else {
  const id = arg("id"),
    [lat, lng] = arg("center").split(",").map(Number);
  input = {
    id,
    name: arg("name"),
    version: arg("version"),
    timezone: arg("timezone"),
    center: { lat, lng },
    coverage: arg("coverage").split(",").map(Number),
    parks: JSON.parse(readFileSync(`.data/imports/${id}-parks.json`, "utf8")),
    paths: JSON.parse(readFileSync(`.data/imports/${id}-paths.json`, "utf8")),
  };
}
const { pack, report } = buildCityPack(input);
const day = arg("day") || new Date().toISOString().slice(0, 10),
  plan = buildCityPlan(pack, day);
mkdirSync(".data/city-packs", { recursive: true });
const file = `.data/city-packs/${pack.id}-${pack.version}.json`;
writeFileSync(file, JSON.stringify(pack));
console.log(
  JSON.stringify(
    {
      file,
      ...report,
      preview: {
        day,
        zones: plan.zones.map((z) => ({
          sector: z.sector,
          name: z.name,
          tier: z.tier,
          shape: z.shapeFamily,
        })),
        rejected: plan.diagnostics?.rejected || [],
      },
    },
    null,
    2,
  ),
);
