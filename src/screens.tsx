// Tab definitions and small building blocks for the tabbed screens
// (Profile, Market, Community, Inventory). Layout only: every action is
// passed in by App so economy and transaction logic stay where they were.
import type { ReactNode } from "react";
import {
  ChatCircle,
  MapPin,
  Sparkle,
  Flag,
  Flame,
  GearSix,
  PencilSimpleLine,
  Scroll,
  Storefront,
  Tag,
  TShirt,
  UserCircle,
  Coins,
  Translate,
  type Icon,
} from "@phosphor-icons/react";
import type { ScreenTab } from "./ScreenTabs";
import { ArrowRight } from "./dir-icons";
import type { CreatorCommunityView } from "./creator-community-types";
import type { ProfileView } from "./app-navigation";
import { lang, LANGS, setLang, tr, type Lang } from "./i18n";

export type ProfileTab = "character" | "stake" | "settings";
// Badges live inside Character; Stake holds staking and earnings behind one
// switch (owner request, 10 Nov 2026).
export const PROFILE_TABS: readonly ScreenTab<ProfileTab>[] = [
  { id: "character", get label() { return tr("Character"); }, icon: UserCircle },
  { id: "stake", get label() { return tr("Stake"); }, icon: Flame },
  { id: "settings", get label() { return tr("Settings"); }, icon: GearSix },
];
/** Profile sub-tab for the current app tab ("fuel" and "wallet" keep their routes). */
export function profileTabOf(tab: string, view: ProfileView): ProfileTab {
  return tab === "fuel" || tab === "wallet" ? "stake" : view === "settings" ? "settings" : "character";
}

/** Inventory: what you own and wear, then everything you can buy. */
export type BagTab = "wardrobe" | "shop";
export const BAG_TABS: readonly ScreenTab<BagTab>[] = [
  { id: "wardrobe", get label() { return tr("Wardrobe"); }, icon: TShirt },
  { id: "shop", get label() { return tr("Shop"); }, icon: Storefront },
];
/** Shop sub-tabs: GOLD items from the game, and Auras other explorers sell. */
export type ShopTab = "items" | "market";
export const SHOP_TABS: readonly ScreenTab<ShopTab>[] = [
  { id: "items", get label() { return tr("Items"); }, icon: Sparkle },
  { id: "market", get label() { return tr("Market"); }, icon: Tag },
];

export type CommunityTab = "quests" | "tasks" | "notes" | "places" | "creators";
export const COMMUNITY_TABS: readonly ScreenTab<CommunityTab>[] = [
  { id: "quests", get label() { return tr("Quests"); }, icon: Scroll },
  { id: "tasks", get label() { return tr("Tasks"); }, icon: Flag },
  { id: "notes", get label() { return tr("Local chat"); }, icon: ChatCircle },
  { id: "places", get label() { return tr("Places"); }, icon: MapPin },
  { id: "creators", get label() { return tr("Creators"); }, icon: PencilSimpleLine },
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
      : tab === "places"
        ? "places"
        : creatorSection(view);
}

export function ProfileHero({
  avatar,
  name,
  level,
  progress,
  detail,
  appearanceLabel,
}: {
  avatar: ReactNode;
  name: string;
  level: number | null;
  /** 0–100, or null while progress is unknown. */
  progress: number | null;
  detail: string;
  appearanceLabel?: string;
}) {
  return (
    <section className="profile-hero" aria-label={tr("Your character")}>
      <div className="profile-hero-avatar">
        {appearanceLabel && <span className="profile-hero-source">{appearanceLabel}</span>}
        {avatar}
      </div>
      <div className="profile-hero-body">
        <div className="profile-hero-heading">
          <h2>{name}</h2>
          <small>{level !== null ? tr("Level {0}", { 0: level }) : tr("Explorer")}</small>
        </div>
        <div
          className="profile-xp"
          role="progressbar"
          aria-label={tr("Progress to the next level")}
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
  primary = false,
}: {
  icon: Icon;
  label: string;
  hint: string;
  onClick: () => void;
  primary?: boolean;
}) {
  return (
    <button type="button" className={primary ? "profile-primary-action" : undefined} onClick={onClick}>
      <TileIcon size={26} weight="duotone" aria-hidden="true" />
      <span>{label}</span>
      <small>{hint}</small>
      <ArrowRight size={20} aria-hidden="true" />
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


/** Language row for Settings: English by default, others on request. */
export function LanguageSetting() {
  return (
    <label className="settings-row language-setting">
      <Translate size={22} aria-hidden="true" />
      <span>
        {tr("Language")}
        <small>{tr("Saved on this device")}</small>
      </span>
      <select
        className="language-select"
        value={lang}
        onChange={(event) => setLang(event.target.value as Lang)}
      >
        {LANGS.map((option) => (
          <option key={option.id} value={option.id} lang={option.id}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}
