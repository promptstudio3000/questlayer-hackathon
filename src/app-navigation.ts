import {
  parseCreatorCommunityView,
  type CreatorCommunityView,
} from "./creator-community-types.ts";
import {
  parseNativeObjective,
  type NativeObjective,
} from "./native-objective.ts";

export type AppTab =
  | "gotchiverse"
  | "explore"
  | "inventory"
  | "market"
  | "fund"
  | "funding"
  | "wallet"
  | "messages"
  | "bounties"
  | "community"
  | "settings"
  | "expeditions"
  | "fuel"
  | "shop"
  | "places";
export type DemoNavigationTarget = {
  worldId: string;
  zoneId: string;
  questId: string | null;
  realm: "arena" | "gps";
};
export type ProfileView = "character" | "badges" | "settings";
// Every Aura trade is on NEAR: the old database "practice" market is gone and
// a stored "practice" view opens the secured market instead.
export type MarketView = "secured" | "offers";
export const PROFILE_VIEWS: readonly ProfileView[] = ["character", "badges", "settings"];
export const MARKET_VIEWS: readonly MarketView[] = ["secured", "offers"];
export type AppNavigation = {
  tab: AppTab;
  walletView: "rewards" | "staking" | "demo";
  taskRealm: "near" | "demo";
  notesView: "browse" | "compose" | "blocked";
  sheetExpanded: boolean;
  creatorView: CreatorCommunityView;
  /** Profile screen sub-tab shown while `tab` is "settings". */
  profileView: ProfileView;
  /** Market screen sub-tab shown while `tab` is "market". */
  marketView: MarketView;
  demoTarget?: DemoNavigationTarget | null;
  nativeTarget?: NativeObjective | null;
};
export const NAVIGATION_STATE_KEY = "questlayerNavigationV1";
export const initialAppNavigation = (): AppNavigation => ({
  tab: "explore",
  walletView: "rewards",
  taskRealm: "near",
  notesView: "browse",
  sheetExpanded: false,
  creatorView: { page: "community" },
  profileView: "character",
  marketView: "secured",
});
const identifier = (v: unknown): v is string =>
  typeof v === "string" && v.length > 0 && v.length <= 512;
export function parseAppNavigation(
  value: unknown,
  playerId: string,
): AppNavigation | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  const creatorView = parseCreatorCommunityView(v.creatorView);
  if (
    typeof v.tab !== "string" ||
    ![
      "gotchiverse",
      "explore",
      "inventory",
      "market",
      "fund",
      "funding",
      "wallet",
      "messages",
      "bounties",
      "community",
      "settings",
      "expeditions",
      "fuel",
      "shop",
      "places",
    ].includes(v.tab) ||
    typeof v.walletView !== "string" ||
    !["rewards", "staking", "demo"].includes(v.walletView) ||
    typeof v.taskRealm !== "string" ||
    !["near", "demo"].includes(v.taskRealm) ||
    typeof v.notesView !== "string" ||
    !["browse", "compose", "blocked"].includes(v.notesView) ||
    typeof v.sheetExpanded !== "boolean" ||
    !creatorView
  )
    return null;
  // Sub-tabs were added after the first stored entries: a missing value falls
  // back to its default so older history entries still restore.
  if (
    v.profileView !== undefined &&
    !PROFILE_VIEWS.includes(v.profileView as ProfileView)
  )
    return null;
  const marketView = v.marketView === "practice" ? "secured" : v.marketView;
  if (
    marketView !== undefined &&
    !MARKET_VIEWS.includes(marketView as MarketView)
  )
    return null;
  let demoTarget: DemoNavigationTarget | null | undefined =
    v.demoTarget === null ? null : undefined;
  if (v.demoTarget !== null && v.demoTarget !== undefined) {
    const d = v.demoTarget as DemoNavigationTarget;
    if (
      !d ||
      !identifier(d.worldId) ||
      !identifier(d.zoneId) ||
      (d.questId !== null && !identifier(d.questId)) ||
      !["arena", "gps"].includes(d.realm)
    )
      return null;
    demoTarget = {
      worldId: d.worldId,
      zoneId: d.zoneId,
      questId: d.questId,
      realm: d.realm,
    };
  }
  let nativeTarget: NativeObjective | null | undefined =
    v.nativeTarget === null ? null : undefined;
  if (v.nativeTarget !== null && v.nativeTarget !== undefined) {
    const n = v.nativeTarget as NativeObjective;
    if (!n || (n.accountId !== null && !identifier(n.accountId))) return null;
    try {
      nativeTarget = parseNativeObjective(
        JSON.stringify({
          version: n.version,
          network: n.network,
          playerId: n.playerId,
          accountId: n.accountId,
          contractId: n.contractId,
          dayId: n.dayId,
          manifestHash: n.manifestHash,
          kind: n.kind,
          index: n.index,
        }),
        playerId,
        n.accountId,
      );
    } catch {
      return null;
    }
    if (!nativeTarget) return null;
  }
  // No drafts, consent, GPS, balances, quotes or executable actions enter history.
  return {
    tab: v.tab as AppTab,
    walletView: v.walletView as AppNavigation["walletView"],
    taskRealm: v.taskRealm as AppNavigation["taskRealm"],
    notesView: v.notesView as AppNavigation["notesView"],
    sheetExpanded: v.sheetExpanded,
    creatorView,
    profileView: (v.profileView as ProfileView | undefined) ?? "character",
    marketView: (marketView as MarketView | undefined) ?? "secured",
    demoTarget,
    nativeTarget,
  };
}
type Entry = {
  version: 1;
  playerId: string;
  rootId: string;
  depth: number;
  value: AppNavigation;
};
type HistoryAdapter = Pick<
  History,
  "state" | "pushState" | "replaceState" | "back"
>;
function parseEntry(raw: unknown, owner: string): Entry | null {
  if (
    !raw ||
    typeof raw !== "object" ||
    Array.isArray(raw) ||
    !Object.hasOwn(raw, NAVIGATION_STATE_KEY)
  )
    return null;
  const e = (raw as Record<string, unknown>)[NAVIGATION_STATE_KEY] as Entry;
  if (
    !e ||
    typeof e !== "object" ||
    Array.isArray(e) ||
    e.version !== 1 ||
    e.playerId !== owner ||
    !identifier(e.rootId) ||
    !Number.isSafeInteger(e.depth) ||
    e.depth < 0 ||
    e.depth > 1000
  )
    return null;
  const value = parseAppNavigation(e.value, owner);
  return value
    ? { version: 1, playerId: owner, rootId: e.rootId, depth: e.depth, value }
    : null;
}
export function createAppNavigationHistory(
  history: HistoryAdapter,
  owner: string,
  newId = () => crypto.randomUUID(),
) {
  const restored = parseEntry(history.state, owner);
  let entry: Entry = restored || {
    version: 1,
    playerId: owner,
    rootId: newId(),
    depth: 0,
    value: initialAppNavigation(),
  };
  let written = !!restored;
  let signature = restored ? JSON.stringify(restored.value) : "";
  function write(value: AppNavigation, mode: "push" | "replace" = "push") {
    const safe = parseAppNavigation(value, owner);
    if (!safe) throw Error("Invalid navigation state");
    const next = JSON.stringify(safe);
    if (written && signature === next) return true;
    const replace = !written || mode === "replace" || entry.depth >= 1000;
    const candidate: Entry = {
      ...entry,
      depth: replace ? entry.depth : entry.depth + 1,
      value: safe,
    };
    try {
      const raw = history.state;
      const other =
        raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
      history[replace ? "replaceState" : "pushState"](
        { ...other, [NAVIGATION_STATE_KEY]: candidate },
        "",
      );
    } catch {
      // History is optional navigation storage. Keep the previous journal entry
      // and signature so a later successful write can retry without skipping depth.
      return false;
    }
    entry = candidate;
    written = true;
    signature = next;
    return true;
  }
  function restore(raw: unknown) {
    const found = parseEntry(raw, owner);
    entry = found || {
      version: 1,
      playerId: owner,
      rootId: newId(),
      depth: 0,
      value: initialAppNavigation(),
    };
    written = !!found;
    signature = found ? JSON.stringify(found.value) : "";
    return entry.value;
  }
  return { initial: restored?.value || null, write, restore };
}
