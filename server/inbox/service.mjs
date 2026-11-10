// Encrypted player inbox (docs/PLAYER-INBOX.md).
//
// Messages are end-to-end encrypted on the explorers' devices (server/inbox/crypto.mjs,
// keys in the signing origin) and written by the sender to NEAR Social under
// `<sender>/questlayer/inbox/msg_<uuid>`, relayed like every other game record.
// This server never holds an inbox key and never sees plaintext. It keeps:
//   - who may write to whom (mutual wave or an accepted request, blocks both ways),
//   - an index of ciphertext records for delivery and unread counts, filled
//     only after the record is confirmed on chain,
//   - reports, which carry the reporter's disclosed single-message key so a
//     moderator can read exactly that message and nothing else.
import { assert, id } from "../domain.mjs";
import { isSocialBlocked } from "../social-content.mjs";
import { ensureModuleVersion, registerModuleSchema } from "../schema-compatibility.mjs";
import {
  INBOX_KEY_SCHEMA,
  MESSAGE_ID,
  PUBLIC_KEY,
  fromBase64Url,
  openWithMessageKey,
  validInboxKeyRecord,
  validInboxRecord,
} from "./crypto.mjs";

export const INBOX_LIMITS = Object.freeze({
  perSenderHour: 30,
  perSenderDay: 150,
  perReceiverHour: 120,
  pairGapMs: 2000,
  requestsPerDay: 10,
  openRequests: 20,
  reportsPerDay: 10,
  muteReports: 3,
  muteWindowMs: 7 * 86_400_000,
  pendingMs: 15 * 60_000,
});
export const INBOX_REPORT_REASONS = ["spam", "harassment", "privacy", "other"];

export const INBOX_SCHEMA_MODULE = registerModuleSchema({
  name: "player-inbox",
  version: 1,
  sql: `CREATE TABLE IF NOT EXISTS inbox_keys(player_id TEXT PRIMARY KEY REFERENCES players(id),account_id TEXT NOT NULL,public_key TEXT NOT NULL,updated_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS inbox_contacts(a_id TEXT NOT NULL REFERENCES players(id),b_id TEXT NOT NULL REFERENCES players(id),state TEXT NOT NULL CHECK(state IN('requested','open','declined')),requested_by TEXT NOT NULL,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL,PRIMARY KEY(a_id,b_id),CHECK(a_id<b_id));
CREATE INDEX IF NOT EXISTS inbox_contacts_b ON inbox_contacts(b_id,state);
CREATE TABLE IF NOT EXISTS inbox_messages(id TEXT PRIMARY KEY,sender_id TEXT NOT NULL REFERENCES players(id),recipient_id TEXT NOT NULL REFERENCES players(id),sender_account TEXT NOT NULL,recipient_account TEXT NOT NULL,record TEXT NOT NULL,state TEXT NOT NULL CHECK(state IN('pending','delivered','failed')),created_at INTEGER NOT NULL,confirmed_at INTEGER,read_at INTEGER,CHECK(sender_id!=recipient_id));
CREATE INDEX IF NOT EXISTS inbox_messages_recipient ON inbox_messages(recipient_id,state,read_at);
CREATE INDEX IF NOT EXISTS inbox_messages_sender ON inbox_messages(sender_id,created_at);
CREATE INDEX IF NOT EXISTS inbox_messages_pending ON inbox_messages(state,created_at);
CREATE TABLE IF NOT EXISTS inbox_reports(id TEXT PRIMARY KEY,message_id TEXT NOT NULL REFERENCES inbox_messages(id),reporter_id TEXT NOT NULL REFERENCES players(id),sender_id TEXT NOT NULL REFERENCES players(id),reason TEXT NOT NULL,text TEXT,state TEXT NOT NULL CHECK(state IN('open','resolved')),created_at INTEGER NOT NULL,resolved_at INTEGER,UNIQUE(message_id,reporter_id));
CREATE INDEX IF NOT EXISTS inbox_reports_sender ON inbox_reports(sender_id,state,created_at);
CREATE TABLE IF NOT EXISTS inbox_mutes(player_id TEXT PRIMARY KEY REFERENCES players(id),reason TEXT NOT NULL,created_at INTEGER NOT NULL)`,
});

const PLAYER = /^player_[a-f0-9-]{36}$/;
const pair = (x, y) => (x < y ? [x, y] : [y, x]);
// SocialDB may return fields in another order; compare field by field.
const sameRecord = (a, b) =>
  Object.keys(a).length === Object.keys(b).length && Object.keys(b).every((k) => a[k] === b[k]);
const leaf = (o, ...path) => path.reduce((v, k) => (v && typeof v === "object" ? v[k] : undefined), o);

/** SocialDB reads the inbox needs; `view(method,args,fresh)` is a NativeContractReader. */
export function socialInboxReader(reader) {
  return {
    contractId: reader.contractId,
    async key(accountId) {
      const r = leaf(await reader.view("get", { keys: [`${accountId}/questlayer/inbox_key/**`] }, true), accountId, "questlayer", "inbox_key");
      return validInboxKeyRecord(r) ? r : null;
    },
    async messages(list) {
      if (!list.length) return [];
      const data = await reader.view("get", { keys: list.map((m) => `${m.sender}/questlayer/inbox/${m.id}/**`) }, true);
      return list.map((m) => {
        const r = leaf(data, m.sender, "questlayer", "inbox", m.id);
        return validInboxRecord(r) ? r : null;
      });
    },
    async deposit(accountId) {
      const b = await reader.view("storage_balance_of", { account_id: accountId }, true);
      return b && BigInt(b.available) >= 10n ** 22n ? "1" : (5n * 10n ** 22n).toString();
    },
  };
}

export class PlayerInbox {
  constructor(db, social, { clock = Date.now, isModerator = () => false } = {}) {
    this.db = db;
    this.social = social;
    this.clock = clock;
    this.isModerator = isModerator;
    ensureModuleVersion(db, INBOX_SCHEMA_MODULE);
  }
  get contractId() {
    return this.social.contractId;
  }
  account(player) {
    const row = this.db.prepare("SELECT native_account FROM players WHERE id=?").get(player);
    const account = row?.native_account;
    return account && this.db.prepare("SELECT 1 FROM wallet_links WHERE player_id=? AND account_id=?").get(player, account)
      ? account
      : null;
  }
  requireAccount(player) {
    const account = this.account(player);
    assert(account, "Your explorer account is still being set up. Try again in a moment.", 409, "INBOX_NO_ACCOUNT");
    return account;
  }
  key(player) {
    return this.db.prepare("SELECT account_id,public_key FROM inbox_keys WHERE player_id=?").get(player) || null;
  }
  peer(player, target) {
    assert(typeof target === "string" && PLAYER.test(target) && target !== player, "Invalid explorer.", 400);
    const row = this.db.prepare("SELECT id,name FROM players WHERE id=?").get(target);
    assert(row && !isSocialBlocked(this.db, player, target), "This explorer is not available.", 404);
    return row;
  }
  contact(x, y) {
    const [a, b] = pair(x, y);
    return this.db.prepare("SELECT * FROM inbox_contacts WHERE a_id=? AND b_id=?").get(a, b) || null;
  }
  muted(player) {
    return !!this.db.prepare("SELECT 1 FROM inbox_mutes WHERE player_id=?").get(player);
  }
  mutualWave(x, y, now) {
    try {
      const n = (from, to) =>
        this.db.prepare("SELECT 1 FROM player_waves WHERE from_id=? AND to_id=? AND created_at>?").get(from, to, now - 3600_000);
      return !!(n(x, y) && n(y, x));
    } catch {
      return false;
    }
  }
  /** What the conversation with `target` allows right now. */
  relation(player, target) {
    const c = this.contact(player, target),
      now = this.clock();
    const state = c?.state === "open" || this.mutualWave(player, target, now)
      ? "open"
      : c?.state === "requested"
        ? c.requested_by === player ? "requested" : "incoming"
        : c?.state === "declined" ? "declined" : "none";
    return state;
  }

  // ---- keys
  async keyQuote(player, publicKey) {
    const accountId = this.requireAccount(player);
    assert(typeof publicKey === "string" && PUBLIC_KEY.test(publicKey), "Invalid inbox key.");
    fromBase64Url(publicKey);
    const record = {
      schema: INBOX_KEY_SCHEMA,
      key: publicKey,
      created_at: String(this.clock()),
      mutation_id: id("inboxkey"),
    };
    return {
      receiverId: this.contractId,
      accountId,
      methodName: "set",
      gas: "80000000000000",
      deposit: await this.social.deposit(accountId),
      record,
      args: { data: { [accountId]: { questlayer: { inbox_key: record } } } },
    };
  }
  /** Reads the published key from chain and remembers it for delivery. */
  async syncKey(player) {
    const accountId = this.requireAccount(player);
    const record = await this.social.key(accountId);
    if (!record) return { published: false, publicKey: null };
    this.db
      .prepare(
        "INSERT INTO inbox_keys(player_id,account_id,public_key,updated_at) VALUES(?,?,?,?) ON CONFLICT(player_id) DO UPDATE SET account_id=excluded.account_id,public_key=excluded.public_key,updated_at=excluded.updated_at",
      )
      .run(player, accountId, record.key, this.clock());
    return { published: true, publicKey: record.key };
  }

  // ---- consent
  request(player, target) {
    const peer = this.peer(player, target),
      now = this.clock();
    this.requireAccount(player);
    assert(!this.muted(player), "Your messages are paused while a moderator reviews reports.", 403, "INBOX_MUTED");
    const state = this.relation(player, target);
    if (state === "open") return this.openContact(player, target, now, peer);
    if (state === "incoming") return this.answer(player, target, true);
    assert(state !== "declined" || this.contact(player, target).requested_by !== player, "This explorer declined your request.", 403, "INBOX_DECLINED");
    if (state === "requested") return { state, peer: { id: peer.id, name: peer.name } };
    const n = (sql, ...a) => this.db.prepare(sql).get(...a).n;
    assert(
      n("SELECT COUNT(*) AS n FROM inbox_contacts WHERE requested_by=? AND created_at>?", player, now - 86_400_000) < INBOX_LIMITS.requestsPerDay,
      "That is a lot of message requests today. Try again tomorrow.",
      429,
    );
    assert(
      n("SELECT COUNT(*) AS n FROM inbox_contacts WHERE requested_by=? AND state='requested'", player) < INBOX_LIMITS.openRequests,
      "Wait until some of your requests are answered.",
      429,
    );
    const [a, b] = pair(player, target);
    this.db
      .prepare(
        "INSERT INTO inbox_contacts(a_id,b_id,state,requested_by,created_at,updated_at) VALUES(?,?,'requested',?,?,?) ON CONFLICT(a_id,b_id) DO UPDATE SET state='requested',requested_by=excluded.requested_by,updated_at=excluded.updated_at",
      )
      .run(a, b, player, now, now);
    return { state: "requested", peer: { id: peer.id, name: peer.name } };
  }
  openContact(player, target, now, peer) {
    const [a, b] = pair(player, target);
    this.db
      .prepare(
        "INSERT INTO inbox_contacts(a_id,b_id,state,requested_by,created_at,updated_at) VALUES(?,?,'open',?,?,?) ON CONFLICT(a_id,b_id) DO UPDATE SET state='open',updated_at=excluded.updated_at",
      )
      .run(a, b, player, now, now);
    return { state: "open", peer: { id: peer.id, name: peer.name } };
  }
  answer(player, target, accept) {
    const peer = this.peer(player, target),
      c = this.contact(player, target);
    assert(c?.state === "requested" && c.requested_by === target, "There is no request from this explorer.", 404);
    const now = this.clock();
    if (accept) return this.openContact(player, target, now, peer);
    this.db.prepare("UPDATE inbox_contacts SET state='declined',updated_at=? WHERE a_id=? AND b_id=?").run(now, c.a_id, c.b_id);
    return { state: "declined", peer: { id: peer.id, name: peer.name } };
  }

  // ---- sending
  async sendQuote(player, input) {
    const target = input?.playerId,
      messageId = input?.messageId,
      record = input?.record;
    const peer = this.peer(player, target),
      now = this.clock();
    const accountId = this.requireAccount(player);
    assert(!this.muted(player), "Your messages are paused while a moderator reviews reports.", 403, "INBOX_MUTED");
    assert(this.relation(player, target) === "open", "Wave at each other or wait until they accept your request.", 403, "INBOX_NO_CONSENT");
    assert(typeof messageId === "string" && MESSAGE_ID.test(messageId), "Invalid message.");
    assert(validInboxRecord(record), "The encrypted message has an invalid format.");
    assert(Math.abs(Number(record.created_at) - now) < 10 * 60_000, "Your device clock is off. Try again.");
    const mine = this.key(player),
      theirs = this.key(target),
      peerAccount = this.account(target);
    assert(peerAccount && theirs?.account_id === peerAccount, "This explorer has not opened their inbox yet.", 409, "INBOX_PEER_KEY");
    assert(mine?.account_id === accountId && record.from_key === mine.public_key, "Set up your inbox on this device first.", 409, "INBOX_OWN_KEY");
    assert(record.to_key === theirs.public_key, "This explorer changed their inbox key. Open the conversation again.", 409, "INBOX_PEER_KEY");
    const n = (sql, ...a) => this.db.prepare(sql).get(...a).n;
    assert(!this.db.prepare("SELECT 1 FROM inbox_messages WHERE id=?").get(messageId), "This message was already sent.", 409);
    assert(
      !n("SELECT COUNT(*) AS n FROM inbox_messages WHERE sender_id=? AND recipient_id=? AND created_at>?", player, target, now - INBOX_LIMITS.pairGapMs),
      "Slow down a little.",
      429,
    );
    assert(
      n("SELECT COUNT(*) AS n FROM inbox_messages WHERE sender_id=? AND created_at>? AND state!='failed'", player, now - 3600_000) < INBOX_LIMITS.perSenderHour,
      "That is a lot of messages. Try again later.",
      429,
    );
    assert(
      n("SELECT COUNT(*) AS n FROM inbox_messages WHERE sender_id=? AND created_at>? AND state!='failed'", player, now - 86_400_000) < INBOX_LIMITS.perSenderDay,
      "You reached today's message limit.",
      429,
    );
    assert(
      n("SELECT COUNT(*) AS n FROM inbox_messages WHERE recipient_id=? AND created_at>? AND state!='failed'", target, now - 3600_000) < INBOX_LIMITS.perReceiverHour,
      "This explorer has had many messages. Try again later.",
      429,
    );
    const deposit = await this.social.deposit(accountId);
    this.db
      .prepare(
        "INSERT INTO inbox_messages(id,sender_id,recipient_id,sender_account,recipient_account,record,state,created_at) VALUES(?,?,?,?,?,?,'pending',?)",
      )
      .run(messageId, player, target, accountId, peerAccount, JSON.stringify(record), now);
    return {
      receiverId: this.contractId,
      accountId,
      methodName: "set",
      gas: "80000000000000",
      deposit,
      messageId,
      peer: { id: peer.id, name: peer.name },
      args: { data: { [accountId]: { questlayer: { inbox: { [messageId]: record } } } } },
    };
  }
  /** Marks pending messages delivered once their exact record is on chain. */
  async confirm(rows) {
    const now = this.clock();
    const live = rows.filter((r) => r.state === "pending");
    if (!live.length) return 0;
    const found = await this.social.messages(live.map((r) => ({ sender: r.sender_account, id: r.id })));
    let delivered = 0;
    live.forEach((row, n) => {
      const chain = found[n];
      if (chain && sameRecord(chain, JSON.parse(row.record))) {
        delivered += this.db
          .prepare("UPDATE inbox_messages SET state='delivered',confirmed_at=? WHERE id=? AND state='pending'")
          .run(now, row.id).changes;
      } else if (now - row.created_at > INBOX_LIMITS.pendingMs) {
        this.db.prepare("UPDATE inbox_messages SET state='failed' WHERE id=? AND state='pending'").run(row.id);
      }
    });
    return delivered;
  }
  async confirmMessage(player, messageId) {
    assert(typeof messageId === "string" && MESSAGE_ID.test(messageId), "Invalid message.");
    const row = this.db.prepare("SELECT * FROM inbox_messages WHERE id=? AND sender_id=?").get(messageId, player);
    assert(row, "Unknown message.", 404);
    await this.confirm([row]);
    return { state: this.db.prepare("SELECT state FROM inbox_messages WHERE id=?").get(messageId).state };
  }
  async confirmPending(limit = 20) {
    const now = this.clock();
    const rows = this.db
      .prepare("SELECT * FROM inbox_messages WHERE state='pending' AND created_at<? ORDER BY created_at LIMIT ?")
      .all(now - 3000, limit);
    return this.confirm(rows);
  }

  // ---- reading
  summary(player) {
    const unread = this.db
      .prepare(
        "SELECT COUNT(*) AS n FROM inbox_messages m WHERE m.recipient_id=? AND m.state='delivered' AND m.read_at IS NULL AND NOT EXISTS(SELECT 1 FROM social_blocks b WHERE (b.actor_id=m.recipient_id AND b.target_id=m.sender_id) OR (b.actor_id=m.sender_id AND b.target_id=m.recipient_id))",
      )
      .get(player).n;
    const requests = this.incoming(player).length;
    return { unread, requests };
  }
  incoming(player) {
    return this.db
      .prepare(
        `SELECT c.requested_by AS id,p.name,c.updated_at AS at FROM inbox_contacts c JOIN players p ON p.id=c.requested_by
         WHERE (c.a_id=? OR c.b_id=?) AND c.state='requested' AND c.requested_by!=? ORDER BY c.updated_at DESC LIMIT 50`,
      )
      .all(player, player, player)
      .filter((r) => !isSocialBlocked(this.db, player, r.id));
  }
  overview(player) {
    const account = this.account(player),
      key = this.key(player);
    const rows = this.db
      .prepare(
        `SELECT CASE WHEN c.a_id=? THEN c.b_id ELSE c.a_id END AS peer,c.state,c.requested_by,c.updated_at FROM inbox_contacts c
         WHERE (c.a_id=? OR c.b_id=?) AND c.state IN('open','requested') ORDER BY c.updated_at DESC LIMIT 100`,
      )
      .all(player, player, player);
    const conversations = [];
    for (const c of rows) {
      if (isSocialBlocked(this.db, player, c.peer)) continue;
      const peer = this.db.prepare("SELECT id,name FROM players WHERE id=?").get(c.peer);
      if (!peer) continue;
      const last = this.db
        .prepare(
          "SELECT id,sender_id,created_at FROM inbox_messages WHERE ((sender_id=? AND recipient_id=?) OR (sender_id=? AND recipient_id=?)) AND state='delivered' ORDER BY created_at DESC LIMIT 1",
        )
        .get(player, c.peer, c.peer, player);
      const unread = this.db
        .prepare("SELECT COUNT(*) AS n FROM inbox_messages WHERE sender_id=? AND recipient_id=? AND state='delivered' AND read_at IS NULL")
        .get(c.peer, player).n;
      conversations.push({
        playerId: peer.id,
        name: peer.name,
        state: this.relation(player, c.peer),
        unread,
        lastAt: last?.created_at ?? c.updated_at,
        lastMine: last ? last.sender_id === player : null,
      });
    }
    conversations.sort((x, y) => y.lastAt - x.lastAt);
    return {
      enabled: true,
      accountId: account,
      publicKey: key?.account_id === account ? key.public_key : null,
      muted: this.muted(player),
      conversations,
      incoming: this.incoming(player),
      ...this.summary(player),
    };
  }
  thread(player, target, { before } = {}) {
    const peer = this.peer(player, target);
    const cutoff = Number.isSafeInteger(Number(before)) && Number(before) > 0 ? Number(before) : Number.MAX_SAFE_INTEGER;
    const rows = this.db
      .prepare(
        `SELECT id,sender_id,sender_account,recipient_account,state,created_at,read_at FROM inbox_messages
         WHERE ((sender_id=? AND recipient_id=?) OR (sender_id=? AND recipient_id=? AND state='delivered'))
           AND state!='failed' AND created_at<? ORDER BY created_at DESC LIMIT 40`,
      )
      .all(player, target, target, player, cutoff);
    this.db
      .prepare("UPDATE inbox_messages SET read_at=? WHERE sender_id=? AND recipient_id=? AND state='delivered' AND read_at IS NULL")
      .run(this.clock(), target, player);
    const peerKey = this.key(target),
      peerAccount = this.account(target);
    return {
      peer: {
        id: peer.id,
        name: peer.name,
        accountId: peerAccount,
        inbox: !!peerAccount && peerKey?.account_id === peerAccount,
      },
      state: this.relation(player, target),
      muted: this.muted(player),
      contractId: this.contractId,
      messages: rows.reverse().map((r) => ({
        id: r.id,
        mine: r.sender_id === player,
        sender: r.sender_account,
        recipient: r.recipient_account,
        state: r.state,
        at: r.created_at,
      })),
    };
  }

  // ---- reports
  report(player, input) {
    const messageId = input?.messageId,
      reason = input?.reason,
      now = this.clock();
    assert(typeof messageId === "string" && MESSAGE_ID.test(messageId), "Invalid message.");
    assert(INBOX_REPORT_REASONS.includes(reason), "Choose a report reason.");
    const row = this.db
      .prepare("SELECT * FROM inbox_messages WHERE id=? AND recipient_id=? AND state='delivered'")
      .get(messageId, player);
    assert(row, "You can report only messages you received.", 404);
    const existing = this.db.prepare("SELECT id,state FROM inbox_reports WHERE message_id=? AND reporter_id=?").get(messageId, player);
    if (existing) return { id: existing.id, state: existing.state, replayed: true };
    assert(
      this.db.prepare("SELECT COUNT(*) AS n FROM inbox_reports WHERE reporter_id=? AND created_at>?").get(player, now - 86_400_000).n <
        INBOX_LIMITS.reportsPerDay,
      "The daily report limit is reached. Try again tomorrow.",
      429,
    );
    // The disclosed key opens exactly this on-chain record; the moderator sees
    // the verified text. Without a key the report still counts, unread.
    let text = null;
    if (input.messageKey != null) {
      try {
        text = openWithMessageKey(fromBase64Url(String(input.messageKey)), row.sender_account, row.id, JSON.parse(row.record));
      } catch {
        assert(false, "The message key does not open this message.", 400);
      }
    }
    const reportId = id("inboxreport");
    this.db
      .prepare("INSERT INTO inbox_reports(id,message_id,reporter_id,sender_id,reason,text,state,created_at) VALUES(?,?,?,?,?,?,'open',?)")
      .run(reportId, messageId, player, row.sender_id, reason, text, now);
    const reporters = this.db
      .prepare("SELECT COUNT(DISTINCT reporter_id) AS n FROM inbox_reports WHERE sender_id=? AND state='open' AND created_at>?")
      .get(row.sender_id, now - INBOX_LIMITS.muteWindowMs).n;
    if (reporters >= INBOX_LIMITS.muteReports)
      this.db
        .prepare("INSERT OR IGNORE INTO inbox_mutes(player_id,reason,created_at) VALUES(?,?,?)")
        .run(row.sender_id, `${reporters} reports`, now);
    return { id: reportId, state: "open", verified: text != null, replayed: false };
  }
  reports(player) {
    assert(this.isModerator(player), "Only moderators can review reports.", 403);
    return {
      reports: this.db
        .prepare(
          `SELECT r.id,r.message_id AS messageId,r.reason,r.text,r.created_at AS at,r.sender_id AS senderId,s.name AS sender,
           r.reporter_id AS reporterId,m.sender_account AS senderAccount,EXISTS(SELECT 1 FROM inbox_mutes WHERE player_id=r.sender_id) AS muted
           FROM inbox_reports r JOIN inbox_messages m ON m.id=r.message_id JOIN players s ON s.id=r.sender_id
           WHERE r.state='open' ORDER BY r.created_at LIMIT 100`,
        )
        .all()
        .map((r) => ({ ...r, muted: !!r.muted })),
    };
  }
  resolve(player, input) {
    assert(this.isModerator(player), "Only moderators can review reports.", 403);
    const row = this.db.prepare("SELECT sender_id FROM inbox_reports WHERE id=?").get(input?.reportId);
    assert(row, "Unknown report.", 404);
    const now = this.clock();
    if (input.mute === true)
      this.db.prepare("INSERT OR IGNORE INTO inbox_mutes(player_id,reason,created_at) VALUES(?,?,?)").run(row.sender_id, "moderator", now);
    else {
      this.db.prepare("UPDATE inbox_reports SET state='resolved',resolved_at=? WHERE sender_id=? AND state='open'").run(now, row.sender_id);
      this.db.prepare("DELETE FROM inbox_mutes WHERE player_id=?").run(row.sender_id);
    }
    return { muted: input.mute === true };
  }
}
