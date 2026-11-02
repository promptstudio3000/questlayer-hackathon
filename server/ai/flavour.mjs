// Quest flavour text for POI quests (W8, docs/QUEST-FLAVOUR.md).
//
// Every POI quest has a deterministic template title and description. The
// nightly batch (flavour-batch.mjs) may replace them with model-written text,
// cached by (poiId, template, layerId, lang, promptVersion). Player requests
// only ever read: flavourText() is a synchronous cache lookup with the template
// text as fallback, so no model call can sit on a request path.
//
// Flavour text is decoration. It never sets rewards, places, targets or rules,
// and the shared text policy rejects anything that mentions money or prizes.
import { ensureModuleVersion } from "../schema-compatibility.mjs";
import { FLAVOUR_SCHEMA } from "./schema.mjs";
import { clean, screenText } from "./text-policy.mjs";

export { FLAVOUR_SCHEMA };
export const FLAVOUR_PROMPT_VERSION = "flavour-v1";
export const FLAVOUR_TEMPLATES = Object.freeze(["poi-visit", "poi-category-hunt"]);
export const FLAVOUR_LANGS = Object.freeze(["en", "cs"]);
export const DEFAULT_FLAVOUR_LAYER = "aavegotchi";
export const FLAVOUR_LIMITS = Object.freeze({ title: [3, 60], description: [20, 220] });

// Every rule of the shared policy applies: flavour text is shown to all
// players without a human review.
export const FLAVOUR_RULES = Object.freeze([
  "reward-claim",
  "currency",
  "link-or-contact",
  "markup",
  "unsafe-instruction",
  "credential-request",
  "promise",
  "instruction-leak",
]);

// Category ids come from server/poi/taxonomy.mjs (stable, add-only).
// [English singular, Czech singular, Czech plural for the hunt].
export const CATEGORY_LABELS = Object.freeze({
  park: ["park", "park", "parky"],
  garden: ["garden", "zahrada", "zahrady"],
  plaza: ["square", "náměstí", "náměstí"],
  viewpoint: ["viewpoint", "vyhlídka", "vyhlídky"],
  fountain: ["fountain", "kašna", "kašny"],
  monument: ["monument", "pomník", "pomníky"],
  memorial: ["memorial", "památník", "památníky"],
  artwork: ["artwork", "umělecké dílo", "umělecká díla"],
  street_art: ["street art", "street art", "street art"],
  castle: ["castle", "hrad", "hrady"],
  ruins: ["ruins", "zřícenina", "zříceniny"],
  historic_building: ["historic building", "historická budova", "historické budovy"],
  museum: ["museum", "muzeum", "muzea"],
  library: ["library", "knihovna", "knihovny"],
  market: ["market", "tržiště", "tržiště"],
  bridge: ["bridge", "most", "mosty"],
  river_walk: ["riverside walk", "procházka u řeky", "procházky u řeky"],
  lake_walk: ["lakeside walk", "procházka u jezera", "procházky u vody"],
  trailhead: ["trailhead", "začátek stezky", "začátky stezek"],
  nature_reserve: ["nature reserve", "přírodní rezervace", "přírodní rezervace"],
  observatory: ["observatory", "hvězdárna", "hvězdárny"],
  landmark_tower: ["tower", "věž", "věže"],
  sculpture: ["sculpture", "socha", "sochy"],
  picnic_site: ["picnic spot", "místo na piknik", "místa na piknik"],
  information_board: ["information board", "informační tabule", "informační tabule"],
  music_venue: ["music venue", "hudební klub", "hudební kluby"],
  sports_ground: ["sports ground", "sportoviště", "sportoviště"],
  skate_park: ["skate park", "skatepark", "skateparky"],
  bench_with_view: ["bench with a view", "lavička s výhledem", "lavičky s výhledem"],
  other_named: ["landmark", "zajímavé místo", "zajímavá místa"],
});

const label = (category, lang, plural = false) => {
  const row = CATEGORY_LABELS[category] || CATEGORY_LABELS.other_named;
  return lang === "cs" ? row[plural ? 2 : 1] : plural ? `${row[0]}s` : row[0];
};

const parseJson = (value, fallback) => {
  if (value && typeof value === "object") return value;
  try {
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
};

/** Normalises a POI row (from the POI SQLite file or a fixture). */
export function flavourPoi(row) {
  return {
    id: String(row.id),
    h3r7: row.h3r7 || null,
    category: CATEGORY_LABELS[row.category] ? row.category : "other_named",
    name: row.name ? clean(row.name).slice(0, 80) : null,
    names: parseJson(row.names, {}),
    facts: parseJson(row.facts, null),
    notability: Number(row.notability) || 0,
  };
}

/** The name players see for a POI in one language, or null for unnamed ones. */
export function poiDisplayName(poi, lang) {
  const n = poi.names?.[lang] || poi.name || null;
  return n ? clean(n).slice(0, 60) : null;
}

const TEMPLATE_COPY = {
  "poi-visit": {
    en: (name, kind) => ({
      title: name ? `Visit ${name}` : `Find the ${kind}`,
      description: name
        ? `Walk to ${name} along the public path, take a look at this ${kind} and check in at the marker.`
        : `Walk to the ${kind} along the public path, take a look around and check in at the marker.`,
    }),
    cs: (name, kind) => ({
      title: name ? `Navštiv: ${name}` : `Najdi místo: ${kind}`,
      description: name
        ? `Dojdi po veřejné cestě k místu ${name} (${kind}), rozhlédni se a odbav se u značky.`
        : `Dojdi po veřejné cestě k místu (${kind}), rozhlédni se a odbav se u značky.`,
    }),
  },
  "poi-category-hunt": {
    en: (name, kind, kinds) => ({
      title: `Hunt for ${kinds}`,
      description: name
        ? `Today this area hides ${kinds}. Start at ${name} and check in at the marker by the path.`
        : `Today this area hides ${kinds}. Find one and check in at the marker by the path.`,
    }),
    cs: (name, kind, kinds) => ({
      title: `Lov: ${kinds}`,
      description: name
        ? `Dnes se tu skrývají ${kinds}. Začni u místa ${name} a odbav se u značky u cesty.`
        : `Dnes se tu skrývají ${kinds}. Najdi jedno z nich a odbav se u značky u cesty.`,
    }),
  },
};

/** Deterministic text: the fallback whenever no validated cached text exists. */
export function templateFlavour({ poi, template, lang }) {
  const p = poi.category ? poi : flavourPoi(poi);
  const copy = TEMPLATE_COPY[template]?.[lang === "cs" ? "cs" : "en"];
  if (!copy) throw Error(`Unknown flavour template ${template}.`);
  const out = copy(poiDisplayName(p, lang), label(p.category, lang), label(p.category, lang, true));
  return {
    title: out.title.slice(0, FLAVOUR_LIMITS.title[1]),
    description: out.description.slice(0, FLAVOUR_LIMITS.description[1]),
  };
}

const digitsIn = (s) => String(s || "").match(/\d+/g) || [];

/**
 * Checks one model-written text. Returns { value } or { reason }.
 * Numbers are allowed only when they occur in the POI's own name or facts,
 * so a model cannot invent dates, distances or amounts.
 */
export function validateFlavour(output, { poi, lang }) {
  if (!output || typeof output !== "object") return { reason: "schema" };
  if (typeof output.title !== "string" || typeof output.description !== "string")
    return { reason: "schema" };
  const title = clean(output.title);
  const description = clean(output.description);
  const [tMin, tMax] = FLAVOUR_LIMITS.title;
  const [dMin, dMax] = FLAVOUR_LIMITS.description;
  if (title.length < tMin || title.length > tMax) return { reason: "title-length" };
  if (description.length < dMin || description.length > dMax) return { reason: "description-length" };
  const both = `${title} ${description}`;
  const broken = screenText(both, FLAVOUR_RULES);
  if (broken) return { reason: broken };
  const known = new Set([
    ...digitsIn(poi.name),
    ...Object.values(poi.names || {}).flatMap(digitsIn),
    ...Object.values(poi.facts || {}).flatMap(digitsIn),
  ]);
  if (digitsIn(both).some((d) => !known.has(d))) return { reason: "invented-number" };
  // English text must not drift into Czech and vice versa (names excepted).
  const nameless = Object.values({ ...poi.names, n: poi.name || "" }).reduce(
    (s, n) => (n ? s.split(n).join(" ") : s),
    both,
  );
  if (lang === "en" && /[ěščřžůťďň]/iu.test(nameless)) return { reason: "wrong-language" };
  if (lang === "cs" && !/[áéíóúůýěščřžťďň]/iu.test(nameless)) return { reason: "wrong-language" };
  return { value: { title, description } };
}

const lookups = new WeakMap();
function statement(db) {
  let s = lookups.get(db);
  if (!s) {
    ensureModuleVersion(db, FLAVOUR_SCHEMA);
    s = db.prepare(
      "SELECT title,description FROM ai_flavour_cache WHERE poi_id=? AND template=? AND layer_id=? AND lang=? AND prompt_version=?",
    );
    lookups.set(db, s);
  }
  return s;
}

/**
 * Title and description for one POI quest: the validated cached text when the
 * nightly batch made one, else the deterministic template text. Synchronous,
 * read-only, no network: safe on the player request path (W6 calls this).
 */
export function flavourText(
  db,
  { poi, template, lang = "en", layerId = DEFAULT_FLAVOUR_LAYER, promptVersion = FLAVOUR_PROMPT_VERSION },
) {
  const p = poi.category ? poi : flavourPoi(poi);
  const language = FLAVOUR_LANGS.includes(lang) ? lang : "en";
  if (db) {
    const row = statement(db).get(p.id, template, layerId, language, promptVersion);
    if (row) return { title: row.title, description: row.description, source: "cache" };
  }
  return { ...templateFlavour({ poi: p, template, lang: language }), source: "template" };
}

/** Last batch summary for /api/health (no texts, no POI ids). */
export function flavourStatus(db) {
  ensureModuleVersion(db, FLAVOUR_SCHEMA);
  const last = db
    .prepare(
      "SELECT trigger,provider,model,outcome,reason,generated,rejected,requested,tokens_used,token_budget,started_at,finished_at FROM ai_flavour_batches ORDER BY started_at DESC LIMIT 1",
    )
    .get();
  const cached = db
    .prepare("SELECT count(*) AS n FROM ai_flavour_cache WHERE prompt_version=?")
    .get(FLAVOUR_PROMPT_VERSION).n;
  return { promptVersion: FLAVOUR_PROMPT_VERSION, cached, lastBatch: last || null };
}
