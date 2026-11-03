// Patron quest lines (GAME-LOOPS P1-1): the core staker reward.
//
// A staker gets one patron line per day from each quest giver (a walk that
// ends in the highest zone tier they may enter) and one patron chapter per
// day from each storyteller.
// Every turned-in patron line is one step on the Patron's Path: it reveals the
// next chapter of the patron story, and finishing the path earns the
// NPC-only patron edition Aura once per player.
//
// Gates (owner decision 1 Nov 23:47, server/data/staker-gates.json, step AND
// level): the first path step opens at patron_chapter_1 (Staker + L2), the
// rest at patron_line (Staker + L4) and the edition at patron_aura (Staker +
// L4). Lures are things to do, read or wear: a patron line pays the same XP as any other line and its stops pay
// their zone's ordinary prize. It never changes odds, payouts or multipliers.
// A withdrawal later never takes back progress or the edition (D29).
import { AURA_CATALOG } from "../aura-catalog.mjs";
import { hasEarnedEdition } from "../earned-editions.mjs";
import { checkGate } from "../staker-gates.mjs";

export const PATRON_PATH_LINES = 3;
export const MAX_PATRON_LINES_PER_DAY = 1; // per player and NPC
export const PATRON_EDITION = "patron";

export const PATRON_STORY = [
  {
    title: "The first lantern",
    text: "Before the city had a map it had patrons: people who kept a lantern burning at the gate so walkers could find their way home. Your stake is that lantern now. Walk where it shines.",
  },
  {
    title: "The quiet streets",
    text: "Patron zones are not richer. They are quieter, older and further out, the places the city only opens to people who keep it fuelled. The coins there were paid for like every other coin.",
  },
  {
    title: "The seal of the path",
    text: "Three walks under the lantern and the Keeper presses the patron seal into your Aura. It changes nothing about luck or strength. It says, to anyone who looks, that you kept the city lit.",
  },
];

/** Whether the catalog (and so the next collectibles upgrade) has the edition. */
export const patronEditionLive = () => AURA_CATALOG.some((e) => e.id === PATRON_EDITION);

/** Staker gate of the next path step, given the lines already turned in. */
export const patronGateKey = (done) => (done < 1 ? "patron_chapter_1" : "patron_line");
export const PATRON_AURA_GATE = "patron_aura";

export const isPatronRow = (row) => !!row?.terms?.patron;

/** Patron lines this player turned in, with any NPC. */
export function completedPatronLines(db, player) {
  return db
    .prepare(
      "SELECT count(*) n FROM actor_offers WHERE player_id=? AND state='completed' AND json_extract(terms,'$.patron')=1",
    )
    .get(player).n;
}

/**
 * Daily counters buildMenu needs, shared by the NPC service and the encounter
 * menu hook so both build the same menu. Patron lines sit outside the regular
 * line cap and the storyteller's chapter sets.
 */
export function npcMenuCounts(db, player, rows, worldId) {
  const today = rows.filter((r) => r.terms.worldId === worldId);
  return {
    done: new Set(today.map((r) => r.terms.offerId)),
    linesToday: today.filter((r) => r.kind === "quest" && !isPatronRow(r) && !r.terms.errand).length,
    errandsToday: today.filter((r) => r.terms.errand).length,
    chapters: rows.filter((r) => r.kind === "chapter" && r.state === "completed" && !isPatronRow(r)).length,
    patronToday: today.filter(isPatronRow).length,
    patronDone: completedPatronLines(db, player),
  };
}

/** Story chapter revealed by the nth turned-in patron line (1-based). */
export const patronStoryFor = (n) => PATRON_STORY[Math.min(Math.max(n, 1), PATRON_STORY.length) - 1];

/**
 * Patron's Path progress for the Keeper's inner vault. The edition shows its
 * name only once the catalog knows it (it is added with the next shared
 * collectibles upgrade); until then finishing the path still counts and the
 * Aura is handed out on the next patron line after the upgrade.
 */
export function patronPathView(db, player, { access = null, settings, priceEur = null } = {}) {
  let done = 0;
  try {
    done = completedPatronLines(db, player);
  } catch {
    /* actor_offers not created yet on this host: no progress. */
  }
  const edition = AURA_CATALOG.find((e) => e.id === PATRON_EDITION);
  const gate = (key) => {
    if (!access) return null;
    const g = checkGate(key, access, { ...(settings ? { settings } : {}), priceEur });
    return { key, open: g.open, need: g.need, missing: g.missing.map((m) => m.label), stakeNear: g.stakeNear };
  };
  return {
    // What the next step and the Aura need (step AND level, staker-gates.json).
    next: gate(patronGateKey(done)),
    auraGate: gate(PATRON_AURA_GATE),
    done: Math.min(done, PATRON_PATH_LINES),
    of: PATRON_PATH_LINES,
    story: PATRON_STORY.map((c, i) => (i < done ? c : { title: c.title, locked: true })),
    edition: {
      id: PATRON_EDITION,
      name: edition?.name || null,
      available: !!edition,
      earned: edition ? hasEarnedEdition(db, player, PATRON_EDITION) : false,
    },
  };
}
