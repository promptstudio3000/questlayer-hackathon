import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { openDatabase, createPlayer } from "../server/database.mjs";
import { hash, DAY } from "../server/domain.mjs";
import { IdentitySessions } from "../server/identity/sessions.mjs";
import {
  NETWORK,
  ACCOUNT_SUFFIX as SUFFIX,
} from "../server/native/network.mjs";
const OTHER_NETWORK = NETWORK === "mainnet" ? "testnet" : "mainnet";

function fixture(t, options = {}) {
  const db = openDatabase(options.path || ":memory:");
  t.after(() => db.close());
  let now = 1_800_000_000_000;
  const service = new IdentitySessions(db, {
    origin: "https://game.example",
    provider: {},
    now: () => now,
    verifyIdentity: async () => {},
    ...options,
  });
  const alice = createPlayer(db, "Alice", now),
    bob = createPlayer(db, "Bob", now);
  db.prepare("INSERT INTO wallet_links VALUES(?,?,?)").run(
    `alice${SUFFIX}`,
    alice,
    now,
  );
  db.prepare("INSERT INTO wallet_links VALUES(?,?,?)").run(
    `bob${SUFFIX}`,
    bob,
    now,
  );
  function session(player = alice, kind = "guest", record = true) {
    const token = randomBytes(32).toString("hex");
    db.prepare("INSERT INTO sessions VALUES(?,?,?)").run(
      hash(token),
      player,
      now + 30 * DAY,
    );
    if (record)
      service.record(
        token,
        kind,
        kind === "near-wallet" ? `alice${SUFFIX}` : null,
      );
    return token;
  }
  return { db, service, alice, bob, session, advance: (ms) => (now += ms) };
}

test("session view is owner-scoped, bounded and never returns credentials", (t) => {
  const f = fixture(t),
    current = f.session(f.alice, "near-wallet"),
    second = f.session(f.alice, "guest"),
    other = f.session(f.bob);
  const view = f.service.view(current);
  assert.equal(view.activeSessionCount, 2);
  assert.equal(view.sessions[0].current, true);
  assert.equal(view.sessions[0].kind, "near-wallet");
  assert.equal(view.sessions[1].kind, "guest");
  assert.equal(view.recovery.nativePasskeyAccount, false);
  assert.deepEqual(view.recovery.nearAccounts, [`alice${SUFFIX}`]);
  const encoded = JSON.stringify(view);
  for (const token of [current, second, other]) {
    assert.ok(!encoded.includes(token));
    assert.ok(!encoded.includes(hash(token)));
  }
  for (let i = 0; i < 55; i++) f.session();
  assert.equal(f.service.view(current).sessions.length, 50);
  assert.equal(f.service.view(current).hasMoreSessions, true);
  assert.equal(
    f.service.view(current).sessions.filter((s) => s.current).length,
    1,
  );
});

test("fresh wallet proof revokes only other sessions, cancels pending links, preserves player/assets and persists across service restarts", async (t) => {
  const f = fixture(t),
    current = f.session(),
    old = f.session(),
    bob = f.session(f.bob);
  f.db
    .prepare("INSERT INTO auth_challenges VALUES(?,?,?,0)")
    .run(
      "pending-link",
      JSON.stringify({ purpose: "near-link", player: f.alice }),
      1_900_000_000_000,
    );
  const before = f.db.prepare("SELECT * FROM players WHERE id=?").get(f.alice);
  const c = f.service.challenge(current, `alice${SUFFIX}`);
  const recovered = await f.service.recover(current, {
    challengeId: c.challengeId,
  });
  const { result } = recovered;
  assert.equal(result.revokedSessions, 1);
  assert.equal(result.activeSessionCount, 1);
  assert.equal(result.sessions[0].kind, "near-wallet");
  assert.equal(f.service.authenticate(recovered.token).playerId, f.alice);
  assert.throws(
    () => f.service.authenticate(current),
    (e) => e.status === 401,
    "Copied current cookies must also be invalidated",
  );
  assert.equal(f.service.authenticate(bob).playerId, f.bob);
  assert.throws(
    () => f.service.authenticate(old),
    (e) => e.status === 401,
  );
  assert.equal(
    f.db
      .prepare("SELECT used FROM auth_challenges WHERE id='pending-link'")
      .get().used,
    1,
  );
  assert.equal(
    f.db.prepare("SELECT COUNT(*) AS n FROM identity_recovery_events").get().n,
    1,
  );
  assert.deepEqual(
    f.db.prepare("SELECT * FROM players WHERE id=?").get(f.alice),
    before,
  );
  const restarted = new IdentitySessions(f.db, {
    origin: "https://game.example",
    now: () => 1_800_000_000_001,
  });
  assert.throws(
    () => restarted.authenticate(old),
    (e) => e.status === 401,
  );
  assert.equal(restarted.authenticate(recovered.token).playerId, f.alice);
  await assert.rejects(
    f.service.recover(recovered.token, { challengeId: c.challengeId }),
    (e) => e.status === 401,
  );
});

test("recovery cannot use another account, browser, player, purpose or origin", async (t) => {
  let proofs = 0;
  const f = fixture(t, {
      verifyIdentity: async () => {
        proofs++;
      },
    }),
    current = f.session(),
    other = f.session(),
    bob = f.session(f.bob);
  assert.throws(
    () => f.service.challenge(current, `bob${SUFFIX}`),
    (e) => e.status === 403,
  );
  const c = f.service.challenge(current, `alice${SUFFIX}`);
  await assert.rejects(
    f.service.recover(other, { challengeId: c.challengeId }),
    (e) => e.status === 403,
  );
  await assert.rejects(
    f.service.recover(bob, { challengeId: c.challengeId }),
    (e) => e.status === 403,
  );
  for (const patch of [
    { purpose: "near-sign-in" },
    { network: OTHER_NETWORK },
    { recipient: "https://other.example" },
  ]) {
    const challenge = f.service.challenge(current, `alice${SUFFIX}`);
    const data = JSON.parse(
      f.db
        .prepare("SELECT nonce FROM auth_challenges WHERE id=?")
        .get(challenge.challengeId).nonce,
    );
    f.db
      .prepare("UPDATE auth_challenges SET nonce=? WHERE id=?")
      .run(JSON.stringify({ ...data, ...patch }), challenge.challengeId);
    await assert.rejects(
      f.service.recover(current, { challengeId: challenge.challengeId }),
      (e) => e.status === 401,
    );
  }
  assert.equal(proofs, 0);
  assert.equal(f.service.view(current).activeSessionCount, 2);
});

test("expired challenge, expired/revoked browser and changed account link fail after slow verification", async (t) => {
  for (const race of [
    "expired-challenge",
    "expired-session",
    "revoked-session",
    "conflicting-link",
  ]) {
    let release, begin;
    const waiting = new Promise((resolve) => {
      release = resolve;
    });
    const started = new Promise((resolve) => {
      begin = resolve;
    });
    const f = fixture(t, {
      verifyIdentity: async () => {
        begin();
        await waiting;
      },
    });
    const current = f.session(),
      other = f.session(),
      c = f.service.challenge(current, `alice${SUFFIX}`);
    const pending = f.service.recover(current, { challengeId: c.challengeId });
    await started;
    if (race === "expired-challenge") f.advance(300_001);
    if (race === "expired-session")
      f.db
        .prepare("UPDATE sessions SET expires_at=0 WHERE token_hash=?")
        .run(hash(current));
    if (race === "revoked-session")
      f.db
        .prepare("DELETE FROM sessions WHERE token_hash=?")
        .run(hash(current));
    if (race === "conflicting-link")
      f.db
        .prepare("UPDATE wallet_links SET player_id=? WHERE account_id=?")
        .run(f.bob, `alice${SUFFIX}`);
    release();
    await assert.rejects(pending, (e) => [401, 403].includes(e.status), race);
    assert.equal(f.service.authenticate(other).playerId, f.alice, race);
    assert.equal(
      f.db.prepare("SELECT COUNT(*) AS n FROM identity_recovery_events").get()
        .n,
      0,
      race,
    );
  }
});

test("RPC failure leaves recovery retryable and simultaneous proofs cannot both settle", async (t) => {
  let unavailable = true;
  const f = fixture(t, {
    verifyIdentity: async () => {
      if (unavailable)
        throw Object.assign(Error("Unavailable"), { status: 503 });
    },
  });
  const current = f.session(),
    old = f.session(),
    c = f.service.challenge(current, `alice${SUFFIX}`);
  await assert.rejects(
    f.service.recover(current, { challengeId: c.challengeId }),
    (e) => e.status === 503,
  );
  assert.equal(f.service.authenticate(old).playerId, f.alice);
  unavailable = false;
  const results = await Promise.allSettled([
    f.service.recover(current, { challengeId: c.challengeId }),
    f.service.recover(current, { challengeId: c.challengeId }),
  ]);
  assert.deepEqual(results.map((r) => r.status).sort(), [
    "fulfilled",
    "rejected",
  ]);
  assert.equal(
    f.db.prepare("SELECT COUNT(*) AS n FROM identity_recovery_events").get().n,
    1,
  );
});

test("recovery transaction failure rolls back session deletion and challenge consumption", async (t) => {
  const f = fixture(t),
    current = f.session(),
    old = f.session(),
    c = f.service.challenge(current, `alice${SUFFIX}`);
  f.db.exec(
    "CREATE TRIGGER reject_recovery BEFORE INSERT ON identity_recovery_events BEGIN SELECT RAISE(ABORT,'audit unavailable'); END;",
  );
  await assert.rejects(
    f.service.recover(current, { challengeId: c.challengeId }),
    /audit unavailable/,
  );
  assert.equal(f.service.authenticate(old).playerId, f.alice);
  assert.equal(
    f.db
      .prepare("SELECT used FROM auth_challenges WHERE id=?")
      .get(c.challengeId).used,
    0,
  );
  f.db.exec("DROP TRIGGER reject_recovery");
  assert.equal(
    (await f.service.recover(current, { challengeId: c.challengeId })).result
      .revokedSessions,
    1,
  );
});

test("outstanding recovery prompts are bounded and guest-only recovery cannot claim wallet custody", (t) => {
  const f = fixture(t),
    current = f.session();
  for (let i = 0; i < 10; i++) f.service.challenge(current, `alice${SUFFIX}`);
  assert.throws(
    () => f.service.challenge(current, `alice${SUFFIX}`),
    (e) => e.status === 429,
  );
  assert.ok(
    f.service.challenge(f.session(), `alice${SUFFIX}`).challengeId,
    "Another session cannot exhaust this browser's recovery allowance",
  );
  f.advance(300_001);
  assert.ok(f.service.challenge(current, `alice${SUFFIX}`).challengeId);
  f.db.prepare("DELETE FROM wallet_links WHERE player_id=?").run(f.alice);
  assert.equal(f.service.view(current).recovery.canRevokeOtherSessions, false);
  assert.throws(
    () => f.service.challenge(current, `alice${SUFFIX}`),
    (e) => e.status === 403,
  );
});

test("revocation remains effective after closing and reopening the on-disk database", async () => {
  const dir = mkdtempSync(join(tmpdir(), "questlayer-session-recovery-"));
  const file = join(dir, "game.sqlite");
  let db = openDatabase(file);
  try {
    const player = createPlayer(db, "Alice");
    db.prepare("INSERT INTO wallet_links VALUES(?,?,?)").run(
      `alice${SUFFIX}`,
      player,
      Date.now(),
    );
    const current = randomBytes(32).toString("hex"),
      old = randomBytes(32).toString("hex");
    for (const token of [current, old])
      db.prepare("INSERT INTO sessions VALUES(?,?,?)").run(
        hash(token),
        player,
        Date.now() + DAY,
      );
    let service = new IdentitySessions(db, {
      origin: "https://game.example",
      verifyIdentity: async () => {},
    });
    for (const token of [current, old]) service.record(token);
    const c = service.challenge(current, `alice${SUFFIX}`);
    const recovered = await service.recover(current, {
      challengeId: c.challengeId,
    });
    db.close();
    db = openDatabase(file);
    service = new IdentitySessions(db, { origin: "https://game.example" });
    for (const token of [old, current])
      assert.throws(
        () => service.authenticate(token),
        (e) => e.status === 401,
      );
    assert.equal(service.authenticate(recovered.token).playerId, player);
    assert.equal(
      db.prepare("SELECT COUNT(*) AS n FROM identity_recovery_events").get().n,
      1,
    );
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
