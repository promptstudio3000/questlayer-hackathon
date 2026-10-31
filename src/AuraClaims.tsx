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
  onMint: (item: Item) => Promise<void>;
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
      <h2>Bring your Aura to NEAR</h2>
      {!linked && (
        <>
          <p>
            Connect your NEAR wallet to mint an earned Aura as your own testnet
            NFT.
          </p>
          <button
            className="button secondary"
            disabled={!!busy}
            onClick={() => void onConnect()}
          >
            Connect NEAR
          </button>
        </>
      )}
      {linked && !enabled && (
        <p>
          Minting is temporarily unavailable. You can still check existing
          claims or restore expired ones.
        </p>
      )}
      {linked && enabled && (
        <p>
          Your wallet approves up to <strong>0.05 test NEAR</strong> for
          storage; unused deposit returns. Requesting a claim reserves its demo
          item for 15 minutes. A confirmed NFT leaves the demo market.
        </p>
      )}
      {enabled && linked && !items.length && (
        <p>Find a park chest to discover your next Aura.</p>
      )}
      {items.map((item) => (
        <article className="aura-claim" key={item.id}>
          <div className="aura-claim-heading">
            <AuraArt color={item.color} slot={item.slot} />
            <div>
              <h3>{item.name}</h3>
              <span>
                {item.native_claim_state === "issued"
                  ? "Claim reserved"
                  : "Earned demo Aura"}
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
                . You can retry signing. Restore the demo item after expiry if
                no NFT minted.
              </p>
              {item.native_claim_receiver && (
                <span className="native-address">
                  Claim wallet: {item.native_claim_receiver}
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
                ? "Finish mint"
                : "Mint on NEAR"}
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
                  Restore demo
                </button>
              </>
            )}
          </div>
        </article>
      ))}
    </section>
  );
}
