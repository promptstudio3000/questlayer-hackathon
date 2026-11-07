// Validate the complete persisted intent against the configured escrow's FINAL
// view. Its immutable records are created only by a successful, exact-amount
// ft_on_transfer from the configured token; IDs cannot be reused (see contract).
export const MARKET_FEE_BPS = 1000;
export const SECRET_RELEASE_MS = 7 * 86_400_000;
const targets = { task: ["task", "offer", "sponsor"], secret: ["reveal"], transfer: ["transfer"] };
const need = (ok) => { if (!ok) throw Error("Invalid escrow funding evidence"); };
const uint = (value, bits = 128) => {
  need(typeof value === "string" && /^(0|[1-9][0-9]{0,38})$/.test(value));
  const n = BigInt(value);
  need(n < (1n << BigInt(bits)));
  return n;
};
const timestamp = (value) => {
  const n = uint(value, 64);
  need(n <= BigInt(Number.MAX_SAFE_INTEGER));
  return Number(n);
};
const feeOf = (n) => (n * BigInt(MARKET_FEE_BPS) + 9999n) / 10000n;
const count = (n, max) => Number.isSafeInteger(n) && n >= 0 && n <= max;
const account = (a) => typeof a === "string" && a.length >= 2 && a.length <= 64 &&
  /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/.test(a);
const accounts = (list, max) => Array.isArray(list) && list.length <= max &&
  list.every(account) && new Set(list).size === list.length;
const keys = (v, names) => v && typeof v === "object" && !Array.isArray(v) &&
  Object.keys(v).sort().join(",") === [...names].sort().join(",");

function conditionMatches(a, b) {
  if (!a || !b || a.type !== b.type) return false;
  if (a.type === "both_confirm") return keys(a, ["type"]) && keys(b, ["type"]);
  if (a.type === "after") return keys(a, ["type", "at_ms"]) && keys(b, ["type", "at_ms"]) &&
    uint(a.at_ms, 64) === uint(b.at_ms, 64);
  if (a.type === "gps") return keys(a, ["type", "place_id", "radius_m"]) && keys(b, ["type", "place_id", "radius_m"]) &&
    typeof a.place_id === "string" && a.place_id.length > 0 && a.place_id === b.place_id &&
    count(a.radius_m, 10000) && a.radius_m > 0 && a.radius_m === b.radius_m;
  return false;
}

/** null means unknown/mismatched: no right or local balance may be activated. */
export function fundingAssessment(f, v) {
  try {
    need(f && v && typeof v === "object" && !Array.isArray(v));
    const m = JSON.parse(f.msg);
    need(targets[m.kind]?.includes(f.target) && m.id === f.id && v.id === f.id);
    need(typeof f.id === "string" && f.id.length > 0 && account(f.account));
    need(f.target === "offer" || f.ref === f.id);
    need(Number.isSafeInteger(f.amount_u) && f.amount_u > 0);
    const amount = BigInt(f.amount_u);
    if (m.kind === "task") {
      const reward = uint(m.reward), slots = m.slots ?? 1, fee = feeOf(reward);
      need(count(slots, 50) && slots > 0 && reward > 0n && reward % BigInt(slots) === 0n);
      need(amount === reward + fee && v.poster === f.account && uint(v.reward) === reward && uint(v.fee) === fee);
      need(v.slots === slots && uint(v.reward_per_slot) === reward / BigInt(slots));
      need(v.assignee === (m.assignee ?? null) && uint(v.deadline_ms, 64) === uint(m.deadline_ms, 64));
      if (m.assignee != null) need(account(m.assignee) && m.assignee !== f.account);
      const fundedAt = timestamp(v.created_at_ms);
      need(fundedAt < timestamp(v.deadline_ms));
      need(count(v.paid_slots, slots) && count(v.refunded_slots, slots) && count(v.open_slots, slots));
      need(v.paid_slots + v.refunded_slots + v.open_slots === slots);
      need(accounts(v.paid_workers, slots) && v.paid_workers.length === v.paid_slots);
      need(accounts(v.open_disputes, v.open_slots) && accounts(v.rejected_disputes, 100));
      const people = [...v.paid_workers, ...v.open_disputes, ...v.rejected_disputes];
      need(new Set(people).size === people.length && !people.includes(f.account));
      if (m.assignee != null) need(slots === 1 && people.every((a) => a === m.assignee));
      const held = uint(v.held);
      if (v.status === "open" && v.open_slots === slots && held === amount && people.length === 0)
        return { kind: "task", status: "open", fundedAt, fee: Number(fee), paidSlots: 0, paidWorkers: [] };
      // A counteroffer is an extra payment attached to another task. Never
      // recreate its local budget from an already consumed or refunded extra.
      if (f.target === "offer") return null;
      if (v.open_slots !== 0 || held !== 0n || v.open_disputes.length !== 0) return null;
      if (v.status === "paid" && v.paid_slots === slots && v.refunded_slots === 0)
        return { kind: "task", status: "paid", fundedAt, fee: Number(fee), paidSlots: slots, paidWorkers: v.paid_workers };
      if (v.status === "refunded" && v.refunded_slots === slots && v.paid_slots === 0)
        return { kind: "task", status: "refunded", fundedAt, fee: 0, paidSlots: 0, paidWorkers: [] };
      // Partly changed tasks need receipt/participant reconciliation. A partial
      // balance must never be presented as all the originally offered slots.
      return null;
    }
    if (m.kind === "secret") {
      const price = uint(m.price), fee = feeOf(price), fundedAt = timestamp(v.funded_at_ms);
      need(typeof m.secret_id === "string" && m.secret_id.length > 0 && account(m.creator) && m.creator !== f.account);
      need(price > 0n && amount === price && v.buyer === f.account && v.creator === m.creator);
      need(v.secret_id === m.secret_id && uint(v.price) === price && uint(v.fee) === fee);
      need(uint(v.creator_share) === price - fee && timestamp(v.auto_release_at_ms) === fundedAt + SECRET_RELEASE_MS);
      need(["held", "disputed", "released", "refunded"].includes(v.status));
      return { kind: "secret", status: v.status, fundedAt, fee: Number(fee), creator: v.creator };
    }
    need(account(m.to) && m.to !== f.account && v.sender === f.account && v.to === m.to && uint(v.amount) === amount);
    need(conditionMatches(m.condition, v.condition) && uint(v.expires_ms, 64) === uint(m.expires_ms, 64));
    const fundedAt = timestamp(v.created_at_ms);
    need(fundedAt < timestamp(v.expires_ms));
    if (m.condition.type === "after") need(uint(m.condition.at_ms, 64) < uint(m.expires_ms, 64));
    need(["held", "released", "refunded"].includes(v.status));
    need(typeof v.sender_confirmed === "boolean" && typeof v.receiver_confirmed === "boolean");
    if (m.condition.type === "both_confirm")
      need((v.sender_confirmed && v.receiver_confirmed) === (v.status === "released"));
    else need(!v.sender_confirmed && !v.receiver_confirmed);
    return { kind: "transfer", status: v.status, fundedAt, to: v.to,
      senderConfirmed: v.sender_confirmed, receiverConfirmed: v.receiver_confirmed };
  } catch {
    return null;
  }
}
