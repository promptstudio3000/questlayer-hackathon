// Keeps linked Aavegotchi ownership fresh and dresses an explorer in their
// best original by default (docs/PLAYER-CARDS.md).
//
// A linked address (ETH wallet sign-in or "Link Aavegotchi wallet") starts as
// an empty snapshot. Looks and verified wearables need a snapshot at most five
// minutes old (server/appearance.mjs), which used to be refreshed only when
// the player opened the Wardrobe: an owner signed in, saw the starter ghost
// and none of their wearables. Now any signed-in request refreshes a stale
// snapshot in the background (at most once a minute per explorer), and the
// first snapshot dresses the explorer in the owned gotchi with the highest
// rarity score, unless they chose the starter ghost themselves.
import { defaultGotchi } from "./aavegotchi.mjs";

const FRESH_MS = 4 * 60_000;

/**
 * Wears the default original when the explorer wears none and did not pick
 * the starter ghost. Returns the token id put on, or null.
 */
export function dressDefault(db, player, address, data) {
  const row = db.prepare("SELECT appearance FROM players WHERE id=?").get(player);
  if (!row) return null;
  let appearance = {};
  try {
    appearance = JSON.parse(row.appearance || "{}");
  } catch {}
  if (appearance.originTokenId || appearance.starter) return null;
  const best = defaultGotchi(data?.gotchis);
  if (!best) return null;
  db.prepare("UPDATE players SET appearance=? WHERE id=?").run(
    JSON.stringify({ originTokenId: best.tokenId, address, auto: true }),
    player,
  );
  return best.tokenId;
}

export function createOriginSync(db, { read, now = () => Date.now(), checkEveryMs = 60_000, log = () => {} }) {
  const lastCheck = new Map();
  const inFlight = new Map();
  const stale = db.prepare(
    "SELECT address FROM external_links WHERE player_id=? AND verified_at<? ORDER BY verified_at LIMIT 3",
  );
  const store = db.prepare("UPDATE external_links SET data=?,verified_at=? WHERE address=? AND player_id=?");

  async function refresh(player, addresses) {
    for (const address of addresses) {
      let data;
      try {
        data = await read(address);
      } catch (error) {
        log(`Original ownership check failed for ${player}: ${error?.message || error}`);
        continue;
      }
      store.run(JSON.stringify(data), data.verifiedAt || now(), address, player);
      dressDefault(db, player, address, data);
    }
  }

  /** Starts a background refresh when a linked snapshot is stale. */
  function touch(player, { force = false } = {}) {
    if (typeof player !== "string" || !player) return null;
    if (inFlight.has(player)) return inFlight.get(player);
    const t = now();
    if (!force && (lastCheck.get(player) || 0) > t - checkEveryMs) return null;
    lastCheck.delete(player);
    lastCheck.set(player, t);
    if (lastCheck.size > 50_000) lastCheck.delete(lastCheck.keys().next().value);
    const addresses = stale.all(player, t - FRESH_MS).map((r) => r.address);
    if (!addresses.length) return null;
    const task = refresh(player, addresses).finally(() => inFlight.delete(player));
    inFlight.set(player, task);
    return task;
  }

  /** Waits up to `ms` for a running refresh, so a response can carry the new look. */
  async function settle(player, ms) {
    const task = inFlight.get(player);
    if (!task) return;
    let timer;
    await Promise.race([task, new Promise((done) => (timer = setTimeout(done, ms)))]);
    clearTimeout(timer);
  }

  return { touch, settle };
}
