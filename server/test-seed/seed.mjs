// Testnet test world (docs/TEST-SEED.md): simulated explorers, notes, market
// listings, tasks, published creator quests and a starter kit for every real
// explorer. Everything it writes has an id starting with "seed-", and purge()
// removes all of it, including rows real explorers made that point at it.
import { readFileSync } from "node:fs";
import { atomic } from "../database.mjs";
import { buyItem } from "../game.mjs";
import { editionForDemoName } from "../aura-catalog.mjs";
import { initSocialContent } from "../social-content.mjs";
import { GOLD } from "../domain.mjs";
import {
  SEED_VERSION,
  SEED_PREFIX,
  SEED_CENTER,
  SEED_PLAYERS,
  SEED_BUYER,
  BUYER_MAX_PRICE_U,
  BUYER_DELAY_MS,
  REVIEW_DELAY_MS,
  SEED_NOTES,
  SEED_LISTINGS,
  SEED_BOUNTIES,
  SEED_CREATORS,
  SEED_CREATOR_QUESTS,
  STARTER_KIT,
} from "./content.mjs";

const MARKER = `test-seed:${SEED_VERSION}`;
const MARKER_PREFIX = "test-seed:";
const WALK_SPEED_MPS = 1.2;
const DAY = 86_400_000;

// Columns that can hold a seed id. purge() deletes every row whose value in
// one of these columns starts with "seed-", then any row left pointing at a
// deleted row through a foreign key.
const REFERENCE_COLUMNS = [
  "id",
  "player_id",
  "author",
  "actor",
  "actor_id",
  "target_id",
  "participant",
  "seller",
  "buyer",
  "creator",
  "winner",
  "follower",
  "reporter_id",
  "item_id",
  "quest_id",
  "note_id",
  "bounty_id",
  "submission_id",
  "operation_id",
];

const isSeed = (value) => typeof value === "string" && value.startsWith(SEED_PREFIX);
const tableExists = (db, name) =>
  !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name);
const quote = (name) => `"${name.replaceAll('"', '""')}"`;

function meters(a, b) {
  const r = 6371000,
    rad = Math.PI / 180,
    dLat = (b.lat - a.lat) * rad,
    dLng = (b.lng - a.lng) * rad,
    h =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * r * Math.asin(Math.sqrt(h));
}

/** Real pedestrian paths near the centre, one per walker; a circle if the pack is missing. */
export function walkerRoutes(count, packUrl = new URL("../data/plzen-v1.json", import.meta.url)) {
  let paths = [];
  try {
    paths = JSON.parse(readFileSync(packUrl, "utf8")).paths || [];
  } catch {
    paths = [];
  }
  const candidates = paths
    .map((p) => p.points.map(([lng, lat]) => ({ lat, lng })))
    .filter((pts) => pts.length >= 3 && pts.every((pt) => meters(pt, SEED_CENTER) <= 900))
    .map((pts) => {
      const lengths = [0];
      for (let i = 1; i < pts.length; i++) lengths.push(lengths[i - 1] + meters(pts[i - 1], pts[i]));
      return { pts, lengths, total: lengths.at(-1) };
    })
    .filter((r) => r.total >= 200)
    .sort((a, b) => b.total - a.total);
  return Array.from({ length: count }, (_, i) => {
    if (candidates.length) return candidates[(i * 7) % candidates.length];
    const pts = Array.from({ length: 13 }, (_, k) => {
      const angle = (k / 12) * 2 * Math.PI,
        radius = 0.0012 + i * 0.0004;
      return { lat: SEED_CENTER.lat + radius * Math.sin(angle), lng: SEED_CENTER.lng + radius * 1.5 * Math.cos(angle) };
    });
    const lengths = [0];
    for (let k = 1; k < pts.length; k++) lengths.push(lengths[k - 1] + meters(pts[k - 1], pts[k]));
    return { pts, lengths, total: lengths.at(-1) };
  });
}

/** Position on a route, walking there and back at a steady pace. */
export function positionOnRoute(route, now, offsetMs = 0) {
  const travelled = (((now + offsetMs) / 1000) * WALK_SPEED_MPS) % (2 * route.total);
  const along = travelled <= route.total ? travelled : 2 * route.total - travelled;
  let i = 1;
  while (i < route.lengths.length - 1 && route.lengths[i] < along) i++;
  const a = route.pts[i - 1],
    b = route.pts[i],
    span = route.lengths[i] - route.lengths[i - 1] || 1,
    t = Math.min(1, Math.max(0, (along - route.lengths[i - 1]) / span));
  return { lat: a.lat + (b.lat - a.lat) * t, lng: a.lng + (b.lng - a.lng) * t };
}

function auraRow(name) {
  const edition = editionForDemoName(name);
  if (!edition) throw new Error(`Unknown seed Aura "${name}".`);
  return {
    name: edition.demoName,
    rarity: edition.rarity,
    slot: edition.slot,
    color: edition.demoColor || edition.color,
    key: edition.id,
  };
}

/**
 * @param {import("node:sqlite").DatabaseSync} db
 * @param {{ creators?: { services: any, moderator: string, completionAuthority: string, policyVersion: string } | null, clock?: () => number, log?: (msg: string) => void }} options
 */
export function createTestSeed(db, { creators = null, clock = Date.now, log = () => {} } = {}) {
  const routes = walkerRoutes(SEED_PLAYERS.filter((p) => p.walk).length);
  let routeFor = new Map();
  SEED_PLAYERS.filter((p) => p.walk).forEach((p, i) => routeFor.set(p.id, routes[i]));

  function insertAura(id, player, name, equipped, now) {
    const a = auraRow(name);
    db.prepare("INSERT OR IGNORE INTO inventory VALUES (?,?,?,?,?,?,?,?,?,?)").run(
      id,
      player,
      "aura",
      a.name,
      a.rarity,
      a.slot,
      a.color,
      equipped ? 1 : 0,
      null,
      now,
    );
  }

  function applyPlayers(now) {
    atomic(db, () => {
      for (const p of SEED_PLAYERS) {
        db.prepare(
          "INSERT OR IGNORE INTO players(id,name,gold_u,xp,appearance,created_at) VALUES (?,?,?,?,?,?)",
        ).run(p.id, p.name, p.gold * GOLD, p.xp, "{}", now);
        db.prepare("UPDATE players SET xp=MAX(xp,?) WHERE id=?").run(p.xp, p.id);
        db.prepare("INSERT OR IGNORE INTO inventory VALUES (?,?,?,?,?,?,?,?,?,?)").run(
          `${p.id}-avatar`,
          p.id,
          "avatar",
          "Explorer",
          "common",
          "avatar",
          p.color,
          1,
          null,
          now,
        );
        const worn = new Set();
        for (const name of p.auras) {
          const a = auraRow(name);
          insertAura(`${p.id}-aura-${a.key}`, p.id, name, !worn.has(a.slot), now);
          worn.add(a.slot);
        }
      }
    });
  }

  function applyNotes(now) {
    initSocialContent(db);
    atomic(db, () => {
      for (const n of SEED_NOTES)
        for (const arena of [1, 0]) {
          const id = `seed-note-${n.slug}-${arena ? "a" : "g"}`;
          db.prepare(
            "INSERT OR IGNORE INTO messages(id,player_id,text,lat,lng,image,author_fix,created_at) VALUES(?,?,?,?,?,NULL,NULL,?)",
          ).run(id, n.author, n.text, n.at.lat, n.at.lng, now);
          db.prepare("INSERT OR IGNORE INTO social_note_meta VALUES(?,?,'published',?)").run(id, arena, now);
        }
    });
  }

  function ensureListings(now) {
    let created = 0;
    atomic(db, () => {
      for (const l of SEED_LISTINGS) {
        const open = db
          .prepare("SELECT 1 FROM listings WHERE substr(id,1,?)=? AND state='open'")
          .get(`seed-l-${l.slug}-`.length, `seed-l-${l.slug}-`);
        if (open) continue;
        const n = now.toString(36);
        const item = `seed-inv-l-${l.slug}-${n}`;
        insertAura(item, l.seller, l.aura, false, now);
        db.prepare(
          "INSERT INTO listings(id,item_id,seller,price_u,created_at) VALUES (?,?,?,?,?)",
        ).run(`seed-l-${l.slug}-${n}`, item, l.seller, l.price * GOLD, now);
        created++;
      }
    });
    return created;
  }

  function ensureBounties(now) {
    let created = 0;
    atomic(db, () => {
      for (const b of SEED_BOUNTIES) {
        const prefix = `seed-b-${b.slug}-`;
        const open = db
          .prepare("SELECT 1 FROM bounties WHERE substr(id,1,?)=? AND state='open' AND deadline>?")
          .get(prefix.length, prefix, now);
        if (open) continue;
        db.prepare(
          "INSERT INTO bounties(id,creator,title,description,amount_u,lat,lng,deadline,created_at) VALUES (?,?,?,?,?,?,?,?,?)",
        ).run(
          `${prefix}${now.toString(36)}`,
          b.creator,
          b.title,
          b.description,
          b.reward * GOLD,
          b.at.lat,
          b.at.lng,
          now + 7 * DAY,
          now,
        );
        created++;
      }
    });
    return created;
  }

  function applyCreators() {
    if (!creators?.services) return { published: 0, skipped: "creator community is off" };
    const { lifecycle, community } = creators.services;
    for (const c of SEED_CREATORS) {
      const existing = db.prepare("SELECT version FROM creator_profiles WHERE player_id=?").get(c.player);
      if (!existing)
        community.saveProfile({
          actor: c.player,
          operationId: `seed-profile-${c.player}`,
          expectedVersion: 0,
          profile: { displayName: c.displayName, bio: c.bio, public: true },
          publicConsent: true,
        });
    }
    let published = 0;
    for (const q of SEED_CREATOR_QUESTS) {
      const row = () => db.prepare("SELECT state,version FROM creator_quests WHERE id=?").get(q.id);
      if (!row())
        lifecycle.createDraft({ actor: q.author, operationId: `seed-draft-${q.id}`, questId: q.id, draft: q.draft });
      if (row().state === "draft")
        lifecycle.submit({
          actor: q.author,
          operationId: `seed-submit-${q.id}`,
          questId: q.id,
          expectedVersion: row().version,
          expectedPolicyVersion: creators.policyVersion,
        });
      if (row().state === "pending_review")
        lifecycle.review({
          actor: creators.moderator,
          operationId: `seed-review-${q.id}`,
          questId: q.id,
          expectedVersion: row().version,
          decision: "approve",
          reason: "Test seed content, approved automatically on testnet.",
        });
      if (row().state === "published") published++;
    }
    return { published };
  }

  /** Idempotent. Safe to call on every start. */
  function apply() {
    const now = clock();
    applyPlayers(now);
    applyNotes(now);
    ensureListings(now);
    ensureBounties(now);
    let creatorResult;
    try {
      creatorResult = applyCreators();
    } catch (error) {
      creatorResult = { published: 0, error: error?.code || error?.message || String(error) };
      log(`Test seed: creator quests skipped (${creatorResult.error}).`);
    }
    db.prepare("INSERT OR IGNORE INTO daily_jobs(job_key,created_at) VALUES (?,?)").run(MARKER, now);
    tickPresence(now);
    return { version: SEED_VERSION, creators: creatorResult, ...counts() };
  }

  /** Starter kit for a real explorer, once per explorer while the seed is active. */
  function grantKit(player, now = clock()) {
    if (typeof player !== "string" || isSeed(player)) return false;
    const kitId = `seed-kit-${player}`;
    if (db.prepare("SELECT 1 FROM history WHERE id=?").get(kitId)) return false;
    return atomic(db, () => {
      if (db.prepare("SELECT 1 FROM history WHERE id=?").get(kitId)) return false;
      if (!db.prepare("SELECT 1 FROM players WHERE id=?").get(player)) return false;
      // The first copy keeps the original `${kitId}-${key}` id; duplicates get
      // a numeric suffix. Every id still starts with SEED_PREFIX for purge.
      const copies = new Map();
      const worn = new Set(
        db
          .prepare("SELECT slot FROM inventory WHERE player_id=? AND kind='aura' AND equipped=1")
          .all(player)
          .map((row) => row.slot),
      );
      for (const name of STARTER_KIT.auras) {
        const { key, slot } = auraRow(name);
        const copy = (copies.get(key) || 0) + 1;
        copies.set(key, copy);
        const equip = copy === 1 && STARTER_KIT.equip.includes(name) && !worn.has(slot);
        if (equip) worn.add(slot);
        insertAura(copy === 1 ? `${kitId}-${key}` : `${kitId}-${key}-${copy}`, player, name, equip, now);
      }
      db.prepare("UPDATE players SET xp=xp+? WHERE id=?").run(STARTER_KIT.xp, player);
      const shards = tableExists(db, "actor_shards") ? STARTER_KIT.shards : {};
      for (const [element, count] of Object.entries(shards))
        db.prepare(
          "INSERT INTO actor_shards(player_id,element,count,updated_at) VALUES (?,?,?,?) ON CONFLICT(player_id,element) DO UPDATE SET count=count+excluded.count,updated_at=excluded.updated_at",
        ).run(player, element, count, now);
      const shardTotal = Object.values(shards).reduce((a, b) => a + b, 0);
      db.prepare("INSERT INTO history VALUES (?,?,?,?,?,?,?)").run(
        kitId,
        player,
        "test-kit",
        `Test kit: ${STARTER_KIT.auras.length} Auras, ${STARTER_KIT.xp} XP${shardTotal ? ` and ${shardTotal} monster shards` : ""}`,
        0,
        JSON.stringify({ seed: SEED_VERSION, xp: STARTER_KIT.xp, shards }),
        now,
      );
      return true;
    });
  }

  function tickPresence(now = clock()) {
    const upsert = db.prepare(
      "INSERT OR REPLACE INTO presence(player_id,lat,lng,expires_at,updated_at,arena,lease_id) VALUES(?,?,?,?,?,?,'seed')",
    );
    SEED_PLAYERS.forEach((p, i) => {
      if (p.walk) {
        const at = positionOnRoute(routeFor.get(p.id), now, i * 97_000);
        upsert.run(p.id, at.lat, at.lng, now + 15 * 60_000, now, 1);
      }
    });
    const companion = SEED_PLAYERS.find((p) => p.companion);
    if (companion) {
      const target = db
        .prepare(
          "SELECT lat,lng,arena FROM presence WHERE substr(player_id,1,5)!='seed-' AND updated_at>? ORDER BY updated_at DESC LIMIT 1",
        )
        .get(now - 30_000);
      const angle = ((now / 120_000) % 1) * 2 * Math.PI,
        base = target || { ...SEED_CENTER, arena: 1 },
        radius = 0.0003;
      upsert.run(
        companion.id,
        base.lat + radius * Math.sin(angle),
        base.lng + radius * 1.5 * Math.cos(angle),
        now + 15 * 60_000,
        now,
        base.arena ? 1 : 0,
      );
    }
  }

  /** A seed explorer buys what real explorers list, so selling can be tried end to end. */
  function tickBuyer(now) {
    const open = db
      .prepare(
        "SELECT l.id FROM listings l JOIN inventory i ON i.id=l.item_id WHERE l.state='open' AND substr(l.seller,1,5)!='seed-' AND i.player_id=l.seller AND l.price_u<=? AND l.created_at<=? ORDER BY l.created_at LIMIT 5",
      )
      .all(BUYER_MAX_PRICE_U, now - BUYER_DELAY_MS);
    let bought = 0;
    for (const { id } of open) {
      db.prepare("UPDATE players SET gold_u=MAX(gold_u,?) WHERE id=?").run(1_000_000 * GOLD, SEED_BUYER);
      try {
        buyItem(db, SEED_BUYER, id, now);
        bought++;
      } catch (error) {
        log(`Test seed buyer skipped ${id}: ${error?.message || error}`);
      }
    }
    return bought;
  }

  function tickBounties(now) {
    const pending = db
      .prepare(
        "SELECT s.id FROM bounty_submissions s JOIN bounties b ON b.id=s.bounty_id WHERE substr(b.id,1,7)='seed-b-' AND b.state='open' AND s.state='pending' AND s.created_at<=? AND NOT EXISTS(SELECT 1 FROM bounty_submissions e WHERE e.bounty_id=s.bounty_id AND e.state='pending' AND e.id<s.id) LIMIT 10",
      )
      .all(now - REVIEW_DELAY_MS);
    for (const { id } of pending)
      atomic(db, () => {
        const s = db.prepare("SELECT * FROM bounty_submissions WHERE id=?").get(id);
        const b = db.prepare("SELECT * FROM bounties WHERE id=?").get(s.bounty_id);
        if (s.state !== "pending" || b.state !== "open") return;
        db.prepare("UPDATE bounties SET state='paid',winner=? WHERE id=?").run(s.player_id, b.id);
        db.prepare("UPDATE bounty_submissions SET state='approved' WHERE id=?").run(s.id);
        db.prepare("UPDATE players SET gold_u=gold_u+? WHERE id=?").run(b.amount_u, s.player_id);
        db.prepare("INSERT INTO history VALUES (?,?,?,?,?,?,?)").run(
          `seed-h-${s.bounty_id}-${s.id}`,
          s.player_id,
          "bounty",
          b.title,
          b.amount_u,
          JSON.stringify({ seed: SEED_VERSION }),
          now,
        );
      });
    return pending.length;
  }

  function tickCompletions(now) {
    if (!creators?.services?.completion || !creators.completionAuthority) return 0;
    let accepted = 0;
    for (const s of creators.services.completion.pending({ limit: 100 })) {
      if (!isSeed(s.questId) || s.submittedAt > now - REVIEW_DELAY_MS) continue;
      try {
        creators.services.completion.review({
          actor: creators.completionAuthority,
          operationId: `seed-completion-${s.id}`,
          submissionId: s.id,
          expectedVersion: s.version,
          decision: "accept",
          reason: "Test seed reviewer accepted this on testnet.",
        });
        accepted++;
      } catch (error) {
        log(`Test seed completion skipped ${s.id}: ${error?.code || error?.message || error}`);
      }
    }
    return accepted;
  }

  /** Economy step: buyer, task approvals, creator completions, restocking. */
  function tickEconomy(now = clock()) {
    return {
      bought: tickBuyer(now),
      approved: tickBounties(now),
      completions: tickCompletions(now),
      listings: ensureListings(now),
      bounties: ensureBounties(now),
    };
  }

  function counts() {
    const n = (sql, ...args) => db.prepare(sql).get(...args).n;
    const has = (t) => tableExists(db, t);
    return {
      players: n("SELECT count(*) n FROM players WHERE substr(id,1,5)='seed-'"),
      notes: n("SELECT count(*) n FROM messages WHERE substr(id,1,5)='seed-'"),
      openListings: n("SELECT count(*) n FROM listings WHERE substr(id,1,5)='seed-' AND state='open'"),
      openBounties: n("SELECT count(*) n FROM bounties WHERE substr(id,1,5)='seed-' AND state='open'"),
      creatorQuests: has("creator_quests")
        ? n("SELECT count(*) n FROM creator_quests WHERE substr(id,1,5)='seed-' AND state='published'")
        : 0,
      kits: n("SELECT count(*) n FROM history WHERE substr(id,1,9)='seed-kit-'"),
    };
  }

  function present() {
    return (
      !!db.prepare("SELECT 1 FROM daily_jobs WHERE substr(job_key,1,?)=?").get(MARKER_PREFIX.length, MARKER_PREFIX) ||
      !!db.prepare("SELECT 1 FROM players WHERE substr(id,1,5)='seed-' LIMIT 1").get() ||
      !!db.prepare("SELECT 1 FROM history WHERE substr(id,1,9)='seed-kit-' LIMIT 1").get()
    );
  }

  function status() {
    return { version: SEED_VERSION, applied: present(), ...counts() };
  }

  /** Removes every seed row and reverts starter kits. One transaction; a failure changes nothing. */
  function purge() {
    if (!present()) return { removed: 0 };
    const fkKey = (r) => `${r.table}:${r.rowid}`;
    const baseline = new Set(db.prepare("PRAGMA foreign_key_check").all().map(fkKey));
    return atomic(db, () => {
      db.exec("PRAGMA defer_foreign_keys=ON");
      // Kits gave real explorers XP and shards; take back what is still there.
      // XP never drops below what the explorer has locked in creator quests.
      const locked = tableExists(db, "creator_xp_commitments")
        ? db.prepare("SELECT COALESCE(SUM(amount),0) n FROM creator_xp_commitments WHERE author=? AND released_at IS NULL AND substr(quest_id,1,5)!='seed-'")
        : null;
      for (const kit of db.prepare("SELECT player_id,meta FROM history WHERE substr(id,1,9)='seed-kit-'").all()) {
        const meta = JSON.parse(kit.meta || "{}");
        const floor = locked ? locked.get(kit.player_id).n : 0;
        db.prepare("UPDATE players SET xp=MAX(?,xp-?) WHERE id=?").run(floor, Number(meta.xp) || 0, kit.player_id);
        if (tableExists(db, "actor_shards"))
          for (const [element, count] of Object.entries(meta.shards || {}))
            db.prepare("UPDATE actor_shards SET count=MAX(0,count-?) WHERE player_id=? AND element=?").run(
              Number(count) || 0,
              kit.player_id,
              element,
            );
      }
      let removed = 0;
      const tables = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
        .all()
        .map((t) => t.name);
      for (const table of tables) {
        const columns = db
          .prepare(`PRAGMA table_info(${quote(table)})`)
          .all()
          .map((c) => c.name)
          .filter((c) => REFERENCE_COLUMNS.includes(c));
        if (!columns.length) continue;
        const where = columns.map((c) => `substr(${quote(c)},1,5)='seed-'`).join(" OR ");
        removed += Number(db.prepare(`DELETE FROM ${quote(table)} WHERE ${where}`).run().changes);
      }
      // Creator money jobs name quests only inside their JSON arguments.
      if (tableExists(db, "creator_money_jobs"))
        removed += Number(
          db
            .prepare(
              "DELETE FROM creator_money_jobs WHERE state IN ('queued','retrying') AND substr(COALESCE(json_extract(args,'$.quest_id'),''),1,5)='seed-'",
            )
            .run().changes,
        );
      // Rows real explorers made that point at removed seed rows.
      for (let round = 0; round < 10; round++) {
        const orphans = db
          .prepare("PRAGMA foreign_key_check")
          .all()
          .filter((r) => r.rowid !== null && !baseline.has(fkKey(r)));
        if (!orphans.length) break;
        for (const r of orphans)
          removed += Number(db.prepare(`DELETE FROM ${quote(r.table)} WHERE rowid=?`).run(r.rowid).changes);
      }
      db.prepare("DELETE FROM daily_jobs WHERE substr(job_key,1,?)=?").run(MARKER_PREFIX.length, MARKER_PREFIX);
      return { removed };
    });
  }

  return { apply, purge, status, grantKit, tickPresence, tickEconomy };
}
