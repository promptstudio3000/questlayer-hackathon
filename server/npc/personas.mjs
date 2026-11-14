// Reviewed persona cards (server/data/personas/<city>.json). The archetype's
// rules are code; a card only sets name, voice and backstory. Cards are
// schema-checked at load so a bad edit fails at startup, not mid-chat.
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const NPC_ARCHETYPES = Object.freeze([
  "storyteller",
  "trader",
  "keeper",
  "quest_giver",
  "wandering_rare",
]);
const DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "data", "personas");
const text = (v, max) => typeof v === "string" && v.trim().length > 0 && v.length <= max;

export function validatePersona(p) {
  const errors = [];
  if (!p || typeof p !== "object") return ["persona must be an object"];
  if (!/^[a-z0-9-]{3,40}$/.test(p.id || "")) errors.push("id");
  if (!NPC_ARCHETYPES.includes(p.archetype)) errors.push("archetype");
  if (!text(p.name, 60)) errors.push("name");
  if (p.title !== undefined && !text(p.title, 80)) errors.push("title");
  if (!text(p.voice, 300)) errors.push("voice");
  if (!text(p.backstory, 300)) errors.push("backstory");
  if (!Array.isArray(p.likes) || p.likes.length > 6 || !p.likes.every((l) => text(l, 40)))
    errors.push("likes");
  for (const key of ["greeting", "refusal", "idle"]) if (!text(p[key], 200)) errors.push(key);
  return errors.map((e) => `${p.id || "?"}: invalid ${e}`);
}

export function loadPersonas(dir = DIR) {
  const map = new Map();
  if (!existsSync(dir)) return map;
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".json")).sort()) {
    const data = JSON.parse(readFileSync(join(dir, file), "utf8"));
    for (const p of data.personas || []) {
      const errors = validatePersona(p);
      if (errors.length) throw Error(`Persona file ${file}: ${errors.join(", ")}`);
      if (map.has(p.id)) throw Error(`Persona file ${file}: duplicate id ${p.id}`);
      map.set(p.id, Object.freeze({ ...p, cityId: data.cityId }));
    }
  }
  return map;
}

let cached = null;
export const personas = () => (cached ??= loadPersonas());

// Persona for an actor definition (N0's ActorDefinition): its `persona` card,
// or a neutral card for the archetype so the NPC still works without one.
export function personaFor(actor, map = personas()) {
  const card = actor?.persona ? map.get(actor.persona) : null;
  if (card) return card;
  const name = actor?.name || "Wanderer";
  return {
    id: `default-${actor?.archetype || "npc"}`,
    archetype: actor?.archetype || "quest_giver",
    name,
    title: actor?.title,
    voice: "Friendly and brief.",
    backstory: "A local character of the QuestLayer city.",
    likes: [],
    greeting: `Well met, explorer! I am ${name}, and these streets are my home.`,
    refusal: "That I cannot give you, I am afraid.",
    idle: "A glorious day for exploring, is it not?",
  };
}
