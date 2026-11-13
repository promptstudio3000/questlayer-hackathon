// NPC agent cards (agents.md style): each persona has a short markdown card in
// server/data/npc-agents/<persona>.md that gives it a mission, the question it
// asks players and what it never does. The card body goes into the system
// prompt; the front matter sets the mission topic and the opening question.
// NPCs speak English only, so a card has one question in English.
// Cards are checked at load so a bad edit fails at startup, not mid-chat.
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** Mission topics. A topic is what an NPC collects into the shared memory. */
export const LORE_TOPICS = Object.freeze({
  pub: "pubs and taprooms",
  food: "places to eat",
  sights: "sights worth seeing",
  secret: "hidden corners",
  view: "viewpoints",
});
export const LORE_TOPIC_IDS = Object.freeze(Object.keys(LORE_TOPICS));

// An NPC without a card still has a mission, picked by archetype.
const ARCHETYPE_TOPIC = { trader: "pub", quest_giver: "food", storyteller: "sights", keeper: "view", wandering_rare: "secret" };
const DEFAULT_ASK = {
  pub: "Tell me, explorer, where does one find the finest pub in these parts?",
  food: "Where around here might a hungry soul find a truly splendid meal?",
  sights: "What marvel nearby should no explorer ever miss?",
  secret: "Psst. Do you know a hidden corner nearby that few eyes have seen?",
  view: "Where around here does the view take your breath away?",
};

const DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "data", "npc-agents");

export function parseAgentCard(source, file = "card") {
  const match = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(String(source).replace(/\r\n/g, "\n"));
  if (!match) throw Error(`Agent card ${file}: missing front matter`);
  const head = Object.fromEntries(
    match[1]
      .split("\n")
      .filter((l) => l.trim())
      .map((l) => {
        const i = l.indexOf(":");
        return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
      }),
  );
  const body = match[2].trim();
  const errors = [];
  if (!/^[a-z0-9-]{3,40}$/.test(head.persona || "")) errors.push("persona");
  if (!LORE_TOPIC_IDS.includes(head.topic)) errors.push("topic");
  if (!head.ask || head.ask.length > 120 || /[<>{}]/.test(head.ask)) errors.push("ask");
  if (!body || body.length > 1500 || /[<>{}]|```/.test(body)) errors.push("body");
  if (!/## Mission/.test(body)) errors.push("mission section");
  if (errors.length) throw Error(`Agent card ${file}: invalid ${errors.join(", ")}`);
  return Object.freeze({ persona: head.persona, topic: head.topic, ask: head.ask, body });
}

export function loadAgentCards(dir = DIR) {
  const map = new Map();
  if (!existsSync(dir)) return map;
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".md")).sort()) {
    const card = parseAgentCard(readFileSync(join(dir, file), "utf8"), file);
    if (map.has(card.persona)) throw Error(`Agent card ${file}: duplicate persona ${card.persona}`);
    map.set(card.persona, card);
  }
  return map;
}

let cached = null;
export const agentCards = () => (cached ??= loadAgentCards());

/** The mission of an NPC: its card, or a default for its archetype. */
export function missionFor(persona, cards = agentCards()) {
  const card = persona?.id ? cards.get(persona.id) : null;
  if (card) return card;
  const topic = ARCHETYPE_TOPIC[persona?.archetype] || "sights";
  return Object.freeze({
    persona: persona?.id || "default",
    topic,
    ask: DEFAULT_ASK[topic],
    body: `## Mission\nI collect ${LORE_TOPICS[topic]} from explorers and share the best tips with the next ones.`,
  });
}
