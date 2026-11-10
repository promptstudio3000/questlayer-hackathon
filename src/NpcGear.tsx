import { useEffect, useState } from "react";
import { Sparkle, Storefront } from "@phosphor-icons/react";
import { gold, GOLD } from "./api";
import { tr } from "./i18n";
import { goldGear, goldShop, type Shop } from "./gold-spend-client";
import "./gold-spend.css";

// Trader premium gear (QGOLD stream 4): GOLD is burned first, then a
// chest-edition Aura from the shared supply lands in the wardrobe.
export function NpcGear({ actorId, encounter }: { actorId: string; encounter: string }) {
  const [shop, setShop] = useState<Shop | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  useEffect(() => {
    goldShop().then(setShop, () => setShop(null));
  }, []);
  if (!shop) return null;
  const done = shop.gear.boughtToday >= shop.gear.perDay;
  return (
    <div className="npc-gear">
      <p className="npc-gear-title">
        <Storefront weight="duotone" /> {tr("Premium gear for GOLD")} · {gold(shop.balanceU, shop.realm === "qgold" ? 6 : 0)}
      </p>
      {done && <p className="gold-shop-note">{tr("One premium piece per day. Come back tomorrow.")}</p>}
      {shop.gear.items.map((g) => (
        <button
          type="button"
          key={g.id}
          className="npc-action"
          disabled={busy || done || g.left === 0 || shop.balanceU < Math.round(g.price * GOLD)}
          onClick={async () => {
            setBusy(true);
            setMessage("");
            try {
              const r = await goldGear(actorId, encounter, g.id);
              setMessage(tr("{0} is in your wardrobe.", { 0: r.item.name }));
              setShop(await goldShop());
            } catch (e) {
              setMessage(e instanceof Error ? e.message : tr("Could not connect to the game."));
            } finally {
              setBusy(false);
            }
          }}
        >
          <span className="npc-action-icon">
            <Sparkle weight="duotone" />
          </span>
          <span className="npc-action-label">{g.name}</span>
          <small>
            {tr("{0} GOLD", { 0: g.price })}
            {g.left !== null ? ` · ${tr("{0} left", { 0: g.left })}` : ""}
          </small>
        </button>
      ))}
      {message && (
        <p className="gold-shop-note" aria-live="polite">
          {message}
        </p>
      )}
    </div>
  );
}
