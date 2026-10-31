import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { loadCharacterModel } from "../src/character-model-client.ts";
const bytes = new Uint8Array([1, 3, 5, 7]),
  digest = createHash("sha256").update(bytes).digest("hex");
const descriptor = {
  available: true,
  source: "starter",
  tokenId: null,
  complete: true,
  digest,
  src: `/api/character/assets/${digest}.glb`,
};
test("the map keeps a complete original SVG instead of downloading an incomplete 3D outfit", async (t) => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => {
    calls++;
    return Response.json({
      ...descriptor,
      source: "original",
      tokenId: "6741",
      complete: false,
    });
  });
  await assert.rejects(
    loadCharacterModel("6741", new AbortController().signal, {
      forMap: true,
    }),
    /2D appearance/,
  );
  assert.equal(calls, 1);
});
test("a model descriptor cannot redirect downloads or substitute another original", async (t) => {
  for (const [origin, data] of [
    [undefined, { ...descriptor, src: "https://evil.invalid/model.glb" }],
    [
      undefined,
      { ...descriptor, src: `/api/character/assets/${"a".repeat(64)}.glb` },
    ],
    ["6741", { ...descriptor, source: "original", tokenId: "23" }],
  ]) {
    let calls = 0;
    const mock = t.mock.method(globalThis, "fetch", async () => {
      calls++;
      return Response.json(data);
    });
    await assert.rejects(
      loadCharacterModel(origin, new AbortController().signal),
    );
    assert.equal(calls, 1, "reject before any model download");
    mock.mock.restore();
  }
});
test("model bytes must match the descriptor digest before entering the cache", async (t) => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () =>
    ++calls === 1
      ? Response.json(descriptor)
      : new Response(new Uint8Array([9, 9, 9])),
  );
  await assert.rejects(
    loadCharacterModel(undefined, new AbortController().signal),
    /verified/,
  );
  assert.equal(calls, 2);
});
test("cached downloads still require a fresh authorized appearance response", async (t) => {
  let authorized = true,
    descriptorCalls = 0,
    assetCalls = 0;
  t.mock.method(globalThis, "fetch", async (url) => {
    if (url === "/api/character/model") {
      descriptorCalls++;
      return authorized
        ? Response.json(descriptor)
        : Response.json({ error: "Refresh ownership" }, { status: 403 });
    }
    assetCalls++;
    return new Response(bytes);
  });
  const first = await loadCharacterModel(
    undefined,
    new AbortController().signal,
  );
  new Uint8Array(first.bytes)[0] = 99;
  const second = await loadCharacterModel(
    undefined,
    new AbortController().signal,
  );
  assert.equal(
    new Uint8Array(second.bytes)[0],
    1,
    "callers cannot mutate the verified cached buffer",
  );
  assert.equal(assetCalls, 1);
  authorized = false;
  await assert.rejects(
    loadCharacterModel(undefined, new AbortController().signal),
    /Refresh ownership/,
  );
  assert.equal(descriptorCalls, 3);
  const cancelled = new AbortController();
  cancelled.abort();
  authorized = true;
  await assert.rejects(loadCharacterModel(undefined, cancelled.signal), {
    name: "AbortError",
  });
});
test("the map accepts complete character geometry when only the original portrait background is omitted", async (t) => {
  const sample = new Uint8Array([17, 19, 23]),
    hash = createHash("sha256").update(sample).digest("hex");
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () =>
    ++calls === 1
      ? Response.json({
          ...descriptor,
          source: "original",
          tokenId: "6741",
          complete: false,
          mapCompatible: true,
          backgroundOmitted: true,
          digest: hash,
          src: `/api/character/assets/${hash}.glb`,
        })
      : new Response(sample),
  );
  const result = await loadCharacterModel(
    "6741",
    new AbortController().signal,
    { forMap: true },
  );
  assert.equal(result.descriptor.complete, false);
  assert.equal(result.descriptor.mapCompatible, true);
  assert.equal(calls, 2);
});
