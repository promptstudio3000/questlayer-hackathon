import test from "node:test";
import assert from "node:assert/strict";
import { GotchiItemArt, linkedItemId } from "../server/gotchi-items.mjs";
const svg =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 2 2"><path d="M0 0h2v2H0z"/></svg>';
test("original item artwork requires a fresh positive ownership snapshot, including on cache hits", async () => {
  const now = 1000000,
    valid = {
      verified_at: now,
      data: JSON.stringify({ wearables: [{ itemId: "85", quantity: "1" }] }),
    };
  let reads = 0;
  const cache = new GotchiItemArt({
    read: async () => {
      reads++;
      return svg;
    },
  });
  const art = await cache.get(linkedItemId(valid, "85", now));
  assert.equal(art.toString(), svg);
  for (const [link, id] of [
    [null, "85"],
    [{ ...valid, verified_at: now - 300001 }, "85"],
    [valid, "86"],
    [valid, "085"],
    [valid, "65536"],
    [valid, "https://evil"],
    [
      {
        ...valid,
        data: JSON.stringify({ wearables: [{ itemId: "85", quantity: "0" }] }),
      },
      "85",
    ],
  ]) {
    assert.throws(() => linkedItemId(link, id, now));
  }
  assert.equal(reads, 1);
});
test("original art work deduplicates requested items and bounds queued and active reads", async () => {
  const releases = [];
  let active = 0,
    maxActive = 0;
  const cache = new GotchiItemArt({
    read: () =>
      new Promise((resolve) => {
        active++;
        maxActive = Math.max(active, maxActive);
        releases.push(() => {
          active--;
          resolve(svg);
        });
      }),
  });
  const jobs = Array.from({ length: 24 }, (_, i) => cache.get(String(i + 1)));
  assert.equal(cache.get("1"), jobs[0]);
  assert.throws(() => cache.get("25"), /busy/);
  await new Promise(setImmediate);
  assert.equal(active, 4);
  while (cache.pending.size) {
    releases.splice(0).forEach((release) => release());
    await new Promise(setImmediate);
  }
  await Promise.all(jobs);
  assert.equal(maxActive, 4);
  assert.equal(cache.active, 0);
});
test("original art failures do not poison retries and cache memory remains bounded", async () => {
  let failing = true,
    reads = 0;
  const cache = new GotchiItemArt({
    read: async () => {
      reads++;
      if (failing) throw Error("RPC unavailable");
      return svg;
    },
  });
  await assert.rejects(cache.get("1"), /RPC unavailable/);
  await new Promise(setImmediate);
  failing = false;
  assert.equal((await cache.get("1")).toString(), svg);
  assert.equal(reads, 2);
  const big = new GotchiItemArt({
    read: async () => "<svg>" + " ".repeat(179980) + "</svg>",
  });
  for (let i = 1; i <= 50; i++) await big.get(String(i));
  assert.ok(big.bytes <= 8 * 1024 * 1024);
  const tiny = new GotchiItemArt({ read: async () => svg });
  for (let i = 1; i <= 410; i++) await tiny.get(String(i));
  assert.ok(tiny.cache.size <= 400);
  const huge = new GotchiItemArt({
    read: async () => "<svg>" + " ".repeat(200000) + "</svg>",
  });
  await assert.rejects(huge.get("1"), /unavailable/);
});
