// "How to complete": the same short numbered steps on every community task and
// creator quest, so a player always knows where to go, what to do and where
// to answer. Shared by Community Tasks (NearbyMarket) and Quests (CreatorCommunity).
import type { ReactNode } from "react";
import { tr } from "./i18n";
import "./how-to-steps.css";

export function HowToSteps({ steps, children }: { steps: ReactNode[]; children?: ReactNode }) {
  const shown = steps.filter(Boolean);
  if (!shown.length) return null;
  return (
    <section className="howto" aria-label={tr("How to complete")}>
      <h3>{tr("How to complete")}</h3>
      <ol>
        {shown.map((step, i) => (
          <li key={i}>{step}</li>
        ))}
      </ol>
      {children}
    </section>
  );
}

/** "Make your way to the pinned place. · 120 m away" */
export function placeStep(text: string, away?: string) {
  return (
    <>
      {text}
      {away ? <b className="howto-away"> · {away}</b> : null}
    </>
  );
}
