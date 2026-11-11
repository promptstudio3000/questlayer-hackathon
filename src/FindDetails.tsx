import { useState } from "react";
import { Dialog } from "./Dialog";
import { GameObjectArt } from "./game-object-art";
import { distanceLabel } from "./app-bits";
import { tr } from "./i18n";
import { wearableArtUrl } from "./character-art";
import { RARITY_NAMES } from "./GotchiWardrobe";
import type { Coin } from "./types";

export function FindDetails({ coin, available, distanceM, onClose, onPoint, onInventory }: {
  coin: Coin; available: boolean; distanceM: number; onClose: () => void;
  onPoint: () => void; onInventory: () => void;
}) {
  const [failed, setFailed] = useState(false);
  const name = coin.wearable?.name || tr("Street find");
  return <Dialog presentation="encounter" label={name} onClose={onClose}>
    <section className="find-details">
      {/* Official art is small pixel art (Hook Hand is a 9×9 grey hook), so it
          sits in the same rarity ring as its map marker to read as an item. */}
      <div className={`find-details-art${coin.wearable ? ` wearable-art rarity-${coin.wearable.rarity}` : ""}`}>
        {coin.wearable && !failed
          ? <img src={wearableArtUrl(coin.wearable.id)} alt={name} onError={() => setFailed(true)} />
          : <GameObjectArt kind="discovery" size={128} />}
      </div>
      <h2>{name}</h2>
      {coin.wearable && RARITY_NAMES[coin.wearable.rarity] && <p className={`find-details-rarity rarity-${coin.wearable.rarity}`}>
        {RARITY_NAMES[coin.wearable.rarity]()}
      </p>}
      <p>{distanceLabel(distanceM)}</p>
      <p role="status">{available ? tr("This find is collected automatically when you are close enough.") : tr("This find is no longer on the map.")}</p>
      {available
        ? <button className="primary-button" onClick={onPoint}>{tr("Point me there")}</button>
        : <button className="primary-button" onClick={onInventory}>{tr("Inventory")}</button>}
    </section>
  </Dialog>;
}
