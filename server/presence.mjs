import { point, assert } from "./domain.mjs";
import { initSocialBlocks } from "./social-content.mjs";
import { isDemoBot } from "./player-waves.mjs";
export function updatePresence(db, player, input, now = Date.now()) {
  const lease = input.leaseId;
  assert(typeof lease === "string" && /^[a-zA-Z0-9_-]{1,80}$/.test(lease), "Invalid sharing session.");
  db.prepare("DELETE FROM presence_revocations WHERE expires_at<=?").run(now);
  if (!input.enabled) {
    db.prepare(
      "INSERT OR REPLACE INTO presence_revocations(player_id,lease_id,expires_at) VALUES(?,?,?)",
    ).run(player, lease, now + 20 * 60000);
    db.prepare(
      "DELETE FROM presence WHERE player_id=? AND lease_id=?",
    ).run(player, lease);
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
  initSocialBlocks(db);
  return db
    .prepare(
      "SELECT p.name,p.id,p.appearance,p.native_outfit,p.native_account,pr.lat,pr.lng FROM presence pr JOIN players p ON p.id=pr.player_id WHERE pr.player_id!=? AND pr.expires_at>? AND pr.updated_at>? AND pr.arena=? AND pr.lat BETWEEN ? AND ? AND pr.lng BETWEEN ? AND ? AND NOT EXISTS(SELECT 1 FROM social_blocks b WHERE (b.actor_id=? AND b.target_id=p.id) OR (b.target_id=? AND b.actor_id=p.id)) LIMIT 30",
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
      player,
      player,
    );
}

// Appearance RPC can outlive a block, stopped lease or browser session. Only a
// second authoritative presence read may supply coordinates for the response.
export async function readNearbyPresence(
  db,
  player,
  location,
  arena,
  { appearanceReader, assertSession, clock = Date.now },
) {
  assert(
    typeof appearanceReader === "function" &&
      typeof assertSession === "function",
    "Presence lookup is unavailable.",
    503,
  );
  assertSession();
  const initial = nearbyPresence(db, player, location, arena, clock());
  const looks = await appearanceReader(initial);
  assertSession();
  assert(
    Array.isArray(looks) && looks.length === initial.length,
    "The shared appearances could not be matched to their explorers.",
    503,
  );
  const byId = new Map(
    initial.map((person, index) => [person.id, looks[index]]),
  );
  const current = nearbyPresence(db, player, location, arena, clock());
  return {
    players: current.flatMap((person) => {
      const appearance = byId.get(person.id);
      if (!appearance || typeof appearance.color !== "string") return [];
      return [
        {
          id: person.id,
          name: person.name,
          lat: person.lat,
          lng: person.lng,
          color: appearance.color,
          appearance,
          // Seeded test-world explorers say so on the map, as on their card.
          ...(isDemoBot(person.id) ? { demoBot: true } : {}),
        },
      ];
    }),
  };
}
