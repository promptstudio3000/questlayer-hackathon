import { EmptyState } from "./EmptyState";
import { tr } from "./i18n";
// Screens that only exist after the name step (market, creator feed,
// wardrobe, wallet and signing panels, ...) are split into their own chunks so
// the welcome screen ships without them. Each export keeps the original
// component's props type, so App uses them exactly like the static imports.
// `preloadPanels()` fetches them all in the background once a player exists,
// so opening a tab later does not wait for the network.
import {
  Component,
  lazy,
  Suspense,
  type ComponentProps,
  type ComponentType,
  type JSX,
} from "react";

type AnyComponent = ComponentType<any>;
const loaders: Array<() => Promise<unknown>> = [];

function lazyNamed<M, K extends keyof M>(load: () => Promise<M>, key: K, compact = false): M[K] {
  let pending: Promise<M> | undefined;
  const loadOnce = () =>
    (pending ??= load().catch((error) => {
      pending = undefined;
      throw error;
    }));
  loaders.push(loadOnce);
  const Lazy = lazy(async () => ({
    default: (await loadOnce())[key] as unknown as AnyComponent,
  }));
  function Deferred(props: ComponentProps<AnyComponent>): JSX.Element {
    return (
      <PanelBoundary>
        <Suspense fallback={compact ? <span className="sr-only" role="status">{tr("Loading…")}</span> : <EmptyState title={tr("Loading…")} status className="panel-loading" />}>
          <Lazy {...props} />
        </Suspense>
      </PanelBoundary>
    );
  }
  Deferred.displayName = `Deferred(${String(key)})`;
  return Deferred as unknown as M[K];
}

let preloaded = false;
export function preloadPanels() {
  if (preloaded) return;
  preloaded = true;
  for (const load of loaders) load().catch(() => {});
}

const adventureResults = () => import("./AdventureResults");
export const GameIntro = lazyNamed(() => import("./GameIntro"), "GameIntro", true);
export const QuestBrief = lazyNamed(() => import("./QuestBrief"), "QuestBrief");
export const WearableMoment = lazyNamed(() => import("./WearableMoment"), "WearableMoment");
export const AdventureResultDialog = lazyNamed(
  adventureResults,
  "AdventureResultDialog",
);
export const AdventureResultResume = lazyNamed(
  adventureResults,
  "AdventureResultResume",
);
export const AdventureResultHistoryButton = lazyNamed(
  adventureResults,
  "AdventureResultHistoryButton", true,
);
export const PendingNativeTransactions = lazyNamed(
  () => import("./PendingNativeTransactions"),
  "PendingNativeTransactions",
);
export const CreatorCommunity = lazyNamed(
  () => import("./CreatorCommunity"),
  "CreatorCommunity",
);
export const CommunityBonusVote = lazyNamed(
  () => import("./CommunityBonusVote"),
  "CommunityBonusVote",
);
export const MapNotes = lazyNamed(() => import("./MapNotes"), "MapNotes");
export const PlayerCard = lazyNamed(() => import("./PlayerCard"), "PlayerCard");
export const Inbox = lazyNamed(() => import("./inbox/Inbox"), "Inbox");
export const NativeCollectionControl = lazyNamed(
  () => import("./NativeCollectionControl"),
  "NativeCollectionControl",
);
export const NativeTasks = lazyNamed(
  () => import("./NativeTasks"),
  "NativeTasks",
);
export const Inventory = lazyNamed(() => import("./Inventory"), "Inventory");
export const AccountSessions = lazyNamed(
  () => import("./AccountSessions"),
  "AccountSessions",
);
export const DeviceKeys = lazyNamed(() => import("./DeviceKeys"), "DeviceKeys");
export const BadgeBook = lazyNamed(() => import("./BadgeBook"), "BadgeBook");
export const NativeLevelRewards = lazyNamed(
  () => import("./NativeLevelRewards"),
  "NativeLevelRewards",
);
export const NativeMarketPanel = lazyNamed(
  () => import("./NativeMarketPanel"),
  "NativeMarketPanel",
);
export const NativeExpeditions = lazyNamed(
  () => import("./NativeExpeditions"),
  "NativeExpeditions",
);
export const NativeEconomyPanel = lazyNamed(
  () => import("./NativeEconomyPanel"),
  "NativeEconomyPanel",
);
const rewardFunding = () => import("./RewardFunding");
export const RewardFundingPage = lazyNamed(rewardFunding, "RewardFundingPage");
export const TodaysPot = lazyNamed(rewardFunding, "TodaysPot");
export const SecureAndShare = lazyNamed(
  () => import("./SecureAndShare"),
  "SecureAndShare",
);
export const FuelTheCity = lazyNamed(
  () => import("./FuelTheCity"),
  "FuelTheCity",
);
export const NativeStaking = lazyNamed(
  () => import("./NativeStaking"),
  "NativeStaking",
);
export const AuraClaims = lazyNamed(() => import("./AuraClaims"), "AuraClaims");
export const WispRolls = lazyNamed(() => import("./WispRolls"), "WispRolls");
export const NativeWardrobe = lazyNamed(
  () => import("./NativeWardrobe"),
  "NativeWardrobe",
);
export const NativeProfilePanel = lazyNamed(
  () => import("./NativeProfile"),
  "NativeProfilePanel",
);
export const MonsterChallenge = lazyNamed(
  () => import("./MonsterChallenge"),
  "MonsterChallenge",
);
export const ActorSheet = lazyNamed(
  () => import("./ActorSheet"),
  "ActorSheet",
);
// On-chain proof (docs/CHAIN-PROOF.md): one chunk for the icon, the
// Settings feed and the background SocialDB profile, never with the map.
const chainProof = () => import("./ChainFeed");
export const ChainLink = lazyNamed(chainProof, "ChainLink", true);
export const ChainSettings = lazyNamed(chainProof, "ChainSettings");
export const AutoSocialProfile = lazyNamed(chainProof, "AutoSocialProfile", true);
// Practice wallet, fund and bounty screens (split from App.tsx).
const walletScreens = () => import("./WalletScreens");
export const WalletPanel = lazyNamed(walletScreens, "WalletPanel");
export const FundPanel = lazyNamed(walletScreens, "FundPanel");
export const Bounties = lazyNamed(walletScreens, "Bounties");
// Explorer · Nearby: player tasks, Secrets and conditional sends.
export const NearbyMarket = lazyNamed(() => import("./NearbyMarket"), "NearbyMarket");
export const GoldShop = lazyNamed(() => import("./GoldShop"), "GoldShop");
export const PlaceMessages = lazyNamed(
  () => import("./PlaceMessages"),
  "PlaceMessages",
);
export const EmotePicker = lazyNamed(
  () => import("./EmotePicker"),
  "EmotePicker",
);

export const ZoneActivities = lazyNamed(() => import("./ZoneActivities"), "ZoneActivities");

class PanelBoundary extends Component<{ children: import("react").ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    return this.state.failed ? <EmptyState art="ghost" title={tr("Something went wrong.")} action={{ label: tr("Reload game"), onClick: () => window.location.reload() }} /> : this.props.children;
  }
}

export const DailyBoard = lazyNamed(() => import("./DailyBoard"), "DailyBoard", true);
export const SeasonCard = lazyNamed(() => import("./Season"), "SeasonCard");
export const LandmarkClue = lazyNamed(() => import("./LandmarkClue"), "default");

export const FindDetails = lazyNamed(() => import("./FindDetails"), "FindDetails");

// Gotchiverse-test-app (docs/GOTCHIVERSE.md), shown only when the server enables it.
const LazyGotchiverse = lazy(() => import("./Gotchiverse").then((m) => ({ default: m.Gotchiverse })));
export function Gotchiverse(props: ComponentProps<typeof import("./Gotchiverse").Gotchiverse>) {
  return <PanelBoundary><Suspense fallback={<EmptyState title={tr("Opening Gotchiverse…")} status />}><LazyGotchiverse {...props} /></Suspense></PanelBoundary>;
}
