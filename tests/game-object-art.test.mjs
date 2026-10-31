import test from "node:test";
import assert from "node:assert/strict";
import {
  GAME_OBJECT_GRID,
  GAME_OBJECT_KINDS,
  GAME_OBJECT_STATES,
  gameObjectRects,
  rasterizeGameObject,
  drawGameObject,
  questObjectPresentation,
  zoneObjectPresentation,
  representativeZoneQuest,
} from "../src/game-object-art-data.ts";

test("every authored state remains inside its declared pixel grid, with transparent binary-alpha output", () => {
  for (const kind of GAME_OBJECT_KINDS)
    for (const state of GAME_OBJECT_STATES)
      for (const selected of [false, true]) {
        const options = { kind, state, selected },
          rects = gameObjectRects(options),
          image = rasterizeGameObject(options);
        assert.equal(image.width, GAME_OBJECT_GRID);
        assert.equal(image.height, GAME_OBJECT_GRID);
        assert.equal(image.data.length, 32 * 32 * 4);
        for (const r of rects) {
          assert.ok([r.x, r.y, r.width, r.height].every(Number.isInteger));
          assert.ok(
            r.x >= 0 &&
              r.y >= 0 &&
              r.width > 0 &&
              r.height > 0 &&
              r.x + r.width <= 32 &&
              r.y + r.height <= 32,
          );
          assert.match(r.color, /^#[A-Fa-f0-9]{6}$/);
        }
        const alpha = Array.from(image.data).filter((_, i) => i % 4 === 3);
        assert.ok(alpha.includes(0));
        assert.ok(alpha.includes(255));
        assert.ok(alpha.every((a) => a === 0 || a === 255));
      }
});
test("coin, chest, compass, route and place have distinct silhouettes without relying on colour", () => {
  const masks = GAME_OBJECT_KINDS.map((kind) =>
    Buffer.from(
      rasterizeGameObject({ kind }).data.filter((_, i) => i % 4 === 3),
    ).toString("base64"),
  );
  assert.equal(new Set(masks).size, GAME_OBJECT_KINDS.length);
  for (const kind of GAME_OBJECT_KINDS) {
    const image = (state) =>
      Buffer.from(rasterizeGameObject({ kind, state }).data);
    assert.notDeepEqual(image("completed"), image("ready"));
    assert.notDeepEqual(image("locked"), image("ready"));
    assert.notDeepEqual(image("completed"), image("locked"));
  }
  assert.notDeepEqual(
    rasterizeGameObject({ kind: "chest" }).data,
    rasterizeGameObject({ kind: "chest", state: "open" }).data,
  );
});
test("canvas adapter and raster renderer paint the same bytes with exact nearest-neighbour scale", () => {
  for (const scale of [1, 2, 3]) {
    const width = 32 * scale,
      painted = new Uint8Array(width * width * 4);
    const context = {
      fillStyle: "",
      imageSmoothingEnabled: true,
      clearRect() {
        painted.fill(0);
      },
      fillRect(x, y, w, h) {
        const hex = this.fillStyle;
        const rgba = [1, 3, 5]
          .map((i) => parseInt(hex.slice(i, i + 2), 16))
          .concat(255);
        for (let yy = y; yy < y + h; yy++)
          for (let xx = x; xx < x + w; xx++)
            painted.set(rgba, 4 * (yy * width + xx));
      },
    };
    drawGameObject(context, { kind: "coin", selected: true }, scale);
    assert.equal(context.imageSmoothingEnabled, false);
    assert.deepEqual(
      painted,
      rasterizeGameObject({ kind: "coin", selected: true }, scale).data,
    );
    const base = rasterizeGameObject({ kind: "coin", selected: true }).data;
    for (let y = 0; y < width; y++)
      for (let x = 0; x < width; x++)
        assert.deepEqual(
          painted.slice(4 * (y * width + x), 4 * (y * width + x) + 4),
          base.slice(
            4 * (Math.floor(y / scale) * 32 + Math.floor(x / scale)),
            4 * (Math.floor(y / scale) * 32 + Math.floor(x / scale)) + 4,
          ),
        );
  }
  for (const scale of [0, -1, 1.5, 9, NaN])
    assert.throws(() => rasterizeGameObject({ kind: "coin" }, scale));
});
const now = 100000;
const quest = (patch = {}) => ({
  id: "world:quest:one",
  zone_id: "world:zone:one",
  title: "Riverbank discovery",
  kind: "visit",
  completed: 0,
  tier: 1,
  opens_at: now - 1000,
  closes_at: now + 1000,
  ...patch,
});
const zone = (patch = {}) => ({
  id: "world:zone:one",
  tier: 1,
  opensAt: now - 1000,
  closesAt: now + 1000,
  ...patch,
});
const context = { now, playerTier: 1 };
test("chest art requires known current item availability or confirmed personal completion", () => {
  for (const itemAvailable of [undefined, false])
    assert.equal(
      questObjectPresentation(quest({ kind: "chest", itemAvailable }), context)
        .kind,
      "place",
    );
  assert.equal(
    questObjectPresentation(
      quest({ kind: "chest", itemAvailable: true }),
      context,
    ).kind,
    "chest",
  );
  const visited = questObjectPresentation(
    quest({ kind: "chest", itemAvailable: false, completed: 1 }),
    context,
  );
  assert.equal(visited.kind, "chest");
  assert.equal(visited.state, "completed");
  assert.doesNotMatch(visited.label, /item awarded|reward received/i);
});
test("tier/window locks and completed visits remain distinct from somebody else's shared prize claim", () => {
  assert.equal(
    questObjectPresentation(quest({ claimant: "someone-else" }), context).state,
    "ready",
  );
  assert.equal(
    questObjectPresentation(
      quest({ completed: 1, closes_at: now - 1 }),
      context,
    ).state,
    "completed",
  );
  assert.match(
    questObjectPresentation(quest({ tier: 2 }), context).label,
    /Tier 2/,
  );
  assert.equal(
    questObjectPresentation(quest({ tier: 2 }), { now }).state,
    "ready",
  );
  assert.match(
    questObjectPresentation(quest({ opens_at: now + 1 }), context).label,
    /later/,
  );
  assert.match(
    questObjectPresentation(quest({ closes_at: now }), context).label,
    /ended/,
  );
  assert.equal(
    questObjectPresentation(quest({ opens_at: undefined }), context).state,
    "locked",
  );
});
test("a zone with mixed objectives or missing data does not pretend to be a reward chest", () => {
  assert.equal(zoneObjectPresentation(zone(), [], context).kind, "place");
  const chest = quest({ kind: "chest", itemAvailable: true }),
    walk = quest({ id: "walk", kind: "route" });
  assert.equal(zoneObjectPresentation(zone(), [chest], context).kind, "chest");
  assert.equal(
    zoneObjectPresentation(zone(), [chest, walk], context).kind,
    "route",
  );
  assert.equal(representativeZoneQuest(zone(), [chest, walk], context), walk);
  assert.equal(
    representativeZoneQuest(
      zone(),
      [{ ...chest, completed: 1 }, walk],
      context,
    ),
    walk,
  );
  assert.equal(
    representativeZoneQuest(zone(), [chest, { ...walk, tier: 2 }], context),
    chest,
  );
  assert.equal(representativeZoneQuest(zone(), [], context), undefined);
  assert.equal(
    representativeZoneQuest(
      zone(),
      [quest({ id: "world:quest:one", zone_id: "other-zone" })],
      context,
    ),
    undefined,
  );
  assert.equal(
    zoneObjectPresentation(zone(), [{ ...chest, completed: 1 }, walk], context)
      .kind,
    "route",
  );
  assert.equal(
    zoneObjectPresentation(zone(), [chest, { ...walk, tier: 2 }], context).kind,
    "chest",
  );
  assert.equal(
    questObjectPresentation(quest({ kind: "unsupported-future-kind" }), context)
      .kind,
    "place",
  );
  assert.equal(
    zoneObjectPresentation(zone({ closesAt: now }), [], context).state,
    "locked",
  );
  assert.equal(
    zoneObjectPresentation(
      zone(),
      [
        quest({
          zone_id: "other",
          id: "unrelated",
          kind: "chest",
          itemAvailable: true,
        }),
      ],
      context,
    ).kind,
    "place",
  );
  assert.equal(
    zoneObjectPresentation(
      zone(),
      [
        { ...chest, completed: 1 },
        { ...walk, completed: 1 },
      ],
      context,
    ).state,
    "completed",
  );
  assert.equal(
    zoneObjectPresentation(
      zone(),
      [quest({ tier: 2 }), quest({ id: "second", opens_at: now + 1 })],
      context,
    ).state,
    "locked",
  );
  assert.equal(
    zoneObjectPresentation(zone({ closesAt: now }), [quest()], context).state,
    "locked",
  );
});
