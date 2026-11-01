import { PLZEN } from "./spatial/city-pack.mjs";
import {
  buildCityPlan,
  enqueueCityPlans,
  runWorldJobs,
  worldPreparationStatus,
} from "./world-planner.mjs";
import { openDatabase } from "./database.mjs";
if (process.argv.includes("--preview")) {
  const index = process.argv.indexOf("--preview"),
    day = process.argv[index + 1];
  if (!day) throw Error("Supply a local date: --preview YYYY-MM-DD");
  const plan = buildCityPlan(PLZEN, day);
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
          fieldReview: PLZEN.fieldReview,
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
          },
        })),
      },
      null,
      2,
    ),
  );
} else if (process.argv.includes("--once")) {
  const db = openDatabase();
  try {
    enqueueCityPlans(db);
    await runWorldJobs(db);
    console.log(JSON.stringify(worldPreparationStatus(db), null, 2));
  } finally {
    db.close();
  }
} else throw Error("Use --once, or --preview YYYY-MM-DD.");
