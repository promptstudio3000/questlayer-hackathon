// World layer registry: server/data/worlds.json lists every WorldPack the
// server knows, the same way server/data/cities.json lists CityPacks.
//
// Status is decided here, not in the pack file:
//   draft    validated, never served (authoring only)
//   preview  validated and loaded, operators and testers only
//   live     visible to players who opt in (the default layer to everyone)
//   retired  kept for receipts and earned items, never served
// Exactly one live official layer is the default; today that is `aavegotchi`,
// the implicit theme of every existing world. Layers never change world ids,
// plan hashes or native manifests, and never create money.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { WORLD_ID, WORLD_STATUSES } from "./schema.mjs";
import { validateWorldPack } from "./validate.mjs";

const PACK_FILE = /^worlds\/[a-z0-9-]{3,32}-v\d{1,3}\.json$/;

function readDataFile(file) {
  return readFileSync(new URL(`../data/${file}`, import.meta.url), "utf8");
}

export function loadWorldRegistry(registry, readPack = readDataFile, validate = validateWorldPack) {
  if (!registry || registry.version !== 1 || !Array.isArray(registry.layers))
    throw Error("World registry must be { version: 1, layers: [...] }.");
  if (!registry.layers.length || registry.layers.length > 32)
    throw Error("World registry needs 1 to 32 layers.");
  const byId = new Map();
  for (const entry of registry.layers) {
    if (!WORLD_ID.test(entry?.id || "")) throw Error(`Invalid layer id ${JSON.stringify(entry?.id)}.`);
    if (byId.has(entry.id)) throw Error(`Duplicate layer ${entry.id}.`);
    if (!WORLD_STATUSES.includes(entry.status))
      throw Error(`Layer ${entry.id} needs status ${WORLD_STATUSES.join(", ")}.`);
    if (!PACK_FILE.test(entry.pack || ""))
      throw Error(`Layer ${entry.id} needs a pack file worlds/<id>-v<n>.json in server/data.`);
    const text = readPack(entry.pack);
    let pack;
    try {
      pack = JSON.parse(text);
    } catch {
      throw Error(`Pack ${entry.pack} is not valid JSON.`);
    }
    if (pack?.id !== entry.id) throw Error(`Pack ${entry.pack} has id ${pack?.id}, expected ${entry.id}.`);
    const report = validate(pack, { bytes: Buffer.byteLength(text), checkFiles: false });
    if (!report.ok)
      throw Error(
        `Pack ${entry.pack} is invalid: ${report.failures.map((f) => `${f.rule} ${f.path} ${f.reason}`).join("; ")}`,
      );
    if (entry.status === "live" && pack.kind === "private")
      throw Error(`Layer ${entry.id} is private and can only be served to its owner, not live.`);
    const hash = createHash("sha256").update(text).digest("hex");
    byId.set(entry.id, Object.freeze({ id: entry.id, status: entry.status, default: entry.default === true, pack, hash }));
  }
  const all = [...byId.values()];
  const defaults = all.filter((e) => e.default);
  if (defaults.length !== 1 || defaults[0].status !== "live" || defaults[0].pack.kind !== "official")
    throw Error("Exactly one live official layer must be the default.");
  const defaultEntry = defaults[0];
  const killed = (entry, env) => {
    const [name] = entry.pack.rules.killSwitch.split("=");
    return env?.[name] === "0";
  };
  return Object.freeze({
    defaultLayer: defaultEntry,
    allLayers: all,
    statusOf: (id) => byId.get(id)?.status || null,
    layerById: (id) => byId.get(id) || null,
    // Live layers players can see. A kill switch hides a layer without a code
    // deploy; the default layer cannot be switched off (it is the base theme).
    liveLayers: (env = process.env) =>
      all.filter((e) => e.status === "live" && (e === defaultEntry || !killed(e, env))),
  });
}

// Public, non-hashed description for API responses.
export function layerSummary(entry) {
  return {
    id: entry.id,
    version: entry.pack.version,
    name: entry.pack.name,
    status: entry.status,
    default: entry.default,
    hash: entry.hash,
  };
}

export const WORLD_REGISTRY = loadWorldRegistry(JSON.parse(readDataFile("worlds.json")));
export const DEFAULT_LAYER = WORLD_REGISTRY.defaultLayer;
