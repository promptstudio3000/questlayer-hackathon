// Content on the globe (docs/GLOBE-CLUSTERS.md): where in the world there is
// something to play, for the zoomed-out globe view. The client clusters these
// spots by zoom (region-sized bubbles, then country-sized ones further out).
//
// Player quests (published creator quests with a public creator profile)
// carry the headline number, because what other players made matters more
// than what the game generated. Playable cities (reviewed live cities and
// auto cities, including the demo cities abroad) fill the rest of the world.
//
// Public, aggregate only: one spot per quest start or city centre, rounded to
// 0.01 degrees (about 1 km), no titles, authors or ids. Cached in memory.

const ROUND = 100;
export const GLOBE_CACHE_MS = 5 * 60_000;
export const GLOBE_MAX_SPOTS = 20_000;

const round = (n) => Math.round(n * ROUND) / ROUND;
const valid = (lat, lng) =>
  Number.isFinite(lat) &&
  Number.isFinite(lng) &&
  Math.abs(lat) <= 90 &&
  Math.abs(lng) <= 180;

/** Start points of published player quests; [] when creator quests are off. */
export function playerQuestStarts(db) {
  let rows = [];
  try {
    rows = db
      .prepare(
        `SELECT json_extract(r.content,'$.place') AS place FROM creator_quests q
        JOIN creator_profiles p ON p.player_id=q.author AND p.public=1
        JOIN creator_revisions r ON r.quest_id=q.id AND r.revision=q.published_revision AND r.state='approved'
        WHERE q.state='published' LIMIT ${GLOBE_MAX_SPOTS}`,
      )
      .all();
  } catch {
    return []; // creator tables not created on this host
  }
  return rows.flatMap((row) => {
    try {
      const first = JSON.parse(row.place || "null")?.points?.[0];
      return first && valid(first.lat, first.lng)
        ? [{ lat: first.lat, lng: first.lng }]
        : [];
    } catch {
      return [];
    }
  });
}

/**
 * Spots merged by rounded position: [lng, lat, playerQuests, cities].
 * cities: [{ center: { lat, lng } }] (live and auto cities).
 */
export function globeSpots({ quests = [], cities = [] }) {
  const byKey = new Map();
  const add = (lat, lng, q, c) => {
    if (!valid(lat, lng)) return;
    const la = round(lat),
      ln = round(lng),
      key = `${la},${ln}`,
      spot = byKey.get(key) || [ln, la, 0, 0];
    spot[2] += q;
    spot[3] += c;
    byKey.set(key, spot);
  };
  for (const q of quests) add(q.lat, q.lng, 1, 0);
  const seen = new Set();
  for (const c of cities) {
    if (!c?.center || seen.has(c.id)) continue;
    seen.add(c.id);
    add(c.center.lat, c.center.lng, 0, 1);
  }
  return [...byKey.values()].slice(0, GLOBE_MAX_SPOTS);
}

export function createGlobeContent({ db, cities, clock = Date.now }) {
  let cached = null,
    at = 0;
  return function read() {
    const now = clock();
    if (cached && now - at < GLOBE_CACHE_MS) return cached;
    const quests = playerQuestStarts(db),
      spots = globeSpots({ quests, cities: cities() });
    cached = {
      spots,
      totals: {
        playerQuests: quests.length,
        cities: spots.reduce((n, s) => n + s[3], 0),
      },
      generatedAt: now,
    };
    at = now;
    return cached;
  };
}
