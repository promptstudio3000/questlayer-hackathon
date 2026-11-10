import test from "node:test";
import assert from "node:assert/strict";
import {
  deriveGotchiModel,
  inspectGlb,
  GotchiModels,
  STARTER_MODEL,
  MODEL_CDN,
  readBounded,
} from "../server/gotchi-models.mjs";
function glb(change = () => {}) {
  const json = {
    asset: { version: "2.0" },
    buffers: [{ byteLength: 36 }],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 36 }],
    accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: "VEC3" }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
    nodes: [{ mesh: 0 }],
    scenes: [{ nodes: [0] }],
    scene: 0,
  };
  change(json);
  let text = JSON.stringify(json);
  text += " ".repeat((4 - (text.length % 4)) % 4);
  const body = Buffer.from(text),
    bytes = Buffer.alloc(28 + body.length + 36);
  bytes.writeUInt32LE(0x46546c67, 0);
  bytes.writeUInt32LE(2, 4);
  bytes.writeUInt32LE(bytes.length, 8);
  bytes.writeUInt32LE(body.length, 12);
  bytes.writeUInt32LE(0x4e4f534a, 16);
  body.copy(bytes, 20);
  bytes.writeUInt32LE(36, 20 + body.length);
  bytes.writeUInt32LE(0x004e4942, 24 + body.length);
  return bytes;
}
const original = {
  id: "1",
  collateral: "0x20d3922b4a1a8560e1ac99fba4fade0c849e2142",
  hauntId: "1",
  numericTraits: [50, 50, 50, 50, 45, 50],
  equippedWearables: Array(16).fill("0"),
};
test("renderer identity preserves the documented right/left ordering and fails closed on unknown traits", () => {
  assert.equal(deriveGotchiModel(original).hash, STARTER_MODEL);
  const wearables = Array(16).fill("0");
  wearables[4] = "21";
  wearables[5] = "42";
  wearables[7] = "99";
  const result = deriveGotchiModel({
    ...original,
    equippedWearables: wearables,
  });
  assert.ok(result.hash.endsWith("-0-0-0-0-21-42-0"));
  assert.equal(result.complete, false);
  assert.equal(result.mapCompatible, true);
  assert.equal(result.backgroundOmitted, true);
  const unknownSlot = deriveGotchiModel({
    ...original,
    equippedWearables: wearables.with(8, "100"),
  });
  assert.equal(
    unknownSlot.mapCompatible,
    false,
    "only the documented portrait background may be omitted on a map",
  );
  assert.throws(() =>
    deriveGotchiModel({ ...original, collateral: "unknown" }),
  );
  assert.throws(() =>
    deriveGotchiModel({ ...original, numericTraits: [0, 0, 0, 0, 100, 0] }),
  );
  assert.throws(() =>
    deriveGotchiModel({ ...original, equippedWearables: [0] }),
  );
  for (const [eye, name] of [
    [0, "MythicalLow1_H1"],
    [1, "MythicalLow2_H1"],
    [4, "RareLow1"],
    [57, "Common2"],
    [74, "Common3"],
    [97, "RareHigh3"],
    [99, "ETH"],
  ])
    assert.ok(
      deriveGotchiModel({
        ...original,
        numericTraits: [0, 0, 0, 0, eye, 50],
      }).hash.includes(`-${name}-`),
    );
});
test("mobile GLB validation rejects remote dependencies, unsupported decoders, excessive geometry and damaged containers", async () => {
  const valid = await inspectGlb(glb());
  assert.equal(valid.vertices, 3);
  assert.equal(valid.embedded, true);
  for (const change of [
    (j) => (j.buffers[0].uri = "https://tracker.invalid/model.bin"),
    (j) =>
      (j.images = [
        { uri: "https://tracker.invalid/texture.png", mimeType: "image/png" },
      ]),
    (j) => (j.extensionsRequired = ["KHR_draco_mesh_compression"]),
    (j) => (j.accessors[0].count = 600000),
  ])
    await assert.rejects(inspectGlb(glb(change)));
  const broken = glb();
  broken.writeUInt32LE(99, 8);
  await assert.rejects(inspectGlb(broken));
  await assert.rejects(
    readBounded(new Response(new Uint8Array(10)), 9),
    /budget/,
  );
});
test("on-demand assets coalesce, remain bounded, use only the fixed CDN and never request a forced render", async () => {
  const bytes = glb(),
    calls = [];
  const fetcher = async (url, options) => {
    calls.push(String(url));
    if (String(url).includes("renderer/batch")) {
      const request = JSON.parse(options.body);
      assert.equal(request.verify, true);
      assert.equal(request.force, false);
      await new Promise((r) => setTimeout(r, 5));
      return Response.json({
        data: {
          results: [
            {
              hash: request.hashes[0],
              availability: { GLB_3DModel: { exists: true } },
            },
          ],
        },
      });
    }
    assert.equal(
      String(url),
      `${MODEL_CDN}/${STARTER_MODEL}/${STARTER_MODEL}_GLB.glb`,
    );
    assert.equal(options.redirect, "error");
    return new Response(bytes);
  };
  const models = new GotchiModels({ fetcher, maxCacheBytes: bytes.length });
  const [a, b] = await Promise.all([models.describe(), models.describe()]);
  assert.equal(a.digest, b.digest);
  assert.equal(calls.length, 2);
  assert.equal(a.source, "starter");
  assert.ok(models.asset(a.digest));
  assert.equal((await models.describe()).digest, a.digest);
  assert.equal(calls.length, 2);
  assert.equal(models.asset("unknown"), undefined);
  models.sources.clear();
  await models.describe();
  assert.equal(models.assets.size, 1);
});
test("an original uses verified wardrobe expectations and cannot silently fall back to a generic model", async () => {
  let assetCalls = 0;
  const fetcher = async (url, options) => {
    if (String(url).includes("goldsky"))
      return Response.json({ data: { aavegotchis: [original] } });
    assetCalls++;
    return Response.json({
      data: {
        results: [
          {
            hash: STARTER_MODEL,
            availability: { GLB_3DModel: { exists: false } },
          },
        ],
      },
    });
  };
  const models = new GotchiModels({ fetcher });
  const changed = Array(16).fill("0");
  changed[4] = "12";
  await assert.rejects(
    models.describe({ tokenId: "1", expectedWearables: changed }),
    /synchronized/,
  );
  assert.equal(assetCalls, 0);
  await assert.rejects(
    models.describe({
      tokenId: "1",
      expectedWearables: original.equippedWearables,
    }),
    /not been rendered/,
  );
  assert.equal(models.pending.size, 0);
  assert.equal(models.assets.size, 0);
});

test("serial texture optimization reduces mobile memory while preserving geometry and texture coordinates", async () => {
  const [
    { Document, NodeIO, Accessor },
    { default: sharp },
    { optimizeModelTextures },
  ] = await Promise.all([
    import("@gltf-transform/core"),
    import("sharp"),
    import("../server/model-textures.mjs"),
  ]);
  const doc = new Document(),
    buffer = doc.createBuffer();
  const positions = doc
    .createAccessor()
    .setType(Accessor.Type.VEC3)
    .setArray(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]))
    .setBuffer(buffer);
  const uv = doc
    .createAccessor()
    .setType(Accessor.Type.VEC2)
    .setArray(new Float32Array([0, 0, 1, 0, 0, 1]))
    .setBuffer(buffer);
  const image = await sharp({
    create: { width: 2048, height: 2048, channels: 3, background: "#ccb8ef" },
  })
    .jpeg()
    .toBuffer();
  const texture = doc.createTexture().setImage(image).setMimeType("image/jpeg");
  const material = doc.createMaterial().setBaseColorTexture(texture);
  const primitive = doc
    .createPrimitive()
    .setAttribute("POSITION", positions)
    .setAttribute("TEXCOORD_0", uv)
    .setMaterial(material);
  doc
    .createScene()
    .addChild(
      doc.createNode().setMesh(doc.createMesh().addPrimitive(primitive)),
    );
  const io = new NodeIO(),
    input = Buffer.from(await io.writeBinary(doc));
  const output = await optimizeModelTextures(input),
    stats = await inspectGlb(output),
    roundtrip = await io.readBinary(output);
  assert.equal(stats.textures[0].width, 512);
  assert.equal(stats.textures[0].height, 512);
  assert.equal(stats.decodedTextureBytes, 512 * 512 * 4);
  assert.equal(stats.vertices, 3);
  assert.equal(stats.meshes, 1);
  assert.deepEqual(
    [
      ...roundtrip
        .getRoot()
        .listMeshes()[0]
        .listPrimitives()[0]
        .getAttribute("TEXCOORD_0")
        .getArray(),
    ],
    [0, 0, 1, 0, 0, 1],
  );
  assert.ok(output.length < input.length);
});

test("an in-game outfit swaps slots 0-6 in the renderer look and a missing look is requested once", async () => {
  const verified = [];
  const kicks = [];
  let now = 1_000_000;
  const fetcher = async (url, options) => {
    if (String(url).includes("goldsky")) return Response.json({ data: { aavegotchis: [original] } });
    const body = JSON.parse(options.body);
    if (body.force) {
      kicks.push(body.hashes[0]);
      return Response.json({ data: {} });
    }
    verified.push(body.hashes[0]);
    return Response.json({
      data: { results: [{ hash: body.hashes[0], availability: { GLB_3DModel: { exists: false } } }] },
    });
  };
  const models = new GotchiModels({ fetcher, clock: () => now });
  const ask = () =>
    models.describe({ tokenId: "1", expectedWearables: original.equippedWearables, outfit: { 3: 77, 6: 0 } });
  await assert.rejects(ask(), /requested from the Aavegotchi renderer/);
  const plain = deriveGotchiModel(original).hash.split("-");
  const dressed = verified[0].split("-");
  assert.equal(dressed[6], "77");
  assert.equal(dressed[9], "0");
  assert.deepEqual(dressed.slice(0, 6), plain.slice(0, 6));
  assert.deepEqual(kicks, [verified[0]]);
  await assert.rejects(ask(), /not been rendered/);
  assert.equal(kicks.length, 1);
  now += 16 * 60_000;
  await assert.rejects(ask(), /not been rendered/);
  assert.equal(kicks.length, 2);
});
