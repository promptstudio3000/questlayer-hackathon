import { useRef, type ReactNode } from "react";
import { Check, Question } from "@phosphor-icons/react";
import { helpText } from "./activity-help";
import type { HelpTopic } from "./learning-store";
import { tr } from "./i18n";
import "./game-learning.css";

/** Inline disclosure reuses its containing sheet; it never pauses or starts play. */
export function ActivityHelp({ topic, onAcknowledge, children }: { topic: HelpTopic; onAcknowledge?: () => void; children?: ReactNode }) {
  const details = useRef<HTMLDetailsElement>(null);
  return <details ref={details} className="activity-help">
    <summary><Question size={20} aria-hidden="true" />{tr("How this works")}</summary>
    <p>{helpText(topic)}</p>
    {children}
    <button className="text-button" onClick={() => { onAcknowledge?.(); if (details.current) { details.current.open = false; details.current.querySelector("summary")?.focus(); } }}>
      <Check size={18} aria-hidden="true" />{tr("Got it")}
    </button>
  </details>;
}
