// Stand-in for W4 (server/poi/taxonomy.mjs + server/poi/safety.mjs, thread
// "Filter safe places for quests"). It implements the same interface with a
// deliberately conservative subset of docs/WORLDS-PLAN.md C.2.3/C.2.4, so a
// build made with it never marks more places "ok" than W4 would. Delete this
// file once W4 has landed; scripts/poi/lib/w4.mjs prefers the real modules.
export const TAXONOMY_VERSION = "stub-0";
export const SAFETY_VERSION = "stub-0";

export const CATEGORIES = Object.freeze([
  "park",
  "garden",
  "plaza",
  "viewpoint",
  "fountain",
  "monument",
  "memorial",
  "artwork",
  "street_art",
  "castle",
  "ruins",
  "historic_building",
  "museum",
  "library",
  "market",
  "bridge",
  "river_walk",
  "lake_walk",
  "trailhead",
  "nature_reserve",
  "observatory",
  "landmark_tower",
  "sculpture",
  "picnic_site",
  "information_board",
  "music_venue",
  "sports_ground",
  "skate_park",
  "bench_with_view",
  "other_named",
]);

const has = (tags, key, values) => values.includes(tags[key]);

// OSM tags -> category or null (not a quest place).
export function classifyOsm(tags = {}) {
  if (tags.tourism === "artwork") {
    if (has(tags, "artwork_type", ["mural", "graffiti"])) return "street_art";
    if (has(tags, "artwork_type", ["sculpture", "statue", "bust"]))
      return "sculpture";
    return "artwork";
  }
  if (
    tags.historic === "castle" ||
    tags.historic === "manor" ||
    tags.historic === "fort"
  )
    return "castle";
  if (tags.historic === "ruins" || tags.ruins === "yes") return "ruins";
  if (
    tags.historic === "memorial" ||
    tags.historic === "wayside_cross" ||
    tags.historic === "wayside_shrine"
  )
    return "memorial";
  if (tags.historic === "monument") return "monument";
  if (
    has(tags, "historic", [
      "building",
      "city_gate",
      "tower",
      "church",
      "archaeological_site",
      "boundary_stone",
    ])
  )
    return "historic_building";
  if (tags.tourism === "viewpoint") return "viewpoint";
  if (
    tags.amenity === "fountain" ||
    (tags.amenity === "drinking_water" && tags.name)
  )
    return "fountain";
  if (tags.tourism === "museum" || tags.tourism === "gallery") return "museum";
  if (tags.amenity === "library") return "library";
  if (tags.amenity === "marketplace") return "market";
  if (tags.man_made === "observatory" || tags.amenity === "planetarium")
    return "observatory";
  if (
    tags.man_made === "tower" &&
    has(tags, "tower:type", ["observation", "lookout"])
  )
    return "landmark_tower";
  if (tags.man_made === "bridge" && tags.name) return "bridge";
  if (
    tags.tourism === "picnic_site" ||
    (tags.leisure === "picnic_table" && tags.name)
  )
    return "picnic_site";
  if (
    tags.tourism === "information" &&
    has(tags, "information", ["board", "map"])
  )
    return "information_board";
  if (
    tags.amenity === "music_venue" ||
    tags.amenity === "theatre" ||
    tags.leisure === "bandstand"
  )
    return "music_venue";
  if (tags.highway === "trailhead") return "trailhead";
  if (
    tags.leisure === "nature_reserve" ||
    (tags.boundary === "protected_area" && tags.name)
  )
    return "nature_reserve";
  if (tags.leisure === "park") return "park";
  if (tags.leisure === "garden" && tags.access !== "private") return "garden";
  if (
    tags.place === "square" ||
    (tags.highway === "pedestrian" && tags.area === "yes" && tags.name)
  )
    return "plaza";
  if (tags.leisure === "pitch" && has(tags, "sport", ["skateboard"]))
    return "skate_park";
  if (tags.leisure === "skatepark") return "skate_park";
  if (
    (tags.leisure === "pitch" ||
      tags.leisure === "stadium" ||
      tags.leisure === "sports_centre") &&
    tags.name
  )
    return "sports_ground";
  if (tags.tourism === "attraction" && tags.name) return "other_named";
  return null;
}

const OVERTURE = new Map(
  Object.entries({
    park: "park",
    national_park: "nature_reserve",
    nature_reserve: "nature_reserve",
    dog_park: "park",
    botanical_garden: "garden",
    community_garden: "garden",
    public_plaza: "plaza",
    public_fountain: "fountain",
    monument: "monument",
    historic_site: "historic_building",
    historic_tower: "landmark_tower",
    castle: "castle",
    ruin: "ruins",
    street_art: "street_art",
    sculpture_statue: "sculpture",
    museum: "museum",
    history_museum: "museum",
    art_museum: "museum",
    science_museum: "museum",
    community_museum: "museum",
    art_gallery: "museum",
    library: "library",
    farmers_market: "market",
    public_market: "market",
    bridge: "bridge",
    hiking_trail: "trailhead",
    observatory: "observatory",
    music_venue: "music_venue",
    performing_arts_venue: "music_venue",
    skate_park: "skate_park",
  }),
);

// Overture taxonomy.primary (and basic_category) -> category or null.
export function classifyOverture({ category, basicCategory } = {}) {
  return OVERTURE.get(category) || OVERTURE.get(basicCategory) || null;
}

const REVIEW = new Set(["skate_park", "music_venue"]);
const PRIVATE_ACCESS = new Set(["no", "private", "customers", "permissive_no"]);

// poi: normalised record with `tags` (OSM tags, {} for other sources).
// context.nearestPath: {lat,lng,distanceM,wayId}|null within 40 m,
// context.exclusion: {kind,id}|null when the target lies inside an excluded area,
// context.closures: Set of closed POI ids (operator place-safety).
// Returns {safety: "ok"|"review"|"excluded", reason: string|null, target: {lat,lng}|null}.
export function assessPoi(poi, context = {}) {
  const tags = poi.tags || {};
  const target = context.nearestPath
    ? { lat: context.nearestPath.lat, lng: context.nearestPath.lng }
    : null;
  const out = (safety, reason) => ({
    safety,
    reason,
    target: safety === "excluded" ? null : target,
  });
  if (context.closures?.has?.(poi.id))
    return out("excluded", "operator_closure");
  if (
    Object.keys(tags).some(
      (k) => k.startsWith("disused") || k.startsWith("abandoned"),
    ) ||
    tags.ruins === "no"
  )
    return out("excluded", "disused");
  if (PRIVATE_ACCESS.has(tags.access)) return out("excluded", "private_access");
  if (!target) return out("excluded", "no_public_path");
  if (context.exclusion)
    return out("excluded", `inside_${context.exclusion.kind}`);
  if (REVIEW.has(poi.category) || tags.amenity === "place_of_worship")
    return out("review", "category_review");
  return out("ok", null);
}
