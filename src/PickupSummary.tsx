import { gold } from "./api";
import type { PickupTotals } from "./pickup-feedback";
import "./pickup-feedback.css";

export function PickupSummary({ totals }: { totals: PickupTotals }) {
  if (!totals.count) return null;
  return (
    <small className="pickup-summary">
      {totals.count} {totals.count === 1 ? "coin" : "coins"} ·{" "}
      {gold(totals.amount, 6)} demo GOLD this session
      {totals.capped && (
        <span>Counter paused; Wallet shows your current balance.</span>
      )}
    </small>
  );
}

export function PickupAnnouncement({ text }: { text: string }) {
  return (
    <span
      className="pickup-announcement"
      role="status"
      aria-live="polite"
      aria-atomic="true"
    >
      {text}
    </span>
  );
}
