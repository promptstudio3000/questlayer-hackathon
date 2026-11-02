// WorldPack schema `questlayer.worldpack/1` (docs/WORLDS-PLAN.md B.1).
//
// A WorldPack is a theme layer: skin, quest flavour, actors, cosmetic rewards
// and rules on top of the shared place layer (CityPacks, H3 cells). It never
// carries coordinates, money or contract settings. This module checks shape
// only: unknown keys are rejected and every size is bounded. Semantic rules
// (rights, text policy, economy, quest templates, tokens, contrast) live in
// validate.mjs.

export const WORLDPACK_SCHEMA = "questlayer.worldpack/1";
export const WORLD_ID = /^[a-z0-9-]{3,32}$/;
export const RESERVED_WORLD_IDS = Object.freeze(["aavegotchi"]);
export const DEFAULT_LAYER_ID = "aavegotchi";
export const WORLD_KINDS = Object.freeze(["official", "community", "private"]);
export const WORLD_STATUSES = Object.freeze(["draft", "preview", "live", "retired"]);
export const LANGUAGES = Object.freeze(["en", "cs"]);
export const AVATAR_SOURCES = Object.freeze(["aavegotchi-base", "starter-template", "owned-nft"]);
export const DENSITIES = Object.freeze(["1-per-city", "low", "medium", "high"]);
export const EDITION_SLOTS = Object.freeze(["above", "below"]);
export const MAX_PACK_BYTES = 64 * 1024;

const VERSION = /^\d{4}-\d{2}-\d{2}\.\d{1,3}$/;
const HEX = /^#[0-9a-fA-F]{6}$/;
const HOUR = /^([01]\d|2[0-3]):[0-5]\d$/;
const SLUG = /^[a-z0-9][a-z0-9-]{1,39}$/;
const REF = /^[a-z0-9-]{3,32}\/[a-z0-9-]{2,40}$/;
const ASSET_PATH = /^public\/worlds\/[a-z0-9-]{3,32}\/[a-z0-9][a-z0-9._-]{0,63}\.(svg|png|webp|json)$/;
const KILL_SWITCH = /^WORLD_[A-Z0-9_]{3,40}=0$/;
const ACCOUNT = /^[a-z0-9._-]{2,64}$/;

const isObj = (v) => !!v && typeof v === "object" && !Array.isArray(v);
const isStr = (v, max) => typeof v === "string" && v.trim().length > 0 && v.length <= max;

// Collects failures as { rule, path, reason }; never throws.
function checker() {
  const failures = [];
  const fail = (path, reason, rule = "schema") => failures.push({ rule, path, reason });
  const keys = (v, path, allowed, required = allowed) => {
    if (!isObj(v)) return fail(path, "must be an object"), false;
    for (const k of Object.keys(v))
      if (!allowed.includes(k)) fail(`${path}.${k}`, "unknown key");
    for (const k of required) if (!(k in v)) fail(`${path}.${k}`, "is required");
    return true;
  };
  const str = (v, path, max, re) => {
    if (!isStr(v, max)) return fail(path, `must be a non-empty string up to ${max} characters`), false;
    if (re && !re.test(v)) return fail(path, `must match ${re}`), false;
    return true;
  };
  const oneOf = (v, path, list) =>
    list.includes(v) || (fail(path, `must be one of ${list.join(", ")}`), false);
  const arr = (v, path, min, max) => {
    if (!Array.isArray(v) || v.length < min || v.length > max)
      return fail(path, `must be a list of ${min} to ${max} items`), false;
    return true;
  };
  const num = (v, path, min, max, int = false) => {
    if (typeof v !== "number" || !Number.isFinite(v) || v < min || v > max || (int && !Number.isInteger(v)))
      return fail(path, `must be a${int ? "n integer" : " number"} from ${min} to ${max}`), false;
    return true;
  };
  // Localised text: { en, cs } with English required.
  const i18n = (v, path, max) => {
    if (!keys(v, path, LANGUAGES, ["en"])) return;
    for (const lang of Object.keys(v)) if (LANGUAGES.includes(lang)) str(v[lang], `${path}.${lang}`, max);
  };
  return { failures, fail, keys, str, oneOf, arr, num, i18n };
}

export function checkSchema(pack, { bytes } = {}) {
  const c = checker();
  if (bytes !== undefined && bytes > MAX_PACK_BYTES)
    c.fail("$", `pack is ${bytes} bytes, the limit is ${MAX_PACK_BYTES}`);
  const top = [
    "schema", "id", "version", "status", "kind", "owner", "name", "lore", "rights", "skin",
    "poiAffinity", "questTypes", "actors", "rewards", "rules", "provenance",
  ];
  if (!c.keys(pack, "$", top, top.filter((k) => k !== "status"))) return c.failures;
  if (pack.schema !== WORLDPACK_SCHEMA) c.fail("$.schema", `must be ${WORLDPACK_SCHEMA}`);
  c.str(pack.id, "$.id", 32, WORLD_ID);
  c.str(pack.version, "$.version", 16, VERSION);
  if ("status" in pack) c.oneOf(pack.status, "$.status", WORLD_STATUSES);
  c.oneOf(pack.kind, "$.kind", WORLD_KINDS);
  c.str(pack.owner, "$.owner", 64, ACCOUNT);
  c.i18n(pack.name, "$.name", 40);

  if (c.keys(pack.lore, "$.lore", ["en", "cs", "tone", "forbidden"], ["en", "tone", "forbidden"])) {
    for (const lang of LANGUAGES) if (lang in pack.lore) c.str(pack.lore[lang], `$.lore.${lang}`, 600);
    for (const k of ["tone", "forbidden"])
      if (c.arr(pack.lore[k], `$.lore.${k}`, 0, 8))
        pack.lore[k].forEach((t, i) => c.str(t, `$.lore.${k}[${i}]`, 24, /^[a-z][a-z -]*$/));
  }

  const r = pack.rights;
  if (c.keys(r, "$.rights", ["assets", "trademarks", "ownershipSource"])) {
    if (c.arr(r.assets, "$.rights.assets", 0, 64))
      r.assets.forEach((a, i) => {
        const p = `$.rights.assets[${i}]`;
        if (!c.keys(a, p, ["path", "source", "licence", "evidence"], ["path", "source", "licence"])) return;
        c.str(a.path, `${p}.path`, 120, ASSET_PATH);
        c.oneOf(a.source, `${p}.source`, ["original", "third-party", "cc0"]);
        c.str(a.licence, `${p}.licence`, 40);
        if ("evidence" in a) c.str(a.evidence, `${p}.evidence`, 200);
      });
    if (c.arr(r.trademarks, "$.rights.trademarks", 0, 16))
      r.trademarks.forEach((t, i) => {
        const p = `$.rights.trademarks[${i}]`;
        if (!c.keys(t, p, ["mark", "holder", "evidence", "endorsed"], ["mark", "holder", "evidence"])) return;
        c.str(t.mark, `${p}.mark`, 40);
        c.str(t.holder, `${p}.holder`, 80);
        c.str(t.evidence, `${p}.evidence`, 200);
        if ("endorsed" in t && typeof t.endorsed !== "boolean") c.fail(`${p}.endorsed`, "must be true or false");
      });
    const o = r.ownershipSource;
    if (o !== null && c.keys(o, "$.rights.ownershipSource", ["chain", "contract", "mode"])) {
      c.oneOf(o.chain, "$.rights.ownershipSource.chain", ["base", "ethereum", "polygon", "near"]);
      c.str(o.contract, "$.rights.ownershipSource.contract", 80, /^(0x[0-9a-fA-F]{40}|[a-z0-9._-]{2,64})$/);
      c.oneOf(o.mode, "$.rights.ownershipSource.mode", ["read-only-avatar"]);
    }
  }

  const s = pack.skin;
  if (c.keys(s, "$.skin", ["tokens", "objects", "zoneColors", "avatar"])) {
    if (c.keys(s.tokens, "$.skin.tokens", Object.keys(s.tokens || {}), []))
      for (const [k, v] of Object.entries(s.tokens)) {
        if (!/^--[a-z][a-z0-9-]{1,31}$/.test(k)) c.fail(`$.skin.tokens.${k}`, "token key must look like --name");
        if (typeof v !== "string" || !HEX.test(v)) c.fail(`$.skin.tokens.${k}`, "must be a #rrggbb colour");
      }
    if (Object.keys(s.tokens || {}).length > 24) c.fail("$.skin.tokens", "at most 24 token overrides");
    if (c.keys(s.objects, "$.skin.objects", Object.keys(s.objects || {}), []))
      for (const [k, v] of Object.entries(s.objects)) c.str(v, `$.skin.objects.${k}`, 120);
    if (c.keys(s.zoneColors, "$.skin.zoneColors", ["1", "2", "3"]))
      for (const t of ["1", "2", "3"])
        if (typeof s.zoneColors[t] !== "string" || !HEX.test(s.zoneColors[t]))
          c.fail(`$.skin.zoneColors.${t}`, "must be a #rrggbb colour");
    c.oneOf(s.avatar, "$.skin.avatar", AVATAR_SOURCES);
  }

  if (c.keys(pack.poiAffinity, "$.poiAffinity", Object.keys(pack.poiAffinity || {}), [])) {
    const entries = Object.entries(pack.poiAffinity);
    if (entries.length > 32) c.fail("$.poiAffinity", "at most 32 categories");
    for (const [k, v] of entries) {
      if (!/^[a-z][a-z_]{1,31}$/.test(k)) c.fail(`$.poiAffinity.${k}`, "category must be snake_case");
      c.num(v, `$.poiAffinity.${k}`, 0, 3, true);
    }
  }

  if (c.arr(pack.questTypes, "$.questTypes", 1, 12))
    pack.questTypes.forEach((q, i) => {
      const p = `$.questTypes[${i}]`;
      if (!c.keys(q, p, ["template", "flavour", "params"], ["template"])) return;
      c.str(q.template, `${p}.template`, 40, SLUG);
      if ("flavour" in q) c.i18n(q.flavour, `${p}.flavour`, 80);
      if ("params" in q && c.keys(q.params, `${p}.params`, ["stops", "minSpacingM", "maxLengthM"], [])) {
        if ("stops" in q.params) c.num(q.params.stops, `${p}.params.stops`, 2, 6, true);
        if ("minSpacingM" in q.params) c.num(q.params.minSpacingM, `${p}.params.minSpacingM`, 55, 2000, true);
        if ("maxLengthM" in q.params) c.num(q.params.maxLengthM, `${p}.params.maxLengthM`, 100, 4999, true);
      }
    });

  if (c.arr(pack.actors, "$.actors", 0, 24))
    pack.actors.forEach((a, i) => {
      const p = `$.actors[${i}]`;
      if (!c.keys(a, p, ["archetype", "persona", "model", "density"], ["archetype", "density"])) return;
      c.str(a.archetype, `${p}.archetype`, 32, /^[a-z_]+$/);
      if ("persona" in a) c.str(a.persona, `${p}.persona`, 80, REF);
      if ("model" in a) c.str(a.model, `${p}.model`, 80, /^[a-z0-9-]{2,40}(\/[a-z0-9-]{2,40})?$/);
      c.oneOf(a.density, `${p}.density`, DENSITIES);
    });

  const w = pack.rewards;
  if (c.keys(w, "$.rewards", ["xpWeight", "editions", "money"])) {
    c.num(w.xpWeight, "$.rewards.xpWeight", 0, 1);
    if (w.money !== "none") c.fail("$.rewards.money", 'must be "none": layers never create GOLD or NEAR', "economy");
    if (c.arr(w.editions, "$.rewards.editions", 0, 32))
      w.editions.forEach((e, i) => {
        const p = `$.rewards.editions[${i}]`;
        if (!c.keys(e, p, ["id", "supply", "slot"])) return;
        c.str(e.id, `${p}.id`, 40, SLUG);
        c.num(e.supply, `${p}.supply`, 1, 10000, true);
        c.oneOf(e.slot, `${p}.slot`, EDITION_SLOTS);
      });
  }

  const u = pack.rules;
  if (c.keys(u, "$.rules", ["languages", "hours", "minLevel", "cities", "densityCapPerCell", "killSwitch"])) {
    if (c.arr(u.languages, "$.rules.languages", 1, LANGUAGES.length))
      u.languages.forEach((l, i) => c.oneOf(l, `$.rules.languages[${i}]`, LANGUAGES));
    if (c.arr(u.hours, "$.rules.hours", 2, 2)) {
      u.hours.forEach((h, i) => c.str(h, `$.rules.hours[${i}]`, 5, HOUR));
      if (HOUR.test(u.hours[0]) && HOUR.test(u.hours[1]) && u.hours[0] >= u.hours[1])
        c.fail("$.rules.hours", "opening must be before closing on the same day");
    }
    c.num(u.minLevel, "$.rules.minLevel", 1, 10, true);
    if (c.arr(u.cities, "$.rules.cities", 1, 64))
      u.cities.forEach((id, i) => c.str(id, `$.rules.cities[${i}]`, 32, /^(\*|[a-z][a-z0-9-]{1,31})$/));
    c.num(u.densityCapPerCell, "$.rules.densityCapPerCell", 1, 6, true);
    c.str(u.killSwitch, "$.rules.killSwitch", 48, KILL_SWITCH);
  }

  if (c.keys(pack.provenance, "$.provenance", ["authoredBy", "promptHashes"])) {
    if (c.arr(pack.provenance.authoredBy, "$.provenance.authoredBy", 1, 8))
      pack.provenance.authoredBy.forEach((a, i) =>
        c.str(a, `$.provenance.authoredBy[${i}]`, 64, /^(human:[a-z0-9._-]{2,40}|codex|claude|ollama:[a-z0-9.:-]{2,48}|near-ai:[a-z0-9.:/-]{2,48})$/),
      );
    if (c.arr(pack.provenance.promptHashes, "$.provenance.promptHashes", 0, 64))
      pack.provenance.promptHashes.forEach((h, i) => c.str(h, `$.provenance.promptHashes[${i}]`, 64, /^[0-9a-f]{64}$/));
  }
  return c.failures;
}
