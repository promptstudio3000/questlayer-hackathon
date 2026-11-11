// The explorer's own story for Profile → Character (owner request, 10 Nov
// 2026): totals like the public player card plus a timeline of what they
// found, finished, earned and staked. Read-only; every source is a table the
// game already writes. A table that does not exist yet on this database
// counts as empty, so a fresh server answers too.

/** History kinds that are earnings (GOLD in), never spending. */
const EARNED_KINDS = ["coin", "quest", "bounty", "sale"];
/** History kinds shown on the timeline. Spending and setup rows stay in receipts. */
const STORY_KINDS = new Set([
  "welcome",
  "coin",
  "quest",
  "bounty",
  "sale",
  "purchase",
  "earned-edition",
  "native_profile",
]);
const TIMELINE_LIMIT = 40;

function safe(fn, fallback) {
  try {
    return fn();
  } catch {
    return fallback; // table not created yet on this database
  }
}

/**
 * Totals and timeline of one explorer. `placeBadgeName` maps a place badge id
 * to its display name (the badge catalog), or null when badges are off.
 */
export function playerJourney(db, player, { placeBadgeName = () => null } = {}) {
  const count = (sql, ...args) => safe(() => db.prepare(sql).get(player, ...args)?.n || 0, 0);
  const row = db.prepare("SELECT created_at FROM players WHERE id=?").get(player);
  const earnedHistory = safe(
    () =>
      db
        .prepare(
          `SELECT COALESCE(SUM(gold_u),0) AS n FROM history WHERE player_id=? AND gold_u>0 AND kind IN (${EARNED_KINDS.map(() => "?").join(",")})`,
        )
        .get(player, ...EARNED_KINDS)?.n || 0,
    0,
  );
  const taskPay = count("SELECT COALESCE(SUM(paid_u),0) AS n FROM mk_claims WHERE worker=? AND state='paid'");
  const stats = {
    finds: count("SELECT COUNT(*) AS n FROM coins WHERE claimant=?"),
    quests: count("SELECT COUNT(*) AS n FROM quest_claims WHERE player_id=?"),
    tasks:
      count("SELECT COUNT(*) AS n FROM mk_claims WHERE worker=? AND state='paid'") +
      count("SELECT COUNT(*) AS n FROM bounties WHERE winner=? AND state='paid'"),
    posted:
      count("SELECT COUNT(*) AS n FROM mk_tasks WHERE poster=?") +
      count("SELECT COUNT(*) AS n FROM creator_quests WHERE author=? AND state IN ('published','closing','closed')"),
    monsters: count("SELECT COUNT(*) AS n FROM actor_challenges WHERE player_id=? AND state='won'"),
    wearables: count("SELECT COUNT(*) AS n FROM wearable_clones WHERE player_id=? AND source='find'"),
    badges:
      count("SELECT COUNT(*) AS n FROM place_badge_awards WHERE player_id=?") +
      count("SELECT COUNT(*) AS n FROM user_badge_claims WHERE player_id=?"),
    goldEarnedU: Number(earnedHistory) + Number(taskPay),
  };

  const events = [];
  for (const h of safe(
    () =>
      db
        .prepare("SELECT id,kind,title,gold_u,meta,created_at FROM history WHERE player_id=? ORDER BY created_at DESC LIMIT 120")
        .all(player),
    [],
  )) {
    if (!STORY_KINDS.has(h.kind)) continue;
    let meta = {};
    try {
      meta = JSON.parse(h.meta || "{}");
    } catch {}
    events.push({
      id: h.id,
      kind: h.kind === "coin" && meta.find ? "find" : h.kind,
      title: h.title,
      goldU: h.gold_u || 0,
      at: h.created_at,
      ...(meta.chain ? { chain: meta.chain } : {}),
    });
  }
  for (const b of safe(
    () => db.prepare("SELECT badge_id,created_at FROM place_badge_awards WHERE player_id=? ORDER BY created_at DESC LIMIT 40").all(player),
    [],
  ))
    events.push({
      id: `badge:${b.badge_id}`,
      kind: "badge",
      title: placeBadgeName(b.badge_id) || "Place badge",
      goldU: 0,
      at: b.created_at,
    });
  for (const b of safe(
    () =>
      db
        .prepare(
          "SELECT c.badge_id,c.created_at,b.title FROM user_badge_claims c JOIN user_badges b ON b.id=c.badge_id WHERE c.player_id=? ORDER BY c.created_at DESC LIMIT 40",
        )
        .all(player),
    [],
  ))
    events.push({ id: `ubadge:${b.badge_id}`, kind: "badge", title: b.title, goldU: 0, at: b.created_at });
  for (const c of safe(
    () =>
      db
        .prepare("SELECT id,kind,tier,amount,created_at FROM keeper_ceremonies WHERE player_id=? ORDER BY created_at DESC LIMIT 40")
        .all(player),
    [],
  ))
    events.push({
      id: `stake:${c.id}`,
      kind: c.kind === "tier" ? "tier" : "stake",
      title: c.kind === "tier" ? `Tier ${c.tier}` : "Stake matured",
      goldU: 0,
      at: c.created_at,
      ...(c.kind === "tier" ? { tier: c.tier } : { amount: c.amount }),
    });
  for (const t of safe(
    () =>
      db
        .prepare(
          "SELECT c.id,c.paid_u,c.updated_at,t.title FROM mk_claims c JOIN mk_tasks t ON t.id=c.task_id WHERE c.worker=? AND c.state='paid' ORDER BY c.updated_at DESC LIMIT 40",
        )
        .all(player),
    [],
  ))
    events.push({ id: `task:${t.id}`, kind: "task", title: t.title, goldU: t.paid_u || 0, at: t.updated_at });

  events.sort((a, b) => b.at - a.at);
  return {
    joinedAt: row?.created_at ?? null,
    stats,
    timeline: events.slice(0, TIMELINE_LIMIT),
  };
}
