// Loads the W4 taxonomy and safety modules when they exist, otherwise the
// stub with the same interface (scripts/poi/lib/w4-stub.mjs).
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const SERVER_POI = new URL("../../../server/poi/", import.meta.url);

export async function loadW4() {
  const stub = await import("./w4-stub.mjs");
  const taxonomyUrl = new URL("taxonomy.mjs", SERVER_POI),
    safetyUrl = new URL("safety.mjs", SERVER_POI);
  const taxonomy = existsSync(fileURLToPath(taxonomyUrl))
    ? await import(taxonomyUrl.href)
    : null;
  const safety = existsSync(fileURLToPath(safetyUrl))
    ? await import(safetyUrl.href)
    : null;
  const pick = (mod, name) =>
    typeof mod?.[name] === "function" ? mod[name] : null;
  const classifyOsm = pick(taxonomy, "classifyOsm"),
    classifyOverture = pick(taxonomy, "classifyOverture"),
    assessPoi = pick(safety, "assessPoi");
  const real = Boolean(classifyOsm && classifyOverture && assessPoi);
  return {
    source: real ? "w4" : "stub",
    classifyOsm: real ? classifyOsm : stub.classifyOsm,
    classifyOverture: real ? classifyOverture : stub.classifyOverture,
    assessPoi: real ? assessPoi : stub.assessPoi,
    taxonomyVersion: real
      ? String(taxonomy.TAXONOMY_VERSION || "w4")
      : stub.TAXONOMY_VERSION,
    safetyVersion: real
      ? String(safety.SAFETY_VERSION || "w4")
      : stub.SAFETY_VERSION,
  };
}

// The stub alone, for fixture tests that pin the stub's reason codes.
export async function stubW4() {
  const stub = await import("./w4-stub.mjs");
  return {
    source: "stub",
    classifyOsm: stub.classifyOsm,
    classifyOverture: stub.classifyOverture,
    assessPoi: stub.assessPoi,
    taxonomyVersion: stub.TAXONOMY_VERSION,
    safetyVersion: stub.SAFETY_VERSION,
  };
}
