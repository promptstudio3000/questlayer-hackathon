import { useCallback, useEffect, useState } from "react";
import { Fire, Ghost, MapPin, Smiley, Sparkle, Storefront } from "@phosphor-icons/react";
import { gold, GOLD } from "./api";
import { tr } from "./i18n";
import { EMOTE_GLYPH, FRAME_COLOR } from "./gold-emotes";
import {
  goldBuy,
  goldEmote,
  goldEquip,
  goldShop,
  lureQuote,
  setLure,
  type Fix,
  type LureQuote,
  type Shop,
} from "./gold-spend-client";
import "./gold-spend.css";

// GOLD shop (QGOLD stream 4): everything here burns GOLD. Nothing pays another
// player or changes odds. With the QGOLD vault open each purchase burns the
// player's own QGOLD on chain first (src/qgold-burn.ts).
const FRAME_NAME: Record<string, () => string> = {
  "frame-ember": () => tr("Ember frame"),
  "frame-frost": () => tr("Frost frame"),
  "frame-storm": () => tr("Storm frame"),
  "frame-void": () => tr("Void frame"),
  "frame-gold": () => tr("Golden frame"),
};
const LURE_NAME: Record<string, () => string> = {
  monster: () => tr("Monster"),
  trader: () => tr("Trader"),
  beacon: () => tr("Beacon"),
};
const LURE_ICON = { monster: <Ghost weight="duotone" />, trader: <Storefront weight="duotone" />, beacon: <Fire weight="duotone" /> };

export function GoldShop({
  worldId,
  fix,
  arena,
  notify,
  onSpent,
  onEmote,
}: {
  worldId: string | null;
  fix: Fix | null;
  arena: boolean;
  notify: (text: string, error?: boolean) => void;
  onSpent: () => void;
  onEmote?: (emote: string, until: number) => void;
}) {
  const [shop, setShop] = useState<Shop | null>(null);
  const [busy, setBusy] = useState("");
  const [quote, setQuote] = useState<LureQuote | null>(null);
  const load = useCallback(() => goldShop().then(setShop, (e) => notify(e.message, true)), [notify]);
  useEffect(() => {
    void load();
  }, [load]);
  const run = async (key: string, task: () => Promise<unknown>) => {
    setBusy(key);
    try {
      await task();
      await load();
      onSpent();
    } catch (e) {
      notify(e instanceof Error ? e.message : tr("Could not connect to the game."), true);
    } finally {
      setBusy("");
    }
  };
  if (!shop) return <p className="gold-shop-empty">{tr("Opening the shop…")}</p>;
  const can = (price: number) => shop.balanceU >= price * GOLD;
  const priceTag = (price: number) => tr("{0} GOLD", { 0: price });
  const showEmote = (id: string) =>
    run(`show:${id}`, async () => {
      const r = await goldEmote(id);
      onEmote?.(r.emote, r.until);
    });

  return (
    <div className="gold-shop">
      <p className="gold-shop-lead">
        <Sparkle weight="duotone" /> {tr("Spending burns GOLD: it leaves the game for good, so every GOLD left is backed a little better.")}
      </p>
      <p className="gold-shop-balance">
        {shop.realm === "qgold" ? tr("Your QGOLD") : tr("Your GOLD")}: <b>{gold(shop.balanceU, shop.realm === "qgold" ? 6 : 0)}</b>
        {shop.realm === "qgold" ? (
          <small> · {tr("each purchase burns QGOLD from your NEAR account")}</small>
        ) : (
          <small> · {tr("practice GOLD until the QGOLD vault opens")}</small>
        )}
      </p>

      <section aria-labelledby="gold-emotes">
        <h3 id="gold-emotes">
          <Smiley weight="duotone" /> {tr("Emotes above your character")}
        </h3>
        <p className="gold-shop-note">{tr("Basic emotes are free. Tap one to show it on the map for 30 seconds.")}</p>
        <div className="gold-emote-grid">
          {shop.emotes.map((e) => (
            <button
              type="button"
              key={e.id}
              className={`gold-emote${e.owned ? " owned" : ""}`}
              disabled={!!busy || (!e.owned && !can(e.price))}
              onClick={() => (e.owned ? showEmote(e.id) : run(`buy:${e.id}`, () => goldBuy(`emote:${e.id}`)))}
              aria-label={e.owned ? tr("Show emote {0}", { 0: e.id }) : tr("Unlock emote {0} for {1} GOLD", { 0: e.id, 1: e.price })}
            >
              <span className="gold-emote-glyph" aria-hidden="true">
                {EMOTE_GLYPH[e.id]}
              </span>
              <small>{e.free ? tr("Free") : e.owned ? tr("Yours") : priceTag(e.price)}</small>
            </button>
          ))}
        </div>
      </section>

      <section aria-labelledby="gold-frames">
        <h3 id="gold-frames">
          <Sparkle weight="duotone" /> {tr("Marker frames")}
        </h3>
        <div className="gold-frame-list">
          {shop.cosmetics.map((c) => (
            <div className={`gold-frame${c.equipped ? " equipped" : ""}`} key={c.id}>
              <span className="gold-frame-swatch" style={{ borderColor: FRAME_COLOR[c.id] }} aria-hidden="true" />
              <span className="gold-frame-name">{FRAME_NAME[c.id]?.() || c.id}</span>
              {c.owned ? (
                <button type="button" disabled={!!busy} onClick={() => run(`equip:${c.id}`, () => goldEquip(c.equipped ? null : c.id))}>
                  {c.equipped ? tr("Take off") : tr("Wear")}
                </button>
              ) : (
                <button type="button" disabled={!!busy || !can(c.price)} onClick={() => run(`buy:${c.id}`, () => goldBuy(`cosmetic:${c.id}`))}>
                  {priceTag(c.price)}
                </button>
              )}
            </div>
          ))}
        </div>
      </section>

      <section aria-labelledby="gold-lures">
        <h3 id="gold-lures">
          <MapPin weight="duotone" /> {tr("Lures")}
        </h3>
        <p className="gold-shop-note">
          {tr("For {0} minutes a monster or a trader that is already out today comes to the public place where you stand, or a beacon marks it as a meeting point. Players within 1 km see it. {1}–{2}, GPS only.", {
            0: shop.lures.minutes,
            1: shop.lures.hours[0],
            2: shop.lures.hours[1],
          })}
        </p>
        {shop.lures.active ? (
          <p className="gold-lure-active">
            {LURE_ICON[shop.lures.active.kind]} {shop.lures.active.actorName || LURE_NAME[shop.lures.active.kind]()} · {shop.lures.active.place} ·{" "}
            {tr("{0} min left", { 0: Math.ceil(shop.lures.active.secondsLeft / 60) })}
          </p>
        ) : !worldId ? (
          <p className="gold-shop-note">{tr("Open today's map first.")}</p>
        ) : arena || !fix ? (
          <p className="gold-shop-note">{tr("Lures work only with GPS where you physically stand.")}</p>
        ) : (
          <button
            type="button"
            className="gold-primary"
            disabled={!!busy}
            onClick={() =>
              run("quote", async () => {
                setQuote(await lureQuote(worldId, fix));
              })
            }
          >
            {tr("Look for a lure here")}
          </button>
        )}
        {quote && !shop.lures.active && (
          <div className="gold-lure-quote">
            <p>
              {tr("At {0}", { 0: quote.place.name || tr("this place") })}
              {quote.blocked && <b className="gold-lure-blocked"> · {quote.blocked}</b>}
            </p>
            {quote.options.map((o) => (
              <button
                type="button"
                key={o.kind}
                className="gold-lure-option"
                disabled={!!busy || !!quote.blocked || o.price === null || !can(o.price)}
                onClick={() =>
                  worldId &&
                  fix &&
                  run(`lure:${o.kind}`, async () => {
                    await setLure(worldId, fix, o.kind, o.actorId);
                    setQuote(null);
                    notify(tr("Lure set for {0} minutes.", { 0: quote.minutes }));
                  })
                }
              >
                {LURE_ICON[o.kind]}
                <span>
                  {LURE_NAME[o.kind]()}
                  {o.name ? ` · ${o.name}` : ""}
                  {o.distanceM ? ` · ${o.distanceM} m` : ""}
                </span>
                <small>{o.price === null ? o.reason || tr("Not available now") : priceTag(o.price)}</small>
              </button>
            ))}
          </div>
        )}
      </section>

      <section aria-labelledby="gold-gear">
        <h3 id="gold-gear">
          <Storefront weight="duotone" /> {tr("Premium gear")}
        </h3>
        <p className="gold-shop-note">
          {tr("Traders on the map sell one premium Aura a day for GOLD. It lands in your wardrobe and you can secure it on NEAR like any other Aura.")}
        </p>
        <ul className="gold-gear-list">
          {shop.gear.items.map((g) => (
            <li key={g.id}>
              <span>{g.name}</span>
              <small>
                {priceTag(g.price)}
                {g.left !== null ? ` · ${tr("{0} left", { 0: g.left })}` : ""}
              </small>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
