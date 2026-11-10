// Community places (Lubos, 10 Nov 2026): explorers recommend interesting
// spots to each other (a view, a quiet courtyard, a mural, good coffee). A
// place is free, public at its map pin, and lists by distance in Community ·
// Places. No money and no XP move here. The author edits or removes it; three
// different reports hide it until a moderator looks.
import { assert, distance, id, point, validateFix } from "./domain.mjs";
import { atomic } from "./database.mjs";
import { placeText } from "./gold-spend/places.mjs";
import { isSocialBlocked, initSocialBlocks } from "./social-content.mjs";
import { ensureModuleVersion, registerModuleSchema } from "./schema-compatibility.mjs";

export const PLACE_KINDS = Object.freeze(["view", "nature", "history", "art", "food", "hidden", "play"]);
export const COMMUNITY_PLACES = Object.freeze({
  nameChars: 60,
  noteChars: 280,
  perPlayer: 20,
  perDay: 10,
  radiusKm: 10,
  hideAfterReports: 3,
  limit: 60,
});
const PLACE_ID = /^(?:cplace_[a-f0-9-]{36}|seed-cp-[a-z0-9-]{1,40})$/;
const REASONS = ["spam", "harassment", "unsafe-place", "privacy", "other"];

export const COMMUNITY_PLACES_SCHEMA = registerModuleSchema({
  name: "community-places",
  version: 1,
  sql: `
CREATE TABLE IF NOT EXISTS community_places(
 id TEXT PRIMARY KEY,
 author TEXT NOT NULL,
 name TEXT NOT NULL,
 note TEXT NOT NULL,
 kind TEXT NOT NULL CHECK(kind IN ('view','nature','history','art','food','hidden','play')),
 lat REAL NOT NULL,
 lng REAL NOT NULL,
 arena INTEGER NOT NULL CHECK(arena IN (0,1)),
 state TEXT NOT NULL CHECK(state IN ('published','hidden','deleted')),
 created_at INTEGER NOT NULL,
 updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS community_places_area ON community_places(arena,state,lat,lng);
CREATE INDEX IF NOT EXISTS community_places_author ON community_places(author,state);
CREATE TABLE IF NOT EXISTS community_place_reports(
 target_id TEXT NOT NULL,
 reporter_id TEXT NOT NULL,
 reason TEXT NOT NULL,
 created_at INTEGER NOT NULL,
 PRIMARY KEY(target_id,reporter_id)
);
`,
});

export function createCommunityPlaces(db, { now = () => Date.now() } = {}) {
  ensureModuleVersion(db, COMMUNITY_PLACES_SCHEMA);
  initSocialBlocks(db);
  const C = COMMUNITY_PLACES;
  const name = (player) => db.prepare("SELECT name FROM players WHERE id=?").get(player)?.name || "Explorer";
  const row = (placeId) => {
    assert(typeof placeId === "string" && PLACE_ID.test(placeId), "Place not found.", 404, "CPLACE_NOT_FOUND");
    const r = db.prepare("SELECT * FROM community_places WHERE id=?").get(placeId);
    assert(r, "Place not found.", 404, "CPLACE_NOT_FOUND");
    return r;
  };
  const kind = (value) => {
    assert(PLACE_KINDS.includes(value), "Pick what kind of place it is.", 400, "CPLACE_KIND");
    return value;
  };
  const view = (r, player, from) => ({
    id: r.id,
    name: r.name,
    note: r.note,
    kind: r.kind,
    lat: r.lat,
    lng: r.lng,
    author: { id: r.author, name: name(r.author) },
    mine: r.author === player,
    distanceM: from ? Math.round(distance(from, r)) : null,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  });

  /** Published places within 10 km, nearest first; blocked players are left out. */
  function list(player, input = {}) {
    assert(player, "Sign in to see community places.", 401, "AUTH");
    const here = point(input);
    const arena = input.arena ? 1 : 0;
    const dLat = C.radiusKm / 111,
      dLng = C.radiusKm / (111 * Math.max(0.2, Math.cos((here.lat * Math.PI) / 180)));
    const rows = db
      .prepare(
        "SELECT * FROM community_places WHERE arena=? AND state='published' AND lat BETWEEN ? AND ? AND lng BETWEEN ? AND ? LIMIT 400",
      )
      .all(arena, here.lat - dLat, here.lat + dLat, here.lng - dLng, here.lng + dLng)
      .filter((r) => r.author === player || !isSocialBlocked(db, player, r.author))
      .map((r) => view(r, player, here))
      .filter((p) => p.distanceM <= C.radiusKm * 1000)
      .sort((a, b) => a.distanceM - b.distanceM || b.createdAt - a.createdAt)
      .slice(0, C.limit);
    return { places: rows, kinds: PLACE_KINDS };
  }

  /** Recommend the spot the explorer stands at (GPS) or walks to in the demo. */
  function create(player, input = {}) {
    assert(player, "Sign in to add a place.", 401, "AUTH");
    const at = now();
    const here = point(input);
    const arena = input.arena === true;
    if (!arena) validateFix(input.fix || {}, here, at);
    assert(input.publicConsent === true, "Confirm that this place is public.", 400, "CONSENT");
    const value = {
      name: placeText(input.name, C.nameChars, "A name"),
      note: placeText(input.note, C.noteChars, "A note"),
      kind: kind(input.kind),
    };
    return atomic(db, () => {
      const mine = db.prepare("SELECT COUNT(*) n FROM community_places WHERE author=? AND state='published'").get(player).n;
      assert(mine < C.perPlayer, `You already recommend ${C.perPlayer} places. Remove one first.`, 429, "CPLACE_LIMIT");
      const today = db.prepare("SELECT COUNT(*) n FROM community_places WHERE author=? AND created_at>?").get(player, at - 86_400_000).n;
      assert(today < C.perDay, "That is enough places for today. Add more tomorrow.", 429, "CPLACE_RATE");
      const placeId = id("cplace");
      db.prepare(
        "INSERT INTO community_places(id,author,name,note,kind,lat,lng,arena,state,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,'published',?,?)",
      ).run(placeId, player, value.name, value.note, value.kind, here.lat, here.lng, arena ? 1 : 0, at, at);
      return { place: view(row(placeId), player, here) };
    });
  }

  /** The author rewrites the name, note or kind; the pin stays where it is. */
  function edit(player, placeId, input = {}) {
    assert(player, "Sign in first.", 401, "AUTH");
    const r = row(placeId);
    assert(r.author === player, "Only the author can edit this place.", 403, "CPLACE_OWNER");
    assert(r.state === "published", "This place is no longer listed.", 409, "CPLACE_GONE");
    const next = {
      name: input.name === undefined ? r.name : placeText(input.name, C.nameChars, "A name"),
      note: input.note === undefined ? r.note : placeText(input.note, C.noteChars, "A note"),
      kind: input.kind === undefined ? r.kind : kind(input.kind),
    };
    db.prepare("UPDATE community_places SET name=?,note=?,kind=?,updated_at=? WHERE id=?").run(next.name, next.note, next.kind, now(), placeId);
    return { place: view(row(placeId), player, null) };
  }

  function remove(player, placeId) {
    assert(player, "Sign in first.", 401, "AUTH");
    const r = row(placeId);
    assert(r.author === player, "Only the author can remove this place.", 403, "CPLACE_OWNER");
    db.prepare("UPDATE community_places SET state='deleted',note='',updated_at=? WHERE id=?").run(now(), placeId);
    return { id: placeId, state: "deleted" };
  }

  function report(player, placeId, input = {}) {
    assert(player, "Sign in first.", 401, "AUTH");
    const r = row(placeId);
    assert(r.author !== player, "You cannot report your own place.", 409, "CPLACE_OWN");
    const reason = REASONS.includes(input.reason) ? input.reason : "other";
    return atomic(db, () => {
      db.prepare("INSERT OR IGNORE INTO community_place_reports VALUES(?,?,?,?)").run(placeId, player, reason, now());
      const n = db.prepare("SELECT COUNT(*) n FROM community_place_reports WHERE target_id=?").get(placeId).n;
      if (n >= C.hideAfterReports && r.state === "published")
        db.prepare("UPDATE community_places SET state='hidden',updated_at=? WHERE id=?").run(now(), placeId);
      return { id: placeId, reported: true };
    });
  }

  return { list, create, edit, remove, report };
}
