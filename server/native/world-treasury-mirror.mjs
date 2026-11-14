// Test Layer treasury mirror (docs/TEST-LAYER.md, docs/TREASURY-PAGE.md).
//
// The game has one treasury: GotchiGO's (QuestLayer World). The Test Layer has
// its own practice contracts and prize pool but no treasury, DAO or staking
// vaults of its own, so its /treasury page read 503s. Here the Test Layer reads
// World's public, read-only treasury views (mix, history, DAO tally) and serves
// them marked with `mirroredFrom`, so the page shows the real treasury and says
// where it lives. Nothing signs, nothing is written, no account data passes.
export const MIRROR_PATHS = Object.freeze(["/api/treasury/mix", "/api/treasury/history", "/api/treasury/dao"]);
const TTL_MS = 60_000;
const TIMEOUT_MS = 8_000;

export function createWorldTreasuryMirror({ origin, fetchImpl = globalThis.fetch, now = Date.now } = {}) {
  if (!origin) return null;
  const base = new URL(origin);
  if (base.protocol !== "https:" && base.hostname !== "127.0.0.1" && base.hostname !== "localhost") return null;
  const cache = new Map();
  return {
    origin: base.origin,
    /** Public JSON of World's `path`, cached for a minute; null when World does not answer. */
    async read(path) {
      if (!MIRROR_PATHS.includes(path)) throw new Error(`Not a mirrored path: ${path}`);
      const hit = cache.get(path);
      if (hit && now() - hit.at < TTL_MS) return hit.body;
      try {
        const r = await fetchImpl(new URL(path, base), { signal: AbortSignal.timeout(TIMEOUT_MS), headers: { accept: "application/json" } });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const data = await r.json();
        if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("not an object");
        const body = { ...data, mirroredFrom: base.origin };
        cache.set(path, { at: now(), body });
        return body;
      } catch {
        // A stale copy beats an empty card; it is at most an hour old.
        return hit && now() - hit.at < 60 * TTL_MS ? hit.body : null;
      }
    },
  };
}
