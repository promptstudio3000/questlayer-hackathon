import test from "node:test";
import assert from "node:assert/strict";
import { openDatabase, createPlayer } from "../server/database.mjs";
import { readNearbyPresence, updatePresence } from "../server/presence.mjs";
import { SocialContent } from "../server/social-content.mjs";

const start = Date.parse("2026-10-31T16:00:00Z"),
  place = { lat: 49.7475, lng: 13.3776 };
function fixture() {
  const db = openDatabase(":memory:");
  const viewer = createPlayer(db, "Viewer"),
    first = createPlayer(db, "First"),
    second = createPlayer(db, "Second");
  let now = start,
    session = true;
  for (const person of [first, second])
    updatePresence(
      db,
      person,
      { ...place, enabled: true, renew: true, leaseId: person, arena: true },
      now,
    );
  const social = new SocialContent(db, { clock: () => now });
  let finish, rows;
  const waiting = new Promise((resolve) => {
    finish = resolve;
  });
  const pending = () =>
    readNearbyPresence(db, viewer, place, true, {
      clock: () => now,
      assertSession: () => {
        assert(session, "Session was revoked");
      },
      appearanceReader: async (people) => {
        rows = people;
        await waiting;
        return people.map((p) => ({
          color: p.id === first ? "#111111" : "#222222",
          source: p.id,
        }));
      },
    });
  return {
    db,
    viewer,
    first,
    second,
    social,
    pending,
    finish: () => finish(),
    rows: () => rows,
    time: (value) => {
      now = value;
    },
    revoke: () => {
      session = false;
    },
  };
}

test("a block acknowledged during appearance work removes coordinates in both directions", async () => {
  for (const authorBlocksViewer of [false, true]) {
    const f = fixture();
    try {
      const pending = f.pending();
      assert.equal(f.rows().length, 2);
      f.social.setBlock(
        authorBlocksViewer ? f.first : f.viewer,
        authorBlocksViewer ? f.viewer : f.first,
        true,
      );
      f.finish();
      const result = await pending;
      assert.deepEqual(
        result.players.map((p) => p.id),
        [f.second],
      );
      assert.equal(result.players[0].appearance.source, f.second);
    } finally {
      f.db.close();
    }
  }
});

test("stopped, expired and mode-changed presence cannot escape a late appearance response", async () => {
  for (const change of ["stop", "stale", "expired", "mode"]) {
    const f = fixture();
    try {
      const pending = f.pending();
      if (change === "stop")
        updatePresence(
          f.db,
          f.first,
          { enabled: false, leaseId: f.first },
          start + 1,
        );
      if (change === "stale")
        f.db
          .prepare("UPDATE presence SET updated_at=? WHERE player_id=?")
          .run(start - 30001, f.first);
      if (change === "expired")
        f.db
          .prepare("UPDATE presence SET expires_at=? WHERE player_id=?")
          .run(start, f.first);
      if (change === "mode")
        updatePresence(
          f.db,
          f.first,
          {
            ...place,
            enabled: true,
            renew: true,
            leaseId: "physical",
            arena: false,
          },
          start + 1,
        );
      f.finish();
      const result = await pending;
      assert.deepEqual(
        result.players.map((p) => p.id),
        [f.second],
        change,
      );
      assert.equal(result.players[0].appearance.source, f.second);
    } finally {
      f.db.close();
    }
  }
});

test("clock advancement during appearance lookup removes stale rows even without a cleanup worker", async () => {
  const f = fixture();
  try {
    const pending = f.pending();
    f.time(start + 30001);
    f.finish();
    assert.deepEqual(await pending, { players: [] });
  } finally {
    f.db.close();
  }
});

test("browser session revocation during appearance lookup rejects the entire response", async () => {
  const f = fixture();
  try {
    const pending = f.pending();
    f.revoke();
    f.finish();
    await assert.rejects(pending, /Session was revoked/);
  } finally {
    f.db.close();
  }
});

test("fresh coordinates and names are paired by ID when row order changes; new arrivals need their own appearance read", async () => {
  const f = fixture();
  try {
    const pending = f.pending(),
      originalOrder = f.rows().map((p) => p.id);
    const moved = { lat: place.lat + 0.001, lng: place.lng + 0.001 };
    f.db
      .prepare("UPDATE presence SET lat=?,lng=?,updated_at=? WHERE player_id=?")
      .run(moved.lat, moved.lng, start + 1, f.first);
    f.db
      .prepare("UPDATE players SET name=? WHERE id=?")
      .run("Updated explorer", f.first);
    const newArrival = createPlayer(f.db, "New arrival");
    updatePresence(
      f.db,
      newArrival,
      { ...place, enabled: true, renew: true, leaseId: "new", arena: true },
      start + 1,
    );
    // The helper cannot rely on an accidental SQLite scan order staying stable.
    f.db.exec("PRAGMA reverse_unordered_selects=ON");
    f.finish();
    const result = await pending;
    assert.deepEqual(
      result.players.map((p) => p.id),
      [...originalOrder].reverse(),
    );
    assert(!result.players.some((p) => p.id === newArrival));
    const first = result.players.find((p) => p.id === f.first);
    assert.equal(first.lat, moved.lat);
    assert.equal(first.lng, moved.lng);
    assert.equal(first.name, "Updated explorer");
    assert.equal(first.color, "#111111");
    for (const person of result.players)
      assert.equal(person.appearance.source, person.id);
  } finally {
    f.db.close();
  }
});

test("missing auth and a mismatched appearance result fail closed", async () => {
  const f = fixture();
  try {
    let called = false;
    await assert.rejects(
      readNearbyPresence(f.db, f.viewer, place, true, {
        assertSession: () => {
          throw Error("Missing session");
        },
        appearanceReader: async () => {
          called = true;
          return [];
        },
        clock: () => start,
      }),
      /Missing session/,
    );
    assert.equal(called, false);
    await assert.rejects(
      readNearbyPresence(f.db, f.viewer, place, true, {
        assertSession: () => {},
        appearanceReader: async () => [],
        clock: () => start,
      }),
      /matched/,
    );
  } finally {
    f.db.close();
  }
});
