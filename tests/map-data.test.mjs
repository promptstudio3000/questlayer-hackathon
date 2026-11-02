import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { latLngToCell, cellToLatLng } from "h3-js";
import { openDatabase } from "../server/database.mjs";
import {
  ensureWorld,
  worldView,
  retryStreetWorlds,
  expireWorlds,
} from "../server/world.mjs";
import { localDateBounds } from "../server/spatial/calendar.mjs";
import { publicPathSnapshot } from "../server/spatial/map-data.mjs";
import { DAY } from "../server/domain.mjs";

const NOW = Date.parse("2026-11-01T12:00:00Z");
const region = latLngToCell(50.08, 14.42, 7);
const [lat, lng] = cellToLatLng(region),
  location = { lat, lng };
const payload = {
  elements: [
    {
      type: "way",
      id: 1,
      tags: { highway: "footway" },
      geometry: [
        { lat, lon: lng },
        { lat: lat + 0.002, lon: lng },
      ],
    },
  ],
};
const ok = () =>
  new Response(JSON.stringify(payload), {
    headers: { "content-type": "application/json" },
  });
const treasury = (db) =>
  db.prepare("SELECT * FROM treasury ORDER BY bucket").all();

test("a delayed first map response across local midnight never materializes an already expired world", async () => {
  const db = openDatabase(":memory:");
  try {
    const time = localDateBounds("2026-11-01", "Europe/Prague").endsAt - 5;
    const world = await ensureWorld(db, location, false, time, {
      mapData: {
        fetcher: async () => {
          await new Promise((r) => setTimeout(r, 15));
          return ok();
        },
      },
    });
    assert.equal(world.day, "2026-11-02");
    assert.equal(db.prepare("SELECT count(*) n FROM worlds").get().n, 1);
    assert.equal(db.prepare("SELECT day FROM worlds").get().day, "2026-11-02");
  } finally {
    db.close();
  }
});

test("the bounded street worker recovers without another API visit and cannot revive an expired allocation", async () => {
  const db = openDatabase(":memory:");
  try {
    const world = await ensureWorld(db, location, false, NOW, {
      mapData: {
        fetcher: async () => {
          throw Error("offline");
        },
      },
    });
    await retryStreetWorlds(db, {
      clock: () => world.pathData.retryAt + 1,
      mapData: { fetcher: async () => ok() },
    });
    assert.ok(worldView(db, world.id).coins.length > 0);
    const funded = treasury(db);
    await retryStreetWorlds(db, {
      clock: () => world.pathData.retryAt + 2,
      mapData: {
        fetcher: async () => {
          throw Error("unexpected fetch");
        },
      },
    });
    assert.deepEqual(treasury(db), funded);
    assert.equal(db.prepare("SELECT count(*) n FROM worlds").get().n, 1);
  } finally {
    db.close();
  }
  const late = openDatabase(":memory:");
  try {
    const empty = await ensureWorld(late, location, false, NOW, {
      mapData: {
        fetcher: async () => {
          throw Error("offline");
        },
      },
    });
    const before = treasury(late);
    await ensureWorld(late, location, false, empty.pathData.retryAt + 1, {
      mapData: {
        fetcher: async () => {
          expireWorlds(late, empty.endsAt + 1);
          return ok();
        },
      },
    });
    assert.deepEqual(treasury(late), before);
    assert.equal(worldView(late, empty.id).coins.length, 0);
  } finally {
    late.close();
  }
});

test("map misses share one bounded request, cache fixed cell bounds and never use a visitor's exact location", async () => {
  const db = openDatabase(":memory:");
  try {
    let calls = 0,
      url;
    const fetcher = async (u) => {
      calls++;
      url = u;
      await new Promise((r) => setTimeout(r, 5));
      return ok();
    };
    const views = await Promise.all(
      Array.from({ length: 5 }, () =>
        publicPathSnapshot(db, region, { clock: () => NOW, fetcher }),
      ),
    );
    assert.equal(calls, 1);
    assert.ok(views.every((v) => v.status === "fresh" && v.paths.length === 1));
    assert.match(new URL(url).searchParams.get("data"), /out tags geom 150/);
    assert.equal(
      (
        await publicPathSnapshot(db, region, {
          clock: () => NOW + 100,
          fetcher,
        })
      ).status,
      "cached",
    );
    assert.equal(calls, 1);
  } finally {
    db.close();
  }
});

test("a map outage creates a usable empty world; concurrent recovery materializes one finite set without another allocation", async () => {
  const db = openDatabase(":memory:");
  try {
    let fail = true,
      calls = 0;
    const mapData = {
      fetcher: async () => {
        calls++;
        if (fail) throw Error("private upstream details");
        return ok();
      },
    };
    const before = treasury(db);
    const empty = await ensureWorld(db, location, false, NOW, { mapData });
    assert.equal(empty.coverage, "unavailable");
    assert.equal(empty.pathData.materialized, false);
    assert.equal(worldView(db, empty.id).coins.length, 0);
    assert.deepEqual(treasury(db), before);
    await ensureWorld(db, location, false, NOW + 1, { mapData });
    assert.equal(calls, 1);
    fail = false;
    const worlds = await Promise.all(
      Array.from({ length: 4 }, () =>
        ensureWorld(db, location, false, empty.pathData.retryAt + 1, {
          mapData,
        }),
      ),
    );
    assert.ok(
      worlds.every((w) => w.id === empty.id && w.pathData.materialized),
    );
    const coins = worldView(db, empty.id).coins;
    assert.ok(coins.length > 0 && coins.length <= 350);
    assert.ok(coins.every((p) => latLngToCell(p.lat, p.lng, 7) === region));
    const funded = treasury(db);
    await ensureWorld(db, location, false, NOW + 60000, { mapData });
    assert.deepEqual(treasury(db), funded);
    assert.equal(worldView(db, empty.id).coins.length, coins.length);
    for (const bucket of funded) {
      const old = before.find((b) => b.bucket === bucket.bucket);
      assert.equal(
        bucket.available_u + bucket.reserved_u + bucket.paid_u,
        old.available_u + old.reserved_u + old.paid_u,
      );
    }
  } finally {
    db.close();
  }
});

test("durable retry deadlines survive a database reopen and stale snapshots never become fake fresh data", async () => {
  const dir = mkdtempSync(join(tmpdir(), "questlayer-map-cache-")),
    path = join(dir, "qa.sqlite");
  let db;
  try {
    db = openDatabase(path);
    await publicPathSnapshot(db, region, {
      clock: () => NOW,
      fetcher: async () => ok(),
    });
    const stale = await publicPathSnapshot(db, region, {
      clock: () => NOW + 8 * DAY,
      fetcher: async () => {
        throw Error("unavailable");
      },
    });
    assert.equal(stale.status, "stale");
    assert.equal(stale.observedAt, NOW);
    db.close();
    db = openDatabase(path);
    let calls = 0;
    const cached = await publicPathSnapshot(db, region, {
      clock: () => NOW + 8 * DAY + 1,
      fetcher: async () => {
        calls++;
        return ok();
      },
    });
    assert.equal(cached.status, "stale");
    assert.equal(calls, 0);
    const expired = await publicPathSnapshot(db, region, {
      clock: () => NOW + 15 * DAY,
      fetcher: async () => {
        throw Error("still down");
      },
    });
    assert.equal(expired.status, "unavailable");
    assert.deepEqual(expired.paths, []);
  } finally {
    db?.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("hung, malformed, denied and oversized map responses fail boundedly without leaking upstream errors", async () => {
  const providers = [
    () => new Promise(() => {}),
    async () => new Response("not json"),
    async () => new Response("{}", { status: 503 }),
    async () =>
      new Response("{}", { headers: { "content-length": "3000000" } }),
  ];
  for (const fetcher of providers) {
    const db = openDatabase(":memory:");
    try {
      const r = await publicPathSnapshot(db, region, {
        clock: () => NOW,
        fetcher,
        timeoutMs: 5,
      });
      assert.equal(r.status, "unavailable");
      assert.ok(r.retryAt > NOW);
      assert.doesNotMatch(JSON.stringify(r), /private|upstream|https:/);
    } finally {
      db.close();
    }
  }
  const db = openDatabase(":memory:");
  try {
    const denied = structuredClone(payload);
    denied.elements[0].tags.access = "private";
    const r = await publicPathSnapshot(db, region, {
      clock: () => NOW,
      fetcher: async () => new Response(JSON.stringify(denied)),
    });
    assert.deepEqual(r.paths, []);
    assert.equal(r.status, "fresh");
  } finally {
    db.close();
  }
});

test("a slow provider never holds the request, and its late answer is cached for the retry", async () => {
  const db = openDatabase(":memory:");
  try {
    let calls = 0;
    const fetcher = async () => {
      calls++;
      await new Promise((r) => setTimeout(r, 40));
      return ok();
    };
    const first = await publicPathSnapshot(db, region, {
      clock: () => NOW,
      fetcher,
      timeoutMs: 5,
      offline: null,
    });
    assert.equal(first.status, "unavailable");
    await new Promise((r) => setTimeout(r, 80));
    const later = await publicPathSnapshot(db, region, {
      clock: () => NOW + 10 * 60 * 1000,
      fetcher,
      timeoutMs: 5,
      offline: null,
    });
    assert.equal(later.status, "cached");
    assert.equal(later.paths.length, 1);
    assert.equal(calls, 1);
  } finally {
    db.close();
  }
});

test("the provider fallback sends a contact User-Agent", async () => {
  const db = openDatabase(":memory:");
  try {
    let agent = null;
    await publicPathSnapshot(db, region, {
      clock: () => NOW,
      offline: null,
      fetcher: async (_url, init) => {
        agent = init.headers["User-Agent"];
        return ok();
      },
    });
    assert.match(agent, /^QuestLayer\/1\.0 \(\+https:\/\//);
  } finally {
    db.close();
  }
});
