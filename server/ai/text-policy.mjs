// Shared output policy for every model-written text in QuestLayer. Each
// caller names the rules that apply to it; a match rejects the whole output and
// the caller falls back to its deterministic text.
//
// Word lists are matched as whole words (prefix stems end in *), with Unicode
// letter boundaries so Czech diacritics work.
export const words = (list) =>
  new RegExp(
    `(?<![\\p{L}\\p{N}])(?:${list
      .map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, (c) => (c === "*" ? c : `\\${c}`)).replace(/\*/g, "[\\p{L}]*").replace(/ /g, "\\s+"))
      .join("|")})(?![\\p{L}\\p{N}])`,
    "iu",
  );
const RULES = [
  [
    "reward-claim",
    words([
      "gold", "xp", "token*", "crypto*", "nft*", "airdrop*", "reward*",
      "prize*", "money", "cash", "payout*", "paid", "guarantee*", "win", "wins",
      "winner*", "aura*", "kč", "czk", "eur", "usd", "odměn*", "výhr*", "vyhr*",
      "peníz*", "peněz", "zaručen*", "zaplat*",
    ]),
  ],
  // Upper-case NEAR is the token; lower-case "near" is ordinary English.
  ["reward-claim", /(?<![\p{L}\p{N}])NEAR(?![\p{L}\p{N}])/u],
  ["currency", /[$€£]/u],
  ["link-or-contact", /https?:|www\.|[\w.+-]+@[\w-]+\.\w+|\+?\d[\d ]{7,}\d|@\w/iu],
  ["markup", /[<>{}]|```/u],
  [
    "unsafe-instruction",
    words([
      "climb*", "fence*", "roof*", "rooftop*", "railway*", "rail track*",
      "train track*", "trespass*", "private property", "after dark", "at night",
      "midnight", "swim*", "dive", "diving", "jump*", "ledge*", "cliff*",
      "tunnel*", "construction site*", "lézt", "vylez*", "přelez*", "lez*",
      "plot*", "střech*", "kolej*", "soukrom*", "v noci", "o půlnoci", "plav*",
      "skoč*", "útes*", "tunel*", "staveništ*",
    ]),
  ],
  [
    "credential-request",
    words([
      "seed phrase*", "recovery phrase*", "private key*", "secret key*",
      "mnemonic*", "password*", "send me", "transfer your", "send your",
      "heslo", "hesla", "soukromý klíč*", "obnovovací fráz*",
    ]),
  ],
  [
    "promise",
    words([
      "guarantee*", "guaranteed", "certainly win", "will win", "you win",
      "sure to win", "risk-free", "free money", "zaručen*", "určitě vyhraj*",
    ]),
  ],
  [
    "instruction-leak",
    words([
      "ignore all", "ignore previous", "ignore the", "system prompt", "as an ai",
      "language model", "instructions above",
    ]),
  ],
];

export const clean = (s) =>
  String(s)
    .normalize("NFC")
    .replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2066-\u2069]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

// Returns the first rule (among the named ones) the text breaks, or null.
export function screenText(text, rules) {
  for (const [reason, pattern] of RULES)
    if (rules.includes(reason) && pattern.test(text)) return reason;
  return null;
}

// Opt-in operator diagnostics (AI_DEBUG_REJECTED=1): logs a redacted, truncated
// sample of model output that failed the checks. Off by default; never logs
// the prompt, the player or anything resembling a credential.
// Short redacted sample of a model output for the operator audit: long
// key-like strings and emails are masked and the text is cut to 200 characters.
export function redactedSample(output, max = 200) {
  const text = typeof output === "string" ? output : JSON.stringify(output);
  return String(text)
    .replace(/[A-Za-z0-9_\-+/=.]{24,}/g, "[redacted]")
    .replace(/[\w.+-]+@[\w-]+\.\w+/g, "[email]")
    .replace(/\s+/g, " ")
    .slice(0, max);
}

export function debugRejected(env, feature, reason, output) {
  if (env?.AI_DEBUG_REJECTED !== "1" || output === undefined || output === null) return;
  console.warn(`[ai-rejected] ${feature} reason=${reason} sample=${redactedSample(output, 400)}`);
}
