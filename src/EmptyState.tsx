// Illustrated empty state: authored game art on a small stage, a title, one
// line of guidance and an optional next action. Art is QuestLayer's own
// pixel objects or the verified starter ghost (docs/ASSET-CATALOG.md).
import type { ReactNode } from "react";
import { Ghost } from "./Ghost";
import { GameObjectArt, type GameObjectKind } from "./game-object-art";
import "./empty-state.css";

export type EmptyStateArt = "ghost" | GameObjectKind;

export function EmptyState({
  art = "ghost",
  title,
  children,
  action,
  status = false,
  className = "",
}: {
  art?: EmptyStateArt;
  title: string;
  children?: ReactNode;
  action?: { label: string; onClick: () => void; disabled?: boolean };
  /** Announce politely (for states that appear after a load). */
  status?: boolean;
  className?: string;
}) {
  return (
    <div className={`illustrated-empty ${className}`} role={status ? "status" : undefined}>
      <span className={`illustrated-empty-stage art-${art}`} aria-hidden="true">
        <i className="illustrated-empty-spark s1" />
        <i className="illustrated-empty-spark s2" />
        <i className="illustrated-empty-spark s3" />
        {art === "ghost" ? <Ghost /> : <GameObjectArt kind={art} size={56} />}
      </span>
      <strong className="illustrated-empty-title">{title}</strong>
      {children && <p className="illustrated-empty-text">{children}</p>}
      {action && (
        <button type="button" className="secondary-button" disabled={action.disabled} onClick={action.onClick}>
          {action.label}
        </button>
      )}
    </div>
  );
}
