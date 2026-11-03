// UI strings for the NPC conversation sheet (src/NpcSheet.tsx). The game
// speaks English everywhere; every visible string of the sheet lives here.
import type { NpcTrade, NpcTurnIn } from "./npc-client";

const near = (yocto: string) => (Number(BigInt(yocto) / 10n ** 21n) / 1000).toFixed(3);

const en = {
  talkTo: (name: string) => `Talk to ${name}`,
  close: "Close",
  tabTalk: "Talk",
  tabTasks: "Tasks",
  tabVault: "Vault",
  tabAbout: "Profile",
  sayTo: (name: string) => `Say something to ${name}…`,
  messageTo: (name: string) => `Message to ${name}`,
  send: "Send",
  thinking: "…",
  error: "Something went wrong.",
  aiVoice: "AI voice · answers only from game data",
  stdVoice: "Standard replies",
  role: {
    storyteller: "Storyteller",
    trader: "Trader",
    keeper: "Keeper",
    quest_giver: "Quest giver",
    wandering_rare: "Rare wanderer",
  } as Record<string, string>,
  turnIn: (xp: number, aura: boolean) => `Turn in · +${xp} XP${aura ? " + Aura" : ""}`,
  notReady: "Finish the stops, then come back",
  checkHandOver: "Check hand-over",
  noActions: "Nothing to offer right now. Ask me something!",
  noTasks: "No tasks from this character yet.",
  moreTasks: (n: number) => `${n} task${n === 1 ? "" : "s"} in progress`,
  stakers: "For stakers",
  vaultBalance: "Your vault and balance",
  about: "About",
  aiNote: "Rewards always come from the offer buttons, never from the chat.",
  offerTag: {
    quest: "Quest",
    chapter: "Story",
    trade_buy: "Buys",
    trade_sell: "Sells",
    trade_up: "3 → 1",
    roll: "Roll",
    challenge: "Duel",
  } as Record<string, string>,
  reward: (xp: unknown, aura: boolean) => `${xp ? `+${String(xp)} XP` : ""}${aura ? `${xp ? " " : ""}+ Aura` : ""}`,
  signed: "Signed",
  patron: (line: unknown, of: unknown) => `Patron ${String(line)}/${String(of)}`,
  accepted: (label: string) => `Task accepted: ${label}`,
  already: "Already turned in.",
  turnedIn: (r: NpcTurnIn) =>
    `+${r.xp} XP${r.aura ? ` and ${r.aura.name} (${r.aura.rarity})` : ""}${r.edition ? `${r.aura ? "," : " and"} plus the NPC-only ${r.edition.name} (${r.edition.rarity})` : ""}.${r.aura || r.edition ? " Secure it on NEAR from your wardrobe." : ""}${r.patron ? ` Patron's Path ${r.patron.pathLine}/${r.patron.pathOf}: "${r.patron.story.title}". ${r.patron.story.text}${r.patron.edition && r.patron.edition.id !== r.edition?.id ? ` You also earned ${r.patron.edition.name}.` : ""}` : ""}${r.note ? ` ${r.note}` : ""}`,
  trade: (t: NpcTrade, who: string) => {
    if (t.kind === "trade_up")
      return t.state === "completed"
        ? `Done. ${t.aura ? `${t.aura.name} (${t.aura.rarity}) is yours; secure it on NEAR from your wardrobe.` : ""}${t.ledgerAura ? ` ${who} also hands you the ${t.ledgerAura.name}.` : ""}`
        : `Send ${t.tokens?.join(", ")} to ${t.receiver} (wardrobe → transfer), then tap "Check hand-over". The deal stays open 30 minutes.`;
    const minutes = Math.max(1, Math.round((t.deadlineMs - Date.now()) / 60000));
    return t.kind === "trade_buy"
      ? `${who} signed a buy order: ${near(t.price)} test NEAR for ${t.tokenId}. Open Market → Signed offers and accept within ${minutes} min.`
      : `${who} signed a sell order: ${t.tokenId} for ${near(t.price)} test NEAR. Open Market → Signed offers and buy it within ${minutes} min.`;
  },
};

export const npcStrings = () => en;
