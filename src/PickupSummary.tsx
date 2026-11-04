import { gold } from "./api";
import type { PickupTotals } from "./pickup-feedback";
import "./pickup-feedback.css";
import { tr } from "./i18n";

export function PickupSummary({ totals }: { totals: PickupTotals }) {
  if (!totals.count) return null;
  return (
    <small className="pickup-summary">
      {totals.count} {totals.count === 1 ? "coin" : "coins"} ·{" "}
      {gold(totals.amount, 6)} {" "}{tr("practice GOLD this session")}{totals.capped && (
        <span>{tr("Counter paused. See Rewards for your balance.")}</span>
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
