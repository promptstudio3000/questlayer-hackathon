import { randomBytes } from "node:crypto";
import { assert, hash, id } from "../domain.mjs";
import { atomic } from "../database.mjs";
import { nearAccountId, verifyNearIdentity } from "./near.mjs";
import { NETWORK, NETWORK_LABEL } from "../native/network.mjs";
import { initializeIdentity } from "./schema.mjs";

const RECOVERY_PURPOSE = "revoke-other-sessions";
const CHALLENGE_TTL = 300_000;

/** Server game sessions are credentials for the game, never NEAR access keys. */
export class IdentitySessions {
  constructor(
    db,
    { origin, provider, now = Date.now, verifyIdentity = verifyNearIdentity },
  ) {
    this.db = db;
    this.origin = origin;
    this.provider = provider;
    this.now = now;
    this.verifyIdentity = verifyIdentity;
    initializeIdentity(db);
  }

  record(token, kind = "guest", accountId = null) {
    const tokenHash = hash(token);
    assert(
      this.db
        .prepare("SELECT 1 FROM sessions WHERE token_hash=?")
        .get(tokenHash),
      "Please sign in again.",
      401,
    );
    this.db
      .prepare(`INSERT OR IGNORE INTO identity_sessions VALUES(?,?,?,?,?,?,?)`)
      .run(
        tokenHash,
        id("session"),
        kind,
        accountId,
        this.now(),
        this.now(),
        kind === "near-wallet" || kind === "evm-wallet" || kind === "demo-passkey"
          ? this.now()
          : null,
      );
  }

  authenticate(token, touch = true) {
    assert(
      typeof token === "string" && /^[a-f0-9]{64}$/.test(token),
      "Create an explorer first.",
      401,
    );
    const tokenHash = hash(token);
    const session = this.db
      .prepare("SELECT * FROM sessions WHERE token_hash=? AND expires_at>?")
      .get(tokenHash, this.now());
    assert(session, "Please sign in again.", 401);
    if (touch)
      this.db
        .prepare(
          `UPDATE identity_sessions SET last_seen_at=? WHERE token_hash=? AND (last_seen_at IS NULL OR last_seen_at<=?)`,
        )
        .run(this.now(), tokenHash, this.now() - 60_000);
    const metadata = this.db
      .prepare("SELECT public_id FROM identity_sessions WHERE token_hash=?")
      .get(tokenHash);
    assert(metadata, "Please sign in again.", 401);
    return {
      playerId: session.player_id,
      tokenHash,
      sessionId: metadata.public_id,
    };
  }

  view(token) {
    const current = this.authenticate(token);
    const activeSessionCount = this.db
      .prepare(
        "SELECT COUNT(*) AS count FROM sessions WHERE player_id=? AND expires_at>?",
      )
      .get(current.playerId, this.now()).count;
    const rows = this.db
      .prepare(
        `SELECT s.*,i.public_id,i.kind,i.account_id,i.created_at,i.last_seen_at
      FROM sessions s JOIN identity_sessions i ON s.token_hash=i.token_hash
      WHERE s.player_id=? AND s.expires_at>? ORDER BY s.token_hash=? DESC, s.expires_at DESC LIMIT 50`,
      )
      .all(current.playerId, this.now(), current.tokenHash);
    const sessions = rows.map((row) => {
      return {
        id: row.public_id,
        current: row.token_hash === current.tokenHash,
        kind: row.kind,
        accountId: row.account_id || null,
        createdAt: row.created_at ?? null,
        lastSeenAt: row.last_seen_at ?? null,
        expiresAt: row.expires_at,
      };
    });
    const nearAccounts = this.db
      .prepare(
        "SELECT account_id FROM wallet_links WHERE player_id=? ORDER BY account_id",
      )
      .all(current.playerId)
      .map((row) => row.account_id);
    const hasPasskeys = this.db
      .prepare(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name='passkeys'",
      )
      .get();
    return {
      network: NETWORK,
      currentSessionId: current.sessionId,
      activeSessionCount,
      evmWallets: this.db
        .prepare(
          "SELECT address,public_key AS publicKey,wallet,verified_at AS verifiedAt FROM evm_links WHERE player_id=? ORDER BY address",
        )
        .all(current.playerId),
      hasMoreSessions: activeSessionCount > sessions.length,
      sessions,
      recovery: {
        nearAccounts,
        demoPasskeys: hasPasskeys
          ? this.db
              .prepare(
                "SELECT COUNT(*) AS count FROM passkeys WHERE player_id=?",
              )
              .get(current.playerId).count
          : 0,
        canRevokeOtherSessions: nearAccounts.length > 0,
        nativePasskeyAccount: false,
      },
    };
  }

  assertLinked(playerId, accountId) {
    const linked = this.db
      .prepare("SELECT player_id FROM wallet_links WHERE account_id=?")
      .get(accountId);
    assert(
      linked?.player_id === playerId,
      "Use a NEAR account already linked to this explorer.",
      403,
    );
  }

  challenge(token, account) {
    const current = this.authenticate(token);
    const accountId = nearAccountId(account);
    this.assertLinked(current.playerId, accountId);
    const recent = this.db
      .prepare(
        `SELECT COUNT(*) AS count FROM auth_challenges WHERE used=0 AND expires_at>? AND json_valid(nonce) AND json_extract(nonce,'$.purpose')=? AND json_extract(nonce,'$.sessionId')=?`,
      )
      .get(this.now(), RECOVERY_PURPOSE, current.sessionId).count;
    assert(
      recent < 10,
      "Finish an existing recovery request or try again in five minutes.",
      429,
    );
    const challengeId = id("near_recovery"),
      nonce = randomBytes(32).toString("base64");
    const message = `Sign out other QuestLayer game sessions for explorer ${current.playerId} using ${accountId} on ${NETWORK_LABEL}. Keep session ${current.sessionId}. Wallet keys, passkeys and funds will not change. This is not a transaction.`;
    const data = {
      purpose: RECOVERY_PURPOSE,
      network: NETWORK,
      player: current.playerId,
      sessionId: current.sessionId,
      accountId,
      nonce,
      message,
      recipient: this.origin,
    };
    this.db
      .prepare("INSERT INTO auth_challenges VALUES(?,?,?,0)")
      .run(challengeId, JSON.stringify(data), this.now() + CHALLENGE_TTL);
    return {
      challengeId,
      nonce,
      message,
      recipient: this.origin,
      network: NETWORK,
      purpose: RECOVERY_PURPOSE,
    };
  }

  readRecovery(challengeId, current) {
    assert(
      typeof challengeId === "string" && challengeId.length <= 160,
      "Start a new recovery request.",
      401,
    );
    const row = this.db
      .prepare(
        "SELECT nonce FROM auth_challenges WHERE id=? AND used=0 AND expires_at>?",
      )
      .get(challengeId, this.now());
    assert(row, "This recovery request has expired or already been used.", 401);
    const data = JSON.parse(row.nonce);
    assert(
      data.purpose === RECOVERY_PURPOSE &&
        data.network === NETWORK &&
        data.recipient === this.origin,
      "This challenge cannot sign out game sessions.",
      401,
    );
    assert(
      data.player === current.playerId && data.sessionId === current.sessionId,
      "Finish recovery in the browser where it was started.",
      403,
    );
    this.assertLinked(current.playerId, data.accountId);
    return data;
  }

  async recover(token, input) {
    const current = this.authenticate(token);
    const data = this.readRecovery(input.challengeId, current);
    await this.verifyIdentity(data, input, this.provider);
    const nextToken = randomBytes(32).toString("hex");
    const revokedSessions = atomic(this.db, () => {
      // An RPC call may outlast the challenge or this browser's authorization.
      const stillCurrent = this.authenticate(token, false);
      const fresh = this.readRecovery(input.challengeId, stillCurrent);
      assert(
        JSON.stringify(fresh) === JSON.stringify(data),
        "Start a new recovery request.",
        401,
      );
      const revoked = this.db
        .prepare(
          "SELECT COUNT(*) AS count FROM sessions WHERE player_id=? AND token_hash<>? AND expires_at>?",
        )
        .get(current.playerId, current.tokenHash, this.now()).count;
      const retained = this.db
        .prepare(
          "SELECT s.expires_at,i.created_at FROM sessions s JOIN identity_sessions i USING(token_hash) WHERE token_hash=?",
        )
        .get(current.tokenHash);
      assert(
        this.db
          .prepare(
            "UPDATE auth_challenges SET used=1 WHERE id=? AND used=0 AND expires_at>?",
          )
          .run(input.challengeId, this.now()).changes === 1,
        "This recovery request has already been used.",
        401,
      );
      // Rotate this browser too: a copied current cookie must lose authorization.
      this.db
        .prepare("DELETE FROM sessions WHERE player_id=?")
        .run(current.playerId);
      this.db
        .prepare("INSERT INTO sessions VALUES(?,?,?)")
        .run(hash(nextToken), current.playerId, retained.expires_at);
      this.db
        .prepare(
          "INSERT INTO identity_sessions VALUES(?,?,'near-wallet',?,?,?,?)",
        )
        .run(
          hash(nextToken),
          current.sessionId,
          data.accountId,
          retained.created_at,
          this.now(),
          this.now(),
        );
      // Cancel pending wallet/appearance links and other recovery approvals too.
      this.db
        .prepare(
          "UPDATE auth_challenges SET used=1 WHERE used=0 AND json_valid(nonce) AND json_extract(nonce,'$.player')=?",
        )
        .run(current.playerId);
      this.db
        .prepare("INSERT INTO identity_recovery_events VALUES(?,?,?,?,?,?)")
        .run(
          id("recovery"),
          current.playerId,
          current.sessionId,
          data.accountId,
          revoked,
          this.now(),
        );
      return revoked;
    });
    // The route sends token only as an HttpOnly cookie, never as response JSON.
    return {
      token: nextToken,
      result: { ok: true, revokedSessions, ...this.view(nextToken) },
    };
  }
}
