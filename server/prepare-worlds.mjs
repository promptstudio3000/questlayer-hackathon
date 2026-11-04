import { DEFAULT_CITY, LIVE_CITIES } from "./spatial/city-pack.mjs";
import {
  buildCityPlan,
  enqueueCityPlans,
  runWorldJobs,
  worldPreparationStatus,
} from "./world-planner.mjs";
import { openDatabase } from "./database.mjs";
import "./schema-catalog.mjs";
import { readFileSync, statSync } from "node:fs";
if (process.argv.includes("--preview")) {
  const index = process.argv.indexOf("--preview"),
    day = process.argv[index + 1];
  if (!day) throw Error("Supply a local date: --preview YYYY-MM-DD");
  const packIndex = process.argv.indexOf("--pack");
  let pack = DEFAULT_CITY;
  if (packIndex !== -1) {
    const file = process.argv[packIndex + 1];
    if (!file || statSync(file).size > 16 * 1024 * 1024)
      throw Error("Supply a bounded CityPack JSON file.");
    pack = JSON.parse(readFileSync(file, "utf8"));
  }
  const plan = buildCityPlan(pack, day);
  console.log(
    JSON.stringify(
      {
        type: "FeatureCollection",
        properties: {
          day,
          timezone: plan.timezone,
          sourceHash: plan.sourceHash,
          cityId: plan.cityId,
          coverage: plan.coverage,
          diagnostics: plan.diagnostics,
          financialAllocation: "none",
          fieldReview: pack.fieldReview,
        },
        features: plan.zones.map((z) => ({
          type: "Feature",
          geometry: z.geometry,
          properties: {
            name: z.name,
            slot: z.slot,
            sector: z.sector,
            sourceId: z.sourceId,
            shapeFamily: z.shapeFamily,
            tier: z.tier,
            opensAt: z.opensAt,
            closesAt: z.closesAt,
            targets: z.targets,
            ...(z.walking ? { walking: z.walking } : {}),
          },
        })),
      },
      null,
      2,
    ),
  );
} else if (process.argv.includes("--once")) {
  if (process.argv.includes("--pack"))
    throw Error(
      "Custom packs are preview-only; no city activation is implied.",
    );
  const db = openDatabase();
  try {
    enqueueCityPlans(db);
    await runWorldJobs(db);
    console.log(
      JSON.stringify(
        LIVE_CITIES.length === 1
          ? worldPreparationStatus(db, Date.now(), LIVE_CITIES[0])
          : LIVE_CITIES.map((city) =>
              worldPreparationStatus(db, Date.now(), city),
            ),
        null,
        2,
      ),
    );
  } finally {
    db.close();
  }
} else throw Error("Use --once, or --preview YYYY-MM-DD.");
