// UI strings for the NPC conversation sheet (src/NpcSheet.tsx), in English
// and Czech. Every visible string of the sheet lives here so a shared
// translation layer can take it over without touching the component.
import type { NpcTrade, NpcTurnIn } from "./npc-client";

export type NpcLang = "en" | "cs";

/** Player language: saved choice, then the page language, then the browser. */
export function npcLang(): NpcLang {
  let saved: string | null = null;
  try {
    saved = localStorage.getItem("questlayer.lang");
  } catch {
    /* storage blocked */
  }
  const page = typeof document !== "undefined" ? document.documentElement.lang : "";
  const pick = saved || (page && page !== "en" ? page : "") || (typeof navigator !== "undefined" ? navigator.language : "en");
  return pick.toLowerCase().startsWith("cs") ? "cs" : "en";
}

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

type Strings = typeof en;

const cs: Strings = {
  talkTo: (name) => `Mluvit s: ${name}`,
  close: "Zavřít",
  tabTalk: "Rozhovor",
  tabTasks: "Úkoly",
  tabVault: "Trezor",
  tabAbout: "Profil",
  sayTo: (name) => `Napiš něco pro ${name}…`,
  messageTo: (name) => `Zpráva pro ${name}`,
  send: "Poslat",
  thinking: "…",
  error: "Něco se pokazilo.",
  aiVoice: "AI hlas · odpovídá jen z herních dat",
  stdVoice: "Běžné odpovědi",
  role: {
    storyteller: "Vypravěč",
    trader: "Obchodník",
    keeper: "Strážce trezoru",
    quest_giver: "Zadavatel úkolů",
    wandering_rare: "Vzácný poutník",
  },
  turnIn: (xp, aura) => `Odevzdat · +${xp} XP${aura ? " + Aura" : ""}`,
  notReady: "Dokonči zastávky a vrať se",
  checkHandOver: "Zkontrolovat předání",
  noActions: "Teď nic nenabízím. Zeptej se mě!",
  noTasks: "Od této postavy zatím nemáš žádný úkol.",
  moreTasks: (n) => (n === 1 ? "1 rozdělaný úkol" : n < 5 ? `${n} rozdělané úkoly` : `${n} rozdělaných úkolů`),
  stakers: "Pro stakery",
  vaultBalance: "Tvůj trezor a zůstatek",
  about: "O postavě",
  aiNote: "Odměny dávají vždy jen tlačítka nabídek, nikdy chat.",
  offerTag: {
    quest: "Úkol",
    chapter: "Příběh",
    trade_buy: "Koupí",
    trade_sell: "Prodá",
    trade_up: "3 → 1",
    roll: "Hod",
    challenge: "Souboj",
  },
  reward: en.reward,
  signed: "Podepsáno",
  patron: (line, of) => `Patron ${String(line)}/${String(of)}`,
  accepted: (label) => `Úkol přijat: ${label}`,
  already: "Už odevzdáno.",
  turnedIn: (r) =>
    `+${r.xp} XP${r.aura ? ` a ${r.aura.name} (${r.aura.rarity})` : ""}${r.edition ? `${r.aura ? "," : " a"} navíc NPC edice ${r.edition.name} (${r.edition.rarity})` : ""}.${r.aura || r.edition ? " Zajisti ji na NEAR ve svém šatníku." : ""}${r.patron ? ` Patronova cesta ${r.patron.pathLine}/${r.patron.pathOf}: „${r.patron.story.title}“. ${r.patron.story.text}${r.patron.edition && r.patron.edition.id !== r.edition?.id ? ` Získáváš také ${r.patron.edition.name}.` : ""}` : ""}${r.note ? ` ${r.note}` : ""}`,
  trade: (t, who) => {
    if (t.kind === "trade_up")
      return t.state === "completed"
        ? `Hotovo. ${t.aura ? `${t.aura.name} (${t.aura.rarity}) je tvoje; zajisti ji na NEAR ve šatníku.` : ""}${t.ledgerAura ? ` ${who} ti předává i ${t.ledgerAura.name}.` : ""}`
        : `Pošli ${t.tokens?.join(", ")} na ${t.receiver} (šatník → převod) a pak klepni na „Zkontrolovat předání“. Obchod platí 30 minut.`;
    const minutes = Math.max(1, Math.round((t.deadlineMs - Date.now()) / 60000));
    return t.kind === "trade_buy"
      ? `${who} podepsal nákupní příkaz: ${near(t.price)} test NEAR za ${t.tokenId}. Otevři Trh → Podepsané nabídky a přijmi do ${minutes} min.`
      : `${who} podepsal prodejní příkaz: ${t.tokenId} za ${near(t.price)} test NEAR. Otevři Trh → Podepsané nabídky a kup do ${minutes} min.`;
  },
};

export const NPC_STRINGS: Record<NpcLang, Strings> = { en, cs };
export const npcStrings = (lang: NpcLang = npcLang()) => NPC_STRINGS[lang];
