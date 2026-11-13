import { currentZone, zoneInteriorMargin } from "./zone-presence";
import { ZonePresence } from "./ZonePresence";
import { MapSurface } from "./MapSurface";
import { ActorPortrait } from "./ActorPortrait";
import { nearbyAction, type NearbyActor } from "./nearby-action";
import type { Coin } from "./types";
import { WorldSwitcher, type GameLayerConfig } from "./WorldSwitcher";
import type { TourTarget } from "./TourHelper";
import type { SettingsMap } from "./SettingsScreen";
import { questDisplayTitle } from "./quest-copy";
import { mapObjective, canOfferNearbyAction } from "./map-objective";
import { EmptyState } from "./EmptyState";
import { useLevelTable } from "./XpBar";
import { levelProgress } from "./levels";
import {
  ZoneActivities,
  Layer,
  DailyBoard,
  SeasonCard,
  QuestBrief,
  GameIntro,
  WearableMoment,
  FindDetails,
  AdventureResultDialog,
  AdventureResultResume,
  AdventureResultHistoryButton,
  SettingsReceipts,
  GasWatch,
  ChainSettings,
  WalletPanel,
  AutoSocialProfile,
  ChainLink,
  CreatorCommunity,
  TreasuryVoteDialog,
  MapNotes,
  PlayerCard,
  Inbox,
  NativeCollectionControl,
  Inventory,
  AccountSessions,
  DeviceKeys,
  NativeLevelRewards,
  NativeMarketPanel,
  MarketBoard,
  NativeExpeditions,
  GameEconomy,
  RewardFundingPage,
  TodaysPot,
  PotRow,
  MapSettings,
  SettingsScreen,
  MapActions,
  InfoTip,
  SecureAndShare,
  FuelTheCity,
  NativeStaking,
  AuraClaims,
  WispRolls,
  NativeWardrobe,
  NativeProfilePanel,
  preloadPanels,
  ActorSheet,
  BadgeBook,
  NearbyList,
  NearbyMarket,
  GoldShop,
  LocalChat,
  PlaceCompose,
  TourHelper,
  CommunityPlaces,
  AddPlaceDialog,
  EmotePicker,
  CharacterJourney,
  LockedZoneCard,
  LockedZoneDialog,
} from "./lazy-panels";
import { goldBalance, goldMap as readGoldMap, goldShop, type GoldMap, type WalletBalance } from "./gold-spend-client";
import type { NotePin } from "./gold-map-layer";
import type { RollCall } from "./WispRolls";
import type { InventoryTab } from "./Inventory";
// Styles of the split-off screens stay in the main stylesheet, in their old
// order, so nothing shifts while a screen's script is still loading.
import "./adventure-results.css";
import "./pending-native-transactions.css";
import "./creator-community.css";
import "./community-bonus-vote.css";
import { useAdventureResults } from "./useAdventureResults";
import {
  adventureItemForEquip,
  type AdventureResult,
} from "./adventure-results";
import {
  assertCreatorQuote,
  type CreatorPaymentQuote,
  type CreatorPaymentRequest,
} from "./creator-money-quote";
import { useAppNavigation } from "./useAppNavigation";
import { createReadEpoch } from "./read-epoch";
import { usePickupFeedback } from "./usePickupFeedback";
import { demoPickupScope } from "./pickup-feedback";
import { canContinueDemoCollection } from "./demo-collection";
import { PickupAnnouncement } from "./PickupSummary";
import { distanceLabel, units, CoinIcon, Badge } from "./app-bits";
import { mapKitUrl } from "./map-kit";
import type { QuestMapTarget } from "./creator-community-types";
import {
  GameObjectArt,
  questObjectPresentation,
  zoneObjectPresentation,
} from "./game-object-art";
import { makeNativeObjective } from "./native-objective";
import { useAdventureSelection } from "./useAdventureSelection";
import { activityProgress, activityRequirement, questsInZone } from "./activity-view";
import { useNativeObjective, useNativePlayAccount } from "./useNativeObjective";
import { walletSigner, type NativeSigner } from "./native-signer";
import type { MarketFunding } from "./NearbyMarket";
import type { NearbyFilter } from "./nearby-list";
import { setQgoldBurner, type QgoldBurnCall } from "./qgold-burn";
import { useInvisibleAccount } from "./useInvisibleAccount";
import { explorerAccountMessage } from "./explorer-account";
import "./map-notes.css";
import { useNativeGame } from "./useNativeGame";
import { useNativeAutoCollect } from "./useNativeAutoCollect";
import "./native-collection.css";
import "./native-tasks.css";
import {
  assertTaskQuote,
  type TaskRequest,
  type TaskQuote,
} from "./native-task-quote";
import { nativeWorldView } from "./native-game-map";
import type { NearbyExplorer } from "./types";
import type { PublicLayer } from "./layer/Layer";
import type { ActorView } from "./actor-types";
import type { ActorFocusMatch } from "./GameMap";
import type { NpcMapTask } from "./npc-client";
import "./inventory.css";
import { indexedDbKeyStore } from "./player-key";
import type { NativeMilestone, Progress } from "./NativeLevelRewards";
import {
  assertNativeLevelClaim,
  type NativeLevelClaim,
} from "./native-level-claim";
import type { MarketCall } from "./SignedOrdersPanel";
import type { ReviewedNativeTransaction } from "./confirmed-native-transaction";
import {
  deviceOrderSigner,
  walletOrderSigner,
  type MessageWallet,
  type OrderSigner,
} from "./order-signers";
import "./play-ui.css";
import "./reward-funding.css";
import "./secure-share.css";
import "./offline-gate.css";
import "./fuel-the-city.css";
import "./native-staking.css";
import {
  assertVaultQuote,
  type VaultQuote,
  type VaultRequest,
} from "./native-vault-quote";
import "./styles.css";
import "./theme-accents.css";
import "./compact-ui.css";
import "./mobile-sheets.css";
import "./arcade-ui.css";
import { activeQuestRoute, questTarget } from "./quest-route";
import { HudXpRing } from "./HudXpRing";
import { RewardBursts } from "./RewardBursts";
import { pushBurst, type RewardBurst } from "./reward-burst";
import type { ChainRef } from "./chain-proof";
import type { NativeTradeRequest } from "./types";
import type { NativeAuraClaim, NativeMarketState } from "./types";
import { nativeAppearanceItems } from "./native-appearance";
import { publishNoteRecord, type NoteRecordKind } from "./note-record";
import type { NativeProfileQuote } from "./types";
import { assertProfileQuote } from "./native-profile-quote";
import type { NativeWardrobeState, NativeItem } from "./types";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import {
  Compass,
  Backpack,
  Storefront,
  Wallet,
  MapPin,
  ChatsCircle,
  NavigationArrow,
  GlobeHemisphereWest,
  Crosshair,
  Plus,
  Minus,
  X,
  ArrowUpRight,
  Sparkle,
  Coins,
  LockKey,
  Clock,
  Check,
  Leaf,
  ChatCircle,
  Smiley,
  NotePencil,
  ClipboardText,
  MapPinPlus,
  PaperPlane,
  ShieldCheck,
  Key,
  Eye,
  Flag,
  TrendUp,
  Lightning,
  SealCheck,
  Question,
  GearSix,
  UsersThree,
  Footprints,
  UserCircle,
  Path,
  ArrowUUpLeft,
  ArrowClockwise,
  WifiSlash,
  Flame,
  MagnifyingGlass,
  ArrowsOut,
  ArrowsIn,
  SlidersHorizontal,
  Code,
} from "@phosphor-icons/react";
import { ArrowRight, ArrowLeft } from "./dir-icons";
import { ArrowRight as PhArrowRight } from "@phosphor-icons/react";
import { Details, ScreenTabPanel, ScreenTabs } from "./ScreenTabs";
import {
  BAG_TABS,
  COMMUNITY_TABS,
  SHOP_TABS,
  PROFILE_TABS,
  ProfileHero,
  ProfileTile,
  communityTabOf,
  creatorSection,
  profileTabOf,
  type CommunityTab,
  type ProfileTab,
} from "./screens";
// Passkey helpers load on first use, outside the welcome screen's first load.
const webauthn = () => import("@simplewebauthn/browser");
import { api, ApiError, GOLD, gold, near, meters, remaining } from "./api";
import { goldFromYocto } from "./gold-units.ts";
import { Dialog } from "./Dialog";
import { Character } from "./Character";
import { DeferredGameMap as GameMap, gameMapLoaded, preloadGameMap } from "./DeferredGameMap";
import { useCreatorPlaces } from "./useCreatorPlaces";
import { Ghost, AuraArt, BrandLogo } from "./Ghost";
import { Welcome } from "./Welcome";
import type {
  Player,
  World,
  Point,
  Fix,
  Zone,
  Item,
  Listing,
  Dashboard,
  Bounty,
  Quest,
} from "./types";
import {
  EXPLORER_BASE,
  NEAR_NETWORK,
  NETWORK_LABEL,
  SOCIAL_CONTRACT_ID,
  onNearNetwork,
} from "./near-network.ts";
import { nearestDiscovery, poiQuestOutlook } from "./nearest-discovery.ts";
import { FirstSessionCoach, useFirstSession } from "./FirstSession";
import { useLearning } from "./useLearning";
import { beginLearning, type HelpTopic } from "./learning-store";
import { helpText, questHelpTopic } from "./activity-help";
import type { FirstStepId } from "./first-session";
import {
  cue,
  loadFeedbackPreferences,
  prefersReducedMotion,
  subscribeFeedback,
  type FeedbackPreferences,
} from "./feedback";
import { QuestThumbnail } from "./QuestThumbnail";
import { headingTo, metersBetween } from "./map-motion.ts";
import { locationPermission, rememberMode, shouldStartWithGps } from "./play-here";
import { advanceGpsFacing, initialGpsFacing } from "./gps-facing";
import { useDemoWalk } from "./useDemoWalk";
import { DemoControls } from "./DemoControls";
import type { MapAction } from "./MapActions";
import { useHudCard } from "./useHudCard";
import { registerChainTrades } from "./chain-trades-registry";
import { tr } from "./i18n";

type Tab =
  | "layer"
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
const HOME = { lat: 49.74745, lng: 13.3774 };
const SHARE_POSITION_KEY = "questlayer.sharePosition";
function readSharePosition() {
  try {
    return localStorage.getItem(SHARE_POSITION_KEY) !== "0";
  } catch {
    return true;
  }
}
/** A searched spot stands for its H3 res-7 cell (≈1.2 km edge) on the server. */
const SEARCH_SPACING_M = 650;
const nav = [
  { id: "explore", get label() { return tr("Explore"); }, icon: Compass },
  { id: "inventory", get label() { return tr("Inventory"); }, icon: Backpack },
  { id: "community", get label() { return tr("Community"); }, icon: UsersThree },
  { id: "settings", get label() { return tr("Profile"); }, icon: UserCircle },
] as const;
function navigationActive(tab: Tab, id: string) {
  return (
    tab === id ||
    (id === "community" && ["messages", "bounties", "places"].includes(tab)) ||
    (id === "explore" && ["expeditions", "funding"].includes(tab)) ||
    (id === "inventory" && (tab === "market" || tab === "shop")) ||
    (id === "settings" && ["wallet", "fund", "fuel"].includes(tab))
  );
}
const rarityNames: Record<string, string> = {
  get common() { return tr("Common"); },
  get rare() { return tr("Rare"); },
  get epic() { return tr("Epic"); },
  get legendary() { return tr("Legendary"); },
};
/** Markers that only open a dialog (no play on the map itself) stay off. */
const MAP_DIALOG_PINS = false;

export default function App() {
  const [map3D, setMap3D] = useState(() => {
    try {
      const saved = localStorage.getItem("questlayer.mapAppearance");
      return saved
        ? saved === "3d"
        : !(navigator as Navigator & { connection?: { saveData?: boolean } })
            .connection?.saveData;
    } catch {
      return true;
    }
  });
  const toggleMap3D = () => {
    const next = !map3D;
    setMap3D(next);
    try {
      localStorage.setItem("questlayer.mapAppearance", next ? "3d" : "2d");
    } catch {
      /* A private browsing session can still change the current view. */
    }
  };
  const worldOwner = useRef<string | undefined>(undefined);
  // The balance the top bar shows: QGOLD on the NEAR account (what every
  // price check uses), not the game's own counter. Refreshed when the game
  // counter moves and after every spend.
  const [wallet, setWallet] = useState<WalletBalance | null>(null),
    [walletTick, setWalletTick] = useState(0);
  const [player, setPlayer] = useState<Player | null>(null),
    [clueChoice, setClueChoice] = useState<Record<string, string>>({}),
    [loaded, setLoaded] = useState(false),
    [meUnreachable, setMeUnreachable] = useState(false),
    [worldData, setWorld] = useState<World | null>(null),
    [position, setPosition] = useState<Point>(HOME),
    [fix, setFix] = useState<Fix | null>(null),
    // Explorer sheet (Nearby): which kind of map content the list shows.
    // A #task= / #secret= share link opens the Community filter directly.
    [nearbyFilter, setNearbyFilter] = useState<NearbyFilter>(() =>
      /^#(task|secret)=/.test(location.hash) ? "community" : "all",
    ),
    // Visual course from a moving GPS fix, or reliable successive positions.
    [gpsCourse, setGpsCourse] = useState<number | null>(null),
    [arena, setArenaState] = useState(true),
    [globe, setGlobe] = useState(false),
    [overview, setOverview] = useState(false),
    [follow, setFollow] = useState(true),
    [busy, setBusy] = useState(""),
    [toast, setToast] = useState<{ text: string; error: boolean } | null>(null),
    [online, setOnline] = useState(navigator.onLine),
    // Being seen by nearby explorers is on unless the explorer switched it
    // off in Settings (Lubos 11 Nov: three players on one VPS never saw each
    // other because sharing was a hidden 15-minute opt-in).
    [sharePosition, setSharePosition] = useState(readSharePosition),
    [pageVisible, setPageVisible] = useState(
      () => document.visibilityState === "visible",
    ),
    [others, setOthers] = useState<NearbyExplorer[]>([]),
    [cardPlayer, setCardPlayer] = useState<string | null>(null),
    [showNpc, setShowNpc] = useState(false),
    [actorOpen, setActorOpen] = useState<ActorView | null>(null),
    // GOLD spending (QGOLD stream 4): own emote and frame, lures and place pins.
    [myEmote, setMyEmote] = useState<{ id: string; until: number } | null>(null),
    [myFrame, setMyFrame] = useState<string | null>(null),
    [goldMapData, setGoldMapData] = useState<GoldMap | null>(null),
    [mapNotes, setMapNotes] = useState<NotePin[]>([]),
    [noteOpenId, setNoteOpenId] = useState<string | null>(null),
    [placeOpenId, setPlaceOpenId] = useState<string | null>(null),
    [quickCreate, setQuickCreate] = useState<"note" | "topic" | "shout" | "place" | null>(null),
    [emotePicker, setEmotePicker] = useState(false),
    // The camera turns with the explorer unless switched off in Map settings.
    [mapRotate, setMapRotate] = useState(() => {
      try {
        return localStorage.getItem("questlayer.mapRotate") !== "0";
      } catch {
        return true;
      }
    }),
    // A create form the Actions button asked the Nearby list to open.
    [marketForm, setMarketForm] = useState<"" | "task" | "secret">(""),
    // "Full map" hides the header, menu and sheet so the map takes the whole screen.
    [mapFull, setMapFull] = useState(() => {
      try {
        return localStorage.getItem("questlayer.mapFull") === "1";
      } catch {
        return false;
      }
    }),
    [now, setNow] = useState(Date.now()),
    // Server switch LAYER_ENABLED: adds the virtual voxel Layer to the logo world picker.
    [virtualLayer, setVirtualLayer] = useState<PublicLayer | null>(null),
    // Test Layer or QuestLayer World (docs/TEST-LAYER.md).
    [gameLayer, setGameLayer] = useState<GameLayerConfig | null>(null),
    [pipHidden, setPipHidden] = useState(false),
    [tourRunning, setTourRunning] = useState(false);
  useEffect(() => {
    void api<{ layer?: { layers?: PublicLayer[] } | null; gameLayer?: GameLayerConfig | null }>("/config")
      .then((c) => {
        setVirtualLayer(c.layer?.layers?.[0] ?? null);
        setGameLayer(c.gameLayer ?? null);
        // Until launch World opens the Test Layer; "?world=1" (from its picker) keeps World for good.
        const g = c.gameLayer, key = "questlayer.stayWorld";
        try {
          if (/[?&]world=1/.test(location.search)) { localStorage.setItem(key, "1"); history.replaceState(null, "", location.pathname + location.hash); }
          else if (g?.defaultTest && g.testLayerUrl && !localStorage.getItem(key)) location.replace(g.testLayerUrl);
        } catch {}
        if (c.gameLayer?.test) document.documentElement.dataset.testLayer = "1";
      })
      .catch(() => {});
  }, []);
  // Read guards follow the requested mode before React commits its next render.
  const arenaIntent = useRef(arena);
  function setArena(value: boolean) {
    arenaIntent.current = value;
    setArenaState(value);
  }
  const [nearActors, setNearActors] = useState<{worldId:string | null; actors:NearbyActor[]; at:number}>({worldId:null, actors:[], at:0});
  // Open NPC lines in today's world: NPCs waiting for a report carry a sign on the map.
  const [npcTasks, setNpcTasks] = useState<{ worldId: string; tasks: NpcMapTask[] } | null>(null);
  // "Show me" on the map for a character (daily board goals, report back).
  const [actorFocus, setActorFocus] = useState<{ revision: number; match: ActorFocusMatch } | null>(null);

  // A wearable pickup is a Wardrobe item: "see it" opens Inventory there.
  const [inventoryStart, setInventoryStart] = useState<InventoryTab>("all");
  const [wearableMoment, setWearableMoment] = useState<{scope: string; id: number; name: string; detail: string; chain?: ChainRef | null} | null>(null);
  const [startedQuestKey, setStartedQuestKey] = useState("");
  const [catalogView, setCatalogView] = useState<{ scope: string; zoneId: string | null; questId: string | null } | null>(null);
  const [rewardNote, setRewardNote] = useState("");
  const [rewardIntent, setRewardIntent] = useState<"reward" | "share">("reward");
  const gpsFacing = useRef(initialGpsFacing());
  const gpsResumeOnMovement = useRef(false);
  const [findInspect, setFindInspect] = useState<{worldId:string; coin:Coin} | null>(null);
  const [dismissedObjective, setDismissedObjective] = useState("");
  const [feedback, setFeedback] = useState<FeedbackPreferences>(() =>
    loadFeedbackPreferences(),
  );
  useEffect(() => subscribeFeedback(setFeedback), []);
  // Once there is a player, fetch the map and the split-off screens in the
  // background so later taps do not wait for the network.
  const hasPlayer = !!player;
  // The current HUD layout ships with the map chunk. The menu and the top bar
  // render only once it is in, so a reload never flashes the old base layout.
  // A failed load shows them anyway, so Inventory and Profile stay reachable.
  const [hudReady, setHudReady] = useState(gameMapLoaded);
  useEffect(() => {
    if (!hasPlayer) return;
    const ready = () => setHudReady(true);
    void preloadGameMap().then(ready, ready);
    const idle =
      window.requestIdleCallback ??
      ((f: () => void) => window.setTimeout(f, 200));
    idle(() => preloadPanels());
  }, [hasPlayer]);
  const firstSession = useFirstSession(player);
  const learning = useLearning(player?.id);
  useEffect(() => {
    if (!player?.id) return setWallet(null);
    let live = true;
    // Keep the last value on a failed read; the next change tries again.
    goldBalance().then((w) => live && setWallet(w), () => undefined);
    return () => {
      live = false;
    };
  }, [player?.id, player?.gold_u, walletTick]);
  const [manualIntro, setManualIntro] = useState<string | null>(null);
  const introOpen = !!player && (manualIntro === player.id || (learning.state.intro === "new" && !location.hash));
  const learnedSteps = firstSession.progress.steps.map(s => s.done ? s.step.id : "").join(":");
  useEffect(() => {
    for (const { step, done } of firstSession.progress.steps) {
      if (done && ["find", "coin", "chest", "aura"].includes(step.id)) learning.acknowledge(step.id as HelpTopic);
    }
  }, [player?.id, learnedSteps]);
  const world =
    worldOwner.current === player?.id && worldData?.arena === arena
      ? worldData
      : null;
  const navigation = useAppNavigation(player?.id);
  useHudCard(!!player);
  const [creatorCapability, setCreatorCapability] = useState<{
    playerId: string;
    enabled: boolean;
  } | null>(null);
  const creatorsEnabled =
    creatorCapability?.playerId === player?.id &&
    creatorCapability?.enabled === true;
  const creatorPlaces = useCreatorPlaces(player?.id ?? null);
  const {
    tab,
    walletView,
    sheetExpanded,
    taskRealm,
    notesView,
    creatorView,
    profileView,
    marketView,
  } = navigation;
  const navigationContext = useRef({ signature: "", revision: 0 });
  const navigationSignature = JSON.stringify([
    tab,
    walletView,
    sheetExpanded,
    taskRealm,
    notesView,
    creatorView,
    profileView,
    marketView,
  ]);
  if (navigationContext.current.signature !== navigationSignature)
    navigationContext.current = {
      signature: navigationSignature,
      revision: navigationContext.current.revision + 1,
    };
  const setTab = navigation.setter("tab"),
    setWalletView = navigation.setter("walletView"),
    setSheetExpanded = navigation.setter("sheetExpanded"),
    setTaskRealm = navigation.setter("taskRealm"),
    setNotesView = navigation.setter("notesView"),
    setCreatorView = navigation.setter("creatorView");
  useEffect(() => {
    if (tab !== "inventory") setInventoryStart("all");
  }, [tab]);
  // Player card: messages need this device's explorer account key
  // (docs/PLAYER-INBOX.md). Says why it is missing and where to fix it.
  function openAccountDevices() {
    setCardPlayer(null);
    chooseProfileTab("settings");
    openSettingsPart("#settings-account-title");
  }
  /** Scrolls Settings to one of its parts, unfolding Advanced when it is inside. */
  function openSettingsPart(selector: string, tries = 10) {
    setTimeout(() => {
      // The Settings chunk may still be loading on the first open.
      const part = mainPanel.current?.querySelector<HTMLElement>(`.settings-screen ${selector}`);
      if (!part) return void (tries > 0 && openSettingsPart(selector, tries - 1));
      for (let el: HTMLElement | null = part; el; el = el.parentElement)
        if (el instanceof HTMLDetailsElement) el.open = true;
      part.scrollIntoView({ block: "start", behavior: "auto" });
      (part.querySelector<HTMLElement>("summary") ?? part).focus({ preventScroll: true });
    }, 300);
  }
  function messageOffReason(): { text: string; action?: { label: string; run: () => void } } {
    const status = invisible.status;
    if (status === "needs-recovery")
      return {
        text: invisible.canStartOver
          ? tr("This device is not linked to your explorer account yet, so it cannot send or read messages. Add it with your recovery passkey or start with a new account here.")
          : tr("This device is not linked to your explorer account yet, so it cannot send or read messages. Add it with your recovery passkey."),
        action: { label: tr("Link this device"), run: openAccountDevices },
      };
    if (status === "play-first")
      return { text: tr("Messages open with your explorer account, which you get with your first find or quest.") };
    if (status === "error" || status === "unavailable")
      return {
        text: tr("Your explorer account is not available on this device, so messages are off here."),
        action: { label: tr("Account"), run: openAccountDevices },
      };
    return { text: tr("Your explorer account is being set up. Messages open in a moment.") };
  }
  function openWardrobe() {
    setInventoryStart("wearables");
    setTab("inventory");
  }
  const profileTab = profileTabOf(tab, profileView);
  // Settings is its own sheet behind the gear, not a Profile tab (13 Nov 2026).
  const settingsOpen = tab === "settings" && profileView === "settings";
  const showProfileTabs = (tab === "settings" && !settingsOpen) || tab === "fuel" || tab === "wallet";
  useEffect(() => {
    if (!settingsOpen || !gameLayer?.tour) return;
    void api<{ hidden?: boolean }>("/tour").then((t) => setPipHidden(!!t.hidden)).catch(() => {});
  }, [settingsOpen, gameLayer?.tour]);
  // Earnings merged into Stake (owner request, 12 Nov 2026); old links land there.
  useEffect(() => {
    if (tab === "wallet") setTab("fuel");
  }, [tab]);
  function chooseProfileTab(next: ProfileTab) {
    if (next === "stake") setTab("fuel");
    else navigation.update({ tab: "settings", profileView: next });
  }
  const communityTab = communityTabOf(tab, creatorView);
  const showCommunityTabs =
    tab === "community" ||
    tab === "bounties" ||
    tab === "messages" ||
    tab === "places";
  function chooseCommunityTab(next: CommunityTab) {
    if (next === "tasks") setTab("bounties");
    else if (next === "notes") setTab("messages");
    else if (next === "places") setTab("places");
    else
      navigation.update({
        tab: "community",
        creatorView:
          creatorSection(creatorView) === next
            ? creatorView
            : { page: next === "creators" ? "creators" : "community" },
      });
  }
  useEffect(() => {
    if (tab === "layer") setOthers([]);
  }, [tab]);
  useEffect(() => {
    const seen = () => setPageVisible(document.visibilityState === "visible");
    document.addEventListener("visibilitychange", seen);
    return () => document.removeEventListener("visibilitychange", seen);
  }, []);
  // Shared while the explorer plays on the map with the page in front; a
  // hidden tab, the Layer screen or the Settings switch stops it.
  const presence = !!player && sharePosition && pageVisible && tab !== "layer";
  function changeSharePosition(next: boolean) {
    setSharePosition(next);
    try {
      localStorage.setItem(SHARE_POSITION_KEY, next ? "1" : "0");
    } catch {
      /* private mode: the choice lasts until the page closes */
    }
  }
  // Locked staker chips (src/LockedChip.tsx) open the stake screen.
  useEffect(() => {
    const open = () => setTab("fuel");
    window.addEventListener("questlayer:open-stake", open);
    return () => window.removeEventListener("questlayer:open-stake", open);
  }, [setTab]);
  const [nativeWardrobe, setNativeWardrobe] =
      useState<NativeWardrobeState | null>(null),
    [nativeError, setNativeError] = useState("");
  const nativeRequest = useRef(0);
  async function refreshNative(fresh = false) {
    const generation = ++nativeRequest.current;
    try {
      const data = await api<NativeWardrobeState>(
        "/native/wardrobe" + (fresh ? "?refresh=1" : ""),
      );
      if (generation === nativeRequest.current) {
        setNativeWardrobe(data);
        setNativeError("");
      }
      return data;
    } catch (error) {
      if (generation === nativeRequest.current) {
        setNativeWardrobe(null);
        setNativeError(
          error instanceof Error
            ? error.message
            : tr("Your secured collection could not load. Try again in a moment."),
        );
      }
      throw error;
    }
  }
  const nativeWalletIds =
    player?.wallets.map((w) => w.account_id).join("|") || "";
  useEffect(() => {
    if (!player?.id || !nativeWalletIds) {
      nativeRequest.current++;
      setNativeWardrobe(null);
      setNativeError("");
      return;
    }
    void refreshNative().catch(() => {});
    const timer = setInterval(
      () => void refreshNative().catch(() => {}),
      20000,
    );
    return () => {
      clearInterval(timer);
      nativeRequest.current++;
    };
  }, [player?.id, nativeWalletIds]);
  const nearConnector = useRef<
    import("@hot-labs/near-connect").NearConnector | null
  >(null);
  const [walletChoices, setWalletChoices] = useState<
    { id: string; name: string; icon: string; website: string }[] | null
  >(null);
  const [walletChoiceKind, setWalletChoiceKind] = useState<"near" | "evm">("near");
  const walletChoice = useRef<{
    resolve: (id: string) => void;
    reject: (error: Error) => void;
  } | null>(null);
  function chooseWallet(walletId: string | null) {
    const pending = walletChoice.current;
    walletChoice.current = null;
    setWalletChoices(null);
    if (walletId) pending?.resolve(walletId);
    else
      pending?.reject(
        Object.assign(
          new Error(tr("Account link cancelled. You can keep exploring.")),
          {
            code: "WALLET_CANCELLED",
          },
        ),
      );
  }
  // Map coins pay QGOLD, so they are the default ledger. The NEAR test-network
  // days only run when the player picked them in Settings or opened Expeditions;
  // a saved "near" that the player never chose (older builds switched on sign-in)
  // is dropped, because it hid the demo joystick and the map's objective.
  const [nativePlay, setNativePlay] = useState(() => {
    try {
      return (
        localStorage.getItem("questlayer-play-mode") === "near" &&
        localStorage.getItem("questlayer-play-mode-chosen") === "1"
      );
    } catch {
      return false;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(
        "questlayer-play-mode",
        nativePlay ? "near" : "demo",
      );
    } catch {}
  }, [nativePlay]);
  const adventureResults = useAdventureResults({
    playerId: player?.id,
    realm: arena ? "arena" : "gps",
    enabled: !nativePlay,
    online,
  });
  const discovery = adventureResults.selection;
  const nativeAccount = useNativePlayAccount(player);
  const playAccount = nativeAccount.account;
  const invisible = useInvisibleAccount(player?.id);
  const recordAccount =
    invisible.status === "ready" && invisible.accountId
      ? { accountId: invisible.accountId, managed: true }
      : player?.wallets[0]?.account_id
        ? { accountId: player.wallets[0].account_id, managed: false }
        : null;
  const invisibleEnsure = invisible.ensure,
    invisibleStatus = invisible.status,
    playFirstXp = useRef<number | null>(null);
  useEffect(() => {
    // Prepare the invisible account in the background; play never waits for it.
    // A new explorer earns it with the first find or quest, so try again when XP
    // arrives while the account is still not prepared.
    if (!player?.id) return;
    const xp = player.xp ?? 0;
    if (invisibleStatus === "idle") {
      playFirstXp.current = xp;
      void invisibleEnsure();
    } else if (invisibleStatus === "play-first" && playFirstXp.current !== xp) {
      playFirstXp.current = xp;
      void invisibleEnsure();
    }
  }, [player?.id, player?.xp, invisibleStatus, invisibleEnsure]);
  useEffect(() => {
    // The managed account appears in the player's linked accounts once ready.
    // Play stays on map coins (QGOLD); the test-network ledger is opt-in.
    if (invisibleStatus !== "ready") return;
    void me();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [invisibleStatus]);
  const setPlayAccount = nativeAccount.select;
  const demoObjective = useAdventureSelection(
    player?.id,
    world,
    arena,
    nativePlay,
    now,
  );
  const {
    selected: demoSelection,
    selectedQuestId,
    select: selectAdventure,
    notice: adventureNotice,
    dismissNotice: dismissAdventureNotice,
  } = demoObjective;
  function setSelected(zone: Zone | null, questId: string | null = null) {
    selectAdventure(zone, questId);
    navigation.update({
      demoTarget:
        zone && world
          ? {
              worldId: world.id,
              zoneId: zone.id,
              questId,
              realm: arena ? "arena" : "gps",
            }
          : null,
    });
  }
  const [nativeVisitBusy, setNativeVisitBusy] = useState(false);
  const mainPanel = useRef<HTMLElement>(null);
  const contentScreen = tab !== "explore" || sheetExpanded;
  useEffect(() => {
    if (!contentScreen || !player) return;
    const previous = document.activeElement as HTMLElement | null;
    const frame = requestAnimationFrame(() => mainPanel.current?.querySelector<HTMLElement>("h1")?.focus({ preventScroll: true }));
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented || document.querySelector("dialog[open]")) return;
      event.preventDefault();
      setTab("explore");
      setSheetExpanded(false);
    };
    window.addEventListener("keydown", escape);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("keydown", escape);
      requestAnimationFrame(() => previous?.isConnected && previous.focus({ preventScroll: true }));
    };
  }, [contentScreen, player?.id]);

  useEffect(() => {
    if (mainPanel.current) mainPanel.current.scrollTop = 0;
  }, [tab, player?.id]);
  const nativeGame = useNativeGame(
    !!player &&
      nativeAccount.ready &&
      (nativePlay ||
        tab === "expeditions" ||
        tab === "wallet"),
    player?.id,
    playAccount,
    position,
  );
  const nativeObjectiveBase = useNativeObjective(
    player?.id,
    playAccount,
    nativeAccount.ready,
    nativeGame.state,
    nativeGame.error,
    now,
  );
  const nativeObjective = {
    ...nativeObjectiveBase,
    select: (kind: "quest" | "coin", index: number) => {
      if (!player) return;
      const reference = makeNativeObjective(
        player.id,
        playAccount || null,
        nativeGame.state,
        kind,
        index,
        now,
      );
      if (!reference) return;
      nativeObjectiveBase.restore(reference);
      navigation.update({ nativeTarget: reference });
    },
    clear: () => {
      nativeObjectiveBase.clear();
      navigation.update({ nativeTarget: null });
    },
  };
  const capturedNavigation = useRef("");
  useEffect(() => {
    if (!navigation.ready || !demoObjective.ready || !nativeObjectiveBase.ready)
      return;
    const identity = `${player?.id}:${playAccount}:${arena}`;
    if (capturedNavigation.current === identity || navigation.restored) return;
    capturedNavigation.current = identity;
    const reference = demoObjective.reference;
    navigation.update(
      {
        demoTarget: reference
          ? {
              worldId: reference.worldId,
              zoneId: reference.zoneId,
              questId: reference.questId,
              realm: reference.realm,
            }
          : null,
        nativeTarget: nativeObjectiveBase.reference,
      },
      "replace",
    );
  }, [
    navigation.ready,
    demoObjective.ready,
    nativeObjectiveBase.ready,
    player?.id,
    playAccount,
    arena,
  ]);
  const restoreNavigation = useRef({ token: "", demo: false, native: false });
  useEffect(() => {
    if (!navigation.ready || !navigation.restored) return;
    const token = `${player?.id}:${navigation.restoreRevision}`;
    if (restoreNavigation.current.token !== token) {
      restoreNavigation.current = { token, demo: false, native: false };
    }
    const pending = restoreNavigation.current;
    if (!pending.native && nativeObjectiveBase.ready) {
      const reference = navigation.nativeTarget;
      if (reference === null) nativeObjectiveBase.clear();
      else if (reference && reference.accountId === (playAccount || null))
        nativeObjectiveBase.restore(reference);
      pending.native = true;
    }
    if (
      !pending.demo &&
      demoObjective.ready &&
      world &&
      world.arena === arena
    ) {
      const reference = navigation.demoTarget;
      if (reference === null) selectAdventure(null);
      else if (reference && reference.realm === (arena ? "arena" : "gps")) {
        const zone =
          world.id === reference.worldId
            ? world.zones.find(
                (z) => z.id === reference.zoneId && z.closesAt > now,
              )
            : null;
        const questValid =
          reference.questId === null ||
          world.quests.some(
            (q) =>
              q.id === reference.questId &&
              q.zone_id === zone?.id &&
              q.closes_at > now,
          );
        if (zone && questValid) selectAdventure(zone, reference.questId);
        else {
          selectAdventure(null);
          navigation.update({ demoTarget: null }, "replace");
        }
      }
      pending.demo = true;
    }
  }, [
    navigation.ready,
    navigation.restoreRevision,
    demoObjective.ready,
    nativeObjectiveBase.ready,
    world,
    arena,
    player?.id,
    playAccount,
  ]);
  const nativeTarget = nativePlay ? nativeObjective.view.target : null;
  const selected = nativePlay ? null : demoSelection;
  const nativeCollection = useNativeAutoCollect({
    playerId: player?.id,
    accountId: playAccount,
    linked: !!player?.wallets.some((w) => w.account_id === playAccount),
    nativeMode: nativePlay,
    active:
      tab === "explore" &&
      !busy &&
      !nativeVisitBusy &&
      !walletChoices &&
      !discovery &&
      !showNpc &&
      !introOpen,
    arena,
    fix,
    state: nativeGame.state,
    refresh: nativeGame.refresh,
  });
  useEffect(() => {
    if (tab === "expeditions") setNativePlay(true);
  }, [tab]);
  const displayWorld = useMemo(
    () => (nativePlay ? nativeWorldView(nativeGame.state, HOME) : world),
    [nativePlay, nativeGame.state, world],
  );
  const hudXp = nativePlay
    ? (nativeGame.state?.balance?.xp ?? null)
    : (player?.availableXp ?? player?.xp ?? null);
  const hudLevel =
    hudXp === null ? null : 1 + Math.floor(Math.sqrt(Number(hudXp) / 100));
  const levelTable = useLevelTable();
  const hudProgress =
    hudXp === null ? null : levelProgress(Number(hudXp), levelTable);
  // Floating reward feedback over the map (src/RewardBursts.tsx).
  const [bursts, setBursts] = useState<RewardBurst[]>([]);
  const burst = (b: Omit<RewardBurst, "id" | "until">) =>
    setBursts((list) => pushBurst(list, b, Date.now()));
  useEffect(() => {
    if (!bursts.length) return;
    const t = setTimeout(
      () => setBursts((list) => list.filter((b) => b.until > Date.now())),
      Math.max(50, Math.min(...bursts.map((b) => b.until)) - Date.now()),
    );
    return () => clearTimeout(t);
  }, [bursts]);
  // Level ups get their own burst; the first read of a player never does.
  const shownLevel = useRef<{ player?: string; level?: number }>({});
  useEffect(() => {
    const level = hudProgress?.level;
    if (!player || level === undefined || nativePlay) return;
    const seen = shownLevel.current;
    if (seen.player === player.id && seen.level !== undefined && level > seen.level)
      burst({ tone: "level", title: tr("Level {0}!", { 0: level }), detail: tr("Keep exploring") });
    shownLevel.current = { player: player.id, level };
  }, [hudProgress?.level, player?.id, nativePlay]);
  const nextWorldRefresh = useRef(0),
    collecting = useRef(new Set<string>()),
    collectionRun = useRef<AbortController | null>(null),
    gps = useRef<number | null>(null),
    latest = useRef({ world, position, fix, arena, player, nativePlay, introOpen, tab });
  latest.current = { world, position, fix, arena, player, nativePlay, introOpen, tab };
  const pickupFeedback = usePickupFeedback(
    nativePlay ? "" : demoPickupScope(player?.id, world?.id, arena),
    tab !== "explore" ||
      !!toast ||
      !!discovery ||
      !!busy ||
      !online ||
      nativePlay,
  );
  const playerReads = useRef(createReadEpoch());
  const worldReads = useRef(createReadEpoch());
  const worldLoading = useRef(false);
  function demoCollectionContext(state = latest.current) {
    return {
      playerId: state.player?.id,
      worldId: state.world?.id,
      arena: arenaIntent.current,
      worldArena: state.world?.arena,
      endsAt: state.world?.endsAt,
      nativePlay: state.nativePlay,
      loading: worldLoading.current,
      visible: !document.hidden && !state.introOpen && state.tab !== "layer",
      online: navigator.onLine,
    };
  }
  const actionVersion = useRef(0);
  const gpsVersion = useRef(0);
  const ownerContext = () => latest.current.player?.id || "signed-out";
  const worldContext = (kind: "replace" | "refresh") =>
    JSON.stringify([
      ownerContext(),
      arenaIntent.current,
      kind,
      ...(kind === "refresh" ? [latest.current.world?.id] : []),
    ]);
  // NPC lines for the map. Returns the tasks so a claim can tell the player
  // whom to report to; failures keep the last known signs.
  const guide = () => import("./goal-guide");
  async function loadNpcTasks(worldId = latest.current.world?.id) {
    if (!worldId) return null;
    try {
      const r = await (await guide()).npcMapTasks(worldId);
      if (latest.current.world?.id === worldId) setNpcTasks({ worldId, tasks: r.tasks });
      return r.tasks;
    } catch {
      return null;
    }
  }
  // Reload the signs for a new world and whenever an NPC meeting ends.
  useEffect(() => {
    if (!world?.id || !player || nativePlay) return;
    if (!actorOpen) void loadNpcTasks(world.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [world?.id, player?.id, nativePlay, actorOpen]);
  // Today's board "Show me": the nearest thing each goal needs.
  async function showGoal(goal: string) {
    setTab("explore");
    const t = (await guide()).goalTarget(goal, { world, position, tier: latest.current.player?.tier || 1, now: Date.now(), point: questPoint });
    if (t.kind === "actor") showActor({ kinds: t.archetypes });
    else if (t.kind === "quest") guideToQuest(t.quest);
    else if (t.kind === "coin") goToStreetFind(t.coin);
    else notify(t.text, true);
  }
  // `missing`: with nobody like that out nearby, open Game economy (the tour's keeper outside reviewed cities).
  const actorMissing = useRef(false);
  function showActor(match: ActorFocusMatch, missing = false) {
    actorMissing.current = missing;
    setOverview(false);
    setSheetExpanded(false);
    setActorFocus({ revision: Date.now(), match });
  }
  function notify(text: string, error = false) {
    setToast({ text, error });
  }
  // Place badges (docs/BADGES.md): with real GPS on, check the fix against
  // the notable places every 30 s or after ~40 m of movement. Cosmetic only.
  const badgeCheck = useRef<{ at: number; lat: number; lng: number } | null>(
    null,
  );
  useEffect(() => {
    if (!player || arena || !fix) return;
    const last = badgeCheck.current;
    const moved = last
      ? Math.hypot(
          (fix.lat - last.lat) * 111_000,
          (fix.lng - last.lng) * 111_000 * Math.cos((fix.lat * Math.PI) / 180),
        )
      : Infinity;
    if (last && Date.now() - last.at < 30_000 && moved < 40) return;
    if (last && Date.now() - last.at < 8_000) return;
    badgeCheck.current = { at: Date.now(), lat: fix.lat, lng: fix.lng };
    api<{ earned: { name: string; nameCs: string; icon: string }[] }>(
      "/badges/check",
      { fix },
    )
      .then((r) => {
        if (!r.earned?.length) return;
        notify(
          tr("Badge earned: {0}", { 0: r.earned.map((b) => `${b.icon} ${b.nameCs || b.name}`).join(", ") }),
        );
        window.dispatchEvent(new Event("questlayer:badges"));
      })
      .catch(() => {
        /* Badges are optional; a weak fix just tries again later. */
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fix, arena, player?.id]);
  function updateOwnedPlayer(next: Player) {
    if (latest.current.player?.id !== next.id) return;
    playerReads.current.invalidate();
    setPlayer((current) => (current?.id === next.id ? next : current));
  }
  // Auras from chests, levels and Wisp rolls are secured on NEAR on their own:
  // the explorer account signs silently and the relayer pays. An Aura the
  // player is wearing waits until it is taken off, so their look never changes
  // under them. One at a time, with a back-off per Aura so a full edition or a
  // spent daily relay budget never loops. localStorage
  // questlayer-auto-secure=0 turns it off on this device.
  const autoSecure = useRef({
    running: false,
    retryAt: new Map<string, number>(),
    levelsAt: 0,
  });
  const [autoSecureTick, setAutoSecureTick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setAutoSecureTick((t) => t + 1), 60_000);
    return () => clearInterval(timer);
  }, []);
  const autoSecureSigner = invisible.signer;
  const autoSecureClaims = !!nativeWardrobe?.claimsEnabled;
  useEffect(() => {
    let off = false;
    try {
      off = localStorage.getItem("questlayer-auto-secure") === "0";
    } catch {}
    const managed = autoSecureSigner;
    const state = autoSecure.current;
    if (off || state.running || !player || !managed) return;
    if (!player.wallets.some((w) => w.account_id === managed.accountId)) return;
    const now = Date.now();
    const item = autoSecureClaims
      ? player.inventory.find(
          (i) =>
            i.kind === "aura" &&
            !i.equipped &&
            i.native_claim_state !== "minted" &&
            (!i.native_claim_state ||
              i.native_claim_receiver === managed.accountId) &&
            (state.retryAt.get(i.id) ?? 0) <= now,
        )
      : undefined;
    const levels = state.levelsAt <= now;
    if (!item && !levels) return;
    state.running = true;
    void (async () => {
      let secured = 0;
      try {
        if (item) {
          try {
            if (await secureAuraOnChain(item, managed, managed.accountId)) {
              secured++;
              state.retryAt.delete(item.id);
            } else state.retryAt.set(item.id, Date.now() + 2 * 60_000);
          } catch {
            state.retryAt.set(item.id, Date.now() + 15 * 60_000);
          }
        } else {
          state.levelsAt = Date.now() + 10 * 60_000;
          try {
            const progress = await api<Progress>("/native/progression", {
              accountId: managed.accountId,
            });
            for (const m of progress.milestones || []) {
              if (!m.claimable && m.state !== "issued") continue;
              if ((await secureLevelOnChain(m, managed, managed.accountId)) === "minted")
                secured++;
            }
          } catch {
            // Level rewards need the native rewards ledger; try again later.
          }
        }
        if (secured) {
          await refreshNative(true).catch(() => {});
          notify(tr("Your Aura is secured."));
        }
      } finally {
        state.running = false;
        await me().catch(() => {});
        setAutoSecureTick((t) => t + 1);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [player, autoSecureSigner, autoSecureClaims, autoSecureTick]);
  async function action<T>(
    name: string,
    fn: () => Promise<T>,
  ): Promise<T | undefined> {
    const focusBeforeAction = document.activeElement as HTMLElement | null;
    const owner = ownerContext();
    const version = ++actionVersion.current;
    setBusy(name);
    try {
      return await fn();
    } catch (e) {
      if (ownerContext() !== owner || version !== actionVersion.current)
        return undefined;
      if (
        e &&
        typeof e === "object" &&
        "code" in e &&
        (e.code === "WALLET_CANCELLED" || e.code === "CANCELLED")
      )
        return undefined;
      cue("error");
      notify(
        e instanceof Error ? e.message : tr("Something went wrong. Try again."),
        true,
      );
    } finally {
      if (ownerContext() === owner && version === actionVersion.current) {
        setBusy("");
        requestAnimationFrame(() => {
          if (
            document.activeElement === document.body &&
            !document.querySelector("dialog[open]") &&
            focusBeforeAction?.isConnected
          )
            focusBeforeAction.focus();
        });
      }
    }
  }
  // GOLD spending: lures and place pins near the player, refreshed every 30 s.
  const goldSpot = `${Math.round(position.lat * 500)}:${Math.round(position.lng * 500)}`;
  async function refreshGoldMap() {
    if (!player) return;
    try {
      setGoldMapData(await readGoldMap(position.lat, position.lng));
    } catch {
      /* The map keeps the last pins; the next tick retries. */
    }
  }
  async function readGoldLook() {
    if (!player) return;
    try {
      setMyFrame((await goldShop()).look?.frame ?? null);
    } catch {
      /* No frame shown until the shop answers. */
    }
  }
  const clearPlaceOpen = useCallback(() => setPlaceOpenId(null), []);
  const clearNoteOpen = useCallback(() => setNoteOpenId(null), []);
  // Free map notes near the player, drawn on the map (same area as Local chat · Notes).
  const noteRead = useRef(0);
  async function refreshMapNotes() {
    if (!player) return;
    const version = ++noteRead.current;
    try {
      const { messages } = await api<{ messages: NotePin[] }>(
        `/messages?lat=${position.lat.toFixed(2)}&lng=${position.lng.toFixed(2)}&arena=${arena ? 1 : 0}`,
      );
      if (version === noteRead.current)
        setMapNotes(messages.map(({ id, text, lat, lng, own }) => ({ id, text, lat, lng, own })));
    } catch {
      /* The map keeps the last notes; the next tick retries. */
    }
  }
  // A #task= / #secret= share link at load opens Nearby, where its dialog lives.
  useEffect(() => {
    if (!player?.id || nativePlay) return;
    if (!/^#(task|secret)=/.test(location.hash)) return;
    setTab("explore");
    setSheetExpanded(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [player?.id, nativePlay]);
  useEffect(() => {
    if (!player?.id) return;
    void refreshGoldMap();
    const timer = setInterval(() => void refreshGoldMap(), 30_000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [player?.id, goldSpot]);
  useEffect(() => {
    if (!player?.id) {
      setMapNotes([]);
      return;
    }
    void refreshMapNotes();
    const timer = setInterval(() => void refreshMapNotes(), 30_000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [player?.id, goldSpot, arena]);
  useEffect(() => {
    if (player?.id) void readGoldLook();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [player?.id]);
  async function publishPlace(targetId: string): Promise<boolean> {
    const account = recordAccount?.accountId;
    const result = await action("place-record", async () => {
      if (!account || !player) throw Error("Your explorer account is not ready yet.");
      const { signer, accountId } = await signerForAccount(account);
      const { publishPlaceRecord } = await import("./place-record");
      const confirmed = await publishPlaceRecord({ call: api, signer, accountId, playerId: player.id, targetId });
      notify(confirmed ? tr("Your message is now a public record on NEAR Social.") : tr("Record sent. Refresh in a moment to see it confirmed."));
      return confirmed;
    });
    return result === true;
  }
  async function me() {
    const token = playerReads.current.begin(ownerContext());
    try {
      const r = await api<{ player: Player }>("/me");
      if (playerReads.current.isCurrent(token, ownerContext())) {
        setPlayer(r.player);
        setMeUnreachable(false);
      }
    } catch (e) {
      if (!playerReads.current.isCurrent(token, ownerContext())) return;
      if (e instanceof ApiError && e.status === 401) {
        setPlayer(null);
        setMeUnreachable(false);
      } else if (!(e instanceof ApiError) || e.status >= 500)
        // No answer at all (offline, server restarting): don't show the
        // first-run page to someone who already has an explorer.
        setMeUnreachable(true);
    } finally {
      if (playerReads.current.isCurrent(token, ownerContext())) setLoaded(true);
    }
  }
  // Spots of this city world already searched for quests (H3 cells, server).
  const searchedSpots = useRef<{ worldId: string; points: Point[] }>({
    worldId: "",
    points: [],
  });
  async function loadWorld(
    location: Point,
    asArena: boolean,
    explore?: Point,
  ) {
    if (asArena !== arenaIntent.current) return;
    collectionRun.current?.abort();
    collectionRun.current = null;
    const token = worldReads.current.begin(
      JSON.stringify([ownerContext(), asArena, "replace"]),
    );
    worldLoading.current = true;
    setBusy("world");
    try {
      const w = await api<World>("/world", {
        location,
        arena: asArena,
        near: explore ? latest.current.position : location,
        ...(explore ? { explore } : {}),
      });
      if (
        worldReads.current.isCurrent(token, worldContext("replace")) &&
        w.arena === asArena
      ) {
        worldOwner.current = latest.current.player?.id;
        const spots = searchedSpots.current;
        if (spots.worldId !== w.id) {
          spots.worldId = w.id;
          spots.points = [];
        }
        spots.points.push(explore || location);
        if (explore) {
          const before = latest.current.world;
          const added =
            before?.id === w.id
              ? w.zones.filter((z) => !before.zones.some((b) => b.id === z.id))
                  .length
              : 0;
          notify(
            added
              ? tr("{0} new quest places found here.", { 0: added })
              : tr("No new quests in this spot right now."),
          );
        }
        setWorld(w);
      }
    } catch (e) {
      if (worldReads.current.isCurrent(token, worldContext("replace")))
        notify(
          e instanceof Error
            ? e.message
            : tr("This area could not load. Try again in a moment."),
          true,
        );
    } finally {
      if (worldReads.current.isCurrent(token, worldContext("replace"))) {
        worldLoading.current = false;
        setBusy((value) => (value === "world" ? "" : value));
      }
    }
  }
  async function refreshWorld() {
    const state = latest.current;
    if (
      !state.player ||
      !state.world ||
      state.world.arena !== state.arena ||
      state.arena !== arenaIntent.current ||
      worldLoading.current
    )
      return;
    const token = worldReads.current.begin(worldContext("refresh"));
    try {
      // Only the coins around the player (docs/PERFORMANCE-BUDGET.md).
      const nearAt = `${state.position.lat.toFixed(5)},${state.position.lng.toFixed(5)}`;
      const w = await api<World>(
        `/world?id=${encodeURIComponent(state.world.id)}&near=${nearAt}`,
      );
      if (
        worldReads.current.isCurrent(token, worldContext("refresh")) &&
        w.id === state.world.id &&
        w.arena === state.arena
      )
        setWorld(w);
    } catch {
      // Keep the current world while a later refresh can recover connectivity.
    }
  }
  useEffect(() => {
    playerReads.current.invalidate();
    worldReads.current.invalidate();
    worldOwner.current = undefined;
    worldLoading.current = false;
    actionVersion.current++;
    gpsVersion.current++;
    if (gps.current !== null) navigator.geolocation.clearWatch(gps.current);
    gps.current = null;
    collecting.current.clear();
    collectionRun.current?.abort();
    collectionRun.current = null;
    nextWorldRefresh.current = 0;
    setWorld(null);
    setFix(null);
    gpsFacing.current = initialGpsFacing();
    setGpsCourse(null);
    gpsResumeOnMovement.current = false;
    setPosition(HOME);
    setArena(true);
    setOthers([]);
    setBusy("");
    setToast(null);
    if (player) {
      void loadWorld(HOME, true);
      void resumeLocation();
    }
  }, [player?.id]);
  // The game starts in the world around the player (src/play-here.ts): the
  // demo stays only when location is refused or the player chose it.
  async function resumeLocation() {
    const owner = ownerContext();
    const permission = await locationPermission();
    if (ownerContext() !== owner || !arenaIntent.current) return;
    if (shouldStartWithGps(permission)) void locate(true);
  }
  useEffect(() => {
    void me();
    const a = () => {
      setOnline(navigator.onLine);
      if (navigator.onLine && !latest.current.player) void me();
    };
    window.addEventListener("online", a);
    window.addEventListener("offline", a);
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      playerReads.current.invalidate();
      worldReads.current.invalidate();
      gpsVersion.current++;
      collectionRun.current?.abort();
      if (gps.current !== null) navigator.geolocation.clearWatch(gps.current);
      clearInterval(tick);
      window.removeEventListener("online", a);
      window.removeEventListener("offline", a);
    };
  }, []);
  useEffect(() => {
    if (
      player &&
      world &&
      world.endsAt <= now &&
      busy !== "world" &&
      now >= nextWorldRefresh.current
    ) {
      nextWorldRefresh.current = now + 60000;
      void loadWorld(position, arena);
    }
  }, [now]);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4200);
    return () => clearTimeout(t);
  }, [toast]);
  useEffect(() => {
    if (!player) return;
    const owner = player.id;
    const s = new EventSource("/api/events");
    s.addEventListener("coin", (e) => {
      if (latest.current.player?.id !== owner) return;
      const d = JSON.parse((e as MessageEvent).data);
      // The same street coin can sit in several worlds: drop it by spot too.
      const spot = (c: { lat: number; lng: number }) =>
        typeof d.lat === "number" && c.lat === d.lat && c.lng === d.lng;
      setWorld((w) =>
        w
          ? { ...w, coins: w.coins.filter((c) => c.id !== d.id && !spot(c)) }
          : w,
      );
    });
    // Every explorer's discovery is broadcast: coalesce bursts into one map
    // refresh so a busy city does not multiply world reads per client.
    let questRefresh: ReturnType<typeof setTimeout> | null = null;
    s.addEventListener("quest", () => {
      if (latest.current.player?.id !== owner || questRefresh) return;
      questRefresh = setTimeout(() => {
        questRefresh = null;
        if (latest.current.player?.id === owner) void refreshWorld();
      }, 2500);
    });
    s.addEventListener("market", () => void me());
    const sync = setInterval(() => {
      if (latest.current.player?.id !== owner) return;
      void me();
      void refreshWorld();
    }, 15_000);
    return () => {
      s.close();
      clearInterval(sync);
      if (questRefresh) clearTimeout(questRefresh);
    };
  }, [player?.id]);
  // City worlds add POI quests per area searched (server H3 cells). Walking
  // far from every searched spot searches the new one; a moved map offers a
  // "Search this area" button for the spot in the middle of the screen.
  const [mapCenter, setMapCenter] = useState<Point | null>(null);
  const exploreAt = useRef(0);
  const searchedNear = (p: Point, within: number) =>
    searchedSpots.current.worldId === world?.id &&
    searchedSpots.current.points.some((s) => meters(s, p) < within);
  useEffect(() => {
    if (!player || !world?.cityId || nativePlay || busy === "world") return;
    if (searchedNear(position, SEARCH_SPACING_M)) return;
    if (Date.now() - exploreAt.current < 20_000) return;
    exploreAt.current = Date.now();
    void loadWorld(arena ? HOME : position, arena, position);
  }, [player?.id, world?.id, position, nativePlay]);
  const searchHere =
    !!player &&
    !!world?.cityId &&
    !nativePlay &&
    !globe &&
    tab === "explore" &&
    !!mapCenter &&
    busy !== "world" &&
    !searchedNear(mapCenter, SEARCH_SPACING_M)
      ? mapCenter
      : null;
  // The world carries only nearby coins: fetch the next ring once the player
  // has walked (or jumped) a third of the way to its edge.
  const nearRefreshAt = useRef(0);
  useEffect(() => {
    const ring = world?.coinsNear;
    if (!player || !ring) return;
    if (meters(position, ring) < ring.radiusM / 3) return;
    if (Date.now() - nearRefreshAt.current < 3000) return;
    nearRefreshAt.current = Date.now();
    void refreshWorld();
  }, [player?.id, world?.coinsNear, position]);
  useEffect(() => {
    if (!player) return;
    const t = setInterval(() => {
      void api("/aavegotchi")
        .then(() => me())
        .catch(() => {});
    }, 300000);
    return () => clearInterval(t);
  }, [player?.id]);
  useEffect(() => {
    if (!player) return;
    const collect = setInterval(async () => {
      const state = latest.current;
      if (!state.world || !state.player || collectionRun.current) return;
      const expected = demoCollectionContext(state);
      if (!canContinueDemoCollection(expected, expected, Date.now())) return;
      const request = new AbortController();
      collectionRun.current = request;
      const timeout = setTimeout(() => request.abort(), 15000);
      try {
        const radius = (state.world.coinRadius ?? 18) - 1;
        const nearby = state.world.coins
          .filter(
            (c) =>
              meters(state.position, c) < radius &&
              !collecting.current.has(c.id),
          )
          .slice(0, 2);
        for (const coin of nearby) {
          if (
            request.signal.aborted ||
            !canContinueDemoCollection(
              expected,
              demoCollectionContext(),
              Date.now(),
            )
          )
            break;
          collecting.current.add(coin.id);
          try {
            const result = await api<{
              player: Player;
              value: number;
              xp?: number;
              find?: boolean;
              wearable?: { id: number; name: string; duplicate: boolean };
              alreadyClaimed?: boolean;
              chain?: ChainRef | null;
            }>(
              "/coins/claim",
              {
                coinId: coin.id,
                fix: state.arena
                  ? { ...state.position, accuracy: 0, timestamp: Date.now() }
                  : state.fix,
              },
              { signal: request.signal },
            );
            if (
              request.signal.aborted ||
              latest.current.player?.id !== state.player.id
            )
              return;
            updateOwnedPlayer(result.player);
            setWorld((w) =>
              w ? { ...w, coins: w.coins.filter((c) => c.id !== coin.id) } : w,
            );
            if (!result.alreadyClaimed && !latest.current.nativePlay) {
              cue("coin");
              const paid = `+${result.xp ?? 0} XP · +${gold(result.value, 2)} QGOLD`;
              if (result.wearable && !result.wearable.duplicate) {
                const scope = demoPickupScope(state.player.id, state.world.id, state.arena);
                const found = { scope, id: result.wearable.id, name: result.wearable.name, detail: paid, chain: result.chain };
                setWearableMoment((pending) => pending?.scope === scope ? pending : found);
              }
              if (!result.wearable || result.wearable.duplicate) burst(
                result.wearable
                  ? {
                      tone: "find",
                      title: result.wearable.duplicate
                        ? tr("{0} again", { 0: result.wearable.name })
                        : tr("Wearable found: {0}", { 0: result.wearable.name }),
                      detail: `${tr("Clone in your Wardrobe")} · ${paid}`,
                      chain: result.chain,
                    }
                  : result.find
                  ? { tone: "find", title: tr("Street find!"), detail: paid, chain: result.chain }
                  : { tone: "coin", title: paid, chain: result.chain },
              );
              pickupFeedback.confirm(
                demoPickupScope(state.player.id, state.world.id, state.arena),
                {
                  coinId: coin.id,
                  value: result.value,
                  xp: result.xp ?? NaN,
                  alreadyClaimed: result.alreadyClaimed,
                },
              );
            }
          } catch (e) {
            if (e instanceof ApiError && e.code === "ALREADY_CLAIMED")
              setWorld((w) =>
                w
                  ? { ...w, coins: w.coins.filter((c) => c.id !== coin.id) }
                  : w,
              );
            else collecting.current.delete(coin.id);
          }
        }
      } finally {
        clearTimeout(timeout);
        if (collectionRun.current === request) collectionRun.current = null;
      }
    }, 600);
    return () => clearInterval(collect);
  }, [player?.id]);
  useEffect(() => {
    setOthers([]);
  }, [arena]);
  useEffect(() => {
    if (!player) return;
    let active = true;
    let requestVersion = 0;
    const load = () => {
      if (document.visibilityState !== "visible") return;
      const mode = latest.current.arena;
      const version = ++requestVersion;
      void api<{
        players: NearbyExplorer[];
        waves?: { from: string; name: string; phrase: string; text: string }[];
      }>(
        `/presence?arena=${mode ? 1 : 0}&lat=${latest.current.position.lat.toFixed(2)}&lng=${latest.current.position.lng.toFixed(2)}`,
      )
        .then((r) => {
          if (
            active &&
            version === requestVersion &&
            mode === latest.current.arena
          )
            setOthers(r.players);
          // Ready-phrase waves from nearby explorers (only while sharing).
          const wave = r.waves?.at(-1);
          if (active && wave)
            void import("./PlayerCard").then(({ WAVE_TEXT }) =>
              notify(
                tr("{0} waves: “{1}”", {
                  0: wave.name,
                  1: WAVE_TEXT[wave.phrase]?.() || wave.text,
                }),
              ),
            );
        })
        .catch(() => {});
    };
    load();
    window.addEventListener("questlayer:social-blocks", load);
    const timer = setInterval(load, 8000);
    return () => {
      active = false;
      clearInterval(timer);
      window.removeEventListener("questlayer:social-blocks", load);
      setOthers([]);
    };
  }, [player?.id]);
  useEffect(() => {
    if (!presence || !player) return;
    const leaseId = crypto.randomUUID();
    let active = true;
    // The server holds a lease for 15 minutes; it is renewed a few minutes
    // before it runs out, and again whenever the server no longer has it
    // (a restart, a missed first request), so sharing never just ends.
    let expiresAt = 0;
    const send = () => {
      if (!active) return;
      const renew = Date.now() > expiresAt - 3 * 60_000;
      return api<{ enabled: boolean; expiresAt?: number }>("/presence", {
        enabled: true,
        leaseId,
        renew,
        arena: latest.current.arena,
        ...latest.current.position,
      })
        .then((r) => {
          if (!active) return;
          if (!r.enabled) expiresAt = 0;
          else if (r.expiresAt) expiresAt = r.expiresAt;
        })
        .catch(() => {
          // Offline or rate limited: the next tick tries again.
        });
    };
    void send();
    const t = setInterval(send, 10_000);
    return () => {
      active = false;
      clearInterval(t);
      void fetch("/api/presence", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        keepalive: true,
        body: JSON.stringify({ enabled: false, leaseId }),
      }).catch(() => {});
    };
  }, [presence, player?.id, arena]);
  useEffect(() => {
    if (!presence) return;
    // A closed page cannot run the effect cleanup; its position goes stale
    // on the server after 30 seconds anyway.
    const stop = () => setPageVisible(false);
    window.addEventListener("pagehide", stop);
    return () => window.removeEventListener("pagehide", stop);
  }, [presence]);
  useEffect(
    () => () => {
      if (gps.current !== null) navigator.geolocation.clearWatch(gps.current);
    },
    [],
  );
  // City demo only: the pad / arrows / WASD walk the explorer the way it
  // faces. Real play has no manual movement; the position is the GPS fix.
  const demoWalk = useDemoWalk({
    enabled: !!player && arena && !nativePlay && !globe && tab === "explore" && !sheetExpanded && !actorOpen && !showNpc && !discovery && !findInspect && !walletChoices,
    setPosition,
    onWalk: () => {
      setOverview(false);
      setFollow(true);
    },
  });
  const [demoTarget, setDemoTarget] = useState<
    (Point & { label: string; coinId?: string; questId?: string }) | null
  >(null);
  // A target that is gone (coin collected, quest done) stops being pointed at;
  // before, the pad kept saying "Street find" after the pickup.
  useEffect(() => {
    if (!demoTarget || !world) return;
    const gone =
      (demoTarget.coinId &&
        !world.coins.some((c) => c.id === demoTarget.coinId && !c.claimant)) ||
      (demoTarget.questId &&
        world.quests.find((q) => q.id === demoTarget.questId)?.completed);
    if (gone) return setDemoTarget(null);
    // A trail moves on to its next stop: point there.
    const quest = demoTarget.questId
      ? world.quests.find((q) => q.id === demoTarget.questId)
      : null;
    const at = quest ? questTarget(quest, position) : null;
    if (at && (at.lat !== demoTarget.lat || at.lng !== demoTarget.lng))
      setDemoTarget({ ...demoTarget, lat: at.lat, lng: at.lng });
  }, [world, demoTarget, position]);
  useEffect(() => {
    if (!arena || nativePlay) setDemoTarget(null);
  }, [arena, nativePlay]);
  useEffect(() => {
    // Arriving within a few metres settles the explorer on the spot, so thin
    // path zones still count in the demo. GPS play never snaps.
    if (demoTarget && metersBetween(position, demoTarget) < 3) {
      if (arena && !nativePlay)
        setPosition({ lat: demoTarget.lat, lng: demoTarget.lng });
      setDemoTarget(null);
    }
  }, [position, demoTarget]);
  useEffect(() => {
    try {
      localStorage.setItem("questlayer.mapFull", mapFull ? "1" : "0");
    } catch {
      /* private mode: full map just starts off next time */
    }
  }, [mapFull]);
  const [streetFindTarget, setStreetFindTarget] = useState<string | null>(null);
  function goToStreetFind(coin: { id: string; lat: number; lng: number }) {
    setStreetFindTarget(coin.id);
    if (arena && !nativePlay) faceToward(coin, tr("Street find"), { coinId: coin.id });
    else {
      setFollow(false);
      setOverview(false);
    }
  }
  // First-session coach: every step points at an existing game action.
  function nearestCoin(find: boolean) {
    const coins = (world?.coins || []).filter(
      (c) => !c.claimant && !!c.find === find,
    );
    let best: (typeof coins)[number] | null = null;
    for (const c of coins)
      if (!best || meters(position, c) < meters(position, best)) best = c;
    return best;
  }
  function nearestChest() {
    if (!world || !player) return null;
    const zones = new Map(world.zones.map((z) => [z.id, z]));
    let best: { quest: Quest; zone: Zone; d: number } | null = null;
    for (const q of world.quests) {
      const zone = q.zone_id ? zones.get(q.zone_id) : undefined;
      if (
        !zone ||
        q.kind !== "chest" ||
        q.completed ||
        q.placeStatus === "closed" ||
        zone.placeStatus === "closed" ||
        q.tier > player.tier ||
        q.opens_at > now ||
        q.closes_at <= now
      )
        continue;
      const d = meters(position, questPoint(q));
      if (!best || d < best.d) best = { quest: q, zone, d };
    }
    return best;
  }
  function runFirstStep(step: FirstStepId) {
    if (!player) return;
    if (nativePlay) chooseLedger(false);
    setTab("explore");
    if (step !== "chest") setSelected(null);
    if (step === "find" || step === "coin") {
      const coin = nearestCoin(step === "find") || nearestCoin(step !== "find");
      if (!coin) {
        setSheetExpanded(true);
        return;
      }
      setSheetExpanded(false);
      if (coin.find) goToStreetFind(coin);
      else if (arena)
        faceToward(coin, coin.find ? tr("Street find") : tr("Coin"), { coinId: coin.id });
      else setFollow(false);
      return;
    }
    if (step === "chest") {
      const chest = nearestChest();
      if (chest) startQuest(chest.quest);
      else setSheetExpanded(true);
      return;
    }
    if (step === "aura") {
      const aura = [...player.inventory]
        .reverse()
        .find((i) => i.kind === "aura" && !i.equipped && !i.native_claim_state);
      if (!aura) {
        setTab("inventory");
        return;
      }
      void action("equip", async () => {
        const r = await api<{ player: Player }>("/equip", {
          itemId: aura.id,
          desiredEquipped: true,
        });
        updateOwnedPlayer(r.player);
        setSheetExpanded(false);
        setFollow(true);
        notify(tr("Equipped {0}. Your new glow is on the map.", { 0: aura.name }));
      });
      return;
    }
    if (step === "secure") {
      const reward = adventureResults.results.find(
        (r) => r.reward?.item?.kind === "aura",
      );
      if (reward) inspectAdventureResult(reward.id, "share");
      else setTab("inventory");
    }
  }
  // Demo: turn the explorer toward a place; holding Forward walks there.
  function faceToward(
    p: Point,
    label: string,
    ref: { coinId?: string; questId?: string } = {},
  ) {
    if (!arena || nativePlay) return;
    setOverview(false);
    setFollow(true);
    // The pad lives on the map: fold the sheet so it is there to walk with.
    setSheetExpanded(false);
    demoWalk.face(headingTo(latest.current.position, p));
    setDemoTarget({ lat: p.lat, lng: p.lng, label, ...ref });
  }
  const [guideRequest, setGuideRequest] = useState<{ questId: string; revision: number; worldId: string; playerId: string } | null>(null);
  // "Go" on a Community quest: the map shows its start with the direction
  // guide and a chip that leads back to the quest (answer, rate, discuss).
  const [communityGoal, setCommunityGoal] = useState<QuestMapTarget | null>(null);
  // A saved rating also becomes a record under the explorer's own account
  // (src/quest-rating-record.ts). Only the invisible account does it, so no
  // wallet ever pops up; a failure leaves the rating in the game untouched.
  const ratingRecords = useRef<Promise<unknown>>(Promise.resolve());
  function keepQuestRating(questId: string, stars: number) {
    const account = recordAccount?.managed ? recordAccount.accountId : "";
    const playerId = player?.id;
    if (!account || !playerId) return;
    ratingRecords.current = ratingRecords.current.then(async () => {
      // Other background writes of the same account (inbox key, profile) can
      // take the same nonce, so a lost try is repeated a little later.
      for (const wait of [0, 4000, 12000]) {
        try {
          if (wait) await new Promise((resolve) => setTimeout(resolve, wait));
          const { signer, accountId } = await signerForAccount(account);
          const { publishRatingRecord } = await import("./quest-rating-record");
          if (await publishRatingRecord({ call: api, signer, accountId, playerId, questId, stars })) return;
        } catch {
          // The stars stay saved in the game either way.
        }
      }
    });
  }
  function goToCreatorQuest(target: QuestMapTarget) {
    const start = target.points[0];
    if (!start) return;
    setCommunityGoal(target);
    setTab("explore");
    setSheetExpanded(false);
    setGlobe(false);
    setOverview(false);
    setFollow(false);
    if (arena && !nativePlay) faceToward(start, target.title);
  }
  function openCommunityGoal() {
    if (!communityGoal) return;
    setTab("community");
    setCreatorView({ page: "quest", questId: communityGoal.questId });
    setSheetExpanded(true);
  }
  function guideToQuest(q: Quest) {
    const zone = world?.zones.find(z => z.id === q.zone_id);
    if (!world || !player || !zone) return;
    if (arena && !nativePlay) {
      demoWalk.face(headingTo(latest.current.position, questPoint(q)));
      setDemoTarget({ ...questPoint(q), label: q.title, questId: q.id });
    }
    setStartedQuestKey(`${player.id}:${world.id}:${q.id}`);
    selectAdventure(zone, q.id);
    navigation.update({ demoTarget: { worldId: world.id, zoneId: zone.id, questId: q.id, realm: arena ? "arena" : "gps" }, sheetExpanded: false });
    setGlobe(false);
    setOverview(false);
    setFollow(false);
    if (!arena && !nativePlay) gpsResumeOnMovement.current = true;
    setGuideRequest({ questId: q.id, revision: Date.now(), worldId: world.id, playerId: player.id });
    requestAnimationFrame(() => document.querySelector<HTMLButtonElement>(".compact-selection")?.focus({ preventScroll: true }));
  }
  // One tap on a quest, from any list, pin or dialog: straight to the map
  // with the direction guide, or to the confirm button when already there.
  function startQuest(q: Quest) {
    setPointTarget(null);
    const zone = world?.zones.find(z => z.id === q.zone_id);
    if (!world || !player || !zone) return;
    const t = Date.now();
    const playable = !q.completed && zone.tier <= player.tier && !zone.operatorPause && zone.placeStatus !== "closed" && q.placeStatus !== "closed" &&
      zone.opensAt <= t && zone.closesAt > t && q.opens_at <= t && q.closes_at > t;
    if (!playable) { selectZone(zone, q.id); return; }
    const here = meters(latest.current.position, questPoint(q)) <= 25 && !(zone.geometry && zoneInteriorMargin(zone, latest.current.position) === null);
    setCatalogView(null);
    if (!here) { guideToQuest(q); return; }
    setGuideRequest(null);
    setDemoTarget(null);
    setStartedQuestKey(`${player.id}:${world.id}:${q.id}`);
    setSelected(zone, q.id);
    setTab("explore");
    setSheetExpanded(true);
  }
  // A plain point as the map target (tour stops, player tasks, Secrets): the
  // same highlight and clear X as a chosen quest, without opening anything.
  const [pointTarget, setPointTarget] = useState<{ lat: number; lng: number; label: string; revision: number } | null>(null);
  function navigateTo(p: { lat: number; lng: number; label: string }) {
    if (selected) closeZone();
    setCatalogView(null);
    setTab("explore");
    setSheetExpanded(false);
    setOverview(false);
    setPointTarget({ lat: p.lat, lng: p.lng, label: p.label, revision: Date.now() });
    if (arena && !nativePlay) faceToward(p, p.label);
    else setFollow(false);
  }
  function clearPointTarget() {
    setPointTarget(null);
    if (demoTarget && !demoTarget.coinId && !demoTarget.questId) setDemoTarget(null);
  }
  useEffect(() => {
    if (pointTarget && metersBetween(position, pointTarget) < 15) setPointTarget(null);
  }, [position, pointTarget]);
  useEffect(() => {
    const on = (e: Event) => {
      const d = (e as CustomEvent<{ lat?: number; lng?: number; label?: string }>).detail;
      if (d && Number.isFinite(d.lat) && Number.isFinite(d.lng)) navigateRef.current({ lat: d.lat!, lng: d.lng!, label: String(d.label || "") });
    };
    window.addEventListener("questlayer:navigate", on);
    return () => window.removeEventListener("questlayer:navigate", on);
  }, []);
  const navigateRef = useRef(navigateTo);
  navigateRef.current = navigateTo;
  function closeZone() {
    const zoneId = selected?.id;
    setGuideRequest(null);
    setDemoTarget(null);
    selectAdventure(null);
    navigation.update({ demoTarget: null, sheetExpanded: false });
    requestAnimationFrame(() => {
      const origin = Array.from(document.querySelectorAll<HTMLButtonElement>(".zone-map-pin, .zone-card")).find(node => node.dataset.zoneId === zoneId);
      (origin || document.querySelector<HTMLButtonElement>(".sheet-toggle"))?.focus({ preventScroll: true });
    });
  }
  useEffect(() => {
    if (!selected || tab !== "explore") return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented || document.querySelector('[role="dialog"], dialog[open]')) return;
      event.preventDefault();
      closeZone();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [selected, tab]);
  function chooseNativeQuest(index: number) {
    const q = nativeGame.state?.day?.quests.find((q) => q.index === index);
    if (!q) return;
    nativeObjective.select("quest", index);
    setNativePlay(true);
    setFollow(false);
    setGlobe(false);
    setOverview(false);
    setTab("expeditions");
  }
  function chooseZoneQuest(questId: string) {
    setGuideRequest(null);
    setDemoTarget(null);
    const quest = world?.quests.find((q) => q.id === questId);
    const zone = world?.zones.find(
      (z) =>
        z.id === quest?.zone_id ||
        quest?.id === z.id.replace(":zone:", ":quest:"),
    );
    if (!zone) return;
    if (quest && quest.zone_id === zone.id && !quest.completed) { startQuest(quest); return; }
    setCatalogView({ scope: `${player?.id}:${world?.id}`, zoneId: zone.id, questId });
    setSheetExpanded(true);
    requestAnimationFrame(() => {
      const target = document.getElementById("quest-" + questId);
      target?.focus({ preventScroll: true });
      target?.scrollIntoView({ block: "nearest", behavior: "auto" });
    });
  }
  function selectZone(z: Zone, questId?: string) {
    setGuideRequest(null);
    setDemoTarget(null);
    setSheetExpanded(true);
    setCatalogView({ scope: `${player?.id}:${world?.id}`, zoneId: z.id, questId: questId || null });
    setTab("explore");
    setOverview(false);
    setFollow(false);
    if (questId)
      requestAnimationFrame(() =>
        document
          .getElementById("quest-" + questId)
          ?.scrollIntoView({ block: "start", behavior: "auto" }),
      );
  }
  function returnToAdventure() {
    setCatalogView(null);
    setTab("explore");
    setSheetExpanded(false);
    requestAnimationFrame(() => {
      const panel = mainPanel.current;
      const candidates = panel?.querySelectorAll<HTMLElement>(
        ".compact-selection, .native-objective-open, .quest-detail, .map-discoveries",
      );
      const target = [...(candidates || [])].find(
        (element) => element.getClientRects().length > 0,
      );
      (target || panel)?.focus({ preventScroll: true });
    });
  }
  const questPoint = (q: Quest) => questTarget(q, position);
  function returnToArena() {
    gpsVersion.current++;
    if (gps.current !== null) navigator.geolocation.clearWatch(gps.current);
    gps.current = null;
    setFix(null);
    setGpsCourse(null);
    gpsFacing.current = initialGpsFacing();
    gpsResumeOnMovement.current = false;
    rememberMode("demo");
    setArena(true);
    setPosition(HOME);
    void loadWorld(HOME, true);
  }
  async function locate(quiet = false) {
    if (!navigator.geolocation) {
      notify(
        tr("This browser cannot share your location. Keep exploring in the city demo."),
        true,
      );
      return;
    }
    const owner = ownerContext();
    const version = ++gpsVersion.current;
    const current = () =>
      ownerContext() === owner && gpsVersion.current === version;
    const turn = (p: GeolocationPosition, f: Fix) => {
      const next = advanceGpsFacing(gpsFacing.current, { ...f, heading: p.coords.heading, speed: p.coords.speed }, Date.now());
      const moved = next.state.lastMovementAt !== gpsFacing.current.lastMovementAt;
      gpsFacing.current = next.state;
      setGpsCourse(next.state.heading);
      if (next.resumed || (moved && gpsResumeOnMovement.current)) {
        gpsResumeOnMovement.current = false;
        setFollow(true); setOverview(false);
      }
    };
    if (!quiet) setBusy("gps");
    navigator.geolocation.getCurrentPosition(
      (p) => {
        if (!current()) return;
        const f = {
          lat: p.coords.latitude,
          lng: p.coords.longitude,
          accuracy: p.coords.accuracy,
          timestamp: p.timestamp,
        };
        setPosition(f);
        setFix(f);
        gpsFacing.current = initialGpsFacing();
        turn(p, f);
        rememberMode("gps");
        setArena(false);
        setFollow(true);
        setGlobe(false);
        void loadWorld(f, false);
        if (gps.current !== null) navigator.geolocation.clearWatch(gps.current);
        gps.current = navigator.geolocation.watchPosition(
          (p) => {
            if (!current()) return;
            const f = {
              lat: p.coords.latitude,
              lng: p.coords.longitude,
              accuracy: p.coords.accuracy,
              timestamp: p.timestamp,
            };
            setPosition(f);
            setFix(f);
            turn(p, f);
          },
          () => {
            if (current())
              notify(
                tr("Waiting for a fresh GPS fix. Step into the open or try again in a moment."),
                true,
              );
          },
          { enableHighAccuracy: true, maximumAge: 0 },
        );
      },
      () => {
        if (!current()) return;
        setBusy("");
        // A refused start-up request keeps the city demo without a warning.
        if (quiet) return;
        notify(
          tr("Allow location access, or keep exploring in the city demo."),
          true,
        );
      },
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 0 },
    );
  }
  // The invisible account signs without a popup; an external wallet is the
  // fallback when the player chose one or the managed account is not ready.
  // Attaches a passkey to the explorer that is already playing, so the player
  // keeps everything and can return from a synced device.
  function chooseLedger(native: boolean) {
    setNativePlay(native);
    try {
      localStorage.setItem("questlayer-play-mode-chosen", "1");
    } catch {}
  }
  async function attachPasskey() {
    await action("passkey", async () => {
      const r = await api<{ options: any; challengeId: string }>(
        "/passkey/options",
        { action: "register", attach: true },
      );
      const { startRegistration } = await webauthn();
      const response = await startRegistration({ optionsJSON: r.options });
      const verified = await api<{ player: Player }>("/passkey/verify", {
        challengeId: r.challengeId,
        response,
      });
      setPlayer(verified.player);
      notify(tr("Your explorer is secured with a passkey."));
    });
  }
  // In-game "activate" buttons prepare the explorer's own account instead of
  // asking for a wallet app; linking another NEAR wallet stays in Profile.
  async function activateExplorer() {
    let walletOnly = false;
    await action("explorer-account", async () => {
      const { signer, reason } = await explorerSigner();
      // A host without player accounts keeps the wallet route.
      if (!signer && reason === "unavailable") return void (walletOnly = true);
      if (!signer) throw Error(explorerAccountMessage(reason));
      await me();
      notify(tr("Your account is active. Actions now sign on their own."));
    });
    if (walletOnly) await connectNear();
  }
  // Every in-game action signs with the explorer's own account (created with
  // the explorer, key kept on this device): no wallet popup. A wallet app is
  // asked only when the player picked another linked NEAR account on purpose.
  async function explorerSigner() {
    if (invisible.signer)
      return { signer: invisible.signer, reason: "ready" as const };
    return invisible.ensureSigner();
  }
  async function resolveSigner(expected?: string): Promise<{
    signer: NativeSigner;
    accountId: string;
  }> {
    const { signer: managed, reason } = await explorerSigner();
    const own = managed?.accountId ?? invisible.accountId;
    if (managed && (!expected || expected === managed.accountId))
      return { signer: managed, accountId: managed.accountId };
    const otherLinked =
      !!expected &&
      expected !== own &&
      !!player?.wallets.some((w) => w.account_id === expected);
    if (!otherLinked && reason !== "unavailable")
      throw Error(explorerAccountMessage(reason));
    const { wallet, accountId } = await chooseNearAccount();
    return { signer: walletSigner(wallet, accountId), accountId };
  }
  // Public profile and note records name their account up front: the
  // explorer account signs without a popup, any other linked one uses a wallet.
  async function signerForAccount(account: string) {
    return resolveSigner(account || undefined);
  }
  async function chooseNearAccount() {
    if (!nearConnector.current) {
      const { NearConnector } = await import("@hot-labs/near-connect");
      nearConnector.current = new NearConnector({
        network: NEAR_NETWORK,
        autoConnect: false,
        features: {
          testnet: NEAR_NETWORK === "testnet",
          signMessage: true,
          signInWithoutAddKey: true,
        },
        footerBranding: {
          heading: tr("QuestLayer · {0}", { 0: NETWORK_LABEL }),
          link: "https://near.org",
          linkText: "NEAR Protocol",
        },
      });
    }
    const connector = nearConnector.current;
    await connector.whenManifestLoaded;
    const choices = connector.availableWallets
      .map((w) => w.manifest)
      .filter((w) => !w.debug && !w.id.includes("cli"))
      .map(({ id, name, icon, website }) => ({ id, name, icon, website }));
    if (!choices.length)
      throw Error(
        "No supported NEAR wallet app was found in this browser. You can still start exploring.",
      );
    const walletId = await new Promise<string>((resolve, reject) => {
      walletChoice.current = { resolve, reject };
      setWalletChoiceKind("near");
      setWalletChoices(choices);
    });
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => resolve()),
    );
    const wallet = await connector.connect({ walletId });
    const accounts = await wallet.getAccounts();
    if (!accounts[0])
      throw new Error(
        tr("The wallet did not return an account. Try again or pick another wallet."),
      );
    return { wallet, accountId: accounts[0].accountId };
  }
  async function connectNear(
    options: { signIn?: boolean; name?: string } = {},
  ) {
    if (options.signIn) {
      options.name = options.name?.trim() || "Explorer";
      if (options.name.length < 2 || options.name.length > 24) {
        notify(tr("Pick a name between 2 and 24 characters."), true);
        return;
      }
    }
    await action("near", async () => {
      if (options.signIn)
        await new Promise<void>((resolve) =>
          requestAnimationFrame(() => resolve()),
        );
      const { wallet, accountId } = await chooseNearAccount();
      const c = await api<{
        challengeId: string;
        nonce: string;
        message: string;
        recipient: string;
      }>(options.signIn ? "/auth/near/challenge" : "/wallet/challenge", {
        accountId: accountId,
        name: options.name,
      });
      const signed = await wallet.signMessage({
        message: c.message,
        recipient: c.recipient,
        nonce: Uint8Array.from(atob(c.nonce), (x) => x.charCodeAt(0)),
        network: NEAR_NETWORK,
        signerId: accountId,
      });
      const r = await api<{ player: Player; returning?: boolean }>(
        options.signIn ? "/auth/near/verify" : "/wallet/verify",
        {
          challengeId: c.challengeId,
          ...signed,
        },
      );
      setPlayer(r.player);
      notify(
        options.signIn
          ? r.returning
            ? tr("Welcome back, explorer. Your account restored your progress.")
            : tr("Your explorer is ready. Coins you collect are paid in QGOLD to your NEAR account within minutes.")
          : tr("Account linked. Coins you collect are paid in QGOLD to this NEAR account within minutes."),
      );
    });
  }
  // Ethereum wallets (MetaMask, Rabby): sign in, or link to this explorer.
  // The wallet signs readable text only; the module loads on demand.
  async function connectEthereum(options: { signIn?: boolean; name?: string } = {}) {
    const name = options.name?.trim() || "Explorer";
    if (options.signIn && (name.length < 2 || name.length > 24)) {
      notify(tr("Pick a name between 2 and 24 characters."), true);
      return;
    }
    await action("evm-wallet", async () => {
      const evm = await import("./evm-wallet");
      const wallets = await evm.discoverEvmWallets();
      if (!wallets.length)
        throw Error(tr("No Ethereum wallet was found in this browser. Install MetaMask or Rabby, or keep exploring without one."));
      let choice = wallets[0];
      if (wallets.length > 1) {
        const id = await new Promise<string>((resolve, reject) => {
          walletChoice.current = { resolve, reject };
          setWalletChoiceKind("evm");
          setWalletChoices(wallets.map(({ id, name, icon, website }) => ({ id, name, icon, website })));
        });
        choice = wallets.find((w) => w.id === id) || choice;
      }
      const r = await evm.signInWithEthereum(choice, { name, link: !options.signIn });
      setPlayer(r.player);
      notify(
        options.signIn
          ? r.returning
            ? tr("Welcome back, explorer. Your account restored your progress.")
            : tr("Your explorer is ready. Coins you collect are paid in QGOLD to your NEAR account within minutes.")
          : tr("Ethereum wallet linked. It can sign NEAR Intents trades for your explorer."),
      );
    });
  }
  async function useNativeOutfit(account: string | null) {
    await action("native-outfit", async () => {
      const r = await api<{ player: Player }>("/native/outfit", {
        enabled: !!account,
        accountId: account,
      });
      updateOwnedPlayer(r.player);
      if (account) await refreshNative(true);
      notify(
        account
          ? tr("Your secured outfit is on the map.")
          : tr("Your game outfit is on the map."),
      );
    });
  }
  // Task market, Secrets and sends: the explorer pays real QGOLD into the
  // market escrow from the account the server named (sponsored, no popup on
  // the explorer account).
  async function fundMarketEscrow(call: MarketFunding) {
    const { signer, accountId } = await signerForAccount(call.signerId);
    if (accountId !== call.signerId)
      throw Error(tr("Pay with the account that holds your QGOLD: {0}", { 0: call.signerId }));
    // The escrow holds each funder's storage for their open agreements. When
    // the server says this one is short, the deposit goes first (sponsored on
    // the explorer account; the escrow keeps it as a grant for agreements).
    if (call.storageDeposit) {
      const d = call.storageDeposit;
      try {
        await signer.send(
          {
            network: NEAR_NETWORK,
            signerId: accountId,
            receiverId: d.receiverId,
            actions: [{ type: "FunctionCall", params: { methodName: d.methodName, args: d.args, gas: d.gas, deposit: d.deposit } }],
          },
          { playerId: player!.id },
        );
      } catch (e) {
        throw Error(
          tr("The escrow needs {0} of storage for this agreement and it could not be added right now: {1}", {
            0: d.near,
            1: (e as Error).message,
          }),
        );
      }
    }
    await signer.send(
      {
        network: NEAR_NETWORK,
        signerId: accountId,
        receiverId: call.receiverId,
        actions: [
          {
            type: "FunctionCall",
            params: { methodName: call.methodName, args: call.args, gas: call.gas, deposit: call.deposit },
          },
        ],
      },
      { playerId: player!.id },
    );
  }
  // GOLD spending burns the explorer's own QGOLD (src/qgold-burn.ts): the
  // explorer account signs without a popup, an external wallet asks.
  async function burnQgold(call: QgoldBurnCall) {
    const { signer, accountId } = await signerForAccount(call.signerId);
    if (accountId !== call.signerId)
      throw Error(tr("Pay with the account that holds your QGOLD: {0}", { 0: call.signerId }));
    return signer.send(
      {
        network: NEAR_NETWORK,
        signerId: accountId,
        receiverId: call.receiverId,
        actions: [
          {
            type: "FunctionCall",
            params: { methodName: call.methodName, args: call.args, gas: call.gas, deposit: call.deposit },
          },
        ],
      },
      { playerId: player!.id, recoveryKey: `${call.purchaseId}:${call.submission}`,
        confirm: async (txHash) => ({ ...(await api<{ confirmed: boolean; accountId: string; contractId: string; transactionHash: string }>(
          "/gold/burn/confirm", { purchaseId: call.purchaseId, txHash })), network: NEAR_NETWORK }),
      },
    );
  }
  useEffect(() => {
    setQgoldBurner(player ? burnQgold : null, player?.id);
  });
  async function tradeNative(request: NativeTradeRequest): Promise<boolean> {
    const result = await action("native-market", async () => {
      const { signer, accountId } = await resolveSigner(request.accountId);
      if (
        accountId !== request.accountId ||
        !player?.wallets.some((w) => w.account_id === accountId)
      )
        throw Error("Choose the linked account shown for this trade.");
      if (
        !onNearNetwork(request.marketId) ||
        request.nftContractId !== nativeWardrobe?.contractId
      )
        throw Error(
          "This market is not set up for your secured collection yet.",
        );
      const listing = request.kind === "list",
        receiverId = listing ? request.nftContractId : request.marketId;
      const methodName = listing
        ? "nft_transfer_call"
        : request.kind === "buy"
          ? "buy"
          : request.kind === "cancel"
            ? "cancel"
            : "withdraw";
      const args = listing
        ? {
            receiver_id: request.marketId,
            token_id: request.tokenId,
            approval_id: null,
            memo: null,
            msg: JSON.stringify({ price: request.price }),
          }
        : request.kind === "withdraw"
          ? {}
          : { token_id: request.tokenId, listing_id: request.listingId };
      await signer.send(
        {
          network: NEAR_NETWORK,
          signerId: accountId,
          receiverId,
          actions: [
            {
              type: "FunctionCall",
              params: {
                methodName,
                args,
                gas: listing ? "200000000000000" : "150000000000000",
                deposit: request.kind === "buy" ? request.price! : "1",
              },
            },
          ],
        },
        { playerId: player!.id },
      );
      await refreshNative(true);
      return true;
    });
    return result === true;
  }
  // Signed-order market calls. The explorer's device key signs silently: free
  // calls are relayed and money moves in self-paid transactions. A linked
  // external wallet signs orders with signMessage and sends calls through the
  // reviewed wallet flow, which confirms them on the server.
  function marketTransaction(
    signerId: string,
    call: MarketCall,
  ): ReviewedNativeTransaction {
    if (!onNearNetwork(call.receiverId))
      throw Error("This market is not on the game network.");
    return {
      network: NEAR_NETWORK,
      signerId,
      receiverId: call.receiverId,
      actions: [
        {
          type: "FunctionCall",
          params: {
            methodName: call.methodName,
            args: call.args,
            gas: call.gas,
            deposit: call.deposit,
          },
        },
      ],
    };
  }
  async function marketCall(
    send: (signerId: string) => Promise<string | null | void>,
    signerId: string,
  ): Promise<string | null> {
    let hash: string | null = null;
    let failure: unknown = null;
    const result = await action("native-market", async () => {
      try {
        hash = (await send(signerId)) || null;
      } catch (e) {
        failure = e;
        throw e;
      }
      await refreshNative(true);
      return true;
    });
    if (result !== true)
      throw failure instanceof Error && failure.message
        ? failure
        : Error("The action was not sent. Nothing changed.");
    return hash;
  }
  const walletForOrders = useRef<{
    accountId: string;
    wallet: Awaited<ReturnType<typeof chooseNearAccount>>["wallet"];
  } | null>(null);
  async function orderWallet(accountId: string) {
    if (walletForOrders.current?.accountId !== accountId) {
      const chosen = await chooseNearAccount();
      if (chosen.accountId !== accountId)
        throw Error(`Choose the wallet for ${accountId} to sign this order.`);
      walletForOrders.current = chosen;
    }
    return walletForOrders.current!.wallet;
  }
  const orderSigner: OrderSigner | null =
    invisible.signer && invisible.deviceKey?.accountId
      ? deviceOrderSigner(invisible.deviceKey, (call) =>
          marketCall(
            (id) =>
              invisible.signer!.send(marketTransaction(id, call), {
                playerId: player!.id,
              }),
            invisible.signer!.accountId,
          ),
        )
      : player?.wallets[0] && player.wallets[0].account_id !== invisible.accountId
        ? walletOrderSigner(
            player.wallets[0].account_id,
            async () =>
              (await orderWallet(
                player.wallets[0].account_id,
              )) as unknown as MessageWallet,
            (call) =>
              marketCall(async (id) => {
                const wallet = await orderWallet(id);
                await walletSigner(wallet, id).send(
                  marketTransaction(id, call),
                  { playerId: player!.id },
                );
                return null;
              }, player!.wallets[0].account_id),
          )
        : null;
  // NPC trades settle on NEAR from the NPC sheet (src/chain-trades.ts): the
  // explorer account signs without a popup, a linked wallet confirms each step.
  useEffect(() => {
    if (!player) {
      registerChainTrades(null);
      return;
    }
    registerChainTrades({
      async send(accountId, call) {
        const managed = invisible.signer;
        if (managed && managed.accountId === accountId)
          return (
            (await managed.send(marketTransaction(accountId, call), {
              playerId: player.id,
            })) || null
          );
        if (accountId === invisible.accountId)
          throw Error(explorerAccountMessage(invisible.status));
        const { wallet, accountId: chosen } = await chooseNearAccount();
        if (chosen !== accountId)
          throw Error(`Choose the wallet for ${accountId} to sign this trade.`);
        await walletSigner(wallet, chosen).send(marketTransaction(chosen, call), {
          playerId: player.id,
        });
        return null;
      },
      secureItem: (itemId) =>
        mintEarnedAura({ id: itemId } as Item).then((ok) => ok === true),
      // NPC buys and sales settle on NEAR Intents, signed by the device key.
      intentsKey: () =>
        invisible.deviceKey?.accountId ? invisible.deviceKey : null,
    });
  });
  // Treasury DAO vote (docs/TREASURY-DAO.md): the explorer account approves
  // one poll option on the Sputnik DAO; sponsored, no deposit, no popup.
  async function voteTreasury(dao: string, proposalId: number): Promise<boolean> {
    const result = await action("treasury-vote", async () => {
      if (!onNearNetwork(dao)) throw Error(tr("The treasury vote is on another network."));
      const { signer, accountId } = await resolveSigner(invisible.accountId || undefined);
      await signer.send(
        {
          network: NEAR_NETWORK,
          signerId: accountId,
          receiverId: dao,
          actions: [
            {
              type: "FunctionCall",
              params: {
                methodName: "act_proposal",
                args: { id: proposalId, action: "VoteApprove", proposal: "Vote" },
                gas: "50000000000000",
                deposit: "0",
              },
            },
          ],
        },
        { playerId: player!.id },
      );
      return true;
    });
    return result === true;
  }
  async function withdrawNativeReward(
    expectedAccount: string,
    contractId: string,
  ): Promise<boolean> {
    const result = await action("native-withdrawal", async () => {
      const { signer, accountId } = await resolveSigner(expectedAccount);
      if (
        accountId !== expectedAccount ||
        !player?.wallets.some((w) => w.account_id === accountId)
      )
        throw Error("Choose the linked account that receives this reward.");
      const configured = await api<{ contractId: string }>(
        "/native/rewards?account=" + encodeURIComponent(accountId),
      );
      if (configured.contractId !== contractId || !onNearNetwork(contractId))
        throw Error("The reward rules changed. Refresh, then try again.");
      await signer.send(
        {
          network: NEAR_NETWORK,
          signerId: accountId,
          receiverId: contractId,
          actions: [
            {
              type: "FunctionCall",
              params: {
                methodName: "withdraw",
                args: {},
                gas: "100000000000000",
                deposit: "1",
              },
            },
          ],
        },
        { playerId: player!.id },
      );
      return true;
    });
    return result === true;
  }
  async function operateNativeVault(request: VaultRequest): Promise<boolean> {
    const result = await action("native-staking", async () => {
      const { signer, accountId } = await resolveSigner(request.accountId);
      if (
        accountId !== request.accountId ||
        !player?.wallets.some((w) => w.account_id === accountId)
      )
        throw Error("Choose the linked account shown for this position.");
      const quote = await api<VaultQuote>("/native/vaults/prepare", request);
      assertVaultQuote(quote, request);
      await signer.send(
        {
          network: NEAR_NETWORK,
          signerId: accountId,
          receiverId: quote.receiverId,
          actions: [
            {
              type: "FunctionCall",
              params: {
                methodName: quote.methodName,
                args: quote.args,
                gas: quote.gas,
                deposit: quote.deposit,
              },
            },
          ],
        },
        { playerId: player!.id },
      );
      return true;
    });
    return result === true;
  }
  async function operateCreatorPayment(
    request: CreatorPaymentRequest,
    expected: { contractId: string; price?: string },
  ): Promise<boolean> {
    const result = await action("creator-payment", async () => {
      const { signer, accountId } = await resolveSigner();
      if (!player?.wallets.some((w) => w.account_id === accountId))
        throw Error("Link this account before paying a creator.");
      const quote = await api<CreatorPaymentQuote>(
        "/native/creators/prepare",
        request,
      );
      assertCreatorQuote(quote, request, { accountId, ...expected });
      await signer.send(
        {
          network: NEAR_NETWORK,
          signerId: accountId,
          receiverId: quote.receiverId,
          actions: [quote.actions[0]],
        },
        { playerId: player!.id },
      );
      return true;
    });
    return result === true;
  }
  async function operateNativeTask(request: TaskRequest): Promise<boolean> {
    const result = await action("native-task", async () => {
      const { signer, accountId } = await resolveSigner(request.accountId);
      if (
        accountId !== request.accountId ||
        !player?.wallets.some((w) => w.account_id === accountId)
      )
        throw Error("Choose the linked account shown for this task.");
      const quote = await api<TaskQuote>("/native/tasks/prepare", request);
      assertTaskQuote(quote, request);
      await signer.send(
        {
          network: NEAR_NETWORK,
          signerId: accountId,
          receiverId: quote.receiverId,
          actions: [
            {
              type: "FunctionCall",
              params: {
                methodName: quote.methodName,
                args: quote.args,
                gas: quote.gas,
                deposit: quote.deposit,
              },
            },
          ],
        },
        { playerId: player!.id },
      );
      return true;
    });
    return result === true;
  }
  async function publishNativeProfile(
    account: string,
    avatar: { contractId: string; tokenId: string } | null,
  ): Promise<boolean> {
    const result = await action("native-profile", async () => {
      const { signer, accountId } = await signerForAccount(account);
      if (
        accountId !== account ||
        !player?.wallets.some((w) => w.account_id === accountId)
      )
        throw Error("Choose the linked account shown for your profile.");
      const quote = await api<NativeProfileQuote>("/native/profile/prepare", {
        accountId,
        publicConsent: true,
      });
      assertProfileQuote(quote, { accountId, name: player.name, avatar });
      await signer.send(
        {
          network: NEAR_NETWORK,
          signerId: accountId,
          receiverId: SOCIAL_CONTRACT_ID,
          actions: [
            {
              type: "FunctionCall",
              params: {
                methodName: "set",
                args: quote.args,
                gas: "80000000000000",
                deposit: quote.deposit,
              },
            },
          ],
        },
        { playerId: player!.id },
      );
      for (let attempt = 0; attempt < 5; attempt++) {
        const response = await api<{ confirmed: boolean; player: Player }>(
          "/native/profile/confirm",
          { accountId, mutationId: quote.profile.mutation_id },
        );
        if (response.confirmed) {
          updateOwnedPlayer(response.player);
          notify(tr("Your explorer profile is now public."));
          return true;
        }
        await new Promise((resolve) => setTimeout(resolve, 800));
      }
      notify(
        tr("Profile update sent. Refresh your public profile to see it confirmed."),
      );
      return false;
    });
    return result === true;
  }
  async function recordNote(
    noteId: string,
    kind: NoteRecordKind,
  ): Promise<boolean> {
    const account = recordAccount?.accountId;
    const result = await action("note-record", async () => {
      if (!account || !player)
        throw Error("Your explorer account is not ready yet.");
      const { signer, accountId } = await signerForAccount(account);
      if (accountId !== account)
        throw Error("Choose the linked account shown for this record.");
      const { confirmed } = await publishNoteRecord({
        call: api,
        signer,
        accountId,
        playerId: player.id,
        noteId,
        kind,
      });
      notify(
        confirmed
          ? kind === "note"
            ? tr("Your note is now a public record.")
            : tr("Your public record is marked removed.")
          : tr("Record sent. Refresh in a moment to see it confirmed."),
      );
      return confirmed;
    });
    return result === true;
  }
  // Invisible-account devices: recovery passkey, revoke, restore here.
  async function setupRecoveryPasskey() {
    const ok = await action("recovery-setup", async () => {
      const deviceKey = invisible.deviceKey,
        accountId = invisible.accountId;
      if (!deviceKey || !accountId)
        throw Error("Your explorer account is still being prepared.");
      const { setupPasskeyRecovery } = await import("./account-recovery");
      await setupPasskeyRecovery({
        deviceKey,
        accountId,
        credentials: navigator.credentials,
        rpId: location.hostname,
        api,
      });
      await invisible.refresh();
      notify(tr("Recovery passkey saved. Use it to restore on a new device."));
      return true;
    });
    return ok === true;
  }
  async function exportWalletWords() {
    const ok = await action("wallet-words", async () => {
      const deviceKey = invisible.deviceKey;
      if (!deviceKey || !invisible.accountId)
        throw Error("Your explorer account is still being prepared.");
      const { exportToWallet, hasRecoveryPasskey } = await import("./account-recovery");
      await exportToWallet({ deviceKey, passkey: hasRecoveryPasskey(invisible.keys) });
      await invisible.refresh();
      return true;
    });
    return ok === true;
  }
  async function revokeDevice(publicKey: string, signOutOthers: boolean) {
    const ok = await action("device-revoke", async () => {
      const deviceKey = invisible.deviceKey,
        accountId = invisible.accountId;
      if (!deviceKey || !accountId)
        throw Error("Your explorer account is still being prepared.");
      try {
        const { revokeAccountKey } = await import("./account-recovery");
        await revokeAccountKey({ deviceKey, accountId, publicKey, api });
      } finally {
        await invisible.refresh().catch(() => undefined);
      }
      let signedOut = "";
      if (signOutOthers) {
        const { signOutOtherSessions } = await import("./account-recovery");
        const r = await signOutOtherSessions({ deviceKey, accountId, api });
        signedOut = ` ${r.revokedSessions} other session(s) signed out.`;
      }
      notify(tr("Device revoked.{0}", { 0: signedOut }));
      return true;
    });
    return ok === true;
  }
  async function restoreThisDevice() {
    const ok = await action("recovery-restore", async () => {
      const { restoreWithPasskey } = await import("./account-recovery");
      const restored = await restoreWithPasskey<Player>({
        store: indexedDbKeyStore(),
        credentials: navigator.credentials,
        rpId: location.hostname,
        api,
        userAgent: navigator.userAgent,
      });
      setPlayer(restored.player);
      setLoaded(true);
      await invisible.ensure();
      notify(tr("This device can now play with your explorer."));
      return true;
    });
    return ok === true;
  }
  async function startOverHere() {
    const ok = await action("start-over", async () => {
      await invisible.startOver();
      setPlayer((await api<{ player: Player }>("/me")).player);
      notify(tr("A new explorer account is being made on this device."));
      return true;
    });
    return ok === true;
  }
  async function revokeGameSessions(expectedAccount: string) {
    const ok = await action("session-recovery", async () => {
      const { wallet, accountId } = await chooseNearAccount();
      if (
        accountId !== expectedAccount ||
        !player?.wallets.some((w) => w.account_id === accountId)
      )
        throw Error("Choose the linked account shown in the recovery review.");
      const c = await api<{
        challengeId: string;
        nonce: string;
        message: string;
        recipient: string;
        network: string;
        purpose: string;
      }>("/identity/recovery/challenge", { accountId });
      if (c.network !== NEAR_NETWORK || c.purpose !== "revoke-other-sessions")
        throw Error(
          "This recovery request could not be verified. Try again with the linked account.",
        );
      const signed = await wallet.signMessage({
        message: c.message,
        recipient: c.recipient,
        nonce: Uint8Array.from(atob(c.nonce), (x) => x.charCodeAt(0)),
        network: NEAR_NETWORK,
        signerId: accountId,
      });
      const result = await api<{ ok: boolean; revokedSessions: number }>(
        "/identity/recovery/verify",
        { challengeId: c.challengeId, ...signed },
      );
      if (!result.ok) throw Error("Sessions could not be updated. Try again.");
      notify(
        tr("{0} other session(s) signed out. This browser stays signed in.", { 0: result.revokedSessions }),
      );
      return true;
    });
    return ok === true;
  }
  async function checkNativeLevel(accountId: string, level: number) {
    const ok = await action("native-level-check", async () => {
      const c = await api<NativeLevelClaim>("/native/progression/confirm", {
        accountId,
        level,
      });
      if (c.state !== "minted")
        throw Error(
          "This level reward is not confirmed yet. Check again in a moment.",
        );
      await refreshNative(true);
      notify(tr("Reward secured. Find it in your Secured collection."));
      return true;
    });
    return ok === true;
  }
  // Level-reward Aura: voucher, relayed redeem_aura, then the server confirms.
  async function secureLevelOnChain(
    milestone: NativeMilestone,
    signer: NativeSigner,
    accountId: string,
  ): Promise<"minted" | "already" | "pending"> {
    const claim = await api<NativeLevelClaim>("/native/progression/claim", {
      accountId,
      level: milestone.level,
    });
    assertNativeLevelClaim(claim, accountId, milestone.level, milestone.edition);
    if (claim.claim_id !== milestone.claimId)
      throw Error("The level reward changed. Refresh, then try again.");
    if (claim.state === "minted") return "already";
    await signer.send(
      {
        network: NEAR_NETWORK,
        signerId: accountId,
        receiverId: claim.contractId,
        actions: [
          {
            type: "FunctionCall",
            params: {
              methodName: "redeem_aura",
              args: {
                claim_id: claim.claim_id,
                edition: claim.edition,
                receiver_id: claim.receiver_id,
                expires_at_ms: claim.expires_at,
                signature: claim.signature,
              },
              gas: "100000000000000",
              deposit: (5n * 10n ** 22n).toString(),
            },
          },
        ],
      },
      { playerId: player!.id },
    );
    for (let i = 0; i < 4; i++) {
      const checked = await api<NativeLevelClaim>(
        "/native/progression/confirm",
        { accountId, level: milestone.level },
      );
      if (checked.state === "minted") return "minted";
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    return "pending";
  }
  async function mintNativeLevel(
    expectedAccount: string,
    milestone: NativeMilestone,
  ) {
    const ok = await action("native-level", async () => {
      const { signer, accountId } = await resolveSigner(expectedAccount);
      if (
        accountId !== expectedAccount ||
        !player?.wallets.some((w) => w.account_id === accountId)
      )
        throw Error("Choose the linked account shown for this level reward.");
      const result = await secureLevelOnChain(milestone, signer, accountId);
      if (result === "pending")
        throw Error(
          "Your level reward is still confirming. Use Check claim before trying again.",
        );
      await refreshNative(true);
      notify(
        result === "minted"
          ? tr("Reward collected. Try it on from your Secured collection.")
          : tr("You already collected this level reward."),
      );
      return true;
    });
    return ok === true;
  }
  // Wisp rolls take no deposit, so the explorer account relays them silently.
  async function sendWispRoll(call: RollCall) {
    const managed = invisible.signer;
    if (!managed) throw Error("Your explorer account is not ready yet.");
    if (!onNearNetwork(call.receiverId) || call.deposit !== "0")
      throw Error("This roll is not on the game network.");
    await managed.send(
      {
        network: NEAR_NETWORK,
        signerId: managed.accountId,
        receiverId: call.receiverId,
        actions: [
          {
            type: "FunctionCall",
            params: {
              methodName: call.methodName,
              args: call.args,
              gas: call.gas,
              deposit: "0",
            },
          },
        ],
      },
      { playerId: player!.id },
    );
  }
  // Requests the award voucher, relays redeem_aura from the signing account and
  // waits for the server to confirm the mint. Shared by the Secure button and
  // the automatic background securing below.
  async function secureAuraOnChain(
    item: Item,
    signer: NativeSigner,
    accountId: string,
  ): Promise<boolean> {
    const claim = await api<NativeAuraClaim>("/native/claims", {
      itemId: item.id,
      accountId,
    });
    if (claim.state !== "minted") {
      if (!onNearNetwork(claim.contractId))
        throw Error("Securing Auras is not available on this network.");
      await signer.send(
        {
          network: NEAR_NETWORK,
          signerId: accountId,
          receiverId: claim.contractId,
          actions: [
            {
              type: "FunctionCall",
              params: {
                methodName: "redeem_aura",
                args: {
                  claim_id: claim.claim_id,
                  edition: claim.edition,
                  receiver_id: claim.receiver_id,
                  expires_at_ms: claim.expires_at,
                  signature: claim.signature,
                },
                gas: "100000000000000",
                deposit: (5n * 10n ** 22n).toString(),
              },
            },
          ],
        },
        { playerId: player!.id },
      );
    }
    for (let attempt = 0; attempt < 5; attempt++) {
      const result = await api<{ claim: NativeAuraClaim; player: Player }>(
        "/native/claims/confirm",
        { itemId: item.id },
      );
      updateOwnedPlayer(result.player);
      if (result.claim.state === "minted") return true;
      await new Promise((resolve) => setTimeout(resolve, 800));
    }
    return false;
  }
  /**
   * Lists a secured Aura for sale. NEAR Intents is the default market: the
   * device key lists the Aura there. Only a host without a deployed verifier
   * falls back to the market contract.
   */
  async function listSecuredAura(
    accountId: string,
    tokenId: string,
    priceYocto: string,
  ): Promise<boolean> {
    if (orderSigner?.key && orderSigner.accountId === accountId) {
      // Loaded on demand to keep the first bundle small.
      const { sellAuraOnIntents } = await import("./intents-order");
      const viaIntents = await action("intents-sell", () =>
        sellAuraOnIntents(orderSigner, tokenId, priceYocto),
      );
      if (viaIntents === undefined) return false;
      if (viaIntents === "listed") {
        await me();
        notify(tr("Your Aura is on sale. Find it in Shop → Market."));
        return true;
      }
    }
    const market = await api<NativeMarketState>("/native/market");
    if (!market.marketContract) return false;
    const listed = await tradeNative({
      kind: "list",
      accountId,
      marketId: market.marketContract,
      nftContractId: market.nftContract,
      tokenId,
      price: priceYocto,
    });
    if (listed) {
      await me();
      notify(tr("Your Aura is on sale. Find it in Shop → Market."));
    }
    return listed;
  }
  async function mintEarnedAura(item: Item): Promise<boolean> {
    const done = await action("native-claim", async () => {
      try {
        const { signer, accountId } = await resolveSigner();
        if (!player?.wallets.some((w) => w.account_id === accountId))
          throw Error("Choose the linked account that receives this Aura.");
        const minted = await secureAuraOnChain(item, signer, accountId);
        if (!minted)
          throw Error(
            "Your Aura is still being secured. Use Check claim before retrying.",
          );
        await refreshNative(true);
        notify(tr("Your Aura is secured. Try it on from your Secured collection."));
        return true;
      } finally {
        await me();
      }
    });
    return done === true;
  }
  async function checkAuraClaim(item: Item) {
    await action("native-claim-check", async () => {
      const result = await api<{ claim: NativeAuraClaim; player: Player }>(
        "/native/claims/confirm",
        { itemId: item.id },
      );
      updateOwnedPlayer(result.player);
      await refreshNative(true);
      notify(
        result.claim.state === "minted"
          ? tr("Your Aura is secured.")
          : tr("Not secured yet. Finish the claim, or restore the practice Aura after it expires."),
      );
    });
  }
  async function restoreDemoAura(item: Item) {
    await action("native-claim-restore", async () => {
      const result = await api<{ player: Player }>("/native/claims/restore", {
        itemId: item.id,
      });
      updateOwnedPlayer(result.player);
      notify(tr("Your Aura is back in your practice collection."));
    });
  }
  async function nativeTransaction(
    method: "mint_avatar" | "equip_aura" | "unequip_aura",
    account: string,
    item?: NativeItem,
    slot?: "above" | "below",
  ) {
    await action("native-transaction", async () => {
      const { signer, accountId } = await resolveSigner(account);
      if (
        accountId !== account ||
        !player?.wallets.some((w) => w.account_id === accountId)
      )
        throw Error("Choose the linked account that owns this Aura.");
      const contractId = nativeWardrobe?.contractId;
      if (!onNearNetwork(contractId))
        throw Error(
          "Your secured collection could not load. Try again in a moment.",
        );
      await signer.send(
        {
          network: NEAR_NETWORK,
          signerId: accountId,
          receiverId: contractId,
          actions: [
            {
              type: "FunctionCall",
              params: {
                methodName: method,
                args:
                  method === "mint_avatar"
                    ? {}
                    : method === "unequip_aura"
                      ? { slot }
                      : { token_id: item!.tokenId, slot },
                gas: "100000000000000",
                deposit:
                  method === "mint_avatar" ? (5n * 10n ** 22n).toString() : "0",
              },
            },
          ],
        },
        { playerId: player!.id },
      );
      let confirmed = false;
      for (let attempt = 0; attempt < 5; attempt++) {
        const data = await refreshNative(true),
          state = data.accounts.find((a) => a.accountId === accountId);
        confirmed =
          method === "mint_avatar"
            ? !!state?.starterOwned
            : method === "unequip_aura"
              ? state?.equipment[slot!] === null
              : state?.equipment[slot!] === item!.tokenId;
        if (confirmed) break;
        await new Promise((resolve) => setTimeout(resolve, 800));
      }
      if (!confirmed)
        throw Error(
          "Sent. Confirmation is still pending; refresh your Secured collection before retrying.",
        );
      const r = await api<{ player: Player }>("/native/outfit", {
        enabled: true,
        accountId,
      });
      updateOwnedPlayer(r.player);
      notify(
        method === "mint_avatar"
          ? tr("Your explorer is secured.")
          : method === "unequip_aura"
            ? tr("Aura taken off your secured outfit.")
            : tr("Equipped. Your secured Aura is glowing on the map."),
      );
    });
  }
  async function connectEvm() {
    await action("evm", async () => {
      const injected = (window as any).ethereum;
      if (!injected)
        throw new Error(
          tr("Open QuestLayer in a browser with an Aavegotchi wallet to link an original."),
        );
      const { createWalletClient, custom } = await import("viem");
      const client = createWalletClient({ transport: custom(injected) });
      const [address] = await client.requestAddresses();
      const c = await api<{ challengeId: string; message: string }>(
        "/evm/challenge",
        { address },
      );
      const signature = await client.signMessage({
        account: address,
        message: c.message,
      });
      await api("/evm/verify", { challengeId: c.challengeId, signature });
      await api("/aavegotchi");
      notify(
        tr("Address linked. Your originals stay where they are; here you only wear them."),
      );
    });
  }
  function inspectAdventureResult(id: string, intent: "reward" | "share" = "reward") {
    setRewardIntent(intent);
    setRewardNote("");
    setToast(null);
    void adventureResults.inspect(id);
    void me();
  }
  async function equipAdventureResult(result: AdventureResult) {
    const owner = player?.id;
    const realm = arena;
    const inspection = adventureResults.inspectionVersion();
    const navigationRevision = navigationContext.current.revision;
    if (
      !player ||
      nativePlay ||
      !online ||
      !adventureResults.selection?.fresh ||
      adventureResults.selection.result?.id !== result.id ||
      !adventureItemForEquip(result, player, realm ? "arena" : "gps")
    )
      return;
    await action("equip", async () => {
      let response: { player: Player };
      try {
        response = await api<{ player: Player }>("/equip", {
          itemId: result.reward!.item!.id,
          desiredEquipped: true,
        });
      } catch (e) {
        if (
          latest.current.player?.id === owner &&
          latest.current.arena === realm &&
          !latest.current.nativePlay &&
          adventureResults.isCurrentInspection(inspection) &&
          navigationContext.current.revision === navigationRevision
        ) {
          await Promise.allSettled([adventureResults.inspect(result.id), me()]);
          throw e;
        }
        return;
      }
      if (latest.current.player?.id !== owner) return;
      updateOwnedPlayer(response.player);
      if (latest.current.arena !== realm || latest.current.nativePlay) return;
      if (
        !adventureResults.isCurrentInspection(inspection) ||
        navigationContext.current.revision !== navigationRevision
      )
        return;
      const confirmed = response.player.inventory.find(
        (item) => item.id === result.reward?.item?.id,
      );
      if (!confirmed?.equipped || response.player.nativeOutfit)
        throw new Error(
          tr("Outfit change not confirmed yet. Check your collection before retrying."),
        );
      adventureResults.close();
      setSelected(null);
      setSheetExpanded(false);
      setFollow(true);
      setTab("explore");
      notify(tr("Equipped. Your new glow is on the map."));
    });
  }
  async function complete(qId: string) {
    const owner = player?.id;
    const realm = arena;
    const inspection = adventureResults.inspectionVersion();
    const navigationRevision = navigationContext.current.revision;
    await action("quest", async () => {
      try {
        const q = world?.quests.find((x) => x.id === qId);
        const r = await api<{
          player: Player;
          reward: number;
          xp: number;
          item: Item | null;
          result?: AdventureResult;
          replayed?: boolean;
          awaiting?: boolean;
          clue?: { correct: boolean; xp: number; answer: string };
          progress?: { completed: number; total: number };
          chain?: ChainRef | null;
        }>(
          q?.kind === "route" && (q.checkpoint || 0) < (q.checkpointCount || 0)
            ? "/quests/checkpoint"
            : "/quests/claim",
          {
            questId: qId,
            checkpoint: q?.checkpoint || 0,
            ...(q?.clue ? { answer: clueChoice[qId] } : {}),
            fix: arena
              ? { ...position, accuracy: 0, timestamp: Date.now() }
              : fix,
          },
        );
        if (latest.current.player?.id !== owner) return;
        updateOwnedPlayer(r.player);
        if (q) learning.acknowledge(questHelpTopic(q));
        if (latest.current.arena !== realm || latest.current.nativePlay) return;
        const sameView =
          adventureResults.isCurrentInspection(inspection) &&
          navigationContext.current.revision === navigationRevision;
        if (sameView && r.result) {
          setRewardIntent("reward");
          setRewardNote(r.clue ? r.clue.correct ? tr("Right answer: +{0} XP.", {0:r.xp}) : tr("Visit counted: +{0} XP. The right answer is now marked.", {0:r.xp}) : "");
          setToast(null);
          setSheetExpanded(false);
          adventureResults.accept(r.result);
        }
        if (!r.replayed && !r.awaiting) cue(r.item ? "reward" : "step");
        if (!r.replayed && (!r.result || !sameView))
          burst(
            r.awaiting
              ? {
                  tone: "quest",
                  title: tr("Stop {0} of {1}", { 0: r.progress?.completed, 1: r.progress?.total }),
                  detail: q?.title,
                }
              : {
                  tone: "quest",
                  chain: r.chain,
                  title: tr("Quest complete!"),
                  detail: [
                    `+${r.xp} XP`,
                    r.reward ? `+${gold(r.reward, 6)} QGOLD` : "",
                    r.item?.name || "",
                  ]
                    .filter(Boolean)
                    .join(" · "),
                },
          );
        if (sameView && r.awaiting)
          notify(
            tr("Stop {0} of {1} confirmed. Walk to the next stop.", { 0: r.progress?.completed, 1: r.progress?.total }),
          );
        else if (sameView && !r.replayed && !r.result && r.clue)
          notify(
            r.clue.correct
              ? tr("Right answer: +{0} XP.", { 0: r.xp })
              : tr("Visit counted: +{0} XP. The right answer is now marked.", { 0: r.xp }),
          );
        else if (sameView && !r.replayed && !r.result)
          notify(
            r.item
              ? tr("Reward collected: {0} is yours. Try it on!", { 0: r.item.name })
              : tr("Reward collected: +{0} XP{1}.", { 0: r.xp, 1: r.reward ? ` and ${gold(r.reward, 6)} QGOLD` : "" }),
          );
        else if (sameView) setToast(null);
        await refreshWorld();
        // A finished NPC line: say whom to report to (their map sign is on).
        if (!r.replayed && !r.awaiting) {
          const text = (await guide()).reportNote(await loadNpcTasks(), qId);
          if (text && latest.current.player?.id === owner) {
            if (sameView && r.result) setRewardNote((note) => [note, text].filter(Boolean).join(" "));
            else notify(text);
          }
        }
      } catch (error) {
        if (
          latest.current.player?.id === owner &&
          latest.current.arena === realm &&
          !latest.current.nativePlay &&
          adventureResults.isCurrentInspection(inspection) &&
          navigationContext.current.revision === navigationRevision
        )
          throw error;
      } finally {
        // A lost HTTP response may follow a committed award. Recovery only reads
        // the actor's receipts; it never retries a claim or replays its reveal.
        void adventureResults.refresh();
      }
    });
  }

  const activeNative = nativeWardrobe?.accounts.find(
    (a) => a.accountId === player?.nativeAccount,
  );
  const nativeAppearance = nativeAppearanceItems(activeNative);
  const appearanceItems = player?.nativeOutfit
    ? nativeAppearance
    : player?.inventory || [];
  const equipped = appearanceItems.filter((x) => !!x.equipped);
  const zonePresence = !nativePlay && online ? currentZone(world, position, fix, arena, player?.tier || 1, now) : null;
  // Entering a zone above the player's tier opens the locked-zone dialog once
  // per visit (src/LockedZone.tsx); leaving and coming back shows it again.
  const lockedHereId = zonePresence?.state === "locked" ? zonePresence.zone.id : null;
  const [lockedZoneDialog, setLockedZoneDialog] = useState<Zone | null>(null);
  // The tour's vote step: the treasury vote opens right here, no NPC to walk to.
  const [treasuryVoteOpen, setTreasuryVoteOpen] = useState(false);
  const lockedShown = useRef<string | null>(null);
  useEffect(() => {
    if (lockedHereId === lockedShown.current) return;
    lockedShown.current = lockedHereId;
    const zone = lockedHereId ? world?.zones.find((z) => z.id === lockedHereId) : null;
    if (zone) setLockedZoneDialog(zone);
  }, [lockedHereId, world]);
  const recommendation = world
    ? nearestDiscovery({
        position,
        quests: world.quests,
        zones: world.zones,
        coins: world.coins,
        tier: player?.tier || 1,
        now,
        questPoint,
      })
    : null;
  const recommended =
    recommendation?.kind === "quest" ? recommendation.quest : undefined;
  const recommendedZone =
    recommendation?.kind === "quest" ? recommendation.zone : undefined;
  const recommendedFind =
    recommendation?.kind === "find" ? recommendation : null;
  const findTarget =
    !nativePlay && streetFindTarget
      ? world?.coins.find((c) => c.id === streetFindTarget && c.find) || null
      : null;
  // The guided tour replaces the first-steps coach while it runs.
  const coachActive = !tourRunning && learning.state.enabled && firstSession.visible && firstSession.progress.current?.id !== "secure" && !nativePlay && !world?.globalPreparation;
  const coachStep = coachActive ? firstSession.progress.current?.id : undefined;
  const movementTopic: HelpTopic = arena ? "movement-arena" : "movement-gps";
  const coachTopic: HelpTopic = coachStep === "find" && !learning.state.seen[movementTopic] ? movementTopic
    : coachStep === "aura" ? "aura" : coachStep === "chest" ? "chest" : coachStep === "coin" ? "coin" : "find";
  const coachChest = coachStep === "chest" ? nearestChest() : null;
  const coachLabel =
    coachStep === "chest"
      ? coachChest
        ? coachChest.d > 25
          ? tr("Walk to the chest")
          : tr("Open the chest")
        : tr("See what's open")
      : coachStep === "find" && !nearestCoin(true)
        ? tr("Walk to a coin")
        : null;
  // Outside the reviewed city (H3 street cells, auto cities) the coach and
  // the map point at the nearest open POI quest, or say honestly when quests
  // open later today or this area has none.
  const poiWorld =
    !!world && !nativePlay && (!!world.poiQuests || world.cityStatus === "auto");
  const poiOutlook =
    poiWorld && world
      ? poiQuestOutlook({
          position,
          quests: world.quests,
          zones: world.zones,
          tier: player?.tier || 1,
          now,
          emptyCell: world.poiQuests?.status === "empty",
          questPoint,
        })
      : null;
  const poiNext = poiOutlook?.state === "open" ? poiOutlook.nearest : null;
  const coachAside =
    !coachActive || !poiOutlook ? null : poiNext ? (
      coachStep === "chest" &&
      coachChest?.quest.id === poiNext.quest.id ? null : (
        <button
          className="first-session-next"
          onClick={() => startQuest(poiNext.quest)}
        >
          <MapPin size={18} aria-hidden="true" />
          <span>
            <small>{tr("Nearest quest")}</small>
            <strong>{poiNext.quest.title}</strong>
            <span>{distanceLabel(poiNext.distance)}</span>
          </span>
          <ArrowRight size={18} aria-hidden="true" />
        </button>
      )
    ) : (
      <p className="first-session-note" role="status">
        {poiOutlook.state === "later"
          ? tr("Quests here open at {0}. Street coins count already.", { 0: new Date(poiOutlook.opensAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: world?.timezone || undefined }) })
          : poiOutlook.state === "empty"
            ? tr("No quests in this spot today. Street coins still count; quests wait near parks, squares and landmarks.")
            : tr("You've done every quest here today. New ones open tomorrow.")}
      </p>
    );
  // The map marks one "next" place: the coach's POI quest, else the nearest
  // recommended zone.
  const nextZoneId = coachActive
    ? coachStep === "chest" && coachChest
      ? coachChest.zone.id
      : poiNext?.zone.id || null
    : recommendedZone?.id || null;
  const zoneQuests = questsInZone(world?.quests || [], selected);
  const browsing = sheetExpanded && catalogView?.scope === `${player?.id}:${world?.id}` ? catalogView : null;
  const detailZone = browsing ? world?.zones.find(z => z.id === browsing.zoneId) || null : selected;
  const detailQuests = questsInZone(world?.quests || [], detailZone);
  // The zone dialog is a list of one-tap rows; a quest opens only when it
  // was chosen (the player is there to confirm it, or it is not playable now).
  const detailQuest = detailQuests.find(q => q.id === (browsing ? browsing.questId : selectedQuestId));
  const zoneQuest =
    zoneQuests.find((q) => q.id === selectedQuestId) ||
    zoneQuests.find(
      (q) => !q.completed && q.opens_at <= now && q.closes_at > now,
    ) ||
    zoneQuests[0];
  const selectedRequirement = zoneQuest && selected ? activityRequirement(zoneQuest, selected, position, now, arena, fix, online) : null;
  // The distance on the chip already says "too far"; no sentence for it.
  const farRequirement = !!zoneQuest && meters(position, questTarget(zoneQuest, position)) > 25;
  const questRoute =
    world && !nativePlay
      ? activeQuestRoute(world.quests, {
          position,
          now,
          questId: demoTarget?.questId || selectedQuestId,
          zoneId: selected?.id,
        })
      : null;
  const mapFullOn = mapFull && tab === "explore" && !sheetExpanded && !globe;
  const mapVisible = tab === "explore";
  const wearableReady = !!wearableMoment && wearableMoment.scope === demoPickupScope(player?.id, world?.id, arena) && !nativePlay;
  const showWearableMoment = wearableReady && mapVisible && !introOpen && !sheetExpanded && !actorOpen && !showNpc && !discovery && !findInspect;
  const mapInteractive = mapVisible && !introOpen && !sheetExpanded && !actorOpen && !showNpc && !showWearableMoment && !(findInspect && findInspect.worldId === world?.id);
  const objective = mapObjective({
    selection: !!selected,
    native: !!nativeObjective.reference,
    receipt: !nativePlay && !!adventureResults.unread,
    notice: !!adventureNotice,
    coach: coachActive,
    // Street finds and quests of the map-coin day show only on that ledger;
    // otherwise the folded card stayed as an empty bar on the map.
    find: !nativePlay && !!recommendedFind,
    quest: !nativePlay && !!recommended && !!recommendedZone,
  });
  const showObjective = (kind: typeof objective) => !sheetExpanded && objective === kind;
  const closeMapPanel = () => { setCatalogView(null); setSheetExpanded(false); };
  function openDiscoveries() {
    setMapFull(false); setDismissedObjective("");
    if (nativePlay) { setTab("expeditions"); return; }
    setCatalogView({ scope: `${player?.id}:${world?.id}`, zoneId: null, questId: null });
    setTab("explore"); setSheetExpanded(true);
  }
  function chooseMapRotate(next: boolean) {
    setMapRotate(next);
    try {
      localStorage.setItem("questlayer.mapRotate", next ? "1" : "0");
    } catch {
      /* private mode: the choice lasts for this visit */
    }
  }
  const clearMarketForm = () => setMarketForm("");
  const openNearbyForm = (form: "task" | "secret") => {
    setMapFull(false);
    setSelected(null);
    setTab("explore");
    setNearbyFilter("community");
    setSheetExpanded(true);
    setMarketForm(form);
  };
  // Guided tour (docs/GUIDED-TOUR.md): where a step points, and how to open it.
  const TOUR_COMPANION = "seed-p-ondra";
  const TOUR_ACTORS: Record<string, string[]> = { "quest-giver": ["quest_giver"], monster: ["roamer", "guardian", "boss"], trader: ["trader"], keeper: ["keeper"] };
  function tourQuest(kind: string) {
    let best: Quest | null = null;
    for (const q of world?.quests || []) {
      if (q.completed || q.kind !== kind || q.opens_at > now || q.closes_at <= now) continue;
      if (!best || meters(position, questPoint(q)) < meters(position, questPoint(best))) best = q;
    }
    return best;
  }
  function tourResolve(t: TourTarget) {
    if (t.kind === "coin" || t.kind === "find") {
      const c = nearestCoin(t.kind === "find");
      return c ? { lat: c.lat, lng: c.lng, label: t.kind === "find" ? tr("Street find") : undefined } : null;
    }
    if (t.kind === "quest") {
      const q = tourQuest(t.quest);
      return q ? { ...questPoint(q), label: questDisplayTitle(q.title) } : null;
    }
    // Characters walk: "Show me" focuses the map on the nearest one instead of a fixed arrow.
    return null;
  }
  function tourGo(t: TourTarget) {
    if (t.kind === "coin" || t.kind === "find") {
      const c = nearestCoin(t.kind === "find");
      if (c) goToStreetFind(c);
      else notify(t.kind === "find" ? tr("No street find is left near you today.") : tr("No coin is left near you right now. More appear in the next wave."), true);
    } else if (t.kind === "quest") {
      const q = tourQuest(t.quest);
      if (q) guideToQuest(q);
      else void showGoal("quest");
    } else if (t.kind === "actor") {
      // The walking companion bot of the Test Layer (server/test-seed): its card has Wave and Message.
      if (t.role === "companion") setCardPlayer(TOUR_COMPANION);
      else if (TOUR_ACTORS[t.role]) {
        setTab("explore");
        showActor({ kinds: TOUR_ACTORS[t.role] }, t.role === "keeper");
      }
      else { setTab("community"); setSheetExpanded(true); }
    } else if (t.kind === "screen" && t.screen === "treasury") {
      setTreasuryVoteOpen(true);
    } else if (t.kind === "screen") {
      const tabs: Record<string, Tab> = { inventory: "inventory", rolls: "inventory", market: "market", shop: "shop", stake: "fund" };
      setTab(tabs[t.screen] || "explore");
      setSheetExpanded(true);
      // The wisp roll sits in Inventory's "Secured on NEAR" fold: open it and scroll there.
      if (t.screen === "rolls")
        window.setTimeout(() => {
          const rolls = document.querySelector<HTMLElement>(".wisp-rolls");
          const fold = rolls?.closest("details");
          if (fold) fold.open = true;
          rolls?.scrollIntoView({ behavior: "smooth", block: "center" });
        }, 600);
    } else if (t.kind === "action") {
      if (t.action === "task") openNearbyForm("task");
      else if (t.action === "note" || t.action === "topic" || t.action === "shout") setQuickCreate(t.action);
    }
  }
  const mapActions: MapAction[] = [
    { id: "note", label: tr("Leave a note"), icon: NotePencil, onSelect: () => setQuickCreate("note") },
    { id: "topic", label: tr("Open a topic"), icon: ChatsCircle, onSelect: () => setQuickCreate("topic") },
    { id: "place", label: tr("Add a place"), icon: MapPin, onSelect: () => setQuickCreate("place") },
    { id: "mood", label: tr("Change mood"), icon: Smiley, onSelect: () => setEmotePicker(true) },
    ...(!nativePlay
      ? [
          { id: "task", label: tr("Post a task"), icon: ClipboardText, onSelect: () => openNearbyForm("task") },
          { id: "secret", label: tr("Hide a Secret"), icon: LockKey, onSelect: () => openNearbyForm("secret") },
        ]
      : []),
    ...(creatorsEnabled
      ? [{ id: "quest", label: tr("Create a quest"), icon: MapPinPlus, onSelect: () => { setTab("community"); setCreatorView({ page: "edit", questId: null }); setSheetExpanded(true); } }]
      : []),
  ];
  const near = !nativePlay ? nearbyAction({world:world || null, position, tier:player?.tier || 1, now,
    actors:nearActors.worldId === world?.id && Date.now()-nearActors.at<3000 ? nearActors.actors : [],
    preferredQuestId:selectedQuestId}) : null;
  const nearName = near?.kind === "actor" ? near.actor.name : near?.kind === "quest" ? questDisplayTitle(near.quest.title) : near?.coin.wearable?.name || tr("Street find");
  const objectiveKey = [objective, selected?.id, selectedQuestId, nativeObjective.reference?.kind, nativeObjective.reference?.index, nativeObjective.reference?.dayId, nativeObjective.view.status, adventureResults.unread?.id, coachStep || "done", recommended?.id, recommendedFind?.coin.id].join(":");
  const showNearby = !!near && canOfferNearbyAction(objective, coachStep, dismissedObjective === objectiveKey, !!zoneQuest && (selectedQuestId === zoneQuest.id || startedQuestKey === `${player?.id}:${world?.id}:${zoneQuest.id}`), near.kind === "quest" && near.quest.id === zoneQuest?.id);
  const compactHidden = tab === "explore" && !sheetExpanded && (showNearby || objective === "empty" || dismissedObjective === objectiveKey);
  // One helper switch in Settings: Pip where the tour runs, and with it the
  // older first-time tips, so "off" means no hints at all (Lubos, 13 Nov 2026).
  function chooseGuide(on: boolean) {
    learning.enable(on);
    if (on && !gameLayer?.tour) {
      setDismissedObjective("");
      firstSession.show();
    }
    if (!gameLayer?.tour) return;
    setPipHidden(!on);
    void api("/tour", { action: on ? "show" : "hide" })
      .then(() => window.dispatchEvent(new Event("questlayer:tour-refresh")))
      .catch(() => setPipHidden(on));
  }
  // Map controls are the first part of Settings; each one returns to the map.
  const backToMap = () => {
    setTab("explore");
    setSheetExpanded(false);
  };
  const settingsMap: SettingsMap = {
    demo: arena && !nativePlay,
    status:
      nativePlay && arena
        ? tr("Turn on location")
        : arena
          ? tr("City demo")
          : `GPS ±${fix ? Math.round(fix.accuracy) : "…"} m`,
    modeLabel: arena || nativePlay ? tr("Use GPS") : tr("Demo"),
    modeAria: arena || nativePlay ? tr("Use GPS, my location") : tr("Demo, back to city demo"),
    onModeSwitch: () => {
      backToMap();
      void (arena || nativePlay ? locate() : returnToArena());
    },
    onLocate: () => {
      backToMap();
      setFollow(true);
      setOverview(false);
      setGlobe(false);
      if (!arena || nativePlay) void locate();
      else setPosition((p) => ({ ...p }));
    },
    rotate: mapRotate,
    onRotate: chooseMapRotate,
    onFull: () => {
      backToMap();
      setMapFull((v) => !v);
      // The camera re-centres the explorer in the bigger view.
      requestAnimationFrame(() => window.dispatchEvent(new Event("resize")));
    },
    overview,
    onOverview: () => {
      backToMap();
      setOverview((v) => !v);
      setGlobe(false);
      setFollow(false);
      setSelected(null);
    },
    globe,
    onGlobe: () => {
      backToMap();
      if (!globe) setSelected(null);
      setGlobe((v) => !v);
      setOverview(false);
      setFollow(true);
    },
  };
  const title =
    tab === "explore"
      ? nativePlay
        ? tr("Nearby walks")
        : tr("Nearby")
      : tab === "settings" || tab === "fuel" || tab === "wallet"
        ? settingsOpen
          ? tr("Settings")
          : tr("Profile")
        : showCommunityTabs
          ? tr("Community")
          : nav.find((n) => n.id === tab)?.label ||
        {
          shop: tr("Inventory"),
          fund: tr("Game economy"),
          funding: tr("How rewards are funded"),
          layer: virtualLayer?.name ?? tr("Layer"),
          expeditions: tr("Nearby walks"),
          inventory: tr("Inventory"),
          market: tr("Inventory"),
        }[tab] ||
        "QuestLayer";
  const nearbyHome = tab === "explore" && !detailZone && !nativePlay;
  // One stake form in three places: Profile → Stake, Game economy and the Gate Keeper's dialog.
  const explorerId = invisible.status === "ready" ? invisible.accountId || "" : "";
  const stakeProps = player && {
    player,
    account: explorerId || player.wallets[0]?.account_id || "",
    managed: !!explorerId,
    explorerStatus: invisible.status,
    onLinkWallet: () => connectNear(),
    onTransaction: operateNativeVault,
  };
  return (
    <div
      className={`app-shell${player && tab !== "explore" ? " sheet-open" : ""}${player && mapFullOn ? " map-full" : ""}${player && !hudReady ? " hud-loading" : ""}`}
      data-screen={tab}
      data-target={player && tab === "explore" && !sheetExpanded ? (selected ? "quest" : pointTarget ? "point" : undefined) : undefined}
      data-area={showProfileTabs ? "profile" : showCommunityTabs ? "community" : undefined}
    >
      <div className="map-stage" inert={!!player && !mapInteractive} aria-hidden={!!player && !mapVisible}>
      {player ? (
        <GameMap
          active={mapInteractive}
          playerTier={
            nativePlay ? nativeGame.state?.access?.tier : player?.tier
          }
          now={now}
          map3D={!!player && map3D}
          sheetExpanded={sheetExpanded}
          panelMode={tab}
          onCoin={
            nativePlay
              ? (id) => {
                  const coin = nativeGame.state?.day?.coins.find(
                    (c) => `native-coin:${c.index}` === id,
                  );
                  if (!coin) return;
                  nativeObjective.select("coin", coin.index);
                  setTab("expeditions");
                  setSheetExpanded(true);
                  setFollow(false);
                }
              : undefined
          }
          onQuest={(id) =>
            nativePlay
              ? chooseNativeQuest(Number(id.split(":")[1]))
              : chooseZoneQuest(id)
          }
          overview={overview}
          focusZone={selected}
          nextZoneId={selected ? null : nextZoneId}
          insideZoneId={zonePresence?.state === "ready" && zonePresence.count > 0 ? zonePresence.zone.id : null}
          nativeTarget={
            nativeTarget ||
            (communityGoal?.points[0]
              ? { ...communityGoal.points[0], label: communityGoal.title }
              : null) ||
            (findTarget
              ? {
                  lat: findTarget.lat,
                  lng: findTarget.lng,
                  label: tr("Street find · +{0} XP", { 0: world?.streetFindXp ?? 15 }),
                }
              : null)
          }
          nativeTargetKind={
            nativePlay
              ? nativeObjective.reference?.kind === "coin"
                ? "coin"
                : "route"
              : "discovery"
          }
          world={displayWorld}
          position={position}
          arena={arena && !nativePlay}
          globe={globe}
          equipped={equipped}
          others={others}
          onPlayer={(id) =>
            setCardPlayer(id)
          }
          onSelf={() => player && setCardPlayer(player.id)}
          wearables={nativePlay ? undefined : player?.wearables}
          onWearableFind={(id) => {
            const coin = world?.coins.find((c) => c.id === id);
            if (coin && world) setFindInspect({worldId:world.id,coin});
          }}
          skinUrl={
            player?.appearance?.originTokenId
              ? `/api/aavegotchi/skin?tokenId=${encodeURIComponent(player.appearance.originTokenId)}${player.appearance.look ? `&v=${encodeURIComponent(player.appearance.look)}` : ""}`
              : undefined
          }
          facing={
            arena && !nativePlay ? demoWalk.heading : (gpsCourse ?? undefined)
          }
          followBearing={!mapRotate ? undefined : arena && !nativePlay ? demoWalk.engaged ? demoWalk.heading : undefined : gpsCourse ?? undefined}
          onZone={(z) =>
            nativePlay
              ? chooseNativeQuest(Number(z.id.split(":zone:")[1]))
              : selectZone(z)
          }
          follow={follow}
          onPan={() => { gpsResumeOnMovement.current = false; setFollow(false); }}
          onMoveEnd={(center, zoom) => setMapCenter(zoom >= 13 ? center : null)}
          // Only game elements sit on the map. Community quests, player tasks
          // and Secrets are reached from the Community button and Nearby.
          creatorPlaces={MAP_DIALOG_PINS ? creatorPlaces : []}
          onCreatorPlace={(questId) => {
            setTab("community");
            setCreatorView({ page: "quest", questId });
            setSheetExpanded(true);
            setFollow(false);
          }}
          actorsWorldId={world?.id || null}
          onActor={setActorOpen}
          onNearbyActors={(worldId, actors) => setNearActors({worldId,actors,at:Date.now()})}
          emote={myEmote && myEmote.until > now ? myEmote.id : null}
          frame={myFrame}
          goldMap={goldMapData}
          selectedQuestId={selectedQuestId}
          guideRequest={guideRequest && guideRequest.worldId === world?.id && guideRequest.playerId === player?.id && selected && zoneQuest?.id === guideRequest.questId && zoneQuests.some(q => q.id === guideRequest.questId && !q.completed && q.opens_at <= now && q.closes_at > now) ? guideRequest : null}
          route={questRoute}
          onPlacePin={(id) => {
            setPlaceOpenId(id);
            setTab("messages");
            setSheetExpanded(true);
          }}
          notes={mapNotes}
          onNotePin={(id) => {
            setNoteOpenId(id);
            setNotesView("browse");
            setTab("messages");
            setSheetExpanded(true);
          }}
          actorReports={npcTasks && npcTasks.worldId === world?.id ? npcTasks.tasks.filter((t) => t.ready).map((t) => t.actorId) : []}
          actorFocus={actorFocus}
          pointTarget={pointTarget}
          onActorFocus={(text, found) => {
            if (!found && actorMissing.current) {
              setTab("fund");
              setSheetExpanded(true);
            } else notify(text, !found);
          }}
          marketPins={MAP_DIALOG_PINS && !!player && !arena && !nativePlay}
          onMarketPin={() => {
            setTab("explore");
            setNearbyFilter("community");
            setSheetExpanded(true);
            setFollow(false);
          }}
        />
      ) : (
        // MapLibre and the map style load only after the name step, so the
        // welcome screen ships without them (see scripts/check-bundle-budget.mjs).
        <div className="game-map map-placeholder" aria-hidden="true" />
      )}
      <div className="map-vignette" />
      </div>
      {player && hudReady && (<>
      <aside className="nav-rail">
        <div className="rail-links">
          {nav.filter((n) => n.id !== "settings").map((n) => (
            <button
              key={n.id}
              className={navigationActive(tab, n.id) ? "active" : ""}
              aria-current={navigationActive(tab, n.id) ? "page" : undefined}
              onClick={() => {
                if (n.id === "explore") openDiscoveries();
                else setTab(n.id);
              }}
              aria-label={n.label}
              title={n.label}
            >
              <n.icon
                size={25}
                weight={navigationActive(tab, n.id) ? "fill" : "regular"}
              />
              <span>{n.label}</span>
            </button>
          ))}
        </div>
      </aside>
      <header className="topbar">
        {virtualLayer && player && (
          <WorldSwitcher virtual={tab === "layer"} enabled layerName={virtualLayer.name} gameLayer={gameLayer} onChoose={(virtual) => { setTab(virtual ? "layer" : "explore"); setSheetExpanded(false); }} />
        )}
        {player && (
          <div className="hud-left">
            {!virtualLayer && (
              <button
                className="hud-brand"
                aria-label={tr("QuestLayer home")}
                onClick={() => setTab("explore")}
              >
                <BrandLogo />
              </button>
            )}
            <DailyBoard
              worldId={world?.id}
              refreshKey={`${player.xp}:${player.history?.[0]?.id ?? ""}`}
              onClaimed={() => void me()}
              onGoal={showGoal}
            />
          </div>
        )}
        <div className="topbar-right">
          {player && (
            <>
              <span id="hud-sky-slot" className="hud-sky-slot" />
              <div className="hud-bubble">
                <button
                  className="profile-pill"
                  onClick={() => chooseProfileTab("character")}
                >
                  <span className="sr-only">{tr("Profile")}</span>
                  {hudProgress ? (
                    <HudXpRing
                      name={player.name}
                      level={hudProgress.level}
                      xp={hudProgress.xp}
                      levelStartXp={hudProgress.levelStartXp}
                      nextLevelXp={hudProgress.nextLevelXp}
                      ring={hudProgress.ring}
                    >
                      <Character
                        items={appearanceItems}
                        // originTokenId and look (outfit tag) of the worn original.
                      {...player.appearance}
                        compact
                      />
                      <span className="sr-only">{tr(", explorer profile")}</span>
                    </HudXpRing>
                  ) : (
                    <>
                      <Character
                        items={appearanceItems}
                        // originTokenId and look (outfit tag) of the worn original.
                      {...player.appearance}
                        compact
                      />
                      <span>
                        <b>{player.name}</b>
                        <small>{tr("Explorer")}</small>
                      </span>
                    </>
                  )}
                </button>
                <button
                  className="balance-pill"
                  onClick={() => {
                    setWalletView(nativePlay ? "rewards" : "demo");
                    setTab("fuel");
                  }}
                >
                  <CoinIcon />
                  <b>
                    {nativePlay
                      ? nativeGame.state?.balance
                        ? goldFromYocto(nativeGame.state.balance.credit)
                        : "—"
                      : wallet
                        ? wallet.realm === "qgold" && wallet.balanceKnown === false
                          ? "…"
                          : gold(wallet.balanceU)
                        : "…"}
                  </b>
                  <span>QGOLD</span>
                </button>
              </div>
              <MapSettings demo={arena && !nativePlay} open={settingsOpen} onOpen={() => chooseProfileTab("settings")} />
            </>
          )}
        </div>
      </header>
      </>)}
      {player && zonePresence && !selected && mapInteractive && !mapFullOn && <ZonePresence presence={zonePresence} arena={arena} onOpen={() => { const q = world?.quests.find(x => x.id === zonePresence.questId); if (q) startQuest(q); else selectZone(zonePresence.zone); }} />}
      {player && tab !== "explore" && (
        // Desktop: Inventory, Community and Profile open as a card over the
        // map; a click beside the card closes it like the panel's close button.
        <div className="sheet-backdrop" aria-hidden="true" onClick={returnToAdventure} />
      )}
      {player && (
        <MapSurface overlay={tab === "explore" && sheetExpanded} label={detailZone?.name || title} onClose={closeMapPanel}>
        <main
          hidden={compactHidden}
          ref={mainPanel}
          tabIndex={-1}
          className={`main-panel ${tab === "explore" ? `explore-panel ${selected ? "zone-explore-panel" : ""} ${sheetExpanded ? "sheet-expanded" : "sheet-compact"}` : ""}`}
        >
          {tab === "layer" && virtualLayer && <Layer key={player.id} player={player} items={equipped} layer={virtualLayer} onExit={() => setTab("explore")} />}
          {tab === "explore" && !sheetExpanded && <div className="objective-dismiss-bar">
            <button className="objective-dismiss" aria-label={tr("Hide objective")} onClick={() => { if (objective === "coach") learning.acknowledge(coachTopic); else if (zoneQuest) learning.acknowledge(questHelpTopic(zoneQuest)); setDismissedObjective(objectiveKey); }}><X size={20} aria-hidden="true" /></button>
          </div>}
          {tab === "explore" && !nativePlay && adventureResults.unread && showObjective("receipt") && (
            <AdventureResultResume
              result={adventureResults.unread}
              onInspect={() =>
                inspectAdventureResult(adventureResults.unread!.id)
              }
            />
          )}
          {tab === "explore" && adventureNotice && showObjective("notice") && (
            <button
              className="adventure-notice"
              onClick={() => {
                dismissAdventureNotice();
                setSheetExpanded(true);
              }}
            >
              <Compass size={24} aria-hidden="true" />
              <span>
                <strong>{tr("Choose another discovery")}</strong>
                <small role="status">{adventureNotice}</small>
              </span>
              <ArrowRight size={20} aria-hidden="true" />
            </button>
          )}
          {tab === "explore" &&
            coachActive && showObjective("coach") && !selected && !pointTarget && (
              <FirstSessionCoach
                session={firstSession}
                hint={learning.visible(coachTopic) ? helpText(coachTopic) : undefined}
                busy={!!busy}
                onAction={runFirstStep}
                actionLabel={coachLabel}
                aside={coachAside}
              />
            )}
          {tab === "explore" && selected && showObjective("selection") && (
            <div className="sheet-peek sheet-peek-selection">
            <button
              className="compact-selection"
              title={tr("Straight-line distance")}
              onClick={() => setSheetExpanded(true)}
            >
              <span className="peek-art" aria-hidden="true"><QuestThumbnail quest={zoneQuest} now={now} playerTier={player.tier} size={40} /></span>
              <span className="peek-body">
                <strong>{zoneQuest && selectedQuestId === zoneQuest.id ? questDisplayTitle(zoneQuest.title) : selected.name}</strong>
                <small>{zoneQuest ? activityProgress(zoneQuest, position) : tr("See what's here")}{" · "}{distanceLabel(meters(position, zoneQuest ? questPoint(zoneQuest) : selected))}</small>
                {selectedRequirement && !farRequirement && <small className="compact-requirement">{selectedRequirement}</small>}
              </span>
              <ArrowRight size={20} aria-hidden="true" />
            </button>
            <button
              className="sheet-peek-hide"
              aria-label={tr("Clear target")}
              title={tr("Clear target")}
              onClick={closeZone}
            >
              <X size={16} aria-hidden="true" />
            </button>
            </div>
          )}
          {tab === "explore" && pointTarget && !selected && (
            <div className="sheet-peek sheet-peek-selection">
              <button className="compact-selection" title={tr("Straight-line distance")} onClick={() => setPointTarget({ ...pointTarget, revision: Date.now() })}>
                <span className="peek-art" aria-hidden="true"><MapPin size={28} /></span>
                <span className="peek-body">
                  <strong>{pointTarget.label}</strong>
                  <small>{distanceLabel(meters(position, pointTarget))}</small>
                </span>
              </button>
              <button className="sheet-peek-hide" aria-label={tr("Clear target")} title={tr("Clear target")} onClick={clearPointTarget}>
                <X size={16} aria-hidden="true" />
              </button>
            </div>
          )}
          {tab === "explore" && nativePlay && nativeObjective.reference && showObjective("native") && (
            <div className="native-objective">
              <button
                className="native-objective-open"
                onClick={() => setTab("expeditions")}
              >
                <MapPin size={22} />
                <span>
                  <strong>{nativeObjective.view.label}</strong>
                  <small role="status">{nativeObjective.view.message}</small>
                </span>
                <ArrowRight size={18} />
              </button>
              <button
                aria-label={tr("Clear saved walk")}
                onClick={() => {
                  nativeObjective.clear();
                  returnToAdventure();
                }}
              >
                <X size={20} />
              </button>
            </div>
          )}
          <div className="panel-heading">
            {tab === "explore" && detailZone ? (
              <button className="panel-back" aria-label={tr("Back to Nearby")} onClick={openDiscoveries}><ArrowLeft size={20} aria-hidden="true" /></button>
            ) : tab === "fund" ? (
              <button
                className="panel-back"
                onClick={() => setTab("settings")}
                aria-label={tr("Back")}
                title={tr("Back")}
              >
                <ArrowLeft size={20} aria-hidden="true" />
              </button>
            ) : (
              tab !== "explore" &&
              (selected || (nativePlay && nativeObjective.reference)) && (
                <button
                  className="panel-back"
                  onClick={returnToAdventure}
                  aria-label={`${tr("Back to adventure")}: ${selected?.name || nativeObjective.view.label}`}
                  title={`${tr("Back to adventure")}: ${selected?.name || nativeObjective.view.label}`}
                >
                  <ArrowLeft size={20} aria-hidden="true" />
                </button>
              )
            )}
            <div>
              <h1 tabIndex={-1}>
                {tab === "explore" && detailZone ? detailZone.name : nearbyHome && world?.cityName ? `${title} · ${world.cityName}` : title}
              </h1>
            </div>
            {nearbyHome && sheetExpanded && world && (
              <span className="heading-refresh" title={tr("Refresh in") + " " + remaining(world.endsAt)}>
                <Clock size={14} aria-hidden="true" />
                <span className="sr-only">{tr("Refresh in")} </span>{remaining(world.endsAt)}
                {world.quality && world.cityStatus !== "auto" && !world.globalPreparation && (
                  <InfoTip label={tr("About this map")}>{world.quality.notice}</InfoTip>
                )}
              </span>
            )}
            {(tab !== "explore" || sheetExpanded) && (
              <button
                className="icon-button panel-close"
                onClick={tab === "explore" ? closeMapPanel : returnToAdventure}
                aria-label={tr("Close panel")}
              >
                <X size={18} />
              </button>
            )}
          </div>
          {tab === "explore" && sheetExpanded && toast?.error && <p className="inline-error" role="alert">{toast.text}</p>}
          {showProfileTabs && (
            <ScreenTabs
              label={tr("Profile")}
              idBase="profile"
              tabs={PROFILE_TABS}
              value={profileTab}
              onChange={chooseProfileTab}
              withPanel={tab !== "wallet"}
            />
          )}
          {showCommunityTabs && (
            <ScreenTabs
              label={tr("Community")}
              idBase="community"
              tabs={COMMUNITY_TABS}
              value={communityTab}
              onChange={chooseCommunityTab}
            />
          )}
          {(tab === "inventory" || tab === "market" || tab === "shop") && (
            <ScreenTabs
              label={tr("Inventory")}
              idBase="bag"
              tabs={BAG_TABS}
              value={tab === "inventory" ? "wardrobe" : "shop"}
              withPanel={tab === "inventory"}
              onChange={(next) => setTab(next === "shop" ? "shop" : "inventory")}
            />
          )}
          {(tab === "market" || tab === "shop") && (
            <ScreenTabs
              label={tr("Shop")}
              idBase="shop"
              variant="sub"
              sticky={false}
              tabs={SHOP_TABS}
              value={tab === "market" ? "market" : "items"}
              onChange={(next) => setTab(next === "market" ? "market" : "shop")}
            />
          )}
          {tab === "shop" && (
            <ScreenTabPanel idBase="shop" value="items">
              <GoldShop
                key={player.id}
                worldId={world?.id || null}
                fix={fix}
                arena={arena && !nativePlay}
                notify={notify}
                onSpent={() => {
                  setWalletTick((n) => n + 1);
                  void me();
                  void refreshGoldMap();
                  void readGoldLook();
                }}
                onEmote={(id: string, until: number) => setMyEmote({ id, until })}
              />
            </ScreenTabPanel>
          )}
          {tab === "places" && (
            <ScreenTabPanel idBase="community" value="places">
              <CommunityPlaces
                key={player.id}
                position={position}
                fix={fix}
                arena={arena && !nativePlay}
                notify={notify}
              />
            </ScreenTabPanel>
          )}
          {tab === "explore" && !detailZone && !nativePlay && (
            <>
              {!world?.zones.length &&
                !recommendation &&
                world &&
                world.poiQuests?.status === "empty" && (
                  <EmptyState art="place" title={tr("Nothing here yet")} status>
                    {tr("This area has no checked public places for quests today. Street coins still follow mapped paths.")}</EmptyState>
                )}
              {!world?.zones.length &&
                !recommendation &&
                world &&
                world.poiQuests?.status !== "empty" && (
                <EmptyState art="place" title={tr("Nothing open right here yet")} status>
                  {tr("Today's discoveries are still being placed. Pull the map to look around, or check back in a few minutes.")}</EmptyState>
              )}
              {world && world.zones.length > 0 && !recommendation && (
                <EmptyState
                  art="ghost"
                  title={tr("You've done everything open for you today")}
                  status
                >
                  {tr("New discoveries open with the next day. Coins on the streets still count while you walk.")}</EmptyState>
              )}
              {showObjective("find") && !coachStep &&
                recommendedFind &&
                !nativeTarget &&
                !adventureNotice &&
                (
                  <div className="sheet-peek">
                  <button
                    className="recommended-quest"
                    onClick={() => goToStreetFind(recommendedFind.coin)}
                  >
                    <span className="recommended-art">
                      <GameObjectArt kind="discovery" size={32} />
                    </span>
                    <span>
                      <small>{tr("Nearest find")}</small>
                      <strong>
                        {tr("Street find · +")}{world?.streetFindXp ?? 15} XP
                      </strong>
                      <span>
                        {tr("On a mapped path ·")}{" "}
                        {distanceLabel(recommendedFind.distance)}
                      </span>
                    </span>
                    <ArrowRight size={20} />
                  </button>
                  </div>
                )}
              {showObjective("quest") && !coachStep &&
                recommended &&
                recommendedZone &&
                !nativeTarget &&
                !adventureNotice &&
                (
                  <div className="sheet-peek">
                  <button
                    className="recommended-quest"
                    onClick={() => startQuest(recommended)}
                  >
                    <span className="recommended-art">
                      <QuestThumbnail quest={recommended} now={now} playerTier={player.tier} size={40} />
                    </span>
                    <span>
                      <small>{tr("Nearest discovery")}</small>
                      <strong>{questDisplayTitle(recommended.title)}</strong>
                      <span>
                        {recommendedZone.name} ·{" "}
                        {distanceLabel(
                          meters(position, questPoint(recommended)),
                        )}
                      </span>
                    </span>
                    <ArrowRight size={20} />
                  </button>
                  </div>
                )}
              {world?.cityStatus === "auto" && (
                <div className="day-row">
                  <Badge tone="gold">{tr("Unverified map")}</Badge>
                </div>
              )}
              {!world?.globalPreparation && <PotRow worldId={world?.id ?? null} position={position} onOpen={() => setTab("funding")} />}
              {world?.quality && (world.cityStatus === "auto" || world.globalPreparation) && (
                <details
                  className="coverage-note unverified"
                  open
                >
                  <summary>
                    {tr("Unverified map: generated automatically")}
                  </summary>
                  <p>{world.globalPreparation?.financialActivation && <strong>{tr("NEAR testnet")}. </strong>}{world.globalPreparation?.financialActivation
                    ? world.quality.funded
                      ? tr("Funded Atlas zones: the first confirmed completion earns the fixed NEAR prize shown in the objective. QGOLD is calculated at settlement; fractional NEAR stays credited. Follow local signs and skip blocked places.")
                      : tr("No monetary budget today. Atlas discoveries still award personal XP. Follow local signs and skip blocked places.")
                    : world.globalPreparation
                    ? tr("Map-derived discoveries by Atlas. Public access and paths have not been checked on foot: follow local signs and skip blocked places. These activities award personal XP; no monetary or item reward is promised.")
                    : world.quality.notice}</p>
                </details>
              )}
              {sheetExpanded && world && player && (
                <NearbyList
                  world={world}
                  position={position}
                  now={now}
                  playerTier={player.tier}
                  arena={arena}
                  filter={nearbyFilter}
                  onFilter={setNearbyFilter}
                  onZone={(z, questId) => { const q = questId ? world.quests.find(x => x.id === questId) : null; if (q) startQuest(q); else selectZone(z); }}
                  onActor={(actor, distanceM) => {
                    if (distanceM <= 35) setActorOpen(actor);
                    else showActor({ actorId: actor.id });
                  }}
                  onPlace={(id) => { setPlaceOpenId(id); setTab("messages"); }}
                  onSpot={() => setTab("places")}
                  onNotes={() => { setNotesView("browse"); setTab("messages"); }}
                  onCommunityTasks={() => setTab("bounties")}
                  market={{
                    fix: () =>
                      arena || !fix
                        ? { ...position, accuracy: 0, timestamp: Date.now() }
                        : fix,
                    fund: fundMarketEscrow,
                    notify,
                    onBalance: () => void me(),
                    openForm: marketForm,
                    onFormOpened: clearMarketForm,
                  }}
                />
              )}
            </>
          )}
          {tab === "explore" && detailZone && (
            <ZoneActivities zone={detailZone} quests={detailQuests} selectedQuest={detailQuest} timezone={world?.timezone}
              playerTier={player.tier} position={position} now={now} busy={busy}
              choices={clueChoice} onChoose={chooseZoneQuest}
              onClue={(id, choice) => setClueChoice(all => ({ ...all, [id]: choice }))}
              onGuide={q => { setCatalogView(null); guideToQuest(q); }} onComplete={id => void complete(id)}
              renderDetail={q => <QuestBrief quest={q} zone={detailZone} position={position} now={now} tier={player.tier} arena={arena} fix={fix} online={online}
                distance={meters(position, questPoint(q))} busy={!!busy}
                started={startedQuestKey === `${player.id}:${world?.id}:${q.id}` || (!browsing && selectedQuestId === q.id)}
                choice={clueChoice[q.id]} onChoose={choice => setClueChoice(all => ({ ...all, [q.id]: choice }))}
                onPoint={() => { setCatalogView(null); guideToQuest(q); }} onLocate={() => void locate()} onComplete={() => void complete(q.id)} onMap={q.completed ? closeZone : closeMapPanel} />}
              lockedContent={<LockedZoneCard zone={detailZone} />}
            />
          )}
          {tab === "inventory" && (
            <ScreenTabPanel idBase="bag" value="wardrobe">
              <Inventory
                key={player.id}
                walletU={wallet && !(wallet.realm === "qgold" && wallet.balanceKnown === false) ? wallet.balanceU : null}
                onOriginalAppearance={(appearance) =>
                  setPlayer((current) =>
                    current?.id === player.id
                      ? { ...current, appearance }
                      : current,
                  )
                }
                onWearables={(next) => updateOwnedPlayer(next)}
                initialTab={inventoryStart}
                map3D={map3D}
                onMap3D={toggleMap3D}
                xp={hudXp === null ? null : Number(hudXp)}
                onExplore={() => setTab("explore")}
                characterItems={appearanceItems}
                adventureResults={
                  !nativePlay ? (
                    <AdventureResultHistoryButton
                      onOpen={() => {
                        setToast(null);
                        adventureResults.history();
                      }}
                    />
                  ) : undefined
                }
                nativeContent={
                  <>
                    <WispRolls
                      accountId={
                        invisible.status === "ready" && invisible.signer
                          ? invisible.signer.accountId
                          : null
                      }
                      send={sendWispRoll}
                      onWon={() => void me()}
                    />
                    <NativeWardrobe
                      player={player}
                      data={nativeWardrobe}
                      error={nativeError}
                      busy={busy}
                      onConnect={activateExplorer}
                      onRefresh={() => void refreshNative(true).catch(() => {})}
                      onMint={(account) =>
                        nativeTransaction("mint_avatar", account)
                      }
                      onEquip={(account, item, slot) =>
                        nativeTransaction(
                          nativeWardrobe?.accounts.find(
                            (a) => a.accountId === account,
                          )?.equipment[slot] === item.tokenId
                            ? "unequip_aura"
                            : "equip_aura",
                          account,
                          item,
                          slot,
                        )
                      }
                      onSource={useNativeOutfit}
                    />
                    <NativeLevelRewards
                      player={player}
                      account={playAccount}
                      onAccount={setPlayAccount}
                      onConnect={activateExplorer}
                      busy={busy}
                      onMint={mintNativeLevel}
                      onConfirm={checkNativeLevel}
                    />
                  </>
                }
                nativeExtras={
                  <>
                    <AuraClaims
                      player={player}
                      enabled={!!nativeWardrobe?.claimsEnabled}
                      busy={busy}
                      onConnect={activateExplorer}
                      onMint={mintEarnedAura}
                      onConfirm={checkAuraClaim}
                      onRestore={restoreDemoAura}
                    />
                    <NativeProfilePanel
                      player={player}
                      busy={busy}
                      onConnect={activateExplorer}
                      onPublish={publishNativeProfile}
                      managedAccountId={
                        invisible.status === "ready"
                          ? invisible.accountId || ""
                          : ""
                      }
                    />
                  </>
                }
                player={player}
                busy={busy}
                onEvm={connectEvm}
                onSkin={async (tokenId) => {
                  await action("skin", async () => {
                    const r = await api<{ player: Player }>(
                      "/aavegotchi/equip",
                      {
                        tokenId,
                      },
                    );
                    if (latest.current.player?.id !== player.id) return;
                    updateOwnedPlayer(r.player);
                    notify(tr("New look equipped."));
                  });
                }}
                onEquip={(item) =>
                  void action("equip", async () => {
                    const r = await api<{ player: Player }>("/equip", {
                      itemId: item.id,
                    });
                    if (latest.current.player?.id !== player.id) return;
                    updateOwnedPlayer(r.player);
                    notify(
                      item.equipped
                        ? tr("Aura taken off.")
                        : tr("Equipped. Your new glow is on the map."),
                    );
                  })
                }
                onSell={async (item, priceYocto) => {
                  // Every Aura trade is on NEAR: secure the Aura as an NFT
                  // (relayed, no fee), then list it like a secured one.
                  if (!(await mintEarnedAura(item))) return false;
                  const claim = await api<{ claim: NativeAuraClaim }>(
                    "/native/claims/confirm",
                    { itemId: item.id },
                  );
                  if (!claim.claim.token_id) return false;
                  return listSecuredAura(
                    claim.claim.receiver_id,
                    claim.claim.token_id,
                    priceYocto,
                  );
                }}
                secured={(nativeWardrobe?.accounts || []).map((account) => ({
                  accountId: account.accountId,
                  avatarReady: account.starterMinted && account.starterOwned,
                  equipment: account.equipment,
                  items: account.items,
                }))}
                onSecuredEquip={(account, item, slot) =>
                  nativeTransaction(
                    nativeWardrobe?.accounts.find((a) => a.accountId === account)
                      ?.equipment[slot] === item.tokenId
                      ? "unequip_aura"
                      : "equip_aura",
                    account,
                    item,
                    slot,
                  )
                }
                onSecuredSell={listSecuredAura}
              />
            </ScreenTabPanel>
          )}
          {((tab === "explore" && nativePlay) ||
            tab === "expeditions") && (
            <>
              {tab === "explore" && nativePlay && (
                <NativeCollectionControl
                  collection={nativeCollection}
                  ready={!!playAccount && nativeGame.state?.enrolled === true}
                  onToggle={nativeCollection.setEnabled}
                />
              )}
              {tab === "explore" && nativePlay && (
                <TodaysPot practice={false} onOpen={() => setTab("funding")} />
              )}
              {tab === "explore" && nativePlay && (
                <SeasonCard signedIn={!!player} refreshKey={player?.xp} onClaimed={() => void me()} />
              )}
              <NativeExpeditions
                onBusyChange={setNativeVisitBusy}
                view="board"
                control={{
                  ...nativeGame,
                  account: playAccount,
                  onAccount: setPlayAccount,
                }}
                objective={nativeObjective}
                player={player}
                fix={fix}
                arena={arena}
                position={position}
                onConnect={activateExplorer}
                onLocate={() => void locate()}
                onWithdraw={withdrawNativeReward}
                onWallet={(showReceipts = false) => {
                  if (!showReceipts) return setTab("fuel");
                  // Receipts live in Settings → Advanced (owner request, 12 Nov 2026).
                  chooseProfileTab("settings");
                  openSettingsPart(".settings-receipts");
                }}
                onFocus={(kind, index) => {
                  setNativePlay(true);
                  nativeObjective.select(kind, index);
                  setOverview(false);
                  setFollow(false);
                  setGlobe(false);
                  setSheetExpanded(false);
                  setTab("explore");
                  requestAnimationFrame(() =>
                    mainPanel.current
                      ?.querySelector<HTMLElement>(".native-objective-open")
                      ?.focus({ preventScroll: true }),
                  );
                }}
              />
            </>
          )}
          {tab === "settings" && (profileView === "character" || profileView === "badges") && (
            <ScreenTabPanel idBase="profile" value="character">
              <ProfileHero
                avatar={
                  <Character
                    items={appearanceItems}
                    // originTokenId and look (outfit tag) of the worn original.
                    {...player.appearance}
                  />
                }
                name={player.name}
                appearanceLabel={`${player.nativeOutfit ? tr("Secured outfit") : tr("Game outfit")} · ${player.appearance.originTokenId ? tr("Original") : tr("Starter ghost")}`}
                level={hudLevel}
                progress={
                  hudXp !== null && hudLevel !== null
                    ? Math.max(
                        0,
                        Math.min(
                          100,
                          ((hudXp - 100 * (hudLevel - 1) ** 2) /
                            (100 * (hudLevel ** 2 - (hudLevel - 1) ** 2))) *
                            100,
                        ),
                      )
                    : null
                }
                detail={
                  hudXp !== null && hudLevel !== null
                    ? tr("{0} / {1} XP to level {2}", { 0: hudXp, 1: 100 * hudLevel ** 2, 2: hudLevel + 1 })
                    : tr("Secure your explorer to keep progress")
                }
              />
              {invisible.signer?.kind === "managed" && (
                // The inbox pill shows only with new messages; this opens
                // older conversations too (src/inbox/Inbox.tsx).
                <div className="profile-tiles">
                  <ProfileTile
                    icon={ChatCircle}
                    label={tr("Messages")}
                    hint={tr("Private chats with explorers")}
                    onClick={() =>
                      window.dispatchEvent(new CustomEvent("questlayer:inbox-open", { detail: {} }))
                    }
                  />
                </div>
              )}
              <CharacterJourney
                refreshKey={`${player.id}:${player.xp}:${player.gold_u}`}
                badges={
                  <BadgeBook
                    inline
                    collapsible
                    key={player.id}
                    fix={fix}
                    arena={arena}
                    onConnectNear={() => void activateExplorer()}
                  />
                }
              />
            </ScreenTabPanel>
          )}
          {settingsOpen && (
            <SettingsScreen
              map={settingsMap}
              map3D={map3D}
              onMap3D={() => toggleMap3D()}
              guide={{
                pip: !!gameLayer?.tour,
                // Off also while the first-steps card is dismissed or finished,
                // so switching it on brings the card back.
                on: gameLayer?.tour
                  ? !pipHidden
                  : learning.state.enabled && firstSession.visible && !(objective === "coach" && dismissedObjective === objectiveKey),
                onChange: chooseGuide,
              }}
              sharePosition={sharePosition}
              onSharePosition={changeSharePosition}
              feedback={feedback}
              onHowToPlay={() => setManualIntro(player.id)}
              onAsk={() => setShowNpc(true)}
              onEconomy={() => setTab("fund")}
              account={
                <>
                  {invisible.status !== "ready" && (
                    <AccountSessions
                      part="main"
                      player={player}
                      onConnect={connectNear}
                      onSecure={() => void attachPasskey()}
                      onRevoke={revokeGameSessions}
                      busy={busy}
                    />
                  )}
                  <DeviceKeys
                    part="main"
                    status={invisible.status}
                    accountId={invisible.accountId}
                    keys={invisible.keys}
                    localPublicKey={invisible.publicKey}
                    busy={busy}
                    onSetupRecovery={setupRecoveryPasskey}
                    onRevoke={revokeDevice}
                    onRestore={restoreThisDevice}
                    onExportWallet={exportWalletWords}
                    onStartOver={invisible.canStartOver ? startOverHere : undefined}
                    error={invisible.error}
                    onRetry={() => void invisible.ensure()}
                  />
                </>
              }
              advanced={
                <>
                  <div id="account-devices" className="settings-pad">
                    <AccountSessions
                      part={invisible.status === "ready" ? undefined : "advanced"}
                      player={player}
                      onConnect={connectNear}
                      onConnectEthereum={() => connectEthereum()}
                      onSecure={() => void attachPasskey()}
                      onRevoke={revokeGameSessions}
                      busy={busy}
                    />
                    <DeviceKeys
                      part="advanced"
                      status={invisible.status}
                      accountId={invisible.accountId}
                      keys={invisible.keys}
                      localPublicKey={invisible.publicKey}
                      busy={busy}
                      onSetupRecovery={setupRecoveryPasskey}
                      onRevoke={revokeDevice}
                      onRestore={restoreThisDevice}
                    />
                  </div>
                  <ChainSettings accountId={invisible.accountId} />
                  <SettingsReceipts
                    key={player.id}
                    playerId={player.id}
                    linkedAccounts={player.wallets.map((wallet) => wallet.account_id)}
                    onConfirmed={async () => {
                      await Promise.allSettled([
                        refreshNative(true),
                        nativeGame.refresh(),
                      ]);
                    }}
                  />
                  {/* Owner-only switches and notes, kept out of the way (Lubos, 10 Nov 2026). */}
                  <details className="advanced-settings settings-developer">
                    <summary><Code size={16} aria-hidden="true" />{tr("Developer")}</summary>
                    <p className="fine-print">{tr("Reward ledger")}</p>
                    <div className="settings-pad">
                      <div
                        className="play-mode-switch"
                        role="group"
                        aria-label={tr("Reward ledger")}
                      >
                        <button
                          aria-pressed={!nativePlay}
                          onClick={() => chooseLedger(false)}
                        >
                          {tr("Map coins (QGOLD)")}</button>
                        <button
                          aria-pressed={nativePlay}
                          onClick={() => chooseLedger(true)}
                        >
                          {tr("Test network")}</button>
                      </div>
                      <p className="fine-print">
                        {tr("Map coins pay QGOLD to your NEAR account each night. The test network ledger plays the Plzeň NEAR days instead. Test tokens have no monetary value.")}</p>
                    </div>
                  </details>
                </>
              }
              onSignOut={() => void action("logout", async () => {
                await api("/logout", {}); setPlayer(null); setWorld(null);
              })}
            />
          )}
          {tab === "funding" && (
            <RewardFundingPage
              practice={!nativePlay}
              onExplore={() => setTab("explore")}
              onLedger={() => setTab("fund")}
            />
          )}
          {/* Opens "Convert QGOLD to gas" by itself when the explorer's gas runs low. */}
          {explorerId && (
            <GasWatch refreshKey={`${player.id}:${player.gold_u}:${tab}`} />
          )}
          {tab === "fuel" && (
            <ScreenTabPanel idBase="profile" value="stake">
              <FuelTheCity {...stakeProps!} />
            </ScreenTabPanel>
          )}
          {tab === "fund" && (
            <GameEconomy {...stakeProps!} />
          )}
          {tab === "community" && (
            <ScreenTabPanel idBase="community" value={communityTab}>
              <CreatorCommunity
                key={player.id}
                section={communityTab === "creators" ? "creators" : "quests"}
                player={player}
                notify={notify}
                view={creatorView}
                onViewChange={setCreatorView}
                onGo={goToCreatorQuest}
                onRate={keepQuestRating}
                onPlayerChange={me}
                position={position}
                money={{
                  accountId: explorerId || player.wallets[0]?.account_id || "",
                  managed: !!explorerId,
                  pay: operateCreatorPayment,
                }}
                onCapabilityChange={(enabled) => {
                  if (latest.current.player?.id !== player.id) return;
                  setCreatorCapability((previous) =>
                    previous?.playerId === player.id &&
                    previous.enabled === enabled
                      ? previous
                      : { playerId: player.id, enabled },
                  );
                }}
              />
              {creatorCapability?.playerId === player.id && !creatorCapability.enabled && (
                <nav className="community-available-actions" aria-label={tr("Community")}>
                  <button type="button" className="primary-button" onClick={() => chooseCommunityTab("notes")}>
                    <ChatCircle size={22} aria-hidden="true" />{tr("Local chat")}<ArrowRight size={20} aria-hidden="true" />
                  </button>
                  <button type="button" className="community-tasks-link" onClick={() => chooseCommunityTab("tasks")}>
                    <Flag size={20} aria-hidden="true" />{tr("Community tasks")}<ArrowRight size={20} aria-hidden="true" />
                  </button>
                </nav>
              )}
            </ScreenTabPanel>
          )}
          {tab === "market" && (
            <ScreenTabPanel idBase="shop" value="market">
              <MarketBoard
                key={player.id}
                player={player}
                orderSigner={orderSigner}
                explorerAccount={invisible.accountId || ""}
                explorerStatus={invisible.status}
                onLinkWallet={() => connectNear()}
                busy={busy}
                onConnect={activateExplorer}
                onTrade={tradeNative}
                onBought={() => {
                  void me();
                  void refreshNative(true).catch(() => {});
                }}
              />
              <Details summary={tr("More trading tools")}>
                <NativeMarketPanel
                  section="offers"
                  player={player}
                  wardrobe={nativeWardrobe}
                  busy={busy}
                  onConnect={activateExplorer}
                  onTrade={tradeNative}
                  orderSigner={orderSigner}
                />
              </Details>
            </ScreenTabPanel>
          )}
          {tab === "messages" && (
            <ScreenTabPanel idBase="community" value="notes">
            <LocalChat
              places={{
                position,
                fix,
                arena: arena && !nativePlay,
                notify,
                onSpent: () => {
                  void me();
                  void refreshGoldMap();
                },
                openId: placeOpenId,
                onOpened: clearPlaceOpen,
                onPublish: recordAccount ? publishPlace : undefined,
              }}
              chat={{
                playerId: player.id,
                position,
                fix,
                arena,
                view: notesView,
                notify,
                onViewChange: setNotesView,
                recordAccount,
                onRecord: recordNote,
                onChange: () => void refreshMapNotes(),
                openId: noteOpenId,
                onOpened: clearNoteOpen,
                onBlockChange: () => {
                  setOthers([]);
                  window.dispatchEvent(new Event("questlayer:social-blocks"));
                },
              }}
              key={player.id}
            />
            </ScreenTabPanel>
          )}
          {tab === "bounties" && (
            <ScreenTabPanel idBase="community" value="tasks">
              <NearbyMarket
                key={player.id}
                variant="board"
                position={position}
                fix={() =>
                  arena || !fix
                    ? { ...position, accuracy: 0, timestamp: Date.now() }
                    : fix
                }
                fund={fundMarketEscrow}
                notify={notify}
                onBalance={() => void me()}
              />
            </ScreenTabPanel>
          )}
        </main>
        </MapSurface>
      )}
      {player && mapInteractive && showNearby && near && !mapFullOn && <button className="nearby-open" data-quest-id={near.kind === "quest" ? near.quest.id : undefined} onClick={() => {
        if (near.kind === "actor") setActorOpen(near.actor);
        else if (near.kind === "quest") startQuest(near.quest);
        else if (world) setFindInspect({worldId:world.id,coin:near.coin});
      }}>
        <span className="nearby-open-art" aria-hidden="true">{near.kind === "actor" ? <ActorPortrait model={near.actor.model} label="" /> : near.kind === "find" ? <GameObjectArt kind="discovery" size={40} /> : <GameObjectArt {...questObjectPresentation(near.quest,{now,playerTier:player.tier})} size={40} />}</span>
        <span><strong>{tr("Open {0}", {0:nearName})}</strong><small>{distanceLabel(near.distanceM)}</small></span>
        <ArrowRight size={22} aria-hidden="true" />
      </button>}
      {player && (
        <>
          {presence && others.length > 0 && (
            <button
              className="presence-chip"
              aria-label={tr("Stop showing me to nearby explorers")}
              onClick={() => changeSharePosition(false)}
            >
              <Eye size={14} />{" "}
              {tr("Visible nearby · {0} near", { 0: others.length })}{" "}
              <X size={12} />
            </button>
          )}
          {searchHere && (
            <button
              className="map-search-here"
              onClick={() => {
                exploreAt.current = Date.now();
                setMapCenter(null);
                void loadWorld(arena ? HOME : position, arena, searchHere);
              }}
            >
              <MagnifyingGlass size={16} weight="bold" aria-hidden="true" />
              {tr("Search this area")}
            </button>
          )}
          {arena && !nativePlay && !globe && mapVisible && (
            <DemoControls
              held={demoWalk.held}
              running={demoWalk.running}
              run={demoWalk.run}
              setRun={demoWalk.setRun}
              press={(control, down, source) => { if (down) learning.acknowledge("movement-arena"); demoWalk.press(control, down, source); }}
              release={demoWalk.release}
              steer={demoWalk.steer}
              target={
                demoTarget
                  ? {
                      label: demoTarget.label,
                      meters: metersBetween(position, demoTarget),
                      relative:
                        (headingTo(position, demoTarget) ?? demoWalk.heading) -
                        demoWalk.heading,
                    }
                  : null
              }
            />
          )}
          {mapFullOn && (
            <button
              className="map-full-exit"
              aria-label={tr("Exit full map")}
              title={tr("Exit full map")}
              onClick={() => {
                setMapFull(false);
                requestAnimationFrame(() => window.dispatchEvent(new Event("resize")));
              }}
            >
              <ArrowsIn size={22} weight="bold" />
            </button>
          )}
          {tab === "explore" && !globe && communityGoal?.points[0] && (
            <div className="community-goal" role="group" aria-label={tr("Creator quests")}>
              <button type="button" className="community-goal-open" onClick={openCommunityGoal}>
                <img src={mapKitUrl("quests/visit.png")} width={32} height={32} alt="" aria-hidden="true" />
                <span>
                  <strong>{communityGoal.title}</strong>
                  <small>
                    {metersBetween(position, communityGoal.points[0]) <= 30
                      ? tr("You are here. Tap to answer.")
                      : distanceLabel(metersBetween(position, communityGoal.points[0]))}
                  </small>
                </span>
                <ArrowRight size={20} aria-hidden="true" />
              </button>
              <button
                type="button"
                className="community-goal-close"
                aria-label={tr("Stop guiding")}
                title={tr("Stop guiding")}
                onClick={() => { setCommunityGoal(null); setDemoTarget(null); }}
              >
                <X size={18} weight="bold" aria-hidden="true" />
              </button>
            </div>
          )}
          {tab === "explore" && !globe && gameLayer?.tour && player && (
            <TourHelper
              position={position}
              heading={arena && !nativePlay ? demoWalk.heading : (gpsCourse ?? undefined)}
              resolve={tourResolve}
              onGo={tourGo}
              onRunning={setTourRunning}
            />
          )}
          {tab === "explore" && !globe && (
            <MapActions actions={mapActions}>
              {emotePicker && (
                <EmotePicker
                  onEmote={(id: string, until: number) => setMyEmote({ id, until })}
                  onShop={() => {
                    setEmotePicker(false);
                    setTab("shop");
                    setSheetExpanded(true);
                  }}
                  onClose={() => setEmotePicker(false)}
                />
              )}
            </MapActions>
          )}
          {quickCreate === "note" && (
            <MapNotes
              quick
              playerId={player.id}
              position={position}
              fix={fix}
              arena={arena}
              notify={notify}
              onChange={() => void refreshMapNotes()}
              onDone={() => setQuickCreate(null)}
            />
          )}
          {quickCreate === "shout" && (
            <PlaceCompose
              kind="shout"
              position={position}
              fix={fix}
              arena={arena && !nativePlay}
              notify={notify}
              onClose={() => setQuickCreate(null)}
              onCreated={() => {
                setQuickCreate(null);
                void me();
                void refreshGoldMap();
              }}
            />
          )}
          {quickCreate === "topic" && (
            <PlaceCompose
              kind="topic"
              position={position}
              fix={fix}
              arena={arena && !nativePlay}
              notify={notify}
              onClose={() => setQuickCreate(null)}
              onCreated={(thread) => {
                setQuickCreate(null);
                void me();
                void refreshGoldMap();
                notify(tr("Your topic is on the map: {0}", { 0: thread.title }));
              }}
            />
          )}
          {quickCreate === "place" && (
            <AddPlaceDialog
              position={position}
              fix={fix}
              arena={arena && !nativePlay}
              notify={notify}
              onClose={() => setQuickCreate(null)}
              onAdded={() => setQuickCreate(null)}
            />
          )}
        </>
      )}
      <RewardBursts bursts={bursts} />
      {invisible.signer && player && (
        <AutoSocialProfile signer={invisible.signer} player={player} />
      )}
      {/* Encrypted player inbox (docs/PLAYER-INBOX.md). */}
      {invisible.signer?.kind === "managed" && player && (
        <Inbox signer={invisible.signer} player={player} />
      )}
      {busy === "world" && (
        <div className="world-loading">
          <span className="spinner" /> {" "}{tr("Finding trails and today’s treasures…")}</div>
      )}
      {cardPlayer && (
        <PlayerCard
          key={cardPlayer}
          playerId={cardPlayer}
          onClose={() => setCardPlayer(null)}
          onPlayer={setPlayer}
          onEdit={() => {
            setCardPlayer(null);
            setTab("inventory");
          }}
          onBlocked={() =>
            setOthers((list) => list.filter((p) => p.id !== cardPlayer))
          }
          // Why Message is off on this device, and the way to fix it.
          messageOff={invisible.signer?.kind === "managed" ? null : messageOffReason()}
          // The encrypted inbox (src/inbox/Inbox.tsx) opens the conversation.
          onMessage={
            invisible.signer?.kind === "managed"
              ? (playerId, name) => {
                  setCardPlayer(null);
                  window.dispatchEvent(
                    new CustomEvent("questlayer:inbox-open", { detail: { playerId, name } }),
                  );
                }
              : undefined
          }
        />
      )}
      {toast && (
        <div
          className={`toast ${toast.error ? "error" : ""}`}
          role={toast.error ? "alert" : "status"}
        >
          {toast.error ? (
            <Question size={20} />
          ) : (
            <Sparkle size={20} weight="fill" />
          )}
          {toast.text}
        </div>
      )}
      <PickupAnnouncement text={pickupFeedback.announcement} />
      {!player && busy === "near" && (
        <div className="wallet-connecting" role="status">
          <Wallet size={24} />
          <strong>{tr("Connecting your explorer…")}</strong>
          <span>{tr("Approve the request in your wallet app.")}</span>
        </div>
      )}
      {treasuryVoteOpen && player && (
        <TreasuryVoteDialog
          key={`treasury-${player.id}`}
          account={explorerId || null}
          vote={voteTreasury}
          notify={notify}
          onClose={() => setTreasuryVoteOpen(false)}
        />
      )}
      {lockedZoneDialog && player && !walletChoices && (
        <LockedZoneDialog zone={lockedZoneDialog} onClose={() => setLockedZoneDialog(null)} />
      )}
      {walletChoices && (
        <Dialog label={walletChoiceKind === "evm" ? tr("Choose an Ethereum wallet") : tr("Choose a NEAR wallet")} onClose={() => chooseWallet(null)}>
          <div className="wallet-select">
            <div className="panel-heading">
              <h2>{walletChoiceKind === "evm" ? tr("Choose an Ethereum wallet") : tr("Choose a NEAR wallet")}</h2>
              <button
                className="icon-button"
                aria-label={tr("Cancel wallet connection")}
                onClick={() => chooseWallet(null)}
              >
                <X size={20} />
              </button>
            </div>
            <p>
              {tr("Your wallet signs a short message to create or restore your explorer. Nothing is paid.")}</p>
            <div className="wallet-options">
              {walletChoices.map((w) => (
                <button key={w.id} onClick={() => chooseWallet(w.id)}>
                  <img src={w.icon} alt="" />
                  <span>
                    <strong>{w.name}</strong>
                    <small>
                      {w.website.replace(/^https?:\/\//, "").split("/")[0]}
                    </small>
                  </span>
                  <ArrowRight size={20} />
                </button>
              ))}
            </div>
            <p className="fine-print">
              {tr("Your keys stay in your wallet. QuestLayer never asks for your recovery phrase.")}</p>
            <button
              className="secondary-button"
              onClick={() => chooseWallet(null)}
            >
              {tr("Back")}</button>
          </div>
        </Dialog>
      )}
      {loaded && !player && meUnreachable && (
        <Dialog label={tr("Can't reach QuestLayer")} open onClose={() => {}}>
          <section className="welcome-card offline-gate">
            <WifiSlash size={40} aria-hidden="true" />
            <h2>{online ? tr("Can't reach QuestLayer") : tr("You're offline")}</h2>
            <p>
              {tr("Your explorer and progress are saved. They'll be right here as soon as you're back online.")}</p>
            <button className="primary-button" onClick={() => void me()}>
              {tr("Try again")}{" "}<ArrowClockwise size={18} />
            </button>
          </section>
        </Dialog>
      )}
      {loaded && !player && !meUnreachable && (
        <Welcome
          error={toast?.error ? toast.text : undefined}
          onNear={(name) => connectNear({ signIn: true, name })}
          onEthereum={(name) => connectEthereum({ signIn: true, name })}
          busy={busy}
          action={action}
          onPlayer={(p) => {
            setPlayer(p);
            setLoaded(true);
          }}
          onRestore={restoreThisDevice}
        />
      )}
      {introOpen && player && <GameIntro key={player.id} manual={manualIntro === player.id}
        onStart={() => { if (manualIntro !== player.id) learning.finishIntro(true); else returnToAdventure(); setManualIntro(null); }}
        onSkip={() => { if (manualIntro !== player.id) learning.finishIntro(false); setManualIntro(null); }} />}
      {discovery && player && !nativePlay && (
        <AdventureResultDialog
          results={adventureResults}
          intent={rewardIntent}
          note={rewardNote}
          player={player}
          realm={arena ? "arena" : "gps"}
          online={online}
          busy={!!busy}
          actionError={toast?.error ? toast.text : undefined}
          onInspect={inspectAdventureResult}
          itemActions={(item) =>
            item.kind === "aura" && (
              <SecureAndShare
                item={item}
                player={player}
                busy={!!busy}
                place={world?.cityName}
                availability={
                  invisible.status === "ready" && nativeWardrobe?.claimsEnabled
                    ? "ready"
                    : invisible.status === "creating" ||
                        (invisible.status === "ready" && !nativeWardrobe)
                      ? "preparing"
                      : "off"
                }
                onSecure={mintEarnedAura}
                onPasskey={attachPasskey}
                onDone={() => firstSession.mark("secure")}
              />
            )
          }
          onEquip={(result) => void equipAdventureResult(result)}
          onInventory={() => {
            adventureResults.close();
            setTab("inventory");
          }}
          onMap={() => {
            if (discovery.result && world?.quests.some(q => q.id === discovery.result?.questId && q.zone_id === selected?.id)) setSelected(null);
            adventureResults.close();
            if (zoneQuest?.completed) closeZone();
            setTab("explore");
            setSheetExpanded(false);
            setFollow(true);
          }}
        />
      )}
      {showWearableMoment && wearableMoment && <WearableMoment wearable={wearableMoment} onClose={() => setWearableMoment(null)} onWardrobe={() => { setWearableMoment(null); openWardrobe(); }} />}
      {findInspect && world?.id === findInspect.worldId && <FindDetails key={findInspect.coin.id}
        coin={findInspect.coin} available={!!world.coins.find(c => c.id === findInspect.coin.id && !c.claimant)}
        distanceM={meters(position, findInspect.coin)} onClose={() => setFindInspect(null)}
        onPoint={() => { goToStreetFind(findInspect.coin); setFindInspect(null); }}
        onInventory={() => { const wearable = !!findInspect.coin.wearable; setFindInspect(null); if (wearable) openWardrobe(); else setTab("inventory"); }} />}
      {actorOpen && world && player && (
        <ActorSheet
          playerId={player.id}
          actor={actorOpen}
          worldId={world.id}
          location={
            world.arena
              ? { ...position, accuracy: 0, timestamp: Date.now() }
              : fix
          }
          onQuest={(id) => {
            const quest = world.quests.find(q => q.id === id);
            if (quest) startQuest(quest);
          }}
          onShow={() => {
            const id = actorOpen.id;
            setActorOpen(null);
            setTab("explore");
            showActor({ actorId: id });
          }}
          onClose={() => setActorOpen(null)}
          keeperPanel={actorOpen.archetype === "keeper" && stakeProps ? <GameEconomy {...stakeProps} /> : undefined}
        />
      )}
      {showNpc && (
        <Npc
          worldId={world?.id}
          position={position}
          onClose={() => setShowNpc(false)}
        />
      )}
    </div>
  );
}

function Npc({
  onClose,
  worldId,
  position,
}: {
  onClose: () => void;
  worldId?: string;
  position?: Point;
}) {
  const [q, setQ] = useState(""),
    [answer, setAnswer] = useState(
      () => tr("Hello, explorer. Start with a free place nearby, pick up a few coins on the way and open a chest. Solo is fine; this haunt is yours to explore."),
    ),
    [busy, setBusy] = useState(false),
    [source, setSource] = useState("rules");
  async function ask(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const r = await api<{ answer: string; source: string }>("/npc", {
        question: q,
        ...(worldId ? { worldId } : {}),
        ...(position ? { location: position } : {}),
      });
      setAnswer(r.answer);
      setSource(r.source);
      setQ("");
    } catch {
      setAnswer(
        tr("The guide can't hear you right now. Keep exploring; your coins and visits still count."),
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog label={tr("Quest guide")} onClose={onClose}>
      <section className="npc-modal" onClick={(e) => e.stopPropagation()}>
        <button
          className="icon-button close"
          onClick={onClose}
          aria-label={tr("Close")}
        >
          <X />
        </button>
        <div className="npc-avatar">
          <Ghost color="#bc9b65" hat />
        </div>
        <Badge tone="gold">{tr("EXPEDITION KEEPER")}</Badge>
        <h2>{tr("Every trail leads somewhere.")}</h2>
        <p className="npc-answer">{answer}</p>
        <form onSubmit={ask}>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            maxLength={300}
            aria-label={tr("Question for the guide")}
            placeholder={tr("Ask about places, chests or Auras…")}
            required
          />
          <button className="primary-button" disabled={busy} aria-label={tr("Send")}>
            {busy ? "…" : <PaperPlane size={20} />}
          </button>
        </form>
        <small>
          {source === "near-ai"
            ? tr("Answered by the AI guide from live game data")
            : source === "anthropic"
              ? tr("Answered by Claude from live game data")
              : tr("Answered from live game data")}
        </small>
      </section>
    </Dialog>
  );
}
