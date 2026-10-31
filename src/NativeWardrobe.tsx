import { useEffect, useState } from "react";
import {
  ArrowRight,
  ArrowSquareOut,
  ArrowClockwise,
  Wallet,
  Check,
  ArrowUp,
  ArrowDown,
  X,
} from "@phosphor-icons/react";
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
export function nativeAppearanceItems(
  account: NativeAccount | undefined,
): Item[] {
  return (
    account?.items.map((item) => ({
      id: "native:" + item.tokenId,
      kind: item.kind,
      name: item.title,
      rarity: item.rarity,
      color: item.color,
      serial: item.serial,
      slot:
        item.kind === "avatar"
          ? "avatar"
          : account.equipment.above === item.tokenId
            ? "above"
            : "below",
      equipped:
        item.kind === "avatar" ||
        account.equipment.above === item.tokenId ||
        account.equipment.below === item.tokenId
          ? 1
          : 0,
    })) || []
  );
}
export function NativePicture({ item }: { item: NativeItem }) {
  // Game appearance preview; historical on-chain cover media is unchanged.
  return item.kind === "aura" ? (
    <AuraArt color={item.color} small />
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
            "The on-chain collection is temporarily unavailable. Try again later.",
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
        Owned in your NEAR wallet. Testnet NFTs stay separate from demo items
        and GOLD.
      </p>
      {!player.wallets.length ? (
        <button
          className="inventory-action"
          disabled={!!busy}
          onClick={() => void onConnect()}
        >
          <Wallet size={20} aria-hidden="true" /> Connect a NEAR wallet
        </button>
      ) : (
        <>
          <button
            className="inventory-secondary"
            disabled={!!busy}
            onClick={onRefresh}
          >
            <ArrowClockwise size={18} aria-hidden="true" /> Refresh NEAR
            inventory
          </button>
          {!data && !error && (
            <p role="status">Reading your on-chain inventory…</p>
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
                aria-label={`Inventory for ${account.accountId}`}
              >
                <strong className="native-address">{account.accountId}</strong>
                <span>
                  {account.supply} owned NFTs
                  {wearing ? " · Current map outfit" : ""}
                </span>
                {!!account.items.length && (
                  <button
                    className="inventory-secondary"
                    disabled={actionBlocked}
                    onClick={() =>
                      void onSource(wearing ? null : account.accountId)
                    }
                  >
                    {wearing ? "Use my demo outfit" : "Wear this NEAR outfit"}
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
                          <AuraArt color={item.color} slot={slot || "above"} />
                          <strong>{item.title}</strong>
                          <span className="inventory-rarity">
                            {item.rarity}
                          </span>
                          <em>
                            {slot ? (
                              <>
                                <Check size={14} aria-hidden="true" /> Equipped{" "}
                                {slot}
                              </>
                            ) : (
                              <>
                                View item{" "}
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
                    No Auras in this wallet yet. Mint an eligible earned Aura
                    using Claims & public profile below.
                  </p>
                )}
                <details className="inventory-disclosure">
                  <summary>
                    Explorer NFT{" "}
                    <span>
                      {account.starterOwned
                        ? "· Owned"
                        : account.starterMinted
                          ? "· Already minted"
                          : "· Create"}
                    </span>
                  </summary>
                  <div className="inventory-disclosure-body">
                    {!account.starterMinted ? (
                      <>
                        <p>
                          Your wallet confirms up to{" "}
                          <strong>0.05 test NEAR</strong> for NFT storage;
                          unused storage deposit returns. This does not spend
                          demo GOLD.
                        </p>
                        <button
                          className="inventory-action"
                          disabled={actionBlocked}
                          onClick={() => void onMint(account.accountId)}
                        >
                          Create my explorer NFT{" "}
                          <ArrowRight size={18} aria-hidden="true" />
                        </button>
                      </>
                    ) : (
                      <p className="native-confirmation">
                        {account.starterOwned ? (
                          <>
                            <Check size={16} aria-hidden="true" />
                            Your explorer NFT is in this wallet.
                          </>
                        ) : (
                          "Your starter NFT has already been minted."
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
                        </article>
                      ))}
                  </div>
                </details>
                {account.truncated && (
                  <p className="fine-print">
                    Showing the first 100 NFTs plus your equipped items.
                  </p>
                )}
              </section>
            );
          })}
        </>
      )}
      {selection && (
        <Dialog label="NEAR Aura details" onClose={() => setSelection(null)}>
          <section className="inventory-dialog">
            <header>
              <h2>NEAR Aura</h2>
              <button
                className="inventory-icon-button"
                aria-label="Close NEAR Aura details"
                onClick={() => setSelection(null)}
              >
                <X size={22} />
              </button>
            </header>
            {!selectedAccount || !selectedItem ? (
              <p>
                This Aura is no longer in the loaded wallet inventory. Refresh
                your NEAR inventory to check ownership.
              </p>
            ) : (
              <>
                <div className="inventory-item-detail">
                  <AuraArt
                    color={selectedItem.color}
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
                  <span className="inventory-source">NEAR testnet NFT</span>
                </div>
                {error && (
                  <p className="inventory-error" role="alert">
                    Ownership could not be refreshed. Close this item and
                    refresh the inventory before changing equipment.
                  </p>
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
                        {equipped ? "Remove " + slot : "Wear " + slot}
                      </button>
                    );
                  })}
                  <p className="inventory-sale-note" role="status">
                    {error
                      ? "Last loaded outfit shown; ownership verification is unavailable."
                      : busy
                        ? "Waiting for wallet approval and a confirmed outfit…"
                        : selectedAccount.equipment.above ===
                            selectedItem.tokenId
                          ? "Confirmed on-chain: equipped above."
                          : selectedAccount.equipment.below ===
                              selectedItem.tokenId
                            ? "Confirmed on-chain: equipped below."
                            : "This Aura is not equipped in either slot."}
                  </p>
                  {(!player.nativeOutfit ||
                    player.nativeAccount !== selectedAccount.accountId) && (
                    <p className="inventory-sale-note">
                      The map uses another outfit. Select Wear this NEAR outfit
                      after equipping.
                    </p>
                  )}
                </div>
                <details className="inventory-disclosure">
                  <summary>NFT details</summary>
                  <div className="inventory-disclosure-body">
                    <p className="native-address">
                      Token: {selectedItem.tokenId}
                    </p>
                    <p className="native-address">
                      Wallet: {selectedAccount.accountId}
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
        <summary>Explore the public testnet collection</summary>
        {galleryError ? (
          <>
            <p role="alert">{galleryError}</p>
            <button
              className="button secondary"
              onClick={() => setGalleryRefresh((n) => n + 1)}
            >
              Retry collection
            </button>
          </>
        ) : !gallery ? (
          <p role="status">Loading the NEAR collection…</p>
        ) : (
          <>
            {gallery.outfits?.map((outfit) => (
              <div className="native-outfit-preview" key={outfit.accountId}>
                <Character items={nativeAppearanceItems(outfit)} />
                <div>
                  <strong>On-chain outfit</strong>
                  <small className="native-address">{outfit.accountId}</small>
                  <span>Live NEAR testnet equipment</span>
                </div>
              </div>
            ))}
            <p>
              {gallery.name} · {gallery.supply} on-chain NFTs
            </p>
            <div className="native-items">
              {gallery.items.map((item) => (
                <article className="native-item" key={item.tokenId}>
                  <NativePicture item={item} />
                  <div>
                    <h3>{item.title}</h3>
                    <small className="native-address">{item.tokenId}</small>
                    <small className="native-address">
                      Owner: {item.ownerId}
                    </small>
                  </div>
                </article>
              ))}
            </div>
            <a
              className="text-button"
              href={`https://testnet.nearblocks.io/address/${gallery.contractId}`}
              target="_blank"
              rel="noreferrer"
            >
              View contract
              <ArrowSquareOut size={16} />
            </a>
          </>
        )}
      </details>
    </section>
  );
}
