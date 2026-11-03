// Landmark clue quests (docs/WORLDS-PLAN.md C.4, `landmark-clue`). A player
// reaches a notable POI and answers one multiple-choice question about it.
//
// The answer always comes from Wikidata facts stored in the checked POI file
// (scripts/poi/merge.mjs `facts`: short descriptions per language and the
// inception year P571). Questions are fixed templates; the distractors are
// derived deterministically from neighbouring POIs or nearby centuries. No
// model writes an option or picks the answer, and nothing here runs a model
// on a request path.
//
// One answer per player and quest: right earns the full XP, wrong earns the
// visit XP and shows the right answer. XP only, never GOLD or NEAR.
import { assert, hash } from "./domain.mjs";
import { ensureModuleVersion, registerModuleSchema } from "./schema-compatibility.mjs";

export const LANDMARK_CLUE_POLICY = "landmark-clue-v1";
export const CLUE_XP = Object.freeze({ correct: 70, miss: 20 });
export const CLUE_OPTIONS = 4;
export const MIN_CLUE_OPTIONS = 3;
export const MAX_CLUES_PER_CELL = 2;
const MAX_TEXT = 140;
const CLUE_LANGS = ["en", "cs"];

export const LANDMARK_CLUE_SCHEMA = registerModuleSchema({
  name: "landmark-clue",
  version: 1,
  sql: `CREATE TABLE IF NOT EXISTS landmark_clue_answers(quest_id TEXT NOT NULL REFERENCES quests(id),player_id TEXT NOT NULL REFERENCES players(id),choice TEXT NOT NULL,correct INTEGER NOT NULL CHECK(correct IN(0,1)),created_at INTEGER NOT NULL,PRIMARY KEY(quest_id,player_id))`,
});
const ready = new WeakSet();
export function ensureLandmarkClueSchema(db) {
  if (ready.has(db)) return;
  ensureModuleVersion(db, LANDMARK_CLUE_SCHEMA);
  ready.add(db);
}

const unit = (seed, key) => parseInt(hash(`${seed}:${key}`).slice(0, 13), 16) / 2 ** 52;
const shuffle = (list, seed) =>
  list
    .map((item) => ({ item, k: unit(seed, item.id) }))
    .sort((a, b) => a.k - b.k || (a.item.id < b.item.id ? -1 : 1))
    .map((x) => x.item);

function cleanText(value) {
  if (typeof value !== "string") return null;
  const text = value.replace(/[\u0000-\u001f\u007f<>]/g, "").replace(/\s+/g, " ").trim();
  return text && text.length <= MAX_TEXT ? text : null;
}
const norm = (s) => s.toLocaleLowerCase("cs").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim();

// Wikimedia housekeeping items are not facts about a place.
const JUNK = /wikimedia|disambiguation|rozcestn|kategorie|category|seznam|list of/i;

/** Usable short descriptions of a POI by language (en/cs), or null. */
export function descriptionsOf(poi) {
  const facts = poi?.facts && typeof poi.facts === "object" ? poi.facts : null;
  if (!facts) return null;
  const out = {};
  for (const lang of CLUE_LANGS) {
    const text = cleanText(facts[lang]);
    if (text && !JUNK.test(text)) out[lang] = text;
  }
  if (!Object.keys(out).length) return null;
  // Every language gets a text: the other language stands in for a missing one.
  for (const lang of CLUE_LANGS) out[lang] ||= out.en || out.cs;
  return out;
}

/** Century of a year: 1350 -> 14, 2001 -> 21, -499 -> -5 (BC). */
export function centuryOf(year) {
  return year > 0 ? Math.ceil(year / 100) : -Math.ceil(-year / 100 + (year === 0 ? 1 : 0));
}
function centuryLabel(c, lang) {
  if (lang === "cs") return c > 0 ? `${c}. století` : `${-c}. století př. n. l.`;
  const n = Math.abs(c),
    suffix = n % 100 >= 11 && n % 100 <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10] || "th";
  return c > 0 ? `${n}${suffix} century` : `${n}${suffix} century BC`;
}

function inceptionClue(poi, seed, nowYear) {
  const year = poi.facts?.inception;
  if (!Number.isInteger(year) || year > nowYear || year < -2000) return null;
  const c = centuryOf(year),
    max = centuryOf(nowYear);
  // Neighbouring centuries, never past the current one and never across the
  // year 0 (a BC option next to an AD answer would be a giveaway).
  const near = [-1, 1, -2, 2, -3, 3, -4, 4]
    .map((d) => c + d)
    .filter((n) => n !== 0 && Math.sign(n) === Math.sign(c) && n <= max);
  const picked = shuffle(near.map((n) => ({ id: `c${n}`, n })), `${seed}:century`).slice(0, CLUE_OPTIONS - 1);
  if (picked.length < MIN_CLUE_OPTIONS - 1) return null;
  const options = shuffle([{ id: `c${c}`, n: c }, ...picked], `${seed}:order`).map((o) => ({
    id: o.id,
    text: { en: centuryLabel(o.n, "en"), cs: centuryLabel(o.n, "cs") },
  }));
  return {
    kind: "inception",
    question: {
      en: `In which century was ${poi.name} founded or built?`,
      cs: `Ve kterém století vzniklo místo ${poi.name}?`,
    },
    options,
    answer: `c${c}`,
  };
}

function descriptionClue(poi, pool, seed) {
  const own = descriptionsOf(poi);
  if (!own) return null;
  const seen = new Set(CLUE_LANGS.map((l) => norm(own[l])));
  const name = norm(poi.name || "");
  const candidates = [];
  for (const other of pool || []) {
    if (!other || other.id === poi.id || other.category === poi.category) continue;
    const d = descriptionsOf(other);
    if (!d) continue;
    const keys = CLUE_LANGS.map((l) => norm(d[l]));
    // Distinct in every language; never the place's own name (a giveaway).
    if (keys.some((k) => !k || seen.has(k) || (name && k.includes(name)))) continue;
    keys.forEach((k) => seen.add(k));
    candidates.push({ id: `d${hash(other.id).slice(0, 10)}`, text: d });
  }
  const picked = shuffle(candidates, `${seed}:wrong`).slice(0, CLUE_OPTIONS - 1);
  if (picked.length < MIN_CLUE_OPTIONS - 1) return null;
  const right = { id: `d${hash(poi.id).slice(0, 10)}`, text: own };
  return {
    kind: "description",
    question: {
      en: `Which short description of ${poi.name} is the one Wikidata gives?`,
      cs: `Který krátký popis místa ${poi.name} uvádějí Wikidata?`,
    },
    options: shuffle([right, ...picked], `${seed}:order`),
    answer: right.id,
  };
}

/**
 * buildLandmarkClue({ poi, pool, seed, nowYear }) -> clue | null
 * Deterministic for the same inputs. The inception year wins when known (it
 * needs local knowledge, a plaque or a sign), else the Wikidata description
 * against descriptions of other kinds of places nearby.
 */
export function buildLandmarkClue({ poi, pool = [], seed, nowYear = new Date().getUTCFullYear() }) {
  if (!poi?.name || !poi.facts) return null;
  const s = `${seed}:${poi.id}`;
  const clue = inceptionClue(poi, s, nowYear) || descriptionClue(poi, pool, s);
  return clue
    ? { policy: LANDMARK_CLUE_POLICY, source: "wikidata", wikidata: poi.wikidata || null, ...clue }
    : null;
}

export const clueReady = (poi) => !!poi?.name && (Number.isInteger(poi.facts?.inception) || !!descriptionsOf(poi));

/** Player view of a stored clue: the question and options, never the answer before it is given. */
export function clueView(db, questId, clue, player, lang = "en") {
  if (!clue?.options?.length) return null;
  const l = CLUE_LANGS.includes(lang) ? lang : "en";
  const view = {
    question: clue.question?.[l] || clue.question?.en,
    options: clue.options.map((o) => ({ id: o.id, text: o.text?.[l] || o.text?.en })),
    source: "Wikidata",
    policy: clue.policy,
    xp: { ...CLUE_XP },
  };
  if (player) {
    ensureLandmarkClueSchema(db);
    const row = db
      .prepare("SELECT choice,correct FROM landmark_clue_answers WHERE quest_id=? AND player_id=?")
      .get(questId, player);
    if (row) view.result = { choice: row.choice, correct: !!row.correct, answer: clue.answer };
  }
  return view;
}

/** Inside the claim transaction: check and store the one answer. Returns { correct, xp, answer }. */
export function answerClue(db, { questId, player, clue, choice, now }) {
  assert(
    typeof choice === "string" && clue.options.some((o) => o.id === choice),
    "Pick one answer to the question first.",
    400,
    "CLUE_ANSWER",
  );
  ensureLandmarkClueSchema(db);
  const correct = choice === clue.answer;
  db.prepare(
    "INSERT INTO landmark_clue_answers(quest_id,player_id,choice,correct,created_at) VALUES(?,?,?,?,?)",
  ).run(questId, player, choice, correct ? 1 : 0, now);
  return { correct, xp: correct ? CLUE_XP.correct : CLUE_XP.miss, answer: clue.answer };
}
