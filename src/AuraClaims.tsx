import type { Item, Player } from "./types";
import { AuraArt } from "./Ghost";
export function AuraClaims({
  player,
  enabled,
  busy,
  onConnect,
  onMint,
  onConfirm,
  onRestore,
}: {
  player: Player;
  enabled: boolean;
  busy: string;
  onConnect: () => Promise<void>;
  onMint: (item: Item) => Promise<unknown>;
  onConfirm: (item: Item) => Promise<void>;
  onRestore: (item: Item) => Promise<void>;
}) {
  const linked = player.wallets.length > 0,
    items = player.inventory.filter(
      (i) =>
        i.kind === "aura" &&
        i.native_claim_state !== "minted" &&
        ((enabled && linked) || i.native_claim_state === "issued"),
    );
  return (
    <section className="aura-claims">
      <h2>Secure your Auras</h2>
      {!linked && (
        <>
          <p>
            Link a NEAR account to secure an Aura you earned. A secured Aura is
            yours even outside this game.
          </p>
          <button
            className="button secondary"
            disabled={!!busy}
            onClick={() => void onConnect()}
          >
            Link NEAR account
          </button>
        </>
      )}
      {linked && !enabled && (
        <p>
          Securing is paused right now. You can still check or restore an Aura
          you already started.
        </p>
      )}
      {linked && enabled && (
        <p>
          Securing holds up to <strong>0.05 test NEAR</strong> for storage;
          anything unused comes back. The Aura is reserved for 15 minutes and
          leaves the practice market once secured.
        </p>
      )}
      {enabled && linked && !items.length && (
        <p>Nothing to secure yet. Open a chest to find your next Aura.</p>
      )}
      {items.map((item) => (
        <article className="aura-claim" key={item.id}>
          <div className="aura-claim-heading">
            <AuraArt color={item.color} slot={item.slot} name={item.name} />
            <div>
              <h3>{item.name}</h3>
              <span>
                {item.native_claim_state === "issued"
                  ? "Being secured"
                  : "Earned Aura"}
              </span>
            </div>
          </div>
          {item.native_claim_state === "issued" && (
            <>
              <p>
                Claim expires{" "}
                {new Date(item.native_claim_expires_at!).toLocaleString(
                  "en-GB",
                  { dateStyle: "medium", timeStyle: "short" },
                )}
                . You can try again. If it was not secured by then, restore the
                practice Aura.
              </p>
              {item.native_claim_receiver && (
                <span className="native-address">
                  Account: {item.native_claim_receiver}
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
                ? "Finish securing"
                : "Secure this Aura"}
            </button>
            {item.native_claim_state === "issued" && (
              <>
                <button
                  className="button secondary"
                  disabled={!!busy}
                  onClick={() => void onConfirm(item)}
                >
                  Check claim
                </button>
                <button
                  className="button secondary"
                  disabled={
                    !!busy || Date.now() <= item.native_claim_expires_at!
                  }
                  onClick={() => void onRestore(item)}
                >
                  Restore practice Aura
                </button>
              </>
            )}
          </div>
        </article>
      ))}
    </section>
  );
}
