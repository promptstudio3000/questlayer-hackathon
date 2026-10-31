import { Footprints, Pause, Play } from "@phosphor-icons/react";
import type { NativeAutoView } from "./native-autocollect";
import "./native-collection.css";

function rewardGold(value: string) {
  const amount = BigInt(value),
    unit = 10n ** 21n;
  const fraction = (amount % unit)
    .toString()
    .padStart(21, "0")
    .replace(/0+$/, "");
  return `${amount / unit}${fraction ? `.${fraction}` : ""}`;
}
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
    <section className="native-collection" aria-label="Walking collection">
      <button
        className="native-collection-toggle"
        aria-pressed={collection.enabled}
        disabled={!ready && !collection.enabled}
        onClick={() => onToggle(!collection.enabled)}
      >
        <Footprints size={23} aria-hidden="true" />
        <span>
          {collection.enabled ? "Pause collection" : "Collect as you walk"}
        </span>
        {collection.enabled ? (
          <Pause size={20} aria-hidden="true" />
        ) : (
          <Play size={20} aria-hidden="true" />
        )}
      </button>
      <p>
        {!ready && !collection.enabled
          ? "Connect and join testnet walks to start."
          : collection.message}
      </p>
      {collection.confirmed.count > 0 && (
        <div
          className="native-collection-result"
          role="status"
          aria-live="polite"
        >
          <svg
            width="18"
            height="21"
            viewBox="0 0 24 28"
            aria-hidden="true"
            shapeRendering="crispEdges"
          >
            <path fill="#a37429" d="M6 2h12v4h3v16h-3v4H6v-4H3V6h3z" />
            <path fill="#f4c957" d="M6 5h12v3h1v12h-1v3H6v-3H5V8h1z" />
            <path fill="#fff1b2" d="M7 6h4v13H7zm4-1h5v3h-5z" />
            <path fill="#d69c36" d="M13 11h3v8h-3z" />
          </svg>
          <span>
            <b>{rewardGold(collection.confirmed.amount)} GOLD</b> ·{" "}
            {collection.confirmed.count} confirmed this session
          </span>
        </div>
      )}
      {collection.pending > 0 && (
        <small>{collection.pending} waiting for NEAR confirmation</small>
      )}
    </section>
  );
}
