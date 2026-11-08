import { useState } from "react";
import { Dialog } from "./Dialog";
import { GameObjectArt } from "./game-object-art";
import { ChainLink } from "./ChainLink";
import type { ChainRef } from "./chain-proof";
import { tr } from "./i18n";

/** A live confirmed pickup, never reconstructed from history or replayed after reload. */
export function WearableMoment({ wearable, onClose, onWardrobe }: {
  wearable: { id: number; name: string; detail: string; chain?: ChainRef | null }; onClose: () => void; onWardrobe: () => void;
}) {
  const [failed, setFailed] = useState(false);
  return <Dialog presentation="encounter" label={tr("Wearable found: {0}", { 0: wearable.name })} onClose={onClose}>
    <section className="wearable-moment">
      <p>{tr("Nice find!")}</p>
      <div className="wearable-moment-art">{failed ? <GameObjectArt kind="discovery" size={112} /> : <img src={`/api/wearables/art/${wearable.id}.svg`} alt={wearable.name} onError={() => setFailed(true)} />}</div>
      <h2>{wearable.name}</h2>
      <p>{tr("Clone in your Wardrobe")}</p>
      <button className="primary-button" onClick={onClose}>{tr("Continue")}</button>
      <details className="reward-more"><summary>{tr("Learn more")}</summary>
        <p>{tr("A practice wearable for your character. The original collectible stays on its original network.")}</p>
        <p>{wearable.detail}</p>
        {wearable.chain && <ChainLink chain={wearable.chain} />}
        <button className="secondary-button" onClick={onWardrobe}>{tr("Inventory")}</button>
      </details>
    </section>
  </Dialog>;
}
