import test from "node:test";
import assert from "node:assert/strict";
import { openDatabase, createPlayer } from "../server/database.mjs";
import { ensureWorld, worldView, HOME } from "../server/world.mjs";
import { claimCoin } from "../server/game.mjs";
import { worldQuery } from "../server/spatial/world-query.mjs";
import { changeSystemPlace } from "../server/spatial/place-safety.mjs";
import { PLZEN } from "../server/spatial/city-pack.mjs";
const NOW = Date.parse("2026-11-02T12:00:00Z");
const treasury = (db) =>
  db.prepare("SELECT * FROM treasury ORDER BY bucket").all();

test("viewport queries preserve city-wide identities/counts and never allocate a second world", async () => {
  const db = openDatabase(":memory:");
  try {
    const player = createPlayer(db, "Viewport explorer", NOW),
      w = await ensureWorld(db, HOME, true, NOW),
      full = worldView(db, w.id, player, { now: NOW }),
      before = treasury(db),
      p = full.coins[0];
    const bounds = [p.lng - 0.001, p.lat - 0.001, p.lng + 0.001, p.lat + 0.001];
    const view = worldView(db, w.id, player, { bounds, limit: 10, now: NOW });
    assert.equal(view.cityZoneCount, 6);
    assert.ok(view.visibleZoneCount <= 6);
    assert.equal(view.openEligibleCount, full.openEligibleCount);
    assert.ok(view.coins.length <= 10);
    assert.ok(
      view.coins.every(
        (c) =>
          c.lng >= bounds[0] &&
          c.lng <= bounds[2] &&
          c.lat >= bounds[1] &&
          c.lat <= bounds[3],
      ),
    );
    assert.ok(
      view.coins.every((c) =>
        full.coins.some((f) => f.id === c.id && f.value_u === c.value_u),
      ),
    );
    const empty = worldView(db, w.id, player, {
      bounds: [0, 0, 0.1, 0.1],
      now: NOW,
    });
    assert.equal(empty.visibleZoneCount, 0);
    assert.equal(empty.cityZoneCount, 6);
    assert.equal(empty.openEligibleCount, full.openEligibleCount);
    assert.deepEqual(treasury(db), before);
    assert.equal(db.prepare("SELECT count(*) n FROM worlds").get().n, 1);
  } finally {
    db.close();
  }
});
test("pagination uses stable shared coin IDs through concurrent claims and overlapping viewports", async () => {
  const db = openDatabase(":memory:");
  try {
    const player = createPlayer(db, "Page explorer", NOW),
      w = await ensureWorld(db, HOME, true, NOW),
      before = treasury(db);
    const first = worldView(db, w.id, player, { limit: 7, now: NOW });
    assert.equal(first.coins.length, 7);
    assert.ok(first.page.nextCursor);
    claimCoin(db, player, first.coins[0].id, first.coins[0], NOW);
    const second = worldView(db, w.id, player, {
      limit: 7,
      cursor: first.page.nextCursor,
      now: NOW,
    });
    assert.equal(second.coins.length, 7);
    assert.ok(
      second.coins.every((c) => !first.coins.some((p) => p.id === c.id)),
    );
    const after = treasury(db);
    assert.equal(
      after[0].reserved_u + after[0].paid_u,
      before[0].reserved_u + before[0].paid_u,
    );
    assert.throws(
      () =>
        worldView(db, w.id, player, {
          bounds: [0, 0, 1, 1],
          cursor: first.page.nextCursor,
        }),
      /another world or viewport/,
    );
    assert.throws(
      () =>
        worldView(db, w.id, player, {
          cursor: Buffer.from(
            JSON.stringify({
              version: 1,
              worldId: "different",
              bounds: null,
              after: "different:coin:1",
            }),
          ).toString("base64url"),
        }),
      /another world or viewport/,
    );
  } finally {
    db.close();
  }
});
test("invalid coordinates, limits and cursor inputs are rejected and normalized query options remain compatible", () => {
  for (const bounds of [
    [0, 0, 0, 1],
    [181, 0, 182, 1],
    [0, -90, 1, 1],
    "x,0,1,1",
    [1, 1, 0, 0],
  ])
    assert.throws(() => worldQuery({ bounds }));
  for (const limit of [0, -1, 1001, 1.1, "1e2", "10000"])
    assert.throws(() => worldQuery({ limit }));
  assert.throws(() => worldQuery({ cursor: "%not-a-cursor" }));
  assert.deepEqual(worldQuery(), {});
  const query = worldQuery({ bounds: "13,49,14,50", limit: "20" });
  assert.deepEqual(worldQuery(query), query);
});
test("operator closures are reflected in visible discovery eligibility without changing the frozen world", async () => {
  const db = openDatabase(":memory:");
  try {
    const w = await ensureWorld(db, HOME, true, NOW),
      initial = worldView(db, w.id, null, { now: NOW }),
      zone = w.zones.find((z) => z.tier === 1);
    changeSystemPlace(
      db,
      PLZEN,
      {
        actor: "qa-operator",
        operationId: "close-map-site",
        candidateId: zone.sourceId,
        action: "close",
        reason: "Temporary access closure",
        expectedVersion: 0,
      },
      { isOperator: () => true, clock: () => NOW },
    );
    const closed = worldView(db, w.id, null, { now: NOW });
    assert.equal(
      closed.zones.find((z) => z.id === zone.id).placeStatus,
      "closed",
    );
    assert.equal(closed.openEligibleCount, initial.openEligibleCount - 1);
    assert.ok(
      closed.quests
        .filter((q) => q.zone_id === zone.id)
        .every((q) => q.placeStatus === "closed"),
    );
  } finally {
    db.close();
  }
});
