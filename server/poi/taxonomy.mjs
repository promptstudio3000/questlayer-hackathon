// QuestLayer POI taxonomy v1 (docs/WORLDS-PLAN.md C.2.4, docs/POI-SAFETY.md).
// Maps OpenStreetMap tags and Overture place categories to ~30 game categories.
// Pure and deterministic; the import pipeline (W3) and POI quests (W6) consume
// it, so category ids and rule ids are a stable interface: add, never rename.

export const POI_TAXONOMY_VERSION = "poi-taxonomy-v1";

/**
 * group: green | water | historic | culture | civic | outdoor | other
 * review: the category always needs a human look before quests use it
 * requiresName: an unnamed feature of this kind is not a recognisable target
 * exterior: quests may only target the outside (never ask players to enter)
 */
export const POI_CATEGORIES = Object.freeze(
  [
    ["park", "green"],
    ["garden", "green"],
    ["plaza", "civic", { requiresName: true }],
    ["viewpoint", "outdoor"],
    ["fountain", "civic"],
    ["monument", "historic"],
    ["memorial", "historic"],
    ["artwork", "culture"],
    ["street_art", "culture"],
    ["castle", "historic", { exterior: true }],
    ["ruins", "historic"],
    ["historic_building", "historic", { requiresName: true, exterior: true }],
    ["museum", "culture", { exterior: true }],
    ["library", "culture", { exterior: true }],
    ["market", "civic"],
    ["bridge", "civic"],
    ["river_walk", "water", { requiresName: true }],
    ["lake_walk", "water", { requiresName: true }],
    ["trailhead", "outdoor"],
    ["nature_reserve", "green", { requiresName: true }],
    ["observatory", "culture", { exterior: true }],
    ["landmark_tower", "historic", { exterior: true }],
    ["sculpture", "culture"],
    ["picnic_site", "outdoor"],
    ["information_board", "outdoor"],
    ["music_venue", "culture", { requiresName: true, exterior: true }],
    ["sports_ground", "outdoor", { requiresName: true }],
    ["skate_park", "outdoor", { review: true }],
    ["bench_with_view", "outdoor"],
    ["other_named", "other", { requiresName: true }],
  ].map(([id, group, flags = {}]) =>
    Object.freeze({
      id,
      group,
      review: !!flags.review,
      requiresName: !!flags.requiresName,
      exterior: !!flags.exterior,
    }),
  ),
);
export const POI_CATEGORY_IDS = Object.freeze(POI_CATEGORIES.map((c) => c.id));
const BY_ID = new Map(POI_CATEGORIES.map((c) => [c.id, c]));
export const poiCategory = (id) => BY_ID.get(id) || null;

const any =
  (...values) =>
  (v) =>
    values.includes(v);
const set = (v) => v !== undefined && v !== "" && v !== "no";
const FOOT_WAYS = any(
  "footway",
  "path",
  "pedestrian",
  "cycleway",
  "steps",
  "bridleway",
  "track",
  "living_street",
);

/**
 * Ordered OSM rules: the first match wins. `when` maps tag keys to a value or
 * a predicate. Rule ids are recorded on each POI so a reviewer can see why a
 * place got its category.
 */
export const OSM_CATEGORY_RULES = Object.freeze([
  // Specific before general.
  {
    id: "skate-park",
    category: "skate_park",
    when: {
      sport: (v) => /(^|;)skateboard(;|$)/.test(v || ""),
      leisure: any("pitch", "sports_centre", "skatepark"),
    },
  },
  {
    id: "skatepark-leisure",
    category: "skate_park",
    when: { leisure: any("skatepark") },
  },
  {
    id: "street-art",
    category: "street_art",
    when: {
      tourism: any("artwork"),
      artwork_type: any("mural", "graffiti", "street_art"),
    },
  },
  {
    id: "sculpture",
    category: "sculpture",
    when: {
      tourism: any("artwork"),
      artwork_type: any("sculpture", "statue", "bust", "relief", "stone"),
    },
  },
  {
    id: "statue-historic",
    category: "sculpture",
    when: { historic: any("statue") },
  },
  { id: "artwork", category: "artwork", when: { tourism: any("artwork") } },
  {
    id: "observation-tower",
    category: "landmark_tower",
    when: {
      man_made: any("tower"),
      "tower:type": any("observation", "bell_tower", "clock", "defensive"),
    },
  },
  {
    id: "historic-tower",
    category: "landmark_tower",
    when: { historic: any("tower") },
  },
  {
    id: "viewpoint",
    category: "viewpoint",
    when: { tourism: any("viewpoint") },
  },
  {
    id: "observatory",
    category: "observatory",
    when: { man_made: any("observatory") },
  },
  {
    id: "planetarium",
    category: "observatory",
    when: { amenity: any("planetarium") },
  },
  {
    id: "castle",
    category: "castle",
    when: { historic: any("castle", "fort", "manor", "palace") },
  },
  {
    id: "ruins",
    category: "ruins",
    when: { historic: any("ruins", "archaeological_site") },
  },
  { id: "monument", category: "monument", when: { historic: any("monument") } },
  { id: "memorial", category: "memorial", when: { historic: any("memorial") } },
  {
    id: "wayside",
    category: "memorial",
    when: { historic: any("wayside_cross", "wayside_shrine") },
  },
  { id: "fountain", category: "fountain", when: { amenity: any("fountain") } },
  {
    id: "museum",
    category: "museum",
    when: { tourism: any("museum", "gallery") },
  },
  { id: "library", category: "library", when: { amenity: any("library") } },
  {
    id: "music-venue",
    category: "music_venue",
    when: {
      amenity: any("music_venue", "concert_hall", "theatre", "arts_centre"),
    },
  },
  {
    id: "marketplace",
    category: "market",
    when: { amenity: any("marketplace") },
  },
  {
    id: "pedestrian-bridge",
    category: "bridge",
    when: { man_made: any("bridge"), highway: (v) => !v || FOOT_WAYS(v) },
  },
  {
    id: "bridge-way",
    category: "bridge",
    when: { bridge: set, highway: FOOT_WAYS, name: set },
  },
  { id: "square", category: "plaza", when: { place: any("square") } },
  {
    id: "pedestrian-area",
    category: "plaza",
    when: { highway: any("pedestrian"), area: any("yes") },
  },
  {
    id: "historic-building",
    category: "historic_building",
    when: {
      historic: any(
        "building",
        "city_gate",
        "citywalls",
        "church",
        "town_hall",
        "monastery",
      ),
    },
  },
  {
    id: "heritage-building",
    category: "historic_building",
    when: { building: set, heritage: set },
  },
  {
    id: "nature-reserve",
    category: "nature_reserve",
    when: { leisure: any("nature_reserve") },
  },
  {
    id: "protected-area",
    category: "nature_reserve",
    when: { boundary: any("protected_area", "national_park") },
  },
  { id: "park", category: "park", when: { leisure: any("park") } },
  { id: "garden", category: "garden", when: { leisure: any("garden") } },
  {
    id: "botanical-garden",
    category: "garden",
    when: { tourism: any("garden") },
  },
  {
    id: "picnic-site",
    category: "picnic_site",
    when: { tourism: any("picnic_site") },
  },
  {
    id: "trailhead",
    category: "trailhead",
    when: { highway: any("trailhead") },
  },
  {
    id: "guidepost",
    category: "trailhead",
    when: {
      tourism: any("information"),
      information: any("guidepost", "route_marker"),
    },
  },
  {
    id: "information-board",
    category: "information_board",
    when: { tourism: any("information"), information: any("board", "map") },
  },
  {
    id: "river",
    category: "river_walk",
    when: { waterway: any("river", "canal") },
  },
  {
    id: "river-area",
    category: "river_walk",
    when: { natural: any("water"), water: any("river", "canal", "oxbow") },
  },
  {
    id: "lake",
    category: "lake_walk",
    when: {
      natural: any("water"),
      water: any("lake", "pond", "reservoir", "lagoon"),
    },
  },
  {
    id: "sports-ground",
    category: "sports_ground",
    when: { leisure: any("pitch", "sports_centre", "stadium", "track") },
  },
  {
    id: "bench-view",
    category: "bench_with_view",
    when: { amenity: any("bench"), view: set },
  },
  {
    id: "bench-viewpoint",
    category: "bench_with_view",
    when: { amenity: any("bench"), viewpoint: any("yes") },
  },
  {
    id: "attraction",
    category: "other_named",
    when: { tourism: any("attraction"), name: set },
  },
  {
    id: "historic-other",
    category: "other_named",
    when: { historic: set, name: set },
  },
]);

function matches(when, tags) {
  for (const [k, test] of Object.entries(when)) {
    const v = tags[k];
    if (typeof test === "function") {
      if (!test(v)) return false;
    } else if (v !== test) return false;
  }
  return true;
}

/** Category for OSM tags, or null when the feature is not a game place. */
export function categorizeOsm(tags = {}) {
  for (const rule of OSM_CATEGORY_RULES)
    if (matches(rule.when, tags))
      return { category: rule.category, rule: `osm:${rule.id}` };
  return null;
}

/**
 * Overture places categories (primary + alternates) to game categories.
 * Overture renames categories between releases; W3 prints unmatched primary
 * categories per release so this table can be extended.
 */
export const OVERTURE_CATEGORY_MAP = Object.freeze({
  park: "park",
  state_park: "park",
  national_park: "nature_reserve",
  dog_park: "park",
  botanical_garden: "garden",
  garden: "garden",
  community_gardens: "garden",
  public_plaza: "plaza",
  plaza: "plaza",
  town_square: "plaza",
  scenic_viewpoint: "viewpoint",
  lookout: "viewpoint",
  fountain: "fountain",
  monument: "monument",
  memorial_site: "memorial",
  public_art: "artwork",
  art_installation: "artwork",
  street_art: "street_art",
  mural: "street_art",
  castle: "castle",
  palace: "castle",
  fort: "castle",
  ruins: "ruins",
  archaeological_site: "ruins",
  landmark_and_historical_building: "historic_building",
  historical_landmark: "historic_building",
  museum: "museum",
  art_museum: "museum",
  history_museum: "museum",
  science_museum: "museum",
  art_gallery: "museum",
  library: "library",
  public_market: "market",
  farmers_market: "market",
  bridge: "bridge",
  river: "river_walk",
  lake: "lake_walk",
  hiking_trail: "trailhead",
  trail: "trailhead",
  nature_reserve: "nature_reserve",
  observatory: "observatory",
  planetarium: "observatory",
  observation_tower: "landmark_tower",
  tower: "landmark_tower",
  sculpture_statue: "sculpture",
  statue: "sculpture",
  picnic_area: "picnic_site",
  music_venue: "music_venue",
  concert_hall: "music_venue",
  theatre: "music_venue",
  stadium_arena: "sports_ground",
  sports_field: "sports_ground",
  skate_park: "skate_park",
  tourist_attraction: "other_named",
  attraction: "other_named",
});

export function categorizeOverture(categories = {}) {
  const list = [categories.primary, ...(categories.alternate || [])].filter(
    (c) => typeof c === "string",
  );
  for (const c of list)
    if (OVERTURE_CATEGORY_MAP[c])
      return { category: OVERTURE_CATEGORY_MAP[c], rule: `overture:${c}` };
  return null;
}
