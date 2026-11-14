import { useEffect } from "react";
import { EmptyState } from "./EmptyState";
import type { Item, Player } from "./types";
import { AuraArt } from "./Ghost";
import { tr } from "./i18n";
export function AuraClaims({
  player,
  enabled,
  busy,
  onConnect,
  onMint,
  onConfirm,
  onSync,
  onRestore,
}: {
  player: Player;
  enabled: boolean;
  busy: string;
  onConnect: () => Promise<void>;
  onMint: (item: Item) => Promise<unknown>;
  onConfirm: (item: Item) => Promise<void>;
  /** Quiet claim check; resolves an Aura that minted while the card was closed. */
  onSync?: (item: Item) => Promise<void>;
  onRestore: (item: Item) => Promise<void>;
}) {
  const linked = player.wallets.length > 0,
    items = player.inventory.filter(
      (i) =>
        i.kind === "aura" &&
        i.native_claim_state !== "minted" &&
        ((enabled && linked) || i.native_claim_state === "issued"),
    );
  const pending = items
    .filter((i) => i.native_claim_state === "issued")
    .map((i) => i.id)
    .join(",");
  // Check claims in flight once when the card opens, so a minted Aura shows
  // as secured without the explorer pressing Check claim.
  useEffect(() => {
    if (!pending || !onSync) return;
    for (const item of items)
      if (item.native_claim_state === "issued") void onSync(item);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending]);
  return (
    <section className="aura-claims">
      <h2>{tr("Secure your Auras")}</h2>
      {!linked && (
        <>
          <p>
            {tr("Activate your account to secure an Aura you earned. A secured Aura is yours even outside this game.")}</p>
          <button
            className="button secondary"
            disabled={!!busy}
            onClick={() => void onConnect()}
          >
            {tr("Activate my account")}</button>
        </>
      )}
      {linked && !enabled && (
        <p>
          {tr("Securing is paused right now. You can still check or restore an Aura you already started.")}</p>
      )}
      {linked && enabled && (
        <p>
          {tr("Securing holds up to")}{" "}<strong>{tr("0.05 test NEAR")}</strong> {" "}{tr("for storage; anything unused comes back. The Aura is reserved for 15 minutes and leaves the practice market once secured.")}</p>
      )}
      {enabled && linked && !items.length && (
        <EmptyState art="chest" title={tr("Nothing to secure yet")}>
          {tr("Open a chest to find your next Aura.")}</EmptyState>
      )}
      {items.map((item) => (
        <article className="aura-claim" key={item.id}>
          <div className="aura-claim-heading">
            <AuraArt color={item.color} slot={item.slot} name={item.name} />
            <div>
              <h3>{item.name}</h3>
              <span>
                {item.native_claim_state === "issued"
                  ? tr("Being secured")
                  : tr("Earned Aura")}
              </span>
            </div>
          </div>
          {item.native_claim_state === "issued" && (
            <>
              <p>
                {tr("Claim expires")}{" "}
                {new Date(item.native_claim_expires_at!).toLocaleString(
                  "en-GB",
                  { dateStyle: "medium", timeStyle: "short" },
                )}
                {tr(". You can try again. If it was not secured by then, restore the practice Aura.")}</p>
              {item.native_claim_receiver && (
                <span className="native-address">
                  {tr("Account:")}{" "}{item.native_claim_receiver}
                </span>
              )}
            </>
          )}
          <div className="native-equip-actions">
            <button
              className="primary-button"
              disabled={!!busy || !enabled || !linked}
              onClick={() => void onMint(item)}
            >
              {item.native_claim_state === "issued"
                ? tr("Finish securing")
                : tr("Secure this Aura")}
            </button>
            {item.native_claim_state === "issued" && (
              <>
                <button
                  className="button secondary"
                  disabled={!!busy}
                  onClick={() => void onConfirm(item)}
                >
                  {tr("Check claim")}</button>
                <button
                  className="button secondary"
                  disabled={
                    !!busy || Date.now() <= item.native_claim_expires_at!
                  }
                  onClick={() => void onRestore(item)}
                >
                  {tr("Restore practice Aura")}</button>
              </>
            )}
          </div>
        </article>
      ))}
    </section>
  );
}
