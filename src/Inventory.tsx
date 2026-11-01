import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  ArrowRight,
  ArrowsClockwise,
  Backpack,
  Check,
  ClockCounterClockwise,
  Coins,
  Cube,
  Eye,
  Funnel,
  GearSix,
  LinkSimple,
  Lock,
  Sparkle,
  Tag,
  TShirt,
  Wallet,
  X,
} from "@phosphor-icons/react";
import { api, GOLD } from "./api";
import { Character } from "./Character";
import { Character3D } from "./Character3D";
import { Dialog } from "./Dialog";
import { useFormDraft } from "./useFormDraft";
import { createReadEpoch } from "./read-epoch";
import { Ghost } from "./Ghost";
import { AuraCatalog, AuraSetStatus } from "./AuraWardrobe";
import { AuraSprite, auraEdition } from "./aura-art";
import {
  AURA_RARITIES,
  AURA_SETS,
  activeAuraSet,
  catalogEdition,
  editionSourceLabel,
} from "./aura-catalog.ts";
import {
  DEFAULT_WARDROBE_FILTER,
  catalogProgress,
  filterAuras,
  isFiltered,
  sortAuras,
  type WardrobeFilter,
} from "./aura-wardrobe.ts";
import { OriginalItemGallery, type OriginalItem } from "./OriginalItemGallery";
import type { Item, Player } from "./types";
import "./inventory.css";
import "./inventory-game.css";

const rarityNames: Record<string, string> = {
  common: "Common",
  uncommon: "Uncommon",
  rare: "Rare",
  epic: "Epic",
  legendary: "Legendary",
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
  gotchis?: { tokenId: string; name: string; hasImage: boolean }[];
};
const readOriginals = (refresh: boolean) =>
  api<OriginalInventory>(`/aavegotchi${refresh ? "?refresh=1" : ""}`);

type InventoryTab = "items" | "wardrobe" | "history";
const TABS: { id: InventoryTab; label: string; Icon: typeof Backpack }[] = [
  { id: "items", label: "Items", Icon: Backpack },
  { id: "wardrobe", label: "Wardrobe", Icon: TShirt },
  { id: "history", label: "History", Icon: ClockCounterClockwise },
];
const slotName = (slot: string) => (slot === "above" ? "Above" : "Below");
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
/** Grid columns from the backpack's own width: 4 on a phone, up to 6. */
function useGridColumns() {
  const ref = useRef<HTMLDivElement>(null);
  const [columns, setColumns] = useState(4);
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node || typeof ResizeObserver === "undefined") return;
    const measure = () => {
      const width = node.clientWidth;
      setColumns(width >= 520 ? 6 : width >= 420 ? 5 : 4);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  return [ref, columns] as const;
}

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
  initialCollection,
  xp,
  loadOriginals = readOriginals,
}: {
  onOriginalAppearance: (appearance: Player["appearance"]) => void;
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
  onSell: (item: Item, price: number) => Promise<boolean>;
  onExplore?: () => void;
  initialCollection?: "demo" | "near";
  /** XP shown in the level bar; defaults to the practice XP on `player`. */
  xp?: number | null;
  loadOriginals?: (refresh: boolean) => Promise<OriginalInventory>;
}) {
  const [origin, setOrigin] = useState<OriginalInventory | null>(null);
  const [originLoading, setOriginLoading] = useState(false);
  const [originError, setOriginError] = useState("");
  const [show3D, setShow3D] = useState(false);
  const [collection, setCollection] = useState<"demo" | "near">(
    initialCollection || (player.nativeOutfit ? "near" : "demo"),
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [lockedId, setLockedId] = useState<string | null>(null);
  const [tab, setTab] = useState<InventoryTab>("items");
  const [filterOpen, setFilterOpen] = useState(false);
  const [gridRef, columns] = useGridColumns();
  const [selling, setSelling] = useState(false);
  const priceDraft = useFormDraft({
    playerId: player.id,
    form: "demo-aura-listing",
    realm: `demo:${selectedId || "none"}`,
    fields: PRICE_DRAFT_FIELDS,
    initial: { price: "10" },
  });
  const price = priceDraft.values.price;
  const setPrice = (value: string) => priceDraft.setField("price", value);
  const [listingError, setListingError] = useState("");
  const [listingPending, setListingPending] = useState(false);
  const mounted = useRef(true);
  const currentOwner = useRef(player.id);
  currentOwner.current = player.id;
  const currentSelection = useRef("");
  currentSelection.current = JSON.stringify([player.id, selectedId]);
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
  const [wardrobeFilter, setWardrobeFilter] = useState<WardrobeFilter>(
    DEFAULT_WARDROBE_FILTER,
  );
  const shownAuras = sortAuras(filterAuras(auras, wardrobeFilter));
  const stacks = stackAuras(shownAuras);
  const progress = catalogProgress(auras);
  // Editions not found yet close the backpack as locked slots.
  const lockedEditions = filterAuras(
    progress.entries
      .filter((entry) => !entry.owned)
      .map(({ edition }) => ({
        name: edition.demoName,
        rarity: edition.rarity,
        slot: edition.slot,
        catalog: edition,
      })),
    wardrobeFilter,
  ).map((entry) => entry.catalog);
  const filledSlots = stacks.length + lockedEditions.length;
  const emptySlots =
    Math.max(3, Math.ceil(filledSlots / columns)) * columns - filledSlots;
  const level = levelProgress(xp ?? player.availableXp ?? player.xp ?? 0);
  const wornAbove = characterItems.find(
      (item) => !!item.equipped && item.slot === "above",
    ),
    wornBelow = characterItems.find(
      (item) => !!item.equipped && item.slot === "below",
    ),
    wornSet = activeAuraSet(wornAbove, wornBelow);
  const lockedEdition = lockedId ? catalogEdition(lockedId) : null;
  const extraFilters =
    (wardrobeFilter.rarity !== "all" ? 1 : 0) +
    (wardrobeFilter.set !== "all" ? 1 : 0);
  // Resolve every action against current inventory: a removed or reserved item
  // must not stay actionable through an older selection.
  const selected = auras.find((item) => item.id === selectedId);
  const selectedCount = selected
    ? auras.filter(
        (item) =>
          !item.equipped &&
          item.name === selected.name &&
          item.rarity === selected.rarity &&
          item.slot === selected.slot,
      ).length
    : 0;
  const locked = !!busy || listingPending;
  const openItem = (id: string) => {
    setSelectedId(id);
    setSelling(false);
    setPrice("10");
    setListingError("");
  };
  const closeItem = () => {
    setSelectedId(null);
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
    } catch (error) {
      if (
        !mounted.current ||
        !originReads.current.isCurrent(token, currentOwner.current)
      )
        return;
      setOriginError(
        error instanceof Error
          ? error.message
          : "Your originals could not load. Try again in a moment.",
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
      currentSelection.current !== JSON.stringify([player.id, selectedId])
    )
      return;
    const parsedPrice = Number(price.replace(",", "."));
    const amount = Number.isFinite(parsedPrice)
      ? Math.round(parsedPrice * GOLD)
      : 0;
    if (!selected || selected.native_claim_state === "issued" || locked) return;
    if (
      !Number.isSafeInteger(amount) ||
      amount < 1 ||
      amount > 1000000 * GOLD
    ) {
      setListingError(
        "Enter a price from 0.000001 to 1,000,000 practice GOLD.",
      );
      return;
    }
    setListingPending(true);
    setListingError("");
    const submittedRevision = priceDraft.revision;
    const owner = player.id;
    const token = listingOperations.current.begin(currentSelection.current);
    try {
      const confirmed = await onSell(selected, amount);
      if (
        !mounted.current ||
        !listingOperations.current.isCurrent(token, currentSelection.current)
      )
        return;
      if (confirmed) {
        priceDraft.discard(submittedRevision);
        setSelectedId(null);
        setSelling(false);
      } else {
        setListingError(
          "The Aura was not listed. Your price is saved, so try again.",
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
          : "The Aura was not listed. Try again.",
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

  return (
    <div className="inventory-experience">
      <header className="inv-hero" aria-label="Your character">
        <div className="inv-hero-stage">
          <Character
            items={characterItems}
            originTokenId={player.appearance?.originTokenId}
          />
          <button
            className="inv-hero-3d"
            aria-label="Preview character in 3D"
            onClick={() => setShow3D(true)}
          >
            <Cube size={20} aria-hidden="true" />
          </button>
        </div>
        <div className="inv-hero-info">
          <h2>{player.name}</h2>
          <span className="inv-hero-source">
            {player.nativeOutfit ? (
              <Wallet size={14} aria-hidden="true" />
            ) : (
              <Check size={14} aria-hidden="true" />
            )}
            {player.nativeOutfit ? "Secured outfit" : "Practice outfit"} ·{" "}
            {player.appearance?.originTokenId ? "Original" : "Starter ghost"}
          </span>
          <div className="inv-level">
            <span className="inv-level-badge" aria-hidden="true">
              {level.level}
            </span>
            <div className="inv-level-body">
              <span className="inv-level-label">
                <strong>Level {level.level}</strong>
                <small>
                  {level.level >= 50
                    ? "Max level"
                    : `${Math.floor(level.xp)}/${level.next} XP`}
                </small>
              </span>
              <div
                className="inv-level-bar"
                role="progressbar"
                aria-label={`Level ${level.level} progress`}
                aria-valuemin={level.start}
                aria-valuemax={level.next}
                aria-valuenow={Math.min(level.xp, level.next)}
                aria-valuetext={
                  level.level >= 50
                    ? "Max level"
                    : `${Math.floor(level.xp)} of ${level.next} XP to level ${level.level + 1}`
                }
              >
                <span style={{ width: `${Math.round(level.ratio * 100)}%` }} />
              </div>
            </div>
          </div>
          <dl className="inv-stats">
            <div>
              <dt>Practice GOLD</dt>
              <dd>
                <Coins size={16} weight="fill" aria-hidden="true" />
                {compactGold(player.gold_u)}
              </dd>
            </div>
            <div>
              <dt>Auras</dt>
              <dd>
                <Sparkle size={16} weight="fill" aria-hidden="true" />
                {progress.found}/{progress.total}
              </dd>
            </div>
          </dl>
        </div>
        <div className="inv-hero-gear" aria-label="Equipped Aura slots">
          {(["above", "below"] as const).map((slot) => {
            const item = slot === "above" ? wornAbove : wornBelow;
            const own = item && auras.find((entry) => entry.id === item.id);
            const label = `${slotName(slot)} slot: ${item ? item.name : "empty"}`;
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
                    aria-label={`${label}. Open item`}
                    onClick={() => openItem(own.id)}
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
                <strong>{wornSet.name} set</strong>
                <small>Cosmetic glow</small>
              </span>
            </p>
          ) : (
            <p className="inv-set-chip muted">
              <Sparkle size={16} aria-hidden="true" />
              <span>
                <strong>No set</strong>
                <small>Pair two of a set</small>
              </span>
            </p>
          )}
        </div>
      </header>

      <div className="inv-tabs" role="tablist" aria-label="Inventory sections">
        {TABS.map(({ id, label, Icon }) => (
          <button
            key={id}
            role="tab"
            id={`inv-tab-${id}`}
            aria-controls={`inv-panel-${id}`}
            aria-selected={tab === id}
            tabIndex={tab === id ? 0 : -1}
            onClick={() => setTab(id)}
            onKeyDown={(event) => {
              if (event.key !== "ArrowRight" && event.key !== "ArrowLeft")
                return;
              const index = TABS.findIndex((entry) => entry.id === tab);
              const next =
                TABS[
                  (index + (event.key === "ArrowRight" ? 1 : -1) + TABS.length) %
                    TABS.length
                ];
              setTab(next.id);
              document.getElementById(`inv-tab-${next.id}`)?.focus();
            }}
          >
            <Icon size={18} aria-hidden="true" />
            {label}
          </button>
        ))}
      </div>

      {tab === "items" && (
        <section
          className="inv-panel"
          role="tabpanel"
          id="inv-panel-items"
          aria-labelledby="inv-tab-items"
        >
          <div className="inv-toolbar">
            <p className="inv-toolbar-title" aria-live="polite">
              <strong>Backpack</strong>
              <small>
                {collection === "near"
                  ? "Secured on NEAR"
                  : isFiltered(wardrobeFilter)
                    ? `Showing ${shownAuras.length} of ${auras.length}`
                    : lockedEditions.length
                      ? `${lockedEditions.length} still to find`
                      : "Catalog complete"}
              </small>
            </p>
            <div className="inv-segment" role="group" aria-label="Collection">
              <button
                aria-pressed={collection === "demo"}
                onClick={() => setCollection("demo")}
                disabled={locked}
              >
                Practice <span>{auras.length}</span>
              </button>
              <button
                aria-pressed={collection === "near"}
                onClick={() => setCollection("near")}
                disabled={locked}
              >
                <Wallet size={16} aria-hidden="true" /> Secured
              </button>
            </div>
          </div>
          {collection === "demo" ? (
            <>
              <div className="inv-chips" role="group" aria-label="Filter Auras">
                {(["all", "above", "below"] as const).map((slot) => (
                  <button
                    key={slot}
                    className="inv-chip"
                    aria-pressed={wardrobeFilter.slot === slot}
                    disabled={locked}
                    onClick={() =>
                      setWardrobeFilter({ ...wardrobeFilter, slot })
                    }
                  >
                    {slot === "all" ? "All" : slotName(slot)}
                  </button>
                ))}
                <button
                  className="inv-chip inv-chip-icon"
                  aria-label={`More filters${extraFilters ? `, ${extraFilters} active` : ""}`}
                  aria-expanded={filterOpen}
                  aria-controls="inv-filter-more"
                  disabled={locked}
                  onClick={() => setFilterOpen((open) => !open)}
                >
                  <Funnel
                    size={18}
                    weight={extraFilters ? "fill" : "regular"}
                    aria-hidden="true"
                  />
                  {!!extraFilters && <em>{extraFilters}</em>}
                </button>
              </div>
              {filterOpen && (
                <div className="inv-filter-more" id="inv-filter-more">
                  <label>
                    Rarity
                    <select
                      value={wardrobeFilter.rarity}
                      disabled={locked}
                      onChange={(event) =>
                        setWardrobeFilter({
                          ...wardrobeFilter,
                          rarity: event.target
                            .value as WardrobeFilter["rarity"],
                        })
                      }
                    >
                      <option value="all">All rarities</option>
                      {AURA_RARITIES.map((rarity) => (
                        <option key={rarity} value={rarity}>
                          {rarityName(rarity)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Set
                    <select
                      value={wardrobeFilter.set}
                      disabled={locked}
                      onChange={(event) =>
                        setWardrobeFilter({
                          ...wardrobeFilter,
                          set: event.target.value,
                        })
                      }
                    >
                      <option value="all">All sets</option>
                      {AURA_SETS.map((set) => (
                        <option key={set.id} value={set.id}>
                          {set.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  {isFiltered(wardrobeFilter) && (
                    <button
                      type="button"
                      className="inv-filter-reset"
                      onClick={() => setWardrobeFilter(DEFAULT_WARDROBE_FILTER)}
                    >
                      Clear filters
                    </button>
                  )}
                </div>
              )}
              {!auras.length && (
                <div className="inventory-empty inv-empty-compact">
                  <p>
                    <strong>Your backpack is empty.</strong> Open a chest on
                    the map; every Aura you find lands here.
                  </p>
                  {onExplore && (
                    <button className="inventory-action" onClick={onExplore}>
                      Explore the map{" "}
                      <ArrowRight size={20} aria-hidden="true" />
                    </button>
                  )}
                </div>
              )}
              <div
                className="inv-grid"
                ref={gridRef}
                style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
                aria-label="Backpack"
              >
                {stacks.map(({ key, members }) => {
                  const item = members[0];
                  const issued = item.native_claim_state === "issued";
                  return (
                    <button
                      key={key}
                      className={`inv-cell rarity-${item.rarity} ${item.equipped ? "worn" : ""}`}
                      disabled={locked}
                      onClick={() => openItem(item.id)}
                      title={item.name}
                      aria-label={`${item.name}, ${rarityName(item.rarity)}, ${slotName(item.slot)}${members.length > 1 ? `, ${members.length} held` : ""}${item.equipped ? ", equipped" : ""}${issued ? ", being secured" : ""}`}
                    >
                      {sprite(item)}
                      {!!item.equipped && (
                        <span className="inv-cell-worn" aria-hidden="true">
                          <Check size={12} weight="bold" />
                        </span>
                      )}
                      {issued && (
                        <span className="inv-cell-secured" aria-hidden="true">
                          <Wallet size={12} weight="bold" />
                        </span>
                      )}
                      {members.length > 1 && (
                        <span className="inv-cell-count" aria-hidden="true">
                          ×{members.length}
                        </span>
                      )}
                      <span className="inv-cell-pip" aria-hidden="true" />
                    </button>
                  );
                })}
                {lockedEditions.map((edition) => (
                  <button
                    key={edition.id}
                    className="inv-cell locked"
                    onClick={() => setLockedId(edition.id)}
                    title={`${edition.demoName} (not found yet)`}
                    aria-label={`Locked: ${edition.demoName}, ${rarityName(edition.rarity)}, ${slotName(edition.slot)}, not found yet`}
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
                {Array.from({ length: emptySlots }, (_, index) => (
                  <span
                    key={`empty-${index}`}
                    className="inv-cell empty"
                    aria-hidden="true"
                  />
                ))}
              </div>
              {player.nativeOutfit && (
                <p className="inventory-notice">
                  Your map ghost wears the secured outfit. Equipping a practice
                  Aura switches to the practice outfit.
                </p>
              )}
            </>
          ) : (
            <div className="inventory-native-content">
              {nativeContent}
              {nativeExtras && (
                <details className="inventory-disclosure">
                  <summary>Secure Auras & public profile</summary>
                  <div className="inventory-disclosure-body">
                    {nativeExtras}
                  </div>
                </details>
              )}
            </div>
          )}
        </section>
      )}

      {tab === "wardrobe" && (
        <section
          className="inv-panel"
          role="tabpanel"
          id="inv-panel-wardrobe"
          aria-labelledby="inv-tab-wardrobe"
        >
          <AuraSetStatus items={characterItems} />
          {origin?.status === "unavailable" && (
            <p className="inventory-notice" role="status">
              {origin.error ||
                "Your originals could not be checked. Your current look is unchanged."}
            </p>
          )}
          {origin?.lookUnavailable && (
            <p className="inventory-notice" role="status">
              Your chosen original could not be confirmed this time, so your
              starter ghost is shown.
            </p>
          )}
          <details className="inventory-disclosure inventory-originals" open>
            <summary>
              <LinkSimple size={20} aria-hidden="true" />
              <span>
                Original Aavegotchi look <small>Wear one you own</small>
              </span>
            </summary>
            <div className="inventory-disclosure-body">
              <p>
                Link your Aavegotchi wallet to wear an original you own.
                Originals stay where they are and cannot be sold here.
              </p>
              <button
                className="inventory-secondary"
                onClick={() => void onEvm()}
                disabled={locked}
              >
                <Wallet size={19} aria-hidden="true" />
                {origin?.linked
                  ? "Link another address"
                  : "Link Aavegotchi wallet"}
              </button>
              {origin?.linked && (
                <button
                  className="inventory-secondary"
                  onClick={() => void refreshOrigin()}
                  disabled={locked || originLoading}
                >
                  <ArrowsClockwise size={19} aria-hidden="true" />
                  {originLoading
                    ? "Checking ownership…"
                    : "Check originals again"}
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
                    {origin.count || 0} original
                    {origin.count === 1 ? "" : "s"} verified
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
                              ? "Image unavailable"
                              : player.appearance?.originTokenId ===
                                  gotchi.tokenId
                                ? "Equipped"
                                : "Wear this look"}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                  <details className="inventory-disclosure">
                    <summary>
                      Original item inventory{" "}
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
                    <p>Only the first 50 originals are checked for now.</p>
                  )}
                </>
              )}
              <p>
                Original wearables are still being added; some looks have no
                3D preview yet.
              </p>
              {player.appearance?.originTokenId && (
                <button
                  className="inventory-secondary"
                  onClick={() => void onSkin(null)}
                  disabled={locked}
                >
                  Back to starter ghost
                </button>
              )}
            </div>
          </details>

          <details className="inventory-disclosure">
            <summary>
              <GearSix size={20} aria-hidden="true" /> Display & artwork
            </summary>
            <div className="inventory-disclosure-body">
              <button
                className="inventory-secondary"
                onClick={onMap3D}
                aria-pressed={map3D}
              >
                <Cube size={20} aria-hidden="true" />
                {map3D ? "Use 2D map character" : "Try 3D map character"}
              </button>
              <p>
                2D is the default on phones. Looks without a 3D model stay in
                2D.
              </p>
              <p>
                Character artwork:{" "}
                <a
                  href="https://github.com/aavegotchi/aavegotchi-assets"
                  target="_blank"
                  rel="noreferrer"
                >
                  Aavegotchi assets
                </a>
                . 3D models:{" "}
                <a
                  href="https://www.aavegotchi.com/sdk"
                  target="_blank"
                  rel="noreferrer"
                >
                  Aavegotchi 3D SDK
                </a>
                .
              </p>
            </div>
          </details>
        </section>
      )}

      {tab === "history" && (
        <section
          className="inv-panel"
          role="tabpanel"
          id="inv-panel-history"
          aria-labelledby="inv-tab-history"
        >
          {adventureResults || (
            <p className="inv-grid-caption">
              Practice adventure results appear here.
            </p>
          )}
          <AuraCatalog items={auras} />
        </section>
      )}

      {show3D && (
        <Character3D
          items={characterItems}
          originTokenId={player.appearance?.originTokenId}
          onClose={() => setShow3D(false)}
        />
      )}
      {lockedEdition && (
        <Dialog label="Locked Aura" onClose={() => setLockedId(null)}>
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
                className="inventory-icon-button"
                aria-label="Close"
                onClick={() => setLockedId(null)}
              >
                <X size={22} />
              </button>
            </header>
            <p className="inventory-notice">
              Not found yet. {editionSourceLabel(lockedEdition)}.
            </p>
          </section>
        </Dialog>
      )}
      {selectedId && (
        <Dialog
          label={selling ? "List Aura" : "Aura details"}
          onClose={closeItem}
        >
          <section className="inventory-dialog inv-detail">
            {!selected ? (
              <>
                <header className="inv-detail-head">
                  <h2>Your Aura</h2>
                  <button
                    className="inventory-icon-button"
                    aria-label="Close item details"
                    onClick={closeItem}
                  >
                    <X size={22} />
                  </button>
                </header>
                <p>This Aura is no longer in your collection.</p>
                <button
                  className="inventory-action"
                  onClick={closeItem}
                  disabled={locked}
                >
                  Back to collection
                </button>
              </>
            ) : (
              <>
                <header className="inv-detail-head">
                  <div className={`inv-detail-art rarity-${selected.rarity}`}>
                    <AuraSprite
                      edition={auraEdition(selected)}
                      slot={selected.slot}
                      color={selected.color}
                      size={2}
                    />
                  </div>
                  <div className="inv-detail-title">
                    <h2>{selling ? "List Aura" : selected.name}</h2>
                    <p>
                      <span className={`inv-rarity rarity-${selected.rarity}`}>
                        {rarityName(selected.rarity)}
                      </span>{" "}
                      · {slotName(selected.slot)}
                      {selected.serial != null ? ` · #${selected.serial}` : ""}
                    </p>
                    <span className="inventory-source">
                      Practice Aura
                      {selected.equipped ? " · Equipped" : ""}
                      {!selected.equipped && selectedCount > 1
                        ? ` · ${selectedCount} held`
                        : ""}
                    </span>
                  </div>
                  <button
                    className="inventory-icon-button"
                    aria-label="Close item details"
                    onClick={closeItem}
                  >
                    <X size={22} />
                  </button>
                </header>
                {selected.native_claim_state === "issued" && (
                  <p className="inventory-notice">
                    This Aura is being secured and cannot be listed. Find it in
                    the Secured collection.
                  </p>
                )}
                {selling && selected.native_claim_state !== "issued" ? (
                  <form
                    className="inventory-sale-form"
                    onSubmit={(event) => {
                      event.preventDefault();
                      void listItem();
                    }}
                  >
                    <p>
                      Listing moves this Aura to the market. You get practice
                      GOLD when another explorer buys it.
                    </p>
                    <label htmlFor="inventory-list-price">
                      Price in practice GOLD
                    </label>
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
                      Practice market only. Secured Auras and originals stay
                      put.
                    </p>
                    {priceDraft.hasDraft && (
                      <p className="inventory-sale-note" role="status">
                        {priceDraft.storageAvailable
                          ? "Price draft saved here. Check the amount before listing."
                          : "Your price draft could not be saved. Keep this tab open."}
                      </p>
                    )}
                    {priceDraft.hasDraft && (
                      <button
                        className="inventory-secondary"
                        type="button"
                        disabled={locked}
                        onClick={() => priceDraft.discard()}
                      >
                        Discard price draft
                      </button>
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
                        Back
                      </button>
                      <button
                        className="inventory-action"
                        disabled={locked}
                        type="submit"
                      >
                        <Tag size={20} aria-hidden="true" />
                        {locked ? "Listing…" : "List"}
                      </button>
                    </div>
                  </form>
                ) : (
                  <>
                    <div className="inv-detail-actions">
                      <button
                        className="inventory-action"
                        disabled={locked}
                        onClick={() => onEquip(selected)}
                      >
                        {selected.equipped ? (
                          <X size={20} aria-hidden="true" />
                        ) : (
                          <Eye size={20} aria-hidden="true" />
                        )}
                        {busy === "equip"
                          ? "Saving outfit…"
                          : selected.equipped
                            ? "Take it off"
                            : "Try it on"}
                      </button>
                      <button
                        className="inventory-secondary"
                        disabled={locked || !!selected.native_claim_state}
                        onClick={() => setSelling(true)}
                      >
                        <Tag size={20} aria-hidden="true" />
                        Sell
                      </button>
                    </div>
                    <p className="inventory-sale-note" role="status">
                      {selected.equipped
                        ? "Equipped. It glows on your map ghost."
                        : "Try it on to wear it on the map."}
                      {player.nativeOutfit
                        ? " Your map ghost wears the secured outfit right now."
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
