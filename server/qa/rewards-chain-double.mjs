// Stateful in-process double of contracts/rewards for rehearsals without keys
// or network. It mirrors the contract's own guards (one claim per coin and per
// personal quest, idempotent receipts, signed attestations, closed days, the
// receipt grace period, per-date caps and ledger conservation) so a server bug
// that would be refused on testnet is refused here too.
//
// It is not the contract, not a sandbox test and not evidence about testnet.
import { createPublicKey, verify } from "node:crypto";
import { hash } from "../domain.mjs";
import { rewardMessage } from "../native/reward-manifest.mjs";

const NEAR = 10n ** 24n,
  DAY_MS = 86400000,
  COIN_XP = 2,
  FIND_XP = 15,
  CLAIM_LIMIT = 256,
  SPKI_ED25519 = Buffer.from("302a300506032b6570032100", "hex");

class ContractPanic extends Error {
  constructor(message) {
    super(`Smart contract panicked: ${message}`);
    this.panic = message;
  }
}
const require = (ok, message) => {
  if (!ok) throw new ContractPanic(message);
};

export function rewardsChainDouble({
  contractId,
  attestorPublicKey,
  clock,
  funded = NEAR / 5n,
  codeHash = "qa-reviewed-code",
}) {
  const attestor = createPublicKey({
    key: Buffer.concat([
      SPKI_ED25519,
      Buffer.from(attestorPublicKey, "base64"),
    ]),
    format: "der",
    type: "spki",
  });
  const bucket = () => ({ available: funded / 2n, reserved: 0n, awarded: 0n });
  const s = {
    coins: bucket(),
    zones: bucket(),
    funded,
    owed: 0n,
    pending: 0n,
    withdrawn: 0n,
    days: new Map(),
    receipts: new Map(),
    players: new Map(),
    personal: new Set(),
    dateTotals: new Map(),
    // Every transaction attempt, including the ones the contract refused.
    sent: [],
    rejected: [],
  };
  const check = () => {
    require(s.funded ===
      s.coins.available +
        s.coins.reserved +
        s.zones.available +
        s.zones.reserved +
        s.owed +
        s.pending +
        s.withdrawn, "Ledger conservation");
  };
  const dateOf = (dayId) => dayId.match(/(\d{4}-\d{2}-\d{2})-v\d+$/)[1];
  const dayView = (id, d) => ({
    manifest_hash: d.hash,
    starts_at: String(d.starts),
    ends_at: String(d.ends),
    coin_count: d.count,
    coin_unit: String(d.unit),
    remaining: String(d.remaining),
    quests: d.quests,
    winners: d.winners,
    closed: d.closed,
    claims_accepted: d.accepted,
    finds: d.finds,
    find_xp: FIND_XP,
    coin_xp: COIN_XP,
    claims_limit: CLAIM_LIMIT,
    storage_reserved: true,
  });
  const view = (method, args = {}) => {
    const b = (x) => ({
      available: String(x.available),
      reserved: String(x.reserved),
      awarded: String(x.awarded),
    });
    if (method === "get_config")
      return {
        version: 2,
        network: "testnet",
        attestor: attestorPublicKey,
        publisher: contractId,
        paused: false,
      };
    if (method === "get_treasury")
      return {
        coins: b(s.coins),
        zones: b(s.zones),
        funded: String(s.funded),
        owed: String(s.owed),
        pending: String(s.pending),
        withdrawn: String(s.withdrawn),
        policy: "50/50-v1",
      };
    if (method === "get_day") {
      const d = s.days.get(args.day_id);
      return d ? dayView(args.day_id, d) : null;
    }
    if (method === "get_receipt")
      return s.receipts.get(args.receipt_id) || null;
    if (method === "get_account") {
      const p = s.players.get(args.account_id) || { credit: 0n, xp: 0 };
      return {
        credit: String(p.credit),
        pending: "0",
        withdrawn: "0",
        xp: p.xp,
      };
    }
    if (method === "get_date_totals") {
      const t = s.dateTotals.get(args.date) || { coins: 0n, zones: 0n };
      return {
        date: args.date,
        coins: String(t.coins),
        zones: String(t.zones),
        cap: String(NEAR / 10n),
      };
    }
    throw Error(`Unexpected rehearsal view ${method}`);
  };
  const provider = {
    viewNodeStatus: async () => ({ chain_id: "testnet" }),
    query: async (q) => {
      if (q.request_type === "view_account")
        return {
          amount: String(s.funded - s.withdrawn + 3n * NEAR),
          storage_usage: 200000,
          code_hash: codeHash,
        };
      const args = JSON.parse(
        Buffer.from(q.args_base64 || "e30=", "base64").toString(),
      );
      return {
        result: [...Buffer.from(JSON.stringify(view(q.method_name, args)))],
      };
    },
  };
  const methods = {
    publish_day(a) {
      const now = clock();
      require(!s.days.has(a.day_id), "Day exists");
      const starts = Number(a.starts_at),
        ends = Number(a.ends_at);
      require(ends > now &&
        ends > starts &&
        ends - starts <= 25 * 3600000 &&
        starts <= now + 2 * DAY_MS, "Invalid day window");
      require(a.quests.length === 6, "Six city slots required");
      const coinCost = BigInt(a.coin_unit) * BigInt(a.coin_count),
        zoneCost = a.quests.reduce((n, q) => n + BigInt(q.reward), 0n);
      for (const q of a.quests)
        require(q.tier !== 1 ||
          BigInt(q.reward) === 0n, "Free zones award XP only");
      require(coinCost <= NEAR / 10n &&
        zoneCost <= NEAR / 10n, "Daily testnet cap");
      require(coinCost <= s.coins.available &&
        zoneCost <= s.zones.available, "Insufficient liquid funding");
      const date = dateOf(a.day_id),
        t = s.dateTotals.get(date) || { coins: 0n, zones: 0n };
      require(t.coins + coinCost <= NEAR / 10n &&
        t.zones + zoneCost <= NEAR / 10n, "Daily cap across cities");
      s.dateTotals.set(date, {
        coins: t.coins + coinCost,
        zones: t.zones + zoneCost,
      });
      s.coins.available -= coinCost;
      s.coins.reserved += coinCost;
      s.zones.available -= zoneCost;
      s.zones.reserved += zoneCost;
      s.days.set(a.day_id, {
        hash: a.manifest_hash,
        starts,
        ends,
        count: a.coin_count,
        unit: BigInt(a.coin_unit),
        coins: new Set(),
        remaining: coinCost,
        quests: structuredClone(a.quests),
        winners: a.quests.map(() => null),
        finds: [...new Set(a.finds || [])].sort((x, y) => x - y),
        closed: false,
        accepted: 0,
      });
    },
    claim({ claim: c, signature }) {
      const message = rewardMessage(contractId, c);
      require(verify(
        null,
        Buffer.from(message),
        attestor,
        Buffer.from(signature, "base64"),
      ), "Invalid attestation");
      const messageHash = hash(message),
        existing = s.receipts.get(c.receipt_id);
      if (existing) {
        require(existing.message_hash === messageHash, "Receipt conflict");
        return existing;
      }
      const d = s.days.get(c.day_id);
      require(d, "Unknown day");
      require(!d.closed, "Day closed");
      require(d.accepted <
        CLAIM_LIMIT, "Daily native receipt capacity reached");
      const at = Number(c.received_at);
      require(at >= d.starts &&
        at < d.ends &&
        at <= clock(), "Invalid receipt time");
      let amount, xp;
      if (c.kind === "coin") {
        require(c.index < d.count, "Invalid coin index");
        require(!d.coins.has(c.index), "Coin already claimed");
        d.coins.add(c.index);
        d.remaining -= d.unit;
        s.coins.reserved -= d.unit;
        s.coins.awarded += d.unit;
        amount = d.unit;
        xp = d.finds.includes(c.index) ? FIND_XP : COIN_XP;
      } else {
        require(c.kind === "quest", "Invalid claim kind");
        const q = d.quests[c.index];
        require(q, "Invalid quest index");
        require(at >= Number(q.opens_at) &&
          at < Number(q.closes_at), "Quest was closed");
        const personal = `${c.day_id}:${c.index}:${c.receiver_id}`;
        require(!s.personal.has(personal), "Quest already completed");
        s.personal.add(personal);
        amount = 0n;
        if (!d.winners[c.index]) {
          d.winners[c.index] = c.receiver_id;
          amount = BigInt(q.reward);
          s.zones.reserved -= amount;
          s.zones.awarded += amount;
        }
        xp = q.xp;
      }
      const p = s.players.get(c.receiver_id) || { credit: 0n, xp: 0 };
      p.credit += amount;
      p.xp += xp;
      s.players.set(c.receiver_id, p);
      s.owed += amount;
      d.accepted++;
      const receipt = {
        receiver_id: c.receiver_id,
        amount: String(amount),
        xp,
        message_hash: messageHash,
      };
      s.receipts.set(c.receipt_id, receipt);
      return receipt;
    },
    close_day({ day_id }) {
      const d = s.days.get(day_id);
      require(d, "Unknown day");
      if (d.closed) return;
      require(clock() >= d.ends + DAY_MS, "Receipt grace period");
      s.coins.reserved -= d.remaining;
      s.coins.available += d.remaining;
      d.remaining = 0n;
      for (const [i, q] of d.quests.entries())
        if (!d.winners[i]) {
          s.zones.reserved -= BigInt(q.reward);
          s.zones.available += BigInt(q.reward);
        }
      d.closed = true;
    },
  };
  // The restricted worker key can call exactly these methods.
  const send = async (method, args) => {
    const attempt = { method, args: structuredClone(args), at: clock() };
    s.sent.push(attempt);
    try {
      if (!methods[method])
        throw new ContractPanic(`Method ${method} not allowed`);
      methods[method](args);
      check();
    } catch (error) {
      s.rejected.push({ ...attempt, error: error.panic || error.message });
      throw error;
    }
    return `qa-tx-${s.sent.length}`;
  };
  const claimSends = (receiptId) =>
    s.sent.filter(
      (x) =>
        x.method === "claim" &&
        (receiptId === undefined || x.args.claim.receipt_id === receiptId),
    ).length;
  return { state: s, provider, send, view, check, claimSends };
}
