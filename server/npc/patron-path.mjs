// Patron quest lines (GAME-LOOPS P1-1): the core staker reward.
//
// A player whose matured stake reaches Tier 2 gets one patron line per day
// from each quest giver (a walk that ends in a Tier 2+ zone) and one patron
// chapter per day from each storyteller (a chapter set in a Tier 2+ zone).
// Every turned-in patron line is one step on the Patron's Path: it reveals the
// next chapter of the patron story, and finishing the path earns the
// NPC-only patron edition Aura once per player.
//
// The gate is tier only (owner decision 1 Nov). Lures are things to do, read
// or wear: a patron line pays the same XP as any other line and its stops pay
// their zone's ordinary prize. It never changes odds, payouts or multipliers.
// A withdrawal later never takes back progress or the edition (D29).
import { AURA_CATALOG } from "../aura-catalog.mjs";
import { hasEarnedEdition } from "../earned-editions.mjs";

export const PATRON_TIER = 2;
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

export const isPatronRow = (row) => !!row?.terms?.patron;

/** Patron lines this player turned in, with any NPC. */
export function completedPatronLines(db, player) {
  return db
    .prepare(
      "SELECT count(*) n FROM actor_offers WHERE player_id=? AND state='completed' AND json_extract(terms,'$.patron')=1",
    )
    .get(player).n;
}

/** Story chapter revealed by the nth turned-in patron line (1-based). */
export const patronStoryFor = (n) => PATRON_STORY[Math.min(Math.max(n, 1), PATRON_STORY.length) - 1];

/**
 * Patron's Path progress for the Keeper's inner vault. The edition shows its
 * name only once the catalog knows it (it is added with the next shared
 * collectibles upgrade); until then finishing the path still counts and the
 * Aura is handed out on the next patron line after the upgrade.
 */
export function patronPathView(db, player) {
  let done = 0;
  try {
    done = completedPatronLines(db, player);
  } catch {
    /* actor_offers not created yet on this host: no progress. */
  }
  const edition = AURA_CATALOG.find((e) => e.id === PATRON_EDITION);
  return {
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
