import { useEffect, useState } from "react";
import {
  ArrowRight,
  ArrowSquareOut,
  ArrowClockwise,
  Wallet,
  Check,
} from "@phosphor-icons/react";
import { Character } from "./Character";
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
      <div className="section-label">
        <h2>Your NEAR collectibles</h2>
        <span className="network-label">TESTNET</span>
      </div>
      <p>
        These NFTs live in your NEAR wallet. Demo GOLD and demo items remain
        separate.
      </p>
      {!player.wallets.length ? (
        <button
          className="secondary-button"
          disabled={!!busy}
          onClick={() => void onConnect()}
        >
          <Wallet size={20} />
          Connect a NEAR wallet
        </button>
      ) : (
        <>
          <button className="text-button" disabled={!!busy} onClick={onRefresh}>
            <ArrowClockwise size={18} />
            Refresh NEAR inventory
          </button>
          {!data && !error && (
            <p role="status">Reading your on-chain inventory…</p>
          )}
          {error && (
            <p className="inline-error" role="alert">
              {error}
            </p>
          )}
          {data?.accounts.map((account) => (
            <div className="native-account" key={account.accountId}>
              <strong className="native-address">{account.accountId}</strong>
              <span>{account.supply} owned NFTs</span>
              {!account.starterMinted ? (
                <>
                  <button
                    className="primary-button"
                    disabled={!!busy}
                    onClick={() => void onMint(account.accountId)}
                  >
                    Create my explorer NFT
                    <ArrowRight size={18} />
                  </button>
                  <p className="fine-print">
                    Your wallet confirms up to 0.05 test NEAR for NFT storage;
                    unused storage deposit is refunded. This does not spend demo
                    GOLD.
                  </p>
                </>
              ) : (
                <p className="native-confirmation">
                  {account.starterOwned ? (
                    <>
                      <Check size={16} />
                      Your explorer NFT is in this wallet.
                    </>
                  ) : (
                    "Your starter NFT has already been minted."
                  )}
                </p>
              )}
              {!!account.items.length && (
                <button
                  className={
                    player.nativeOutfit &&
                    player.nativeAccount === account.accountId
                      ? "primary-button"
                      : "secondary-button"
                  }
                  disabled={!!busy}
                  onClick={() =>
                    void onSource(
                      player.nativeOutfit &&
                        player.nativeAccount === account.accountId
                        ? null
                        : account.accountId,
                    )
                  }
                >
                  {player.nativeOutfit &&
                  player.nativeAccount === account.accountId
                    ? "Use my demo outfit"
                    : "Wear this NEAR outfit"}
                  <ArrowRight size={18} />
                </button>
              )}
              <div className="native-items">
                {account.items.map((item) => (
                  <article className="native-item" key={item.tokenId}>
                    <NativePicture item={item} />
                    <div>
                      <h3>{item.title}</h3>
                      <small className="native-address">{item.tokenId}</small>
                      {item.kind === "aura" && (
                        <div className="native-equip-actions">
                          {(["above", "below"] as const).map((slot) => (
                            <button
                              className="secondary-button"
                              key={slot}
                              disabled={!!busy}
                              onClick={() =>
                                void onEquip(account.accountId, item, slot)
                              }
                            >
                              {account.equipment[slot] === item.tokenId
                                ? "Remove " + slot
                                : "Wear " + slot}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </article>
                ))}
              </div>
              {account.truncated && (
                <p className="fine-print">
                  Showing the first 100 NFTs plus your equipped items.
                </p>
              )}
            </div>
          ))}
        </>
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
