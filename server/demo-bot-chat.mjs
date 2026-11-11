// Demo-bot conversations (test world, TEST_SEED=1). Demo bots have no NEAR
// account and no inbox key, so the encrypted inbox (docs/PLAYER-INBOX.md)
// cannot reach them. Instead the explorer card offers a short demo chat:
// the bot answers from a fixed set of in-character lines picked by keywords.
// Nothing is stored (not in the database, not on chain), no AI is called and
// no relayer operation is spent; the card says so next to the chat.
import { clean } from "./ai/text-policy.mjs";
import { assert } from "./domain.mjs";
import { isDemoBot } from "./player-waves.mjs";

export const DEMO_CHAT_MAX_TEXT = 500;

// First matching intent wins (questions before greetings, so "hi, where…"
// gets an answer); patterns cover English and Czech (ASCII-folded).
const INTENTS = [
  {
    key: "who",
    test: /\b(who|bot|real|human|robot|kdo|clovek|jsi)\b/,
    lines: [
      "I'm a demo bot from the test world. I walk the map so you can see how other explorers look and behave.",
      "Honest answer: I'm a demo bot. Real explorers get the private, encrypted inbox instead of me.",
    ],
  },
  {
    key: "gold",
    test: /\b(gold|qgold|coin|coins|money|reward|zlato|mince|penize|odmena)\b/,
    lines: [
      "Coins come in six waves between 07:00 and 22:00. Each one is backed by the day's yield, so pick them up as you pass.",
      "The daily board is my favourite: three goals, and nothing breaks if you skip a day.",
    ],
  },
  {
    key: "quest",
    test: /\b(quest|quests|task|zone|monster|ukol|zona|prisera)\b/,
    lines: [
      "Tap Explore to see zones, quests and NPCs near you, nearest first.",
      "Monsters guard some zones. If one has nothing for you today, come back on another day.",
    ],
  },
  {
    key: "where",
    test: /\b(where|location|place|kde|misto)\b/,
    lines: [
      "I never share where I am, and real explorers don't either. Profiles show what people wear, never a position.",
      "Somewhere around the square. Follow the coins and you'll bump into someone.",
    ],
  },
  {
    key: "thanks",
    test: /\b(thanks|thank|thx|diky|dekuji|dik)\b/,
    lines: ["Any time, {you}!", "You're welcome. Happy exploring!"],
  },
  {
    key: "bye",
    test: /\b(bye|later|cya|see you|nashle|ahoj pak|mej se)\b/,
    lines: ["See you on the map, {you}!", "Bye! Watch out for the evening wave."],
  },
  {
    key: "greet",
    test: /\b(hi|hello|hey|hiya|yo|ahoj|cau|cus|nazdar|zdravim|dobry den|how are you|jak se mas)\b/,
    lines: [
      "Hi {you}! I'm {name}. Lovely day to wander the streets, isn't it?",
      "Hey {you}! Good to see another explorer out here.",
      "Hello {you}! I was just about to check the next coin wave.",
    ],
  },
  {
    key: "help",
    test: /\b(help|how|what|why|pomoc|jak|co|proc)\b/,
    lines: [
      "The wiki explains every rule in the game. It is in Profile → Settings → Help.",
      "Ask the guide on the map, it knows today's world better than I do.",
    ],
  },
];
const FALLBACK = [
  "Nice! I'm only a demo bot, so I can't say much more. Real explorers answer you in the encrypted inbox.",
  "Interesting. I'm a demo bot from the test world, so my answers are short.",
  "I'll think about that while I walk. Say hi to a real explorer too!",
];

const fold = (text) =>
  text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");

function pick(list, seed) {
  let h = 0;
  for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return list[h % list.length];
}

/** The reply a demo bot gives to `text` from `viewer`. Stateless. */
export function demoBotReply(db, viewer, botId, text, now = Date.now()) {
  assert(isDemoBot(botId), "Only demo bots answer here.", 400);
  const message = clean(typeof text === "string" ? text : "");
  assert(message.length >= 1 && message.length <= DEMO_CHAT_MAX_TEXT, "Write 1–500 characters.", 400);
  const bot = db.prepare("SELECT id,name FROM players WHERE id=?").get(botId);
  assert(bot, "This explorer's profile is not available.", 404);
  const you = db.prepare("SELECT name FROM players WHERE id=?").get(viewer)?.name || "explorer";
  const folded = fold(message);
  const intent = INTENTS.find((i) => i.test.test(folded));
  const line = pick(intent ? intent.lines : FALLBACK, `${botId}|${folded}|${Math.floor(now / 60_000)}`);
  return {
    from: bot.name,
    intent: intent?.key || "other",
    reply: line.replaceAll("{name}", bot.name).replaceAll("{you}", you),
    stored: false,
  };
}
