// Daily board (docs/GAME-LOOPS.md P0-5, docs/DAILY-BOARD.md): three small goals
// picked from today's world. Finishing all of them pays a small XP bonus once
// per world day. No streak, no penalty, nothing to lose by skipping a day.
//
// Progress is read from rows the game already writes, keyed by the world day
// (manifest.day), so the board can never pay for something that didn't happen:
//   coins   coins.claimant on today's worlds
//   finds   the street-find subset of those coins
//   quest   quest_claims on today's quests
//   monster monster_rewards win:* XP rows for today's day id
//   npc     distinct NPCs talked to (ai_npc_requests) or tasks taken (actor_offers) today
//   boss    landed hits on the weekly boss today
import { assert } from "../domain.mjs";
import { atomic, history } from "../database.mjs";
import { ensureModuleVersion } from "../schema-compatibility.mjs";
import { streetFindIds } from "../street-finds.mjs";
import { DAILY_BOARD_SCHEMA } from "./schema.mjs";

const DAY = 86_400_000;
const ACTOR_GOALS = new Set(["monster", "npc", "boss"]);

export function goalLabel(kind, target) {
  const n = (one, many) => (target === 1 ? one : many.replace("#", target));
  switch (kind) {
    case "coins":
      return n("Collect a coin", "Collect # coins");
    case "finds":
      return n("Pick up a street find", "Pick up # street finds");
    case "quest":
      return n("Finish a quest", "Finish # quests");
    case "monster":
      return n("Beat a monster", "Beat # monsters");
    case "npc":
      return n("Talk to an NPC", "Talk to # different NPCs");
    case "boss":
      return n("Land a hit on the boss", "Land # hits on the boss");
    default:
      return kind;
  }
}

export function createDailyBoard(db, settings, { actorsOn = () => false, now = () => Date.now() } = {}) {
  ensureModuleVersion(db, DAILY_BOARD_SCHEMA);
  const has = (t) => !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(t);

  function window(manifest) {
    // Manifests carry endsAt (local midnight); a world day is the 24 h before it.
    const endsAt = Number(manifest.endsAt) || now() + DAY,
      startsAt = Number(manifest.startsAt) || endsAt - DAY;
    return { startsAt, endsAt };
  }

  function available(kind, manifest) {
    if (ACTOR_GOALS.has(kind) && !actorsOn()) return false;
    if (kind === "monster" || kind === "boss") return has(kind === "boss" ? "monster_boss_hits" : "monster_rewards");
    if (kind === "npc") return has("ai_npc_requests");
    if (kind === "quest")
      return !!db
        .prepare("SELECT 1 FROM quests q JOIN worlds w ON w.id=q.world_id WHERE w.day=? LIMIT 1")
        .get(manifest.day);
    return !!db.prepare("SELECT 1 FROM coins WHERE world_id=? LIMIT 1").get(manifest.id);
  }

  /** The goals for this world day: preferred ones that can be played, topped up from the fallback list. */
  function pick(manifest) {
    const chosen = [];
    for (const g of [...settings.goals, ...settings.fallback]) {
      if (chosen.length >= settings.size) break;
      if (chosen.some((c) => c.kind === g.kind)) continue;
      if (available(g.kind, manifest)) chosen.push(g);
    }
    return chosen;
  }

  function progress(player, kind, manifest) {
    const day = manifest.day,
      { startsAt, endsAt } = window(manifest);
    const n = (sql, ...args) => db.prepare(sql).get(...args).n;
    switch (kind) {
      case "coins":
        return n(
          "SELECT count(*) n FROM coins c JOIN worlds w ON w.id=c.world_id WHERE c.claimant=? AND w.day=?",
          player,
          day,
        );
      case "finds": {
        let total = 0;
        const rows = db
          .prepare("SELECT c.id,c.world_id FROM coins c JOIN worlds w ON w.id=c.world_id WHERE c.claimant=? AND w.day=?")
          .all(player, day);
        for (const r of rows) if (streetFindIds(db, r.world_id).has(r.id)) total++;
        return total;
      }
      case "quest":
        return n(
          "SELECT count(*) n FROM quest_claims qc JOIN quests q ON q.id=qc.quest_id JOIN worlds w ON w.id=q.world_id WHERE qc.player_id=? AND w.day=?",
          player,
          day,
        );
      case "monster":
        return has("monster_rewards")
          ? n(
              "SELECT count(*) n FROM monster_rewards WHERE player_id=? AND kind='xp' AND day_id=? AND substr(source,1,4)='win:'",
              player,
              day,
            )
          : 0;
      case "npc": {
        if (!has("ai_npc_requests")) return 0;
        const talk = "SELECT actor_id FROM ai_npc_requests WHERE player_id=? AND created_at>=? AND created_at<? AND outcome!='limited'";
        const offers = has("actor_offers")
          ? " UNION SELECT actor_id FROM actor_offers WHERE player_id=? AND created_at>=? AND created_at<? AND kind IN('quest','chapter')"
          : "";
        const args = offers ? [player, startsAt, endsAt, player, startsAt, endsAt] : [player, startsAt, endsAt];
        return n(`SELECT count(*) n FROM (${talk}${offers})`, ...args);
      }
      case "boss":
        return has("monster_boss_hits")
          ? n(
              "SELECT count(*) n FROM monster_boss_hits WHERE player_id=? AND state='landed' AND created_at>=? AND created_at<?",
              player,
              startsAt,
              endsAt,
            )
          : 0;
      default:
        return 0;
    }
  }

  function claimRow(player, day) {
    return db.prepare("SELECT xp,goals,created_at FROM daily_board_claims WHERE player_id=? AND day_id=?").get(player, day);
  }

  function view(player, manifest) {
    const claim = claimRow(player, manifest.day);
    // A claimed board keeps the goals it was claimed with, even if settings change later.
    const goals = claim ? JSON.parse(claim.goals) : pick(manifest);
    const rows = goals.map((g) => {
      const value = progress(player, g.kind, manifest);
      return {
        kind: g.kind,
        target: g.target,
        progress: Math.min(value, g.target),
        done: value >= g.target,
        label: goalLabel(g.kind, g.target),
      };
    });
    const done = rows.filter((g) => g.done).length;
    return {
      enabled: true,
      dayId: manifest.day,
      resetsAt: window(manifest).endsAt,
      goals: rows,
      done,
      total: rows.length,
      complete: rows.length > 0 && done === rows.length,
      bonusXp: claim ? claim.xp : settings.bonusXp,
      claimed: !!claim,
      claimedAt: claim?.created_at ?? null,
      finishedToday: db.prepare("SELECT count(*) n FROM daily_board_claims WHERE day_id=?").get(manifest.day).n,
      streak: false,
    };
  }

  /** Pays the bonus once per explorer and world day, after every goal is done. */
  function claim(player, manifest) {
    return atomic(db, () => {
      const board = view(player, manifest);
      if (board.claimed) return { ...board, alreadyClaimed: true };
      assert(board.complete, "Finish every goal on today's board first.", 409, "BOARD_INCOMPLETE");
      const goals = board.goals.map(({ kind, target }) => ({ kind, target }));
      const at = now();
      db.prepare("INSERT INTO daily_board_claims(player_id,day_id,xp,goals,data,created_at) VALUES(?,?,?,?,?,?)").run(
        player,
        manifest.day,
        settings.bonusXp,
        JSON.stringify(goals),
        JSON.stringify({ worldId: manifest.id }),
        at,
      );
      if (settings.bonusXp) db.prepare("UPDATE players SET xp=xp+? WHERE id=?").run(settings.bonusXp, player);
      history(db, player, "daily-board", "Today's board complete", 0, { day: manifest.day, xp: settings.bonusXp });
      return view(player, manifest);
    });
  }

  function status() {
    return {
      status: "on",
      goals: settings.goals.map((g) => `${g.kind}:${g.target}`).join(","),
      fallback: settings.fallback.map((g) => `${g.kind}:${g.target}`).join(","),
      size: settings.size,
      bonusXp: settings.bonusXp,
    };
  }

  return { view, claim, pick, progress, status };
}
