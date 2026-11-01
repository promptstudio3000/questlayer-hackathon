// Earned NPC rolls (docs/GAME-LOOPS.md P0-4, docs/NPC-GAMES.md). Turns the
// roll tickets that lurker wins put in the hunt pouch into on-chain
// commit-reveal rolls on the npc-games contract, and the recorded outcome into
// an ordinary demo Aura whose NEAR claim id is `earned:npc-roll:<roll_id>`
// (`earned:npc:roll:<roll_id>` for NPC-only editions, whose prefix the
// collectibles contract enforces).
//
// No wager: a roll costs one earned ticket, every call carries zero NEAR, and
// the prize is cosmetic. The server never decides the outcome. It only:
//   1. signs a ticket for a fresh secret commitment (one ticket per roll),
//   2. reveals the secret once `start_roll` is final and 3 blocks old,
//   3. reads `get_roll` and pays exactly the recorded prize, once.
// The ticket key is a private file installed on the host; without it (or when
// it does not match the contract's ticket signer) rolls stay switched off.
import { createHash, createPrivateKey, createPublicKey, randomBytes, sign } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { assert, GameError } from "../domain.mjs";
import { atomic, history } from "../database.mjs";
import { ensureModuleVersion } from "../schema-compatibility.mjs";
import { NPC_ROLLS_SCHEMA } from "./rolls-schema.mjs";

export { NPC_ROLLS_SCHEMA };
import { AURA_CATALOG, awardClaimPrefix } from "../aura-catalog.mjs";
import { grantEdition } from "../actors/hunt/rewards.mjs";
import { NETWORK } from "../native/network.mjs";


export const TICKET_TTL_MS = 10 * 60_000;
export const MIN_REVEAL_DELAY_BLOCKS = 3;
export const CONSOLATION_XP = 25;
const ROLL_ID = /^roll-[0-9a-f]{24}$/;
const START_GAS = "50000000000000";
const RESOLVE_GAS = "50000000000000";

// Prize ids published in the on-chain table -> demo Aura editions. A rare or
// epic prize picks a chest edition of that rarity from the on-chain random
// value (anyone can recompute it from get_roll); the legendary prize is the
// NPC-only Will-o'-Wisp Halo. "trader-voucher" pays a common Aura for now:
// the altar takes one for Wardbreaker Horns and traders buy them.
export const ROLL_PRIZES = Object.freeze({
  "trader-voucher": Object.freeze({ label: "Trader's token", editions: chestEditions("common") }),
  "aura-rare": Object.freeze({ label: "Rare Aura", editions: chestEditions("rare") }),
  "aura-epic": Object.freeze({ label: "Epic Aura", editions: chestEditions("epic") }),
  "aura-legendary-wisp": Object.freeze({ label: "Will-o'-Wisp Halo", editions: Object.freeze(["wisp"]) }),
});
function chestEditions(rarity) {
  return Object.freeze(AURA_CATALOG.filter((e) => e.source === "chest" && e.native && e.rarity === rarity).map((e) => e.id));
}

/** Claim id for the collectibles contract: NPC-only editions need the earned:npc: prefix. */
export function rollClaimId(edition, rollId) {
  const prefix = awardClaimPrefix(edition);
  return prefix === "earned:" ? `earned:npc-roll:${rollId}` : `${prefix}roll:${rollId}`;
}

/** The exact text npc-games `ticket_message` returns (contracts/npc-games/src/lib.rs). */
export function ticketMessage(contractId, { rollId, accountId, commit, tableId, expiresAtMs }) {
  return `QuestLayer NPC roll ticket v1\nContract: ${contractId}\nNetwork: ${NETWORK}\nRoll: ${rollId}\nAccount: ${accountId}\nCommit: ${commit}\nTable: ${tableId}\nExpires: ${expiresAtMs}`;
}

/** Loads the dedicated ticket key. Never generates one: a missing file means rolls are off. */
export function loadTicketSigner(path) {
  if (!path || !existsSync(path)) return null;
  assert((statSync(path).mode & 0o077) === 0, "The roll ticket key must have private file permissions.", 503);
  const key = createPrivateKey(readFileSync(path));
  return {
    publicKey: createPublicKey(key).export({ type: "spki", format: "der" }).subarray(-32).toString("base64"),
    sign: (message) => sign(null, Buffer.from(message), key).toString("base64"),
  };
}

const sha256hex = (bytes) => createHash("sha256").update(bytes).digest("hex");
const tableExists = (db, name) => !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name);

/**
 * @param db        game database
 * @param options.contract  { contractId, view(method, args, fresh) } for npc-games
 * @param options.finalHeight  async () => latest final block height
 * @param options.signer    loadTicketSigner() result or null
 * @param options.manifest  public/native-npc-games-<network>.json
 */
export class NpcRolls {
  constructor(db, { contract, finalHeight, signer, manifest, clock = Date.now, tableId } = {}) {
    ensureModuleVersion(db, NPC_ROLLS_SCHEMA);
    this.db = db;
    this.contract = contract || null;
    this.finalHeight = finalHeight;
    this.signer = signer || null;
    this.manifest = manifest || null;
    this.clock = clock;
    this.tableId = tableId || Object.keys(manifest?.tables || {})[0] || "wisp-v1";
    this.ready = null; // { ok, reason, until }
  }

  get contractId() {
    return this.contract?.contractId || null;
  }

  /** Whether the contract trusts this host's ticket key and the table is open (cached 60 s). */
  async readiness() {
    if (!this.contract) return { ok: false, reason: "Wisp rolls are not deployed on this network." };
    if (!this.signer) return { ok: false, reason: "Wisp rolls are not switched on on this host yet." };
    const now = this.clock();
    if (this.ready && this.ready.until > now) return this.ready;
    let ready;
    try {
      const [config, table] = await Promise.all([
        this.contract.view("get_config", {}, true),
        this.contract.view("get_table", { table_id: this.tableId }, true),
      ]);
      if (config?.ticket_signer !== this.signer.publicKey) ready = { ok: false, reason: "Wisp rolls are not switched on on this host yet." };
      else if (!table?.active) ready = { ok: false, reason: "The wisp is resting. New rolls open again soon." };
      else ready = { ok: true, table };
    } catch {
      ready = { ok: false, reason: "Wisp rolls are temporarily unavailable.", transient: true };
    }
    this.ready = { ...ready, until: now + (ready.transient ? 10_000 : 60_000) };
    return this.ready;
  }

  tickets(player) {
    const earned = tableExists(this.db, "monster_rewards")
      ? this.db.prepare("SELECT COALESCE(SUM(amount),0) AS n FROM monster_rewards WHERE player_id=? AND kind='roll'").get(player).n
      : 0;
    const used = this.db.prepare("SELECT COUNT(*) AS n FROM npc_rolls WHERE player_id=?").get(player).n;
    return { earned, used, available: Math.max(0, earned - used) };
  }

  odds(table = this.manifest?.tables?.[this.tableId]) {
    if (!table?.tiers) return [];
    return table.tiers.map((t, i) => ({
      prize: t.prize,
      label: ROLL_PRIZES[t.prize]?.label || t.prize,
      chance: t.weight / table.total_weight,
      dailyCap: t.daily_cap ?? null,
      minimum: i === table.minimum,
    }));
  }

  view(row) {
    const reward = JSON.parse(row.reward || "{}");
    return {
      rollId: row.roll_id,
      accountId: row.account_id,
      tableId: row.table_id,
      state: row.state,
      outcome: row.outcome,
      prize: row.prize,
      capped: !!row.capped,
      reward: Object.keys(reward).length ? reward : null,
      itemId: row.item_id,
      claimId: row.claim_id,
      createdAt: row.created_at,
    };
  }

  async status(player) {
    assert(player, "Sign in to see your rolls.", 401, "AUTH");
    const ready = await this.readiness();
    const rolls = this.db.prepare("SELECT * FROM npc_rolls WHERE player_id=? ORDER BY created_at DESC LIMIT 10").all(player);
    return {
      enabled: ready.ok,
      reason: ready.ok ? null : ready.reason,
      network: NETWORK,
      contractId: this.contractId,
      tableId: this.tableId,
      odds: this.odds(ready.table || undefined),
      tickets: this.tickets(player),
      rolls: rolls.map((r) => this.view(r)),
    };
  }

  linked(player, accountId) {
    return !!this.db.prepare("SELECT 1 FROM wallet_links WHERE player_id=? AND account_id=?").get(player, accountId);
  }

  async chainRoll(rollId) {
    return (await this.contract.view("get_roll", { roll_id: rollId }, true)) || null;
  }

  /** Signs (or re-signs) the player's open ticket, spending one earned roll ticket for a new roll. */
  async ticket(player, accountId) {
    assert(player, "Sign in to roll.", 401, "AUTH");
    assert(typeof accountId === "string" && accountId.length <= 64, "Choose your explorer account.", 400);
    const ready = await this.readiness();
    assert(ready.ok, ready.reason, 503, "ROLLS_DISABLED");
    assert(this.linked(player, accountId), "Link the NEAR account that rolls first.", 403, "ROLL_ACCOUNT");
    let open = this.db.prepare("SELECT * FROM npc_rolls WHERE player_id=? AND state='issued' ORDER BY created_at LIMIT 1").get(player);
    // A ticket the chain already used is a started roll, never re-signed.
    if (open && (await this.chainRoll(open.roll_id))) {
      await this.sync(player, open.roll_id);
      open = null;
    }
    const now = this.clock(),
      expiresAtMs = now + TICKET_TTL_MS;
    const row = atomic(this.db, () => {
      const current = open && this.db.prepare("SELECT * FROM npc_rolls WHERE roll_id=? AND state='issued'").get(open.roll_id);
      if (current) {
        this.db.prepare("UPDATE npc_rolls SET account_id=?,expires_at=?,updated_at=? WHERE roll_id=?").run(accountId, expiresAtMs, now, current.roll_id);
      } else {
        const t = this.tickets(player);
        assert(t.available > 0, "No roll tickets left. Beat a lurker or strike the weekly boss to earn one.", 409, "NO_ROLL_TICKETS");
        const secret = randomBytes(32),
          rollId = `roll-${randomBytes(12).toString("hex")}`;
        this.db
          .prepare(
            "INSERT INTO npc_rolls(roll_id,player_id,account_id,table_id,secret,commit_hex,expires_at,state,created_at,updated_at) VALUES(?,?,?,?,?,?,?,'issued',?,?)",
          )
          .run(rollId, player, accountId, this.tableId, secret.toString("hex"), sha256hex(secret), expiresAtMs, now, now);
        return this.db.prepare("SELECT * FROM npc_rolls WHERE roll_id=?").get(rollId);
      }
      return this.db.prepare("SELECT * FROM npc_rolls WHERE roll_id=?").get(current.roll_id);
    });
    const fields = { rollId: row.roll_id, accountId, commit: row.commit_hex, tableId: row.table_id, expiresAtMs: row.expires_at };
    const signature = this.signer.sign(ticketMessage(this.contractId, fields));
    return {
      roll: this.view(row),
      tickets: this.tickets(player),
      next: "start",
      call: {
        receiverId: this.contractId,
        methodName: "start_roll",
        args: { roll_id: row.roll_id, table_id: row.table_id, commit: row.commit_hex, expires_at_ms: String(row.expires_at), signature },
        gas: START_GAS,
        deposit: "0",
      },
    };
  }

  /**
   * Reads the chain and moves the roll forward. Returns the next client step:
   * start | wait | resolve (with the revealed secret) | timeout | done.
   */
  async sync(player, rollId, { reveal = true } = {}) {
    assert(typeof rollId === "string" && ROLL_ID.test(rollId), "Unknown roll.", 404, "ROLL_NOT_FOUND");
    const row = this.db.prepare("SELECT * FROM npc_rolls WHERE roll_id=?").get(rollId);
    assert(row && (player === null || row.player_id === player), "Unknown roll.", 404, "ROLL_NOT_FOUND");
    if (row.state === "settled") return { roll: this.view(row), next: "done" };
    assert(this.contract, "Wisp rolls are not deployed on this network.", 503, "ROLLS_DISABLED");
    const chain = await this.chainRoll(rollId);
    if (!chain) {
      return { roll: this.view(row), next: row.expires_at > this.clock() ? "start" : "ticket" };
    }
    assert(
      chain.account_id === row.account_id && chain.table_id === row.table_id && chain.commit === row.commit_hex,
      "This roll does not match its ticket.",
      503,
      "ROLL_MISMATCH",
    );
    const startHeight = Number(chain.start_height);
    if (row.state === "issued") {
      this.db.prepare("UPDATE npc_rolls SET state='started',start_height=?,updated_at=? WHERE roll_id=? AND state='issued'").run(startHeight, this.clock(), rollId);
    }
    if (chain.status === "Resolved" || chain.status === "TimedOut") {
      const settled = this.settle(rollId, chain);
      return { roll: this.view(settled), next: "done" };
    }
    const current = this.db.prepare("SELECT * FROM npc_rolls WHERE roll_id=?").get(rollId);
    const height = await this.finalHeight();
    const timeoutBlocks = Number(this.manifest?.timeoutBlocks) || 600;
    if (height >= startHeight + timeoutBlocks)
      return {
        roll: this.view(current),
        next: "timeout",
        call: { receiverId: this.contractId, methodName: "claim_timeout", args: { roll_id: rollId }, gas: RESOLVE_GAS, deposit: "0" },
      };
    if (height < startHeight + MIN_REVEAL_DELAY_BLOCKS || !reveal)
      return { roll: this.view(current), next: "wait", blocksLeft: Math.max(0, startHeight + MIN_REVEAL_DELAY_BLOCKS - height) };
    // The commitment is on chain and final, and the reveal lands in a later
    // block whose seed nobody knows yet: safe to hand the secret to anyone.
    return {
      roll: this.view(current),
      next: "resolve",
      call: { receiverId: this.contractId, methodName: "resolve_roll", args: { roll_id: rollId, secret: row.secret }, gas: RESOLVE_GAS, deposit: "0" },
    };
  }

  /** Pays the recorded on-chain prize exactly once. */
  settle(rollId, chain) {
    const db = this.db,
      at = this.clock();
    return atomic(db, () => {
      const row = db.prepare("SELECT * FROM npc_rolls WHERE roll_id=?").get(rollId);
      if (row.state === "settled") return row;
      const prize = String(chain.prize || "");
      const editions = ROLL_PRIZES[prize]?.editions || [];
      const seed = typeof chain.random === "string" && /^[0-9a-f]{16,}$/.test(chain.random) ? chain.random : sha256hex(rollId);
      const start = editions.length ? parseInt(seed.slice(0, 8), 16) % editions.length : 0;
      let item = null;
      for (let i = 0; i < editions.length && !item; i++) item = grantEdition(db, row.player_id, editions[(start + i) % editions.length], at);
      let reward, claimId = null;
      if (item) {
        claimId = rollClaimId(item.edition, rollId);
        reward = { kind: "aura", itemId: item.id, name: item.name, rarity: item.rarity, edition: item.edition, serial: item.serial };
      } else {
        db.prepare("UPDATE players SET xp=xp+? WHERE id=?").run(CONSOLATION_XP, row.player_id);
        reward = { kind: "xp", xp: CONSOLATION_XP, reason: editions.length ? "sold-out" : "unknown-prize" };
      }
      db.prepare(
        "UPDATE npc_rolls SET state='settled',start_height=?,outcome=?,prize=?,capped=?,reward=?,item_id=?,claim_id=?,updated_at=? WHERE roll_id=?",
      ).run(Number(chain.start_height), chain.status, prize, chain.capped ? 1 : 0, JSON.stringify(reward), item?.id ?? null, claimId, at, rollId);
      history(db, row.player_id, "npc-roll", item ? `The wisp gave you ${item.name}` : "The wisp roll paid XP", 0, {
        rollId,
        outcome: chain.status,
        prize,
        capped: !!chain.capped,
        ...(item ? { item: item.id } : { xp: CONSOLATION_XP }),
      });
      return db.prepare("SELECT * FROM npc_rolls WHERE roll_id=?").get(rollId);
    });
  }

  /** Award claim id reserved for an Aura a roll paid (AwardVouchers uses it). */
  claimIdFor(itemId) {
    return this.db.prepare("SELECT claim_id FROM npc_rolls WHERE item_id=? AND claim_id IS NOT NULL").get(itemId)?.claim_id || null;
  }

  /** Background pass: settles started rolls somebody already resolved or timed out. */
  async tick(limit = 20) {
    if (!this.contract) return 0;
    const rows = this.db
      .prepare("SELECT roll_id FROM npc_rolls WHERE state='started' AND updated_at<? ORDER BY updated_at LIMIT ?")
      .all(this.clock() - 20_000, limit);
    let settled = 0;
    for (const { roll_id } of rows) {
      try {
        const r = await this.sync(null, roll_id, { reveal: false });
        if (r.next === "done") settled++;
        else this.db.prepare("UPDATE npc_rolls SET updated_at=? WHERE roll_id=?").run(this.clock(), roll_id);
      } catch (error) {
        if (!(error instanceof GameError)) console.error("NPC roll worker:", error?.message || error);
      }
    }
    return settled;
  }
}

export function startNpcRollWorker(rolls, { intervalMs = 30_000 } = {}) {
  if (!rolls?.contract) return { stop() {} };
  let running = false;
  const timer = setInterval(async () => {
    if (running) return;
    running = true;
    try {
      await rolls.tick();
    } finally {
      running = false;
    }
  }, intervalMs);
  timer.unref?.();
  return { stop: () => clearInterval(timer) };
}

export function createNpcRollRoutes(rolls) {
  const ROLL = /^\/api\/npc-rolls\/(roll-[0-9a-f]{24})$/;
  return {
    async handle(req, res, url, { player, body, respond, assert: check }) {
      const path = url.pathname,
        method = req.method || "GET";
      if (!path.startsWith("/api/npc-rolls")) return false;
      check(rolls, "Wisp rolls are not available on this host.", 503, "ROLLS_DISABLED");
      if (path === "/api/npc-rolls" && method === "GET") {
        respond(res, await rolls.status(player));
        return true;
      }
      if (path === "/api/npc-rolls" && method === "POST") {
        const input = await body(req);
        respond(res, await rolls.ticket(player, String(input.accountId || "")));
        return true;
      }
      const m = ROLL.exec(path);
      if (m && method === "POST") {
        check(player, "Sign in to roll.", 401, "AUTH");
        respond(res, await rolls.sync(player, m[1]));
        return true;
      }
      return false;
    },
  };
}
