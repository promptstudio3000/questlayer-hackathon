import type { NearbyExplorer } from "./types";
import { Character3D } from "./Character3D";
import { OriginalItemGallery } from "./OriginalItemGallery";
import { NativeMarketPanel } from "./NativeMarketPanel";
import type { NativeTradeRequest } from "./types";
import { AuraClaims } from "./AuraClaims";
import type { NativeAuraClaim } from "./types";
import { NativeWardrobe, nativeAppearanceItems } from "./NativeWardrobe";
import { NativeProfilePanel, SOCIAL_TESTNET } from "./NativeProfile";
import type { NativeProfileQuote } from "./types";
import { assertProfileQuote } from "./native-profile-quote";
import type { NativeWardrobeState, NativeItem } from "./types";
import {
  useEffect,
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
  Diamond,
  Lightning,
  SealCheck,
  Question,
  Image as ImageIcon,
} from "@phosphor-icons/react";
import {
  startRegistration,
  startAuthentication,
} from "@simplewebauthn/browser";
import { api, ApiError, GOLD, gold, near, meters, remaining } from "./api";
import { Dialog } from "./Dialog";
import { Character } from "./Character";
import { DeferredGameMap as GameMap } from "./DeferredGameMap";
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
  Message,
  Bounty,
  Quest,
} from "./types";

type Tab =
  | "explore"
  | "inventory"
  | "market"
  | "fund"
  | "wallet"
  | "messages"
  | "bounties";
const HOME = { lat: 49.74745, lng: 13.3774 };
const nav = [
  { id: "explore", label: "Explore", icon: Compass },
  { id: "inventory", label: "Inventory", icon: Backpack },
  { id: "market", label: "Market", icon: Storefront },
  { id: "fund", label: "Game fund", icon: ChartDonut },
  { id: "wallet", label: "Wallet", icon: Wallet },
] as const;
const rarityNames: Record<string, string> = {
  common: "Common",
  rare: "Rare",
  epic: "Epic",
  legendary: "Legendary",
};
function units(v: string) {
  const n = Number(v.replace(",", "."));
  return Number.isFinite(n) ? Math.round(n * GOLD) : 0;
}
function CoinIcon() {
  return (
    <span className="gold-icon" aria-hidden="true">
      ◆
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
  const [player, setPlayer] = useState<Player | null>(null),
    [loaded, setLoaded] = useState(false),
    [world, setWorld] = useState<World | null>(null),
    [position, setPosition] = useState<Point>(HOME),
    [fix, setFix] = useState<Fix | null>(null),
    [arena, setArena] = useState(true),
    [tab, setTab] = useState<Tab>("explore"),
    [selected, setSelected] = useState<Zone | null>(null),
    [globe, setGlobe] = useState(false),
    [overview, setOverview] = useState(false),
    [sheetExpanded, setSheetExpanded] = useState(false),
    [follow, setFollow] = useState(true),
    [busy, setBusy] = useState(""),
    [toast, setToast] = useState<{ text: string; error: boolean } | null>(null),
    [coins, setCoins] = useState(0),
    [online, setOnline] = useState(navigator.onLine),
    [presence, setPresence] = useState(false),
    [presenceUntil, setPresenceUntil] = useState(0),
    [others, setOthers] = useState<NearbyExplorer[]>([]),
    [showNpc, setShowNpc] = useState(false),
    [now, setNow] = useState(Date.now()),
    [menu, setMenu] = useState(false);
  const [discovery, setDiscovery] = useState<{
    item: Item;
    xp: number;
    reward: number;
  } | null>(null);
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
            : "NEAR inventory is unavailable.",
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
        Object.assign(new Error("Wallet connection cancelled."), {
          code: "WALLET_CANCELLED",
        }),
      );
  }
  const nextWorldRefresh = useRef(0),
    collecting = useRef(new Set<string>()),
    gps = useRef<number | null>(null),
    latest = useRef({ world, position, fix, arena, player });
  latest.current = { world, position, fix, arena, player };
  function notify(text: string, error = false) {
    setToast({ text, error });
  }
  async function action<T>(
    name: string,
    fn: () => Promise<T>,
  ): Promise<T | undefined> {
    const focusBeforeAction = document.activeElement as HTMLElement | null;
    setBusy(name);
    try {
      return await fn();
    } catch (e) {
      if (
        e &&
        typeof e === "object" &&
        "code" in e &&
        e.code === "WALLET_CANCELLED"
      )
        return undefined;
      notify(e instanceof Error ? e.message : "Something went wrong.", true);
    } finally {
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
  async function me() {
    try {
      const r = await api<{ player: Player }>("/me");
      setPlayer(r.player);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) setPlayer(null);
    } finally {
      setLoaded(true);
    }
  }
  async function loadWorld(location: Point, asArena: boolean) {
    setBusy("world");
    try {
      const w = await api<World>("/world", { location, arena: asArena });
      setWorld(w);
      setSelected(null);
    } catch (e) {
      notify(
        e instanceof Error ? e.message : "Could not prepare the area.",
        true,
      );
    } finally {
      setBusy("");
    }
  }
  useEffect(() => {
    void me();
    const a = () => setOnline(navigator.onLine);
    window.addEventListener("online", a);
    window.addEventListener("offline", a);
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      clearInterval(tick);
      window.removeEventListener("online", a);
      window.removeEventListener("offline", a);
    };
  }, []);
  useEffect(() => {
    if (player && !world) void loadWorld(position, arena);
  }, [player?.id]);
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
    const s = new EventSource("/api/events");
    s.addEventListener("coin", (e) => {
      const d = JSON.parse((e as MessageEvent).data);
      setWorld((w) =>
        w ? { ...w, coins: w.coins.filter((c) => c.id !== d.id) } : w,
      );
    });
    s.addEventListener("quest", () => {
      const w = latest.current.world;
      if (w)
        api<World>(`/world?id=${encodeURIComponent(w.id)}`)
          .then(setWorld)
          .catch(() => {});
    });
    s.addEventListener("market", () => void me());
    const sync = setInterval(() => {
      void me();
      const w = latest.current.world;
      if (w)
        api<World>(`/world?id=${encodeURIComponent(w.id)}`)
          .then(setWorld)
          .catch(() => {});
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
      if (!state.world || !state.player || state.world.endsAt <= Date.now())
        return;
      const nearby = state.world.coins
        .filter(
          (c) =>
            meters(state.position, c) < 17 && !collecting.current.has(c.id),
        )
        .slice(0, 2);
      for (const coin of nearby) {
        collecting.current.add(coin.id);
        try {
          const result = await api<{
            player: Player;
            value: number;
            alreadyClaimed?: boolean;
          }>("/coins/claim", {
            coinId: coin.id,
            fix: state.arena
              ? { ...state.position, accuracy: 0, timestamp: Date.now() }
              : state.fix,
          });
          setPlayer(result.player);
          setWorld((w) =>
            w ? { ...w, coins: w.coins.filter((c) => c.id !== coin.id) } : w,
          );
          if (!result.alreadyClaimed) {
            setCoins((c) => c + 1);
            notify(`+${gold(result.value)} GOLD · +2 XP`);
          }
        } catch (e) {
          if (e instanceof ApiError && e.code === "ALREADY_CLAIMED")
            setWorld((w) =>
              w ? { ...w, coins: w.coins.filter((c) => c.id !== coin.id) } : w,
            );
          else collecting.current.delete(coin.id);
        }
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
    const load = () => {
      if (document.visibilityState !== "visible") return;
      const mode = latest.current.arena;
      void api<{ players: NearbyExplorer[] }>(
        `/presence?arena=${mode ? 1 : 0}&lat=${latest.current.position.lat.toFixed(2)}&lng=${latest.current.position.lng.toFixed(2)}`,
      )
        .then((r) => {
          if (active && mode === latest.current.arena) setOthers(r.players);
        })
        .catch(() => {});
    };
    load();
    const timer = setInterval(load, 8000);
    return () => {
      active = false;
      clearInterval(timer);
      setOthers([]);
    };
  }, [player?.id]);
  useEffect(() => {
    if (!arena || !player) return;
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
  }, [arena, player?.id]);
  useEffect(() => {
    if (!presence || !player) return;
    if (document.visibilityState !== "visible") {
      setPresence(false);
      return;
    }
    const leaseId = crypto.randomUUID();
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
          if (!r.enabled) setPresence(false);
          else if (r.expiresAt) setPresenceUntil(r.expiresAt);
        })
        .catch(() => {});
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
  function move(p: Point) {
    if (arena) {
      setPosition(p);
      setOverview(false);
      setFollow(true);
    }
  }
  function selectZone(z: Zone, questId?: string) {
    setSheetExpanded(true);
    setSelected(z);
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
  const questPoint = (q: Quest) => q.nextPoint || q;
  async function locate() {
    if (!navigator.geolocation) {
      notify("This browser does not support geolocation.", true);
      return;
    }
    setBusy("gps");
    navigator.geolocation.getCurrentPosition(
      (p) => {
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
            const f = {
              lat: p.coords.latitude,
              lng: p.coords.longitude,
              accuracy: p.coords.accuracy,
              timestamp: p.timestamp,
            };
            setPosition(f);
            setFix(f);
          },
          () => notify("Waiting for a fresh GPS fix.", true),
          { enableHighAccuracy: true, maximumAge: 0 },
        );
      },
      () => {
        setBusy("");
        notify(
          "Allow browser location access, or continue in the arena.",
          true,
        );
      },
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 0 },
    );
  }
  async function chooseNearAccount() {
    if (!nearConnector.current) {
      const { NearConnector } = await import("@hot-labs/near-connect");
      nearConnector.current = new NearConnector({
        network: "testnet",
        autoConnect: false,
        features: {
          testnet: true,
          signMessage: true,
          signInWithoutAddKey: true,
        },
        footerBranding: {
          heading: "QuestLayer · NEAR testnet",
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
        "No supported testnet wallet is available in this browser. You can still enter the demo.",
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
    if (!accounts[0]) throw new Error("The wallet did not return an account.");
    return { wallet, accountId: accounts[0].accountId };
  }
  async function connectNear(
    options: { signIn?: boolean; name?: string } = {},
  ) {
    if (options.signIn) {
      options.name = options.name?.trim() || "Explorer";
      if (options.name.length < 2 || options.name.length > 24) {
        notify("Your name must be 2–24 characters.", true);
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
        network: "testnet",
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
            ? "Welcome back. Your NEAR wallet restored your explorer."
            : "Your NEAR explorer is ready. Demo GOLD remains separate."
          : "NEAR account verified. Demo GOLD remains separate.",
      );
    });
  }
  async function useNativeOutfit(account: string | null) {
    await action("native-outfit", async () => {
      const r = await api<{ player: Player }>("/native/outfit", {
        enabled: !!account,
        accountId: account,
      });
      setPlayer(r.player);
      if (account) await refreshNative(true);
      notify(
        account
          ? "Your NEAR outfit is on the map."
          : "Your demo outfit is on the map.",
      );
    });
  }
  async function tradeNative(request: NativeTradeRequest): Promise<boolean> {
    const result = await action("native-market", async () => {
      const { wallet, accountId } = await chooseNearAccount();
      if (
        accountId !== request.accountId ||
        !player?.wallets.some((w) => w.account_id === accountId)
      )
        throw Error("Choose the linked NEAR wallet shown for this trade.");
      if (!wallet.manifest.features.signAndSendTransaction)
        throw Error("Choose a wallet that supports NEAR transactions.");
      if (
        !request.marketId.endsWith(".testnet") ||
        request.nftContractId !== nativeWardrobe?.contractId
      )
        throw Error(
          "This native market is not configured for your testnet inventory.",
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
      const outcome = await wallet.signAndSendTransaction({
        network: "testnet",
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
      });
      if (
        outcome.final_execution_status === "NONE" ||
        "Failure" in outcome.status
      )
        throw Error(
          "The market transaction did not confirm. Check current NFT ownership and market balance.",
        );
      await refreshNative(true);
      return true;
    });
    return result === true;
  }
  async function publishNativeProfile(
    account: string,
    avatar: { contractId: string; tokenId: string } | null,
  ): Promise<boolean> {
    const result = await action("native-profile", async () => {
      const { wallet, accountId } = await chooseNearAccount();
      if (
        accountId !== account ||
        !player?.wallets.some((w) => w.account_id === accountId)
      )
        throw Error("Choose the linked NEAR wallet shown for your profile.");
      if (!wallet.manifest.features.signAndSendTransaction)
        throw Error("Choose a wallet that supports NEAR transactions.");
      const quote = await api<NativeProfileQuote>("/native/profile/prepare", {
        accountId,
        publicConsent: true,
      });
      assertProfileQuote(quote, { accountId, name: player.name, avatar });
      const outcome = await wallet.signAndSendTransaction({
        network: "testnet",
        signerId: accountId,
        receiverId: SOCIAL_TESTNET,
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
      });
      if (
        outcome.final_execution_status === "NONE" ||
        "Failure" in outcome.status
      )
        throw Error(
          "The profile transaction did not confirm. Refresh your public profile before trying again.",
        );
      for (let attempt = 0; attempt < 5; attempt++) {
        const response = await api<{ confirmed: boolean; player: Player }>(
          "/native/profile/confirm",
          { accountId, mutationId: quote.profile.mutation_id },
        );
        if (response.confirmed) {
          setPlayer(response.player);
          notify("Your QuestLayer profile is public on NEAR testnet.");
          return true;
        }
        await new Promise((resolve) => setTimeout(resolve, 800));
      }
      notify(
        "Your transaction was sent. Refresh your public profile to check confirmation.",
      );
      return false;
    });
    return result === true;
  }
  async function mintEarnedAura(item: Item) {
    await action("native-claim", async () => {
      try {
        const { wallet, accountId } = await chooseNearAccount();
        if (!player?.wallets.some((w) => w.account_id === accountId))
          throw Error("Select the linked NEAR wallet receiving this Aura.");
        if (!wallet.manifest.features.signAndSendTransaction)
          throw Error("Choose a wallet that supports NEAR transactions.");
        const claim = await api<NativeAuraClaim>("/native/claims", {
          itemId: item.id,
          accountId,
        });
        await me();
        if (claim.state !== "minted") {
          if (!claim.contractId.endsWith(".testnet"))
            throw Error("Aura claims are testnet-only.");
          if (!wallet.manifest.features.signAndSendTransaction)
            throw Error("Choose a wallet that supports NEAR transactions.");
          const result = await wallet.signAndSendTransaction({
            network: "testnet",
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
          });
          if (
            result.final_execution_status === "NONE" ||
            "Failure" in result.status
          )
            throw Error(
              "The NFT transaction was not confirmed. Your claim remains available.",
            );
        }
        let minted = false;
        for (let attempt = 0; attempt < 5; attempt++) {
          const result = await api<{ claim: NativeAuraClaim; player: Player }>(
            "/native/claims/confirm",
            { itemId: item.id },
          );
          setPlayer(result.player);
          if (result.claim.state === "minted") {
            minted = true;
            break;
          }
          await new Promise((resolve) => setTimeout(resolve, 800));
        }
        if (!minted)
          throw Error(
            "Your NFT confirmation is still pending. Use Check claim before retrying.",
          );
        await refreshNative(true);
        notify(
          "Your Aura NFT is ready. Choose where to wear it in your NEAR inventory.",
        );
      } finally {
        await me();
      }
    });
  }
  async function checkAuraClaim(item: Item) {
    await action("native-claim-check", async () => {
      const result = await api<{ claim: NativeAuraClaim; player: Player }>(
        "/native/claims/confirm",
        { itemId: item.id },
      );
      setPlayer(result.player);
      await refreshNative(true);
      notify(
        result.claim.state === "minted"
          ? "Your native Aura is confirmed."
          : "No NFT mint is confirmed yet. You can finish the claim or restore it after expiry.",
      );
    });
  }
  async function restoreDemoAura(item: Item) {
    await action("native-claim-restore", async () => {
      const result = await api<{ player: Player }>("/native/claims/restore", {
        itemId: item.id,
      });
      setPlayer(result.player);
      notify("Your Aura is available in the demo again.");
    });
  }
  async function nativeTransaction(
    method: "mint_avatar" | "equip_aura" | "unequip_aura",
    account: string,
    item?: NativeItem,
    slot?: "above" | "below",
  ) {
    await action("native-transaction", async () => {
      const { wallet, accountId } = await chooseNearAccount();
      if (
        accountId !== account ||
        !player?.wallets.some((w) => w.account_id === accountId)
      )
        throw Error("Select the linked NEAR wallet that owns this item.");
      if (!wallet.manifest.features.signAndSendTransaction)
        throw Error("Choose a wallet that supports NEAR transactions.");
      const contractId = nativeWardrobe?.contractId;
      if (!contractId?.endsWith(".testnet"))
        throw Error("The NEAR testnet collection is unavailable.");
      const result = await wallet.signAndSendTransaction({
        network: "testnet",
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
      });
      if (
        typeof result.status === "object" &&
        result.status &&
        "Failure" in result.status
      )
        throw Error("The NEAR transaction did not succeed.");
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
          "Transaction submitted; confirmation is still pending. Refresh NEAR inventory before retrying.",
        );
      const r = await api<{ player: Player }>("/native/outfit", {
        enabled: true,
        accountId,
      });
      setPlayer(r.player);
      notify(
        method === "mint_avatar"
          ? "Your explorer NFT is confirmed on NEAR testnet."
          : method === "unequip_aura"
            ? "Aura removed from your NEAR outfit."
            : "Your on-chain Aura is equipped and visible on the map.",
      );
    });
  }
  async function connectEvm() {
    await action("evm", async () => {
      const injected = (window as any).ethereum;
      if (!injected)
        throw new Error("Open the game in a browser with an EVM wallet.");
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
      notify("Address verified. Original NFTs stay on Base.");
    });
  }
  async function complete(qId: string) {
    await action("quest", async () => {
      const q = world?.quests.find((x) => x.id === qId);
      const r = await api<{
        player: Player;
        reward: number;
        xp: number;
        item: Item | null;
        awaiting?: boolean;
        progress?: { completed: number; total: number };
      }>(q?.kind === "route" ? "/quests/checkpoint" : "/quests/claim", {
        questId: qId,
        checkpoint: q?.checkpoint || 0,
        fix: arena ? { ...position, accuracy: 0, timestamp: Date.now() } : fix,
      });
      setPlayer(r.player);
      notify(
        r.awaiting
          ? `Checkpoint ${r.progress?.completed}/${r.progress?.total} recorded. Head to the next marker.`
          : r.item
            ? `You discovered ${r.item.name}!`
            : `Quest complete! +${r.xp} XP${r.reward ? ` and ${gold(r.reward)} GOLD` : ""}`,
      );
      if (world)
        setWorld(await api<World>(`/world?id=${encodeURIComponent(world.id)}`));
      if (r.item) {
        const item = r.player.inventory.find((i) => i.id === r.item?.id);
        if (item) setDiscovery({ item, xp: r.xp, reward: r.reward });
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
  const recommended = world?.quests
    .filter(
      (q) =>
        q.tier <= (player?.tier || 1) &&
        !q.completed &&
        q.opens_at <= now &&
        q.closes_at > now,
    )
    .sort(
      (a, b) =>
        Number(
          !player?.inventory.some((i) => i.kind === "aura") &&
            b.kind === "chest" &&
            b.itemAvailable,
        ) -
          Number(
            !player?.inventory.some((i) => i.kind === "aura") &&
              a.kind === "chest" &&
              a.itemAvailable,
          ) ||
        meters(position, questPoint(a)) - meters(position, questPoint(b)),
    )[0];
  const recommendedZone = world?.zones.find(
    (z) => z.id === recommended?.zone_id,
  );
  const title =
    tab === "explore"
      ? "A world just outside"
      : nav.find((n) => n.id === tab)?.label ||
        (tab === "messages" ? "Map notes" : "Community tasks");
  return (
    <div className="app-shell">
      <GameMap
        map3D={!!player && map3D}
        sheetExpanded={sheetExpanded}
        panelMode={tab}
        onQuest={() => setSheetExpanded(true)}
        overview={overview}
        focusZone={selected}
        world={world}
        position={position}
        arena={arena}
        globe={globe}
        equipped={equipped}
        others={others}
        skinUrl={
          player?.appearance?.originTokenId
            ? `/api/aavegotchi/skin?tokenId=${encodeURIComponent(player.appearance.originTokenId)}`
            : undefined
        }
        onMove={move}
        onZone={selectZone}
        follow={follow}
        onPan={() => setFollow(false)}
      />
      <div className="map-vignette" />
      <aside className="nav-rail">
        <button
          className="brand-mark"
          aria-label="QuestLayer home"
          onClick={() => {
            setTab("explore");
            setSelected(null);
          }}
        >
          <Ghost />
        </button>
        <div className="rail-links">
          {nav.map((n) => (
            <button
              key={n.id}
              className={tab === n.id ? "active" : ""}
              onClick={() => {
                setTab(n.id);
              }}
              aria-label={n.label}
              title={n.label}
            >
              <n.icon size={25} weight={tab === n.id ? "fill" : "regular"} />
              <span>{n.label}</span>
            </button>
          ))}
        </div>
        <button
          className="rail-help"
          onClick={() => setShowNpc(true)}
          aria-label="Guide"
        >
          <Question size={24} />
        </button>
        <span className="rail-near">N</span>
      </aside>
      <header className="topbar">
        <div className="wordmark" onClick={() => setTab("explore")}>
          <span>
            QUEST<span>LAYER</span>
          </span>
          <small>LITTLE ADVENTURES. REAL DISCOVERIES.</small>
        </div>
        <div className="realm-label">
          <span className="status-dot" />
          DEMO WORLD <span>·</span>{" "}
          <span>{arena ? "Plzeň city demo" : "Your surroundings"}</span>
        </div>
        <div className="topbar-right">
          {player && (
            <>
              <button className="balance-pill" onClick={() => setTab("wallet")}>
                <CoinIcon />
                <b>{gold(player.gold_u)}</b>
                <span>GOLD</span>
                <Plus size={14} />
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
                  <small>Level {player.level}</small>
                </span>
                <span className="level-bubble">{player.level}</span>
              </button>
            </>
          )}
        </div>
      </header>
      {menu && player && (
        <div id="explorer-profile" className="profile-menu">
          <b>{player.name}</b>
          <span>Your character and demo progress are saved.</span>
          <button
            onClick={() => {
              setTab("wallet");
              setMenu(false);
            }}
          >
            <Wallet /> Wallet and sign-in
          </button>
          <p className="presence-consent">
            Sharing shows your name, chosen look and precise map position to
            nearby explorers for up to 15 minutes while this tab is visible.
            Switching away stops sharing. Demo presence stays separate from GPS
            play.
          </p>
          <button onClick={() => setPresence((x) => !x)}>
            {presence ? <EyeSlash /> : <Eye />}
            {presence ? "Stop sharing presence" : "Share presence for 15 min"}
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
      {!online && (
        <div className="offline-bar">
          You are offline. Collecting will resume when you reconnect.
        </div>
      )}
      {player && (
        <main
          className={`main-panel ${tab === "explore" ? `explore-panel ${sheetExpanded ? "sheet-expanded" : "sheet-compact"}` : ""}`}
        >
          {tab === "explore" && (
            <button
              className="sheet-toggle"
              aria-expanded={sheetExpanded}
              onClick={() => setSheetExpanded((v) => !v)}
            >
              <span>{sheetExpanded ? "Show map" : "Show adventures"}</span>
              <ArrowRight
                size={20}
                style={{
                  transform: sheetExpanded ? "rotate(90deg)" : "rotate(-90deg)",
                }}
              />
            </button>
          )}
          {tab === "explore" && selected && (
            <button
              className="compact-selection"
              onClick={() => setSheetExpanded(true)}
            >
              <Flag size={24} />
              <span>
                <strong>{selected.name}</strong>
                <small>View quests and checkpoints</small>
              </span>
              <ArrowRight />
            </button>
          )}
          <div className="panel-heading">
            <div>
              <div className="eyebrow">
                {tab === "explore"
                  ? "YOUR DAILY ADVENTURE"
                  : "YOUR CORNER OF THE WORLD"}
              </div>
              <h1>{tab === "explore" && selected ? selected.name : title}</h1>
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
          {tab === "explore" && !selected && (
            <>
              <p className="panel-subtitle">
                Step outside. Your next discovery is around the corner.
              </p>
              {recommended && recommendedZone && (
                <button
                  className="recommended-quest"
                  onClick={() => selectZone(recommendedZone, recommended.id)}
                >
                  <span className="recommended-art">
                    <Backpack size={30} weight="duotone" />
                  </span>
                  <span>
                    <small>Your next quest</small>
                    <strong>{recommended.title}</strong>
                    <span>
                      {recommendedZone.name} ·{" "}
                      {Math.round(meters(position, questPoint(recommended)))} m
                      straight-line
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
              <div className="daily-summary">
                <div>
                  <span className="tiny-icon gold">
                    <Coins size={19} />
                  </span>
                  <div>
                    <strong>{player.coinsCollected ?? coins}</strong>
                    <small>coins collected</small>
                  </div>
                </div>
                <div>
                  <span className="tiny-icon purple">
                    <Flag size={18} />
                  </span>
                  <div>
                    <strong>{activeZones.length}</strong>
                    <small>nearby zones</small>
                  </div>
                </div>
              </div>
              <div className="section-label">
                <h2>Where to today?</h2>
                <span>
                  {world?.cityZoneCount ?? activeZones.length} CITY ZONES
                </span>
              </div>
              {world?.quality && (
                <p className="coverage-note">{world.quality.notice}</p>
              )}
              <div className="zone-list">
                {nearbyZones.map((z, i) => {
                  const q = world?.quests.find(
                    (q) =>
                      q.zone_id === z.id ||
                      q.id === z.id.replace(":zone:", ":quest:"),
                  );
                  return (
                    <button
                      className="zone-card"
                      key={z.id}
                      onClick={() => selectZone(z)}
                    >
                      <div className={`zone-illustration art-${z.kind}`}>
                        <span className="illustration-orb" />
                        <span>
                          {z.kind === "garden" ? (
                            <Leaf size={35} weight="duotone" />
                          ) : z.kind === "cache" ? (
                            <Backpack size={35} weight="duotone" />
                          ) : (
                            <Ghost color={z.color} />
                          )}
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
                          <small>{Math.round(meters(position, z))} m</small>
                        </div>
                        <h3>{z.name}</h3>
                        <p>
                          {z.kind === "cache"
                            ? "A chest with a little something extra"
                            : z.tier === 1
                              ? "Small discoveries. Big smiles."
                              : "An adventure for curious explorers"}
                        </p>
                        <div className="zone-rewards">
                          <span>
                            <Sparkle size={12} />
                            {q?.xp || 50} XP
                          </span>
                          {q?.gold_u && !q.claimant ? (
                            <span>
                              <CoinIcon />
                              {gold(q.gold_u)} GOLD
                            </span>
                          ) : (
                            <span>
                              <Diamond size={12} />
                              {world?.quests.some(
                                (x) =>
                                  x.zone_id === z.id &&
                                  x.kind === "chest" &&
                                  x.itemAvailable,
                              )
                                ? "Aura chest"
                                : "XP discoveries"}
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
                <ArrowLeft size={15} /> All zones
              </button>
              <div className={`zone-hero art-${selected.kind}`}>
                <Ghost color={selected.color} />
                <Sparkle className="hero-spark" size={30} />
                <Badge tone={selected.tier === 1 ? "green" : "purple"}>
                  {selected.tier === 1 ? "FREE ZONE" : `TIER ${selected.tier}`}
                </Badge>
              </div>
              <p className="panel-subtitle">
                {selected.tier > player.tier
                  ? "Your next level of adventure starts here."
                  : "This adventure is waiting for you. No other players needed."}
              </p>
              {selected.tier > player.tier ? (
                <div className="locked-panel">
                  <LockKey size={25} />
                  <h3>Unlock Tier {selected.tier}</h3>
                  <p>
                    You need {selected.tier === 2 ? "50 000" : "100 000"} GOLD
                    weighted stake. Your deposit is multiplied by the share of
                    yield you contribute.
                  </p>
                  <p>
                    You can request a withdrawal. Returns are not guaranteed.
                    Staking does not guarantee a GOLD quest in every area.
                  </p>
                  <button
                    className="primary-button"
                    onClick={() => setTab("wallet")}
                  >
                    How staking works <ArrowRight />
                  </button>
                </div>
              ) : (
                world?.quests
                  .filter(
                    (q) =>
                      q.zone_id === selected.id ||
                      q.id === selected.id.replace(":zone:", ":quest:"),
                  )
                  .map((q) => (
                    <div
                      className="quest-detail"
                      key={q.id}
                      id={"quest-" + q.id}
                    >
                      <div className="section-label">
                        <h2>{q.title}</h2>
                        <Badge tone="green">
                          {q.completed
                            ? "COMPLETED"
                            : now >= q.closes_at
                              ? "CLOSED"
                              : "OPEN"}
                        </Badge>
                      </div>
                      <p>{q.description}</p>
                      <div className="quest-prizes">
                        <span>
                          <Sparkle /> {q.xp} XP
                        </span>
                        {q.kind === "chest" && (
                          <span>
                            <Diamond />
                            {q.itemAvailable
                              ? "Aura chest"
                              : "XP · editions exhausted"}
                          </span>
                        )}
                        {q.kind === "route" && (
                          <span>
                            <Flag />
                            {q.checkpoint || 0}/{q.checkpointCount} checkpoints
                          </span>
                        )}
                        {q.gold_u > 0 && (
                          <span>
                            <CoinIcon />
                            {q.claimant
                              ? "GOLD already claimed"
                              : `${gold(q.gold_u)} GOLD`}
                          </span>
                        )}
                      </div>
                      <div className="distance-note">
                        <MapPin size={16} />
                        {Math.round(meters(position, questPoint(q)))} m
                        straight-line ·{" "}
                        {q.opens_at > now
                          ? `opens in ${remaining(q.opens_at)}`
                          : `closes in ${remaining(q.closes_at)}`}
                      </div>
                      {q.completed ? (
                        <button className="primary-button" disabled>
                          Adventure completed <Check />
                        </button>
                      ) : arena && meters(position, questPoint(q)) > 25 ? (
                        <button
                          className="primary-button"
                          onClick={() => move(questPoint(q))}
                        >
                          Move here in demo <NavigationArrow />
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
                            ? "Verifying…"
                            : q.opens_at > now
                              ? "Not open yet"
                              : q.closes_at <= now
                                ? "Closed"
                                : q.kind === "route"
                                  ? `Record checkpoint ${(q.checkpoint || 0) + 1}`
                                  : q.kind === "chest"
                                    ? "Open the chest"
                                    : "Confirm your visit"}
                          <ArrowRight />
                        </button>
                      )}
                      {q.gold_u > 0 && (
                        <p className="fine-print">
                          Shared GOLD pays once. Your personal XP remains
                          available.
                        </p>
                      )}
                    </div>
                  ))
              )}
            </>
          )}
          {tab === "inventory" && (
            <Inventory
              onOriginalAppearance={(appearance) =>
                setPlayer((current) =>
                  current ? { ...current, appearance } : current,
                )
              }
              map3D={map3D}
              onMap3D={toggleMap3D}
              characterItems={appearanceItems}
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
                  />
                </>
              }
              player={player}
              busy={busy}
              onEvm={connectEvm}
              onSkin={async (tokenId) => {
                await action("skin", async () => {
                  const r = await api<{ player: Player }>("/aavegotchi/equip", {
                    tokenId,
                  });
                  setPlayer(r.player);
                  notify("Your appearance has changed.");
                });
              }}
              onEquip={(item) =>
                void action("equip", async () => {
                  const r = await api<{ player: Player }>("/equip", {
                    itemId: item.id,
                  });
                  setPlayer(r.player);
                  notify(
                    item.equipped
                      ? "Aura unequipped."
                      : "Your new look is equipped.",
                  );
                })
              }
              onSell={async (item, price) => {
                const result = await action("listing", async () => {
                  await api("/market/list", { itemId: item.id, price });
                  await me();
                  notify("Your Aura is listed on the demo market.");
                  return true;
                });
                return result === true;
              }}
            />
          )}
          {tab === "wallet" && (
            <WalletPanel
              player={player}
              busy={busy}
              action={action}
              onPlayer={setPlayer}
              onNear={connectNear}
              notify={notify}
            />
          )}
          {tab === "fund" && <FundPanel />}
          {tab === "market" && (
            <Market
              nativeContent={
                <NativeMarketPanel
                  player={player}
                  wardrobe={nativeWardrobe}
                  busy={busy}
                  onConnect={connectNear}
                  onTrade={tradeNative}
                />
              }
              player={player}
              busy={busy}
              onBuy={(listing) =>
                void action("buy", async () => {
                  const r = await api<{ player: Player }>("/market/buy", {
                    listingId: listing.id,
                  });
                  setPlayer(r.player);
                  notify("This Aura is yours. Find it in your inventory.");
                })
              }
              onCancel={(listing) =>
                void action("cancel", async () => {
                  await api("/market/cancel", { listingId: listing.id });
                  await me();
                  notify("Listing cancelled.");
                })
              }
              onInventory={() => setTab("inventory")}
            />
          )}
          {tab === "messages" && (
            <Messages
              position={position}
              fix={fix}
              busy={busy}
              action={action}
              notify={notify}
            />
          )}
          {tab === "bounties" && (
            <Bounties
              position={position}
              player={player}
              action={action}
              onPlayer={setPlayer}
              notify={notify}
            />
          )}
        </main>
      )}
      {player && (
        <>
          <div className="map-top-chip">
            <span className="status-dot" />
            {arena
              ? "CITY DEMO · CLICK TO MOVE"
              : `GPS · ${fix ? Math.round(fix.accuracy) : "…"} m`}
            <button
              onClick={() =>
                arena
                  ? locate()
                  : (setArena(true),
                    setPosition(HOME),
                    void loadWorld(HOME, true))
              }
            >
              {arena ? "My surroundings" : "Back to arena"}
              <ArrowUpRight size={12} />
            </button>
          </div>
          {presence && (
            <button
              className="presence-chip"
              onClick={() => setPresence(false)}
            >
              <Eye size={14} /> Visible · {remaining(presenceUntil)}{" "}
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
                if (!arena) void locate();
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
              <span>{player.level}</span>
            </div>
            <div>
              <b>
                {player.name} <Badge>EXPLORER</Badge>
              </b>
              <div className="xp-bar">
                <i
                  style={{
                    width: `${Math.min(100, ((player.xp - 100 * (player.level - 1) ** 2) / (100 * (player.level ** 2 - (player.level - 1) ** 2))) * 100)}%`,
                  }}
                />
              </div>
              <small>
                {player.xp} / {100 * player.level ** 2} XP · your next discovery
                is closer
              </small>
            </div>
            <button onClick={() => setTab("inventory")} aria-label="Inventory">
              <Backpack size={23} />
            </button>
          </div>
          <button
            className="npc-button"
            aria-label="Ask your guide"
            onClick={() => setShowNpc(true)}
          >
            <Ghost color="#c4a165" hat />
            <span>
              Need a little direction?
              <b>
                Ask your guide <ArrowUpRight size={13} />
              </b>
            </span>
            <span className="npc-dot" />
          </button>
          <div className="map-legend">
            <span>
              <i className="green" /> Free zone
            </span>
            <span>
              <i className="purple" /> Adventure
            </span>
            <span>
              <i className="gold" /> GOLD coin
            </span>
          </div>
        </>
      )}
      {busy === "world" && (
        <div className="world-loading">
          <span className="spinner" /> Finding trails and today’s treasures…
        </div>
      )}
      {toast && (
        <div className={`toast ${toast.error ? "error" : ""}`} role="status">
          {toast.error ? (
            <Question size={20} />
          ) : (
            <Sparkle size={20} weight="fill" />
          )}
          {toast.text}
        </div>
      )}
      {!player && busy === "near" && (
        <div className="wallet-connecting" role="status">
          <Wallet size={24} />
          <strong>Connecting your NEAR explorer…</strong>
          <span>Waiting for the wallet and NEAR verification.</span>
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
              Connect on NEAR testnet. Your wallet signs a message to create or
              restore your explorer.
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
      {loaded && !player && (
        <Welcome
          error={toast?.error ? toast.text : undefined}
          onNear={(name) => connectNear({ signIn: true, name })}
          busy={busy}
          action={action}
          onPlayer={(p) => {
            setPlayer(p);
            setLoaded(true);
          }}
        />
      )}
      {discovery && player && (
        <Dialog label="Quest reward" onClose={() => setDiscovery(null)}>
          <div className="discovery-result">
            {toast?.error && (
              <p className="inline-error" role="alert">
                {toast.text}
              </p>
            )}
            <Badge>REWARD COLLECTED</Badge>
            <AuraArt color={discovery.item.color} slot={discovery.item.slot} />
            <h2>{discovery.item.name}</h2>
            <p>
              +{discovery.xp} XP ·{" "}
              {discovery.item.slot === "above" ? "Above" : "Below"} character ·
              #{discovery.item.serial}
            </p>
            <button
              className="primary-button"
              disabled={!!busy}
              onClick={() =>
                void action("equip", async () => {
                  const r = await api<{ player: Player }>("/equip", {
                    itemId: discovery.item.id,
                  });
                  setPlayer(r.player);
                  setDiscovery(null);
                  setSelected(null);
                  setFollow(true);
                  notify("Aura equipped. Your new look is on the map.");
                })
              }
            >
              Try it on <Check />
            </button>
            <button
              className="secondary-button"
              onClick={() => {
                setDiscovery(null);
                setTab("inventory");
                setSelected(null);
              }}
            >
              Open inventory
            </button>
            <button className="text-button" onClick={() => setDiscovery(null)}>
              Back to quest
            </button>
          </div>
        </Dialog>
      )}
      {showNpc && <Npc onClose={() => setShowNpc(false)} />}
      <div className="demo-footer">
        DEMO GOLD · no real deposits <span>✦</span> Built on NEAR
      </div>
    </div>
  );
}

function Welcome({
  busy,
  error,
  onNear,
  action,
  onPlayer,
}: {
  busy: string;
  error?: string;
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
        <div className="eyebrow">WELCOME TO QUESTLAYER</div>
        <div className="welcome-art">
          <span className="orbit one" />
          <span className="orbit two" />
          <Sparkle className="star one" weight="fill" />
          <Sparkle className="star two" weight="fill" />
          <Ghost />
          <span className="floating-coin">◆</span>
          <Leaf className="welcome-leaf" weight="duotone" />
        </div>
        <h1 tabIndex={-1} autoFocus>
          Your city.
          <br />
          <em>Your next quest.</em>
        </h1>
        <p>
          Explore real places. Complete quests.
          <br />
          Find an Aura and make it yours.
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
            void onNear(name || "Explorer");
          }}
        >
          <label htmlFor="nickname">WHAT SHOULD WE CALL YOU?</label>
          <input
            id="nickname"
            placeholder="Your explorer name"
            value={name}
            minLength={2}
            maxLength={24}
            onChange={(e) => setName(e.target.value)}
            autoComplete="nickname"
          />
          <button className="primary-button" type="submit" disabled={!!busy}>
            <Wallet size={20} />
            {busy === "near"
              ? "Waiting for your wallet…"
              : "Continue with NEAR"}
          </button>
          <p className="identity-note">
            NEAR testnet · sign a message, not a payment. Returning wallets
            restore the same explorer.
          </p>
          <button
            className="secondary-button"
            disabled={!!busy}
            type="button"
            onClick={() => void start()}
          >
            {busy === "welcome"
              ? "Preparing your adventure…"
              : "Enter the demo world"}
            <ArrowRight size={20} />
          </button>
        </form>
        <button
          className="passkey-button"
          disabled={!!busy}
          onClick={() => void passkey()}
        >
          <Key size={18} />
          {existing
            ? "Sign in with a passkey"
            : "Create a demo explorer with a passkey"}
        </button>
        <button className="text-button" onClick={() => setExisting((x) => !x)}>
          {existing ? "I am new here" : "I already have a passkey"}
        </button>
        <div className="welcome-note">
          <ShieldCheck size={17} />
          <span>
            No deposit. Your wallet keeps your keys.
            <br />
            Demo GOLD is not real NEAR.
          </span>
        </div>
      </section>
    </Dialog>
  );
}
function Inventory({
  onOriginalAppearance,
  map3D,
  onMap3D,
  player,
  characterItems,
  nativeContent,
  busy,
  onEquip,
  onSell,
  onEvm,
  onSkin,
}: {
  onOriginalAppearance: (appearance: Player["appearance"]) => void;
  map3D: boolean;
  onMap3D: () => void;
  player: Player;
  characterItems: Item[];
  nativeContent: ReactNode;
  busy: string;
  onEvm: () => Promise<void>;
  onSkin: (id: string | null) => Promise<void>;
  onEquip: (i: Item) => void;
  onSell: (i: Item, p: number) => Promise<boolean>;
}) {
  const [origin, setOrigin] = useState<any>(null);
  const [originLoading, setOriginLoading] = useState(false),
    [originError, setOriginError] = useState("");
  const [show3D, setShow3D] = useState(false);
  const acceptOrigin = (data: any) => {
    setOrigin(data);
    setOriginError("");
    if (data.status === "verified" && data.appearance)
      onOriginalAppearance(data.appearance);
  };
  const refreshOrigin = async () => {
    setOriginLoading(true);
    setOriginError("");
    try {
      acceptOrigin(await api("/aavegotchi?refresh=1"));
    } catch (error) {
      setOriginError(
        error instanceof Error
          ? error.message
          : "Original inventory is temporarily unavailable.",
      );
    } finally {
      setOriginLoading(false);
    }
  };
  useEffect(() => {
    void api("/aavegotchi")
      .then(acceptOrigin)
      .catch(() => {});
  }, [busy]);
  const [selling, setSelling] = useState<Item | null>(null),
    [price, setPrice] = useState("10");
  const auras = player.inventory.filter(
    (i) => i.kind === "aura" && i.native_claim_state !== "minted",
  );
  return (
    <>
      <p className="panel-subtitle">
        Every item has a story. This one is yours.
      </p>
      <div className="wardrobe-preview">
        <Character
          items={characterItems}
          originTokenId={player.appearance.originTokenId}
        />
        <div>
          <Badge>YOUR CHARACTER</Badge>
          <h2>{player.name}</h2>
          <p>
            {player.appearance.originTokenId
              ? "Linked Aavegotchi appearance"
              : player.nativeOutfit
                ? "NEAR testnet outfit"
                : "Demo outfit"}
          </p>
          <small>
            {player.appearance?.originTokenId
              ? `Original #${player.appearance.originTokenId} from Base`
              : "Your independent game avatar"}
          </small>
          <button
            className="secondary-button view-3d-button"
            onClick={() => setShow3D(true)}
          >
            <Cube size={20} />
            View in 3D
          </button>
          <button
            className="secondary-button view-3d-button"
            aria-pressed={map3D}
            onClick={onMap3D}
          >
            3D map character: {map3D ? "On" : "Off"}
          </button>
          <small className="map-appearance-help">
            Choose 2D for a lighter map. Your items stay equipped.
          </small>
        </div>
      </div>
      <p className="character-art-credit">
        <a
          href="https://www.aavegotchi.com/sdk"
          target="_blank"
          rel="noreferrer"
        >
          Aavegotchi artwork
        </a>{" "}
        · QuestLayer Auras
      </p>
      {nativeContent}
      {show3D && (
        <Character3D
          items={characterItems}
          originTokenId={player.appearance.originTokenId}
          onClose={() => setShow3D(false)}
        />
      )}
      <section className="origin-section">
        <div className="section-label">
          <h2>Your original from Base</h2>
          <Badge>READ ONLY</Badge>
        </div>
        <p>
          Connect an address, verify ownership and wear your original look. Your
          NFTs stay in your wallet.
        </p>
        <button
          className="secondary-button"
          disabled={!!busy}
          onClick={() => void onEvm()}
        >
          <Wallet size={16} />
          {origin?.linked ? "Link another EVM address" : "Link Aavegotchi"}
        </button>
        {origin?.status === "unavailable" && (
          <p className="fine-print">{origin.error}</p>
        )}
        {origin?.linked && (
          <button
            className="secondary-button"
            disabled={originLoading || !!busy}
            onClick={() => void refreshOrigin()}
          >
            {originLoading
              ? "Checking originals…"
              : "Refresh original inventory"}
          </button>
        )}
        {originError && (
          <p className="inline-error" role="alert">
            {originError}
          </p>
        )}
        {origin?.lookUnavailable && (
          <p className="fine-print">
            Your selected original could not be verified in this check. Your
            starter appearance is active.
          </p>
        )}
        {origin?.linked && origin.status === "verified" && (
          <>
            <small>
              {origin.count || 0} originals · {origin.wearables?.length || 0}{" "}
              original item types · Base
            </small>
            <div className="origin-grid">
              {origin.gotchis?.map((g: any) => (
                <button
                  key={g.tokenId}
                  disabled={!!busy || !g.hasImage}
                  onClick={() => void onSkin(g.tokenId)}
                >
                  {g.hasImage ? (
                    <img
                      src={`/api/aavegotchi/skin?tokenId=${encodeURIComponent(g.tokenId)}`}
                      alt={g.name}
                    />
                  ) : (
                    <Ghost />
                  )}
                  <b>{g.name}</b>
                  <span>
                    {player.appearance?.originTokenId === g.tokenId
                      ? "Equipped"
                      : "Wear this look"}
                  </span>
                </button>
              ))}
            </div>
            <OriginalItemGallery
              key={origin.verifiedAt}
              items={origin.wearables || []}
            />
            {origin.truncated && (
              <p className="fine-print">
                This check covers the first 50 originals. Some items may not be
                included yet.
              </p>
            )}
            {origin.warnings?.map((warning: string) => (
              <p className="fine-print" key={warning}>
                {warning}
              </p>
            ))}
            {player.appearance?.originTokenId && (
              <button className="text-button" onClick={() => void onSkin(null)}>
                Use starter appearance
              </button>
            )}
          </>
        )}
        <p className="fine-print">
          Original wearable customization is still in development. Some looks do
          not yet have a 3D preview. Linked appearances cannot be sold here.
        </p>
      </section>
      <div className="section-label">
        <h2>Your demo Auras</h2>
        <span>{auras.length} ITEMS</span>
      </div>
      {!auras.length && (
        <div className="empty-state">
          <Backpack size={35} />
          <h3>
            {player.inventory.some((i) => i.native_claim_state === "minted")
              ? "More discoveries await"
              : "Your first treasure is waiting"}
          </h3>
          <p>
            Find an open free zone and its park chest. No deposit is needed.
          </p>
        </div>
      )}
      <div className="item-grid">
        {auras.map((i) => (
          <article className={`item-card rarity-${i.rarity}`} key={i.id}>
            <AuraArt color={i.color} slot={i.slot} />
            <Badge tone={i.rarity === "legendary" ? "gold" : "purple"}>
              {rarityNames[i.rarity]}
            </Badge>
            <h3>{i.name}</h3>
            <small>
              #{i.serial} / 256 ·{" "}
              {i.slot === "above" ? "above character" : "below character"}
            </small>
            {i.native_claim_state && (
              <p className="native-item-state">
                {i.native_claim_state === "minted"
                  ? "Minted on NEAR · use your NEAR inventory"
                  : "Reserved for a NEAR claim"}
              </p>
            )}
            <div className="item-actions">
              <button
                onClick={() => onEquip(i)}
                disabled={!!busy || i.native_claim_state === "minted"}
                className={i.equipped ? "equipped" : ""}
              >
                {i.equipped ? (
                  <>
                    <Check />
                    Equipped
                  </>
                ) : (
                  "Equip"
                )}
              </button>
              <button
                onClick={() => setSelling(i)}
                aria-label={`Sell ${i.name}`}
                disabled={!!busy || !!i.native_claim_state}
              >
                <Storefront size={17} />
              </button>
            </div>
          </article>
        ))}
      </div>
      {selling && (
        <div className="inline-form">
          <div className="section-label">
            <h3>Sell: {selling.name}</h3>
            <button className="icon-button" onClick={() => setSelling(null)}>
              <X />
            </button>
          </div>
          <label>
            Price in demo GOLD
            <input
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              inputMode="decimal"
            />
          </label>
          <button
            className="primary-button"
            disabled={!!busy || units(price) <= 0}
            onClick={() =>
              void onSell(selling, units(price)).then((ok) => {
                if (ok) setSelling(null);
              })
            }
          >
            List for {price} GOLD <ArrowRight />
          </button>
          <p className="fine-print">
            This market settles demo items on the server. On-chain NFTs and
            Intents require a separately verified settlement flow.
          </p>
        </div>
      )}
    </>
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
      detail: "Native staking simulation",
      fee: "5% APR · simulation",
    },
    {
      id: "river",
      name: "River pool",
      detail: "Second simulated strategy",
      fee: "5% APR · simulation",
    },
    {
      id: "mountain",
      name: "Mountain pool",
      detail: "Third simulated strategy",
      fee: "5% APR · simulation",
    },
  ];
  const staked = player.positions.reduce((s, p) => s + p.active_u, 0);
  const weighted = Math.floor((units(deposit) * share) / 100);
  return (
    <>
      <div className="wallet-hero">
        <span>AVAILABLE DEMO GOLD</span>
        <div>
          <CoinIcon />
          <strong>{gold(player.gold_u)}</strong>
        </div>
        <small>
          {near(player.gold_u)} NEAR equivalent in this simulation · no monetary
          value
        </small>
        <div>
          <Badge tone="gold">TIER {player.tier}</Badge>
          <Badge>50% coins / 50% zones</Badge>
        </div>
      </div>
      <div className="two-stats">
        <div>
          <small>Active simulated stake</small>
          <b>{gold(staked)} GOLD</b>
        </div>
        <div>
          <small>Weighted for tier</small>
          <b>{gold(player.weighted_u)} GOLD</b>
        </div>
      </div>
      <section className="form-section">
        <h2>Help this world grow</h2>
        <p>
          Yield helps create rewards for everyone. This simulation does not
          transfer real funds.
        </p>
        <label>
          How much demo GOLD to stake?
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
        <label>Choose a simulated pool</label>
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
              notify(
                "Demo stake deposited. The arena tier activates in 30 seconds.",
              );
            })
          }
        >
          Stake demo GOLD <ArrowRight />
        </button>
        <p className="fine-print">
          The arena shortens tier activation to 30 seconds and withdrawals to 60
          seconds. Real NEAR staking follows network timing; the planned
          withdrawal estimate is usually 1–7 days.
        </p>
      </section>
      <section className="form-section">
        <h2>Your positions</h2>
        {!staked && <p>You have no active positions yet.</p>}
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
                            "Contribution updated. Existing mature access is preserved.",
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
                      "Demo withdrawal queued. Funds unlock in 60 seconds.",
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
                    notify("Your demo funds are back in your wallet.");
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
          <h2>NEAR wallet</h2>
          <Badge tone="green">TESTNET</Badge>
        </div>
        <p>
          Link a real testnet account by signing a message. This does not
          transfer any funds.
        </p>
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
          {player.wallets.length
            ? "Link another account"
            : "Connect NEAR wallet"}
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
            Read on-chain balance
          </button>
        )}
        <p className="fine-print">
          The staking vault and on-chain market are not connected to gameplay
          yet. Demo GOLD stays separate from your real balance. Never enter a
          recovery phrase here.
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
          <small>TOTAL DEMO FUND</small>
          <h2>
            {gold(total)} <span>GOLD</span>
          </h2>
          <p>
            The opening fund is an explicit demo sponsor contribution. The 5%
            rate is a simulation.
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
          <small>Active simulated stake</small>
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
        Estimated game yield after contribution splits, at a simulated 5% APR.
        These are alternative time horizons, not separate funds or guaranteed
        returns. Rewards require liquid backing.
      </p>
      <div className="info-banner">
        <ShieldCheck />
        <span>
          Unclaimed coins remain in the coin fund. Unclaimed zone rewards remain
          in the zone fund. Player principal never funds rewards.
        </span>
      </div>
      {proof && (
        <section className="native-proof">
          <div className="section-label">
            <h2>Verified on NEAR</h2>
            <Badge tone="green">TESTNET</Badge>
          </div>
          <p>
            Earned Auras can become wallet-owned testnet NFTs. Native Aura
            trading is available in Market, and public NEAR Social profiles are
            available in Inventory. Staking and GOLD rewards remain demo.
          </p>
          <a
            href={`https://testnet.nearblocks.io/address/${proof.gameContract}`}
            target="_blank"
            rel="noreferrer"
          >
            Standalone settlement proof <ArrowUpRight size={14} />
            <small>{proof.gameContract}</small>
          </a>
          <a
            href={`https://testnet.nearblocks.io/address/${proof.collectiblesContract}`}
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
                href={`https://testnet.nearblocks.io/txns/${x.transaction}`}
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
      <h2 className="demo-market-heading">Demo GOLD market</h2>
      <p className="panel-subtitle">
        Find an Aura that feels like you. Or pass your discovery along.
      </p>
      <div className="market-banner">
        <Storefront size={29} />
        <span>
          <b>From explorers, for explorers</b>
          <small>Fixed prices · 0% game fee · demo items</small>
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
            Open a chest in a free zone, find an Aura and list it. Another
            explorer can buy it.
          </p>
          <button className="secondary-button" onClick={onInventory}>
            Open inventory
          </button>
        </div>
      ) : (
        <div className="item-grid">
          {items.map((i) => (
            <article className={`item-card rarity-${i.rarity}`} key={i.id}>
              <AuraArt color={i.color} slot={i.slot} />
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
        Demo offers use demo GOLD. Native NFT offers and test NEAR balances are
        shown separately above.
      </p>
    </>
  );
}
function Messages({
  position,
  fix,
  busy,
  action,
  notify,
}: {
  position: Point;
  fix: Fix | null;
  busy: string;
  action: <T>(n: string, f: () => Promise<T>) => Promise<T | undefined>;
  notify: (s: string, e?: boolean) => void;
}) {
  const [messages, setMessages] = useState<Message[]>([]),
    [text, setText] = useState(""),
    [share, setShare] = useState(false),
    [image, setImage] = useState<string | null>(null);
  const load = () =>
    api<{ messages: Message[] }>(
      `/messages?lat=${position.lat.toFixed(2)}&lng=${position.lng.toFixed(2)}`,
    ).then((r) => setMessages(r.messages));
  useEffect(() => {
    void load();
  }, []);
  return (
    <>
      <p className="panel-subtitle">
        Leave a little story for the next person passing by.
      </p>
      <form
        className="message-compose"
        onSubmit={(e) => {
          e.preventDefault();
          void action("message", async () => {
            await api("/messages", {
              text,
              ...position,
              image,
              shareGps: share,
              fix,
            });
            setText("");
            setImage(null);
            await load();
            notify("Your note is on the map.");
          });
        }}
      >
        <textarea
          placeholder="What did you discover here?"
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={500}
          required
        />
        <div className="compose-footer">
          <label className="upload-button">
            <ImageIcon size={20} />
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (!f) return;
                if (f.size > 1_000_000) {
                  notify("Use an image smaller than 1 MB.", true);
                  return;
                }
                const r = new FileReader();
                r.onload = () => setImage(String(r.result));
                r.readAsDataURL(f);
              }}
            />
          </label>
          <small>{text.length}/500</small>
          <button className="primary-button" disabled={!!busy || !text.trim()}>
            Leave a note <PaperPlane size={16} />
          </button>
        </div>
        {image && (
          <img className="image-preview" src={image} alt="Image preview" />
        )}
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={share}
            disabled={!fix}
            onChange={(e) => setShare(e.target.checked)}
          />{" "}
          Also publish the author’s exact GPS
        </label>
        <small>
          Text, map anchor and time will be public. Image metadata is removed.
          Demo posts are stored on the server; on-chain publishing is not
          active.
        </small>
      </form>
      <div className="messages-list">
        {messages.length ? (
          messages.map((m) => (
            <article key={m.id}>
              <div>
                <span className="message-avatar">
                  <Ghost />
                </span>
                <span>
                  <b>{m.author}</b>
                  <small>
                    {new Date(m.created_at).toLocaleString("en-US", {
                      day: "numeric",
                      month: "short",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </small>
                </span>
                <MapPin size={16} />
              </div>
              <p>{m.text}</p>
              {m.image && <img src={m.image} alt="Post image" loading="lazy" />}
            </article>
          ))
        ) : (
          <div className="empty-state">
            <ChatCircle size={32} />
            <h3>Only the wind has been here</h3>
            <p>Be the first to leave a note.</p>
          </div>
        )}
      </div>
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
          Rewards are locked in demo escrow before publishing. Every tier can
          participate.
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
              notify("Task published with a fully backed reward.");
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
            Reward in demo GOLD
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
            Seven-day deadline. Timely pending submissions block refunds. Public
            disputed tasks require the planned arbitration process.
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
              {b.creator_name} · {Math.round(meters(position, b))} m
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
                  Submit evidence
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
                    notify("Your evidence is awaiting the creator’s review.");
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
                  Submit evidence <PaperPlane />
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
                              notify("Evidence approved and demo reward paid.");
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
function Npc({ onClose }: { onClose: () => void }) {
  const [q, setQ] = useState(""),
    [answer, setAnswer] = useState(
      "Hello, explorer. Try a free garden, collect a few coins, then find a treasure chest. Go at your own pace — this world is ready for solo adventures.",
    ),
    [busy, setBusy] = useState(false),
    [source, setSource] = useState("rules");
  async function ask(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const r = await api<{ answer: string; source: string }>("/npc", {
        question: q,
      });
      setAnswer(r.answer);
      setSource(r.source);
      setQ("");
    } catch {
      setAnswer(
        "The connection is a little windy. Your adventures and coin collecting can continue.",
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
            placeholder="What would you like to know?"
            required
          />
          <button className="primary-button" disabled={busy}>
            {busy ? "…" : <PaperPlane size={20} />}
          </button>
        </form>
        <small>
          {source === "near-ai"
            ? "Reply powered by NEAR AI Cloud"
            : "Rule-based guide · NEAR AI is not configured"}
        </small>
      </section>
    </Dialog>
  );
}
