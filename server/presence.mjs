import { point, assert } from "./domain.mjs";
export function updatePresence(db, player, input, now = Date.now()) {
  const lease = typeof input.leaseId === "string" ? input.leaseId : "legacy";
  assert(/^[a-zA-Z0-9_-]{1,80}$/.test(lease), "Invalid sharing session.");
  db.prepare("DELETE FROM presence_revocations WHERE expires_at<=?").run(now);
  if (!input.enabled) {
    db.prepare(
      "INSERT OR REPLACE INTO presence_revocations(player_id,lease_id,expires_at) VALUES(?,?,?)",
    ).run(player, lease, now + 20 * 60000);
    db.prepare(
      "DELETE FROM presence WHERE player_id=? AND (lease_id=? OR (lease_id='' AND ?='legacy'))",
    ).run(player, lease, lease);
    return { enabled: false };
  }
  if (
    db
      .prepare(
        "SELECT 1 FROM presence_revocations WHERE player_id=? AND lease_id=?",
      )
      .get(player, lease)
  )
    return { enabled: false };
  point(input);
  const old = db
    .prepare("SELECT * FROM presence WHERE player_id=?")
    .get(player);
  if (
    !input.renew &&
    (!old || old.expires_at <= now || old.lease_id !== lease)
  ) {
    db.prepare(
      "DELETE FROM presence WHERE player_id=? AND lease_id=? AND expires_at<=?",
    ).run(player, lease, now);
    return { enabled: false };
  }
  const expiresAt = input.renew ? now + 15 * 60000 : old.expires_at;
  db.prepare(
    "INSERT OR REPLACE INTO presence(player_id,lat,lng,expires_at,updated_at,arena,lease_id) VALUES(?,?,?,?,?,?,?)",
  ).run(
    player,
    input.lat,
    input.lng,
    expiresAt,
    now,
    input.arena !== false ? 1 : 0,
    lease,
  );
  return { enabled: true, expiresAt };
}
export function nearbyPresence(
  db,
  player,
  location,
  arena = true,
  now = Date.now(),
) {
  const { lat, lng } = point(location);
  return db
    .prepare(
      "SELECT p.name,p.id,p.appearance,p.native_outfit,p.native_account,pr.lat,pr.lng FROM presence pr JOIN players p ON p.id=pr.player_id WHERE pr.player_id!=? AND pr.expires_at>? AND pr.updated_at>? AND pr.arena=? AND pr.lat BETWEEN ? AND ? AND pr.lng BETWEEN ? AND ? LIMIT 30",
    )
    .all(
      player,
      now,
      now - 30000,
      arena ? 1 : 0,
      lat - 0.015,
      lat + 0.015,
      lng - 0.02,
      lng + 0.02,
    );
}
