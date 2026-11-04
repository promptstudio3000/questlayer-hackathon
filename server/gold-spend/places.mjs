// Place messages (QGOLD build plan, stream 4; doc "Vzkazy na místě").
//   - shout: up to 140 characters (emoji welcome) as a bubble at a place,
//     paid per day of display, at most 7 days, no replies;
//   - topic: an opening message with a discussion (trollbox) under it. The
//     founder pays the first days, anyone can pay to keep it alive. Posting is
//     free from level 2. Once more than five different players have written in
//     it (freeAuthors = 6 distinct authors, the founder included) it stays free
//     for good, and it is archived only after ~90 days with no post and no read.
//   - the local feed: everything public within 1–10 km, sorted latest,
//     following, popular or recommended.
// Money for a deleted or hidden message is not returned. Exact GPS is never
// published: the map anchor is the place the player stood at, and the
// SocialDB record (server/gold-spend/social.mjs) carries a geohash-7 cell.
import { latLngToCell } from "h3-js";
import { assert, distance, id, levelFor, point, validateFix } from "../domain.mjs";
import { atomic } from "../database.mjs";
import { screenText, clean } from "../ai/text-policy.mjs";
import { isSocialBlocked, initSocialBlocks } from "../social-content.mjs";
import { burnGold, ensureGoldSpend, GOLD_SPEND, priceU } from "./ledger.mjs";

const DAY = 86_400_000;
export const PLACES = GOLD_SPEND.places;
const THREAD_ID = /^place_[a-f0-9-]{36}$/;
const POST_ID = /^post_[a-f0-9-]{36}$/;
const REPORT_REASONS = ["spam", "harassment", "unsafe-place", "privacy", "other"];
// A Czech house number ("Husova 1234/12"), a flat or a "street + number"
// reads as a private address; the place on the map is already the anchor.
const ADDRESS = /(?<![\p{N}])\d{1,5}\/\d{1,4}[a-z]?(?![\p{N}])|(?<![\p{L}\p{N}])(?:byt|flat|apt\.?|apartment|č\.\s?p\.|ul\.|ulice|street|st\.)\s*(?:\p{L}+\s+)?\d+/iu;

/** Clean and screen player text; throws with a reason the player can act on. */
export function placeText(value, max, label = "A message") {
  assert(typeof value === "string", `${label} is empty.`, 400, "TEXT");
  const text = clean(value);
  assert(text.length >= 1 && [...text].length <= max, `${label} must contain 1–${max} characters.`, 400, "TEXT");
  const bad = screenText(text, ["link-or-contact", "markup", "credential-request"]);
  assert(!bad, bad === "link-or-contact" ? "Links, phone numbers and e-mails are not allowed here." : "Please rephrase this message.", 400, "TEXT_POLICY");
  assert(!ADDRESS.test(text), "Leave out private addresses. The place on the map is enough.", 400, "TEXT_ADDRESS");
  return text;
}

export function createPlaces(db, { now = () => Date.now(), levelOf = null } = {}) {
  ensureGoldSpend(db);
  initSocialBlocks(db);
  const level = (player) =>
    levelOf ? levelOf(player) : levelFor(db.prepare("SELECT xp FROM players WHERE id=?").get(player)?.xp || 0);
  const name = (player) => db.prepare("SELECT name FROM players WHERE id=?").get(player)?.name || "Explorer";
  const thread = (threadId) => {
    assert(typeof threadId === "string" && THREAD_ID.test(threadId), "Message not found.", 404, "PLACE_NOT_FOUND");
    const t = db.prepare("SELECT * FROM place_threads WHERE id=?").get(threadId);
    assert(t, "Message not found.", 404, "PLACE_NOT_FOUND");
    return t;
  };
  // Archived and lapsed messages leave the map; only the author still sees them.
  const live = (t, at) => t.state === "published" && (t.free_forever === 1 || t.paid_until > at);
  function sweep(at = now()) {
    db.prepare(
      "UPDATE place_threads SET state='archived' WHERE state='published' AND free_forever=1 AND last_post_at<? AND last_read_at<?",
    ).run(at - PLACES.archiveDays * DAY, at - PLACES.archiveDays * DAY);
  }
  function view(t, player, at, { full = false } = {}) {
    const following = player ? !!db.prepare("SELECT 1 FROM place_follows WHERE player_id=? AND target_id=?").get(player, t.author) : false;
    return {
      id: t.id,
      kind: t.kind,
      title: t.title,
      text: t.state === "published" ? t.text : "",
      author: { id: t.author, name: name(t.author), following },
      mine: t.author === player,
      lat: t.lat,
      lng: t.lng,
      place: t.place,
      state: live(t, at) ? "live" : t.state === "published" ? "lapsed" : t.state,
      paidUntil: t.paid_until,
      freeForever: t.free_forever === 1,
      posts: t.posts,
      authors: t.authors,
      reads: t.reads,
      createdAt: t.created_at,
      lastPostAt: t.last_post_at,
      social: { state: t.social_state, account: t.social_account },
      ...(full
        ? {
            replies: db
              .prepare("SELECT * FROM place_posts WHERE thread_id=? AND state='published' ORDER BY created_at LIMIT 300")
              .all(t.id)
              .filter((p) => !player || !isSocialBlocked(db, player, p.author))
              .map((p) => ({ id: p.id, text: p.text, author: { id: p.author, name: name(p.author) }, mine: p.author === player, createdAt: p.created_at })),
          }
        : {}),
    };
  }

  function days(value) {
    assert(Number.isInteger(value) && value >= 1 && value <= PLACES.maxDays, `Pick 1–${PLACES.maxDays} days.`, 400, "DAYS");
    return value;
  }

  /** Leave a shout or open a topic where the player stands (GPS or demo walk). */
  function create(player, input = {}) {
    assert(player, "Sign in to leave a message.", 401, "AUTH");
    const kind = input.kind;
    assert(kind === "shout" || kind === "topic", "Pick a shout or a topic.", 400, "PLACE_KIND");
    const at = now();
    const here = point(input);
    if (!input.arena) validateFix(input.fix || {}, here, at);
    const d = days(input.days),
      text = placeText(input.text, kind === "shout" ? PLACES.shoutChars : PLACES.topicChars),
      title = kind === "topic" ? placeText(input.title, PLACES.titleChars, "A title") : "",
      place = typeof input.place === "string" ? clean(input.place).slice(0, 80) : "";
    assert(input.publicConsent === true, "Confirm that this message is public.", 400, "CONSENT");
    const perDay = kind === "shout" ? PLACES.shoutPerDay : PLACES.topicPerDay;
    return atomic(db, () => {
      sweep(at);
      const mine = db
        .prepare("SELECT COUNT(*) AS n FROM place_threads WHERE author=? AND state='published' AND (free_forever=1 OR paid_until>?)")
        .get(player, at).n;
      assert(mine < PLACES.perPlayerActive, `You have ${PLACES.perPlayerActive} live messages. Let one expire first.`, 429, "PLACE_LIMIT");
      const threadId = id("place");
      const burn = burnGold(db, { player, kind, ref: threadId, amountU: priceU(perDay * d), title: kind === "shout" ? `Shout for ${d} d` : `Topic for ${d} d`, now: at });
      db.prepare(
        "INSERT INTO place_threads(id,kind,author,title,text,lat,lng,cell,place,paid_until,free_forever,state,posts,authors,reads,paid_u,last_post_at,last_read_at,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,0,'published',0,1,0,?,?,?,?)",
      ).run(threadId, kind, player, title, text, here.lat, here.lng, latLngToCell(here.lat, here.lng, 7), place, at + d * DAY, burn.amountU, at, at, at);
      return { thread: view(thread(threadId), player, at), burn, balanceU: burn.balanceU };
    });
  }

  /** Pay more days. A shout can't pass 7 days from its start; anyone can feed a topic. */
  function extend(player, threadId, input = {}) {
    assert(player, "Sign in first.", 401, "AUTH");
    const at = now(),
      d = days(input.days);
    return atomic(db, () => {
      const t = thread(threadId);
      assert(t.state === "published", "This message is no longer on the map.", 409, "PLACE_GONE");
      assert(!t.free_forever, "This topic is already free for good.", 409, "PLACE_FREE");
      assert(t.kind === "topic" || t.author === player, "Only the author can extend a shout.", 403, "PLACE_OWNER");
      const from = Math.max(at, t.paid_until),
        until = from + d * DAY;
      if (t.kind === "shout") assert(until <= t.created_at + PLACES.maxDays * DAY + 60_000, `A shout lasts at most ${PLACES.maxDays} days.`, 409, "SHOUT_MAX");
      const burn = burnGold(db, { player, kind: t.kind, ref: t.id, amountU: priceU((t.kind === "shout" ? PLACES.shoutPerDay : PLACES.topicPerDay) * d), title: `Kept ${t.kind} alive for ${d} d`, now: at });
      db.prepare("UPDATE place_threads SET paid_until=?,paid_u=paid_u+? WHERE id=?").run(until, burn.amountU, t.id);
      return { thread: view(thread(t.id), player, at), burn, balanceU: burn.balanceU };
    });
  }

  /** Write in a topic: free, from level 2, a few per minute. */
  function post(player, threadId, input = {}) {
    assert(player, "Sign in to write.", 401, "AUTH");
    const at = now();
    assert(level(player) >= PLACES.postLevel, `Writing in topics opens at level ${PLACES.postLevel}.`, 403, "PLACE_LEVEL");
    const text = placeText(input.text, PLACES.postChars);
    return atomic(db, () => {
      const t = thread(threadId);
      assert(t.kind === "topic", "Shouts take no replies.", 409, "SHOUT_NO_REPLY");
      assert(live(t, at), "This topic is no longer on the map.", 409, "PLACE_GONE");
      assert(!isSocialBlocked(db, player, t.author), "You can't write here.", 403, "BLOCKED");
      const recent = db.prepare("SELECT COUNT(*) AS n FROM place_posts WHERE author=? AND created_at>?").get(player, at - 60_000).n;
      assert(recent < 6, "Slow down a little before the next post.", 429, "RATE_LIMITED");
      const postId = id("post");
      db.prepare("INSERT INTO place_posts(id,thread_id,author,text,state,created_at) VALUES(?,?,?,?,'published',?)").run(postId, t.id, player, text, at);
      const authors = db
        .prepare("SELECT COUNT(DISTINCT author) AS n FROM (SELECT author FROM place_posts WHERE thread_id=? AND state='published' UNION SELECT ?)")
        .get(t.id, t.author).n;
      const free = t.free_forever === 1 || authors >= PLACES.freeAuthors ? 1 : 0;
      db.prepare("UPDATE place_threads SET posts=posts+1,authors=?,free_forever=?,last_post_at=? WHERE id=?").run(authors, free, at, t.id);
      return { thread: view(thread(t.id), player, at, { full: true }), postId, becameFree: free === 1 && t.free_forever === 0 };
    });
  }

  /** Open a message: counts a read (once per player per hour) and keeps the topic from archiving. */
  function open(player, threadId) {
    const at = now(),
      t = thread(threadId);
    assert(t.state === "published" || t.author === player, "Message not found.", 404, "PLACE_NOT_FOUND");
    assert(!player || !isSocialBlocked(db, player, t.author), "Message not found.", 404, "PLACE_NOT_FOUND");
    if (player && t.author !== player) {
      const seen = db.prepare("SELECT read_at FROM place_reads WHERE thread_id=? AND player_id=?").get(t.id, player);
      if (!seen || seen.read_at < at - 3600_000) {
        db.prepare("INSERT INTO place_reads(thread_id,player_id,read_at) VALUES(?,?,?) ON CONFLICT(thread_id,player_id) DO UPDATE SET read_at=excluded.read_at").run(t.id, player, at);
        db.prepare("UPDATE place_threads SET reads=reads+1,last_read_at=? WHERE id=?").run(at, t.id);
      } else db.prepare("UPDATE place_threads SET last_read_at=? WHERE id=?").run(at, t.id);
    }
    return { thread: view(thread(t.id), player, at, { full: true }) };
  }

  /**
   * The local feed: live messages within radiusKm, newest first, or
   * following / popular / recommended. Blocked authors never show.
   */
  function feed(player, { lat, lng, radiusKm = 3, sort = "latest", limit = 40 } = {}) {
    const here = point({ lat, lng }),
      at = now();
    assert(PLACES.feedKm.includes(radiusKm), `Pick a radius of ${PLACES.feedKm.join(", ")} km.`, 400, "RADIUS");
    assert(["latest", "following", "popular", "recommended"].includes(sort), "Unknown sort.", 400, "SORT");
    sweep(at);
    const dLat = radiusKm / 111,
      dLng = radiusKm / (111 * Math.cos((here.lat * Math.PI) / 180));
    let rows = db
      .prepare(
        `SELECT t.* FROM place_threads t WHERE t.state='published' AND (t.free_forever=1 OR t.paid_until>?) AND t.lat BETWEEN ? AND ? AND t.lng BETWEEN ? AND ?
         ${sort === "following" ? "AND (t.author=? OR EXISTS(SELECT 1 FROM place_follows f WHERE f.player_id=? AND f.target_id=t.author))" : ""}
         ORDER BY t.last_post_at DESC LIMIT 400`,
      )
      .all(...[at, here.lat - dLat, here.lat + dLat, here.lng - dLng, here.lng + dLng, ...(sort === "following" ? [player, player] : [])])
      .map((t) => ({ t, d: distance(here, t) }))
      .filter((x) => x.d <= radiusKm * 1000 && (!player || !isSocialBlocked(db, player, x.t.author)));
    const popularity = (t) => t.posts * 3 + t.authors * 5 + t.reads;
    if (sort === "latest" || sort === "following") rows.sort((a, b) => Math.max(b.t.created_at, b.t.last_post_at) - Math.max(a.t.created_at, a.t.last_post_at));
    if (sort === "popular") rows.sort((a, b) => popularity(b.t) - popularity(a.t) || b.t.last_post_at - a.t.last_post_at);
    if (sort === "recommended") {
      // Popular, close and fresh, with a lift for people you follow.
      const score = ({ t, d }) => {
        const ageH = (at - Math.max(t.created_at, t.last_post_at)) / 3600_000,
          followed = player && db.prepare("SELECT 1 FROM place_follows WHERE player_id=? AND target_id=?").get(player, t.author) ? 1.5 : 1;
        return ((1 + popularity(t)) * followed) / (1 + d / 500) / (1 + ageH / 24);
      };
      rows = rows.map((x) => ({ ...x, s: score(x) })).sort((a, b) => b.s - a.s);
    }
    return {
      radiusKm,
      sort,
      prices: { shoutPerDay: PLACES.shoutPerDay, topicPerDay: PLACES.topicPerDay, maxDays: PLACES.maxDays, freeAuthors: PLACES.freeAuthors, postLevel: PLACES.postLevel },
      items: rows.slice(0, Math.min(100, Math.max(1, limit))).map((x) => ({ ...view(x.t, player, at), distanceM: Math.round(x.d) })),
    };
  }

  /** Map pins near a point (bubbles for shouts, chat pins for topics). */
  function pins(player, here, at = now()) {
    return feed(player, { ...here, radiusKm: 3, sort: "latest", limit: 60 }).items.map((x) => ({
      id: x.id,
      kind: x.kind,
      title: x.title,
      text: x.kind === "shout" ? x.text : x.title,
      lat: x.lat,
      lng: x.lng,
      posts: x.posts,
      mine: x.mine,
      freeForever: x.freeForever,
      paidUntil: x.paidUntil,
    }));
  }

  function follow(player, target, on = true) {
    assert(player, "Sign in first.", 401, "AUTH");
    assert(typeof target === "string" && target !== player && db.prepare("SELECT 1 FROM players WHERE id=?").get(target), "Explorer not found.", 404, "PLAYER");
    if (on) db.prepare("INSERT OR IGNORE INTO place_follows(player_id,target_id,created_at) VALUES(?,?,?)").run(player, target, now());
    else db.prepare("DELETE FROM place_follows WHERE player_id=? AND target_id=?").run(player, target);
    return { following: on };
  }

  /** The author removes a message or a post (no refund). */
  function remove(player, targetId) {
    assert(player, "Sign in first.", 401, "AUTH");
    if (POST_ID.test(targetId || "")) {
      const p = db.prepare("SELECT * FROM place_posts WHERE id=?").get(targetId);
      assert(p && p.author === player, "Only the author can remove this.", 403, "PLACE_OWNER");
      db.prepare("UPDATE place_posts SET state='deleted' WHERE id=?").run(p.id);
      return { id: p.id, state: "deleted" };
    }
    const t = thread(targetId);
    assert(t.author === player, "Only the author can remove this.", 403, "PLACE_OWNER");
    db.prepare("UPDATE place_threads SET state='deleted' WHERE id=?").run(t.id);
    return { id: t.id, state: "deleted", refund: 0 };
  }

  /** Report a message or a post; enough different reporters hide it for moderation. */
  function report(player, targetId, { reason } = {}) {
    assert(player, "Sign in first.", 401, "AUTH");
    assert(REPORT_REASONS.includes(reason), "Pick a reason.", 400, "REASON");
    const isPost = POST_ID.test(targetId || "");
    const row = isPost ? db.prepare("SELECT author FROM place_posts WHERE id=?").get(targetId) : thread(targetId);
    assert(row, "Message not found.", 404, "PLACE_NOT_FOUND");
    assert(row.author !== player, "You can remove your own message instead.", 409, "OWN");
    db.prepare("INSERT OR IGNORE INTO place_reports(target_id,reporter_id,reason,created_at) VALUES(?,?,?,?)").run(targetId, player, reason, now());
    const n = db.prepare("SELECT COUNT(*) AS n FROM place_reports WHERE target_id=?").get(targetId).n;
    if (n >= PLACES.hideAfterReports) db.prepare(`UPDATE ${isPost ? "place_posts" : "place_threads"} SET state='hidden' WHERE id=? AND state='published'`).run(targetId);
    return { reported: true, hidden: n >= PLACES.hideAfterReports };
  }

  return { create, extend, post, open, feed, pins, follow, remove, report, sweep, thread };
}
