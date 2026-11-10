import { ChainLink } from "./ChainLink";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  ArrowsClockwise,
  Backpack,
  Check,
  ClockCounterClockwise,
  Coins,
  Cube,
  Eye,
  Funnel,
  Info,
  GearSix,
  LinkSimple,
  Lock,
  Sparkle,
  Tag,
  TShirt,
  Wallet,
  X,
} from "@phosphor-icons/react";
import { ArrowLeft, ArrowRight } from "./dir-icons";
import { api, GOLD } from "./api";
import { parseNearPrice } from "./native-amounts";
import { Character } from "./Character";
import { GameObjectArt } from "./game-object-art";
import { Character3D } from "./Character3D";
import { Dialog } from "./Dialog";
import { useFormDraft } from "./useFormDraft";
import { createReadEpoch } from "./read-epoch";
import { Ghost } from "./Ghost";
import { AuraSprite, auraEdition } from "./aura-art";
import {
  activeAuraSet,
  catalogEdition,
  editionSourceLabel,
} from "./aura-catalog.ts";
import {
  DEFAULT_WARDROBE_FILTER,
  catalogProgress,
  filterAuras,
  sortAuras,
} from "./aura-wardrobe.ts";
import { OriginalItemGallery, type OriginalItem } from "./OriginalItemGallery";
import type { Item, NativeItem, Player } from "./types";
import "./inventory.css";
import {
  RARITY_NAMES,
  SLOT_NAMES,
  useWardrobeWearables,
  type WardrobeWearable,
} from "./GotchiWardrobe";
import { wearableArtUrl } from "./character-art";
import "./wearables.css";
import "./inventory-game.css";
import "./inventory-polish.css";
import { tr } from "./i18n";
import { OwnedGotchis } from "./OwnedGotchis";

const rarityNames: Record<string, string> = {
  get common() { return tr("Common"); },
  get uncommon() { return tr("Uncommon"); },
  get rare() { return tr("Rare"); },
  get epic() { return tr("Epic"); },
  get legendary() { return tr("Legendary"); },
};
const PRICE_DRAFT_FIELDS = { price: 32 };
export type OriginalInventory = {
  linked?: boolean;
  count?: number;
  warnings?: string[];
  status?: string;
  error?: string;
  appearance?: Player["appearance"];
  lookUnavailable?: boolean;
  verifiedAt?: number;
  truncated?: boolean;
  wearables?: OriginalItem[];
  gotchis?: { tokenId: string; name: string; hasImage: boolean; brs?: number | null; claimed?: boolean }[];
};
const readOriginals = (refresh: boolean) =>
  api<OriginalInventory>(`/aavegotchi${refresh ? "?refresh=1" : ""}`);

/** Wardrobe filter the Inventory opens on, e.g. wearables after a pickup. */
export type InventoryTab = "all" | "auras" | "wearables" | "worn";
const FILTERS: { id: InventoryTab; label: () => string }[] = [
  { id: "all", label: () => tr("All") },
  { id: "auras", label: () => tr("Auras") },
  { id: "wearables", label: () => tr("Wearables") },
  { id: "worn", label: () => tr("Worn") },
];
const RARITY_RANK: Record<string, number> = {
  common: 0,
  uncommon: 1,
  rare: 2,
  epic: 3,
  legendary: 4,
  mythical: 5,
  godlike: 6,
};
/** A secured (NEAR) collection the wardrobe shows next to the game items. */
export type SecuredCollection = {
  accountId: string;
  /** The NEAR character exists, so Auras can be equipped on chain. */
  avatarReady: boolean;
  equipment: { above: string | null; below: string | null };
  items: NativeItem[];
};
type Entry = { key: string; name: string; rarity: string; worn: boolean } & (
  | { type: "aura"; item: Item; count: number; ids: string[] }
  | { type: "secured"; item: NativeItem; accountId: string; slot: "above" | "below"; avatarReady: boolean }
  | { type: "wearable"; item: WardrobeWearable }
);
const slotName = (slot: string) => (slot === "above" ? tr("Above") : tr("Below"));
const rarityName = (rarity: string) => rarityNames[rarity] || rarity;
/** Same curve as the server and the HUD: level L starts at 100·(L-1)² XP. */
export function levelProgress(xp: number) {
  const safe = Math.max(0, Number.isFinite(xp) ? xp : 0);
  const level = Math.min(50, 1 + Math.floor(Math.sqrt(safe / 100)));
  const start = 100 * (level - 1) ** 2,
    next = 100 * level ** 2;
  const ratio = level >= 50 ? 1 : Math.min(1, (safe - start) / (next - start));
  return { level, xp: safe, start, next, ratio };
}
const compactGold = (goldU: number) => {
  const gold = goldU / GOLD;
  return gold >= 100_000
    ? new Intl.NumberFormat("en-GB", {
        notation: "compact",
        maximumFractionDigits: 1,
      }).format(gold)
    : Math.floor(gold).toLocaleString("en-GB");
};
/** Equal items share one backpack slot with a count badge; worn ones stay apart. */
function stackAuras(items: Item[]) {
  const stacks = new Map<string, Item[]>();
  for (const item of items) {
    const key = item.equipped
      ? `worn:${item.id}`
      : [item.name, item.rarity, item.slot, item.native_claim_state || ""].join(
          "|",
        );
    stacks.set(key, [...(stacks.get(key) || []), item]);
  }
  return [...stacks.entries()].map(([key, members]) => ({ key, members }));
}
/** Grid columns from the backpack's own width: 4 on a phone, up to 8 on desktop. */
function useGridColumns(present = true) {
  const ref = useRef<HTMLDivElement>(null);
  const [columns, setColumns] = useState(4);
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node || typeof ResizeObserver === "undefined") return;
    const measure = () => {
      const width = node.clientWidth;
      setColumns(width >= 760 ? 8 : width >= 520 ? 6 : width >= 420 ? 5 : 4);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [present]);
  return [ref, columns] as const;
}


/**
 * Inventory → Wardrobe: the character with its worn slots, then one grid of
 * everything the explorer owns (game Auras, Auras secured on NEAR and
 * Aavegotchi wearables). Tapping an item offers Try it on and Sell; selling
 * lists it in Shop → Market.
 */
export function Inventory({
  onOriginalAppearance,
  map3D,
  onMap3D,
  player,
  characterItems,
  nativeContent,
  nativeExtras,
  adventureResults,
  busy,
  onEquip,
  onSell,
  onEvm,
  onSkin,
  onExplore,
  xp,
  loadOriginals = readOriginals,
  onWearables,
  initialTab = "all",
  secured = [],
  onSecuredEquip,
  onSecuredSell,
}: {
  onOriginalAppearance: (appearance: Player["appearance"]) => void;
  /** Wearing a wearable clone changes the player (their map character). */
  onWearables?: (player: Player) => void;
  /** Opens on a filter, e.g. wearables right after a wearable pickup. */
  initialTab?: InventoryTab;
  map3D: boolean;
  onMap3D: () => void;
  player: Player;
  characterItems: Item[];
  nativeContent: ReactNode;
  nativeExtras?: ReactNode;
  adventureResults?: ReactNode;
  busy: string;
  onEvm: () => Promise<void>;
  onSkin: (id: string | null) => Promise<void>;
  onEquip: (item: Item) => void;
  /** Secures the Aura on NEAR and lists it on the market; price in yoctoNEAR. */
  onSell: (item: Item, priceYocto: string) => Promise<boolean>;
  onExplore?: () => void;
  /** XP shown in the level bar; defaults to the practice XP on `player`. */
  xp?: number | null;
  loadOriginals?: (refresh: boolean) => Promise<OriginalInventory>;
  /** Auras already secured on NEAR, per linked account. */
  secured?: SecuredCollection[];
  onSecuredEquip?: (accountId: string, item: NativeItem, slot: "above" | "below") => Promise<void>;
  /** Lists a secured Aura in Shop → Market; price in yoctoNEAR. */
  onSecuredSell?: (accountId: string, tokenId: string, priceYocto: string) => Promise<boolean>;
}) {
  const [origin, setOrigin] = useState<OriginalInventory | null>(null);
  const [originLoading, setOriginLoading] = useState(false);
  const [originError, setOriginError] = useState("");
  const [show3D, setShow3D] = useState(false);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [lockedId, setLockedId] = useState<string | null>(null);
  const [filter, setFilter] = useState<InventoryTab>(initialTab);
  const [selling, setSelling] = useState(false);
  const wearables = useWardrobeWearables((next) => onWearables?.(next));

  const priceDraft = useFormDraft({
    playerId: player.id,
    form: "demo-aura-listing",
    realm: `demo:${selectedKey || "none"}`,
    fields: PRICE_DRAFT_FIELDS,
    initial: { price: "0.05" },
  });
  const price = priceDraft.values.price;
  const setPrice = (value: string) => priceDraft.setField("price", value);
  const [listingError, setListingError] = useState("");
  const [listingPending, setListingPending] = useState(false);
  const mounted = useRef(true);
  const currentOwner = useRef(player.id);
  currentOwner.current = player.id;
  const currentSelection = useRef("");
  currentSelection.current = JSON.stringify([player.id, selectedKey]);
  const originReads = useRef(createReadEpoch());
  const listingOperations = useRef(createReadEpoch());
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      originReads.current.invalidate();
      listingOperations.current.invalidate();
    };
  }, []);
  const [failedLooks, setFailedLooks] = useState<Set<string>>(new Set());
  const auras = player.inventory.filter(
    (item) => item.kind === "aura" && item.native_claim_state !== "minted",
  );
  const stacks = stackAuras(sortAuras(filterAuras(auras, DEFAULT_WARDROBE_FILTER)));
  const securedAuras = secured.flatMap((account) =>
    account.items
      .filter((item) => item.kind === "aura")
      .map((item) => ({ account, item })),
  );
  // Owned editions count secured Auras too, so the catalog only lists what is
  // really still to find.
  const progress = catalogProgress([
    ...auras,
    ...securedAuras.map(({ item }) => ({
      name: item.title,
      rarity: item.rarity,
      slot: catalogEdition(item.edition)?.slot || "above",
      color: item.color,
      edition: item.edition,
    })),
  ] as Item[]);
  const lockedEditions = progress.entries
    .filter((entry) => !entry.owned)
    .map(({ edition }) => edition);
  // One list of everything owned: game Auras, secured Auras, wearables.
  const entries: Entry[] = [
    ...stacks.map(({ members }) => ({
      type: "aura" as const,
      key: `aura:${members[0].id}`,
      item: members[0],
      count: members.length,
      ids: members.map((m) => m.id),
      name: members[0].name,
      rarity: members[0].rarity,
      worn: !!members[0].equipped,
    })),
    ...securedAuras.map(({ account, item }) => {
      const slot: "above" | "below" =
        catalogEdition(item.edition)?.slot === "below" ? "below" : "above";
      return {
        type: "secured" as const,
        key: `secured:${account.accountId}:${item.tokenId}`,
        item,
        accountId: account.accountId,
        slot,
        avatarReady: account.avatarReady,
        name: item.title,
        rarity: item.rarity,
        worn: account.equipment[slot] === item.tokenId,
      };
    }),
    ...(wearables.state?.items || []).map((item) => ({
      type: "wearable" as const,
      key: `wearable:${item.id}`,
      item,
      name: item.name,
      rarity: item.rarity,
      worn: item.equipped,
    })),
  ].sort(
    (a, b) =>
      Number(b.worn) - Number(a.worn) ||
      (RARITY_RANK[b.rarity] ?? 0) - (RARITY_RANK[a.rarity] ?? 0) ||
      a.name.localeCompare(b.name),
  );
  const [gridRef, columns] = useGridColumns(entries.length > 0);
  const counts: Record<InventoryTab, number> = {
    all: entries.length,
    auras: entries.filter((e) => e.type !== "wearable").length,
    wearables: entries.filter((e) => e.type === "wearable").length,
    worn: entries.filter((e) => e.worn).length,
  };
  const shown = entries.filter((e) =>
    filter === "all"
      ? true
      : filter === "auras"
        ? e.type !== "wearable"
        : filter === "wearables"
          ? e.type === "wearable"
          : e.worn,
  );
  const emptySlots =
    Math.ceil(shown.length / columns) * columns - shown.length;
  const level = levelProgress(xp ?? player.availableXp ?? player.xp ?? 0);
  const wornAbove = characterItems.find(
      (item) => !!item.equipped && item.slot === "above",
    ),
    wornBelow = characterItems.find(
      (item) => !!item.equipped && item.slot === "below",
    ),
    wornSet = activeAuraSet(wornAbove, wornBelow);
  const lockedEdition = lockedId ? catalogEdition(lockedId) : null;
  // Resolve every action against current inventory: a removed or reserved item
  // must not stay actionable through an older selection.
  // A worn Aura taken off joins its stack, so an Aura selection follows the
  // item id rather than the stack.
  const selected =
    entries.find((entry) => entry.key === selectedKey) ||
    entries.find(
      (entry) => entry.type === "aura" && !!selectedKey && entry.ids.includes(selectedKey.slice(5)),
    ) ||
    null;
  const locked = !!busy || listingPending || wearables.busy !== null;
  const openItem = (key: string) => {
    setSelectedKey(key);
    setSelling(false);
    setListingError("");
  };
  const closeItem = () => {
    setSelectedKey(null);
    setSelling(false);
    setListingError("");
  };
  const acceptOrigin = (data: OriginalInventory) => {
    setOrigin(data);
    setOriginError("");
    if (data.status === "verified" && data.appearance)
      onOriginalAppearance(data.appearance);
  };
  const refreshOrigin = async () => {
    if (!mounted.current || currentOwner.current !== player.id) return;
    const token = originReads.current.begin(player.id);
    setOriginLoading(true);
    setOriginError("");
    try {
      const data = await loadOriginals(true);
      if (
        !mounted.current ||
        !originReads.current.isCurrent(token, currentOwner.current)
      )
        return;
      acceptOrigin(data);
      setFailedLooks(new Set());
      wearables.reload();
    } catch (error) {
      if (
        !mounted.current ||
        !originReads.current.isCurrent(token, currentOwner.current)
      )
        return;
      setOriginError(
        error instanceof Error
          ? error.message
          : tr("Your originals could not load. Try again in a moment."),
      );
    } finally {
      if (
        mounted.current &&
        originReads.current.isCurrent(token, currentOwner.current)
      )
        setOriginLoading(false);
    }
  };
  useEffect(() => {
    let active = true;
    const token = originReads.current.begin(player.id);
    setOriginLoading(false);
    void loadOriginals(false)
      .then((data) => {
        if (
          active &&
          mounted.current &&
          originReads.current.isCurrent(token, currentOwner.current)
        )
          acceptOrigin(data);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [busy, loadOriginals, player.id]);
  const listItem = async () => {
    if (
      !mounted.current ||
      currentOwner.current !== player.id ||
      currentSelection.current !== JSON.stringify([player.id, selectedKey])
    )
      return;
    if (!selected || selected.type === "wearable" || locked) return;
    if (selected.type === "aura" && selected.item.native_claim_state === "issued") return;
    // Aura trades settle on NEAR, so the price is in test NEAR (yocto).
    let amount: string;
    try {
      amount = parseNearPrice(price.replace(",", "."));
    } catch {
      setListingError(tr("Choose a price between 0.001 and 1,000 test NEAR."));
      return;
    }
    setListingPending(true);
    setListingError("");
    const submittedRevision = priceDraft.revision;
    const owner = player.id;
    const token = listingOperations.current.begin(currentSelection.current);
    try {
      const confirmed =
        selected.type === "aura"
          ? await onSell(selected.item, amount)
          : !!(await onSecuredSell?.(selected.accountId, selected.item.tokenId, amount));
      if (
        !mounted.current ||
        !listingOperations.current.isCurrent(token, currentSelection.current)
      )
        return;
      if (confirmed) {
        priceDraft.discard(submittedRevision);
        setSelectedKey(null);
        setSelling(false);
      } else {
        setListingError(
          tr("The Aura was not listed. Your price is saved, so try again."),
        );
      }
    } catch (error) {
      if (
        !mounted.current ||
        !listingOperations.current.isCurrent(token, currentSelection.current)
      )
        return;
      setListingError(
        error instanceof Error
          ? error.message
          : tr("The Aura was not listed. Try again."),
      );
    } finally {
      // Closing the item must not leave the remaining collection locked. Only
      // this operation's pending flag is released; another form is untouched.
      if (
        mounted.current &&
        currentOwner.current === owner &&
        listingOperations.current.isCurrent(token, token.context)
      )
        setListingPending(false);
    }
  };

  const sprite = (item: {
    name?: string | null;
    color?: string | null;
    slot?: string | null;
  }) => (
    <AuraSprite
      edition={auraEdition(item)}
      slot={item.slot}
      color={item.color}
      size={1}
      animated={false}
    />
  );
  const entryArt = (entry: Entry, size = 1) =>
    entry.type === "aura" ? (
      <AuraSprite
        edition={auraEdition(entry.item)}
        slot={entry.item.slot}
        color={entry.item.color}
        size={size}
        animated={size > 1}
      />
    ) : entry.type === "secured" ? (
      <AuraSprite
        edition={entry.item.edition}
        slot={entry.slot}
        color={entry.item.color}
        size={size}
        animated={size > 1}
      />
    ) : (
      <img className="inv-wearable-art" src={wearableArtUrl(entry.item.id)} alt="" loading="lazy" draggable={false} />
    );
  const entryKind = (entry: Entry) =>
    entry.type === "wearable"
      ? SLOT_NAMES[entry.item.slot]?.() || entry.item.slot
      : slotName(entry.type === "aura" ? entry.item.slot : entry.slot);
  const entryRarity = (entry: Entry) =>
    entry.type === "wearable"
      ? RARITY_NAMES[entry.rarity]?.() || entry.rarity
      : rarityName(entry.rarity);
  const entrySource = (entry: Entry) =>
    entry.type === "aura"
      ? tr("Not on NEAR yet")
      : entry.type === "secured"
        ? tr("Secured on NEAR")
        : entry.item.verified
          ? tr("Verified original in your wallet")
          : tr("In-game copy");

  return (
    <div className="inventory-experience">
      <header className="inv-hero" aria-label={tr("Your character")}>
        <div className="inv-hero-info">
          <div className="inv-identity"><h2>{player.name}</h2><span>{tr("Level")}{" "}{level.level}</span></div>
          <span className="inv-hero-source">
            {player.nativeOutfit ? (
              <Wallet size={14} aria-hidden="true" />
            ) : (
              <Check size={14} aria-hidden="true" />
            )}
            {player.nativeOutfit ? tr("Secured outfit") : tr("Game outfit")} ·{" "}
            {player.appearance?.originTokenId
              ? origin?.gotchis?.find((g) => g.tokenId === player.appearance?.originTokenId)?.name || tr("Original")
              : tr("Starter ghost")}
          </span>
        </div>
        <div className="inv-hero-stage">
          <Character
            items={characterItems}
            originTokenId={player.appearance?.originTokenId}
          />
        </div>
        <div className="inv-hero-gear" aria-label={tr("Equipped Aura slots")}>
          {(["above", "below"] as const).map((slot) => {
            const item = slot === "above" ? wornAbove : wornBelow;
            const own = item && entries.find((entry) => entry.type === "aura" && entry.item.id === item.id);
            const label = tr("{0} slot: {1}", { 0: slotName(slot), 1: item ? item.name : tr("empty") });
            const art = item ? (
              sprite(item)
            ) : (
              <span className="inv-gear-ghost" aria-hidden="true">
                {sprite({ slot, color: "#8a7aa0" })}
              </span>
            );
            return (
              <div className="inv-gear" key={slot}>
                {own ? (
                  <button
                    className={`inv-gear-tile rarity-${own.rarity}`}
                    aria-label={tr("{0}. Open item", { 0: label })}
                    onClick={(event) => { event.currentTarget.focus({ preventScroll: true }); openItem(own.key); }}
                    disabled={locked}
                  >
                    {art}
                  </button>
                ) : (
                  <div
                    className={`inv-gear-tile ${item ? `rarity-${item.rarity}` : "empty"}`}
                    role="img"
                    aria-label={label}
                  >
                    {art}
                  </div>
                )}
                <span>{slotName(slot)}</span>
              </div>
            );
          })}
        </div>
        <details className="inv-character-details">
          <summary><Info size={22} aria-hidden="true" /><span className="sr-only">{tr("Details")}</span></summary>
          <div className="inv-character-metrics">
          <div className="inv-level">
            <span className="inv-level-badge" aria-hidden="true">
              {level.level}
            </span>
            <div className="inv-level-body">
              <span className="inv-level-label">
                <strong>{tr("Level")}{" "}{level.level}</strong>
                <small>
                  {level.level >= 50
                    ? tr("Max level")
                    : `${Math.floor(level.xp)}/${level.next} XP`}
                </small>
              </span>
              <div
                className="inv-level-bar"
                role="progressbar"
                aria-label={tr("Level {0} progress", { 0: level.level })}
                aria-valuemin={level.start}
                aria-valuemax={level.next}
                aria-valuenow={Math.min(level.xp, level.next)}
                aria-valuetext={
                  level.level >= 50
                    ? tr("Max level")
                    : tr("{0} of {1} XP to level {2}", { 0: Math.floor(level.xp), 1: level.next, 2: level.level + 1 })
                }
              >
                <span style={{ width: `${Math.round(level.ratio * 100)}%` }} />
              </div>
            </div>
          </div>
          <dl className="inv-stats">
            <div>
              <dt>{tr("QGOLD earned")}</dt>
              <dd>
                <Coins size={16} weight="fill" aria-hidden="true" />
                {compactGold(player.gold_u)}
              </dd>
            </div>
            <div>
              <dt>{tr("Auras")}</dt>
              <dd>
                <Sparkle size={16} weight="fill" aria-hidden="true" />
                {progress.found}/{progress.total}
              </dd>
            </div>
          </dl>
          {wornSet ? (
            <p
              className="inv-set-chip"
              style={
                { "--aura-set-glow": wornSet.glow } as React.CSSProperties
              }
              title={wornSet.bonus}
            >
              <Sparkle size={16} weight="fill" aria-hidden="true" />
              <span>
                <strong>{tr("{0} set", { 0: wornSet.name })}</strong>
                <small>{tr("Cosmetic glow")}</small>
              </span>
            </p>
          ) : (
            <p className="inv-set-chip muted">
              <Sparkle size={16} aria-hidden="true" />
              <span>
                <strong>{tr("No set")}</strong>
                <small>{tr("Pair two of a set")}</small>
              </span>
            </p>
          )}
          <button className="inv-hero-3d" onClick={() => setShow3D(true)}>
            <Cube size={20} aria-hidden="true" />{tr("Preview character in 3D")}
          </button>
          </div>
        </details>
      </header>

      <section className="inv-panel" id="inv-panel-items" aria-label={tr("Wardrobe")}>
        {origin?.linked && origin.status === "verified" && (origin.gotchis?.length || origin.wearables?.length) ? (
          <OwnedGotchis
            origin={origin}
            wearing={player.appearance?.originTokenId}
            locked={locked}
            onWear={(id) => void onSkin(id)}
            onWardrobe={() => setFilter("wearables")}
          />
        ) : null}
        <div className="inv-chips" role="group" aria-label={tr("Filter Auras")}>
          {FILTERS.map(({ id, label }) => (
            <button
              key={id}
              type="button"
              className="inv-chip"
              aria-pressed={filter === id}
              onClick={() => setFilter(id)}
            >
              {label()} {!!counts[id] && <span className="inv-chip-count">{counts[id]}</span>}
            </button>
          ))}
        </div>
        {wearables.error && (
          <p className="inventory-error" role="alert">
            {wearables.error}
          </p>
        )}
        {!entries.length && (
          <div className="inventory-empty inv-empty-compact">
            <GameObjectArt kind="chest" size={96} />
            <p>
              <strong>{tr("Your backpack is empty.")}</strong> {" "}{tr("Open a chest on the map; every Aura you find lands here.")}</p>
            {onExplore && (
              <button className="inventory-action" onClick={onExplore}>
                {tr("Explore the map")}{" "}
                <ArrowRight size={20} aria-hidden="true" />
              </button>
            )}
          </div>
        )}
        {!!entries.length && (
          <div
            className="inv-grid"
            role="group"
            ref={gridRef}
            style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
            aria-label={tr("Wardrobe")}
          >
            {shown.map((entry) => {
              const issued = entry.type === "aura" && entry.item.native_claim_state === "issued";
              return (
                <div className="inv-item" key={entry.key}>
                  <button
                    className={`inv-cell rarity-${entry.rarity} ${entry.worn ? "worn" : ""}`}
                    data-inventory-item={entry.key}
                    disabled={locked}
                    onClick={(event) => { event.currentTarget.focus({ preventScroll: true }); openItem(entry.key); }}
                    title={entry.name}
                    aria-label={`${entry.name}, ${entryRarity(entry)}, ${entryKind(entry)}${entry.type === "aura" && entry.count > 1 ? tr(", {0} held", { 0: entry.count }) : ""}${entry.worn ? tr(", equipped") : ""}${issued ? tr(", being secured") : ""}`}
                  >
                    {entryArt(entry)}
                    {entry.worn && (
                      <span className="inv-cell-worn" aria-hidden="true">
                        <Check size={12} weight="bold" />
                      </span>
                    )}
                    {(issued || entry.type === "secured") && (
                      <span className="inv-cell-secured" aria-hidden="true">
                        <Wallet size={12} weight="bold" />
                      </span>
                    )}
                    {entry.type === "wearable" && (
                      entry.item.verified ? (
                        <i className="verified-check inv-cell-badge" aria-hidden="true" />
                      ) : (
                        <span className="clone-badge inv-cell-badge" aria-hidden="true">{tr("Clone")}</span>
                      )
                    )}
                    {entry.type === "aura" && entry.count > 1 && (
                      <span className="inv-cell-count" aria-hidden="true">
                        ×{entry.count}
                      </span>
                    )}
                  </button>
                  <span className="inv-item-name">{entry.name}</span>
                  <span className="inv-item-rarity">{entryRarity(entry)}</span>
                </div>
              );
            })}
            {Array.from({ length: emptySlots }, (_, index) => (
              <span
                key={`empty-${index}`}
                className="inv-cell empty"
                aria-hidden="true"
              />
            ))}
          </div>
        )}
        {!!lockedEditions.length && (
          <details className="inv-catalog">
            <summary>{tr("Aura catalog · {0} of {1} found", { 0: progress.found, 1: progress.total })}</summary>
            <div className="inv-catalog-grid" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
              {lockedEditions.map((edition) => (
                <button
                  key={edition.id}
                  className="inv-cell locked"
                  onClick={(event) => { event.currentTarget.focus({ preventScroll: true }); setLockedId(edition.id); }}
                  title={tr("{0} (not found yet)", { 0: edition.demoName })}
                  aria-label={tr("Locked: {0}, {1}, {2}, not found yet", { 0: edition.demoName, 1: rarityName(edition.rarity), 2: slotName(edition.slot) })}
                >
                  <AuraSprite
                    edition={edition.id}
                    slot={edition.slot}
                    size={1}
                    animated={false}
                  />
                  <span className="inv-cell-lock" aria-hidden="true">
                    <Lock size={12} weight="bold" />
                  </span>
                </button>
              ))}
            </div>
          </details>
        )}
        {player.nativeOutfit && (
          <p className="inventory-notice">
            {tr("Your map ghost wears the secured outfit. Equipping a practice Aura switches to the practice outfit.")}</p>
        )}
        {origin?.status === "unavailable" && (
          <p className="inventory-notice" role="status">
            {origin.error ||
              tr("Your originals could not be checked. Your current look is unchanged.")}
          </p>
        )}
        {origin?.lookUnavailable && (
          <p className="inventory-notice" role="status">
            {tr("Your chosen original could not be confirmed this time, so your starter ghost is shown.")}</p>
        )}
        <details className="inventory-disclosure inventory-originals">
          <summary>
            <LinkSimple size={20} aria-hidden="true" />
            <span>
              {tr("Original Aavegotchi look")}{" "}<small>{tr("Wear one you own")}</small>
            </span>
          </summary>
          <div className="inventory-disclosure-body">
            <p>
              {tr("Wear an original you own. It stays in your wallet.")}</p>
            <button
              className="inventory-secondary"
              onClick={() => void onEvm()}
              disabled={locked}
            >
              <Wallet size={19} aria-hidden="true" />
              {origin?.linked
                ? tr("Link another address")
                : tr("Link Aavegotchi wallet")}
            </button>
            {origin?.linked && (
              <button
                className="inventory-secondary"
                onClick={() => void refreshOrigin()}
                disabled={locked || originLoading}
              >
                <ArrowsClockwise size={19} aria-hidden="true" />
                {originLoading
                  ? tr("Checking ownership…")
                  : tr("Check originals again")}
              </button>
            )}
            {originError && (
              <p className="inventory-error" role="alert">
                {originError}
              </p>
            )}
            {origin?.linked && origin.status === "verified" && (
              <>
                <p>
                  {origin.count === 1 ? tr("1 original verified") : tr("{0} originals verified", { 0: origin.count || 0 })}
                  {origin.verifiedAt
                    ? ` · ${new Date(origin.verifiedAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}`
                    : ""}
                </p>
                <div className="inventory-original-grid">
                  {(origin.gotchis || []).map((gotchi) => {
                    const available =
                      gotchi.hasImage && !failedLooks.has(gotchi.tokenId);
                    return (
                      <button
                        className={`inventory-original-choice ${player.appearance?.originTokenId === gotchi.tokenId ? "selected" : ""}`}
                        key={gotchi.tokenId}
                        onClick={() => void onSkin(gotchi.tokenId)}
                        disabled={locked || !available}
                      >
                        {available ? (
                          <img
                            src={`/api/aavegotchi/skin?tokenId=${encodeURIComponent(gotchi.tokenId)}`}
                            alt={gotchi.name}
                            loading="lazy"
                            onError={() =>
                              setFailedLooks((current) =>
                                new Set(current).add(gotchi.tokenId),
                              )
                            }
                          />
                        ) : (
                          <Ghost />
                        )}
                        <strong>{gotchi.name}</strong>
                        <span>
                          {!available
                            ? tr("Image unavailable")
                            : player.appearance?.originTokenId ===
                                gotchi.tokenId
                              ? tr("Equipped")
                              : tr("Wear this look")}
                        </span>
                      </button>
                    );
                  })}
                </div>
                <details className="inventory-disclosure">
                  <summary>
                    {tr("Original item inventory")}{" "}
                    <span>{origin.wearables?.length || 0}</span>
                  </summary>
                  <div className="inventory-disclosure-body">
                    <OriginalItemGallery
                      key={origin.verifiedAt}
                      items={origin.wearables || []}
                    />
                    {origin.warnings?.map((warning) => (
                      <p className="inventory-notice" key={warning}>
                        {warning}
                      </p>
                    ))}
                  </div>
                </details>
                {origin.truncated && (
                  <p>{tr("Only the first 50 originals are checked for now.")}</p>
                )}
              </>
            )}
            {player.appearance?.originTokenId && (
              <button
                className="inventory-secondary"
                onClick={() => void onSkin(null)}
                disabled={locked}
              >
                {tr("Back to starter ghost")}</button>
            )}
          </div>
        </details>
        <details className="inventory-disclosure">
          <summary>
            <Wallet size={20} aria-hidden="true" /> {" "}{tr("Secured on NEAR")}</summary>
          <div className="inventory-disclosure-body inventory-native-content">
            {nativeContent}
            {nativeExtras}
          </div>
        </details>
        <details className="inventory-disclosure">
          <summary>
            <GearSix size={20} aria-hidden="true" /> {" "}{tr("Display & artwork")}</summary>
          <div className="inventory-disclosure-body">
            <button
              className="inventory-secondary"
              onClick={onMap3D}
              aria-pressed={map3D}
            >
              <Cube size={20} aria-hidden="true" />
              {map3D ? tr("Use 2D map character") : tr("Try 3D map character")}
            </button>
            <p>
              {tr("2D is the default on phones. Looks without a 3D model stay in 2D.")}</p>
            <p>
              {tr("Character artwork:")}{" "}
              <a
                href="https://github.com/aavegotchi/aavegotchi-assets"
                target="_blank"
                rel="noreferrer"
              >
                {tr("Aavegotchi assets")}</a>
              {tr(". 3D models:")}{" "}
              <a
                href="https://www.aavegotchi.com/sdk"
                target="_blank"
                rel="noreferrer"
              >
                {tr("Aavegotchi 3D SDK")}</a>
              .
            </p>
          </div>
        </details>
        {adventureResults}
      </section>

      {show3D && (
        <Character3D
          items={characterItems}
          originTokenId={player.appearance?.originTokenId}
          look={player.appearance?.look}
          onClose={() => setShow3D(false)}
        />
      )}
      {lockedEdition && (
        <Dialog label={tr("Locked Aura")} onClose={() => setLockedId(null)}>
          <section className="inventory-dialog inv-detail">
            <header className="inv-detail-head">
              <div className="inv-detail-art locked">
                <AuraSprite
                  edition={lockedEdition.id}
                  slot={lockedEdition.slot}
                  size={2}
                  animated={false}
                />
                <span className="inv-cell-lock" aria-hidden="true">
                  <Lock size={14} weight="bold" />
                </span>
              </div>
              <div className="inv-detail-title">
                <h2>{lockedEdition.demoName}</h2>
                <p>
                  <span className={`inv-rarity rarity-${lockedEdition.rarity}`}>
                    {rarityName(lockedEdition.rarity)}
                  </span>{" "}
                  · {slotName(lockedEdition.slot)}
                </p>
              </div>
              <button
                className="inventory-icon-button sheet-close"
                aria-label={tr("Close")}
                onClick={() => setLockedId(null)}
              >
                <X size={16} />
              </button>
            </header>
            <p className="inventory-notice">
              {tr("Not found yet.")}{" "}{editionSourceLabel(lockedEdition)}.
            </p>
          </section>
        </Dialog>
      )}
      {selectedKey && (
        <Dialog
          label={selling ? tr("List Aura") : tr("Aura details")}
          onClose={closeItem}
          fallbackFocus={() =>
            gridRef.current?.querySelector<HTMLButtonElement>(`[data-inventory-item="${CSS.escape(selectedKey)}"]`) ||
            gridRef.current?.closest(".inventory-experience")?.querySelector<HTMLButtonElement>(".inv-chip")
          }
        >
          <section className="inventory-dialog inv-detail">
            {!selected ? (
              <>
                <header className="inv-detail-head">
                  <h2>{tr("Your Aura")}</h2>
                  <button
                    className="inventory-icon-button sheet-close"
                    aria-label={tr("Close item details")}
                    onClick={closeItem}
                  >
                    <X size={16} />
                  </button>
                </header>
                <p>{tr("This Aura is no longer in your collection.")}</p>
                <button
                  className="inventory-action"
                  onClick={closeItem}
                  disabled={locked}
                >
                  {tr("Back to collection")}</button>
              </>
            ) : (
              <>
                <header className="inv-detail-head">
                  <div className={`inv-detail-art rarity-${selected.rarity}`}>
                    {entryArt(selected, 2)}
                  </div>
                  <div className="inv-detail-title">
                    <h2>{selling ? tr("List Aura") : selected.name}</h2>
                    <p>
                      <span className={`inv-rarity rarity-${selected.rarity}`}>
                        {entryRarity(selected)}
                      </span>{" "}
                      · {entryKind(selected)}
                      {selected.type !== "wearable" && selected.item.serial != null ? ` · #${selected.item.serial}` : ""}
                    </p>
                    <span className="inventory-source">
                      {entrySource(selected)}
                      {selected.worn ? tr(" · Equipped") : ""}
                      {selected.type === "aura" && !selected.worn && selected.count > 1
                        ? ` · ${selected.count} held`
                        : ""}
                    </span>
                  </div>
                  <button
                    className="inventory-icon-button sheet-close"
                    aria-label={tr("Close item details")}
                    onClick={closeItem}
                  >
                    <X size={16} />
                  </button>
                </header>
                {selected.type === "aura" && selected.item.native_claim_state === "issued" && (
                  <p className="inventory-notice">
                    {tr("This Aura is being secured and cannot be listed. Find it in the Secured collection.")}{" "}
                    {selected.item.native_claim_id && (
                      <ChainLink
                        label
                        chain={{
                          id: `aura:${selected.item.native_claim_id}`,
                          status: "pending",
                          account: selected.item.native_claim_receiver,
                        }}
                      />
                    )}
                  </p>
                )}
                {selling && selected.type !== "wearable" ? (
                  <form
                    className="inventory-sale-form"
                    onSubmit={(event) => {
                      event.preventDefault();
                      void listItem();
                    }}
                  >
                    <p>
                      {selected.type === "aura"
                        ? tr("Selling secures this Aura on NEAR and lists it on the market. You get test NEAR when another explorer buys it.")
                        : tr("Your Aura goes on the market. You get test NEAR when another explorer buys it.")}</p>
                    <label htmlFor="inventory-list-price">
                      {tr("Price in test NEAR")}</label>
                    <div className="inventory-price-input">
                      <Coins size={22} aria-hidden="true" />
                      <input
                        id="inventory-list-price"
                        inputMode="decimal"
                        maxLength={32}
                        required
                        value={price}
                        disabled={locked}
                        onChange={(event) => setPrice(event.target.value)}
                      />
                    </div>
                    <p className="inventory-sale-note">
                      {tr("Every trade settles on NEAR, and History links the proof. Find your listing in Shop → Market.")}</p>
                    {priceDraft.hasDraft && (
                      <button
                        className="inventory-secondary"
                        type="button"
                        disabled={locked}
                        onClick={() => priceDraft.discard()}
                      >
                        {tr("Discard price draft")}</button>
                    )}
                    {listingError && (
                      <p className="inventory-error" role="alert">
                        {listingError}
                      </p>
                    )}
                    <div className="inv-detail-actions">
                      <button
                        className="inventory-secondary"
                        type="button"
                        disabled={locked}
                        onClick={() => setSelling(false)}
                      >
                        {tr("Back")}</button>
                      <button
                        className="inventory-action"
                        disabled={locked}
                        type="submit"
                      >
                        <Tag size={20} aria-hidden="true" />
                        {locked ? tr("Listing…") : tr("Sell")}
                      </button>
                    </div>
                  </form>
                ) : (
                  <>
                    <div className="inv-detail-actions">
                      <button
                        className="inventory-action"
                        disabled={locked || (selected.type === "secured" && (!selected.avatarReady || !onSecuredEquip))}
                        onClick={() => {
                          if (selected.type === "aura") onEquip(selected.item);
                          else if (selected.type === "secured")
                            void onSecuredEquip?.(selected.accountId, selected.item, selected.slot);
                          else void wearables.toggle(selected.item);
                        }}
                      >
                        {selected.worn ? (
                          <X size={20} aria-hidden="true" />
                        ) : (
                          <Eye size={20} aria-hidden="true" />
                        )}
                        {busy === "equip" || wearables.busy !== null
                          ? tr("Saving outfit…")
                          : selected.worn
                            ? tr("Take it off")
                            : tr("Try it on")}
                      </button>
                      <button
                        className="inventory-secondary"
                        disabled={
                          locked ||
                          selected.type === "wearable" ||
                          (selected.type === "aura" && !!selected.item.native_claim_state) ||
                          (selected.type === "secured" && (selected.worn || !onSecuredSell))
                        }
                        onClick={() => setSelling(true)}
                      >
                        <Tag size={20} aria-hidden="true" />
                        {tr("Sell")}</button>
                    </div>
                    <p className="inventory-sale-note" role="status">
                      {selected.type === "wearable"
                        ? tr("Wearables can't be sold: clones are not NFTs and originals stay in your wallet.")
                        : selected.type === "secured" && !selected.avatarReady
                          ? tr("Secure your explorer under Secured on NEAR to wear secured Auras.")
                          : selected.type === "secured" && selected.worn
                            ? tr("Take it off before you sell it.")
                            : selected.worn
                              ? tr("Equipped. It glows on your map ghost.")
                              : ""}
                      {player.nativeOutfit && selected.type === "aura"
                        ? tr(" Your map ghost wears the secured outfit right now.")
                        : ""}
                    </p>
                  </>
                )}
              </>
            )}
          </section>
        </Dialog>
      )}
    </div>
  );
}
