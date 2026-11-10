import { ChainLink } from "./ChainLink";
import {
  lazy,
  Suspense,
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
// Aavegotchi wearable clones: own chunk, loaded when the Wardrobe opens.
const GotchiWardrobe = lazy(() =>
  import("./GotchiWardrobe").then((m) => ({ default: m.GotchiWardrobe })),
);
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

export type InventoryTab = "items" | "wardrobe" | "history";
const TABS: { id: InventoryTab; label: string; Icon: typeof Backpack }[] = [
  { id: "items", get label() { return tr("Items"); }, Icon: Backpack },
  { id: "wardrobe", get label() { return tr("Wardrobe"); }, Icon: TShirt },
  { id: "history", get label() { return tr("History"); }, Icon: ClockCounterClockwise },
];
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
  onWearables,
  initialTab = "items",
}: {
  onOriginalAppearance: (appearance: Player["appearance"]) => void;
  /** Wearing a wearable clone changes the player (their map character). */
  onWearables?: (player: Player) => void;
  /** Opens straight on a section, e.g. the Wardrobe right after a wearable pickup. */
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
  const [tab, setTab] = useState<InventoryTab>(initialTab);
  const [filterOpen, setFilterOpen] = useState(false);
  const [gridRef, columns] = useGridColumns();
  const [selling, setSelling] = useState(false);
  const priceDraft = useFormDraft({
    playerId: player.id,
    form: "demo-aura-listing",
    realm: `demo:${selectedId || "none"}`,
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
  // Unowned editions remain in a separate catalog, after the owned collection.
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
  const filledSlots = stacks.length;
  const emptySlots =
    Math.ceil(filledSlots / columns) * columns - filledSlots;
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
      currentSelection.current !== JSON.stringify([player.id, selectedId])
    )
      return;
    if (!selected || selected.native_claim_state === "issued" || locked) return;
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
            const own = item && auras.find((entry) => entry.id === item.id);
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
                    onClick={(event) => { event.currentTarget.focus({ preventScroll: true }); openItem(own.id); }}
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

      {tab === "items" ? (
        <div className="inv-actions" aria-label={tr("Inventory sections")}>
          {TABS.filter(({ id }) => id !== "items").map(({ id, label, Icon }) => (
            <button key={id} className="inv-action-button" onClick={() => setTab(id)}>
              <Icon size={18} aria-hidden="true" />
              {label}
            </button>
          ))}
        </div>
      ) : (
        <div className="inv-subhead">
          <button
            className="panel-back"
            aria-label={tr("Back to backpack")}
            title={tr("Back to backpack")}
            onClick={() => setTab("items")}
          >
            <ArrowLeft size={20} aria-hidden="true" />
          </button>
          <h3 id={`inv-tab-${tab}`}>{TABS.find(({ id }) => id === tab)?.label}</h3>
        </div>
      )}

      {tab === "items" && (
        <section className="inv-panel" id="inv-panel-items" aria-label={tr("Backpack")}>
          <p className="sr-only" aria-live="polite">
            {collection === "near"
              ? tr("Secured on NEAR")
              : isFiltered(wardrobeFilter)
                ? tr("Showing {0} of {1}", { 0: shownAuras.length, 1: auras.length })
                : lockedEditions.length
                  ? tr("{0} still to find", { 0: lockedEditions.length })
                  : tr("Catalog complete")}
          </p>
          {origin?.linked && origin.status === "verified" && (origin.gotchis?.length || origin.wearables?.length) ? (
            <OwnedGotchis
              origin={origin}
              wearing={player.appearance?.originTokenId}
              locked={locked}
              onWear={(id) => void onSkin(id)}
              onWardrobe={() => setTab("wardrobe")}
            />
          ) : (
            <button type="button" className="inv-wearable-hint" onClick={() => setTab("wardrobe")}>
              <TShirt size={18} aria-hidden="true" />
              <span>{tr("Wearables you pick up on the map are in your Wardrobe.")}</span>
            </button>
          )}
          <div className="inv-chips" role="group" aria-label={tr("Filter Auras")}>
            {(["all", "above", "below"] as const).map((slot) => (
              <button
                key={slot}
                className="inv-chip"
                aria-pressed={collection === "demo" && wardrobeFilter.slot === slot}
                disabled={locked}
                onClick={() => {
                  setCollection("demo");
                  setWardrobeFilter({ ...wardrobeFilter, slot });
                }}
              >
                {slot === "all" ? (
                  <>
                    {tr("All")} <span className="inv-chip-count">{auras.length}</span>
                  </>
                ) : (
                  slotName(slot)
                )}
              </button>
            ))}
            <button
              className="inv-chip"
              aria-pressed={collection === "near"}
              disabled={locked}
              onClick={() => setCollection("near")}
            >
              <Wallet size={16} aria-hidden="true" /> {tr("Secured")}
            </button>
            {collection === "demo" && (
              <button
                className="inv-chip inv-chip-icon"
                aria-label={tr("More filters{0}", { 0: extraFilters ? `, ${extraFilters} active` : "" })}
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
            )}
          </div>
          {collection === "demo" ? (
            <>
              {filterOpen && (
                <div className="inv-filter-more" id="inv-filter-more">
                  <label>
                    {tr("Rarity")}<select
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
                      <option value="all">{tr("All rarities")}</option>
                      {AURA_RARITIES.map((rarity) => (
                        <option key={rarity} value={rarity}>
                          {rarityName(rarity)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    {tr("Set")}<select
                      value={wardrobeFilter.set}
                      disabled={locked}
                      onChange={(event) =>
                        setWardrobeFilter({
                          ...wardrobeFilter,
                          set: event.target.value,
                        })
                      }
                    >
                      <option value="all">{tr("All sets")}</option>
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
                      {tr("Clear filters")}</button>
                  )}
                </div>
              )}
              {!auras.length && (
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
              <div
                className="inv-grid"
                role="group"
                ref={gridRef}
                style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
                aria-label={tr("Backpack")}
              >
                {stacks.map(({ key, members }) => {
                  const item = members[0];
                  const issued = item.native_claim_state === "issued";
                  return (
                    <div className="inv-item" key={key}>
                    <button
                      className={`inv-cell rarity-${item.rarity} ${item.equipped ? "worn" : ""}`}
                      data-inventory-item={item.id}
                      disabled={locked}
                      onClick={(event) => { event.currentTarget.focus({ preventScroll: true }); openItem(item.id); }}
                      title={item.name}
                      aria-label={`${item.name}, ${rarityName(item.rarity)}, ${slotName(item.slot)}${members.length > 1 ? tr(", {0} held", { 0: members.length }) : ""}${item.equipped ? tr(", equipped") : ""}${issued ? tr(", being secured") : ""}`}
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
                    <span className="inv-item-name">{item.name}</span>
                    <span className="inv-item-rarity">{rarityName(item.rarity)}</span>
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
            </>
          ) : (
            <div className="inventory-native-content">
              {nativeContent}
              {nativeExtras && (
                <details className="inventory-disclosure">
                  <summary>{tr("Secure Auras & public profile")}</summary>
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
          id="inv-panel-wardrobe"
          aria-labelledby="inv-tab-wardrobe"
        >
          <AuraSetStatus items={characterItems} />
          <Suspense fallback={null}>
            <GotchiWardrobe
              key={origin?.verifiedAt || 0}
              onPlayer={(next) => onWearables?.(next)}
              onLink={() => void onEvm()}
              linking={locked}
            />
          </Suspense>
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
          <details className="inventory-disclosure inventory-originals" open>
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
        </section>
      )}

      {tab === "history" && (
        <section
          className="inv-panel"
          id="inv-panel-history"
          aria-labelledby="inv-tab-history"
        >
          {adventureResults || (
            <p className="inv-grid-caption">
              {tr("Adventure results appear here.")}</p>
          )}
          <AuraCatalog items={auras} />
        </section>
      )}

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
      {selectedId && (
        <Dialog
          label={selling ? tr("List Aura") : tr("Aura details")}
          onClose={closeItem}
          fallbackFocus={() =>
            gridRef.current?.querySelector<HTMLButtonElement>(`[data-inventory-item="${CSS.escape(selectedId)}"]`) ||
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
                    <AuraSprite
                      edition={auraEdition(selected)}
                      slot={selected.slot}
                      color={selected.color}
                      size={2}
                    />
                  </div>
                  <div className="inv-detail-title">
                    <h2>{selling ? tr("List Aura") : selected.name}</h2>
                    <p>
                      <span className={`inv-rarity rarity-${selected.rarity}`}>
                        {rarityName(selected.rarity)}
                      </span>{" "}
                      · {slotName(selected.slot)}
                      {selected.serial != null ? ` · #${selected.serial}` : ""}
                    </p>
                    <span className="inventory-source">
                      {tr("Not on NEAR yet")}{selected.equipped ? tr(" · Equipped") : ""}
                      {!selected.equipped && selectedCount > 1
                        ? ` · ${selectedCount} held`
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
                {selected.native_claim_state === "issued" && (
                  <p className="inventory-notice">
                    {tr("This Aura is being secured and cannot be listed. Find it in the Secured collection.")}{" "}
                    {selected.native_claim_id && (
                      <ChainLink
                        label
                        chain={{
                          id: `aura:${selected.native_claim_id}`,
                          status: "pending",
                          account: selected.native_claim_receiver,
                        }}
                      />
                    )}
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
                      {tr("Selling secures this Aura on NEAR and lists it on the market. You get test NEAR when another explorer buys it.")}</p>
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
                      {tr("Every trade settles on NEAR, and History links the proof. Find or cancel your listing in Market.")}</p>
                    {priceDraft.hasDraft && (
                      <p className="inventory-sale-note" role="status">
                        {priceDraft.storageAvailable
                          ? tr("Price draft saved here. Check the amount before listing.")
                          : tr("Your price draft could not be saved. Keep this tab open.")}
                      </p>
                    )}
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
                        {locked ? tr("Listing…") : tr("List")}
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
                          ? tr("Saving outfit…")
                          : selected.equipped
                            ? tr("Take it off")
                            : tr("Try it on")}
                      </button>
                      <button
                        className="inventory-secondary"
                        disabled={locked || !!selected.native_claim_state}
                        onClick={() => setSelling(true)}
                      >
                        <Tag size={20} aria-hidden="true" />
                        {tr("Sell")}</button>
                    </div>
                    <p className="inventory-sale-note" role="status">
                      {selected.equipped
                        ? tr("Equipped. It glows on your map ghost.")
                        : ""}
                      {player.nativeOutfit
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
