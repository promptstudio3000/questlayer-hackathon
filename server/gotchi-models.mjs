import { createHash } from "node:crypto";
import sharp from "sharp";
import { assert } from "./domain.mjs";
import { optimizeModelTextures } from "./model-textures.mjs";

export const MODEL_CDN = "https://dzqjok0x69zbl.cloudfront.net";
export const STARTER_MODEL = "Eth-Common2-Common-0-0-0-0-0-0-0";
export const MAX_MODEL_BYTES = 6 * 1024 * 1024;
export const MAX_SOURCE_MODEL_BYTES = 12 * 1024 * 1024;
const RENDERER = "https://www.aavegotchi.com/api/renderer/batch";
// A missing look (e.g. an in-game outfit nobody wore before) is asked from the
// official renderer at most once per 15 minutes per look, 40 looks an hour.
const RENDER_RETRY_MS = 15 * 60_000;
const RENDERS_PER_HOUR = 40;
const GRAPH =
  "https://api.goldsky.com/api/public/project_cmh3flagm0001r4p25foufjtt/subgraphs/aavegotchi-core-base/prod/gn";
const COLLATERALS = {
  Eth: ["0x20d3922b4a1a8560e1ac99fba4fade0c849e2142"],
  Aave: [
    "0x823cd4264c1b951c9209ad0deaea9988fe8429bf",
    "0x1d2a0e5ec8e5bbdca5cb219e649b565d8e5c3360",
  ],
  Dai: [
    "0xe0b22e0037b130a9f56bbb537684e6fa18192341",
    "0x27f8d03b3a2196956ed754badc28d73be8830a6e",
  ],
  USDC: [
    "0x1a13f4ca1d028320a707d99520abfefca3998b7f",
    "0x9719d867a500ef117cc201206b8ab51e794d3f82",
  ],
  Link: ["0x98ea609569bd25119707451ef982b90e3eb719cd"],
  USDT: [
    "0xdae5f1590db13e3b40423b5b5c5fbf175515910b",
    "0x60d55f02a771d515e077c9c2403a1ef324885cec",
  ],
  TUSD: ["0xf4b8888427b00d7caf21654408b7cba2ecf4ebd9"],
  Uni: ["0x8c8bdbe9cee455732525086264a4bf9cf821c498"],
  Yfi: ["0xe20f7d1f0ec39c4d5db01f53554f2ef54c71f613"],
  Polygon: ["0x8df3aad3a84da6b69a4da8aec3ea40d9091b2ac4"],
  wEth: ["0x28424507fefb6f7f8e9d3860f56504e4e5f5f390"],
  wBTC: ["0x5c2ed810328349100a66b82b78a1791b101c9d61"],
};
const SPECIAL_EYES = {
  Eth: "ETH",
  Aave: "AAVE",
  Dai: "DAI",
  USDC: "USDC",
  Link: "LINK",
  USDT: "USDT",
  TUSD: "TUSD",
  Uni: "UNI",
  Yfi: "YFI",
  Polygon: "POLYGON",
  wEth: "wETH",
  wBTC: "wBTC",
};
export function deriveGotchiModel(gotchi) {
  const collateral = Object.entries(COLLATERALS).find(([, addresses]) =>
    addresses.includes(String(gotchi.collateral).toLowerCase()),
  )?.[0];
  assert(
    collateral,
    "This collateral does not have a verified renderer mapping.",
    503,
  );
  const traits = gotchi.numericTraits?.map(Number),
    haunt = Number(gotchi.hauntId),
    wearables = gotchi.equippedWearables?.map(Number);
  assert(
    Array.isArray(traits) &&
      traits.length >= 6 &&
      [traits[4], traits[5]].every(
        (v) => Number.isInteger(v) && v >= 0 && v <= 99,
      ) &&
      [1, 2].includes(haunt),
    "Original traits cannot be mapped safely.",
    503,
  );
  assert(
    Array.isArray(wearables) &&
      wearables.length >= 7 &&
      wearables.every((v) => Number.isInteger(v) && v >= 0 && v <= 65535),
    "Original wardrobe is incomplete.",
    503,
  );
  const eye = traits[4],
    color = traits[5];
  const shape =
    eye === 0
      ? `MythicalLow1_H${haunt}`
      : eye === 1
        ? `MythicalLow2_H${haunt}`
        : eye <= 4
          ? "RareLow1"
          : eye <= 6
            ? "RareLow2"
            : eye <= 9
              ? "RareLow3"
              : eye <= 14
                ? "UncommonLow1"
                : eye <= 19
                  ? "UncommonLow2"
                  : eye <= 24
                    ? "UncommonLow3"
                    : eye <= 41
                      ? "Common1"
                      : eye <= 57
                        ? "Common2"
                        : eye <= 74
                          ? "Common3"
                          : eye <= 79
                            ? "UncommonHigh1"
                            : eye <= 84
                              ? "UncommonHigh2"
                              : eye <= 89
                                ? "UncommonHigh3"
                                : eye <= 92
                                  ? "RareHigh1"
                                  : eye <= 94
                                    ? "RareHigh2"
                                    : eye <= 97
                                      ? "RareHigh3"
                                      : SPECIAL_EYES[collateral];
  const eyeColor =
    color <= 1
      ? "Mythical_Low"
      : color <= 9
        ? "Rare_Low"
        : color <= 24
          ? "Uncommon_Low"
          : color <= 74
            ? "Common"
            : color <= 90
              ? "Uncommon_High"
              : color <= 97
                ? "Rare_High"
                : "Mythical_High";
  return {
    hash: [collateral, shape, eyeColor, ...wearables.slice(0, 7)].join("-"),
    complete: wearables.slice(7).every((v) => v === 0),
    // Slot 7 is the original portrait background, not a map character garment.
    mapCompatible: wearables.slice(8).every((v) => v === 0),
    backgroundOmitted: (wearables[7] ?? 0) !== 0,
    wearables: wearables.map(String),
  };
}
export async function readBounded(response, maxBytes) {
  assert(response.ok, "The model source is temporarily unavailable.", 503);
  const declared = Number(response.headers.get("content-length"));
  assert(
    !declared || declared <= maxBytes,
    "This model exceeds the mobile download budget.",
    503,
  );
  const chunks = [];
  let size = 0;
  const reader = response.body.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      assert(
        size <= maxBytes,
        "This model exceeds the mobile download budget.",
        503,
      );
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  }
  return Buffer.concat(chunks, size);
}
export async function inspectGlb(bytes, { source = false } = {}) {
  assert(
    bytes.length >= 28 &&
      bytes.length <= (source ? MAX_SOURCE_MODEL_BYTES : MAX_MODEL_BYTES) &&
      bytes.readUInt32LE(0) === 0x46546c67 &&
      bytes.readUInt32LE(4) === 2 &&
      bytes.readUInt32LE(8) === bytes.length,
    "Invalid GLB container.",
    503,
  );
  const length = bytes.readUInt32LE(12),
    binaryHeader = 20 + length;
  assert(
    length > 0 &&
      length <= 1024 * 1024 &&
      binaryHeader + 8 <= bytes.length &&
      bytes.readUInt32LE(16) === 0x4e4f534a &&
      bytes.readUInt32LE(binaryHeader + 4) === 0x004e4942,
    "Invalid GLB chunks.",
    503,
  );
  const data = JSON.parse(bytes.subarray(20, binaryHeader).toString()),
    bin = bytes.subarray(binaryHeader + 8);
  assert(
    bytes.readUInt32LE(binaryHeader) === bin.length &&
      data.asset?.version === "2.0" &&
      data.buffers?.length === 1 &&
      !data.buffers[0].uri &&
      data.buffers[0].byteLength <= bin.length,
    "External model buffers are not supported.",
    503,
  );
  assert(
    (data.nodes?.length || 0) <= 512 &&
      (data.meshes?.length || 0) <= 120 &&
      (data.materials?.length || 0) <= 64 &&
      (data.images?.length || 0) <= (source ? 64 : 32),
    "This model exceeds the mobile scene budget.",
    503,
  );
  const supported = new Set([
    "KHR_texture_transform",
    "KHR_materials_unlit",
    "KHR_materials_emissive_strength",
    "KHR_materials_ior",
    "KHR_materials_specular",
  ]);
  assert(
    (data.extensionsRequired || []).every((e) => supported.has(e)),
    "This model needs an unsupported decoder.",
    503,
  );
  let vertices = 0;
  for (const mesh of data.meshes || [])
    for (const primitive of mesh.primitives || []) {
      const count = data.accessors?.[primitive.attributes?.POSITION]?.count;
      assert(
        Number.isSafeInteger(count) && count > 0,
        "Invalid model geometry.",
        503,
      );
      vertices += count;
    }
  assert(
    vertices > 0 && vertices <= 500000,
    "This model exceeds the mobile geometry budget.",
    503,
  );
  const textures = [];
  let texturePixels = 0;
  for (const image of data.images || []) {
    assert(
      !image.uri &&
        ["image/png", "image/jpeg"].includes(image.mimeType) &&
        Number.isSafeInteger(image.bufferView),
      "External model images are not supported.",
      503,
    );
    const view = data.bufferViews?.[image.bufferView],
      start = view?.byteOffset || 0;
    assert(
      view?.buffer === 0 &&
        Number.isSafeInteger(start) &&
        start >= 0 &&
        Number.isSafeInteger(view.byteLength) &&
        view.byteLength > 0 &&
        start + view.byteLength <= bin.length,
      "Invalid model texture range.",
      503,
    );
    const meta = await sharp(bin.subarray(start, start + view.byteLength), {
      limitInputPixels: source ? 16777216 : 4194304,
    }).metadata();
    assert(
      meta.width > 0 &&
        meta.height > 0 &&
        meta.width * meta.height <= (source ? 16777216 : 4194304),
      "This texture exceeds the mobile budget.",
      503,
    );
    texturePixels += meta.width * meta.height;
    assert(
      texturePixels <= (source ? 67108864 : 8388608),
      "This model exceeds the total mobile texture budget.",
      503,
    );
    textures.push({
      width: meta.width,
      height: meta.height,
      mimeType: image.mimeType,
    });
  }
  return {
    bytes: bytes.length,
    vertices,
    meshes: data.meshes.length,
    nodes: data.nodes?.length || 0,
    materials: data.materials?.length || 0,
    skins: data.skins?.length || 0,
    textures,
    decodedTextureBytes: texturePixels * 4,
    animations: data.animations?.length || 0,
    embedded: true,
    extensions: data.extensionsUsed || [],
  };
}
export class GotchiModels {
  constructor({
    fetcher = fetch,
    clock = Date.now,
    maxCacheBytes = 24 * 1024 * 1024,
  } = {}) {
    this.fetch = fetcher;
    this.clock = clock;
    this.maxCacheBytes = maxCacheBytes;
    this.sources = new Map();
    this.assets = new Map();
    this.pending = new Map();
    this.renders = new Map();
  }
  /** Asks the official renderer to draw a look it has not drawn yet (bounded, best effort). */
  async requestRender(hash) {
    const now = this.clock();
    for (const [key, at] of this.renders) if (at < now - 3600000) this.renders.delete(key);
    if ((this.renders.get(hash) || 0) > now - RENDER_RETRY_MS) return false;
    if (this.renders.size >= RENDERS_PER_HOUR) return false;
    this.renders.set(hash, now);
    try {
      const r = await this.fetch(RENDERER, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hashes: [hash], renderTypes: ["GLB_3DModel"], force: true, verify: false }),
        signal: AbortSignal.timeout(10000),
      });
      await r.body?.cancel?.().catch?.(() => {});
      return r.ok;
    } catch {
      return false;
    }
  }
  async traits(tokenId) {
    assert(/^\d{1,12}$/.test(tokenId), "Invalid original.");
    const r = await this.fetch(GRAPH, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query:
          "query($ids:[String!]!){aavegotchis(where:{id_in:$ids}){id collateral hauntId numericTraits equippedWearables}}",
        variables: { ids: [tokenId] },
      }),
      signal: AbortSignal.timeout(10000),
    });
    const body = JSON.parse((await readBounded(r, 128 * 1024)).toString()),
      gotchi = body.data?.aavegotchis?.[0];
    assert(gotchi?.id === tokenId, "Original 3D traits are unavailable.", 503);
    return gotchi;
  }
  /**
   * The 3D look: the starter, or an original with its verified gear. An
   * in-game outfit (slot index -> item id over slots 0-6, server/gotchi-outfit.mjs)
   * swaps those slots in the renderer identity.
   */
  async describe({ tokenId = null, expectedWearables, outfit = null } = {}) {
    let source = { hash: STARTER_MODEL, complete: true };
    if (tokenId) {
      const traits = await this.traits(tokenId);
      source = deriveGotchiModel(traits);
      assert(
        Array.isArray(expectedWearables) &&
          expectedWearables.length >= 7 &&
          source.wearables.length === expectedWearables.length &&
          source.wearables.every((v, i) => v === String(expectedWearables[i])),
        "The 3D wardrobe is not yet synchronized with the verified appearance.",
        503,
      );
      if (outfit && Object.keys(outfit).length) {
        const worn = traits.equippedWearables.map(Number);
        for (const [index, id] of Object.entries(outfit)) {
          const i = Number(index);
          if (Number.isInteger(i) && i >= 0 && i <= 6) worn[i] = Number(id) || 0;
        }
        source = deriveGotchiModel({ ...traits, equippedWearables: worn });
      }
    }
    const cached = this.sources.get(source.hash);
    let asset = cached?.until > this.clock() && this.asset(cached.digest);
    if (!asset) {
      if (this.pending.has(source.hash))
        asset = await this.pending.get(source.hash);
      else {
        assert(
          this.pending.size < 3,
          "The dressing room is busy. Please try again shortly.",
          503,
        );
        const task = this.load(source.hash);
        this.pending.set(source.hash, task);
        try {
          asset = await task;
        } finally {
          if (this.pending.get(source.hash) === task)
            this.pending.delete(source.hash);
        }
      }
    }
    return {
      available: true,
      source: tokenId ? "original" : "starter",
      tokenId,
      complete: source.complete,
      mapCompatible: source.mapCompatible ?? true,
      backgroundOmitted: source.backgroundOmitted ?? false,
      src: `/api/character/assets/${asset.digest}.glb`,
      hash: source.hash,
      digest: asset.digest,
      stats: asset.stats,
      optimized: asset.optimized,
      sourceStats: asset.sourceStats,
      sourceDigest: asset.sourceDigest,
      upstream: "https://www.aavegotchi.com/sdk",
    };
  }
  asset(digest) {
    const asset = this.assets.get(digest);
    if (asset) asset.used = this.clock();
    return asset;
  }
  async load(hash) {
    assert(
      /^[A-Za-z0-9_]+(?:-[A-Za-z0-9_]+){9}$/.test(hash),
      "Invalid model identity.",
    );
    const verify = await this.fetch(
      "https://www.aavegotchi.com/api/renderer/batch",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          hashes: [hash],
          renderTypes: ["GLB_3DModel"],
          force: false,
          verify: true,
        }),
        signal: AbortSignal.timeout(10000),
      },
    );
    const response = JSON.parse(
      (await readBounded(verify, 128 * 1024)).toString(),
    );
    if (
      response.data?.results?.find((r) => r.hash === hash)?.availability
        ?.GLB_3DModel?.exists !== true
    ) {
      await this.requestRender(hash);
      assert(
        false,
        "This 3D look has not been rendered yet. It was requested from the Aavegotchi renderer; try again in a few minutes. Your 2D look shows meanwhile.",
        503,
      );
    }
    const url = `${MODEL_CDN}/${hash}/${hash}_GLB.glb`;
    const remote = await this.fetch(url, {
      signal: AbortSignal.timeout(20000),
      redirect: "error",
    });
    const original = await readBounded(remote, MAX_SOURCE_MODEL_BYTES);
    const sourceStats = await inspectGlb(original, { source: true });
    let bytes = original,
      stats,
      optimized = false;
    try {
      stats = await inspectGlb(bytes);
    } catch {
      bytes = await optimizeModelTextures(original);
      stats = await inspectGlb(bytes);
      optimized = true;
    }
    const digest = createHash("sha256").update(bytes).digest("hex");
    const sourceDigest = createHash("sha256").update(original).digest("hex");
    const asset = {
      bytes,
      stats,
      digest,
      sourceStats,
      sourceDigest,
      optimized,
      used: this.clock(),
    };
    if (this.sources.size >= 100) this.sources.clear();
    while (
      this.assets.size &&
      (this.assets.size >= 12 ||
        [...this.assets.values()].reduce((s, a) => s + a.bytes.length, 0) +
          bytes.length >
          this.maxCacheBytes)
    ) {
      const oldest = [...this.assets.entries()].sort(
        (a, b) => a[1].used - b[1].used,
      )[0];
      this.assets.delete(oldest[0]);
    }
    assert(
      bytes.length <= this.maxCacheBytes,
      "Model cache budget is too small.",
      503,
    );
    this.assets.set(digest, asset);
    this.sources.set(hash, { digest, until: this.clock() + 3600000 });
    return asset;
  }
}
