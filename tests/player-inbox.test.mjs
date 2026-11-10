// Encrypted player inbox (docs/PLAYER-INBOX.md): crypto, consent, delivery, reports.
import test from "node:test";
import assert from "node:assert/strict";
import { openDatabase, createPlayer } from "../server/database.mjs";
import { SocialContent } from "../server/social-content.mjs";
import { PlayerInbox, INBOX_LIMITS } from "../server/inbox/service.mjs";
import { createInboxRoutes } from "../server/inbox/routes.mjs";
import { WAVES_SCHEMA } from "../server/player-waves.mjs";
import { ensureModuleVersion } from "../server/schema-compatibility.mjs";
import {
  generateInboxKey,
  sealInboxMessage,
  openInboxMessage,
  inboxMessageKey,
  openWithMessageKey,
  fromBase64Url,
  toBase64Url,
  validInboxRecord,
  validInboxText,
} from "../server/inbox/crypto.mjs";

const ALICE = "alice.players.questlayer.testnet",
  BOB = "bob.players.questlayer.testnet",
  EVE = "eve.players.questlayer.testnet";
const mid = () => `msg_${crypto.randomUUID()}`;

function seal(from, fromAccount, toKey, toAccount, text = "Hello there", messageId = mid(), createdAt = Date.now()) {
  return {
    messageId,
    record: sealInboxMessage({
      secret: from.secret,
      accountId: fromAccount,
      peerAccountId: toAccount,
      peerPublicKey: toKey.publicKey,
      messageId,
      text,
      createdAt,
    }),
  };
}

test("both explorers read a message; nobody else, no copy and no tampering", () => {
  const a = generateInboxKey(),
    b = generateInboxKey(),
    e = generateInboxKey();
  const { messageId, record } = seal(a, ALICE, b, BOB, "Ahoj! Sejdeme se u kašny? 🐉");
  assert.ok(validInboxRecord(record));
  assert.ok(!JSON.stringify(record).includes(BOB), "the recipient account is not on chain");
  const open = (secret, accountId, r = record, sender = ALICE, recipient = BOB, id = messageId) =>
    openInboxMessage({ secret, accountId, senderAccountId: sender, recipientAccountId: recipient, messageId: id, record: r });
  assert.equal(open(b.secret, BOB), "Ahoj! Sejdeme se u kašny? 🐉");
  assert.equal(open(a.secret, ALICE), "Ahoj! Sejdeme se u kašny? 🐉");
  assert.throws(() => open(e.secret, EVE));
  // Eve republishing Alice's record under her own namespace does not open as hers.
  assert.throws(() => open(b.secret, BOB, record, EVE));
  assert.throws(() => open(b.secret, BOB, record, ALICE, BOB, mid()));
  const flipped = { ...record, box: toBase64Url(fromBase64Url(record.box).map((x, i) => (i === 5 ? x ^ 1 : x))) };
  assert.throws(() => open(b.secret, BOB, flipped));
  // Lengths are padded to 128 byte buckets.
  const short = seal(a, ALICE, b, BOB, "hi").record,
    longer = seal(a, ALICE, b, BOB, "x".repeat(100)).record;
  assert.equal(short.box.length, longer.box.length);
});

test("a disclosed message key opens exactly one message", () => {
  const a = generateInboxKey(),
    b = generateInboxKey();
  const one = seal(a, ALICE, b, BOB, "first"),
    two = seal(a, ALICE, b, BOB, "second");
  const key = inboxMessageKey({
    secret: b.secret,
    accountId: BOB,
    senderAccountId: ALICE,
    recipientAccountId: BOB,
    messageId: one.messageId,
    record: one.record,
  });
  assert.equal(openWithMessageKey(fromBase64Url(key), ALICE, one.messageId, one.record), "first");
  assert.throws(() => openWithMessageKey(fromBase64Url(key), ALICE, two.messageId, two.record));
});

test("message text: 1–500 characters, no control characters", () => {
  assert.ok(validInboxText("a"));
  assert.ok(validInboxText("ř".repeat(500)));
  assert.ok(validInboxText("line\nbreak"));
  assert.ok(!validInboxText(""));
  assert.ok(!validInboxText("   "));
  assert.ok(!validInboxText("x".repeat(501)));
  assert.ok(!validInboxText("bell\u0007"));
  const a = generateInboxKey(),
    b = generateInboxKey();
  assert.throws(() => seal(a, ALICE, b, BOB, "x".repeat(501)));
});

function world(t) {
  const db = openDatabase(":memory:");
  t.after(() => db.close());
  let now = 1_794_268_800_000;
  const chain = new Map(); // "<account>/<path>" -> record
  const social = {
    contractId: "v1.social08.testnet",
    key: async (account) => chain.get(`${account}/inbox_key`) || null,
    messages: async (list) => list.map((m) => chain.get(`${m.sender}/inbox/${m.id}`) || null),
    deposit: async () => "1",
  };
  const moderator = { id: null };
  const inbox = new PlayerInbox(db, social, { clock: () => now, isModerator: (p) => p === moderator.id });
  const explorer = (name, account) => {
    const id = createPlayer(db, name, now - 86_400_000);
    if (account) {
      db.prepare("UPDATE players SET native_account=? WHERE id=?").run(account, id);
      db.prepare("INSERT INTO wallet_links(account_id,player_id,verified_at) VALUES(?,?,?)").run(account, id, now);
    }
    const keys = generateInboxKey();
    return { id, account, keys };
  };
  const publishKey = async (p) => {
    const quote = await inbox.keyQuote(p.id, toBase64Url(p.keys.publicKey));
    assert.deepEqual(Object.keys(quote.args.data), [p.account]);
    chain.set(`${p.account}/inbox_key`, quote.record);
    return inbox.syncKey(p.id);
  };
  return { db, inbox, chain, explorer, publishKey, moderator, tick: (ms) => (now += ms), now: () => now };
}

async function send(w, from, to, text = "Hello", { onChain = true } = {}) {
  const sealed = seal(from.keys, from.account, to.keys, to.account, text, mid(), w.now());
  const quote = await w.inbox.sendQuote(from.id, { playerId: to.id, ...sealed });
  assert.deepEqual(quote.args.data[from.account].questlayer.inbox[sealed.messageId], sealed.record);
  if (onChain) w.chain.set(`${from.account}/inbox/${sealed.messageId}`, sealed.record);
  const confirmed = await w.inbox.confirmMessage(from.id, sealed.messageId);
  return { ...sealed, state: confirmed.state };
}

test("first message needs an accepted request or a mutual wave; blocks stop everything", async (t) => {
  const w = world(t);
  const alice = w.explorer("Alice", ALICE),
    bob = w.explorer("Bob", BOB),
    carol = w.explorer("Carol", "carol.players.questlayer.testnet");
  await w.publishKey(alice);
  await w.publishKey(bob);
  await assert.rejects(send(w, alice, bob), /accept your request/);
  assert.equal(w.inbox.request(alice.id, bob.id).state, "requested");
  assert.equal(w.inbox.relation(bob.id, alice.id), "incoming");
  assert.equal(w.inbox.summary(bob.id).requests, 1);
  await assert.rejects(send(w, alice, bob), /accept your request/);
  assert.equal(w.inbox.answer(bob.id, alice.id, true).state, "open");
  const m = await send(w, alice, bob, "Ahoj Bobe");
  assert.equal(m.state, "delivered");
  assert.equal(w.inbox.summary(bob.id).unread, 1);
  const thread = w.inbox.thread(bob.id, alice.id);
  assert.equal(thread.messages.length, 1);
  assert.equal(thread.messages[0].sender, ALICE);
  assert.equal(thread.messages[0].recipient, BOB);
  assert.ok(!("record" in thread.messages[0]), "the index carries ids, the device reads the record from chain");
  assert.equal(w.inbox.summary(bob.id).unread, 0);
  // Mutual waves open a conversation at once.
  ensureModuleVersion(w.db, WAVES_SCHEMA);
  w.db.prepare("INSERT INTO player_waves(id,from_id,to_id,phrase,created_at,seen) VALUES('w1',?,?,'hello',?,1),('w2',?,?,'hello',?,1)").run(
    alice.id, carol.id, w.now(), carol.id, alice.id, w.now(),
  );
  assert.equal(w.inbox.relation(alice.id, carol.id), "open");
  // Block: no thread, no sending, no request.
  new SocialContent(w.db).setBlock(bob.id, alice.id, true);
  w.tick(5000);
  await assert.rejects(send(w, alice, bob), /not available/);
  assert.throws(() => w.inbox.thread(bob.id, alice.id), /not available/);
  assert.throws(() => w.inbox.request(alice.id, bob.id), /not available/);
});

test("declined requests stay declined for the requester; demo explorers without an account cannot write", async (t) => {
  const w = world(t);
  const alice = w.explorer("Alice", ALICE),
    bob = w.explorer("Bob", BOB),
    bot = w.explorer("Demo", null);
  w.inbox.request(alice.id, bob.id);
  assert.equal(w.inbox.answer(bob.id, alice.id, false).state, "declined");
  assert.throws(() => w.inbox.request(alice.id, bob.id), /declined/);
  // Bob may still ask Alice himself.
  assert.equal(w.inbox.request(bob.id, alice.id).state, "requested");
  assert.throws(() => w.inbox.request(bot.id, alice.id), /account/);
});

test("delivery waits for the exact record on chain and expires", async (t) => {
  const w = world(t);
  const alice = w.explorer("Alice", ALICE),
    bob = w.explorer("Bob", BOB);
  await w.publishKey(alice);
  await w.publishKey(bob);
  w.inbox.request(alice.id, bob.id);
  w.inbox.answer(bob.id, alice.id, true);
  const pending = await send(w, alice, bob, "later", { onChain: false });
  assert.equal(pending.state, "pending");
  assert.equal(w.inbox.summary(bob.id).unread, 0, "not delivered before it is on chain");
  assert.equal(w.inbox.thread(bob.id, alice.id).messages.length, 0);
  assert.equal(w.inbox.thread(alice.id, bob.id).messages[0].state, "pending");
  // A different record under the same id does not count.
  w.chain.set(`${ALICE}/inbox/${pending.messageId}`, seal(alice.keys, ALICE, bob.keys, BOB, "other", pending.messageId).record);
  w.tick(5000);
  assert.equal(await w.inbox.confirmPending(), 0);
  // SocialDB may hand the fields back in another order.
  const reordered = Object.fromEntries(Object.entries(pending.record).reverse());
  w.chain.set(`${ALICE}/inbox/${pending.messageId}`, reordered);
  assert.equal(await w.inbox.confirmPending(), 1);
  assert.equal(w.inbox.summary(bob.id).unread, 1);
  // Never on chain: failed after the pending window.
  w.tick(3000);
  const lost = await send(w, alice, bob, "lost", { onChain: false });
  w.tick(INBOX_LIMITS.pendingMs + 1);
  await w.inbox.confirmPending();
  assert.equal(w.db.prepare("SELECT state FROM inbox_messages WHERE id=?").get(lost.messageId).state, "failed");
});

test("the server refuses records for stale keys, replays and floods", async (t) => {
  const w = world(t);
  const alice = w.explorer("Alice", ALICE),
    bob = w.explorer("Bob", BOB);
  await w.publishKey(alice);
  w.inbox.request(alice.id, bob.id);
  w.inbox.answer(bob.id, alice.id, true);
  await assert.rejects(send(w, alice, bob), /not opened their inbox/);
  await w.publishKey(bob);
  // Encrypted to an old key of Bob's.
  const stale = generateInboxKey();
  const old = seal(alice.keys, ALICE, stale, BOB, "x", mid(), w.now());
  await assert.rejects(w.inbox.sendQuote(alice.id, { playerId: bob.id, ...old }), /changed their inbox key/);
  // Malformed record.
  const bad = seal(alice.keys, ALICE, bob.keys, BOB, "x", mid(), w.now());
  await assert.rejects(w.inbox.sendQuote(alice.id, { playerId: bob.id, messageId: bad.messageId, record: { ...bad.record, extra: "1" } }), /invalid format/);
  const ok = await send(w, alice, bob, "one");
  await assert.rejects(w.inbox.sendQuote(alice.id, { playerId: bob.id, messageId: ok.messageId, record: ok.record }), /already sent|Slow down/);
  await assert.rejects(send(w, alice, bob, "too fast"), /Slow down/);
  for (let i = 1; i < INBOX_LIMITS.perSenderHour; i++) {
    w.tick(INBOX_LIMITS.pairGapMs + 1);
    await send(w, alice, bob, `n${i}`);
  }
  w.tick(INBOX_LIMITS.pairGapMs + 1);
  await assert.rejects(send(w, alice, bob, "over"), /a lot of messages/);
});

test("reports carry one verified message; three reporters pause the sender until a moderator clears it", async (t) => {
  const w = world(t);
  const spammer = w.explorer("Spam", EVE);
  await w.publishKey(spammer);
  const victims = [];
  for (const [n, acc] of [["A", ALICE], ["B", BOB], ["C", "carol.players.questlayer.testnet"]]) {
    const v = w.explorer(n, acc);
    await w.publishKey(v);
    w.inbox.request(spammer.id, v.id);
    w.inbox.answer(v.id, spammer.id, true);
    victims.push(v);
  }
  const mod = w.explorer("Mod", "mod.players.questlayer.testnet");
  w.moderator.id = mod.id;
  for (const [i, v] of victims.entries()) {
    w.tick(INBOX_LIMITS.pairGapMs + 1);
    const m = await send(w, spammer, v, `buy now ${i}`);
    const messageKey = inboxMessageKey({
      secret: v.keys.secret,
      accountId: v.account,
      senderAccountId: EVE,
      recipientAccountId: v.account,
      messageId: m.messageId,
      record: m.record,
    });
    // A key for a different message is refused.
    if (i === 0) assert.throws(() => w.inbox.report(v.id, { messageId: m.messageId, reason: "spam", messageKey: toBase64Url(new Uint8Array(32)) }), /does not open/);
    assert.throws(() => w.inbox.report(spammer.id, { messageId: m.messageId, reason: "spam" }), /only messages you received/);
    const r = w.inbox.report(v.id, { messageId: m.messageId, reason: "spam", messageKey });
    assert.equal(r.verified, true);
  }
  assert.equal(w.inbox.muted(spammer.id), true);
  await assert.rejects(send(w, spammer, victims[0], "again"), /paused/);
  assert.throws(() => w.inbox.reports(spammer.id), /moderators/);
  const queue = w.inbox.reports(mod.id).reports;
  assert.equal(queue.length, 3);
  assert.deepEqual(queue.map((r) => r.text).sort(), ["buy now 0", "buy now 1", "buy now 2"]);
  w.inbox.resolve(mod.id, { reportId: queue[0].id, mute: false });
  assert.equal(w.inbox.muted(spammer.id), false);
  assert.equal(w.inbox.reports(mod.id).reports.length, 0);
});

test("routes require sign-in and answer disabled when the inbox is off", async () => {
  const calls = [];
  const respond = (_res, body) => calls.push(body);
  const assertFn = (ok, message, status) => {
    if (!ok) throw Object.assign(new Error(message), { status });
  };
  const off = createInboxRoutes(null);
  assert.equal(
    await off.handle({ method: "GET" }, {}, new URL("http://x/api/inbox/summary"), { player: null, body: async () => ({}), respond, assert: assertFn }),
    true,
  );
  assert.deepEqual(calls.pop(), { enabled: false, unread: 0, requests: 0 });
  const on = createInboxRoutes({ summary: () => ({ unread: 2, requests: 1 }) });
  await assert.rejects(
    on.handle({ method: "GET" }, {}, new URL("http://x/api/inbox/summary"), { player: null, body: async () => ({}), respond, assert: assertFn }),
    /Sign in/,
  );
  await on.handle({ method: "GET" }, {}, new URL("http://x/api/inbox/summary"), { player: "player_x", body: async () => ({}), respond, assert: assertFn });
  assert.deepEqual(calls.pop(), { unread: 2, requests: 1 });
  assert.equal(await on.handle({ method: "GET" }, {}, new URL("http://x/api/other"), { player: "p", body: async () => ({}), respond, assert: assertFn }), false);
});
