import { requireValue } from "./canonical.mjs";

export const ATLAS = Object.freeze({
  id: "system:atlas",
  name: "Atlas",
  kind: "system-author",
});

// Original instructions from supplied place names, not copied descriptions or
// invented local facts. This fallback needs no model, credentials or network.
export function atlasVisit({ name, sourceId }) {
  requireValue(
    typeof name === "string" && name.trim().length > 0 && name.length <= 200,
    "Atlas needs a sourced place name.",
  );
  requireValue(
    typeof sourceId === "string" && sourceId.length > 0,
    "Atlas needs a stable place reference.",
  );
  return {
    author: ATLAS,
    title: `Discover ${name.trim()}`,
    instructions: `Find the marked public spot near ${name.trim()} and confirm your visit. Stay on open public paths; skip this stop if access is blocked.`,
    sourceId,
    template: "atlas-place-visit/1",
  };
}
