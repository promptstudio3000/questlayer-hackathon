// Screens that only exist after the name step (market, creator feed,
// wardrobe, wallet and signing panels, ...) are split into their own chunks so
// the welcome screen ships without them. Each export keeps the original
// component's props type, so App uses them exactly like the static imports.
// `preloadPanels()` fetches them all in the background once a player exists,
// so opening a tab later does not wait for the network.
import {
  lazy,
  Suspense,
  type ComponentProps,
  type ComponentType,
  type JSX,
} from "react";

type AnyComponent = ComponentType<any>;
const loaders: Array<() => Promise<unknown>> = [];

function lazyNamed<M, K extends keyof M>(load: () => Promise<M>, key: K): M[K] {
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
      <Suspense fallback={null}>
        <Lazy {...props} />
      </Suspense>
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
  "AdventureResultHistoryButton",
);
export const PendingNativeTransactions = lazyNamed(
  () => import("./PendingNativeTransactions"),
  "PendingNativeTransactions",
);
export const CreatorCommunity = lazyNamed(
  () => import("./CreatorCommunity"),
  "CreatorCommunity",
);
export const MapNotes = lazyNamed(() => import("./MapNotes"), "MapNotes");
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
export const NativeWardrobe = lazyNamed(
  () => import("./NativeWardrobe"),
  "NativeWardrobe",
);
export const NativeProfilePanel = lazyNamed(
  () => import("./NativeProfile"),
  "NativeProfilePanel",
);
