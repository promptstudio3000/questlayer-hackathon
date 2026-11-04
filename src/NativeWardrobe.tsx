import { useEffect, useState } from "react";
import {
  ArrowSquareOut,
  ArrowClockwise,
  Wallet,
  Check,
  ArrowUp,
  ArrowDown,
  X,
} from "@phosphor-icons/react";
import { ArrowRight } from "./dir-icons";
import { Character } from "./Character";
import { Dialog } from "./Dialog";
import "./inventory.css";
import { Ghost, AuraArt } from "./Ghost";
import { api } from "./api";
import type {
  Player,
  NativeItem,
  NativeWardrobeState,
  NativeCollectionState,
  NativeAccount,
  Item,
} from "./types";
import { EXPLORER_BASE } from "./near-network.ts";
import { ChainLink } from "./ChainLink";
import { nativeAppearanceItems } from "./native-appearance";
import { tr } from "./i18n";
export { nativeAppearanceItems };
export function NativePicture({ item }: { item: NativeItem }) {
  // Game appearance preview; historical on-chain cover media is unchanged.
  return item.kind === "aura" ? (
    <AuraArt color={item.color} edition={item.edition} small />
  ) : (
    <Ghost />
  );
}
export function NativeWardrobe({
  player,
  data,
  error,
  busy,
  onConnect,
  onRefresh,
  onMint,
  onEquip,
  onSource,
}: {
  player: Player;
  data: NativeWardrobeState | null;
  error: string;
  busy: string;
  onConnect: () => Promise<void>;
  onRefresh: () => void;
  onMint: (account: string) => Promise<void>;
  onEquip: (
    account: string,
    item: NativeItem,
    slot: "above" | "below",
  ) => Promise<void>;
  onSource: (account: string | null) => Promise<void>;
}) {
  const [selection, setSelection] = useState<{
    accountId: string;
    tokenId: string;
  } | null>(null);
  const selectedAccount = data?.accounts.find(
    (account) => account.accountId === selection?.accountId,
  );
  const selectedItem = selectedAccount?.items.find(
    (item) => item.tokenId === selection?.tokenId,
  );
  const actionBlocked = !!busy || !!error;
  const [gallery, setGallery] = useState<NativeCollectionState | null>(null),
    [galleryError, setGalleryError] = useState(""),
    [showGallery, setShowGallery] = useState(false),
    [galleryRefresh, setGalleryRefresh] = useState(0);
  useEffect(() => {
    if (!showGallery) return;
    let current = true,
      request = 0;
    const load = async () => {
      const generation = ++request;
      try {
        const data = await api<NativeCollectionState>("/native/collection");
        if (current && generation === request) {
          setGallery(data);
          setGalleryError("");
        }
      } catch {
        if (current && generation === request)
          setGalleryError(
            tr("The public collection could not load. Try again later."),
          );
      }
    };
    void load();
    const timer = setInterval(() => void load(), 20000);
    return () => {
      current = false;
      clearInterval(timer);
    };
  }, [showGallery, galleryRefresh]);
  return (
    <section className="native-wardrobe">
      <p className="inventory-collection-caption">
        {tr("Auras secured to your NEAR account. They stay separate from practice Auras and GOLD.")}</p>
      {!player.wallets.length ? (
        <button
          className="inventory-action"
          disabled={!!busy}
          onClick={() => void onConnect()}
        >
          <Wallet size={20} aria-hidden="true" /> {" "}{tr("Connect a NEAR wallet")}</button>
      ) : (
        <>
          <button
            className="inventory-secondary"
            disabled={!!busy}
            onClick={onRefresh}
          >
            <ArrowClockwise size={18} aria-hidden="true" /> {" "}{tr("Refresh secured collection")}</button>
          {!data && !error && (
            <p role="status">{tr("Loading your secured collection…")}</p>
          )}
          {error && (
            <p className="inventory-error" role="alert">
              {error}
            </p>
          )}
          {data?.accounts.map((account) => {
            const wearing =
              player.nativeOutfit && player.nativeAccount === account.accountId;
            const auras = account.items.filter((item) => item.kind === "aura");
            return (
              <section
                className="native-account"
                key={account.accountId}
                aria-label={tr("Secured collection for {0}", { 0: account.accountId })}
              >
                <strong className="native-address">{account.accountId}</strong>
                <span>
                  {account.supply === "1" ? tr("1 secured item") : tr("{0} secured items", { 0: account.supply })}
                  {wearing ? tr(" · On the map now") : ""}
                </span>
                {!!account.items.length && (
                  <button
                    className="inventory-secondary"
                    disabled={actionBlocked}
                    onClick={() =>
                      void onSource(wearing ? null : account.accountId)
                    }
                  >
                    {wearing
                      ? tr("Wear my practice outfit")
                      : tr("Wear this secured outfit")}
                    <ArrowRight size={18} aria-hidden="true" />
                  </button>
                )}
                {!!auras.length && (
                  <div className="inventory-item-grid">
                    {auras.map((item) => {
                      const slot =
                        account.equipment.above === item.tokenId
                          ? "above"
                          : account.equipment.below === item.tokenId
                            ? "below"
                            : null;
                      return (
                        <button
                          className={`inventory-item-choice rarity-${item.rarity}`}
                          key={item.tokenId}
                          disabled={!!busy}
                          onClick={() =>
                            setSelection({
                              accountId: account.accountId,
                              tokenId: item.tokenId,
                            })
                          }
                        >
                          <AuraArt
                            color={item.color}
                            edition={item.edition}
                            slot={slot || "above"}
                          />
                          <strong>{item.title}</strong>
                          <span className="inventory-rarity">
                            {item.rarity}
                          </span>
                          <em>
                            {slot ? (
                              <>
                                <Check size={14} aria-hidden="true" /> {" "}{tr("Equipped")}{" "}
                                {slot}
                              </>
                            ) : (
                              <>
                                {tr("View item")}{" "}
                                <ArrowRight size={14} aria-hidden="true" />
                              </>
                            )}
                          </em>
                        </button>
                      );
                    })}
                  </div>
                )}
                {!auras.length && (
                  <p>
                    {tr("No secured Auras yet. Secure an earned Aura under Secure Auras & public profile below.")}</p>
                )}
                <details className="inventory-disclosure">
                  <summary>
                    {tr("Secured explorer")}{" "}
                    <span>
                      {account.starterOwned
                        ? tr("· Owned")
                        : account.starterMinted
                          ? tr("· Already secured")
                          : tr("· Create")}
                    </span>
                  </summary>
                  <div className="inventory-disclosure-body">
                    {!account.starterMinted ? (
                      <>
                        <p>
                          {tr("Securing holds up to")}{" "}<strong>{tr("0.05 test NEAR")}</strong>{" "}
                          {tr("for storage; anything unused comes back. No practice GOLD is spent.")}</p>
                        <button
                          className="inventory-action"
                          disabled={actionBlocked}
                          onClick={() => void onMint(account.accountId)}
                        >
                          {tr("Secure my explorer")}{" "}
                          <ArrowRight size={18} aria-hidden="true" />
                        </button>
                      </>
                    ) : (
                      <p className="native-confirmation">
                        {account.starterOwned ? (
                          <>
                            <Check size={16} aria-hidden="true" />
                            {tr("Your explorer is secured to this account.")}</>
                        ) : (
                          tr("Your explorer was already secured.")
                        )}
                      </p>
                    )}
                    {account.items
                      .filter((item) => item.kind !== "aura")
                      .map((item) => (
                        <article className="native-item" key={item.tokenId}>
                          <NativePicture item={item} />
                          <div>
                            <h3>{item.title}</h3>
                            <span className="native-address">
                              {item.tokenId}
                            </span>
                          </div>
                          {data && (
                            <ChainLink
                              chain={{ token: { contract: data.contractId, id: item.tokenId } }}
                            />
                          )}
                        </article>
                      ))}
                  </div>
                </details>
                {account.truncated && (
                  <p className="fine-print">
                    {tr("Showing the first 100 items plus what you wear.")}</p>
                )}
              </section>
            );
          })}
        </>
      )}
      {selection && (
        <Dialog label={tr("NEAR Aura details")} onClose={() => setSelection(null)}>
          <section className="inventory-dialog">
            <header>
              <h2>{tr("NEAR Aura")}</h2>
              <button
                className="inventory-icon-button"
                aria-label={tr("Close NEAR Aura details")}
                onClick={() => setSelection(null)}
              >
                <X size={22} />
              </button>
            </header>
            {!selectedAccount || !selectedItem ? (
              <p>
                {tr("This Aura is no longer in the loaded collection. Refresh your secured collection to check.")}</p>
            ) : (
              <>
                <div className="inventory-item-detail">
                  <AuraArt
                    color={selectedItem.color}
                    edition={selectedItem.edition}
                    slot={
                      selectedAccount.equipment.below === selectedItem.tokenId
                        ? "below"
                        : "above"
                    }
                  />
                  <h3>{selectedItem.title}</h3>
                  <p className="inventory-rarity">
                    {selectedItem.rarity}
                    {selectedItem.serial != null
                      ? ` · #${selectedItem.serial}`
                      : ""}
                  </p>
                  <span className="inventory-source">{tr("Secured Aura")}</span>
                </div>
                {error && (
                  <p className="inventory-error" role="alert">
                    {tr("Ownership could not be checked. Close this Aura and refresh the collection before changing your outfit.")}</p>
                )}
                <div className="inventory-item-actions">
                  {(["above", "below"] as const).map((slot) => {
                    const equipped =
                      selectedAccount.equipment[slot] === selectedItem.tokenId;
                    const Icon = slot === "above" ? ArrowUp : ArrowDown;
                    return (
                      <button
                        className="inventory-secondary"
                        key={slot}
                        disabled={actionBlocked}
                        onClick={() =>
                          void onEquip(
                            selectedAccount.accountId,
                            selectedItem,
                            slot,
                          )
                        }
                      >
                        <Icon size={20} aria-hidden="true" />
                        {equipped ? tr("Take off {0}", { 0: slot }) : tr("Wear {0}", { 0: slot })}
                      </button>
                    );
                  })}
                  <p className="inventory-sale-note" role="status">
                    {error
                      ? tr("Showing the last loaded outfit; ownership could not be checked.")
                      : busy
                        ? tr("Waiting for your approval and a confirmed outfit…")
                        : selectedAccount.equipment.above ===
                            selectedItem.tokenId
                          ? tr("Equipped above.")
                          : selectedAccount.equipment.below ===
                              selectedItem.tokenId
                            ? tr("Equipped below.")
                            : tr("Not equipped.")}
                  </p>
                  {(!player.nativeOutfit ||
                    player.nativeAccount !== selectedAccount.accountId) && (
                    <p className="inventory-sale-note">
                      {tr("Your map ghost wears another outfit. Choose Wear this secured outfit after equipping.")}</p>
                  )}
                </div>
                <details className="inventory-disclosure">
                  <summary>{tr("Details")}</summary>
                  <div className="inventory-disclosure-body">
                    <p className="native-address">
                      {tr("Token:")}{" "}{selectedItem.tokenId}{" "}
                      {data && (
                        <ChainLink
                          label
                          chain={{ token: { contract: data.contractId, id: selectedItem.tokenId } }}
                        />
                      )}
                    </p>
                    <p className="native-address">
                      {tr("Account:")}{" "}{selectedAccount.accountId}
                    </p>
                  </div>
                </details>
              </>
            )}
          </section>
        </Dialog>
      )}
      <details
        className="native-gallery"
        onToggle={(e) => setShowGallery(e.currentTarget.open)}
      >
        <summary>{tr("Browse everyone's secured Auras")}</summary>
        {galleryError ? (
          <>
            <p role="alert">{galleryError}</p>
            <button
              className="button secondary"
              onClick={() => setGalleryRefresh((n) => n + 1)}
            >
              {tr("Retry collection")}</button>
          </>
        ) : !gallery ? (
          <p role="status">{tr("Loading the public collection…")}</p>
        ) : (
          <>
            {gallery.outfits?.map((outfit) => (
              <div className="native-outfit-preview" key={outfit.accountId}>
                <Character items={nativeAppearanceItems(outfit)} />
                <div>
                  <strong>{tr("Secured outfit")}</strong>
                  <small className="native-address">{outfit.accountId}</small>
                  <span>{tr("What this explorer wears right now")}</span>
                </div>
              </div>
            ))}
            <p>
              {gallery.name} · {gallery.supply} {" "}{tr("secured items")}</p>
            <div className="native-items">
              {gallery.items.map((item) => (
                <article className="native-item" key={item.tokenId}>
                  <NativePicture item={item} />
                  <div>
                    <h3>{item.title}</h3>
                    <small className="native-address">
                      {item.tokenId}{" "}
                      <ChainLink
                        chain={{ token: { contract: gallery.contractId, id: item.tokenId } }}
                      />
                    </small>
                    <small className="native-address">
                      {tr("Owner:")}{" "}{item.ownerId}
                    </small>
                  </div>
                </article>
              ))}
            </div>
            <a
              className="text-button"
              href={`${EXPLORER_BASE}/address/${gallery.contractId}`}
              target="_blank"
              rel="noreferrer"
            >
              {tr("View on NEAR explorer")}<ArrowSquareOut size={16} />
            </a>
          </>
        )}
      </details>
    </section>
  );
}
