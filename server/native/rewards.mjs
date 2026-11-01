import { nativeMapProjection } from "./map-projection.mjs";
import { describeNativeQuest } from "../quest-templates.mjs";
import { NativeContractReader } from "./reader.mjs";
import {
  assert,
  hash,
  id,
  dayKey,
  distance,
  validateFix,
  point,
} from "../domain.mjs";
import { atomic } from "../database.mjs";
import {
  rewardMessage,
  nativeDayRow,
  nativePublicationMatches,
  storedNativeManifest,
} from "./reward-manifest.mjs";
import { DEFAULT_CITY } from "../spatial/city-pack.mjs";
import { NETWORK } from "./network.mjs";
import {
  assertNativePlaceOpen,
  closedPlaces,
} from "../spatial/place-safety.mjs";
export class NativeRewards extends NativeContractReader {
  constructor(
    db,
    provider,
    config,
    signer,
    { clock = Date.now, city = DEFAULT_CITY } = {},
  ) {
    super(provider, config.contractId);
    this.db = db;
    this.config = config;
    this.signer = signer;
    this.clock = clock;
    this.city = city;
    db.exec(`
   CREATE TABLE IF NOT EXISTS native_days(id TEXT PRIMARY KEY,day TEXT NOT NULL,body TEXT NOT NULL,hash TEXT NOT NULL,state TEXT NOT NULL DEFAULT 'prepared',transaction_hash TEXT,updated_at INTEGER NOT NULL);
   CREATE TABLE IF NOT EXISTS native_enrollments(account_id TEXT PRIMARY KEY,player_id TEXT NOT NULL REFERENCES players(id),consented_at INTEGER NOT NULL);
   CREATE TABLE IF NOT EXISTS native_progress(day_id TEXT NOT NULL,quest_index INTEGER NOT NULL,account_id TEXT NOT NULL,checkpoint INTEGER NOT NULL,updated_at INTEGER NOT NULL,PRIMARY KEY(day_id,quest_index,account_id));
   CREATE TABLE IF NOT EXISTS native_locations(account_id TEXT PRIMARY KEY,lat REAL NOT NULL,lng REAL NOT NULL,received_at INTEGER NOT NULL);
   CREATE TABLE IF NOT EXISTS native_reward_claims(seq INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT UNIQUE NOT NULL,day_id TEXT NOT NULL,kind TEXT NOT NULL,item_index INTEGER NOT NULL,account_id TEXT NOT NULL,player_id TEXT NOT NULL,body TEXT NOT NULL,signature TEXT NOT NULL,state TEXT NOT NULL DEFAULT 'queued',attempts INTEGER NOT NULL DEFAULT 0,run_after INTEGER NOT NULL,transaction_hash TEXT,last_error TEXT,amount TEXT,xp INTEGER,created_at INTEGER NOT NULL,confirmed_at INTEGER,UNIQUE(day_id,kind,item_index,account_id));
   CREATE UNIQUE INDEX IF NOT EXISTS native_shared_coin ON native_reward_claims(day_id,item_index) WHERE kind='coin';
   CREATE INDEX IF NOT EXISTS native_claim_order ON native_reward_claims(state,seq);
   CREATE TABLE IF NOT EXISTS native_worker_lease(id INTEGER PRIMARY KEY CHECK(id=1),owner TEXT,until_ms INTEGER NOT NULL DEFAULT 0,last_success INTEGER,last_error TEXT);
   INSERT OR IGNORE INTO native_worker_lease(id) VALUES(1);
   CREATE TABLE IF NOT EXISTS native_vault_jobs(account_id TEXT PRIMARY KEY,next_check INTEGER NOT NULL DEFAULT 0,last_action TEXT,last_state TEXT,last_error TEXT);
  `);
  }
  linked(player, account) {
    assert(
      typeof account === "string" &&
        this.db
          .prepare(
            "SELECT 1 FROM wallet_links WHERE player_id=? AND account_id=?",
          )
          .get(player, account),
      "Link this NEAR wallet first.",
      403,
    );
  }
  enroll(player, account, consent) {
    this.linked(player, account);
    assert(consent === true, "Confirm the public testnet visit disclosure.");
    this.db
      .prepare(
        "INSERT INTO native_enrollments VALUES(?,?,?) ON CONFLICT(account_id) DO UPDATE SET player_id=excluded.player_id,consented_at=excluded.consented_at",
      )
      .run(account, player, this.clock());
    return { enrolled: true };
  }
  day(dayId) {
    const row = this.db
      .prepare("SELECT * FROM native_days WHERE id=? AND state='published'")
      .get(dayId);
    assert(row, "This native day is not confirmed on NEAR yet.", 409);
    return storedNativeManifest(row);
  }
  async tier(account) {
    let weighted = 0n;
    for (const v of await this.vaultList(account)) {
      const code = await this.provider.query({
        request_type: "view_account",
        account_id: v.accountId,
        finality: "final",
      });
      assert(
        code.code_hash === v.codeHash,
        "Native vault bytecode changed; access is paused.",
        503,
      );
      const r = new NativeContractReader(this.provider, v.accountId);
      const s = await r.view("get_state", {}, true);
      assert(
        s.beneficiary === account && s.rewards === this.contractId,
        "Vault identity mismatch.",
        503,
      );
      weighted += BigInt(s.weighted_stake);
    }
    return {
      weighted: weighted.toString(),
      tier:
        weighted >= 100n * 10n ** 24n
          ? 3
          : weighted >= 50n * 10n ** 24n
            ? 2
            : 1,
    };
  }
  async vaultList(account = null) {
    return [
      ...(this.config.vaults || []).filter(
        (v) => !account || v.beneficiary === account,
      ),
      ...(this.vaultRegistry ? await this.vaultRegistry.allReady(account) : []),
    ];
  }
  async submit(player, input) {
    const { accountId, dayId, kind, index, checkpoint, fix } = input;
    this.linked(player, accountId);
    assert(
      input.mode === "gps",
      "Native rewards require GPS mode. Arena movement is not eligible.",
      422,
    );
    assert(
      this.db
        .prepare(
          "SELECT 1 FROM native_enrollments WHERE account_id=? AND player_id=?",
        )
        .get(accountId, player),
      "Join the testnet expedition before recording a visit.",
      403,
    );
    assert(
      (kind === "coin" || kind === "quest") &&
        Number.isInteger(index) &&
        index >= 0,
      "Choose a valid discovery.",
    );
    // Return the durable accepted receipt even after the day expires or GPS changes.
    const old = this.db
      .prepare(
        "SELECT * FROM native_reward_claims WHERE day_id=? AND kind=? AND item_index=? AND account_id=?",
      )
      .get(dayId, kind, index, accountId);
    if (old) return this.receipt(old);
    const m = this.day(dayId),
      now = this.clock();
    assert(
      now >= m.startsAt && now < m.endsAt,
      "This native day has ended.",
      409,
      "NATIVE_DAY_LIMIT",
    );
    assert(
      await this.collectionCodeMatches(),
      "Native reward code changed; collection is paused.",
      503,
      "NATIVE_PAUSED",
    );
    const cfg = await this.view("get_config", {}, true);
    const chainDay = await this.view("get_day", { day_id: dayId }, true);
    assert(
      nativePublicationMatches(m, chainDay),
      "Native publication or storage backing is not ready.",
      503,
    );
    assert(
      cfg.attestor === this.signer.publicKey && !cfg.paused,
      "Native attestations are currently paused or unavailable.",
      503,
      "NATIVE_PAUSED",
    );
    let target;
    if (kind === "coin") {
      target = m.coins[index];
      assert(target, "Unknown native coin.");
    } else {
      const q = m.quests[index];
      assert(q, "Unknown native expedition.");
      assert(now >= q.opensAt && now < q.closesAt, "This zone is closed.", 409);
      const access = await this.tier(accountId);
      assert(
        access.tier >= q.tier,
        `This expedition requires native Tier ${q.tier}. Demo stake does not count.`,
        403,
      );
      assert(
        Number.isInteger(checkpoint) &&
          checkpoint >= 0 &&
          checkpoint < q.targets.length,
        "Choose a valid checkpoint.",
      );
      target = q.targets[checkpoint];
    }
    validateFix(fix, target, now, 35);
    return atomic(this.db, () => {
      assertNativePlaceOpen(
        this.db,
        m,
        kind === "quest" ? index : null,
        target,
      );
      const pending = this.db
        .prepare(
          "SELECT COUNT(*) n FROM native_reward_claims WHERE day_id=? AND state!='confirmed'",
        )
        .get(dayId).n;
      assert(
        chainDay.claims_accepted + pending < chainDay.claims_limit,
        "The daily native pilot capacity is full. Continue in the demo world or return tomorrow.",
        409,
        "NATIVE_DAY_LIMIT",
      );
      const db = this.db,
        again = db
          .prepare(
            "SELECT * FROM native_reward_claims WHERE day_id=? AND kind=? AND item_index=? AND account_id=?",
          )
          .get(dayId, kind, index, accountId);
      if (again) return this.receipt(again);
      const last = db
        .prepare("SELECT * FROM native_locations WHERE account_id=?")
        .get(accountId);
      if (last) {
        const elapsed = now - last.received_at;
        assert(
          elapsed >= 3000,
          "Wait a moment before the next native checkpoint.",
          429,
          "NATIVE_PACING",
        );
        assert(
          distance(last, fix) <= Math.max(70, (elapsed / 1000) * 8),
          "Your location changed too quickly. Wait for a reliable walking fix.",
          422,
          "NATIVE_LOCATION_SPEED",
        );
      }
      if (kind === "coin") {
        assert(
          !db
            .prepare(
              "SELECT 1 FROM native_reward_claims WHERE day_id=? AND kind='coin' AND item_index=?",
            )
            .get(dayId, index),
          "This shared native coin has already been collected.",
          409,
          "NATIVE_ALREADY_CLAIMED",
        );
        const count = db
          .prepare(
            "SELECT COUNT(*) n FROM native_reward_claims WHERE day_id=? AND kind='coin' AND account_id=?",
          )
          .get(dayId, accountId).n;
        assert(
          count < 100,
          "The testnet pilot limit is 100 native street coins per account per day.",
          429,
          "NATIVE_ACCOUNT_LIMIT",
        );
      } else {
        const p = db
          .prepare(
            "SELECT checkpoint FROM native_progress WHERE day_id=? AND quest_index=? AND account_id=?",
          )
          .get(dayId, index, accountId);
        const next = p?.checkpoint || 0;
        // Retrying a completed checkpoint does not consume a new location or advance twice.
        if (checkpoint < next)
          return {
            state: "progress",
            checkpoint: next,
            total: m.quests[index].targets.length,
          };
        assert(checkpoint === next, "Visit the checkpoints in order.", 409);
        db.prepare(
          "INSERT INTO native_progress VALUES(?,?,?,?,?) ON CONFLICT(day_id,quest_index,account_id) DO UPDATE SET checkpoint=excluded.checkpoint,updated_at=excluded.updated_at",
        ).run(dayId, index, accountId, next + 1, now);
      }
      db.prepare(
        "INSERT INTO native_locations VALUES(?,?,?,?) ON CONFLICT(account_id) DO UPDATE SET lat=excluded.lat,lng=excluded.lng,received_at=excluded.received_at",
      ).run(accountId, fix.lat, fix.lng, now);
      if (kind === "quest" && checkpoint + 1 < m.quests[index].targets.length)
        return {
          state: "progress",
          checkpoint: checkpoint + 1,
          total: m.quests[index].targets.length,
        };
      const receiptId = id("native");
      const claim = {
        receipt_id: receiptId,
        day_id: dayId,
        kind,
        index,
        receiver_id: accountId,
        received_at: String(now),
        evidence_hash: hash(
          JSON.stringify({
            receiptId,
            policy: m.policy,
            manifest: m.hash,
            kind,
            index,
            accountId,
            at: now,
            checkpoint: kind === "quest" ? checkpoint : null,
            fix: {
              lat: fix.lat,
              lng: fix.lng,
              accuracy: fix.accuracy,
              timestamp: fix.timestamp,
            },
          }),
        ),
      };
      const signature = this.signer.sign(rewardMessage(this.contractId, claim));
      db.prepare(
        "INSERT INTO native_reward_claims(id,day_id,kind,item_index,account_id,player_id,body,signature,run_after,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)",
      ).run(
        receiptId,
        dayId,
        kind,
        index,
        accountId,
        player,
        JSON.stringify(claim),
        signature,
        now,
        now,
      );
      return this.receipt(
        db
          .prepare("SELECT * FROM native_reward_claims WHERE id=?")
          .get(receiptId),
      );
    });
  }
  receipt(r) {
    return {
      id: r.id,
      dayId: r.day_id,
      kind: r.kind,
      index: r.item_index,
      accountId: r.account_id,
      state: r.state,
      amount: r.amount,
      xp: r.xp,
      transaction: r.transaction_hash,
      createdAt: r.created_at,
      error: r.last_error,
    };
  }
  async collectionCodeMatches() {
    if (!this.config.codeHash) return false;
    const code = await this.provider.query({
      request_type: "view_account",
      account_id: this.contractId,
      finality: "final",
    });
    return code.code_hash === this.config.codeHash;
  }
  async snapshot(player, { accountId, location, fresh = false } = {}) {
    const now = this.clock(),
      day = dayKey(now, this.city.timezone),
      row = nativeDayRow(this.db, this.city.id, day, { published: true }),
      m = row ? this.day(row.id) : null;
    if (accountId) this.linked(player, accountId);
    const [treasury, balance, access, chainDay, cfg, codeMatches] =
      await Promise.all([
        this.view("get_treasury", {}, fresh),
        accountId
          ? this.view("get_account", { account_id: accountId }, fresh)
          : null,
        accountId ? this.tier(accountId) : { tier: 1, weighted: "0" },
        m ? this.view("get_day", { day_id: m.id }, fresh) : null,
        this.view("get_config", {}, fresh),
        this.collectionCodeMatches(),
      ]);
    const receipts = accountId
      ? this.db
          .prepare(
            "SELECT * FROM native_reward_claims WHERE account_id=? ORDER BY seq DESC LIMIT 40",
          )
          .all(accountId)
          .map((r) => this.receipt(r))
      : [];
    const claimed = new Set(
      m
        ? this.db
            .prepare(
              "SELECT item_index FROM native_reward_claims WHERE day_id=? AND kind='coin'",
            )
            .all(m.id)
            .map((r) => r.item_index)
        : [],
    );
    const progress =
      accountId && m
        ? this.db
            .prepare(
              "SELECT quest_index,checkpoint FROM native_progress WHERE day_id=? AND account_id=?",
            )
            .all(m.id, accountId)
        : [];
    if (location) point(location);
    const safety = m ? closedPlaces(this.db, m.cityId) : [];
    const discoveryOpen = (index, p) => {
      if (!safety.length) return true;
      try {
        assertNativePlaceOpen(this.db, m, index, p);
        return true;
      } catch (error) {
        if (["PLACE_CLOSED", "PLACE_UNVERIFIED"].includes(error.code))
          return false;
        throw error;
      }
    };
    const finds = new Set(m?.finds || []);
    const coins =
      m && location
        ? m.coins
            .map((p, index) => ({
              ...p,
              index,
              distance: Math.round(distance(location, p)),
              ...(finds.has(index) ? { find: true } : {}),
            }))
            .filter(
              (p) =>
                !claimed.has(p.index) &&
                p.distance <= 1000 &&
                discoveryOpen(null, p),
            )
            .sort((a, b) => a.distance - b.distance)
            .slice(0, 128)
        : [];
    const counts =
      accountId && m
        ? this.db
            .prepare(
              "SELECT COUNT(*) AS accepted, COALESCE(SUM(CASE WHEN state!='confirmed' THEN 1 ELSE 0 END),0) AS pending FROM native_reward_claims WHERE day_id=? AND kind='coin' AND account_id=?",
            )
            .get(m.id, accountId)
        : { accepted: 0, pending: 0 };
    const publicationReady = !!(
      m &&
      nativePublicationMatches(m, chainDay) &&
      now >= m.startsAt &&
      now < m.endsAt
    );
    return {
      status: m ? "ready" : "preparing",
      generatedAt: this.clock(),
      network: NETWORK,
      contractId: this.contractId,
      mode: "sponsored-testnet",
      accountId: accountId || null,
      collection: {
        available:
          publicationReady &&
          codeMatches &&
          cfg?.attestor === this.signer.publicKey &&
          cfg?.paused === false,
        paused:
          cfg?.paused !== false ||
          !codeMatches ||
          cfg?.attestor !== this.signer.publicKey,
        coinLimit: 100,
        coinsAcceptedToday: counts.accepted,
        pendingCoinsToday: counts.pending,
        minimumIntervalMs: 3000,
      },
      enrolled: !!(
        accountId &&
        this.db
          .prepare(
            "SELECT 1 FROM native_enrollments WHERE account_id=? AND player_id=?",
          )
          .get(accountId, player)
      ),
      treasury,
      balance,
      access,
      day: m
        ? {
            id: m.id,
            day: m.day,
            endsAt: m.endsAt,
            startsAt: m.startsAt,
            map: nativeMapProjection(this.db, m),
            hash: m.hash,
            coinCount: m.coins.length,
            version: m.version,
            findCount: finds.size,
            claimsAccepted:
              (chainDay?.claims_accepted || 0) +
              this.db
                .prepare(
                  "SELECT COUNT(*) n FROM native_reward_claims WHERE day_id=? AND state!='confirmed'",
                )
                .get(m.id).n,
            claimsLimit: chainDay?.claims_limit || 256,
            coinUnit: m.coinUnit,
            coins,
            quests: m.quests.map((q) => ({
              ...q,
              placeStatus: discoveryOpen(q.index, q.targets[0])
                ? "open"
                : "closed",
              activity: describeNativeQuest(q),
              prizeClaimed: !!chainDay?.winners?.[q.index],
              prizePending:
                !chainDay?.winners?.[q.index] &&
                !!this.db
                  .prepare(
                    "SELECT 1 FROM native_reward_claims WHERE day_id=? AND kind='quest' AND item_index=?",
                  )
                  .get(m.id, q.index),
              checkpoint:
                progress.find((p) => p.quest_index === q.index)?.checkpoint ||
                0,
            })),
            fieldReview: m.fieldReview,
            // Where this day's rewards come from: the sponsor treasury, or
            // staking yield that vaults have already paid in (with the payouts).
            funding:
              m.funding === "realized_yield" ? "realized_yield" : "sponsor",
            ...(m.funding === "realized_yield"
              ? { fundingEvidence: m.fundingEvidence }
              : {}),
          }
        : null,
      receipts,
      worker: this.workerStatus(),
      vaults: (this.config.vaults || []).map((v) => ({
        ...v,
        observation:
          this.db
            .prepare(
              "SELECT last_action,last_state,last_error FROM native_vault_jobs WHERE account_id=?",
            )
            .get(v.accountId) || null,
      })),
    };
  }
  workerStatus() {
    const r = this.db
      .prepare(
        "SELECT last_success,last_error FROM native_worker_lease WHERE id=1",
      )
      .get();
    return {
      ...r,
      queued: this.db
        .prepare(
          "SELECT COUNT(*) n FROM native_reward_claims WHERE state!='confirmed'",
        )
        .get().n,
    };
  }
}
