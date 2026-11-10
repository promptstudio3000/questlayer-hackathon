import { ArrowRight } from "./dir-icons";
import type { OriginalInventory } from "./Inventory";
import { tr } from "./i18n";
import "./owned-gotchis.css";

/**
 * Backpack card for a linked Aavegotchi wallet: the owned gotchis (best rarity
 * score first, tap to wear one) and a peek at the wallet's wearables, which
 * open in the Wardrobe. Everything here stays in the wallet.
 */
export function OwnedGotchis({
  origin,
  wearing,
  locked,
  onWear,
  onWardrobe,
}: {
  origin: OriginalInventory;
  wearing?: string;
  locked: boolean;
  onWear: (tokenId: string) => void;
  onWardrobe: () => void;
}) {
  const gotchis = (origin.gotchis || []).filter((g) => g.claimed !== false && g.hasImage);
  const wearables = origin.wearables || [];
  return (
    <section className="owned-gotchis" aria-label={tr("Your Aavegotchis")}>
      {gotchis.length > 0 && (
        <>
          <h3>
            {tr("Your Aavegotchis")} <span>{gotchis.length}</span>
          </h3>
          <ul className="owned-gotchi-row">
            {gotchis.map((g) => {
              const worn = g.tokenId === wearing;
              return (
                <li key={g.tokenId}>
                  <button
                    type="button"
                    className={worn ? "selected" : ""}
                    aria-pressed={worn}
                    disabled={locked || worn}
                    onClick={() => onWear(g.tokenId)}
                    title={worn ? tr("Wearing {0}", { 0: g.name }) : tr("Wear {0}", { 0: g.name })}
                  >
                    <img src={`/api/aavegotchi/skin?tokenId=${encodeURIComponent(g.tokenId)}`} alt="" loading="lazy" />
                    <strong>{g.name}</strong>
                    <small>{g.brs != null ? tr("BRS {0}", { 0: g.brs }) : `#${g.tokenId}`}</small>
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      )}
      <button type="button" className="owned-gotchi-wearables" onClick={onWardrobe}>
        <span className="owned-gotchi-peek" aria-hidden="true">
          {wearables.slice(0, 5).map((w) => (
            <img key={w.itemId} src={`/api/aavegotchi/wearable/${encodeURIComponent(w.itemId)}.svg`} alt="" loading="lazy" />
          ))}
        </span>
        <span>
          {wearables.length === 1
            ? tr("1 wearable in your wallet")
            : tr("{0} wearables in your wallet", { 0: wearables.length })}
        </span>
        <ArrowRight size={18} aria-hidden="true" />
      </button>
    </section>
  );
}
