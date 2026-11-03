// Official Gotchiverse 3D models for monsters and guardian stations (docs/NPC-PLAN.md §14, docs/ASSET-CATALOG.md).
//
// The owner confirmed on 1 Nov 2026 that the Aavegotchi developer invitation covers these Gotchiverse characters
// and props. The source repository carries no licence, so no bytes are committed to QuestLayer. The server fetches
// each model on demand from one fixed source (a pinned commit of aavegotchi/GotchiGuardiansInverse), checks it
// against the exact size and SHA-256 recorded below, and keeps a small in-memory cache. Unknown keys, other hosts
// and changed bytes are refused, so this route cannot be turned into an open proxy.
import { createHash } from "node:crypto";

export const UPSTREAM_SOURCE = {
  repository: "aavegotchi/GotchiGuardiansInverse",
  commit: "dc413dd43fb73c2d6b965abf6c818ba3e7e7a186",
  base: "https://raw.githubusercontent.com/aavegotchi/GotchiGuardiansInverse/dc413dd43fb73c2d6b965abf6c818ba3e7e7a186/",
};

/** key → pinned upstream file. Keys are the `upstream:<key>` model names used by src/actor-models.ts. */
export const UPSTREAM_MODELS = Object.freeze({
  "lick-soldier": {
    path: "Assets/PlayableAssets/Lickquidators/_Shared/Meshes/lickquidator_soldier.fbx",
    bytes: 576816,
    sha256: "b92fe4a256b3c6279ede80a9d26f47676a75ef5df6e8429b58ee812db26a0efd",
  },
  "lick-brute": {
    path: "Assets/PlayableAssets/Lickquidators/Meshes/Soldier_base.fbx",
    bytes: 588192,
    sha256: "a7045d2ec6015ca29058639f05647bf2d721ef82889806c314bddb97d03d01ed",
  },
  "lick-speedy": {
    path: "Assets/PlayableAssets/Lickquidators/SpeedyBoi/Meshes/DireTire.fbx",
    bytes: 1056064,
    sha256: "ca6c161c0b543ba81e91d3ebdbf30d184333f44311a32663f063824efaf69a56",
  },
  "lick-turret": {
    path: "Assets/PlayableAssets/Lickquidators/Aerial/Meshes/Laser Beamer.fbx",
    bytes: 130972,
    sha256: "2ebb0a85ebc95bfa78ae70c6efc3917c261f30f26926c2631a85deff5c92e07e",
  },
  "great-portal": {
    path: "Assets/Environment/Meshes/Aavegotchi_Great_Portal.fbx",
    bytes: 162912,
    sha256: "2d325955e48138b79a44379bdb87e2956b88fa3b7d2df83ec51486229b0358d7",
  },
  "golden-altar": {
    path: "Assets/PlayableAssets/Towers/Deprecated/SlowTower/Meshes/Aavegotchi_Golden_Altar.fbx",
    bytes: 354684,
    sha256: "6f2c670d36fa02054dacb0add64a79ce5aadec8d2d4c09ef17cab9f3029276a4",
  },
});

const MAX_BYTES = 2 * 1024 * 1024;

export class UpstreamModels {
  constructor({ fetcher = fetch, timeoutMs = 15000, maxEntries = 8, table = UPSTREAM_MODELS } = {}) {
    this.table = table;
    this.fetch = fetcher;
    this.timeoutMs = timeoutMs;
    this.maxEntries = maxEntries;
    this.cache = new Map();
    this.pending = new Map();
  }
  static has(key) {
    return Object.hasOwn(UPSTREAM_MODELS, key);
  }
  async get(key) {
    if (!Object.hasOwn(this.table, key)) throw Object.assign(Error("Unknown model."), { status: 404 });
    const hit = this.cache.get(key);
    if (hit) {
      this.cache.delete(key);
      this.cache.set(key, hit);
      return hit;
    }
    if (!this.pending.has(key))
      this.pending.set(
        key,
        this.load(key).finally(() => this.pending.delete(key)),
      );
    return this.pending.get(key);
  }
  async load(key) {
    const entry = this.table[key];
    const url = UPSTREAM_SOURCE.base + entry.path.split("/").map(encodeURIComponent).join("/");
    let response;
    try {
      response = await this.fetch(url, { redirect: "error", signal: AbortSignal.timeout(this.timeoutMs) });
    } catch {
      throw Object.assign(Error("The model source is unavailable."), { status: 502 });
    }
    if (!response.ok) throw Object.assign(Error("The model source is unavailable."), { status: 502 });
    const declared = Number(response.headers?.get?.("content-length"));
    if (declared && declared > MAX_BYTES)
      throw Object.assign(Error("The model source changed."), { status: 502 });
    const bytes = Buffer.from(await response.arrayBuffer());
    const digest = createHash("sha256").update(bytes).digest("hex");
    if (bytes.length !== entry.bytes || digest !== entry.sha256)
      throw Object.assign(Error("The model source changed."), { status: 502 });
    const value = { bytes, sha256: digest };
    this.cache.set(key, value);
    while (this.cache.size > this.maxEntries) this.cache.delete(this.cache.keys().next().value);
    return value;
  }
}
