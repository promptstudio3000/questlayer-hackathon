import { useState } from "react";
import { Dialog } from "./Dialog";
import { GameObjectArt } from "./game-object-art";
import { distanceLabel } from "./app-bits";
import { tr } from "./i18n";
import type { Coin } from "./types";

export function FindDetails({ coin, available, distanceM, onClose, onPoint, onInventory }: {
  coin: Coin; available: boolean; distanceM: number; onClose: () => void;
  onPoint: () => void; onInventory: () => void;
}) {
  const [failed, setFailed] = useState(false);
  const name = coin.wearable?.name || tr("Street find");
  return <Dialog presentation="encounter" label={name} onClose={onClose}>
    <section className="find-details">
      <div className="find-details-art">
        {coin.wearable && !failed
          ? <img src={`/api/wearables/art/${coin.wearable.id}.svg`} alt={name} onError={() => setFailed(true)} />
          : <GameObjectArt kind="discovery" size={128} />}
      </div>
      <h2>{name}</h2>
      <p>{distanceLabel(distanceM)}</p>
      <p role="status">{available ? tr("This find is collected automatically when you are close enough.") : tr("This find is no longer on the map.")}</p>
      {available
        ? <button className="primary-button" onClick={onPoint}>{tr("Point me there")}</button>
        : <button className="primary-button" onClick={onInventory}>{tr("Inventory")}</button>}
    </section>
  </Dialog>;
}
