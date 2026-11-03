// Browser fixture for the NPC conversation sheet. API calls are answered in
// memory. ?npc=pilgrim|merchant|keeper|chronicler|wisp  &lang=cs|en  &tab=…
import { createRoot } from "react-dom/client";
import NpcSheet from "../src/NpcSheet";
import type { ActorEncounter } from "../src/actor-types";
import "../src/style.css";

const q = new URLSearchParams(location.search);
const model = q.get("npc") || "pilgrim";
if (q.get("lang")) localStorage.setItem("questlayer.lang", q.get("lang")!);
const archetype = ({ pilgrim: "quest_giver", merchant: "trader", keeper: "keeper", chronicler: "storyteller", wisp: "wandering_rare" } as const)[model as "pilgrim"] || "quest_giver";
const cs = q.get("lang") === "cs";
const offer = (id: string, kind: string, label: string, terms: Record<string, unknown>) => ({ id, kind, label, terms, expiresAt: Date.now() + 3e5 });
const menu =
  archetype === "trader"
    ? [offer("b1", "trade_buy", cs ? "Koupím tvou Auru Kometa" : "I'll buy your Comet Aura", {}), offer("u1", "trade_up", cs ? "Vyměň 3 běžné za 1 vzácnou" : "Trade 3 commons for 1 rare", {})]
    : [
        offer("q1", "quest", cs ? "Najdi tři lavičky v parku" : "Find three benches in the park", { xp: 40 }),
        offer("c1", "chapter", cs ? "Kapitola 2: Ztracený kompas" : "Chapter 2: The lost compass", { xp: 80, aura: true }),
      ];
const reply = {
  say: cs
    ? "Ahoj, poutníku! Cesta mě zavedla až sem. Pomůžeš mi najít, co jsem ztratila?"
    : "Hello, traveller! The road brought me here. Will you help me find what I lost?",
  emote: "wave",
  offer: menu[0],
  menu,
  locked: [{ id: "l1", kind: "quest", label: cs ? "Patronova stezka" : "Patron's trail", locked: { tier: 1, step: "staker", missing: ["Stake 2 NEAR (~5 €)"] } }],
  active: [
    { offerId: "a1", kind: "quest", label: cs ? "Doruč dopis kronikářce" : "Deliver a letter to the chronicler", xp: 30, aura: false, steps: [{ questId: "s1", title: "Náměstí", kind: "visit", zone: null, done: true }] },
    { offerId: "a2", kind: "quest", label: cs ? "Obejdi tři kašny" : "Visit three fountains", xp: 60, aura: true, steps: [{ questId: "s2", title: "Kašna 1", kind: "visit", zone: "Centrum", done: true }, { questId: "s3", title: "Kašna 2", kind: "visit", zone: null, done: false }] },
  ],
  source: "ollama",
  note: undefined,
  npc: { id: "x", name: model === "pilgrim" ? "Ráda the Pilgrim" : model, title: cs ? "Poutnice s pochůzkami" : "Wanderer with errands", archetype },
};
const realFetch = window.fetch;
window.fetch = async (input, init) => {
  const url = String(input);
  if (!url.startsWith("/api/")) return realFetch(input, init);
  await new Promise((r) => setTimeout(r, 150));
  let body: unknown = reply;
  if (url.endsWith("/talk")) body = { ...reply, say: cs ? "To je dobrá otázka! Zkus to u kašny." : "Good question! Try the fountain.", emote: "think" };
  if (url.endsWith("/keeper")) body = { lines: ["Vault: 2.000 NEAR", "Pending yield: 0.004 NEAR"], stake: null };
  return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
};
const encounter: ActorEncounter = {
  encounter: "tok",
  expiresAt: Date.now() + 3e5,
  distanceM: 12,
  menu: [],
  actor: { id: "x", kind: "npc", archetype, name: reply.npc.name, title: reply.npc.title, model, segments: [] },
};
createRoot(document.getElementById("root")!).render(<NpcSheet actorId="x" encounter={encounter} onClose={() => {}} />);
