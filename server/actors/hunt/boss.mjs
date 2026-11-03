// Weekly co-op boss (docs/NPC-PLAN.md §13.1, §13.4, slice M4). One boss per
// city per ISO week stands at a public square (the Great Portal is its arena).
// Everyone chips at one shared HP pool. A hit is a short server-seeded
// mini-game; the server replays the inputs and turns the score into damage
// from account level (capped) and skill only. One hit per player every 10
// minutes. When HP reaches zero, every player with a landed hit gets XP and a
// roll ticket, and everyone with 3+ landed hits gets a Bossbane Fangring (once per
// player, while supply lasts). The leaderboard counts hits, never money.
import { createHmac, randomBytes } from "node:crypto";
import { assert } from "../../domain.mjs";
import { atomic } from "../../database.mjs";
import { ensureModuleVersion } from "../../schema-compatibility.mjs";
import { MINIGAMES, createMinigame, scoreMinigame, minimumPlayMs } from "../challenges/minigames.mjs";
import { playerPower } from "../challenges/duel.mjs";
import { sha256 } from "../challenges/rng.mjs";
import { HUNT_SCHEMA } from "./schema.mjs";
import { awardEditionOnce } from "../../earned-editions.mjs";

export const BOSS_HIT_COOLDOWN_MS = 10 * 60_000;
export const BOSS_HIT_TTL_MS = 2 * 60_000;
export const BOSS_HITS_FOR_EDITION = 3;
export const BOSS_EDITION = "bossbane";
export const BOSS_XP = 60;
export const DEFAULT_BOSS_HP = 1200;
const NETWORK_SLACK_MS = 400;

/** ISO week id ("2026-W44") for a local day id ("2026-11-01"). */
export function weekIdFor(dayId) {
  const [y, m, d] = dayId.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  const dow = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dow);
  const year = date.getUTCFullYear();
  const week = Math.ceil(((date - Date.UTC(year, 0, 1)) / 86_400_000 + 1) / 7);
  return `${year}-W${String(week).padStart(2, "0")}`;
}

/** Damage for a scored hit: level power scaled by the share of the game you got right. */
export function hitDamage(level, verdict) {
  if (!verdict?.max || !(verdict.score > 0)) return 0;
  const share = Math.min(1, verdict.score / verdict.max);
  return Math.round(playerPower(level) * (verdict.won ? 0.5 + 0.5 * share : 0.5 * share));
}

export function createBossService(db, {
  encounters,
  levelOf,
  rewards,
  secret = randomBytes(32).toString("hex"),
  maxHp = DEFAULT_BOSS_HP,
  now = () => Date.now(),
} = {}) {
  ensureModuleVersion(db, HUNT_SCHEMA);
  assert(encounters?.requireEncounter && typeof levelOf === "function" && rewards, "Boss events need encounters, levelOf and rewards.");
  const open = new Map(); // hit id -> live game

  const eventId = (cityId, weekId, actorId) => `${cityId}:${weekId}:${actorId}`;
  const getEvent = (id) => db.prepare("SELECT * FROM monster_boss_events WHERE id=?").get(id);

  function ensureEvent(cityId, dayId, actorId) {
    const weekId = weekIdFor(dayId),
      id = eventId(cityId, weekId, actorId);
    db.prepare(
      "INSERT OR IGNORE INTO monster_boss_events(id,city_id,week_id,actor_id,max_hp,hp,state,created_at) VALUES(?,?,?,?,?,?,'active',?)",
    ).run(id, cityId, weekId, actorId, maxHp, maxHp, now());
    return getEvent(id);
  }

  function lastHit(event, player) {
    return db
      .prepare("SELECT created_at FROM monster_boss_hits WHERE event_id=? AND player_id=? ORDER BY created_at DESC LIMIT 1")
      .get(event, player)?.created_at;
  }

  function view(event, player, { top = 10 } = {}) {
    if (!event) return null;
    const board = db
      .prepare(
        "SELECT h.player_id,p.name,COUNT(*) AS hits,SUM(h.damage) AS damage FROM monster_boss_hits h LEFT JOIN players p ON p.id=h.player_id WHERE h.event_id=? AND h.state='landed' GROUP BY h.player_id ORDER BY hits DESC,MIN(h.finished_at) ASC LIMIT ?",
      )
      .all(event.id, top)
      .map((r, i) => ({ rank: i + 1, name: r.name || "Explorer", hits: r.hits, damage: r.damage, you: r.player_id === player }));
    const mine = player
      ? db
          .prepare("SELECT COUNT(*) AS hits,COALESCE(SUM(damage),0) AS damage FROM monster_boss_hits WHERE event_id=? AND player_id=? AND state='landed'")
          .get(event.id, player)
      : null;
    const participants = db
      .prepare("SELECT COUNT(DISTINCT player_id) AS n FROM monster_boss_hits WHERE event_id=? AND state='landed'")
      .get(event.id).n;
    const last = player ? lastHit(event.id, player) : null;
    return {
      id: event.id,
      weekId: event.week_id,
      actorId: event.actor_id,
      hp: event.hp,
      maxHp: event.max_hp,
      state: event.state,
      defeatedAt: event.defeated_at ?? undefined,
      participants,
      leaderboard: board,
      hitsForEdition: BOSS_HITS_FOR_EDITION,
      edition: BOSS_EDITION,
      cooldownMs: BOSS_HIT_COOLDOWN_MS,
      ...(mine ? { you: { hits: mine.hits, damage: mine.damage, nextHitAt: last ? last + BOSS_HIT_COOLDOWN_MS : null } } : {}),
    };
  }

  // On defeat: XP + a roll ticket for every landed hitter, Bossbane for 3+ hits.
  function settle(event, at) {
    const rows = db
      .prepare("SELECT player_id,COUNT(*) AS hits FROM monster_boss_hits WHERE event_id=? AND state='landed' GROUP BY player_id ORDER BY MIN(created_at)")
      .all(event.id);
    const day = new Date(at).toISOString().slice(0, 10);
    for (const r of rows) {
      if (!db.prepare("SELECT 1 FROM players WHERE id=?").get(r.player_id)) continue;
      const source = `boss:${event.id}`;
      rewards.addXp(r.player_id, source, BOSS_XP, day, "Helped defeat the weekly boss", at);
      rewards.grant(r.player_id, source, "roll", 1, day, {}, at);
      // Bossbane is paid once per player, ever (server/earned-editions.mjs).
      if (r.hits >= BOSS_HITS_FOR_EDITION && rewards.grant(r.player_id, source, "edition", 1, day, { edition: BOSS_EDITION }, at)) {
        const item = awardEditionOnce(db, r.player_id, BOSS_EDITION, `monster:${source}`, at);
        if (!item) db.prepare("UPDATE monster_rewards SET amount=0,data=? WHERE player_id=? AND source=? AND kind='edition'").run(JSON.stringify({ edition: BOSS_EDITION, notPaid: true }), r.player_id, source);
      }
    }
  }

  async function enc(args) {
    const e = await encounters.requireEncounter(args);
    assert(e.actor?.archetype === "boss", "Only the weekly boss takes hits.", 400, "NOT_A_BOSS");
    return e;
  }

  return {
    weekIdFor,
    ensureEvent,
    event: (cityId, dayId, actorId, player) => view(ensureEvent(cityId, dayId, actorId), player),
    current(cityId, dayId, player) {
      const row = db
        .prepare("SELECT * FROM monster_boss_events WHERE city_id=? AND week_id=? ORDER BY created_at LIMIT 1")
        .get(cityId, weekIdFor(dayId));
      return view(row, player);
    },

    async start({ player, actorId, encounter }) {
      assert(player, "Sign in to fight the boss.", 401, "AUTH");
      const e = await enc({ token: encounter, player, actorId });
      const event = ensureEvent(e.cityId || "plzen", e.dayId, e.actor.id);
      assert(event.state === "active", "The boss is already beaten this week. A new one comes next week.", 409, "BOSS_DEFEATED");
      const t = now(),
        last = lastHit(event.id, player);
      assert(!last || t >= last + BOSS_HIT_COOLDOWN_MS, "Catch your breath: one hit every 10 minutes.", 429, "BOSS_COOLDOWN");
      for (const [hid, h] of open) if (h.expiresAt < t) open.delete(hid);
      const id = `bhit_${randomBytes(12).toString("base64url")}`,
        seed = createHmac("sha256", secret).update(`${event.id}␟${player}␟${id}`).digest("hex"),
        format = MINIGAMES[parseInt(sha256(seed).slice(0, 8), 16) % MINIGAMES.length],
        game = createMinigame(format, seed);
      db.prepare(
        "INSERT INTO monster_boss_hits(id,event_id,player_id,format,seed,state,created_at) VALUES(?,?,?,?,?,'open',?)",
      ).run(id, event.id, player, format, seed, t);
      open.set(id, { id, player, actorId: e.actor.id, eventId: event.id, game, format, startedAt: t, expiresAt: t + BOSS_HIT_TTL_MS, level: levelOf(player) });
      const { kind, ...rest } = game;
      return {
        hit: { id, format, expiresAt: t + BOSS_HIT_TTL_MS, seedCommitment: sha256(seed), power: playerPower(levelOf(player)), ...rest },
        event: view(event, player),
      };
    },

    submit({ player, actorId, hitId, input }) {
      const h = open.get(hitId);
      assert(h && h.player === player && h.actorId === actorId, "This hit is not yours or no longer exists.", 404, "HIT_NOT_FOUND");
      open.delete(hitId);
      const t = now();
      if (t > h.expiresAt) {
        db.prepare("UPDATE monster_boss_hits SET state='expired',finished_at=? WHERE id=? AND state='open'").run(t, hitId);
        assert(false, "The boss turned away. Your next hit is ready after the cooldown.", 410, "HIT_EXPIRED");
      }
      const verdict =
        t - h.startedAt + NETWORK_SLACK_MS < minimumPlayMs(h.game)
          ? { won: false, score: 0, max: 0, reason: "too-fast" }
          : scoreMinigame(h.game, input);
      const damage = hitDamage(h.level, verdict);
      return atomic(db, () => {
        let event = getEvent(h.eventId);
        const dealt = event.state === "active" ? Math.min(event.hp, damage) : 0;
        db.prepare("UPDATE monster_boss_hits SET state=?,damage=?,score=?,finished_at=? WHERE id=? AND state='open'").run(
          dealt > 0 ? "landed" : "missed",
          dealt,
          verdict.score ?? 0,
          t,
          hitId,
        );
        let defeated = false;
        if (dealt > 0) {
          db.prepare("UPDATE monster_boss_events SET hp=hp-? WHERE id=? AND state='active'").run(dealt, event.id);
          event = getEvent(event.id);
          if (event.hp === 0) {
            db.prepare("UPDATE monster_boss_events SET state='defeated',defeated_at=? WHERE id=? AND state='active'").run(t, event.id);
            event = getEvent(event.id);
            settle(event, t);
            defeated = true;
          }
        }
        return {
          damage: dealt,
          landed: dealt > 0,
          score: verdict.score ?? 0,
          max: verdict.max ?? 0,
          ...(verdict.reason ? { reason: verdict.reason } : {}),
          defeated,
          event: view(event, player),
        };
      });
    },
  };
}
