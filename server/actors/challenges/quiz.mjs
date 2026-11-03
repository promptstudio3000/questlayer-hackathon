// Themed quiz: three questions about the place the monster stands at, the city
// and the game's own lore and Auras. Answers stay on the server; the client
// only ever receives prompts and shuffled choices.
import { readFileSync } from "node:fs";
import { seededRandom } from "./rng.mjs";

export const QUIZ_QUESTIONS = 3;
export const QUIZ_SECONDS_PER_QUESTION = 20;
export const QUIZ_PASS = 2;

const BANK_URL = new URL("../../data/monster-quiz.json", import.meta.url);
const CATALOG_URL = new URL("../../data/aura-catalog.json", import.meta.url);

function validQuestion(q) {
  return (
    q &&
    /^[a-z0-9-]{3,60}$/.test(q.id) &&
    typeof q.prompt === "string" &&
    q.prompt.length > 0 &&
    q.prompt.length <= 200 &&
    Array.isArray(q.choices) &&
    q.choices.length >= 2 &&
    q.choices.length <= 4 &&
    q.choices.every((c) => typeof c === "string" && c.length && c.length <= 80) &&
    new Set(q.choices).size === q.choices.length &&
    Number.isInteger(q.answer) &&
    q.answer >= 0 &&
    q.answer < q.choices.length
  );
}

// Questions generated from the Aura catalog, so the bank follows the catalog.
export function auraQuestions(catalog) {
  const editions = catalog.editions || [];
  const sets = new Map((catalog.sets || []).map((s) => [s.id, s.name]));
  const setNames = [...sets.values()];
  const out = [];
  for (const e of editions) {
    const setName = sets.get(e.set);
    if (setName && setNames.length >= 4)
      out.push({
        id: `aura-set-${e.id}`,
        prompt: `Which Aura set does ${e.name} belong to?`,
        choices: [setName, ...setNames.filter((n) => n !== setName).slice(0, 3)],
        answer: 0,
      });
    const rarities = catalog.rarities || [];
    if (rarities.includes(e.rarity) && rarities.length >= 4)
      out.push({
        id: `aura-rarity-${e.id}`,
        prompt: `How rare is the ${e.name} Aura?`,
        choices: [e.rarity, ...rarities.filter((r) => r !== e.rarity)].map(
          (r) => r[0].toUpperCase() + r.slice(1),
        ),
        answer: 0,
      });
  }
  return out;
}

export function loadQuizBank({
  bank = JSON.parse(readFileSync(BANK_URL, "utf8")),
  catalog = JSON.parse(readFileSync(CATALOG_URL, "utf8")),
} = {}) {
  const lore = [...(bank.lore || []), ...auraQuestions(catalog)];
  const cities = Object.fromEntries(
    Object.entries(bank.cities || {}).map(([city, list]) => [city, list]),
  );
  const all = [...lore, ...Object.values(cities).flat()];
  const ids = new Set();
  for (const q of all) {
    if (!validQuestion(q)) throw new Error(`Invalid quiz question ${q?.id}`);
    if (ids.has(q.id)) throw new Error(`Duplicate quiz question ${q.id}`);
    ids.add(q.id);
  }
  return Object.freeze({ lore, cities, byId: new Map(all.map((q) => [q.id, q])) });
}

// Picks one place question if the monster stands at a known place, then city
// questions, then lore, three in total. Choices are shuffled per encounter.
export function createQuiz(bank, { seed, cityId, placeName }) {
  const rng = seededRandom(`${seed}:quiz`);
  const city = rng.shuffle(bank.cities[cityId] || []);
  const lore = rng.shuffle(bank.lore);
  const picked = [];
  const take = (q) => {
    if (q && picked.length < QUIZ_QUESTIONS && !picked.includes(q)) picked.push(q);
  };
  const norm = (s) => String(s || "").trim().toLowerCase();
  if (placeName)
    take(city.find((q) => q.places?.some((p) => norm(p) === norm(placeName))));
  take(city.find((q) => !q.places));
  take(lore[0]);
  for (const q of [...city.filter((q) => !q.places), ...lore]) take(q);
  return picked.map((q) => {
    const order = rng.shuffle(q.choices.map((_, i) => i));
    return { id: q.id, order };
  });
}

// The client view: prompt and shuffled choices, never the answer.
export function quizView(bank, plan) {
  return plan.map(({ id, order }) => {
    const q = bank.byId.get(id);
    return { id, prompt: q.prompt, choices: order.map((i) => q.choices[i]) };
  });
}

// answers: [{ id, choice }] where choice indexes the shuffled choices.
export function scoreQuiz(bank, plan, answers, { elapsedMs }) {
  const list = Array.isArray(answers) ? answers.slice(0, QUIZ_QUESTIONS) : [];
  const overtime = elapsedMs > QUIZ_QUESTIONS * QUIZ_SECONDS_PER_QUESTION * 1000 + 5000;
  const results = plan.map(({ id, order }) => {
    const q = bank.byId.get(id);
    const a = list.find((x) => x && x.id === id);
    const choice = Number.isInteger(a?.choice) ? a.choice : -1;
    const correct = !overtime && order[choice] === q.answer;
    return { id, correct, answer: order.indexOf(q.answer) };
  });
  const correct = results.filter((r) => r.correct).length;
  return {
    won: correct >= QUIZ_PASS,
    score: correct,
    max: QUIZ_QUESTIONS,
    reason: overtime ? "time" : undefined,
    results,
  };
}
