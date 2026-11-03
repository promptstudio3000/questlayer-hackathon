// Durable challenge bookkeeping on the shared actors v1 tables (§14):
// actor_progress keeps attempts, defeats and the cooldown per player, monster
// and day; actor_challenges keeps an audit row per challenge. Live play state
// (quiz plan, duel rounds) stays in memory: a restart only ends open
// challenges, and the attempt already counted.
export function dbChallengeStore(db) {
  const progress = db.prepare(
    "SELECT attempts,defeats,cooldown_until FROM actor_progress WHERE player_id=? AND actor_id=? AND day_id=?",
  );
  const latest = db.prepare(
    "SELECT MAX(cooldown_until) AS until FROM actor_progress WHERE player_id=? AND actor_id=?",
  );
  const attempt = db.prepare(
    `INSERT INTO actor_progress(player_id,actor_id,day_id,attempts,defeats,cooldown_until,last_outcome,updated_at)
     VALUES(?,?,?,1,0,?,'started',?)
     ON CONFLICT(player_id,actor_id,day_id) DO UPDATE SET attempts=attempts+1,cooldown_until=excluded.cooldown_until,last_outcome='started',updated_at=excluded.updated_at`,
  );
  const outcome = db.prepare(
    "UPDATE actor_progress SET defeats=defeats+?,last_outcome=?,updated_at=? WHERE player_id=? AND actor_id=? AND day_id=?",
  );
  const open = db.prepare(
    "INSERT INTO actor_challenges(id,encounter_id,player_id,actor_id,day_id,format,seed,spec,state,created_at,expires_at) VALUES(?,?,?,?,?,?,?,?,'open',?,?)",
  );
  const close = db.prepare(
    "UPDATE actor_challenges SET state=?,result=?,submitted_at=? WHERE id=? AND state='open'",
  );
  return {
    cooldownUntil: (player, actorId) => latest.get(player, actorId)?.until ?? null,
    defeated: (player, actorId, dayId) => (progress.get(player, actorId, dayId)?.defeats || 0) > 0,
    recordAttempt: (player, actorId, dayId, at, until) => attempt.run(player, actorId, dayId, until, at),
    recordOutcome: (player, actorId, dayId, won, at) => outcome.run(won ? 1 : 0, won ? "won" : "lost", at, player, actorId, dayId),
    openChallenge: (c) =>
      open.run(c.id, c.encounterId || "", c.player, c.actorId, c.dayId, c.format === "quiz" || c.format === "duel" ? c.format : "minigame", c.seed, JSON.stringify({ kind: c.format, seedCommitment: c.seedCommitment }), c.startedAt, c.expiresAt),
    closeChallenge: (id, won, result, at) => close.run(won ? "won" : "lost", JSON.stringify(result), at, id),
  };
}

export function memoryChallengeStore() {
  const rows = new Map();
  const key = (...p) => p.join("␟");
  return {
    cooldownUntil: (player, actorId) => rows.get(key(player, actorId))?.until ?? null,
    defeated: (player, actorId, dayId) => !!rows.get(key(player, actorId, dayId))?.defeats,
    recordAttempt(player, actorId, dayId, at, until) {
      rows.set(key(player, actorId), { until });
    },
    recordOutcome(player, actorId, dayId, won) {
      if (won) rows.set(key(player, actorId, dayId), { defeats: 1 });
    },
    openChallenge() {},
    closeChallenge() {},
  };
}
