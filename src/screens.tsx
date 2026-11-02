// Tab definitions and small building blocks for the tabbed screens
// (Profile, Market, Community, Inventory). Layout only: every action is
// passed in by App so economy and transaction logic stay where they were.
import type { ReactNode } from "react";
import {
  Backpack,
  ChatCircle,
  Flag,
  Flame,
  GearSix,
  PencilSimpleLine,
  Scroll,
  Signature,
  Storefront,
  Trophy,
  UserCircle,
  ShieldCheck,
  Coins,
  type Icon,
} from "@phosphor-icons/react";
import type { ScreenTab } from "./ScreenTabs";
import type { CreatorCommunityView } from "./creator-community-types";
import type { MarketView, ProfileView } from "./app-navigation";

export type ProfileTab = ProfileView | "stake" | "rewards";
export const PROFILE_TABS: readonly ScreenTab<ProfileTab>[] = [
  { id: "character", label: "Character", icon: UserCircle },
  { id: "stake", label: "Stake", icon: Flame },
  { id: "rewards", label: "Rewards", icon: Trophy },
  { id: "settings", label: "Settings", icon: GearSix },
];
/** Profile sub-tab for the current app tab ("fuel" and "wallet" keep their routes). */
export function profileTabOf(tab: string, view: ProfileView): ProfileTab {
  return tab === "fuel" ? "stake" : tab === "wallet" ? "rewards" : view;
}

export const MARKET_TABS: readonly ScreenTab<MarketView>[] = [
  { id: "practice", label: "Practice", icon: Coins },
  { id: "secured", label: "Secured", icon: ShieldCheck },
  { id: "offers", label: "Offers", icon: Signature },
];

export type BagTab = "items" | "market";
export const BAG_TABS: readonly ScreenTab<BagTab>[] = [
  { id: "items", label: "Items", icon: Backpack },
  { id: "market", label: "Market", icon: Storefront },
];

export type CommunityTab = "quests" | "tasks" | "notes" | "creators";
export const COMMUNITY_TABS: readonly ScreenTab<CommunityTab>[] = [
  { id: "quests", label: "Quests", icon: Scroll },
  { id: "tasks", label: "Tasks", icon: Flag },
  { id: "notes", label: "Notes", icon: ChatCircle },
  { id: "creators", label: "Creators", icon: PencilSimpleLine },
];
const CREATOR_PAGES = new Set([
  "creators",
  "creator",
  "mine",
  "edit",
  "profile",
  "blocked",
]);
/** Which Community tab a creator route belongs to. */
export function creatorSection(
  view: CreatorCommunityView,
): "quests" | "creators" {
  return CREATOR_PAGES.has(view.page) ? "creators" : "quests";
}
export function communityTabOf(
  tab: string,
  view: CreatorCommunityView,
): CommunityTab {
  return tab === "bounties"
    ? "tasks"
    : tab === "messages"
      ? "notes"
      : creatorSection(view);
}

export function ProfileHero({
  avatar,
  name,
  level,
  progress,
  detail,
}: {
  avatar: ReactNode;
  name: string;
  level: number | null;
  /** 0–100, or null while progress is unknown. */
  progress: number | null;
  detail: string;
}) {
  return (
    <section className="profile-hero" aria-label="Your character">
      <div className="profile-hero-avatar">
        {avatar}
        <span className="profile-hero-level" aria-hidden="true">
          {level ?? "—"}
        </span>
      </div>
      <div>
        <h2>{name}</h2>
        <small>{level !== null ? `Level ${level}` : "Explorer"}</small>
        <div
          className="profile-xp"
          role="progressbar"
          aria-label="Progress to the next level"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={progress === null ? undefined : Math.round(progress)}
        >
          <i style={{ width: `${progress ?? 0}%` }} />
        </div>
        <small>{detail}</small>
      </div>
    </section>
  );
}

export function ProfileTile({
  icon: TileIcon,
  label,
  hint,
  onClick,
}: {
  icon: Icon;
  label: string;
  hint: string;
  onClick: () => void;
}) {
  return (
    <button type="button" onClick={onClick}>
      <TileIcon size={26} weight="duotone" aria-hidden="true" />
      <span>{label}</span>
      <small>{hint}</small>
    </button>
  );
}

/** Compact on/off row for the Settings card. */
export function SettingsSwitch({
  icon: RowIcon,
  label,
  hint,
  checked,
  onChange,
}: {
  icon: Icon;
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      className="settings-row"
      onClick={() => onChange(!checked)}
    >
      <RowIcon size={22} aria-hidden="true" />
      <span>
        {label}
        {hint && <small>{hint}</small>}
      </span>
      <span className="settings-switch" aria-hidden="true" />
    </button>
  );
}

