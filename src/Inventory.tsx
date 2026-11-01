import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  ArrowDown,
  ArrowRight,
  ArrowUp,
  ArrowsClockwise,
  Check,
  Coins,
  Cube,
  Eye,
  GearSix,
  LinkSimple,
  Sparkle,
  Tag,
  Wallet,
  X,
} from "@phosphor-icons/react";
import { api, GOLD } from "./api";
import { Character } from "./Character";
import { Character3D } from "./Character3D";
import { Dialog } from "./Dialog";
import { useFormDraft } from "./useFormDraft";
import { createReadEpoch } from "./read-epoch";
import { AuraArt, Ghost } from "./Ghost";
import { AuraCatalog, AuraSetStatus, AuraWardrobeFilters } from "./AuraWardrobe";
import {
  DEFAULT_WARDROBE_FILTER,
  filterAuras,
  sortAuras,
  type WardrobeFilter,
} from "./aura-wardrobe.ts";
import { OriginalItemGallery, type OriginalItem } from "./OriginalItemGallery";
import type { Item, Player } from "./types";
import "./inventory.css";

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
  // Resolve every action against current inventory: a removed or reserved item
  // must not stay actionable through an older selection.
  const selected = auras.find((item) => item.id === selectedId);
  const locked = !!busy || listingPending;
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

  return (
    <div className="inventory-experience">
      <header className="inventory-hero">
        <div className="inventory-character-stage">
          <Character
            items={characterItems}
            originTokenId={player.appearance?.originTokenId}
          />
          <button
            className="inventory-icon-button inventory-preview-button"
            aria-label="Preview character in 3D"
            onClick={() => setShow3D(true)}
          >
            <Cube size={22} aria-hidden="true" />
          </button>
        </div>
        <div className="inventory-identity">
          <span className="inventory-kicker">Your look</span>
          <h2>{player.name}</h2>
          <span className="inventory-source">
            <Check size={16} aria-hidden="true" />
            {player.nativeOutfit ? "Secured outfit" : "Practice outfit"}
          </span>
          <p>
            {player.appearance?.originTokenId
              ? "Wearing an original Aavegotchi"
              : "Starter ghost"}
          </p>
        </div>
      </header>

      <div className="inventory-slots" aria-label="Current equipped Aura slots">
        {(["above", "below"] as const).map((slot) => {
          const item = characterItems.find(
            (entry) => !!entry.equipped && entry.slot === slot,
          );
          const Icon = slot === "above" ? ArrowUp : ArrowDown;
          return (
            <div
              className={`inventory-slot ${item ? "occupied" : ""}`}
              key={slot}
            >
              <span>
                <Icon size={18} aria-hidden="true" />{" "}
                {slot === "above" ? "Above" : "Below"}
              </span>
              <strong>{item?.name || "Empty"}</strong>
            </div>
          );
        })}
      </div>

      <AuraSetStatus items={characterItems} />

      <section className="inventory-collection" aria-label="Your collection">
        <div className="inventory-section-heading">
          <h3>Your collection</h3>
          <Sparkle size={22} aria-hidden="true" />
        </div>
        <div
          className="inventory-collection-switch"
          aria-label="Collection type"
        >
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
            <Wallet size={19} aria-hidden="true" /> Secured
          </button>
        </div>
        {collection === "demo" ? (
          <>
            <p className="inventory-collection-caption">
              Auras are the glow you find in chests. Wear one above and one
              below.
            </p>
            {auras.length > 1 && (
              <AuraWardrobeFilters
                filter={wardrobeFilter}
                onChange={setWardrobeFilter}
                shown={shownAuras.length}
                total={auras.length}
                disabled={locked}
              />
            )}
            {!!auras.length && !shownAuras.length && (
              <p className="inventory-collection-caption">
                No Auras match these filters.
              </p>
            )}
            {!!shownAuras.length && (
              <div className="inventory-item-grid">
                {shownAuras.map((item) => (
                  <button
                    className={`inventory-item-choice rarity-${item.rarity}`}
                    key={item.id}
                    disabled={locked}
                    onClick={() => {
                      setSelectedId(item.id);
                      setSelling(false);
                      setPrice("10");
                      setListingError("");
                    }}
                    aria-label={`${item.name}, ${rarityNames[item.rarity] || item.rarity}, ${item.slot}${item.equipped ? ", equipped" : ""}${item.native_claim_state === "issued" ? ", claim reserved" : ""}`}
                  >
                    <AuraArt color={item.color} slot={item.slot} name={item.name} />
                    <strong>{item.name}</strong>
                    <span>
                      {rarityNames[item.rarity] || item.rarity} ·{" "}
                      {item.slot === "above" ? "Above" : "Below"}
                    </span>
                    {item.equipped ? (
                      <em>
                        <Check size={14} aria-hidden="true" /> Equipped
                      </em>
                    ) : item.native_claim_state === "issued" ? (
                      <em>Being secured</em>
                    ) : (
                      <em>
                        View item <ArrowRight size={14} aria-hidden="true" />
                      </em>
                    )}
                  </button>
                ))}
              </div>
            )}
            {!auras.length && (
              <div className="inventory-empty">
                <Sparkle size={30} aria-hidden="true" />
                <h4>No Auras yet</h4>
                <p>
                  Open a chest on the map. Every Aura you find lands here, ready
                  to try on.
                </p>
                {onExplore && (
                  <button className="inventory-action" onClick={onExplore}>
                    Explore the map <ArrowRight size={20} aria-hidden="true" />
                  </button>
                )}
              </div>
            )}
            <AuraCatalog items={auras} />
            {player.nativeOutfit && (
              <p className="inventory-notice">
                Your map ghost wears the secured outfit. Equipping a practice
                Aura switches to the practice outfit.
              </p>
            )}
            {adventureResults}
          </>
        ) : (
          <div className="inventory-native-content">
            {nativeContent}
            {nativeExtras && (
              <details className="inventory-disclosure">
                <summary>Secure Auras & public profile</summary>
                <div className="inventory-disclosure-body">{nativeExtras}</div>
              </details>
            )}
          </div>
        )}
      </section>

      {origin?.status === "unavailable" && (
        <p className="inventory-notice" role="status">
          {origin.error ||
            "Your originals could not be checked. Your current look is unchanged."}
        </p>
      )}
      {origin?.lookUnavailable && (
        <p className="inventory-notice" role="status">
          Your chosen original could not be confirmed this time, so your starter
          ghost is shown.
        </p>
      )}
      <details className="inventory-disclosure inventory-originals">
        <summary>
          <LinkSimple size={20} aria-hidden="true" />
          <span>
            Original Aavegotchi look <small>Wear one you own</small>
          </span>
        </summary>
        <div className="inventory-disclosure-body">
          <p>
            Link your Aavegotchi wallet to wear an original you own. Originals
            stay where they are and cannot be sold here.
          </p>
          <button
            className="inventory-secondary"
            onClick={() => void onEvm()}
            disabled={locked}
          >
            <Wallet size={19} aria-hidden="true" />
            {origin?.linked ? "Link another address" : "Link Aavegotchi wallet"}
          </button>
          {origin?.linked && (
            <button
              className="inventory-secondary"
              onClick={() => void refreshOrigin()}
              disabled={locked || originLoading}
            >
              <ArrowsClockwise size={19} aria-hidden="true" />
              {originLoading ? "Checking ownership…" : "Check originals again"}
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
                {origin.count || 0} original{origin.count === 1 ? "" : "s"}{" "}
                verified
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
                          : player.appearance?.originTokenId === gotchi.tokenId
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
            Original wearables are still being added; some looks have no 3D
            preview yet.
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
            2D is the default on phones. Looks without a 3D model stay in 2D.
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

      {show3D && (
        <Character3D
          items={characterItems}
          originTokenId={player.appearance?.originTokenId}
          onClose={() => setShow3D(false)}
        />
      )}
      {selectedId && (
        <Dialog
          label={selling ? "List Aura" : "Aura details"}
          onClose={closeItem}
        >
          <section className="inventory-dialog">
            <header>
              <h2>{selling ? "List Aura" : "Your Aura"}</h2>
              <button
                className="inventory-icon-button"
                aria-label="Close item details"
                onClick={closeItem}
              >
                <X size={22} />
              </button>
            </header>
            {!selected ? (
              <>
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
                <div className="inventory-item-detail">
                  <AuraArt color={selected.color} slot={selected.slot} name={selected.name} />
                  <h3>{selected.name}</h3>
                  <p>
                    {rarityNames[selected.rarity] || selected.rarity} ·{" "}
                    {selected.slot === "above" ? "Above" : "Below"}
                    {selected.serial != null ? ` · #${selected.serial}` : ""}
                  </p>
                  <span className="inventory-source">
                    Practice Aura{selected.equipped ? " · Equipped" : ""}
                  </span>
                </div>
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
                    <button
                      className="inventory-action"
                      disabled={locked}
                      type="submit"
                    >
                      <Tag size={20} aria-hidden="true" />
                      {locked ? "Listing…" : "List for practice GOLD"}
                    </button>
                    <button
                      className="inventory-secondary"
                      type="button"
                      disabled={locked}
                      onClick={() => setSelling(false)}
                    >
                      Back to item
                    </button>
                  </form>
                ) : (
                  <div className="inventory-item-actions">
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
                      List on market
                    </button>
                    <p className="inventory-sale-note" role="status">
                      {selected.equipped
                        ? "Equipped. It glows on your map ghost."
                        : "Try it on to wear it on the map."}
                      {player.nativeOutfit
                        ? " Your map ghost wears the secured outfit right now."
                        : ""}
                    </p>
                  </div>
                )}
              </>
            )}
          </section>
        </Dialog>
      )}
    </div>
  );
}
