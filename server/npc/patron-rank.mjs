// Patron rank (GAME-LOOPS P1-2): a kinship-like track for stakers.
//  - Ranks 1–5 grow with each epoch the player spends as a patron: at least
//    one linked account at the patron tier (default Tier 2) on matured,
//    unwithdrawn stake. Depositing more does not speed it up; holding does.
//  - No decay and no streak penalty (D29): a withdrawal only stops growth.
//    Counted epochs and the earned rank stay.
//  - The Keeper reads vault state only when a player opens the stake card, so
//    epochs between two readings are credited when both readings qualify and
//    the weighted stake did not shrink in between (a shrink credits only the
//    current epoch). A single gap is capped (KEEPER_RANK_GAP_MAX).
//  - Purely cosmetic: a badge, a name and a one-time rank-up ceremony. It
//    never changes odds, payouts, damage or tiers.
import { registerModuleSchema, ensureModuleVersion } from "../schema-compatibility.mjs";

export const PATRON_RANK_SCHEMA = registerModuleSchema({
  name: "keeper-patron-rank",
  version: 1,
  sql: `
CREATE TABLE IF NOT EXISTS keeper_patron_rank(
  player_id TEXT PRIMARY KEY,
  epochs INTEGER NOT NULL,
  rank INTEGER NOT NULL,
  last_epoch INTEGER,
  last_weighted TEXT NOT NULL,
  last_qualified INTEGER NOT NULL,
  seen_rank INTEGER NOT NULL,
  first_epoch INTEGER,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS keeper_patron_rank_ups(
  player_id TEXT NOT NULL,
  rank INTEGER NOT NULL,
  epoch INTEGER,
  epochs INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY(player_id, rank)
);
`,
});

export const DEFAULT_RANK_EPOCHS = [1, 4, 14, 28, 60];
export const DEFAULT_RANK_NAMES = ["Spark", "Ember", "Lantern", "Beacon", "Hearthfire"];

/** KEEPER_RANK_EPOCHS="1,4,14,28,60" (strictly rising, five values). */
export function rankSettings(env = process.env) {
  let epochs = DEFAULT_RANK_EPOCHS;
  const list = String(env.KEEPER_RANK_EPOCHS || "")
    .split(",")
    .map((x) => Number(x.trim()));
  if (list.length === 5 && list.every((n, i) => Number.isInteger(n) && n >= 1 && n <= 10000 && (i === 0 || n > list[i - 1]))) epochs = list;
  let names = DEFAULT_RANK_NAMES;
  const n = String(env.KEEPER_RANK_NAMES || "")
    .split(",")
    .map((x) => x.trim());
  if (n.length === 5 && n.every((x) => x.length >= 1 && x.length <= 24)) names = n;
  const int = (v, d, min, max) => (Number.isInteger(Number(v)) && Number(v) >= min && Number(v) <= max && v !== "" && v != null ? Number(v) : d);
  return {
    enabled: env.KEEPER_RANK_ENABLED !== "0",
    epochs,
    names,
    minTier: int(env.KEEPER_RANK_TIER, 2, 1, 3),
    gapMax: int(env.KEEPER_RANK_GAP_MAX, 14, 1, 1000),
  };
}

export const rankFor = (epochs, thresholds = DEFAULT_RANK_EPOCHS) => thresholds.filter((t) => epochs >= t).length;

const big = (v) => {
  try {
    return BigInt(String(v ?? "0"));
  } catch {
    return 0n;
  }
};

export function createPatronRank(db, { clock = Date.now, settings = rankSettings() } = {}) {
  let ready = false;
  const init = () => {
    if (!ready) ensureModuleVersion(db, PATRON_RANK_SCHEMA);
    ready = true;
  };
  const q = (sql) => db.prepare(sql);

  /**
   * One reading at `epoch`. `tier` is the player's best account tier on
   * matured stake, `weighted` that account's weighted stake (yocto string).
   * Returns the public rank view.
   */
  function observe(player, { epoch, tier, weighted }) {
    init();
    const now = clock();
    const qualified = Number.isInteger(epoch) && tier >= settings.minTier;
    const row = q("SELECT * FROM keeper_patron_rank WHERE player_id=?").get(player);
    let epochs = row?.epochs ?? 0,
      lastEpoch = row?.last_epoch ?? null,
      lastWeighted = row?.last_weighted ?? "0",
      lastQualified = row?.last_qualified ?? 0,
      first = row?.first_epoch ?? null;
    if (Number.isInteger(epoch) && (lastEpoch == null || epoch > lastEpoch)) {
      if (qualified) {
        let credit = 1;
        if (lastQualified && lastEpoch != null && big(weighted) >= big(lastWeighted)) credit = Math.min(epoch - lastEpoch, settings.gapMax);
        epochs += credit;
        if (first == null) first = epoch;
      }
      lastEpoch = epoch;
      lastWeighted = String(weighted ?? "0");
      lastQualified = qualified ? 1 : 0;
    } else if (Number.isInteger(epoch) && epoch === lastEpoch && lastQualified && qualified && big(weighted) < big(lastWeighted)) {
      // A shrink inside the same epoch lowers the baseline for the next gap.
      lastWeighted = String(weighted);
    } else if (Number.isInteger(epoch) && epoch === lastEpoch && !lastQualified && qualified) {
      // Became a patron during this epoch: it counts once.
      epochs += 1;
      if (first == null) first = epoch;
      lastWeighted = String(weighted ?? "0");
      lastQualified = 1;
    }
    // No decay: the stored rank never goes down, even if thresholds change.
    const rank = Math.max(row?.rank ?? 0, rankFor(epochs, settings.epochs));
    const seenRank = row?.seen_rank ?? 0;
    q(
      `INSERT INTO keeper_patron_rank(player_id,epochs,rank,last_epoch,last_weighted,last_qualified,seen_rank,first_epoch,updated_at)
       VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(player_id) DO UPDATE SET epochs=excluded.epochs,rank=excluded.rank,last_epoch=excluded.last_epoch,
       last_weighted=excluded.last_weighted,last_qualified=excluded.last_qualified,first_epoch=excluded.first_epoch,updated_at=excluded.updated_at`,
    ).run(player, epochs, rank, lastEpoch, lastWeighted, lastQualified, seenRank, first, now);
    for (let r = (row?.rank ?? 0) + 1; r <= rank; r++)
      q("INSERT OR IGNORE INTO keeper_patron_rank_ups(player_id,rank,epoch,epochs,created_at) VALUES(?,?,?,?,?)").run(player, r, epoch ?? null, epochs, now);
    return describe({ epochs, rank, seenRank, growing: qualified, first });
  }

  function describe({ epochs, rank, seenRank, growing, first }) {
    const next = rank < 5 ? { rank: rank + 1, name: settings.names[rank], epochs: settings.epochs[rank], left: settings.epochs[rank] - epochs } : null;
    return {
      rank,
      name: rank ? settings.names[rank - 1] : null,
      epochs,
      growing,
      sinceEpoch: first,
      minTier: settings.minTier,
      next,
      ladder: settings.epochs.map((e, i) => ({ rank: i + 1, name: settings.names[i], epochs: e })),
      // One ceremony for the highest unseen rank (several steps at once show as one).
      rankUp: rank > seenRank ? { rank, name: settings.names[rank - 1] } : null,
    };
  }

  function seen(player, rank) {
    init();
    const r = q("UPDATE keeper_patron_rank SET seen_rank=? WHERE player_id=? AND seen_rank<? AND rank>=?").run(rank, player, rank, rank);
    return { seen: r.changes > 0 };
  }

  /** Public badge for any player (profile / avatar), without a new reading. */
  function badge(player) {
    init();
    const row = q("SELECT rank,epochs FROM keeper_patron_rank WHERE player_id=?").get(player);
    return row?.rank ? { rank: row.rank, name: settings.names[row.rank - 1], epochs: row.epochs } : null;
  }

  return { observe, seen, badge, settings };
}
