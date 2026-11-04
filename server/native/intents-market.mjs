// Experimental Aura <-> wNEAR market on a SELF-DEPLOYED testnet NEAR Intents
// verifier (near/intents v0.4.5, see docs/NEAR-INTENTS-MARKET.md).
//
// Players sign NEP-413 token_diff intents with their device key; nothing
// moves until the solver (the game's relayer account, which only pays gas)
// submits a matching pair to the verifier's execute_intents. The verifier is
// the authority: it checks every signature, registered key, nonce and
// balance, and settles both legs atomically. The order book is a durable
// copy of signed intents (like the market v2 order index) and is re-checked
// against the verifier before it is shown or filled.
import {
  registerModuleSchema,
  ensureModuleVersion,
} from "../schema-compatibility.mjs";
import { assert } from "../domain.mjs";
import {
  auraOrderTerms,
  checkWithdrawal,
  grossForNet,
  matches,
  netDeltas,
  parseNonce,
  verifyIntentLocally,
} from "./intents.mjs";

export const INTENTS_MARKET_SCHEMA = registerModuleSchema({
  name: "intents-market",
  version: 1,
  sql: `
CREATE TABLE IF NOT EXISTS intents_orders(
 id TEXT PRIMARY KEY,
 verifier TEXT NOT NULL,
 maker TEXT NOT NULL,
 side TEXT NOT NULL CHECK(side IN ('sell','buy')),
 token_id TEXT NOT NULL,
 price TEXT NOT NULL CHECK(price GLOB '[0-9]*'),
 deadline_ms INTEGER NOT NULL,
 signed_intent TEXT NOT NULL CHECK(json_valid(signed_intent)),
 state TEXT NOT NULL CHECK(state IN ('open','filling','filled','closed','expired')),
 reason TEXT,
 taker TEXT,
 settlement_tx TEXT,
 received_at INTEGER NOT NULL,
 checked_at INTEGER NOT NULL,
 closed_at INTEGER
);
CREATE INDEX IF NOT EXISTS intents_orders_open ON intents_orders(verifier,state,token_id);
CREATE INDEX IF NOT EXISTS intents_orders_maker ON intents_orders(maker,received_at DESC);
CREATE TABLE IF NOT EXISTS intents_settlements(
 tx_hash TEXT PRIMARY KEY,
 verifier TEXT NOT NULL,
 kind TEXT NOT NULL CHECK(kind IN ('trade','withdraw')),
 accounts TEXT NOT NULL CHECK(json_valid(accounts)),
 detail TEXT NOT NULL CHECK(json_valid(detail)),
 recorded_at INTEGER NOT NULL
);
`,
});

const MAX_OPEN = 256,
  MAX_OPEN_PER_MAKER = 12,
  EXECUTE_GAS = 150n * 10n ** 12n,
  WITHDRAW_GAS = 250n * 10n ** 12n;
const txHash = (r) => r?.transaction?.hash || r?.transaction_outcome?.id || null;
const failed = (r) =>
  Boolean(r?.status?.Failure) ||
  (r?.receipts_outcome || []).some((o) => o.outcome?.status?.Failure);

export class IntentsMarket {
  /**
   * @param verifier NativeContractReader for the verifier account
   * @param solver   service account ({account, accountId}) that pays gas, or null
   */
  constructor(db, { verifier, nftContract, wnear, solver = null, manifest = {}, now = () => Date.now() }) {
    ensureModuleVersion(db, INTENTS_MARKET_SCHEMA);
    this.db = db;
    this.verifier = verifier;
    this.verifierId = verifier.contractId;
    this.nftContract = nftContract;
    this.wnear = wnear;
    this.solver = solver;
    this.manifest = manifest;
    this.now = now;
    this.locks = new Set();
  }
  get tokens() {
    return { nftContract: this.nftContract, wnear: this.wnear };
  }
  /** Token ids plus the verifier's current fee (pips), cached for a minute. */
  async terms() {
    const now = this.now();
    if (!this.feeCache || now - this.feeCache.at > 60_000) {
      const fee = await this.verifier.view("fee", {}).catch(() => null);
      this.feeCache = { at: now, fee: Number.isSafeInteger(fee) ? fee : this.feeCache?.fee ?? 0 };
    }
    return { ...this.tokens, feePips: this.feeCache.fee };
  }
  row(id) {
    return this.db.prepare("SELECT * FROM intents_orders WHERE id=?").get(id);
  }
  view(r) {
    return {
      id: r.id,
      maker: r.maker,
      side: r.side,
      tokenId: r.token_id,
      price: r.price,
      // What the buyer gives at the verifier's current fee (price + fee).
      buyerPays: grossForNet(r.price, this.feeCache?.fee ?? 0).toString(),
      deadlineMs: r.deadline_ms,
      state: r.state,
      reason: r.reason,
      taker: r.taker,
      settlementTx: r.settlement_tx,
      signed: JSON.parse(r.signed_intent),
    };
  }

  async config() {
    // Refresh the fee cache first so listed orders show the same buyerPays.
    this.feeCache = null;
    const [salt, { feePips: fee }] = await Promise.all([this.verifier.view("current_salt", {}), this.terms()]);
    return {
      experimental: true,
      label: "Self-deployed NEAR Intents verifier (testnet, experimental)",
      verifier: this.verifierId,
      nftContract: this.nftContract,
      wnear: this.wnear,
      salt,
      fee,
      solver: this.solver?.accountId ?? null,
      source: this.manifest.source ?? null,
      wasmSha256: this.manifest.wasmSha256 ?? null,
    };
  }

  /** Verifier-side state for one account: key registration and balances. */
  async account(accountId, publicKey = null) {
    const wnearId = `nep141:${this.wnear}`;
    const [owned, keyRegistered] = await Promise.all([
      this.verifier.view("mt_tokens_for_owner", { account_id: accountId, from_index: "0", limit: 100 }, true),
      publicKey
        ? this.verifier.view("has_public_key", { account_id: accountId, public_key: publicKey }, true)
        : Promise.resolve(null),
    ]);
    const ids = owned.map((t) => t.token_id);
    if (!ids.includes(wnearId)) ids.push(wnearId);
    const balances = await this.verifier.view(
      "mt_batch_balance_of",
      { account_id: accountId, token_ids: ids },
      true,
    );
    const prefix = `nep171:${this.nftContract}:`;
    return {
      accountId,
      keyRegistered,
      wnear: balances[ids.indexOf(wnearId)] || "0",
      auras: ids
        .map((id, i) => ({ id, balance: balances[i] }))
        .filter((t) => t.id.startsWith(prefix) && t.balance === "1")
        .map((t) => t.id.slice(prefix.length)),
    };
  }

  /** Checks a payload statelessly, then against verifier state. */
  async verify(signed) {
    const body = verifyIntentLocally(signed, { verifier: this.verifierId, nowMs: this.now() });
    const [validSalt, keyOk, used] = await Promise.all([
      this.verifier.view("is_valid_salt", { salt: body.salt }, true),
      this.verifier.view("has_public_key", { account_id: body.signerId, public_key: body.publicKey }, true),
      this.verifier.view("is_nonce_used", { account_id: body.signerId, nonce: body.nonce }, true),
    ]);
    assert(validSalt, "The verifier salt has rotated. Sign again.", 409);
    assert(keyOk, "Register your signing key with the verifier first.", 409);
    assert(!used, "This intent was already used.", 409);
    return body;
  }
  async balance(accountId, tokenId) {
    return BigInt(await this.verifier.view("mt_balance_of", { account_id: accountId, token_id: tokenId }, true));
  }
  async fundedFor(maker, terms) {
    return terms.side === "sell"
      ? (await this.balance(maker, terms.nftTokenId)) === 1n
      : (await this.balance(maker, terms.wnearTokenId)) >= BigInt(terms.gross ?? terms.price);
  }

  /** Stores a maker's signed token_diff order after the verifier-side checks. */
  async submit(signed) {
    const body = await this.verify(signed);
    const terms = auraOrderTerms(body.intents, await this.terms());
    const id = `${body.signerId}:${body.nonce}`;
    const existing = this.row(id);
    if (existing) return { ...this.view(existing), duplicate: true };
    const counts = this.db
      .prepare("SELECT COUNT(*) total, SUM(maker=?) mine FROM intents_orders WHERE verifier=? AND state='open'")
      .get(body.signerId, this.verifierId);
    assert(counts.total < MAX_OPEN, "The intents order book is full. Try again later.", 503);
    assert((counts.mine || 0) < MAX_OPEN_PER_MAKER, "You have too many open intents. Let one expire first.", 409);
    assert(
      await this.fundedFor(body.signerId, terms),
      terms.side === "sell"
        ? "Deposit the Aura into the verifier before listing it."
        : "Deposit enough wNEAR into the verifier before making the offer.",
      409,
    );
    const now = this.now();
    this.db
      .prepare(
        `INSERT INTO intents_orders(id,verifier,maker,side,token_id,price,deadline_ms,signed_intent,state,received_at,checked_at)
         VALUES(?,?,?,?,?,?,?,?,'open',?,?)`,
      )
      .run(id, this.verifierId, body.signerId, terms.side, terms.tokenId, terms.price, body.deadlineMs, JSON.stringify(signed), now, now);
    return this.view(this.row(id));
  }

  list({ tokenId = null, limit = 100 } = {}) {
    const rows = tokenId
      ? this.db
          .prepare("SELECT * FROM intents_orders WHERE verifier=? AND state='open' AND token_id=? AND deadline_ms>? ORDER BY received_at DESC LIMIT ?")
          .all(this.verifierId, tokenId, this.now(), limit)
      : this.db
          .prepare("SELECT * FROM intents_orders WHERE verifier=? AND state='open' AND deadline_ms>? ORDER BY received_at DESC LIMIT ?")
          .all(this.verifierId, this.now(), limit);
    return rows.map((r) => this.view(r));
  }
  mine(accountId) {
    return this.db
      .prepare("SELECT * FROM intents_orders WHERE verifier=? AND (maker=? OR taker=?) ORDER BY received_at DESC LIMIT 30")
      .all(this.verifierId, accountId, accountId)
      .map((r) => this.view(r));
  }

  async execute(signedList, gas) {
    assert(this.solver, "The intents solver is not configured on this host.", 503);
    const simulation = await this.verifier.view("simulate_intents", { signed: signedList }, true);
    assert(
      !simulation.invariant_violated,
      "The verifier would not settle this trade (unmatched amounts).",
      409,
    );
    const result = await this.solver.account.callFunctionRaw({
      contractId: this.verifierId,
      methodName: "execute_intents",
      args: { signed: signedList },
      gas,
      deposit: 0n,
      waitUntil: "FINAL",
    });
    const hash = txHash(result);
    assert(!failed(result), `The verifier rejected the intents (transaction ${hash}).`, 409);
    return hash;
  }

  /** Takes an open order with the opposite signed token_diff. */
  async fill(orderId, takerSigned) {
    const row = this.row(String(orderId));
    assert(row && row.verifier === this.verifierId, "Unknown intent order.", 404);
    assert(row.state === "open", "This order is no longer open.", 409);
    assert(row.deadline_ms > this.now(), "This order has expired.", 409);
    assert(!this.locks.has(row.id), "This order is being filled right now.", 409);
    this.locks.add(row.id);
    try {
      const makerSigned = JSON.parse(row.signed_intent);
      const maker = await this.verify(makerSigned);
      const taker = await this.verify(takerSigned);
      assert(taker.signerId !== maker.signerId, "You cannot take your own order.", 409);
      const terms = await this.terms();
      const makerTerms = auraOrderTerms(maker.intents, terms),
        takerTerms = auraOrderTerms(taker.intents, terms);
      assert(matches(makerTerms, takerTerms), "Your intent does not match this order.", 409);
      assert(Object.keys(netDeltas([maker, taker], terms.feePips)).length === 0, "The trade does not net to zero.", 409);
      assert(await this.fundedFor(taker.signerId, takerTerms), takerTerms.side === "buy" ? "Deposit enough wNEAR into the verifier first." : "Deposit the Aura into the verifier first.", 409);
      this.db.prepare("UPDATE intents_orders SET state='filling', taker=?, checked_at=? WHERE id=? AND state='open'").run(taker.signerId, this.now(), row.id);
      let hash;
      try {
        hash = await this.execute([makerSigned, takerSigned], EXECUTE_GAS);
      } catch (error) {
        this.db.prepare("UPDATE intents_orders SET state='open', taker=NULL WHERE id=? AND state='filling'").run(row.id);
        throw error;
      }
      const now = this.now();
      this.db
        .prepare("UPDATE intents_orders SET state='filled', settlement_tx=?, closed_at=?, checked_at=? WHERE id=?")
        .run(hash, now, now, row.id);
      this.db
        .prepare("INSERT OR IGNORE INTO intents_settlements(tx_hash,verifier,kind,accounts,detail,recorded_at) VALUES(?,?,'trade',?,?,?)")
        .run(
          hash,
          this.verifierId,
          JSON.stringify([maker.signerId, taker.signerId]),
          JSON.stringify({
            orderId: row.id,
            tokenId: makerTerms.tokenId,
            price: makerTerms.price,
            makerSide: makerTerms.side,
            // The buyer's extra over `price`: the verifier fee, which goes to the treasury.
            fee: (BigInt(makerTerms.side === "buy" ? makerTerms.gross : takerTerms.gross) - BigInt(makerTerms.price)).toString(),
          }),
          now,
        );
      return { ...this.view(this.row(row.id)), transactionHash: hash };
    } finally {
      this.locks.delete(row.id);
    }
  }

  /** Submits a player's signed withdrawal (back to their own account only). */
  async withdraw(signed) {
    const body = await this.verify(signed);
    const intents = checkWithdrawal(body, this.tokens);
    const hash = await this.execute([signed], WITHDRAW_GAS);
    this.db
      .prepare("INSERT OR IGNORE INTO intents_settlements(tx_hash,verifier,kind,accounts,detail,recorded_at) VALUES(?,?,'withdraw',?,?,?)")
      .run(hash, this.verifierId, JSON.stringify([body.signerId]), JSON.stringify({ intents }), this.now());
    // Withdrawing a listed Aura closes its open orders.
    void this.reconcile({ maker: body.signerId }).catch(() => {});
    return { transactionHash: hash };
  }

  /**
   * Re-checks open orders against the verifier: an expired, used or no
   * longer funded intent closes. Run on start (after a restore) and by the
   * worker.
   */
  async reconcile({ maker = null, limit = 64 } = {}) {
    const now = this.now();
    const rows = maker
      ? this.db.prepare("SELECT * FROM intents_orders WHERE verifier=? AND state='open' AND maker=?").all(this.verifierId, maker)
      : this.db.prepare("SELECT * FROM intents_orders WHERE verifier=? AND state='open' ORDER BY checked_at LIMIT ?").all(this.verifierId, limit);
    let closed = 0;
    for (const r of rows) {
      const signed = JSON.parse(r.signed_intent);
      let state = "open",
        reason = null;
      if (r.deadline_ms <= now) [state, reason] = ["expired", "Deadline passed"];
      else {
        const nonce = signed.payload.nonce;
        const salt = parseNonce(Buffer.from(nonce, "base64"))?.salt;
        const [used, saltOk] = await Promise.all([
          this.verifier.view("is_nonce_used", { account_id: r.maker, nonce }, true),
          salt ? this.verifier.view("is_valid_salt", { salt }, true) : false,
        ]);
        if (used) [state, reason] = ["closed", "Intent used on chain"];
        else if (!saltOk) [state, reason] = ["closed", "Verifier salt rotated"];
        else {
          const terms = auraOrderTerms(JSON.parse(signed.payload.message).intents, await this.terms());
          if (terms.price !== r.price) [state, reason] = ["closed", "Verifier fee changed; sign the order again"];
          else if (!(await this.fundedFor(r.maker, terms))) [state, reason] = ["closed", "No longer funded in the verifier"];
        }
      }
      if (state !== "open") {
        closed++;
        this.db.prepare("UPDATE intents_orders SET state=?, reason=?, closed_at=?, checked_at=? WHERE id=? AND state='open'").run(state, reason, now, now, r.id);
      } else this.db.prepare("UPDATE intents_orders SET checked_at=? WHERE id=?").run(now, r.id);
    }
    return { checked: rows.length, closed };
  }

  settlements(limit = 20) {
    return this.db
      .prepare("SELECT * FROM intents_settlements WHERE verifier=? ORDER BY recorded_at DESC LIMIT ?")
      .all(this.verifierId, limit)
      .map((r) => ({ transactionHash: r.tx_hash, kind: r.kind, accounts: JSON.parse(r.accounts), detail: JSON.parse(r.detail), recordedAt: r.recorded_at }));
  }
}

export function createIntentsRoutes(market) {
  return {
    async handle(req, res, url, { player, body, respond, assert: check }) {
      const path = url.pathname,
        method = req.method || "GET";
      if (!path.startsWith("/api/native/intents")) return false;
      if (path === "/api/native/intents" && method === "GET") {
        respond(res, market ? { enabled: true, ...(await market.config()), orders: market.list(), settlements: market.settlements() } : { enabled: false });
        return true;
      }
      check(market, "The NEAR Intents market is not enabled on this host.", 503, "INTENTS_DISABLED");
      if (path === "/api/native/intents/account" && method === "GET") {
        const accountId = String(url.searchParams.get("account") || "");
        const publicKey = url.searchParams.get("publicKey");
        check(/^[a-z0-9._-]{2,64}$/.test(accountId), "Choose a NEAR account.", 400);
        respond(res, { ...(await market.account(accountId, publicKey)), orders: market.mine(accountId) });
        return true;
      }
      if (method !== "POST") return false;
      check(player, "Sign in to trade.", 401, "AUTH");
      const input = await body(req);
      if (path === "/api/native/intents/orders") {
        respond(res, await market.submit(input.signed));
        return true;
      }
      if (path === "/api/native/intents/fill") {
        respond(res, await market.fill(input.orderId, input.signed));
        return true;
      }
      if (path === "/api/native/intents/withdraw") {
        respond(res, await market.withdraw(input.signed));
        return true;
      }
      return false;
    },
  };
}
