// Shared rows for Community lists (Quests, Tasks, Creators): a pixel icon for
// what the row is, the explorer who made it with their own avatar, the place
// on one line, and the reward on the right (Lubos, 11 Nov 2026).
import type { ReactNode } from "react";
import { MapPin, SealCheck, Star } from "@phosphor-icons/react";
import { ArrowRight } from "./dir-icons";
import { characterMarkerMarkup } from "./character-art";
import { mapKitUrl } from "./map-kit";
import { tr } from "./i18n";
import "./community-lists.css";

/** The reduced public look of an explorer (server/public-look.mjs). */
export type PublicLook = {
  color: string;
  above: string | null;
  below: string | null;
  wearables: { id: number; slot: string; dims: number[] }[];
  level: number;
  demoBot: boolean;
};

/** An explorer's own map character in a round badge. */
export function ExplorerAvatar({
  look,
  size = 40,
  className = "",
}: {
  look?: PublicLook | null;
  size?: number;
  className?: string;
}) {
  return (
    <span
      className={`cl-avatar ${className}`}
      style={{ width: size, height: size, ["--cl-avatar-tint" as string]: look?.color || "#b8a1ed" }}
      aria-hidden="true"
      // Same sanitised markup as the map marker (hex colours, catalogue ids).
      dangerouslySetInnerHTML={{
        __html: characterMarkerMarkup({
          above: look?.above ?? null,
          below: look?.below ?? null,
          wearables: look?.wearables?.length ? look.wearables : undefined,
        }),
      }}
    />
  );
}

/** "demo-bot" tag for test-world explorers. */
export function BotTag({ look }: { look?: PublicLook | null }) {
  return look?.demoBot ? <span className="cl-bot">{"demo-bot"}</span> : null;
}

export type ArtKind = "visit" | "trail" | "chest" | "story" | "task";
const ART: Record<ArtKind, string> = {
  visit: "visit",
  trail: "trail",
  chest: "chest",
  story: "community",
  task: "task",
};

/** One Community row: art, title, who made it, where, and the reward. */
export function CommunityRow({
  art,
  glyph,
  title,
  author,
  look,
  meta,
  where,
  reward,
  rating,
  photo,
  onOpen,
  current,
}: {
  art: ArtKind;
  /** A small Phosphor glyph on the art (task type). */
  glyph?: ReactNode;
  title: string;
  author: string;
  look?: PublicLook | null;
  /** Type and other short facts, after the author. */
  meta?: string;
  /** Distance or place, on its own line with a pin. */
  where?: string | null;
  reward?: ReactNode;
  /** Average stars and how many rated; shown once someone rated. */
  rating?: { average: number | null; count: number } | null;
  /** The creator's header photo, used instead of the type art. */
  photo?: string;
  onOpen: () => void;
  current?: boolean;
}) {
  return (
    <button
      type="button"
      className="cl-row"
      onClick={onOpen}
      aria-current={current ? "true" : undefined}
    >
      <span className="cl-art" aria-hidden="true">
        {photo ? (
          <img className="cl-photo" src={photo} width={48} height={48} alt="" loading="lazy" draggable={false} />
        ) : (
          <img src={mapKitUrl(`quests/${ART[art]}.png`)} width={48} height={48} alt="" draggable={false} />
        )}
        {glyph && <span className="cl-glyph">{glyph}</span>}
      </span>
      <span className="cl-body">
        <strong className="cl-title">{title}</strong>
        <span className="cl-by">
          <ExplorerAvatar look={look} size={22} />
          <span className="cl-author">{author}</span>
          <BotTag look={look} />
        </span>
        {(where || meta || rating?.count) && (
          <span className="cl-where">
            <Stars rating={rating} />
            {where && <MapPin size={14} weight="fill" aria-hidden="true" />}
            <span className="cl-meta">{[where, meta].filter(Boolean).join(" · ")}</span>
          </span>
        )}
      </span>
      {reward && <span className="cl-reward">{reward}</span>}
      <ArrowRight size={18} aria-hidden="true" className="cl-go" />
    </button>
  );
}

/** "★ 4.6 (12)": the average and how many explorers rated. Nothing before the first rating. */
export function Stars({ rating }: { rating?: { average: number | null; count: number } | null }) {
  if (!rating?.count || rating.average === null) return null;
  return (
    <span className="cl-stars" aria-label={tr("{0} of 5 stars from {1} explorers", { 0: rating.average.toFixed(1), 1: rating.count })}>
      <Star size={14} weight="fill" aria-hidden="true" />
      <b aria-hidden="true">{rating.average.toFixed(1)}</b>
      <span aria-hidden="true">({rating.count})</span>
    </span>
  );
}

/** One-row filter chips with an optional trailing action. */
export function FilterChips<T extends string>({
  label,
  options,
  value,
  onChange,
  children,
}: {
  label: string;
  options: readonly { id: T; label: string; count?: number }[];
  value: T;
  onChange: (next: T) => void;
  children?: ReactNode;
}) {
  return (
    <div className="cl-filters">
      <div className="cl-chips" role="group" aria-label={label}>
        {options.map((o) => (
          <button
            key={o.id}
            type="button"
            aria-pressed={value === o.id}
            onClick={() => onChange(o.id)}
          >
            {o.label}
            {o.count ? <span className="cl-count">{o.count}</span> : null}
          </button>
        ))}
      </div>
      {children}
    </div>
  );
}

/** XP chip for a reward that is XP only. */
export function XpReward({ xp }: { xp: number }) {
  return (
    <span className="cl-xp" title={tr("{0} XP", { 0: xp })}>
      <SealCheck size={14} weight="fill" aria-hidden="true" />
      {tr("{0} XP", { 0: xp })}
    </span>
  );
}
