// Persistence for NPC talk and quest lines, on the tables of the shared
// `actors` schema module (owned by the N0 slice, docs/NPC-PLAN.md §14):
// ai_npc_requests, actor_offers, actor_relationships. Every SQL statement for
// those tables lives here so a column rename is a one-file change.
import { id } from "../domain.mjs";

export function createNpcStore(db, { clock = Date.now } = {}) {
  const q = (sql) => db.prepare(sql);
  return {
    audit(row) {
      q(
        "INSERT INTO ai_npc_requests(id,player_id,actor_id,provider,model,outcome,reason,facts_hash,menu_hash,output_hash,signature_hash,attested,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
      ).run(
        id("ainpc"),
        row.player,
        row.actor,
        row.provider,
        row.model ?? null,
        row.outcome,
        row.reason ?? null,
        row.factsHash,
        row.menuHash,
        row.outputHash,
        null,
        0,
        clock(),
      );
    },
    talkCount(player, sinceMs) {
      return q(
        "SELECT count(*) n FROM ai_npc_requests WHERE player_id=? AND created_at>? AND outcome IN('answered','fallback')",
      ).get(player, clock() - sinceMs).n;
    },
    providerCallsToday() {
      return q("SELECT count(*) n FROM ai_npc_requests WHERE created_at>? AND outcome IN('answered','fallback')").get(
        clock() - 86_400_000,
      ).n;
    },
    memory(player, actor) {
      const row = q("SELECT trust,notes FROM actor_relationships WHERE player_id=? AND actor_id=?").get(player, actor);
      return row ? { trust: row.trust, notes: JSON.parse(row.notes || "[]") } : { trust: 0, notes: [] };
    },
    remember(player, actor, note, trustDelta = 0) {
      const current = this.memory(player, actor);
      const notes = note ? [...current.notes.filter((n) => n !== note), note].slice(-5) : current.notes;
      const trust = Math.max(0, Math.min(5, current.trust + trustDelta));
      q(
        "INSERT INTO actor_relationships(player_id,actor_id,trust,notes,updated_at) VALUES (?,?,?,?,?) ON CONFLICT(player_id,actor_id) DO UPDATE SET trust=excluded.trust,notes=excluded.notes,updated_at=excluded.updated_at",
      ).run(player, actor, trust, JSON.stringify(notes), clock());
    },
    offer(offerId, player) {
      const row = q("SELECT * FROM actor_offers WHERE id=? AND player_id=?").get(offerId, player);
      return row ? { ...row, terms: JSON.parse(row.terms) } : null;
    },
    offersFor(player, actor) {
      return q("SELECT * FROM actor_offers WHERE player_id=? AND actor_id=? ORDER BY created_at")
        .all(player, actor)
        .map((r) => ({ ...r, terms: JSON.parse(r.terms) }));
    },
    insertOffer(o) {
      q(
        "INSERT INTO actor_offers(id,actor_id,player_id,encounter_id,kind,terms,menu_hash,state,expires_at,created_at,completed_at) VALUES (?,?,?,?,?,?,?,'accepted',?,?,NULL)",
      ).run(o.id, o.actor, o.player, o.encounter, o.kind, JSON.stringify(o.terms), o.menuHash, o.expiresAt, clock());
    },
    completeOffer(offerId, player) {
      return q(
        "UPDATE actor_offers SET state='completed',completed_at=? WHERE id=? AND player_id=? AND state='accepted'",
      ).run(clock(), offerId, player).changes;
    },
    /** Quest-giver lines this player turned in, with any NPC. */
    completedQuestLines(player) {
      return q("SELECT count(*) n FROM actor_offers WHERE player_id=? AND kind='quest' AND state='completed'").get(player).n;
    },
    aurasGrantedToday(actor) {
      return q(
        "SELECT count(*) n FROM actor_offers WHERE actor_id=? AND state='completed' AND completed_at>? AND json_extract(terms,'$.aura')=1",
      ).get(actor, clock() - 86_400_000).n;
    },
  };
}
