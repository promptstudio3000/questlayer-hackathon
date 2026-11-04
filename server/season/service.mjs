// Hackathon season (docs/SEASON.md, docs/GAME-LOOPS.md P1-3): a two-week frame
// around the game with a cosmetic leaderboard, a season mark and Aura for
// everyone who reaches the goal, and a meter of the reward pot that funded the
// season's days.
//
// Standings are read from rows the game already writes inside the season
// window, so the board can never count something that didn't happen:
//   hunt   monster_rewards win:* XP rows, plus landed hits on the weekly boss
//   visit  distinct zones reached (quest_progress / quest_claims in demo play,
//          native_progress for enrolled NEAR accounts)
//   line   NPC quest lines and storyteller chapters turned in (actor_offers)
// The leaderboard never counts GOLD, NEAR, stake or trades, and a rank changes
// nothing but how the row looks. No streak, no decay.
//
// The pot meter sums the budgets of reward days published on NEAR during the
// season (coins + zone prizes), split by funding source (realized yield or
// sponsor). Trader sweeps into the rewards treasury are shown beside it, not
// added, because swept NEAR reaches players only through later published days.
import { assert } from "../domain.mjs";
import { atomic, history } from "../database.mjs";
import { ensureModuleVersion } from "../schema-compatibility.mjs";
import { awardEditionOnce, hasEarnedEdition } from "../earned-editions.mjs";
import { AURA_CATALOG } from "../aura-catalog.mjs";
import { SEASON_SCHEMA } from "./schema.mjs";

export const BOARD_SIZE = 20;
const CACHE_MS = 30_000;
const isoDay = (t) => new Date(t).toISOString().slice(0, 10);

export function seasonRank(points, goal) {
  // Cosmetic titles only (docs/SEASON.md). Thresholds scale with the goal.
  if (points >= goal * 3) return { rank: 4, title: "Season legend" };
  if (points >= goal * 2) return { rank: 3, title: "Trailblazer" };
  if (points >= goal) return { rank: 2, title: "Season finisher" };
  if (points > 0) return { rank: 1, title: "Explorer" };
  return { rank: 0, title: "Not started" };
}

export function createSeason(db, settings, { now = () => Date.now() } = {}) {
  ensureModuleVersion(db, SEASON_SCHEMA);
  const has = (t) => !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(t);
  let cache = null;

  function window() {
    const t = now();
    return { from: settings.startsAt, to: Math.min(t, settings.endsAt) };
  }

  function phase(t = now()) {
    if (t < settings.startsAt) return "upcoming";
    if (t > settings.endsAt) return "ended";
    return "live";
  }

  /** Per-player counts for one action kind: Map(player -> n). Optionally just one player. */
  function counts(kind, player = null) {
    const { from, to } = window();
    const out = new Map();
    const add = (rows) => {
      for (const r of rows) out.set(r.p, (out.get(r.p) || 0) + r.n);
    };
    const who = (col) => (player ? ` AND ${col}=?` : "");
    const args = (...a) => (player ? [...a, player] : a);
    if (kind === "hunt") {
      if (has("monster_rewards"))
        add(
          db
            .prepare(
              `SELECT player_id p,count(*) n FROM monster_rewards WHERE kind='xp' AND substr(source,1,4)='win:' AND created_at>=? AND created_at<=?${who("player_id")} GROUP BY player_id`,
            )
            .all(...args(from, to)),
        );
      if (has("monster_boss_hits"))
        add(
          db
            .prepare(
              `SELECT player_id p,count(*) n FROM monster_boss_hits WHERE state='landed' AND created_at>=? AND created_at<=?${who("player_id")} GROUP BY player_id`,
            )
            .all(...args(from, to)),
        );
    } else if (kind === "visit") {
      const parts = [
        `SELECT player_id p,'q:'||quest_id k FROM quest_progress WHERE checkpoint>=1 AND updated_at>=? AND updated_at<=?${who("player_id")}`,
        `SELECT player_id p,'q:'||quest_id k FROM quest_claims WHERE created_at>=? AND created_at<=?${who("player_id")}`,
      ];
      const a = [...args(from, to), ...args(from, to)];
      if (has("native_progress") && has("native_enrollments")) {
        parts.push(
          `SELECT e.player_id p,'n:'||np.day_id||':'||np.quest_index k FROM native_progress np JOIN native_enrollments e ON e.account_id=np.account_id WHERE np.checkpoint>=1 AND np.updated_at>=? AND np.updated_at<=?${who("e.player_id")}`,
        );
        a.push(...args(from, to));
      }
      add(db.prepare(`SELECT p,count(DISTINCT k) n FROM (${parts.join(" UNION ")}) GROUP BY p`).all(...a));
    } else if (kind === "line") {
      if (has("actor_offers"))
        add(
          db
            .prepare(
              `SELECT player_id p,count(*) n FROM actor_offers WHERE kind IN('quest','chapter') AND state='completed' AND completed_at>=? AND completed_at<=?${who("player_id")} GROUP BY player_id`,
            )
            .all(...args(from, to)),
        );
    }
    return out;
  }

  function score(row) {
    const p = settings.points;
    return row.hunts * p.hunt + row.visits * p.visit + row.lines * p.line;
  }

  function standing(player) {
    const row = {
      hunts: counts("hunt", player).get(player) || 0,
      visits: counts("visit", player).get(player) || 0,
      lines: counts("line", player).get(player) || 0,
    };
    return { ...row, points: score(row) };
  }

  function standings() {
    const t = now();
    if (cache && t - cache.at < CACHE_MS) return cache.rows;
    const hunts = counts("hunt"),
      visits = counts("visit"),
      lines = counts("line");
    const ids = new Set([...hunts.keys(), ...visits.keys(), ...lines.keys()]);
    const name = db.prepare("SELECT name FROM players WHERE id=?");
    const rows = [...ids]
      .map((id) => {
        const r = { id, hunts: hunts.get(id) || 0, visits: visits.get(id) || 0, lines: lines.get(id) || 0 };
        return { ...r, points: score(r), name: name.get(id)?.name || "Explorer" };
      })
      .filter((r) => r.points > 0)
      .sort((a, b) => b.points - a.points || b.lines - a.lines || b.visits - a.visits || a.name.localeCompare(b.name));
    let place = 0,
      last = null;
    rows.forEach((r, i) => {
      if (r.points !== last) place = i + 1;
      last = r.points;
      r.place = place;
    });
    cache = { at: t, rows };
    return rows;
  }

  function finisher(player) {
    return db
      .prepare("SELECT points,edition,item_id itemId,created_at createdAt FROM season_finishers WHERE season_id=? AND player_id=?")
      .get(settings.id, player);
  }

  function auraEdition() {
    const e = AURA_CATALOG.find((x) => x.id === settings.aura && x.source === "season");
    return e ? { id: e.id, name: e.name, rarity: e.rarity, slot: e.slot, color: e.color } : null;
  }

  function pot() {
    const out = { yield: 0n, sponsor: 0n, days: 0, traderSweeps: 0n };
    if (has("native_days")) {
      const foreign = has("native_day_contracts")
        ? " AND id NOT IN (SELECT day_id FROM native_day_contracts WHERE state='foreign')"
        : "";
      const rows = db
        .prepare(`SELECT body FROM native_days WHERE state IN ('published','closed') AND day>=? AND day<=?${foreign}`)
        .all(isoDay(settings.startsAt), isoDay(settings.endsAt));
      for (const { body } of rows) {
        try {
          const m = JSON.parse(body);
          let total = BigInt(m.coinUnit || "0") * BigInt(Array.isArray(m.coins) ? m.coins.length : 0);
          for (const q of m.quests || []) total += BigInt(q.reward || "0");
          out[m.funding === "realized_yield" ? "yield" : "sponsor"] += total;
          out.days++;
        } catch {
          /* A malformed body is reported by the distribution audit, not here. */
        }
      }
    }
    if (has("npc_trader_sweeps"))
      for (const r of db
        .prepare("SELECT amount FROM npc_trader_sweeps WHERE state='done' AND created_at>=? AND created_at<=?")
        .all(settings.startsAt, settings.endsAt))
        out.traderSweeps += BigInt(r.amount);
    const total = out.yield + out.sponsor;
    const target = BigInt(settings.potTarget);
    return {
      total: total.toString(),
      fromYield: out.yield.toString(),
      fromSponsors: out.sponsor.toString(),
      publishedDays: out.days,
      traderSweeps: out.traderSweeps.toString(),
      target: target.toString(),
      fillBps: Number(total >= target ? 10000n : (total * 10000n) / target),
      note: "Reward days published on NEAR during the season. Trader sweeps refill the treasury and reach players through later days, so they are not added twice.",
    };
  }

  function view(player = null, { limit = BOARD_SIZE } = {}) {
    const rows = standings();
    const board = rows.slice(0, limit).map(({ id, ...r }) => ({
      ...r,
      ...seasonRank(r.points, settings.goal),
      you: id === player,
    }));
    let me = null;
    if (player) {
      const s = standing(player);
      const place = rows.find((r) => r.id === player)?.place ?? null;
      const done = finisher(player);
      me = {
        ...s,
        place,
        ...seasonRank(s.points, settings.goal),
        goal: settings.goal,
        reached: s.points >= settings.goal,
        claimed: !!done,
        claimedAt: done?.createdAt ?? null,
        aura: done?.edition ? { edition: done.edition, itemId: done.itemId } : null,
      };
    }
    return {
      enabled: true,
      id: settings.id,
      name: settings.name,
      phase: phase(),
      startsAt: settings.startsAt,
      endsAt: settings.endsAt,
      goal: settings.goal,
      points: settings.points,
      counts: "Hunts, zone visits and NPC lines only. Never GOLD, NEAR, stake or trades.",
      cosmetic: true,
      players: rows.length,
      finishers: db.prepare("SELECT count(*) n FROM season_finishers WHERE season_id=?").get(settings.id).n,
      leaderboard: board,
      me,
      aura: auraEdition(),
      pot: pot(),
      streak: false,
    };
  }

  /**
   * Records the season mark once per explorer after they reach the goal, and
   * awards the season Aura once the edition is in the catalog. A finisher who
   * claimed before the edition shipped gets the Aura on their next claim.
   */
  function claim(player) {
    return atomic(db, () => {
      const t = now();
      assert(t >= settings.startsAt, "The season has not started yet.", 409, "SEASON_UPCOMING");
      let done = finisher(player);
      const s = standing(player);
      if (!done) {
        assert(t <= settings.endsAt, "The season has ended.", 409, "SEASON_ENDED");
        assert(s.points >= settings.goal, `Reach ${settings.goal} season points first.`, 409, "SEASON_GOAL");
        db.prepare("INSERT INTO season_finishers(season_id,player_id,points,data,created_at) VALUES(?,?,?,?,?)").run(
          settings.id,
          player,
          s.points,
          JSON.stringify({ hunts: s.hunts, visits: s.visits, lines: s.lines }),
          t,
        );
        history(db, player, "season", `${settings.name}: goal reached`, 0, { season: settings.id, points: s.points });
        done = finisher(player);
      }
      const edition = auraEdition();
      if (edition && !done.edition && !hasEarnedEdition(db, player, edition.id)) {
        const item = awardEditionOnce(db, player, edition.id, `season:${settings.id}`, t);
        if (item)
          db.prepare("UPDATE season_finishers SET edition=?,item_id=? WHERE season_id=? AND player_id=?").run(
            edition.id,
            item.id,
            settings.id,
            player,
          );
      }
      cache = null;
      return view(player);
    });
  }

  function status() {
    return {
      status: "on",
      id: settings.id,
      phase: phase(),
      endsAt: new Date(settings.endsAt).toISOString(),
      goal: settings.goal,
      aura: auraEdition()?.id || null,
    };
  }

  return { view, claim, standing, standings, pot, status, phase };
}
