import { tr } from "./i18n";
// Shared screen tabs for panels (Profile, Market, Community, Inventory).
// WAI-ARIA tabs pattern: role=tablist/tab/tabpanel, roving tabindex,
// Arrow/Home/End move focus and select (automatic activation).
import { useId, useRef, type KeyboardEvent, type ReactNode } from "react";
import { Lock, type Icon } from "@phosphor-icons/react";
import "./screen-tabs.css";

export type ScreenTab<T extends string> = {
  id: T;
  label: string;
  icon: Icon;
  /** Small count badge, e.g. open offers. Hidden when 0 or undefined. */
  count?: number;
  /** Shows a lock icon; the tab stays selectable so it can explain the lock. */
  locked?: boolean;
  /** Accessible description for a locked tab, e.g. "Stakers · Level 5". */
  lockedHint?: string;
};

export function ScreenTabs<T extends string>({
  label,
  tabs,
  value,
  onChange,
  variant = "primary",
  sticky = true,
  idBase,
  withPanel = true,
}: {
  label: string;
  tabs: readonly ScreenTab<T>[];
  value: T;
  onChange: (id: T) => void;
  variant?: "primary" | "sub";
  sticky?: boolean;
  /** Stable prefix shared with the matching ScreenTabPanel. */
  idBase?: string;
  /** False when the selected content is not wrapped in a ScreenTabPanel. */
  withPanel?: boolean;
}) {
  const generated = useId();
  const base = idBase || generated;
  const list = useRef<HTMLDivElement>(null);
  function move(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const last = tabs.length - 1;
    const next =
      event.key === "ArrowRight"
        ? index === last
          ? 0
          : index + 1
        : event.key === "ArrowLeft"
          ? index === 0
            ? last
            : index - 1
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? last
              : -1;
    if (next < 0) return;
    event.preventDefault();
    onChange(tabs[next].id);
    list.current
      ?.querySelectorAll<HTMLButtonElement>('[role="tab"]')
      [next]?.focus();
  }
  return (
    <div
      ref={list}
      role="tablist"
      aria-label={label}
      className={`screen-tabs screen-tabs-${variant}${sticky ? " screen-tabs-sticky" : ""}`}
      style={{ ["--tab-count" as string]: tabs.length }}
    >
      {tabs.map((tab, index) => {
        const selected = tab.id === value;
        const TabIcon = tab.icon;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            id={`${base}-tab-${tab.id}`}
            aria-selected={selected}
            aria-controls={selected && withPanel ? `${base}-panel` : undefined}
            tabIndex={selected ? 0 : -1}
            className={tab.locked ? "is-locked" : undefined}
            aria-label={
              tab.locked
                ? tab.lockedHint
                  ? tr("{0}, locked: {1}", { 0: tab.label, 1: tab.lockedHint })
                  : tr("{0}, locked", { 0: tab.label })
                : undefined
            }
            onClick={() => onChange(tab.id)}
            onKeyDown={(e) => move(e, index)}
          >
            <span className="screen-tab-icon" aria-hidden="true">
              <TabIcon size={variant === "sub" ? 18 : 22} weight={selected ? "fill" : "regular"} />
              {tab.locked && (
                <Lock className="screen-tab-lock" size={12} weight="fill" />
              )}
            </span>
            <span className="screen-tab-label">{tab.label}</span>
            {!!tab.count && (
              <span className="screen-tab-count">
                {tab.count > 99 ? "99+" : tab.count}
                <span className="sr-only"> {tr("new")}</span>
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

export function ScreenTabPanel({
  idBase,
  value,
  children,
}: {
  idBase: string;
  value: string;
  children: ReactNode;
}) {
  return (
    <div
      role="tabpanel"
      id={`${idBase}-panel`}
      aria-labelledby={`${idBase}-tab-${value}`}
      className="screen-tab-panel"
    >
      {children}
    </div>
  );
}

/** One compact disclosure for policy and explanatory prose. */
export function Details({
  summary = tr("Details"),
  children,
}: {
  summary?: string;
  children: ReactNode;
}) {
  return (
    <details className="screen-details">
      <summary>{summary}</summary>
      <div className="screen-details-body">{children}</div>
    </details>
  );
}
