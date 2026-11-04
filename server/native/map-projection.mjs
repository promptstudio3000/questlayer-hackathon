import { hash } from "../domain.mjs";
// Display geometry is accepted only from the immutable blueprint that published
// these exact checkpoints/windows. It never changes a native manifest or right.
// v1 publishes the zone's stops exactly; v2 publishes a template's subset of
// them (a return trail repeats its first stop), never a new coordinate.
function targetsFromZone(manifest, q, z) {
  if (manifest.version !== 2)
    return JSON.stringify(q.targets) === JSON.stringify(z.targets);
  const known = new Set(z.targets.map((p) => `${p.lat},${p.lng}`));
  return (
    Array.isArray(q.targets) &&
    q.targets.length > 0 &&
    q.targets.every((p) => known.has(`${p.lat},${p.lng}`))
  );
}
export function nativeMapProjection(db, manifest) {
  const unavailable = {
    status: "unavailable",
    zones: [],
    reason: "The published walk geometry could not be verified.",
  };
  if (!manifest) return unavailable;
  try {
    const row = db
      .prepare(
        "SELECT body,body_hash FROM world_blueprints WHERE city_id=? AND day=? AND source_hash=?",
      )
      .get(manifest.cityId, manifest.day, manifest.sourceHash);
    if (!row || hash(row.body) !== row.body_hash) return unavailable;
    const plan = JSON.parse(row.body);
    if (
      plan.day !== manifest.day ||
      plan.sourceHash !== manifest.sourceHash ||
      plan.zones.length !== manifest.quests.length
    )
      return unavailable;
    const zones = manifest.quests.map((q, i) => {
      const z = plan.zones[i];
      if (
        q.index !== i ||
        q.name !== z.name ||
        q.tier !== z.tier ||
        q.opensAt !== z.opensAt ||
        q.closesAt !== z.closesAt ||
        !targetsFromZone(manifest, q, z) ||
        z.geometry?.type !== "Polygon"
      )
        throw Error("Published geometry mismatch");
      return {
        id: `${manifest.id}:zone:${q.index}`,
        questIndex: q.index,
        name: z.name,
        tier: z.tier,
        lat: z.lat,
        lng: z.lng,
        radius: 0, // The verified polygon is authoritative; no circular fallback.
        geometry: z.geometry,
        sector: z.sector,
        kind: z.kind || "garden",
        color: z.tier === 3 ? "#c29222" : z.tier === 2 ? "#672eeb" : "#258b73",
        opensAt: z.opensAt,
        closesAt: z.closesAt,
      };
    });
    return { status: "verified", zones };
  } catch {
    return unavailable;
  }
}
