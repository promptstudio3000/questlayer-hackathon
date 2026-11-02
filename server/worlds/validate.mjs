// Deterministic WorldPack validator (docs/WORLDS-PLAN.md B.4). Every rule that
// does not need the POI database: schema, rights, text policy, economy, quest
// templates, actors, skin tokens with a WCAG AA contrast check. The model never
// decides any of this; a pack that fails one rule is refused as a whole.
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { screenText } from "../ai/text-policy.mjs";
import { MONSTER_ARCHETYPES, NPC_ARCHETYPES } from "../actors/definitions.mjs";
import { questTemplateCatalog } from "../quest-templates.mjs";
import { DEFAULT_LAYER_ID, RESERVED_WORLD_IDS, checkSchema } from "./schema.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (rel) => readFileSync(join(ROOT, rel), "utf8");
const MAX_ASSET_BYTES = 64 * 1024;

// Client lookups (object kinds, actor models, design tokens) are copied into
// server/data/world-lookups.json because the deploy ships server/ only; a test
// keeps the copy equal to src/ and docs/design-tokens.json.
const LOOKUPS = JSON.parse(read("server/data/world-lookups.json"));
export const OBJECT_KINDS = Object.freeze([...LOOKUPS.objectKinds]);
export const ACTOR_MODELS = Object.freeze([...LOOKUPS.actorModels]);

// Design tokens: only colour roles may be overridden, as CSS custom
// properties (inkSecondary -> --ink-secondary).
const kebab = (k) => `--${k.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`;
export const TOKEN_KEYS = Object.freeze(Object.keys(LOOKUPS.color).map(kebab));
const BASE_COLORS = Object.fromEntries(Object.entries(LOOKUPS.color).map(([k, v]) => [kebab(k), v]));
const TEXT_PAIRS = LOOKUPS.textPairsToVerify.map(([fg, bg]) => [kebab(fg), kebab(bg)]);

export const QUEST_TEMPLATE_IDS = Object.freeze(questTemplateCatalog().templates.map((t) => t.id));
export const ARCHETYPES = Object.freeze([...NPC_ARCHETYPES, ...MONSTER_ARCHETYPES]);

// Third-party marks that may appear in pack text only when listed in
// rights.trademarks with evidence. Matched case-insensitively as words.
export const KNOWN_MARKS = Object.freeze([
  "Aavegotchi", "Gotchiverse", "Gotchi", "CryptoPunks", "Punks", "Nouns", "Bored Ape", "Yuga",
  "NEAR", "Pokémon", "Pokemon", "Niantic", "Ingress", "Minecraft", "Nintendo",
]);
const ENDORSEMENT = /(?<![\p{L}])(official|officially|endorsed|licensed|partner(ship)?|oficiální|oficiálně|schválen\p{L}*|licencovan\p{L}*)(?![\p{L}])/iu;
// Text policy rules for pack text (name, lore, flavour).
const TEXT_RULES = [
  "reward-claim", "currency", "link-or-contact", "markup", "unsafe-instruction",
  "credential-request", "promise", "instruction-leak",
];

function hexLuminance(hex) {
  const ch = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const [r, g, b] = ch.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
export function contrastRatio(a, b) {
  const [x, y] = [hexLuminance(a), hexLuminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

function personaIds(namespace) {
  const file = join(ROOT, "server", "data", "personas", `${namespace}.json`);
  if (!existsSync(file)) return null;
  return new Set(JSON.parse(readFileSync(file, "utf8")).personas.map((p) => p.id));
}

function packTexts(pack) {
  const out = [];
  const add = (path, v) => typeof v === "string" && out.push([path, v]);
  for (const [k, v] of Object.entries(pack.name || {})) add(`$.name.${k}`, v);
  for (const k of ["en", "cs"]) add(`$.lore.${k}`, pack.lore?.[k]);
  (pack.questTypes || []).forEach((q, i) =>
    Object.entries(q?.flavour || {}).forEach(([k, v]) => add(`$.questTypes[${i}].flavour.${k}`, v)),
  );
  return out;
}

const wordRe = (w) => new RegExp(`(?<![\\p{L}\\p{N}])${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\p{L}\\p{N}])`, "iu");

// Returns { ok, id, failures: [{ rule, path, reason }], warnings: [...] }.
// `options.fileExists` / `options.fileSize` are injectable for tests.
export function validateWorldPack(pack, options = {}) {
  const {
    bytes,
    // Asset files exist only in the repository (CI, CLI). The server checks a
    // pack at start-up with checkFiles: false because the deploy ships no src/.
    checkFiles = true,
    fileExists = (rel) => existsSync(join(ROOT, rel)),
    fileSize = (rel) => statSync(join(ROOT, rel)).size,
  } = options;
  const failures = checkSchema(pack, { bytes });
  const warnings = [];
  const fail = (rule, path, reason) => failures.push({ rule, path, reason });
  // Semantic checks below tolerate missing sections; only a non-object stops here.
  if (!pack || typeof pack !== "object" || Array.isArray(pack))
    return { ok: false, id: pack?.id ?? null, failures, warnings };

  // Identity: reserved ids are official only.
  if (RESERVED_WORLD_IDS.includes(pack.id) && pack.kind !== "official")
    fail("schema", "$.id", `"${pack.id}" is reserved for the official layer`);

  // Rights.
  const assets = new Map((pack.rights?.assets || []).map((a) => [a.path, a]));
  for (const [path, a] of assets) {
    if (!path.startsWith(`public/worlds/${pack.id}/`))
      fail("rights", `$.rights.assets`, `${path} must live under public/worlds/${pack.id}/`);
    if (!checkFiles) continue;
    if (a.source === "third-party" && !fileExists(`public/worlds/${pack.id}/provenance.json`))
      fail("rights", `$.rights.assets`, `${path} is third-party and needs public/worlds/${pack.id}/provenance.json`);
    if (!fileExists(path)) fail("rights", `$.rights.assets`, `${path} does not exist`);
    else if (fileSize(path) > MAX_ASSET_BYTES)
      fail("skin", `$.rights.assets`, `${path} is over the ${MAX_ASSET_BYTES} byte art budget`);
  }
  const listedMarks = (pack.rights?.trademarks || []).map((t) => t.mark?.toLowerCase());
  const endorsed = (pack.rights?.trademarks || []).some((t) => t.endorsed === true);
  const texts = packTexts(pack);
  for (const [path, text] of texts) {
    for (const mark of KNOWN_MARKS)
      if (wordRe(mark).test(text) && !listedMarks.includes(mark.toLowerCase()))
        fail("rights", path, `uses the mark "${mark}" without a rights.trademarks entry`);
    if (ENDORSEMENT.test(text) && !endorsed)
      fail("rights", path, "claims official or endorsed status without endorsement evidence");
    // Text policy.
    const reason = screenText(text, TEXT_RULES);
    if (reason) fail("text", path, `text policy: ${reason}`);
  }
  const o = pack.rights?.ownershipSource;
  if (pack.skin?.avatar === "owned-nft" && !o)
    fail("rights", "$.skin.avatar", "owned-nft avatars need rights.ownershipSource");
  if (o && pack.skin?.avatar !== "owned-nft")
    fail("rights", "$.rights.ownershipSource", 'an ownership source is only used with avatar "owned-nft"');

  // Skin.
  const tokens = pack.skin?.tokens || {};
  for (const k of Object.keys(tokens))
    if (!TOKEN_KEYS.includes(k)) fail("skin", `$.skin.tokens.${k}`, "not a colour role in docs/design-tokens.json");
  const colors = { ...BASE_COLORS, ...tokens };
  for (const [fg, bg] of TEXT_PAIRS) {
    if (!(fg in tokens) && !(bg in tokens)) continue;
    const ratio = contrastRatio(colors[fg], colors[bg]);
    if (ratio < 4.5)
      fail("skin", `$.skin.tokens`, `${fg} on ${bg} has contrast ${ratio.toFixed(2)}, WCAG AA needs 4.5`);
  }
  for (const [kind, ref] of Object.entries(pack.skin?.objects || {})) {
    if (!OBJECT_KINDS.includes(kind)) fail("skin", `$.skin.objects.${kind}`, `unknown object kind; use ${OBJECT_KINDS.join(", ")}`);
    if (typeof ref !== "string") continue;
    if (/^[a-z]+:\/\//i.test(ref) || ref.startsWith("//")) fail("skin", `$.skin.objects.${kind}`, "remote URLs are not allowed");
    else if (ref !== `builtin:${kind}` && !assets.has(ref))
      fail("rights", `$.skin.objects.${kind}`, `"${ref}" must be builtin:${kind} or an asset listed in rights.assets`);
  }

  // Quest types.
  (pack.questTypes || []).forEach((q, i) => {
    if (q?.template && !QUEST_TEMPLATE_IDS.includes(q.template))
      fail("quest-types", `$.questTypes[${i}].template`, `"${q.template}" is not a registered quest template (${QUEST_TEMPLATE_IDS.join(", ")})`);
  });

  // Actors.
  (pack.actors || []).forEach((a, i) => {
    const p = `$.actors[${i}]`;
    if (a?.archetype && !ARCHETYPES.includes(a.archetype))
      fail("actors", `${p}.archetype`, `"${a.archetype}" is not an archetype in server/actors/definitions.mjs`);
    if (typeof a?.model === "string" && !ACTOR_MODELS.includes(a.model) && !a.model.startsWith(`${pack.id}/`))
      fail("actors", `${p}.model`, `"${a.model}" is neither a shared actor model nor in the ${pack.id}/ namespace`);
    if (typeof a?.persona === "string") {
      const [ns, id] = a.persona.split("/");
      const known = personaIds(ns);
      if (known ? !known.has(id) : ns !== pack.id)
        fail("actors", `${p}.persona`, `persona "${a.persona}" is not a reviewed card`);
    }
    if (a?.density === "1-per-city" && !NPC_ARCHETYPES.includes(a.archetype))
      fail("actors", `${p}.density`, "only NPCs can be one per city");
  });

  // Economy.
  const editions = pack.rewards?.editions || [];
  const seen = new Set();
  editions.forEach((e, i) => {
    if (seen.has(e?.id)) fail("economy", `$.rewards.editions[${i}].id`, `duplicate edition ${e.id}`);
    seen.add(e?.id);
  });
  if (editions.length)
    warnings.push("Editions are claimable only after the collectibles contract lists them in supported_editions.");
  if (pack.kind !== "official" && editions.length)
    fail("economy", "$.rewards.editions", "community and private packs cannot define editions");

  // Rules.
  const cities = pack.rules?.cities || [];
  if (cities.includes("*") && cities.length > 1) fail("schema", "$.rules.cities", '"*" must stand alone');
  if (pack.kind === "private" && cities.includes("*"))
    fail("rules", "$.rules.cities", "private worlds must name their cities");
  if (pack.id === DEFAULT_LAYER_ID && pack.rules?.minLevel !== 1)
    fail("rules", "$.rules.minLevel", "the default layer must be open to level 1");

  return { ok: failures.length === 0, id: pack.id, failures, warnings };
}

export function validateWorldPackFile(rel) {
  const text = read(rel);
  let pack;
  try {
    pack = JSON.parse(text);
  } catch (e) {
    return { file: rel, ok: false, id: null, failures: [{ rule: "schema", path: "$", reason: `invalid JSON: ${e.message}` }], warnings: [] };
  }
  return { file: rel, ...validateWorldPack(pack, { bytes: Buffer.byteLength(text) }) };
}
