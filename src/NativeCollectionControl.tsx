import { Footprints, Pause, Play } from "@phosphor-icons/react";
import type { NativeAutoView } from "./native-autocollect";
import { GameObjectArt } from "./game-object-art";
import "./native-collection.css";
import { tr } from "./i18n";
import { goldFromYocto } from "./gold-units.ts";

const rewardGold = (value: string) => goldFromYocto(value);
export function NativeCollectionControl({
  collection,
  ready,
  onToggle,
}: {
  collection: NativeAutoView;
  ready: boolean;
  onToggle: (enabled: boolean) => void;
}) {
  return (
    <section className="native-collection" aria-label={tr("Walking collection")}>
      <button
        className="native-collection-toggle"
        aria-pressed={collection.enabled}
        disabled={!ready && !collection.enabled}
        onClick={() => onToggle(!collection.enabled)}
      >
        <Footprints size={23} aria-hidden="true" />
        <span>
          {collection.enabled ? tr("Pause collection") : tr("Collect as you walk")}
        </span>
        {collection.enabled ? (
          <Pause size={20} aria-hidden="true" />
        ) : (
          <Play size={20} aria-hidden="true" />
        )}
      </button>
      <p>
        {!ready && !collection.enabled
          ? tr("Connect and join testnet walks to start.")
          : collection.message}
      </p>
      {collection.confirmed.count > 0 && (
        <div
          className="native-collection-result"
          role="status"
          aria-live="polite"
        >
          <GameObjectArt kind="coin" size={24} />
          <span>
            <b>{rewardGold(collection.confirmed.amount)} GOLD</b> ·{" "}
            {collection.confirmed.count} {" "}{tr("confirmed this session")}</span>
        </div>
      )}
      {collection.pending > 0 && (
        <small>{collection.pending} {" "}{tr("waiting for NEAR confirmation")}</small>
      )}
    </section>
  );
}
