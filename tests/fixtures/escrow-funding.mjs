// Contract-shaped test data; no network or signing. Keep fields aligned with
// TaskView, SecretView and TransferView in contracts/qgold-escrow/src/lib.rs.
export function escrowFundingView(f, at = f.created_at) {
  const m = JSON.parse(f.msg);
  const fee = (v) => (BigInt(v) + 9n) / 10n;
  if (m.kind === "task") return {
    id: m.id, poster: f.account, reward: m.reward,
    fee: String(fee(m.reward)), slots: m.slots ?? 1,
    reward_per_slot: String(BigInt(m.reward) / BigInt(m.slots ?? 1)),
    assignee: m.assignee ?? null, deadline_ms: m.deadline_ms,
    created_at_ms: String(at), paid_slots: 0, refunded_slots: 0,
    open_slots: m.slots ?? 1, held: String(f.amount_u),
    paid_workers: [], open_disputes: [], rejected_disputes: [], status: "open",
  };
  if (m.kind === "secret") return {
    id: m.id, buyer: f.account, secret_id: m.secret_id, creator: m.creator,
    price: m.price, creator_share: String(BigInt(m.price) - fee(m.price)),
    fee: String(fee(m.price)), funded_at_ms: String(at),
    auto_release_at_ms: String(at + 7 * 86_400_000), status: "held",
  };
  return {
    id: m.id, sender: f.account, to: m.to, amount: String(f.amount_u),
    condition: m.condition, expires_ms: m.expires_ms, created_at_ms: String(at),
    sender_confirmed: false, receiver_confirmed: false, status: "held",
  };
}
