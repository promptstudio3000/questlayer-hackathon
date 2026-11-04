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
import { FLAVOUR_REJECTIONS_SCHEMA, FLAVOUR_SCHEMA } from "./schema.mjs";
import { clean, screenText } from "./text-policy.mjs";

export { FLAVOUR_REJECTIONS_SCHEMA, FLAVOUR_SCHEMA };
export const FLAVOUR_PROMPT_VERSION = "flavour-v1";
export const FLAVOUR_TEMPLATES = Object.freeze(["poi-visit", "poi-category-hunt"]);
export const FLAVOUR_LANGS = Object.freeze(["en", "cs"]);
export const DEFAULT_FLAVOUR_LAYER = "aavegotchi";
// Titles may carry a full place name (names are cut at 60 characters), so the
// title limit leaves room for a short verb in front of it.
export const FLAVOUR_LIMITS = Object.freeze({ title: [3, 80], description: [20, 220] });

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
const WORD = /[\p{L}\p{M}]+(?:['’][\p{L}]+)?/gu;

// Every name of the place, longest first, for removing from the checked text.
const allNames = (poi) =>
  [...new Set([poi.name, ...Object.values(poi.names || {})].filter((n) => typeof n === "string" && n.trim()))]
    .map((n) => clean(n))
    .sort((a, b) => b.length - a.length);

/**
 * The text with the place's own names taken out, including Czech declined
 * forms ("Kašna Parnas" also removes "Kašnu", "Kašně"). Place names are data
 * the safety filter (W4) already accepted and players see them in the template
 * text anyway, so the word rules must not reject a text for repeating them:
 * "Plavecký stadion" or "Vyhlídka Skok" are names, not advice to swim or jump.
 */
export function withoutNames(text, poi) {
  let out = String(text);
  for (const name of allNames(poi)) out = out.split(name).join(" ");
  const stems = new Set();
  const exact = new Set();
  for (const name of allNames(poi))
    for (const w of name.match(WORD) || []) {
      const lower = w.toLowerCase();
      if (w.length >= 4) exact.add(lower);
      // Declined forms of longer words: "Plaveckého" for "Plavecký".
      if (w.length >= 6) stems.add(lower.slice(0, Math.max(5, w.length - 3)));
    }
  if (!exact.size) return out;
  return out.replace(WORD, (w) => {
    const lower = w.toLowerCase();
    return exact.has(lower) || [...stems].some((s) => lower.startsWith(s)) ? " " : w;
  });
}

// Language signals. Proper nouns (capitalised words) never count, so an
// English text may name Czech streets, towns or districts ("Žabovřesky").
const CS_LETTERS = /[ěščřžůťďň]/iu;
const ANY_CS_ACCENT = /[áéíóúůýěščřžťďň]/iu;
const CS_WORDS = new Set([
  "je", "jsou", "se", "si", "na", "ke", "ve", "ze", "u", "k", "v", "z", "s", "po", "při", "pro", "nebo", "jen",
  "tu", "tady", "tam", "kde", "jak", "který", "která", "které", "dnes", "místo", "místa", "cesta", "cesty", "cestě",
  "najdi", "dojdi", "navštiv", "projdi", "zastav", "rozhlédni", "odbav", "značky", "značce", "značka", "kolem",
]);
const EN_WORDS = new Set([
  "the", "and", "of", "to", "your", "you", "a", "an", "at", "by", "this", "that", "with", "for", "from", "in",
  "on", "is", "it", "its", "here", "find", "walk", "look", "path", "see", "around", "start", "check", "marker",
  "where", "today", "take", "along", "visit", "hunt",
]);
function languageSignals(text) {
  let cs = 0,
    en = 0;
  for (const w of text.match(WORD) || []) {
    const lower = w.toLowerCase();
    const proper = w[0] !== lower[0];
    if (CS_WORDS.has(lower)) cs++;
    else if (!proper && ANY_CS_ACCENT.test(w)) cs++;
    if (EN_WORDS.has(lower)) en++;
  }
  return { cs, en };
}

// A model often writes one sentence too many. Keep the leading whole
// sentences when they fit; never cut inside a sentence.
function fitDescription(description, [min, max]) {
  if (description.length <= max) return description;
  const sentences = description.match(/[^.!?…]+[.!?…]+["“”»]?\s*/gu) || [];
  let out = "";
  for (const s of sentences) {
    if ((out + s).trim().length > max) break;
    out += s;
  }
  out = out.trim();
  return out.length >= min ? out : description;
}

/**
 * Checks one model-written text. Returns { value } or { reason }.
 * Numbers are allowed only when they occur in the POI's own name or facts,
 * so a model cannot invent dates, distances or amounts. The safety and
 * language rules look at the text without the place's own names.
 */
export function validateFlavour(output, { poi, lang }) {
  if (!output || typeof output !== "object") return { reason: "schema" };
  if (typeof output.title !== "string" || typeof output.description !== "string")
    return { reason: "schema" };
  const title = clean(output.title).replace(/^["“„'](.*)["”“']$/u, "$1").trim();
  const description = fitDescription(clean(output.description), FLAVOUR_LIMITS.description);
  const [tMin, tMax] = FLAVOUR_LIMITS.title;
  const [dMin, dMax] = FLAVOUR_LIMITS.description;
  if (title.length < tMin || title.length > tMax) return { reason: "title-length" };
  if (description.length < dMin || description.length > dMax) return { reason: "description-length" };
  const both = `${title} ${description}`;
  const nameless = withoutNames(both, poi);
  const broken = screenText(nameless, FLAVOUR_RULES);
  if (broken) return { reason: broken };
  const known = new Set([
    ...digitsIn(poi.name),
    ...Object.values(poi.names || {}).flatMap(digitsIn),
    ...Object.values(poi.facts || {}).flatMap(digitsIn),
  ]);
  if (digitsIn(both).some((d) => !known.has(d))) return { reason: "invented-number" };
  // English text must not drift into Czech and vice versa. Names and other
  // proper nouns are ignored; the other language must not outweigh this one.
  const { cs, en } = languageSignals(nameless);
  if (lang === "en" && (cs > en || (cs > 0 && CS_LETTERS.test(nameless) && cs >= 3))) return { reason: "wrong-language" };
  if (lang === "cs" && (en > cs || (cs === 0 && !ANY_CS_ACCENT.test(nameless)))) return { reason: "wrong-language" };
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

/**
 * Last batch summary for /api/health (no texts, no POI ids): counts, the share
 * of texts the checks rejected and the most common rejection reasons.
 */
export function flavourStatus(db) {
  ensureModuleVersion(db, FLAVOUR_SCHEMA);
  ensureModuleVersion(db, FLAVOUR_REJECTIONS_SCHEMA);
  const last = db
    .prepare(
      "SELECT id,trigger,provider,model,outcome,reason,generated,rejected,requested,failed_calls,calls,tokens_used,token_budget,started_at,finished_at FROM ai_flavour_batches ORDER BY started_at DESC LIMIT 1",
    )
    .get();
  const cached = db
    .prepare("SELECT count(*) AS n FROM ai_flavour_cache WHERE prompt_version=?")
    .get(FLAVOUR_PROMPT_VERSION).n;
  if (!last) return { promptVersion: FLAVOUR_PROMPT_VERSION, cached, lastBatch: null };
  const { id: batchId, ...lastBatch } = last;
  const checked = last.generated + last.rejected;
  lastBatch.rejectionRate = checked ? Math.round((last.rejected / checked) * 1000) / 1000 : null;
  lastBatch.topRejectionReasons = db
    .prepare(
      "SELECT reason, sum(count) AS count FROM ai_flavour_rejections WHERE batch_id=? GROUP BY reason ORDER BY count DESC, reason LIMIT 5",
    )
    .all(batchId)
    .map((r) => ({ reason: r.reason, count: r.count }));
  return { promptVersion: FLAVOUR_PROMPT_VERSION, cached, lastBatch };
}
