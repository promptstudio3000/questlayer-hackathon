import {
  AdventureResultDialog,
  AdventureResultResume,
  AdventureResultHistoryButton,
  PendingNativeTransactions,
  CreatorCommunity,
  CommunityBonusVote,
  MapNotes,
  NativeCollectionControl,
  NativeTasks,
  Inventory,
  AccountSessions,
  DeviceKeys,
  NativeLevelRewards,
  NativeMarketPanel,
  NativeExpeditions,
  NativeEconomyPanel,
  RewardFundingPage,
  TodaysPot,
  SecureAndShare,
  FuelTheCity,
  NativeStaking,
  AuraClaims,
  NativeWardrobe,
  NativeProfilePanel,
  preloadPanels,
  ActorSheet,
} from "./lazy-panels";
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
import { PickupSummary, PickupAnnouncement } from "./PickupSummary";
import {
  GameObjectArt,
  questObjectPresentation,
  zoneObjectPresentation,
  representativeZoneQuest,
} from "./game-object-art";
import { makeNativeObjective } from "./native-objective";
import { useAdventureSelection } from "./useAdventureSelection";
import { useNativeObjective, useNativePlayAccount } from "./useNativeObjective";
import { sendConfirmedNative } from "./confirmed-native-transaction";
import { walletSigner, type NativeSigner } from "./native-signer";
import { useInvisibleAccount } from "./useInvisibleAccount";
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
import type { ActorView } from "./actor-types";
import "./inventory.css";
import { indexedDbKeyStore } from "./player-key";
import type { NativeMilestone } from "./NativeLevelRewards";
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
import type { NativeTradeRequest } from "./types";
import type { NativeAuraClaim } from "./types";
import { nativeAppearanceItems } from "./native-appearance";
import { publishNoteRecord, type NoteRecordKind } from "./note-record";
import type { NativeProfileQuote } from "./types";
import { assertProfileQuote } from "./native-profile-quote";
import type { NativeWardrobeState, NativeItem } from "./types";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import {
  Compass,
  Cube,
  Backpack,
  Storefront,
  ChartDonut,
  Wallet,
  MapPin,
  NavigationArrow,
  GlobeHemisphereWest,
  Crosshair,
  Plus,
  Minus,
  X,
  ArrowRight,
  ArrowUpRight,
  Sparkle,
  Coins,
  LockKey,
  Clock,
  Check,
  Leaf,
  ArrowLeft,
  ChatCircle,
  PaperPlane,
  SignOut,
  ShieldCheck,
  Key,
  Eye,
  EyeSlash,
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
} from "@phosphor-icons/react";
import {
  startRegistration,
  startAuthentication,
} from "@simplewebauthn/browser";
import { api, ApiError, GOLD, gold, near, meters, remaining } from "./api";
import { Dialog } from "./Dialog";
import { Character } from "./Character";
import { DeferredGameMap as GameMap, preloadGameMap } from "./DeferredGameMap";
import { useCreatorPlaces } from "./useCreatorPlaces";
import { Ghost, AuraArt } from "./Ghost";
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
import { nearestDiscovery } from "./nearest-discovery.ts";
import { FirstSessionCoach, useFirstSession } from "./FirstSession";
import type { FirstStepId } from "./first-session";
import {
  cue,
  loadFeedbackPreferences,
  prefersReducedMotion,
  previewSound,
  setFeedbackPreferences,
  subscribeFeedback,
  type FeedbackPreferences,
} from "./feedback";
import {
  WALK_CAP_M,
  WALK_STEP_MS,
  cappedWalkTarget,
  walkSteps,
} from "./map-motion.ts";

type Tab =
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
  | "fuel";
const HOME = { lat: 49.74745, lng: 13.3774 };
const nav = [
  { id: "explore", label: "Explore", icon: Compass },
  { id: "inventory", label: "Inventory", icon: Backpack },
  { id: "community", label: "Community", icon: UsersThree },
  { id: "settings", label: "Profile", icon: UserCircle },
] as const;
function navigationActive(tab: Tab, id: string) {
  return (
    tab === id ||
    (id === "community" && ["messages", "bounties"].includes(tab)) ||
    (id === "explore" && ["expeditions", "funding"].includes(tab)) ||
    (id === "inventory" && tab === "market") ||
    (id === "settings" && ["wallet", "fund", "fuel"].includes(tab))
  );
}
const rarityNames: Record<string, string> = {
  common: "Common",
  rare: "Rare",
  epic: "Epic",
  legendary: "Legendary",
};
function distanceLabel(m: number) {
  if (!Number.isFinite(m)) return "";
  if (m < 1000) return `${Math.round(m / 10) * 10} m away`;
  return `${(m / 1000).toFixed(m < 10000 ? 1 : 0)} km away`;
}
function units(v: string) {
  const n = Number(v.replace(",", "."));
  return Number.isFinite(n) ? Math.round(n * GOLD) : 0;
}
function CoinIcon() {
  return (
    <span className="gold-icon" aria-hidden="true">
      <GameObjectArt kind="coin" size={20} />
    </span>
  );
}
function Badge({
  children,
  tone = "purple",
}: {
  children: ReactNode;
  tone?: string;
}) {
  return <span className={`badge ${tone}`}>{children}</span>;
}

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
  const [player, setPlayer] = useState<Player | null>(null),
    [loaded, setLoaded] = useState(false),
    [meUnreachable, setMeUnreachable] = useState(false),
    [worldData, setWorld] = useState<World | null>(null),
    [position, setPosition] = useState<Point>(HOME),
    [fix, setFix] = useState<Fix | null>(null),
    [arena, setArena] = useState(true),
    [globe, setGlobe] = useState(false),
    [overview, setOverview] = useState(false),
    [follow, setFollow] = useState(true),
    [busy, setBusy] = useState(""),
    [toast, setToast] = useState<{ text: string; error: boolean } | null>(null),
    [online, setOnline] = useState(navigator.onLine),
    [presence, setPresence] = useState(false),
    [presenceUntil, setPresenceUntil] = useState(0),
    [others, setOthers] = useState<NearbyExplorer[]>([]),
    [showNpc, setShowNpc] = useState(false),
    [actorOpen, setActorOpen] = useState<ActorView | null>(null),
    [now, setNow] = useState(Date.now()),
    [menu, setMenu] = useState(false);
  const [feedback, setFeedback] = useState<FeedbackPreferences>(() =>
    loadFeedbackPreferences(),
  );
  useEffect(() => subscribeFeedback(setFeedback), []);
  // Once there is a player, fetch the map and the split-off screens in the
  // background so later taps do not wait for the network.
  const hasPlayer = !!player;
  useEffect(() => {
    if (!hasPlayer) return;
    void preloadGameMap().catch(() => {});
    const idle =
      window.requestIdleCallback ??
      ((f: () => void) => window.setTimeout(f, 200));
    idle(() => preloadPanels());
  }, [hasPlayer]);
  const firstSession = useFirstSession(player);
  const world =
    worldOwner.current === player?.id && worldData?.arena === arena
      ? worldData
      : null;
  const navigation = useAppNavigation(player?.id);
  const [creatorCapability, setCreatorCapability] = useState<{
    playerId: string;
    enabled: boolean;
  } | null>(null);
  const creatorsEnabled =
    creatorCapability?.playerId === player?.id &&
    creatorCapability?.enabled === true;
  const creatorPlaces = useCreatorPlaces(player?.id ?? null);
  const { tab, walletView, sheetExpanded, taskRealm, notesView, creatorView } =
    navigation;
  const navigationContext = useRef({ signature: "", revision: 0 });
  const navigationSignature = JSON.stringify([
    tab,
    walletView,
    sheetExpanded,
    taskRealm,
    notesView,
    creatorView,
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
            : "Your secured collection could not load. Try again in a moment.",
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
          new Error("Account link cancelled. You can keep exploring."),
          {
            code: "WALLET_CANCELLED",
          },
        ),
      );
  }
  const [nativePlay, setNativePlay] = useState(() => {
    try {
      return localStorage.getItem("questlayer-play-mode") === "near";
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
    invisibleStatus = invisible.status;
  useEffect(() => {
    // Prepare the invisible account in the background; play never waits for it.
    if (player?.id) void invisibleEnsure();
  }, [player?.id, invisibleEnsure]);
  useEffect(() => {
    // The managed account appears in the player's linked accounts once ready.
    // When the host also attests native rewards, play moves to the real
    // ledger automatically unless the player chose a ledger in Advanced.
    if (invisibleStatus !== "ready") return;
    void me();
    let chosen = false;
    try {
      chosen = localStorage.getItem("questlayer-play-mode-chosen") === "1";
    } catch {}
    if (chosen) return;
    void fetch("/api/health", { credentials: "same-origin" })
      .then((r) => r.json())
      .then((h) => {
        if (
          h?.nativeRewards?.status &&
          h.nativeRewards.status !== "not-configured"
        )
          setNativePlay(true);
      })
      .catch(() => {});
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
  useEffect(() => {
    if (mainPanel.current) mainPanel.current.scrollTop = 0;
  }, [tab, player?.id]);
  const nativeGame = useNativeGame(
    !!player &&
      nativeAccount.ready &&
      (nativePlay ||
        tab === "expeditions" ||
        (tab === "wallet" && walletView === "rewards")),
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
      setMenu(false);
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
      !menu &&
      !walletChoices &&
      !discovery &&
      !showNpc,
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
  const nextWorldRefresh = useRef(0),
    collecting = useRef(new Set<string>()),
    collectionRun = useRef<AbortController | null>(null),
    gps = useRef<number | null>(null),
    latest = useRef({ world, position, fix, arena, player, nativePlay });
  latest.current = { world, position, fix, arena, player, nativePlay };
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
      arena: state.arena,
      worldArena: state.world?.arena,
      endsAt: state.world?.endsAt,
      nativePlay: state.nativePlay,
      loading: worldLoading.current,
      visible: !document.hidden,
      online: navigator.onLine,
    };
  }
  const actionVersion = useRef(0);
  const gpsVersion = useRef(0);
  const ownerContext = () => latest.current.player?.id || "signed-out";
  const worldContext = (kind: "replace" | "refresh") =>
    JSON.stringify([
      ownerContext(),
      latest.current.arena,
      kind,
      ...(kind === "refresh" ? [latest.current.world?.id] : []),
    ]);
  function notify(text: string, error = false) {
    setToast({ text, error });
  }
  function updateOwnedPlayer(next: Player) {
    if (latest.current.player?.id !== next.id) return;
    playerReads.current.invalidate();
    setPlayer((current) => (current?.id === next.id ? next : current));
  }
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
        e instanceof Error ? e.message : "Something went wrong. Try again.",
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
  async function loadWorld(location: Point, asArena: boolean) {
    collectionRun.current?.abort();
    collectionRun.current = null;
    const token = worldReads.current.begin(
      JSON.stringify([ownerContext(), asArena, "replace"]),
    );
    worldLoading.current = true;
    setBusy("world");
    try {
      const w = await api<World>("/world", { location, arena: asArena });
      if (
        worldReads.current.isCurrent(token, worldContext("replace")) &&
        w.arena === asArena
      ) {
        worldOwner.current = latest.current.player?.id;
        setWorld(w);
      }
    } catch (e) {
      if (worldReads.current.isCurrent(token, worldContext("replace")))
        notify(
          e instanceof Error
            ? e.message
            : "This area could not load. Try again in a moment.",
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
      worldLoading.current
    )
      return;
    const token = worldReads.current.begin(worldContext("refresh"));
    try {
      const w = await api<World>(
        `/world?id=${encodeURIComponent(state.world.id)}`,
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
    setPosition(HOME);
    setArena(true);
    setPresence(false);
    setPresenceUntil(0);
    setOthers([]);
    setBusy("");
    setToast(null);
    setMenu(false);
    if (player) void loadWorld(HOME, true);
  }, [player?.id]);
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
      setWorld((w) =>
        w ? { ...w, coins: w.coins.filter((c) => c.id !== d.id) } : w,
      );
    });
    s.addEventListener("quest", () => {
      if (latest.current.player?.id === owner) void refreshWorld();
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
    };
  }, [player?.id]);
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
              alreadyClaimed?: boolean;
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
  const profileButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!menu) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !document.querySelector("dialog[open]")) {
        setMenu(false);
        profileButton.current?.focus();
      }
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [menu]);
  useEffect(() => {
    setPresence(false);
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
      void api<{ players: NearbyExplorer[] }>(
        `/presence?arena=${mode ? 1 : 0}&lat=${latest.current.position.lat.toFixed(2)}&lng=${latest.current.position.lng.toFixed(2)}`,
      )
        .then((r) => {
          if (
            active &&
            version === requestVersion &&
            mode === latest.current.arena
          )
            setOthers(r.players);
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
    if (!arena || nativePlay || !player) return;
    const key = (e: KeyboardEvent) => {
      if (
        e.defaultPrevented ||
        e.metaKey ||
        e.ctrlKey ||
        e.altKey ||
        document.querySelector("dialog[open]") ||
        (e.target as HTMLElement).closest(
          "button,a,main,form,[contenteditable=true]",
        )
      )
        return;
      if (
        (e.target as HTMLElement).matches("input,textarea,select") ||
        ![
          "ArrowUp",
          "ArrowDown",
          "ArrowLeft",
          "ArrowRight",
          "w",
          "a",
          "s",
          "d",
        ].includes(e.key)
      )
        return;
      e.preventDefault();
      stopWalk();
      setPosition((p) => ({
        lat:
          p.lat +
          (["ArrowUp", "w"].includes(e.key)
            ? 0.000065
            : ["ArrowDown", "s"].includes(e.key)
              ? -0.000065
              : 0),
        lng:
          p.lng +
          (["ArrowRight", "d"].includes(e.key)
            ? 0.0001
            : ["ArrowLeft", "a"].includes(e.key)
              ? -0.0001
              : 0),
      }));
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [arena, nativePlay, player?.id]);
  useEffect(() => {
    if (!presence || !player) return;
    if (document.visibilityState !== "visible") {
      setPresence(false);
      return;
    }
    const leaseId = crypto.randomUUID();
    setPresenceUntil(0);
    let active = true;
    const send = (renew = false) => {
      if (!active || document.visibilityState !== "visible") return;
      return api<{ enabled: boolean; expiresAt?: number }>("/presence", {
        enabled: true,
        leaseId,
        renew,
        arena: latest.current.arena,
        ...latest.current.position,
      })
        .then((r) => {
          if (!active) return;
          if (!r.enabled) {
            setPresence(false);
            notify("Position sharing ended. Share again to stay visible.");
          } else if (r.expiresAt) setPresenceUntil(r.expiresAt);
        })
        .catch(() => {
          // The first lease decides whether sharing started at all; a missed
          // renewal is retried on the next tick.
          if (!active || !renew) return;
          setPresence(false);
          notify(
            "Your position could not be shared. Check your connection and try again.",
            true,
          );
        });
    };
    void send(true);
    const t = setInterval(() => send(false), 10_000);
    const stop = () => {
      if (!active) return;
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
    const visibility = () => {
      if (document.visibilityState !== "visible") {
        stop();
        setPresence(false);
      }
    };
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("pagehide", stop);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("pagehide", stop);
    };
  }, [presence, player?.id]);
  useEffect(
    () => () => {
      if (gps.current !== null) navigator.geolocation.clearWatch(gps.current);
    },
    [],
  );
  const walkTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const stopWalk = () => {
    if (walkTimer.current !== null) clearInterval(walkTimer.current);
    walkTimer.current = null;
  };
  useEffect(() => stopWalk, []);
  useEffect(() => {
    if (!arena || nativePlay) stopWalk();
  }, [arena, nativePlay]);
  const [streetFindTarget, setStreetFindTarget] = useState<string | null>(null);
  function goToStreetFind(coin: { id: string; lat: number; lng: number }) {
    setStreetFindTarget(coin.id);
    if (arena && !nativePlay) move(coin);
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
      else if (arena) move(coin);
      else setFollow(false);
      return;
    }
    if (step === "chest") {
      const chest = nearestChest();
      if (chest) selectZone(chest.zone, chest.quest.id);
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
        notify(`Equipped ${aura.name}. Your new glow is on the map.`);
      });
      return;
    }
    if (step === "secure") {
      const reward = adventureResults.results.find(
        (r) => r.reward?.item?.kind === "aura",
      );
      if (reward) inspectAdventureResult(reward.id);
      else setTab("inventory");
    }
  }
  function move(p: Point) {
    if (!arena || nativePlay) return;
    stopWalk();
    setOverview(false);
    setFollow(true);
    const from = latest.current.position,
      { point } = cappedWalkTarget(from, p),
      steps = prefersReducedMotion() ? [point] : walkSteps(from, point);
    setPosition(steps.shift()!);
    if (!steps.length) return;
    walkTimer.current = setInterval(() => {
      const next = steps.shift();
      if (next) setPosition(next);
      if (!steps.length) stopWalk();
    }, WALK_STEP_MS);
  }
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
    const quest = world?.quests.find((q) => q.id === questId);
    const zone = world?.zones.find(
      (z) =>
        z.id === quest?.zone_id ||
        quest?.id === z.id.replace(":zone:", ":quest:"),
    );
    if (!zone) return;
    setSelected(zone, questId);
    setSheetExpanded(true);
    requestAnimationFrame(() => {
      const target = document.getElementById("quest-" + questId);
      target?.focus({ preventScroll: true });
      target?.scrollIntoView({ block: "nearest", behavior: "auto" });
    });
  }
  function selectZone(z: Zone, questId?: string) {
    setSheetExpanded(true);
    setSelected(z, questId || null);
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
    setTab("explore");
    setSheetExpanded(false);
    requestAnimationFrame(() => {
      const panel = mainPanel.current;
      const candidates = panel?.querySelectorAll<HTMLElement>(
        ".compact-selection, .native-objective-open, .quest-detail, .sheet-toggle",
      );
      const target = [...(candidates || [])].find(
        (element) => element.getClientRects().length > 0,
      );
      (target || panel)?.focus({ preventScroll: true });
    });
  }
  const questPoint = (q: Quest) => q.nextPoint || q;
  function returnToArena() {
    gpsVersion.current++;
    if (gps.current !== null) navigator.geolocation.clearWatch(gps.current);
    gps.current = null;
    setFix(null);
    setArena(true);
    setPosition(HOME);
    void loadWorld(HOME, true);
  }
  async function locate() {
    if (!navigator.geolocation) {
      notify(
        "This browser cannot share your location. Keep exploring in the city demo.",
        true,
      );
      return;
    }
    const owner = ownerContext();
    const version = ++gpsVersion.current;
    const current = () =>
      ownerContext() === owner && gpsVersion.current === version;
    setBusy("gps");
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
          },
          () => {
            if (current())
              notify(
                "Waiting for a fresh GPS fix. Step into the open or try again in a moment.",
                true,
              );
          },
          { enableHighAccuracy: true, maximumAge: 0 },
        );
      },
      () => {
        if (!current()) return;
        setBusy("");
        notify(
          "Allow location access, or keep exploring in the city demo.",
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
      const response = await startRegistration({ optionsJSON: r.options });
      const verified = await api<{ player: Player }>("/passkey/verify", {
        challengeId: r.challengeId,
        response,
      });
      setPlayer(verified.player);
      notify("Your explorer is secured with a passkey.");
    });
  }
  async function resolveSigner(): Promise<{
    signer: NativeSigner;
    accountId: string;
  }> {
    const managed = invisible.signer;
    if (managed && (!playAccount || playAccount === managed.accountId))
      return { signer: managed, accountId: managed.accountId };
    const { wallet, accountId } = await chooseNearAccount();
    return { signer: walletSigner(wallet, accountId), accountId };
  }
  // Public profile and note records name their account up front: the
  // explorer account signs without a popup, any other linked one uses a wallet.
  async function signerForAccount(account: string) {
    const managed = invisible.signer;
    if (managed && managed.accountId === account)
      return { signer: managed, accountId: managed.accountId };
    if (!managed && !playAccount) return resolveSigner();
    const { wallet, accountId } = await chooseNearAccount();
    return { signer: walletSigner(wallet, accountId), accountId };
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
          heading: `QuestLayer · ${NETWORK_LABEL}`,
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
      setWalletChoices(choices);
    });
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => resolve()),
    );
    const wallet = await connector.connect({ walletId });
    const accounts = await wallet.getAccounts();
    if (!accounts[0])
      throw new Error(
        "The wallet did not return an account. Try again or pick another wallet.",
      );
    return { wallet, accountId: accounts[0].accountId };
  }
  async function connectNear(
    options: { signIn?: boolean; name?: string } = {},
  ) {
    if (options.signIn) {
      options.name = options.name?.trim() || "Explorer";
      if (options.name.length < 2 || options.name.length > 24) {
        notify("Pick a name between 2 and 24 characters.", true);
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
      if (options.signIn) setNativePlay(true);
      notify(
        options.signIn
          ? r.returning
            ? "Welcome back, explorer. Your account restored your progress."
            : "Your explorer is ready. Practice GOLD stays separate from secured rewards."
          : "Account linked. Practice GOLD stays separate from secured rewards.",
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
          ? "Your secured outfit is on the map."
          : "Your practice outfit is on the map.",
      );
    });
  }
  async function tradeNative(request: NativeTradeRequest): Promise<boolean> {
    const result = await action("native-market", async () => {
      const { signer, accountId } = await resolveSigner();
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
    const result = await action("native-market", async () => {
      hash = (await send(signerId)) || null;
      await refreshNative(true);
      return true;
    });
    if (result !== true)
      throw Error("The action was not sent. Nothing changed.");
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
      : player?.wallets[0]
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
  async function withdrawNativeReward(
    expectedAccount: string,
    contractId: string,
  ): Promise<boolean> {
    const result = await action("native-withdrawal", async () => {
      const { signer, accountId } = await resolveSigner();
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
      const { signer, accountId } = await resolveSigner();
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
      const { signer, accountId } = await resolveSigner();
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
          notify("Your explorer profile is now public.");
          return true;
        }
        await new Promise((resolve) => setTimeout(resolve, 800));
      }
      notify(
        "Profile update sent. Refresh your public profile to see it confirmed.",
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
            ? "Your note is now a public record."
            : "Your public record is marked removed."
          : "Record sent. Refresh in a moment to see it confirmed.",
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
      notify("Recovery passkey saved. Use it to restore on a new device.");
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
      notify(`Device revoked.${signedOut}`);
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
      notify("This device can now play with your explorer.");
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
        `${result.revokedSessions} other session(s) signed out. This browser stays signed in.`,
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
      notify("Reward secured. Find it in your Secured collection.");
      return true;
    });
    return ok === true;
  }
  async function mintNativeLevel(
    expectedAccount: string,
    milestone: NativeMilestone,
  ) {
    const ok = await action("native-level", async () => {
      const { signer, accountId } = await resolveSigner();
      if (
        accountId !== expectedAccount ||
        !player?.wallets.some((w) => w.account_id === accountId)
      )
        throw Error("Choose the linked account shown for this level reward.");
      const claim = await api<NativeLevelClaim>("/native/progression/claim", {
        accountId,
        level: milestone.level,
      });
      assertNativeLevelClaim(
        claim,
        accountId,
        milestone.level,
        milestone.edition,
      );
      if (claim.claim_id !== milestone.claimId)
        throw Error("The level reward changed. Refresh, then try again.");
      if (claim.state !== "minted") {
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
          if (checked.state === "minted") {
            await refreshNative(true);
            notify("Reward collected. Try it on from your Secured collection.");
            return true;
          }
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }
        throw Error(
          "Your level reward is still confirming. Use Check claim before trying again.",
        );
      }
      await refreshNative(true);
      notify("You already collected this level reward.");
      return true;
    });
    return ok === true;
  }
  async function mintEarnedAura(item: Item): Promise<boolean> {
    const done = await action("native-claim", async () => {
      try {
        const { signer, accountId } = await resolveSigner();
        if (!player?.wallets.some((w) => w.account_id === accountId))
          throw Error("Choose the linked account that receives this Aura.");
        const claim = await api<NativeAuraClaim>("/native/claims", {
          itemId: item.id,
          accountId,
        });
        await me();
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
        let minted = false;
        for (let attempt = 0; attempt < 5; attempt++) {
          const result = await api<{ claim: NativeAuraClaim; player: Player }>(
            "/native/claims/confirm",
            { itemId: item.id },
          );
          updateOwnedPlayer(result.player);
          if (result.claim.state === "minted") {
            minted = true;
            break;
          }
          await new Promise((resolve) => setTimeout(resolve, 800));
        }
        if (!minted)
          throw Error(
            "Your Aura is still being secured. Use Check claim before retrying.",
          );
        await refreshNative(true);
        notify("Your Aura is secured. Try it on from your Secured collection.");
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
          ? "Your Aura is secured."
          : "Not secured yet. Finish the claim, or restore the practice Aura after it expires.",
      );
    });
  }
  async function restoreDemoAura(item: Item) {
    await action("native-claim-restore", async () => {
      const result = await api<{ player: Player }>("/native/claims/restore", {
        itemId: item.id,
      });
      updateOwnedPlayer(result.player);
      notify("Your Aura is back in your practice collection.");
    });
  }
  async function nativeTransaction(
    method: "mint_avatar" | "equip_aura" | "unequip_aura",
    account: string,
    item?: NativeItem,
    slot?: "above" | "below",
  ) {
    await action("native-transaction", async () => {
      const { signer, accountId } = await resolveSigner();
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
          ? "Your explorer is secured."
          : method === "unequip_aura"
            ? "Aura taken off your secured outfit."
            : "Equipped. Your secured Aura is glowing on the map.",
      );
    });
  }
  async function connectEvm() {
    await action("evm", async () => {
      const injected = (window as any).ethereum;
      if (!injected)
        throw new Error(
          "Open QuestLayer in a browser with an Aavegotchi wallet to link an original.",
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
        "Address linked. Your originals stay where they are; here you only wear them.",
      );
    });
  }
  function inspectAdventureResult(id: string) {
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
          "Outfit change not confirmed yet. Check your collection before retrying.",
        );
      adventureResults.close();
      setSelected(null);
      setSheetExpanded(false);
      setFollow(true);
      setTab("explore");
      notify("Equipped. Your new glow is on the map.");
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
          progress?: { completed: number; total: number };
        }>(
          q?.kind === "route" && (q.checkpoint || 0) < (q.checkpointCount || 0)
            ? "/quests/checkpoint"
            : "/quests/claim",
          {
            questId: qId,
            checkpoint: q?.checkpoint || 0,
            fix: arena
              ? { ...position, accuracy: 0, timestamp: Date.now() }
              : fix,
          },
        );
        if (latest.current.player?.id !== owner) return;
        updateOwnedPlayer(r.player);
        if (latest.current.arena !== realm || latest.current.nativePlay) return;
        const sameView =
          adventureResults.isCurrentInspection(inspection) &&
          navigationContext.current.revision === navigationRevision;
        if (sameView && r.result) adventureResults.accept(r.result);
        if (!r.replayed && !r.awaiting) cue(r.item ? "reward" : "step");
        if (sameView && r.awaiting)
          notify(
            `Stop ${r.progress?.completed} of ${r.progress?.total} confirmed. Walk to the next stop.`,
          );
        else if (sameView && !r.replayed)
          notify(
            r.item
              ? `Reward collected: ${r.item.name} is yours. Try it on!`
              : `Reward collected: +${r.xp} XP${r.reward ? ` and ${gold(r.reward)} practice GOLD` : ""}.`,
          );
        else if (sameView) setToast(null);
        await refreshWorld();
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
  const activeZones = world?.zones.filter((z) => z.closesAt > now) || [];
  const nearbyZones = [...activeZones].sort(
    (a, b) =>
      Number(a.tier > (player?.tier || 1)) -
        Number(b.tier > (player?.tier || 1)) ||
      meters(position, a) - meters(position, b),
  );
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
  const coachActive = firstSession.visible && !nativePlay;
  const coachStep = coachActive ? firstSession.progress.current?.id : undefined;
  const coachChest = coachStep === "chest" ? nearestChest() : null;
  const coachLabel =
    coachStep === "chest"
      ? coachChest
        ? coachChest.d > 25
          ? "Walk to the chest"
          : "Open the chest"
        : "See what's open"
      : coachStep === "find" && !nearestCoin(true)
        ? "Walk to a coin"
        : null;
  const zoneQuests = (world?.quests || []).filter(
    (q) =>
      q.zone_id === selected?.id ||
      q.id === selected?.id.replace(":zone:", ":quest:"),
  );
  const zoneQuest =
    zoneQuests.find((q) => q.id === selectedQuestId) ||
    zoneQuests.find(
      (q) => !q.completed && q.opens_at <= now && q.closes_at > now,
    ) ||
    zoneQuests[0];
  const title =
    tab === "explore"
      ? nativePlay
        ? "Nearby walks"
        : "Nearby discoveries"
      : nav.find((n) => n.id === tab)?.label ||
        {
          messages: "Map notes",
          bounties: "Community tasks",
          community: "Community",
          settings: "Settings",
          fund: "Game economy",
          funding: "How rewards are funded",
          fuel: "Fuel the city",
          expeditions: "Nearby walks",
          inventory: "Inventory",
          market: "Market",
          wallet: "Wallet",
        }[tab] ||
        "QuestLayer";
  return (
    <div className="app-shell">
      {player ? (
        <GameMap
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
          nativeTarget={
            nativeTarget ||
            (findTarget
              ? {
                  lat: findTarget.lat,
                  lng: findTarget.lng,
                  label: `Street find · +${world?.streetFindXp ?? 15} XP`,
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
          skinUrl={
            player?.appearance?.originTokenId
              ? `/api/aavegotchi/skin?tokenId=${encodeURIComponent(player.appearance.originTokenId)}`
              : undefined
          }
          onMove={move}
          onZone={(z) =>
            nativePlay
              ? chooseNativeQuest(Number(z.id.split(":zone:")[1]))
              : selectZone(z)
          }
          follow={follow}
          onPan={() => setFollow(false)}
          creatorPlaces={creatorPlaces}
          onCreatorPlace={(questId) => {
            setTab("community");
            setCreatorView({ page: "quest", questId });
            setSheetExpanded(true);
            setFollow(false);
          }}
          actorsWorldId={world?.id || null}
          onActor={setActorOpen}
        />
      ) : (
        // MapLibre and the map style load only after the name step, so the
        // welcome screen ships without them (see scripts/check-bundle-budget.mjs).
        <div className="game-map map-placeholder" aria-hidden="true" />
      )}
      <div className="map-vignette" />
      <aside className="nav-rail">
        <button
          className="brand-mark"
          aria-label="QuestLayer home"
          onClick={() => {
            setTab("explore");
          }}
        >
          <Ghost />
        </button>
        <div className="rail-links">
          {nav.map((n) => (
            <button
              key={n.id}
              className={navigationActive(tab, n.id) ? "active" : ""}
              aria-current={navigationActive(tab, n.id) ? "page" : undefined}
              onClick={() => {
                setTab(n.id);
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
        <div className="wordmark" onClick={() => setTab("explore")}>
          <span>
            QUEST<span>LAYER</span>
          </span>
        </div>
        <div className="realm-label">
          <span className="status-dot" />
          <span>
            {nativePlay || !arena
              ? world?.cityName || "Your surroundings"
              : "Plzeň · city demo"}
          </span>
        </div>
        <div className="topbar-right">
          {player && (
            <>
              <button
                className="balance-pill"
                onClick={() => {
                  setWalletView(nativePlay ? "rewards" : "demo");
                  setTab("wallet");
                }}
              >
                <CoinIcon />
                <b>
                  {nativePlay
                    ? nativeGame.state?.balance
                      ? (
                          Number(
                            BigInt(nativeGame.state.balance.credit) /
                              1000000000000000n,
                          ) / 1e6
                        ).toLocaleString("en-US", { maximumFractionDigits: 3 })
                      : "—"
                    : gold(player.gold_u)}
                </b>
                <span>GOLD</span>
              </button>
              <button
                ref={profileButton}
                className="profile-pill"
                aria-label="Explorer profile"
                aria-expanded={menu}
                aria-controls="explorer-profile"
                onClick={() => setMenu((v) => !v)}
              >
                <Character
                  items={appearanceItems}
                  originTokenId={player.appearance.originTokenId}
                  compact
                />
                <span>
                  <b>{player.name}</b>
                  <small>
                    {hudLevel !== null ? `Level ${hudLevel}` : "Explorer"}
                  </small>
                </span>
                <span className="level-bubble">{hudLevel ?? "—"}</span>
              </button>
            </>
          )}
        </div>
      </header>
      {menu && player && (
        <div id="explorer-profile" className="profile-menu">
          <b>{player.name}</b>
          <span>Your explorer and progress are saved on this device.</span>
          <button
            onClick={() => {
              setTab("settings");
              setMenu(false);
            }}
          >
            <GearSix />
            Profile and settings
          </button>
          <details className="presence-consent">
            <summary>Location sharing</summary>
            <p>
              Sharing shows your name, look and map position to nearby explorers
              for up to 15 minutes while this tab is open. Players you blocked
              never see you, and you never see them.
            </p>
          </details>
          <button onClick={() => setPresence((x) => !x)}>
            {presence ? <EyeSlash /> : <Eye />}
            {presence
              ? "Stop sharing my position"
              : "Share my position for 15 min"}
          </button>
          <button
            onClick={() =>
              void action("logout", async () => {
                await api("/logout", {});
                setPlayer(null);
                setWorld(null);
                setMenu(false);
                setPresence(false);
              })
            }
          >
            <SignOut /> Sign out
          </button>
        </div>
      )}
      {player && (
        <main
          ref={mainPanel}
          tabIndex={-1}
          className={`main-panel ${tab === "explore" ? `explore-panel ${sheetExpanded ? "sheet-expanded" : "sheet-compact"}` : ""}`}
        >
          {tab !== "explore" &&
            (selected || (nativePlay && nativeObjective.reference)) && (
              <button className="adventure-return" onClick={returnToAdventure}>
                <ArrowLeft size={20} aria-hidden="true" />
                <span>
                  <strong>Back to adventure</strong>
                  <small>{selected?.name || nativeObjective.view.label}</small>
                </span>
              </button>
            )}
          {tab === "explore" && (
            <button
              className="sheet-toggle"
              aria-expanded={sheetExpanded}
              onClick={() => setSheetExpanded((v) => !v)}
            >
              <span className="sheet-toggle-label">
                {sheetExpanded ? "Show map" : "Show discoveries"}
                {!nativePlay && (
                  <PickupSummary totals={pickupFeedback.totals} />
                )}
              </span>
              <ArrowRight
                size={20}
                style={{
                  transform: sheetExpanded ? "rotate(90deg)" : "rotate(-90deg)",
                }}
              />
            </button>
          )}
          {tab === "explore" && !nativePlay && adventureResults.unread && (
            <AdventureResultResume
              result={adventureResults.unread}
              onInspect={() =>
                inspectAdventureResult(adventureResults.unread!.id)
              }
            />
          )}
          {tab === "explore" && adventureNotice && (
            <button
              className="adventure-notice"
              onClick={() => {
                dismissAdventureNotice();
                setSheetExpanded(true);
              }}
            >
              <Compass size={24} aria-hidden="true" />
              <span>
                <strong>Choose another discovery</strong>
                <small role="status">{adventureNotice}</small>
              </span>
              <ArrowRight size={20} aria-hidden="true" />
            </button>
          )}
          {tab === "explore" &&
            coachActive &&
            !(selected && coachStep === "chest") && (
              <FirstSessionCoach
                session={firstSession}
                worldId={world?.id}
                position={position}
                busy={!!busy}
                onAction={runFirstStep}
                actionLabel={coachLabel}
              />
            )}
          {tab === "explore" && selected && (
            <button
              className="compact-selection"
              onClick={() => setSheetExpanded(true)}
            >
              <GameObjectArt
                {...zoneObjectPresentation(selected, world?.quests || [], {
                  now,
                  playerTier: player.tier,
                })}
                size={32}
              />
              <span>
                <strong>{selected.name}</strong>
                <small>See what's here</small>
              </span>
              <ArrowRight />
            </button>
          )}
          {tab === "explore" && nativePlay && nativeObjective.reference && (
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
                aria-label="Clear saved walk"
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
            <div>
              <h1 tabIndex={-1}>
                {tab === "explore" && selected ? selected.name : title}
              </h1>
            </div>
            {tab !== "explore" && (
              <button
                className="icon-button"
                onClick={() => setTab("explore")}
                aria-label="Close panel"
              >
                <X size={20} />
              </button>
            )}
          </div>
          {tab === "explore" && !selected && !nativePlay && (
            <>
              {!world?.zones.length && !recommendation && world && (
                <div className="explore-empty" role="status">
                  <strong>Nothing open right here yet</strong>
                  <p>
                    Today's discoveries are still being placed. Pull the map to
                    look around, or check back in a few minutes.
                  </p>
                </div>
              )}
              {world && world.zones.length > 0 && !recommendation && (
                <div className="explore-empty" role="status">
                  <strong>You've done everything open for you today</strong>
                  <p>
                    New discoveries open with the next day. Coins on the streets
                    still count while you walk.
                  </p>
                </div>
              )}
              {!coachStep &&
                recommendedFind &&
                !nativeTarget &&
                !adventureNotice && (
                  <button
                    className="recommended-quest"
                    onClick={() => goToStreetFind(recommendedFind.coin)}
                  >
                    <span className="recommended-art">
                      <GameObjectArt kind="discovery" size={32} />
                    </span>
                    <span>
                      <small>Nearest find</small>
                      <strong>
                        Street find · +{world?.streetFindXp ?? 15} XP
                      </strong>
                      <span>
                        On a mapped path ·{" "}
                        {distanceLabel(recommendedFind.distance)}
                        {arena && recommendedFind.distance > WALK_CAP_M
                          ? ` · walk in ${Math.ceil(recommendedFind.distance / WALK_CAP_M)} steps`
                          : ""}
                      </span>
                    </span>
                    <ArrowRight size={20} />
                  </button>
                )}
              {!coachStep &&
                recommended &&
                recommendedZone &&
                !nativeTarget &&
                !adventureNotice && (
                  <button
                    className="recommended-quest"
                    onClick={() => selectZone(recommendedZone, recommended.id)}
                  >
                    <span className="recommended-art">
                      <GameObjectArt
                        {...questObjectPresentation(recommended, {
                          now,
                          playerTier: player.tier,
                        })}
                        size={32}
                      />
                    </span>
                    <span>
                      <small>Nearest discovery</small>
                      <strong>{recommended.title}</strong>
                      <span>
                        {recommendedZone.name} ·{" "}
                        {distanceLabel(
                          meters(position, questPoint(recommended)),
                        )}
                      </span>
                    </span>
                    <ArrowRight size={20} />
                  </button>
                )}
              <div className="day-row">
                <Badge tone="green">
                  <Leaf size={12} /> {world?.cityName || "Your surroundings"}
                </Badge>
                <span>
                  <Clock size={13} /> Refresh in{" "}
                  {world ? remaining(world.endsAt) : "…"}
                </span>
              </div>
              <TodaysPot practice onOpen={() => setTab("funding")} />
              <div className="section-label">
                <h2>Nearby discoveries</h2>
                <span>
                  {world?.cityZoneCount ?? activeZones.length} places today
                </span>
              </div>
              {world?.quality && (
                <details className="coverage-note">
                  <summary>About this map</summary>
                  <p>{world.quality.notice}</p>
                </details>
              )}
              <div className="zone-list">
                {nearbyZones.map((z, i) => {
                  const q = representativeZoneQuest(z, world?.quests || [], {
                    now,
                    playerTier: player.tier,
                  });
                  const activityArt = q
                    ? questObjectPresentation(q, {
                        now,
                        playerTier: player.tier,
                      })
                    : null;
                  return (
                    <button
                      className="zone-card"
                      key={z.id}
                      onClick={() => selectZone(z)}
                    >
                      <div className={`zone-illustration art-${z.kind}`}>
                        <span className="illustration-orb" />
                        <span>
                          <GameObjectArt
                            {...zoneObjectPresentation(z, world?.quests || [], {
                              now,
                              playerTier: player.tier,
                            })}
                            size={64}
                          />
                        </span>
                        <i />
                        <i />
                      </div>
                      <div className="zone-info">
                        <div>
                          <Badge tone={z.tier === 1 ? "green" : "purple"}>
                            {z.tier === 1 ? "FREE" : `TIER ${z.tier}`}
                          </Badge>
                          {z.opensAt > now && (
                            <small>Opens in {remaining(z.opensAt)}</small>
                          )}
                          <small>{distanceLabel(meters(position, z))}</small>
                        </div>
                        <h3>{z.name}</h3>
                        <div className="zone-rewards">
                          <span>
                            <Sparkle size={12} />
                            {q
                              ? q.completed
                                ? "Completed"
                                : `${q.xp} XP`
                              : "See what's here"}
                          </span>
                          {q?.gold_u && !q.claimant ? (
                            <span>
                              <CoinIcon />
                              {gold(q.gold_u)} GOLD
                            </span>
                          ) : (
                            <span>
                              <GameObjectArt kind="discovery" size={20} />
                              {!q
                                ? "Details"
                                : activityArt?.state === "locked"
                                  ? activityArt.label
                                  : q.completed
                                    ? "Completed"
                                    : q.kind === "chest" &&
                                        q.itemAvailable === true
                                      ? "Aura chest"
                                      : "XP visit"}
                            </span>
                          )}
                          <ArrowUpRight size={15} />
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
              <button
                className="subtle-link"
                onClick={() => setTab("bounties")}
              >
                Community tasks <ArrowRight size={15} />
              </button>
            </>
          )}
          {tab === "explore" && selected && (
            <>
              <button className="back-link" onClick={() => setSelected(null)}>
                <ArrowLeft size={15} /> All discoveries
              </button>
              <div className="zone-access">
                <Badge tone={selected.tier === 1 ? "green" : "purple"}>
                  {selected.tier === 1 ? "Free zone" : `Tier ${selected.tier}`}
                </Badge>
                <span>{zoneQuests.length} activities</span>
              </div>
              {selected.tier > player.tier ? (
                <div className="locked-panel">
                  <LockKey size={25} />
                  <h3>Opens at Tier {selected.tier}</h3>
                  <p>
                    This place needs{" "}
                    {selected.tier === 2 ? "50 000" : "100 000"} GOLD of
                    weighted practice stake. Free places nearby are open to
                    everyone.
                  </p>
                  <p>
                    Practice stake is play money you can withdraw. It does not
                    promise a GOLD prize in every place.
                  </p>
                  <button
                    className="primary-button"
                    onClick={() => {
                      setWalletView("demo");
                      setTab("wallet");
                    }}
                  >
                    Try practice staking <ArrowRight />
                  </button>
                </div>
              ) : (
                (zoneQuest ? [zoneQuest] : []).map((q) => (
                  <div
                    className="quest-detail"
                    role="region"
                    aria-label={q.title}
                    tabIndex={-1}
                    key={q.id}
                    id={"quest-" + q.id}
                  >
                    <div className="section-label">
                      <h2>{q.title}</h2>
                      <Badge tone="green">
                        {q.completed
                          ? "COMPLETED"
                          : now < q.opens_at
                            ? "OPENS LATER"
                            : now >= q.closes_at
                              ? "CLOSED"
                              : "OPEN"}
                      </Badge>
                    </div>
                    <p>{q.activity?.objective || q.description}</p>
                    {q.activity && (
                      <div className="play-facts">
                        <span>
                          {q.activity.icon === "return" ? (
                            <ArrowUUpLeft size={20} />
                          ) : q.activity.icon === "trail" ? (
                            <Path size={20} />
                          ) : q.activity.icon === "chest" ? (
                            <GameObjectArt
                              {...questObjectPresentation(q, {
                                now,
                                playerTier: player.tier,
                              })}
                              size={24}
                            />
                          ) : (
                            <MapPin size={20} />
                          )}
                          {
                            q.activity.steps[
                              Math.min(
                                q.checkpoint || 0,
                                q.activity.steps.length - 1,
                              )
                            ]?.label
                          }
                        </span>
                      </div>
                    )}
                    <div className="quest-prizes">
                      <span>
                        <Sparkle /> {q.xp} XP
                      </span>
                      {q.kind === "chest" && (
                        <span>
                          <GameObjectArt
                            {...questObjectPresentation(q, {
                              now,
                              playerTier: player.tier,
                            })}
                            size={24}
                          />
                          {q.completed
                            ? "Completed"
                            : q.itemAvailable === true
                              ? "Aura chest"
                              : q.itemAvailable === false
                                ? "XP only · all Auras found"
                                : "Aura not confirmed yet"}
                        </span>
                      )}
                      {q.kind === "route" && (
                        <span>
                          <Flag />
                          {q.checkpoint || 0}/{q.checkpointCount} stops
                        </span>
                      )}
                      {q.gold_u > 0 && (
                        <span>
                          <CoinIcon />
                          {q.claimant
                            ? "GOLD already collected"
                            : `${gold(q.gold_u)} GOLD`}
                        </span>
                      )}
                    </div>
                    <div className="distance-note">
                      <MapPin size={16} />
                      {distanceLabel(meters(position, questPoint(q)))} ·{" "}
                      {q.opens_at > now
                        ? `opens in ${remaining(q.opens_at)}`
                        : `closes in ${remaining(q.closes_at)}`}
                    </div>
                    {q.completed ? (
                      <button className="primary-button" disabled>
                        Reward collected <Check />
                      </button>
                    ) : arena && meters(position, questPoint(q)) > 25 ? (
                      <button
                        className="primary-button"
                        onClick={() => move(questPoint(q))}
                      >
                        {meters(position, questPoint(q)) > WALK_CAP_M
                          ? `Walk ${WALK_CAP_M} m closer`
                          : "Walk there"}{" "}
                        <NavigationArrow />
                      </button>
                    ) : (
                      <button
                        className="primary-button"
                        disabled={
                          !!busy ||
                          meters(position, questPoint(q)) > 25 ||
                          q.opens_at > now ||
                          q.closes_at <= now
                        }
                        onClick={() => void complete(q.id)}
                      >
                        {busy === "quest"
                          ? "Checking visit…"
                          : q.opens_at > now
                            ? "Not open yet"
                            : q.closes_at <= now
                              ? "Closed for today"
                              : q.kind === "route"
                                ? (q.checkpoint || 0) >=
                                  (q.checkpointCount || 0)
                                  ? "Finish walk"
                                  : `Confirm stop ${(q.checkpoint || 0) + 1}`
                                : q.kind === "chest"
                                  ? q.itemAvailable === true
                                    ? "Open chest"
                                    : "Confirm visit"
                                  : q.activity?.actionLabel || "Confirm visit"}
                        <ArrowRight />
                      </button>
                    )}
                    {q.gold_u > 0 && (
                      <p className="fine-print">
                        The GOLD prize goes to the first explorer to finish.
                        Your XP is always yours.
                      </p>
                    )}
                  </div>
                ))
              )}
              {selected.tier <= player.tier && zoneQuests.length > 1 && (
                <details className="play-details zone-activities">
                  <summary>
                    <Flag size={20} />
                    Choose another activity <span>{zoneQuests.length - 1}</span>
                  </summary>
                  <div className="walk-picker">
                    {zoneQuests
                      .filter((q) => q.id !== zoneQuest?.id)
                      .map((q) => (
                        <button
                          key={q.id}
                          onClick={() => chooseZoneQuest(q.id)}
                        >
                          <span className="play-object">
                            <GameObjectArt
                              {...questObjectPresentation(q, {
                                now,
                                playerTier: player.tier,
                              })}
                              size={32}
                            />
                          </span>
                          <span>
                            <b>{q.title}</b>
                            <small>
                              {q.completed
                                ? "Completed"
                                : `${q.xp} XP · ${q.kind === "route" ? `${q.checkpointCount} stops` : "1 stop"}`}
                            </small>
                          </span>
                          <ArrowRight size={20} />
                        </button>
                      ))}
                  </div>
                </details>
              )}
            </>
          )}
          {tab === "wallet" && (
            <PendingNativeTransactions
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
          )}
          {tab === "inventory" && (
            <>
              <Inventory
                key={player.id}
                onOriginalAppearance={(appearance) =>
                  setPlayer((current) =>
                    current?.id === player.id
                      ? { ...current, appearance }
                      : current,
                  )
                }
                map3D={map3D}
                onMap3D={toggleMap3D}
                initialCollection={nativePlay ? "near" : "demo"}
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
                    <NativeWardrobe
                      player={player}
                      data={nativeWardrobe}
                      error={nativeError}
                      busy={busy}
                      onConnect={connectNear}
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
                      onConnect={connectNear}
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
                      onConnect={connectNear}
                      onMint={mintEarnedAura}
                      onConfirm={checkAuraClaim}
                      onRestore={restoreDemoAura}
                    />
                    <NativeProfilePanel
                      player={player}
                      busy={busy}
                      onConnect={connectNear}
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
                    notify("New look equipped.");
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
                        ? "Aura taken off."
                        : "Equipped. Your new glow is on the map.",
                    );
                  })
                }
                onSell={async (item, price) => {
                  const result = await action("listing", async () => {
                    await api("/market/list", { itemId: item.id, price });
                    if (latest.current.player?.id !== player.id) return false;
                    await me();
                    if (latest.current.player?.id !== player.id) return false;
                    notify("Your Aura is on the market.");
                    return true;
                  });
                  return result === true;
                }}
              />
            </>
          )}
          {((tab === "explore" && nativePlay) ||
            tab === "expeditions" ||
            (tab === "wallet" && walletView === "rewards")) && (
            <>
              {tab === "wallet" && (
                <WalletNavigation value={walletView} onChange={setWalletView} />
              )}
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
              <NativeExpeditions
                onBusyChange={setNativeVisitBusy}
                view={tab === "wallet" ? "wallet" : "board"}
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
                onConnect={connectNear}
                onLocate={() => void locate()}
                onWithdraw={withdrawNativeReward}
                onWallet={(showReceipts = false) => {
                  setWalletView("rewards");
                  setTab("wallet");
                  if (showReceipts)
                    requestAnimationFrame(() => {
                      const details =
                        mainPanel.current?.querySelector<HTMLDetailsElement>(
                          "[data-native-receipts]",
                        );
                      if (!details) return;
                      details.open = true;
                      details
                        .querySelector("summary")
                        ?.focus({ preventScroll: true });
                      details.scrollIntoView({
                        block: "start",
                        behavior: "auto",
                      });
                    });
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
          {tab === "wallet" && walletView !== "rewards" && (
            <>
              <WalletNavigation value={walletView} onChange={setWalletView} />
              {walletView === "staking" ? (
                <NativeStaking
                  player={player}
                  onConnect={connectNear}
                  onTransaction={operateNativeVault}
                />
              ) : (
                <WalletPanel
                  player={player}
                  busy={busy}
                  action={action}
                  onPlayer={setPlayer}
                  onNear={connectNear}
                  notify={notify}
                />
              )}
            </>
          )}
          {tab === "wallet" && (
            <button className="play-entry" onClick={() => setTab("fund")}>
              <ChartDonut size={22} />
              <span>
                <b>Game economy</b>
                <small>Where rewards come from</small>
              </span>
              <ArrowRight size={20} />
            </button>
          )}
          {tab === "settings" && (
            <div className="play-menu">
              <button className="play-entry" onClick={() => setTab("market")}>
                <Storefront size={24} />
                <span>
                  <b>Market</b>
                  <small>Trade Auras with other explorers</small>
                </span>
                <ArrowRight size={20} />
              </button>
              <button className="play-entry" onClick={() => setTab("fuel")}>
                <Flame size={24} />
                <span>
                  <b>Fuel the city</b>
                  <small>Stake to grow the pot and open Tier 2 places</small>
                </span>
                <ArrowRight size={20} />
              </button>
              <button className="play-entry" onClick={() => setTab("wallet")}>
                <Wallet size={24} />
                <span>
                  <b>Rewards and balance</b>
                  <small>Your GOLD, receipts and practice staking</small>
                </span>
                <ArrowRight size={20} />
              </button>
              <AccountSessions
                player={player}
                onConnect={connectNear}
                onSecure={() => void attachPasskey()}
                onRevoke={revokeGameSessions}
                busy={busy}
              />
              <DeviceKeys
                status={invisible.status}
                accountId={invisible.accountId}
                keys={invisible.keys}
                localPublicKey={invisible.publicKey}
                busy={busy}
                onSetupRecovery={setupRecoveryPasskey}
                onRevoke={revokeDevice}
                onRestore={restoreThisDevice}
              />
              <details className="advanced-settings">
                <summary>Advanced</summary>
                <div
                  className="play-mode-switch"
                  role="group"
                  aria-label="Reward ledger"
                >
                  <button
                    aria-pressed={!nativePlay}
                    onClick={() => chooseLedger(false)}
                  >
                    Practice ledger
                  </button>
                  <button
                    aria-pressed={nativePlay}
                    onClick={() => chooseLedger(true)}
                  >
                    Test network
                  </button>
                </div>
                <p className="fine-print">
                  Practice GOLD is play money. The test network uses NEAR
                  testnet tokens. Neither has monetary value; receipts for both
                  live in Rewards and balance.
                </p>
                <button className="play-entry" onClick={() => setTab("fund")}>
                  <ChartDonut size={24} />
                  <span>
                    <b>Game economy</b>
                    <small>Where rewards come from</small>
                  </span>
                  <ArrowRight size={20} />
                </button>
              </details>
              <button
                className="play-entry"
                aria-pressed={map3D}
                onClick={toggleMap3D}
              >
                <Cube size={24} />
                <span>
                  <b>3D character: {map3D ? "On" : "Off"}</b>
                  <small>Choose 2D for a lighter map</small>
                </span>
              </button>
              <section
                className="feedback-settings"
                aria-labelledby="feedback-settings-title"
              >
                <h2 id="feedback-settings-title">
                  Sound, vibration and motion
                </h2>
                <div
                  className="play-mode-switch"
                  role="group"
                  aria-label="Vibration"
                >
                  <button
                    aria-pressed={feedback.haptics}
                    onClick={() => {
                      setFeedbackPreferences({ haptics: true });
                      cue("step");
                    }}
                  >
                    Vibration on
                  </button>
                  <button
                    aria-pressed={!feedback.haptics}
                    onClick={() => setFeedbackPreferences({ haptics: false })}
                  >
                    Off
                  </button>
                </div>
                <div
                  className="play-mode-switch"
                  role="group"
                  aria-label="Sound"
                >
                  <button
                    aria-pressed={feedback.sound}
                    onClick={() => {
                      setFeedbackPreferences({ sound: true });
                      previewSound();
                    }}
                  >
                    Sound on
                  </button>
                  <button
                    aria-pressed={!feedback.sound}
                    onClick={() => setFeedbackPreferences({ sound: false })}
                  >
                    Off
                  </button>
                </div>
                <div
                  className="play-mode-switch"
                  role="group"
                  aria-label="Motion"
                >
                  <button
                    aria-pressed={feedback.motion === "system"}
                    onClick={() => setFeedbackPreferences({ motion: "system" })}
                  >
                    Motion like my device
                  </button>
                  <button
                    aria-pressed={feedback.motion === "reduce"}
                    onClick={() => setFeedbackPreferences({ motion: "reduce" })}
                  >
                    Reduce motion
                  </button>
                </div>
                <p className="fine-print">
                  Reduce motion stops map flights, walking animation and
                  sparkles. Vibration works on phones that support it.
                </p>
                {!firstSession.visible && (
                  <button
                    className="play-entry"
                    onClick={() => {
                      firstSession.show();
                      setTab("explore");
                      setSheetExpanded(false);
                    }}
                  >
                    <Compass size={24} />
                    <span>
                      <b>Show first steps again</b>
                      <small>The short guide for new explorers</small>
                    </span>
                    <ArrowRight size={20} />
                  </button>
                )}
              </section>
              <button className="play-entry" onClick={() => setShowNpc(true)}>
                <Question size={24} />
                <span>
                  <b>Help & guide</b>
                  <small>How to play</small>
                </span>
                <ArrowRight size={20} />
              </button>
            </div>
          )}
          {tab === "funding" && (
            <RewardFundingPage
              practice={!nativePlay}
              onExplore={() => setTab("explore")}
              onLedger={() => setTab("fund")}
            />
          )}
          {tab === "fuel" && (
            <>
              <button className="back-link" onClick={() => setTab("settings")}>
                <ArrowLeft size={20} />
                Settings
              </button>
              <FuelTheCity
                player={player}
                account={
                  invisible.status === "ready" && invisible.accountId
                    ? invisible.accountId
                    : player.wallets[0]?.account_id || ""
                }
                managed={invisible.status === "ready" && !!invisible.accountId}
                cityName={world?.cityName}
                onConnect={connectNear}
                onTransaction={operateNativeVault}
              />
            </>
          )}
          {tab === "fund" && (
            <>
              <button className="back-link" onClick={() => setTab("settings")}>
                <ArrowLeft size={20} />
                Settings
              </button>
              <NativeEconomyPanel />
              <details className="play-details">
                <summary>Practice economy simulation</summary>
                <FundPanel />
              </details>
            </>
          )}
          {tab === "community" && (
            <>
              <details className="play-details" open={!creatorsEnabled}>
                <summary>Map notes and sponsored tasks</summary>
                <div className="play-menu">
                  <button
                    className="play-entry"
                    onClick={() => setTab("messages")}
                  >
                    <ChatCircle size={26} />
                    <span>
                      <b>Map notes</b>
                      <small>Leave a note at a place</small>
                    </span>
                    <ArrowRight size={20} />
                  </button>
                  <button
                    className="play-entry"
                    onClick={() => setTab("bounties")}
                  >
                    <Flag size={26} />
                    <span>
                      <b>Community tasks</b>
                      <small>Fund a task · share proof · earn a reward</small>
                    </span>
                    <ArrowRight size={20} />
                  </button>
                  <p className="play-hint">
                    Notes are pinned where you stand on the map. Tasks pay from
                    their sponsor's reward.
                  </p>
                </div>
              </details>
              <CommunityBonusVote
                key={`bonus-${player.id}`}
                playerId={player.id}
                notify={notify}
              />
              <CreatorCommunity
                key={player.id}
                player={player}
                notify={notify}
                view={creatorView}
                onViewChange={setCreatorView}
                onPlayerChange={me}
                position={position}
                money={{
                  accountId:
                    invisible.status === "ready" && invisible.accountId
                      ? invisible.accountId
                      : player.wallets[0]?.account_id || "",
                  managed:
                    invisible.status === "ready" && !!invisible.accountId,
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
            </>
          )}
          {tab === "market" && (
            <Market
              nativeContent={
                <NativeMarketPanel
                  player={player}
                  wardrobe={nativeWardrobe}
                  busy={busy}
                  onConnect={connectNear}
                  onTrade={tradeNative}
                  orderSigner={orderSigner}
                />
              }
              player={player}
              busy={busy}
              onBuy={(listing) =>
                void action("buy", async () => {
                  const r = await api<{ player: Player }>("/market/buy", {
                    listingId: listing.id,
                  });
                  updateOwnedPlayer(r.player);
                  notify("This Aura is yours. Find it in your collection.");
                })
              }
              onCancel={(listing) =>
                void action("cancel", async () => {
                  await api("/market/cancel", { listingId: listing.id });
                  await me();
                  notify(
                    "Listing cancelled. The Aura is back in your collection.",
                  );
                })
              }
              onInventory={() => setTab("inventory")}
            />
          )}
          {(tab === "bounties" ||
            (tab === "messages" && notesView === "browse")) && (
            <button className="back-link" onClick={() => setTab("community")}>
              <ArrowLeft size={20} />
              Community
            </button>
          )}
          {tab === "messages" && (
            <MapNotes
              key={player.id}
              playerId={player.id}
              position={position}
              fix={fix}
              arena={arena}
              view={notesView}
              notify={notify}
              onViewChange={setNotesView}
              recordAccount={recordAccount}
              onRecord={recordNote}
              onBlockChange={() => {
                setOthers([]);
                window.dispatchEvent(new Event("questlayer:social-blocks"));
              }}
            />
          )}
          {tab === "bounties" && (
            <>
              <div
                className="play-mode-switch"
                role="group"
                aria-label="Task board"
              >
                <button
                  aria-pressed={taskRealm === "near"}
                  onClick={() => setTaskRealm("near")}
                >
                  Sponsored tasks
                </button>
                <button
                  aria-pressed={taskRealm === "demo"}
                  onClick={() => setTaskRealm("demo")}
                >
                  Practice tasks
                </button>
              </div>
              {taskRealm === "near" ? (
                <NativeTasks
                  player={player}
                  onConnect={connectNear}
                  onTransaction={operateNativeTask}
                />
              ) : (
                <Bounties
                  position={position}
                  player={player}
                  action={action}
                  onPlayer={setPlayer}
                  notify={notify}
                />
              )}
            </>
          )}
        </main>
      )}
      {player && (
        <>
          <div className="map-top-chip">
            <span className="status-dot" />
            {nativePlay
              ? arena
                ? "Turn on location to play"
                : `GPS ±${fix ? Math.round(fix.accuracy) : "…"} m`
              : arena
                ? "City demo · tap to walk"
                : `GPS ±${fix ? Math.round(fix.accuracy) : "…"} m`}
            <button
              onClick={() => (arena || nativePlay ? locate() : returnToArena())}
            >
              {arena || nativePlay ? "Use my location" : "Back to city demo"}
              <ArrowUpRight size={12} />
            </button>
          </div>
          {presence && (
            <button
              className="presence-chip"
              onClick={() => setPresence(false)}
            >
              <Eye size={14} />{" "}
              {presenceUntil > Date.now()
                ? `Visible · ${remaining(presenceUntil)}`
                : "Going visible…"}{" "}
              <X size={12} />
            </button>
          )}
          <div className="map-controls">
            <button
              aria-label="City overview"
              title="City overview"
              onClick={() => {
                setOverview((v) => !v);
                setGlobe(false);
                setFollow(false);
                setSelected(null);
              }}
            >
              <Compass size={23} />
            </button>
            <button
              aria-label="My location"
              title="My location"
              onClick={() => {
                setFollow(true);
                setOverview(false);
                setGlobe(false);
                if (!arena || nativePlay) void locate();
                else setPosition((p) => ({ ...p }));
              }}
            >
              <Crosshair size={23} />
            </button>
            <button
              aria-label="Globe"
              aria-pressed={globe}
              title="Globe"
              className={globe ? "active" : ""}
              onClick={() => {
                if (!globe) {
                  setTab("explore");
                  setSheetExpanded(false);
                  setSelected(null);
                }
                setGlobe((v) => !v);
                setOverview(false);
                setFollow(true);
              }}
            >
              <GlobeHemisphereWest size={23} />
            </button>
            <button
              aria-label="Map notes"
              title="Map notes"
              onClick={() => setTab("messages")}
            >
              <ChatCircle size={23} />
            </button>
          </div>
          <div className="player-bottom">
            <div className="mini-avatar">
              <Character
                items={appearanceItems}
                originTokenId={player.appearance.originTokenId}
                compact
              />
              <span>{hudLevel ?? "—"}</span>
            </div>
            <div>
              <b>{player.name}</b>
              <div className="xp-bar">
                <i
                  style={{
                    width:
                      hudXp !== null && hudLevel !== null
                        ? `${Math.min(100, ((hudXp - 100 * (hudLevel - 1) ** 2) / (100 * (hudLevel ** 2 - (hudLevel - 1) ** 2))) * 100)}%`
                        : "0%",
                  }}
                />
              </div>
              <small>
                {hudXp !== null && hudLevel !== null
                  ? `${hudXp} / ${100 * hudLevel ** 2} XP${!nativePlay && player.lockedXp ? ` · ${player.lockedXp} committed` : ""}`
                  : playAccount
                    ? "Loading your progress…"
                    : "Secure your explorer to keep progress"}
              </small>
              {!nativePlay && <PickupSummary totals={pickupFeedback.totals} />}
            </div>
            <button onClick={() => setTab("inventory")} aria-label="Inventory">
              <Backpack size={23} />
            </button>
          </div>
        </>
      )}
      {busy === "world" && (
        <div className="world-loading">
          <span className="spinner" /> Finding trails and today’s treasures…
        </div>
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
          <strong>Connecting your explorer…</strong>
          <span>Approve the request in your wallet app.</span>
        </div>
      )}
      {walletChoices && (
        <Dialog label="Choose a NEAR wallet" onClose={() => chooseWallet(null)}>
          <div className="wallet-select">
            <div className="panel-heading">
              <h2>Choose a NEAR wallet</h2>
              <button
                className="icon-button"
                aria-label="Cancel wallet connection"
                onClick={() => chooseWallet(null)}
              >
                <X size={20} />
              </button>
            </div>
            <p>
              Your wallet signs a short message to create or restore your
              explorer. Nothing is paid.
            </p>
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
              Your keys stay in your wallet. QuestLayer never asks for your
              recovery phrase.
            </p>
            <button
              className="secondary-button"
              onClick={() => chooseWallet(null)}
            >
              Back
            </button>
          </div>
        </Dialog>
      )}
      {loaded && !player && meUnreachable && (
        <Dialog label="Can't reach QuestLayer" open onClose={() => {}}>
          <section className="welcome-card offline-gate">
            <WifiSlash size={40} aria-hidden="true" />
            <h2>{online ? "Can't reach QuestLayer" : "You're offline"}</h2>
            <p>
              Your explorer and progress are saved. They'll be right here as
              soon as you're back online.
            </p>
            <button className="primary-button" onClick={() => void me()}>
              Try again <ArrowClockwise size={18} />
            </button>
          </section>
        </Dialog>
      )}
      {loaded && !player && !meUnreachable && (
        <Welcome
          error={toast?.error ? toast.text : undefined}
          onNear={(name) => connectNear({ signIn: true, name })}
          busy={busy}
          action={action}
          onPlayer={(p) => {
            setPlayer(p);
            setLoaded(true);
          }}
          onRestore={restoreThisDevice}
        />
      )}
      {discovery && player && !nativePlay && (
        <AdventureResultDialog
          results={adventureResults}
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
            adventureResults.close();
            setTab("explore");
            setSheetExpanded(false);
            setFollow(true);
          }}
        />
      )}
      {actorOpen && world && (
        <ActorSheet
          actor={actorOpen}
          worldId={world.id}
          location={
            world.arena
              ? { ...position, accuracy: 0, timestamp: Date.now() }
              : fix
          }
          onClose={() => setActorOpen(null)}
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

function Welcome({
  busy,
  error,
  onNear,
  action,
  onPlayer,
  onRestore,
}: {
  busy: string;
  error?: string;
  onRestore: () => Promise<boolean>;
  onNear: (name: string) => Promise<void>;
  action: <T>(n: string, f: () => Promise<T>) => Promise<T | undefined>;
  onPlayer: (p: Player) => void;
}) {
  const [name, setName] = useState(""),
    [existing, setExisting] = useState(false);
  async function start(e?: FormEvent) {
    e?.preventDefault();
    await action("welcome", async () => {
      const r = await api<{ player: Player }>("/session", {
        name: name || "Explorer",
      });
      onPlayer(r.player);
    });
  }
  async function passkey() {
    await action("passkey", async () => {
      const r = await api<{ options: any; challengeId: string }>(
        "/passkey/options",
        { action: existing ? "login" : "register", name: name || "Explorer" },
      );
      const response = existing
        ? await startAuthentication({ optionsJSON: r.options })
        : await startRegistration({ optionsJSON: r.options });
      const verified = await api<{ player: Player }>("/passkey/verify", {
        challengeId: r.challengeId,
        response,
      });
      onPlayer(verified.player);
    });
  }
  return (
    <Dialog
      label="Welcome to QuestLayer"
      open={busy !== "near"}
      onClose={() => {}}
    >
      <section className="welcome-card">
        <div className="welcome-art">
          <span className="orbit one" />
          <span className="orbit two" />
          <Sparkle className="star one" weight="fill" />
          <Sparkle className="star two" weight="fill" />
          <Ghost />
          <span className="floating-coin">
            <GameObjectArt kind="coin" size={32} />
          </span>
          <Leaf className="welcome-leaf" weight="duotone" />
        </div>
        <h1 tabIndex={-1} autoFocus>
          Your city.
          <br />
          <em>Your haunt to explore.</em>
        </h1>
        <p>
          Walk real streets and open chests.
          <br />
          Earn Auras, the glow your friendly ghost wears.
        </p>
        {error && (
          <p className="inline-error" role="alert">
            {error}
          </p>
        )}
        <form
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            void start();
          }}
        >
          <label htmlFor="nickname">What should we call you?</label>
          <input
            id="nickname"
            placeholder="Your explorer name"
            value={name}
            minLength={2}
            maxLength={24}
            onChange={(e) => setName(e.target.value)}
            onFocus={preloadGameMap}
            autoComplete="nickname"
          />
          <button className="primary-button" type="submit" disabled={!!busy}>
            {busy === "welcome"
              ? "Preparing your explorer…"
              : "Start exploring"}
            <ArrowRight size={20} />
          </button>
        </form>
        <button
          className="text-button"
          disabled={!!busy}
          onClick={() => {
            setExisting(true);
            void passkey();
          }}
        >
          <Key size={16} /> I already have an explorer
        </button>
        <button
          className="text-button"
          disabled={!!busy}
          onClick={() => void onRestore()}
        >
          <Key size={16} />
          {busy === "recovery-restore"
            ? "Restoring your explorer…"
            : "Restore with a recovery passkey"}
        </button>
        <details className="welcome-advanced">
          <summary>Advanced</summary>
          <button
            className="passkey-button"
            disabled={!!busy}
            onClick={() => {
              setExisting(false);
              void passkey();
            }}
          >
            <Key size={18} /> Create an explorer secured by a passkey
          </button>
          <button
            className="passkey-button"
            disabled={!!busy}
            onClick={() => void onNear(name || "Explorer")}
          >
            <Wallet size={18} />
            {busy === "near"
              ? "Waiting for your wallet…"
              : "Continue with an external NEAR wallet"}
          </button>
          <p className="identity-note">
            A wallet signs a message, not a payment. Returning wallets restore
            the same explorer.
          </p>
        </details>
        <div className="welcome-note">
          <ShieldCheck size={17} />
          <span>No sign-up, no deposit. Play first, secure later.</span>
        </div>
      </section>
    </Dialog>
  );
}
function WalletNavigation({
  value,
  onChange,
}: {
  value: "rewards" | "staking" | "demo";
  onChange: (v: "rewards" | "staking" | "demo") => void;
}) {
  return (
    <div className="play-switch" role="group" aria-label="Rewards section">
      {(
        [
          { id: "rewards", label: "Rewards", icon: Wallet },
          { id: "staking", label: "Staking", icon: Leaf },
          { id: "demo", label: "Practice", icon: Compass },
        ] as const
      ).map((v) => (
        <button
          key={v.id}
          aria-pressed={value === v.id}
          onClick={() => onChange(v.id)}
        >
          <v.icon size={20} />
          {v.label}
        </button>
      ))}
    </div>
  );
}
function WalletPanel({
  player,
  busy,
  action,
  onPlayer,
  onNear,
  notify,
}: {
  player: Player;
  busy: string;
  action: <T>(n: string, f: () => Promise<T>) => Promise<T | undefined>;
  onPlayer: (p: Player) => void;
  onNear: () => Promise<void>;
  notify: (s: string, e?: boolean) => void;
}) {
  const [deposit, setDeposit] = useState("100000"),
    [share, setShare] = useState(100),
    [pool, setPool] = useState("meadow"),
    [balance, setBalance] = useState<string | null>(null),
    [contributions, setContributions] = useState<Record<string, number>>({});
  const pools = [
    {
      id: "meadow",
      name: "Meadow pool",
      detail: "Practice pool",
      fee: "5% APR · simulation",
    },
    {
      id: "river",
      name: "River pool",
      detail: "Second practice pool",
      fee: "5% APR · simulation",
    },
    {
      id: "mountain",
      name: "Mountain pool",
      detail: "Third practice pool",
      fee: "5% APR · simulation",
    },
  ];
  const staked = player.positions.reduce((s, p) => s + p.active_u, 0);
  const weighted = Math.floor((units(deposit) * share) / 100);
  return (
    <>
      <div className="wallet-hero">
        <span>PRACTICE GOLD</span>
        <div>
          <CoinIcon />
          <strong>{gold(player.gold_u)}</strong>
        </div>
        <small>
          Play money · {near(player.gold_u)} NEAR equivalent · no monetary value
        </small>
        <div>
          <Badge tone="gold">TIER {player.tier}</Badge>
          <Badge>50% coins / 50% zones</Badge>
        </div>
      </div>
      <div className="two-stats">
        <div>
          <small>Practice stake</small>
          <b>{gold(staked)} GOLD</b>
        </div>
        <div>
          <small>Weighted for tier</small>
          <b>{gold(player.weighted_u)} GOLD</b>
        </div>
      </div>
      <section className="form-section">
        <h2>Try practice staking</h2>
        <p>Staked GOLD helps fund rewards for everyone. Nothing real moves.</p>
        <label>
          How much practice GOLD to stake?
          <div className="input-suffix">
            <input
              value={deposit}
              onChange={(e) => setDeposit(e.target.value)}
              inputMode="decimal"
            />
            <span>GOLD</span>
          </div>
        </label>
        <div className="range-heading">
          <label>Yield contributed to the game</label>
          <b>{share} %</b>
        </div>
        <input
          type="range"
          min="0"
          max="100"
          value={share}
          onChange={(e) => setShare(Number(e.target.value))}
        />
        <div className="range-endpoints">
          <span>{100 - share} % for you</span>
          <span>{share} % for the game</span>
        </div>
        <div className="contribution-preview">
          <Leaf />
          <span>
            Weighted stake <b>{gold(weighted)} GOLD</b>
          </span>
          <Badge>
            {weighted >= 100_000 * GOLD
              ? "TIER 3"
              : weighted >= 50_000 * GOLD
                ? "TIER 2"
                : "FREE"}
          </Badge>
        </div>
        <label>Choose a pool</label>
        <div className="pool-list">
          {pools.map((p) => (
            <button
              className={pool === p.id ? "selected" : ""}
              key={p.id}
              onClick={() => setPool(p.id)}
            >
              <span className="pool-symbol">
                <Leaf weight="duotone" />
              </span>
              <span>
                <b>{p.name}</b>
                <small>{p.detail}</small>
              </span>
              <small>{p.fee}</small>
              <span className="radio-dot" />
            </button>
          ))}
        </div>
        <button
          className="primary-button"
          disabled={
            !!busy || units(deposit) <= 0 || units(deposit) > player.gold_u
          }
          onClick={() =>
            void action("stake", async () => {
              const r = await api<{ player: Player }>("/stake", {
                amount: units(deposit),
                contribution: share,
                pool,
              });
              onPlayer(r.player);
              notify("Stake placed. Your tier activates in 30 seconds.");
            })
          }
        >
          Stake practice GOLD <ArrowRight />
        </button>
        <p className="fine-print">
          Practice mode is fast: tiers activate in 30 seconds and withdrawals
          unlock in 60. Real staking would take days.
        </p>
      </section>
      <section className="form-section">
        <h2>Your stake</h2>
        {!staked && <p>You have no stake yet.</p>}
        {player.positions
          .filter((p) => p.active_u > 0)
          .map((p) => (
            <div className="position-row" key={p.id}>
              <div>
                <b>{pools.find((x) => x.id === p.pool)?.name}</b>
                <small>
                  {p.contribution}% yield for the game{" "}
                  {p.matures_at > Date.now()
                    ? `· active in ${remaining(p.matures_at)}`
                    : "· tier active"}
                </small>
                <strong>{gold(p.active_u)} GOLD</strong>
                <label className="position-contribution">
                  Game yield: {contributions[p.id] ?? p.contribution}%
                  <input
                    type="range"
                    min="0"
                    max="100"
                    value={contributions[p.id] ?? p.contribution}
                    onChange={(e) =>
                      setContributions((v) => ({
                        ...v,
                        [p.id]: Number(e.target.value),
                      }))
                    }
                  />
                </label>
                {contributions[p.id] !== undefined &&
                  contributions[p.id] !== p.contribution && (
                    <button
                      className="text-button"
                      disabled={!!busy}
                      onClick={() =>
                        void action("contribution", async () => {
                          const r = await api<{ player: Player }>(
                            "/contribution",
                            {
                              positionId: p.id,
                              contribution: contributions[p.id],
                            },
                          );
                          onPlayer(r.player);
                          notify(
                            "Contribution saved. Your current tier stays.",
                          );
                        })
                      }
                    >
                      Save contribution
                    </button>
                  )}
              </div>
              <button
                className="secondary-button"
                disabled={!!busy}
                onClick={() =>
                  void action("unstake", async () => {
                    const r = await api<{ player: Player }>("/unstake", {
                      positionId: p.id,
                    });
                    onPlayer(r.player);
                    notify(
                      "Withdrawal queued. Your GOLD unlocks in 60 seconds.",
                    );
                  })
                }
              >
                Unstake
              </button>
            </div>
          ))}
        {player.withdrawals
          .filter((w) => w.state === "pending")
          .map((w) => (
            <div className="position-row" key={w.id}>
              <div>
                <b>Withdrawal {gold(w.amount_u)} GOLD</b>
                <small>
                  {w.ready_at > Date.now()
                    ? `Ready in ${remaining(w.ready_at)}`
                    : "Ready to collect"}
                </small>
              </div>
              <button
                className="secondary-button"
                disabled={!!busy || w.ready_at > Date.now()}
                onClick={() =>
                  void action("withdraw", async () => {
                    const r = await api<{ player: Player }>("/withdraw", {
                      withdrawalId: w.id,
                    });
                    onPlayer(r.player);
                    notify("Your practice GOLD is back in your balance.");
                  })
                }
              >
                Collect
              </button>
            </div>
          ))}
      </section>
      <section className="form-section">
        <div className="section-label">
          <h2>NEAR account</h2>
          <Badge tone="green">TEST NETWORK</Badge>
        </div>
        <p>Link a NEAR test account by signing a message. Nothing is paid.</p>
        {player.wallets.map((w) => (
          <div className="connected-wallet" key={w.account_id}>
            <SealCheck weight="fill" />
            <b>{w.account_id}</b>
          </div>
        ))}
        {balance && (
          <p>
            Real balance: <b>{balance} testNEAR</b>
          </p>
        )}
        <button
          className="secondary-button"
          disabled={!!busy}
          onClick={() => void onNear()}
        >
          <Wallet size={17} />
          {player.wallets.length ? "Link another account" : "Link NEAR account"}
        </button>
        {player.wallets.length > 0 && (
          <button
            className="text-button"
            onClick={() =>
              void action("balance", async () => {
                const r = await api<{ amount: string }>("/wallet/balance");
                setBalance(
                  (Number(BigInt(r.amount) / 10n ** 18n) / 1e6).toLocaleString(
                    "en-US",
                    { maximumFractionDigits: 4 },
                  ),
                );
              })
            }
          >
            Check NEAR balance
          </button>
        )}
        <p className="fine-print">
          Walks and Aura trading on the test network are a project pilot.
          Practice GOLD never mixes with secured rewards. Never enter a recovery
          phrase here.
        </p>
      </section>
      <section className="form-section">
        <h2>Adventure history</h2>
        <div className="history-list">
          {player.history.slice(0, 20).map((h) => (
            <div key={h.id}>
              <span className={`history-dot ${h.kind}`}>
                <Sparkle size={15} />
              </span>
              <span>
                <b>{h.title}</b>
                <small>
                  {new Date(h.created_at).toLocaleTimeString("en-US", {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </small>
              </span>
              <strong>
                {h.gold_u
                  ? `${h.gold_u > 0 ? "+" : ""}${gold(h.gold_u)}`
                  : "XP / item"}
              </strong>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}
function FundPanel() {
  const [proof, setProof] = useState<any>(null);
  const [data, setData] = useState<Dashboard | null>(null);
  useEffect(() => {
    api<Dashboard>("/dashboard").then(setData);
    fetch("/testnet-deployment.json")
      .then((r) => (r.ok ? r.json() : null))
      .then(setProof)
      .catch(() => {});
  }, []);
  if (!data) return <p>Loading fund…</p>;
  const total = data.buckets.reduce(
    (s, b) => s + b.available_u + b.reserved_u,
    0,
  );
  return (
    <>
      <p className="panel-subtitle">
        Clear rules. Every reward has its backing.
      </p>
      <div className="fund-hero">
        <div className="fund-donut">
          <span>
            <b>50 / 50</b>
            <small>GAME YIELD</small>
          </span>
        </div>
        <div>
          <small>TOTAL PRACTICE FUND</small>
          <h2>
            {gold(total)} <span>GOLD</span>
          </h2>
          <p>
            The opening fund is a sponsor contribution for the demo. The 5% rate
            is simulated.
          </p>
        </div>
      </div>
      <div className="bucket-grid">
        {data.buckets.map((b) => (
          <div className={`bucket-card ${b.bucket}`} key={b.bucket}>
            <span>{b.bucket === "coins" ? <Coins /> : <Flag />}</span>
            <h3>{b.bucket === "coins" ? "Street coins" : "Daily zones"}</h3>
            <strong>
              {gold(b.available_u)} <small>GOLD available</small>
            </strong>
            <dl>
              <div>
                <dt>Backed rewards</dt>
                <dd>{gold(b.reserved_u)}</dd>
              </div>
              <div>
                <dt>Paid out</dt>
                <dd>{gold(b.paid_u)}</dd>
              </div>
            </dl>
          </div>
        ))}
      </div>
      <div className="two-stats">
        <div>
          <small>Staking accounts</small>
          <b>{data.stakers}</b>
        </div>
        <div>
          <small>Practice stake</small>
          <b>{gold(data.staked)} GOLD</b>
        </div>
      </div>
      <div className="section-label">
        <h2>Reward outlook</h2>
        <Badge>5% APR SIMULATION</Badge>
      </div>
      <div className="projections">
        {[
          ["Day", 1],
          ["Week", 7],
          ["Month", 30],
          ["Quarter", 90],
          ["Year", 365],
        ].map(([label, days]) => (
          <div key={label}>
            <span>{label}</span>
            <b>
              {gold(
                Math.floor(((data.contributing * 0.05) / 365) * Number(days)),
              )}{" "}
              GOLD
            </b>
          </div>
        ))}
      </div>
      <p className="fine-print">
        Estimated yield at a simulated 5% APR, after contribution splits. The
        horizons are alternatives, not separate funds or promised returns.
      </p>
      <div className="info-banner">
        <ShieldCheck />
        <span>
          Unclaimed coins and prizes return to their fund. Your own stake never
          pays for rewards.
        </span>
      </div>
      {proof && (
        <section className="native-proof">
          <div className="section-label">
            <h2>Verified on NEAR</h2>
            <Badge tone="green">TEST NETWORK</Badge>
          </div>
          <p>
            Earned Auras can be secured to your NEAR account, traded in Market
            and shown on a public profile. Staking and GOLD rewards stay
            practice-only.
          </p>
          <a
            href={`${EXPLORER_BASE}/address/${proof.gameContract}`}
            target="_blank"
            rel="noreferrer"
          >
            Standalone settlement proof <ArrowUpRight size={14} />
            <small>{proof.gameContract}</small>
          </a>
          <a
            href={`${EXPLORER_BASE}/address/${proof.collectiblesContract}`}
            target="_blank"
            rel="noreferrer"
          >
            Aura NFT contract <ArrowUpRight size={14} />
            <small>{proof.collectiblesContract}</small>
          </a>
          {proof.transactions
            ?.filter(
              (x: any) =>
                x.label.includes("withdraw") ||
                x.label.includes("transfer NFT"),
            )
            .map((x: any) => (
              <a
                key={x.transaction}
                href={`${EXPLORER_BASE}/txns/${x.transaction}`}
                target="_blank"
                rel="noreferrer"
              >
                {x.label}
                <ArrowUpRight size={14} />
              </a>
            ))}
          <a href="/testnet-deployment.json" target="_blank" rel="noreferrer">
            All deployment proofs <ArrowUpRight size={14} />
          </a>
        </section>
      )}
      <div className="section-label">
        <h2>This world in numbers</h2>
      </div>
      <div className="three-stats">
        <div>
          <strong>{data.players}</strong>
          <span>explorer accounts</span>
        </div>
        <div>
          <strong>{data.coinsCollected}</strong>
          <span>coins collected</span>
        </div>
        <div>
          <strong>{data.worlds}</strong>
          <span>daily worlds</span>
        </div>
      </div>
    </>
  );
}
function Market({
  player,
  nativeContent,
  busy,
  onBuy,
  onCancel,
  onInventory,
}: {
  player: Player;
  nativeContent: ReactNode;
  busy: string;
  onBuy: (l: Listing) => void;
  onCancel: (l: Listing) => void;
  onInventory: () => void;
}) {
  const [items, setItems] = useState<Listing[]>([]),
    [loading, setLoading] = useState(true);
  useEffect(() => {
    const load = () =>
      api<{ listings: Listing[] }>("/market")
        .then((r) => setItems(r.listings))
        .finally(() => setLoading(false));
    void load();
    const t = setInterval(load, 4000);
    return () => clearInterval(t);
  }, []);
  return (
    <>
      {nativeContent}
      <h2 className="demo-market-heading">Practice GOLD market</h2>
      <p className="panel-subtitle">
        Find an Aura that feels like you. Or pass your discovery along.
      </p>
      <div className="market-banner">
        <Storefront size={29} />
        <span>
          <b>From explorers, for explorers</b>
          <small>Fixed prices · 0% fee · practice Auras</small>
        </span>
      </div>
      <div className="section-label">
        <h2>On the market</h2>
        <button className="text-button" onClick={onInventory}>
          Sell an Aura <Plus size={13} />
        </button>
      </div>
      {loading ? (
        <p>Loading listings…</p>
      ) : !items.length ? (
        <div className="empty-state">
          <Storefront size={38} />
          <h3>The first stall could be yours</h3>
          <p>
            Open a chest, find an Aura and list it here for another explorer.
          </p>
          <button className="secondary-button" onClick={onInventory}>
            Open collection
          </button>
        </div>
      ) : (
        <div className="item-grid">
          {items.map((i) => (
            <article className={`item-card rarity-${i.rarity}`} key={i.id}>
              <AuraArt color={i.color} slot={i.slot} name={i.name} />
              <Badge>{rarityNames[i.rarity]}</Badge>
              <h3>{i.name}</h3>
              <small>
                #{i.serial} · {i.seller_name}
              </small>
              <div className="listing-price">
                <CoinIcon />
                <strong>{gold(i.price_u)}</strong>
                <span>GOLD</span>
              </div>
              <button
                className="secondary-button"
                disabled={!!busy}
                onClick={() =>
                  i.seller === player.id ? onCancel(i) : onBuy(i)
                }
              >
                {i.seller === player.id ? "Cancel listing" : "Buy Aura"}
                <ArrowRight size={15} />
              </button>
            </article>
          ))}
        </div>
      )}
      <p className="fine-print">
        These offers use practice GOLD. Secured Auras trade separately above.
      </p>
    </>
  );
}
function Bounties({
  position,
  player,
  action,
  onPlayer,
  notify,
}: {
  position: Point;
  player: Player;
  action: <T>(n: string, f: () => Promise<T>) => Promise<T | undefined>;
  onPlayer: (p: Player) => void;
  notify: (s: string, e?: boolean) => void;
}) {
  const [items, setItems] = useState<Bounty[]>([]),
    [create, setCreate] = useState(false),
    [title, setTitle] = useState(""),
    [description, setDescription] = useState(""),
    [reward, setReward] = useState("100"),
    [evidence, setEvidence] = useState(""),
    [selected, setSelected] = useState<string | null>(null),
    [submissions, setSubmissions] = useState<any[]>([]);
  const load = () =>
    api<{ bounties: Bounty[] }>("/bounties").then((r) => setItems(r.bounties));
  useEffect(() => {
    void load();
  }, []);
  return (
    <>
      <p className="panel-subtitle">
        Someone has an idea. Someone else brings it to life.
      </p>
      <div className="info-banner">
        <ShieldCheck />
        <span>
          The reward is set aside before a task goes live. Anyone can join.
        </span>
      </div>
      <button className="secondary-button" onClick={() => setCreate((v) => !v)}>
        <Plus /> New task
      </button>
      {create && (
        <form
          className="inline-form"
          onSubmit={(e) => {
            e.preventDefault();
            void action("bounty", async () => {
              const r = await api<{ player: Player }>("/bounties", {
                title,
                description,
                amount: units(reward),
                ...position,
              });
              onPlayer(r.player);
              setCreate(false);
              await load();
              notify("Task published. Its reward is set aside.");
            });
          }}
        >
          <label>
            Title
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              minLength={5}
              maxLength={100}
              required
            />
          </label>
          <label>
            What needs to be done?
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={1000}
            />
          </label>
          <label>
            Reward in practice GOLD
            <input
              value={reward}
              onChange={(e) => setReward(e.target.value)}
              inputMode="decimal"
            />
          </label>
          <button className="primary-button">
            Lock reward and publish <ArrowRight />
          </button>
          <p className="fine-print">
            Open for seven days. A submission sent in time keeps the reward
            reserved until it is reviewed.
          </p>
        </form>
      )}
      <div className="bounty-list">
        {items.map((b) => (
          <article key={b.id}>
            <div>
              <Badge tone={b.state === "open" ? "green" : "purple"}>
                {b.state === "open"
                  ? "OPEN"
                  : b.state === "paid"
                    ? "COMPLETED"
                    : "REFUNDED"}
              </Badge>
              <b>
                <CoinIcon />
                {gold(b.amount_u)} GOLD
              </b>
            </div>
            <h3>{b.title}</h3>
            <p>{b.description}</p>
            <small>
              {b.creator_name} · {distanceLabel(meters(position, b))}
            </small>
            {b.state === "open" &&
              (b.creator === player.id ? (
                <button
                  className="text-button"
                  onClick={() =>
                    void action("submissions", async () => {
                      const r = await api<{ submissions: any[] }>(
                        `/bounties/submissions?id=${b.id}`,
                      );
                      setSubmissions(r.submissions);
                      setSelected(b.id);
                    })
                  }
                >
                  Review submissions
                </button>
              ) : (
                <button
                  className="text-button"
                  onClick={() => {
                    setSelected(b.id);
                    setSubmissions([]);
                  }}
                >
                  Submit proof
                </button>
              ))}
            {selected === b.id && b.creator !== player.id && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void action("submit", async () => {
                    await api("/bounties/submit", { bountyId: b.id, evidence });
                    setSelected(null);
                    setEvidence("");
                    notify("Proof sent. The creator will review it.");
                  });
                }}
              >
                <textarea
                  value={evidence}
                  onChange={(e) => setEvidence(e.target.value)}
                  minLength={10}
                  maxLength={1000}
                  placeholder="Describe how you completed the task…"
                  required
                />
                <button className="secondary-button">
                  Submit proof <PaperPlane />
                </button>
              </form>
            )}
            {selected === b.id && b.creator === player.id && (
              <div>
                {submissions.length ? (
                  submissions.map((s) => (
                    <div className="submission" key={s.id}>
                      <b>{s.name}</b>
                      <p>{s.evidence}</p>
                      {s.state === "pending" && (
                        <button
                          className="secondary-button"
                          onClick={() =>
                            void action("approve", async () => {
                              await api("/bounties/approve", {
                                submissionId: s.id,
                              });
                              await load();
                              setSelected(null);
                              notify("Proof approved. Reward paid.");
                            })
                          }
                        >
                          Approve and pay
                        </button>
                      )}
                    </div>
                  ))
                ) : (
                  <p>No submissions yet.</p>
                )}
              </div>
            )}
          </article>
        ))}
      </div>
    </>
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
      "Hello, explorer. Start with a free place nearby, pick up a few coins on the way and open a chest. Solo is fine; this haunt is yours to explore.",
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
        "The guide can't hear you right now. Keep exploring; your coins and visits still count.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog label="Quest guide" onClose={onClose}>
      <section className="npc-modal" onClick={(e) => e.stopPropagation()}>
        <button
          className="icon-button close"
          onClick={onClose}
          aria-label="Close"
        >
          <X />
        </button>
        <div className="npc-avatar">
          <Ghost color="#bc9b65" hat />
        </div>
        <Badge tone="gold">EXPEDITION KEEPER</Badge>
        <h2>Every trail leads somewhere.</h2>
        <p className="npc-answer">{answer}</p>
        <form onSubmit={ask}>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            maxLength={300}
            aria-label="Question for the guide"
            placeholder="Ask about places, chests or Auras…"
            required
          />
          <button className="primary-button" disabled={busy}>
            {busy ? "…" : <PaperPlane size={20} />}
          </button>
        </form>
        <small>
          {source === "near-ai"
            ? "Answered by the AI guide from live game data"
            : source === "anthropic"
              ? "Answered by Claude from live game data"
              : "Answered from live game data"}
        </small>
      </section>
    </Dialog>
  );
}
