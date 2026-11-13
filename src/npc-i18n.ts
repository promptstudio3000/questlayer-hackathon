// UI strings for the NPC conversation sheet (src/NpcSheet.tsx). The game
// speaks English everywhere; every visible string of the sheet lives here and
// goes through tr(), so a language picked in Settings translates it too.
import type { NpcTrade, NpcTurnIn } from "./npc-client";
import { tr } from "./i18n";

const near = (yocto: string) => (Number(BigInt(yocto) / 10n ** 21n) / 1000).toFixed(3);

const strings = () => ({
  talkTo: (name: string) => tr("Talk to {0}", { 0: name }),
  close: tr("Close"),
  tabTalk: tr("Talk"),
  tabTasks: tr("Tasks"),
  tabVault: tr("Vault"),
  tabAbout: tr("Profile"),
  thinking: "…",
  error: tr("Something went wrong."),
  retry: tr("Try again"),
  aiVoice: tr("AI voice · answers only from game data"),
  stdVoice: tr("Standard replies"),
  privateVoice: tr("Private AI on NEAR · runs in a sealed enclave, answers only from game data"),
  verifyReply: tr("Check this reply"),
  role: {
    storyteller: tr("Storyteller"),
    trader: tr("Trader"),
    keeper: tr("Keeper"),
    quest_giver: tr("Quest giver"),
    wandering_rare: tr("Rare wanderer"),
  } as Record<string, string>,
  turnIn: (xp: number, aura: boolean) =>
    aura ? tr("Turn in · +{0} XP + Aura", { 0: xp }) : tr("Turn in · +{0} XP", { 0: xp }),
  notReady: tr("Finish the stops, then come back"),
  errandReport: (xp: number, bonus: number) =>
    bonus
      ? tr("Report back · +{0} XP (+{1} for a right answer)", { 0: xp, 1: bonus })
      : tr("Report back · +{0} XP", { 0: xp }),
  errandNotReady: tr("Do the errand at the place, then come back"),
  errandDone: (xp: number | undefined, bonus: number | undefined) =>
    bonus
      ? tr("Errand done: +{0} XP. Your right answer earned {1} of it.", { 0: xp, 1: bonus })
      : tr("Errand done: +{0} XP.", { 0: xp }),
  checkHandOver: tr("Check hand-over"),
  handingOver: tr("Handing your Auras to the trader on NEAR…"),
  settlingOnChain: tr("Settling the trade on NEAR…"),
  onChainProof: tr("On NEAR:"),
  noActions: tr("Nothing to offer right now. Ask me something!"),
  tasksWaiting: (n: number) => (n === 1 ? tr("1 task waiting") : tr("{0} tasks waiting", { 0: n })),
  stakers: tr("For stakers"),
  vaultBalance: tr("Your vault and balance"),
  likes: (list: string) => tr("Likes: {0}", { 0: list }),
  placesKnown: tr("Places I know"),
  noPlaces: tr("No places yet. Tell me about one in Talk."),
  topic: {
    pub: tr("Pub"),
    food: tr("Food"),
    sights: tr("Sight"),
    secret: tr("Secret"),
    view: tr("View"),
  } as Record<string, string>,
  offerTag: {
    quest: tr("Quest"),
    chapter: tr("Story"),
    trade_buy: tr("Buys"),
    trade_sell: tr("Sells"),
    trade_up: "3 → 1",
    roll: tr("Roll"),
    challenge: tr("Duel"),
  } as Record<string, string>,
  reward: (xp: unknown, aura: boolean) => `${xp ? `+${String(xp)} XP` : ""}${aura ? `${xp ? " " : ""}+ Aura` : ""}`,
  signed: tr("Signed"),
  patron: (line: unknown, of: unknown) => tr("Patron {0}/{1}", { 0: line, 1: of }),
  accepted: (label: string) => tr("Task accepted: {0}", { 0: label }),
  already: tr("Already turned in."),
  turnedIn: (r: NpcTurnIn) => {
    const parts = [`+${r.xp} XP`];
    if (r.aura) parts[0] = tr("+{0} XP and {1} ({2})", { 0: r.xp, 1: r.aura.name, 2: r.aura.rarity });
    if (r.edition)
      parts[0] += r.aura
        ? tr(", plus the NPC-only {0} ({1})", { 0: r.edition.name, 1: r.edition.rarity })
        : tr(" and the NPC-only {0} ({1})", { 0: r.edition.name, 1: r.edition.rarity });
    let text = `${parts[0]}.`;
    if (r.aura || r.edition) text += ` ${tr("Secure it on NEAR from your wardrobe.")}`;
    if (r.patron) {
      text += ` ${tr("Patron's Path {0}/{1}: \"{2}\".", { 0: r.patron.pathLine, 1: r.patron.pathOf, 2: r.patron.story.title })} ${r.patron.story.text}`;
      if (r.patron.edition && r.patron.edition.id !== r.edition?.id)
        text += ` ${tr("You also earned {0}.", { 0: r.patron.edition.name })}`;
    }
    if (r.note) text += ` ${r.note}`;
    return text;
  },
  tradeOnChain: (t: NpcTrade, who: string) =>
    t.state === "filled" || t.txHash
      ? t.kind === "trade_buy"
        ? tr("Sold to {0} on NEAR: {1} test NEAR is on its way to your account.", { 0: who, 1: near(t.price) })
        : tr("Bought from {0} on NEAR: {1} is in your Secured collection.", { 0: who, 1: t.tokenId })
      : tr("Sent to NEAR. It settles in a few seconds."),
  trade: (t: NpcTrade, who: string) => {
    if (t.kind === "trade_up")
      return t.state === "completed"
        ? `${tr("Done.")}${t.aura ? ` ${tr("{0} ({1}) is yours and is being secured on NEAR.", { 0: t.aura.name, 1: t.aura.rarity })}` : ""}${t.ledgerAura ? ` ${tr("{0} also hands you the {1}.", { 0: who, 1: t.ledgerAura.name })}` : ""}`
        : tr('Send {0} to {1} (wardrobe → transfer), then tap "Check hand-over". The deal stays open 30 minutes.', { 0: t.tokens?.join(", "), 1: t.receiver });
    const minutes = Math.max(1, Math.round((t.deadlineMs - Date.now()) / 60000));
    return t.kind === "trade_buy"
      ? tr("{0} will buy {1} for {2} test NEAR for the next {3} min. Settle it here with your explorer account.", { 0: who, 1: t.tokenId, 2: near(t.price), 3: minutes })
      : tr("{0} holds {1} for you at {2} test NEAR for {3} min. Settle it here with your explorer account.", { 0: who, 1: t.tokenId, 2: near(t.intents?.buyerPays ?? t.price), 3: minutes });
  },
});

export const npcStrings = strings;
