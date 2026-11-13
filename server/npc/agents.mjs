// NPC agent cards (agents.md style): each persona has a short markdown card in
// server/data/npc-agents/<persona>.md that gives it a mission, the question it
// asks players and what it never does. The card body goes into the system
// prompt; the front matter sets the mission topic and the opening question.
// Cards are checked at load so a bad edit fails at startup, not mid-chat.
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** Mission topics. A topic is what an NPC collects into the shared memory. */
export const LORE_TOPICS = Object.freeze({
  pub: { en: "pubs and taprooms", cs: "hospody" },
  food: { en: "places to eat", cs: "kde se najíst" },
  sights: { en: "sights worth seeing", cs: "zajímavosti" },
  secret: { en: "hidden corners", cs: "tajná zákoutí" },
  view: { en: "viewpoints", cs: "výhledy" },
});
export const LORE_TOPIC_IDS = Object.freeze(Object.keys(LORE_TOPICS));

// An NPC without a card still has a mission, picked by archetype.
const ARCHETYPE_TOPIC = { trader: "pub", quest_giver: "food", storyteller: "sights", keeper: "view", wandering_rare: "secret" };
const DEFAULT_ASK = {
  pub: { en: "Where is the best pub around here?", cs: "Kde je tu nejlepší hospoda?" },
  food: { en: "Where is a good place to eat around here?", cs: "Kde se tu dá dobře najíst?" },
  sights: { en: "What is worth seeing around here?", cs: "Co je tu v okolí zajímavého?" },
  secret: { en: "Do you know a hidden corner nearby?", cs: "Znáš tu poblíž nějaké tajné zákoutí?" },
  view: { en: "Where is the best view around here?", cs: "Odkud je tu nejhezčí výhled?" },
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
  for (const k of ["ask_en", "ask_cs"]) if (!head[k] || head[k].length > 120 || /[<>{}]/.test(head[k])) errors.push(k);
  if (!body || body.length > 1500 || /[<>{}]|```/.test(body)) errors.push("body");
  if (!/## Mission/.test(body)) errors.push("mission section");
  if (errors.length) throw Error(`Agent card ${file}: invalid ${errors.join(", ")}`);
  return Object.freeze({ persona: head.persona, topic: head.topic, ask: Object.freeze({ en: head.ask_en, cs: head.ask_cs }), body });
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
    body: `## Mission\nI collect ${LORE_TOPICS[topic].en} from explorers and share the best tips with the next ones.`,
  });
}
