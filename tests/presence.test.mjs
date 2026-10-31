import test from "node:test";
import assert from "node:assert/strict";
import { openDatabase, createPlayer } from "../server/database.mjs";
import { updatePresence, nearbyPresence } from "../server/presence.mjs";
const now = Date.parse("2026-10-31T04:00:00Z"),
  position = { lat: 49.7475, lng: 13.3776 };
test("stale cleanup and heartbeat cannot overwrite a newer sharing session or game mode", () => {
  const db = openDatabase(":memory:");
  try {
    const player = createPlayer(db, "Visible explorer");
    updatePresence(
      db,
      player,
      { ...position, enabled: true, renew: true, leaseId: "old", arena: true },
      now,
    );
    updatePresence(
      db,
      player,
      { ...position, enabled: true, renew: true, leaseId: "new", arena: false },
      now + 1,
    );
    updatePresence(db, player, { enabled: false, leaseId: "old" }, now + 2);
    assert.equal(
      db.prepare("SELECT lease_id FROM presence").get().lease_id,
      "new",
    );
    assert.equal(
      updatePresence(
        db,
        player,
        {
          ...position,
          enabled: true,
          renew: false,
          leaseId: "old",
          arena: true,
        },
        now + 3,
      ).enabled,
      false,
    );
    assert.equal(db.prepare("SELECT arena FROM presence").get().arena, 0);
  } finally {
    db.close();
  }
});
test("location heartbeats do not extend consent beyond its original 15 minute window", () => {
  const db = openDatabase(":memory:");
  try {
    const player = createPlayer(db, "Timed explorer");
    const first = updatePresence(
      db,
      player,
      { ...position, enabled: true, renew: true, leaseId: "one" },
      now,
    );
    const later = updatePresence(
      db,
      player,
      { ...position, enabled: true, renew: false, leaseId: "one" },
      now + 600000,
    );
    assert.equal(first.expiresAt, later.expiresAt);
    assert.equal(
      updatePresence(
        db,
        player,
        { ...position, enabled: true, renew: false, leaseId: "one" },
        first.expiresAt,
      ).enabled,
      false,
    );
    assert.equal(db.prepare("SELECT count(*) AS n FROM presence").get().n, 0);
  } finally {
    db.close();
  }
});
test("demo and GPS presence are isolated and stale positions disappear after 30 seconds", () => {
  const db = openDatabase(":memory:");
  try {
    const observer = createPlayer(db, "Observer"),
      demo = createPlayer(db, "Demo"),
      gps = createPlayer(db, "GPS");
    updatePresence(
      db,
      demo,
      { ...position, enabled: true, renew: true, leaseId: "demo", arena: true },
      now,
    );
    updatePresence(
      db,
      gps,
      { ...position, enabled: true, renew: true, leaseId: "gps", arena: false },
      now,
    );
    assert.deepEqual(
      nearbyPresence(db, observer, position, true, now).map((p) => p.id),
      [demo],
    );
    assert.deepEqual(
      nearbyPresence(db, observer, position, false, now).map((p) => p.id),
      [gps],
    );
    assert.equal(
      nearbyPresence(db, observer, position, true, now + 30001).length,
      0,
    );
  } finally {
    db.close();
  }
});

test("stop received before a delayed initial publication permanently revokes that session", () => {
  const db = openDatabase(":memory:");
  try {
    const player = createPlayer(db, "Cancelled explorer");
    updatePresence(db, player, { enabled: false, leaseId: "cancelled" }, now);
    assert.equal(
      updatePresence(
        db,
        player,
        { ...position, enabled: true, renew: true, leaseId: "cancelled" },
        now + 100,
      ).enabled,
      false,
    );
    assert.equal(db.prepare("SELECT count(*) AS n FROM presence").get().n, 0);
    assert.equal(
      updatePresence(
        db,
        player,
        { ...position, enabled: true, renew: true, leaseId: "fresh" },
        now + 200,
      ).enabled,
      true,
    );
    updatePresence(
      db,
      player,
      { enabled: false, leaseId: "cancelled" },
      now + 300,
    );
    assert.equal(
      db.prepare("SELECT lease_id FROM presence").get().lease_id,
      "fresh",
    );
  } finally {
    db.close();
  }
});
