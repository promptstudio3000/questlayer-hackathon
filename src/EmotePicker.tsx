import { useEffect, useState } from "react";
import { tr } from "./i18n";
import { EMOTE_GLYPH } from "./gold-emotes";
import { goldEmote, goldShop, type ShopEmote } from "./gold-spend-client";
import "./gold-spend.css";

// Quick emote picker from the map toolbar: free emotes plus the premium ones
// the player unlocked in the shop. The emote shows above the character for
// everyone nearby for 30 seconds.
export function EmotePicker({
  onEmote,
  onShop,
  onClose,
}: {
  onEmote: (emote: string, until: number) => void;
  onShop: () => void;
  onClose: () => void;
}) {
  const [emotes, setEmotes] = useState<ShopEmote[] | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    goldShop().then((s) => setEmotes(s.emotes.filter((e) => e.owned)), (e) => setError(e.message));
  }, []);
  return (
    <div className="emote-picker" role="dialog" aria-label={tr("Emotes")}>
      {error && <p className="gold-shop-note">{error}</p>}
      <div className="emote-picker-grid">
        {(emotes || []).map((e) => (
          <button
            type="button"
            key={e.id}
            aria-label={tr("Show emote {0}", { 0: e.id })}
            onClick={async () => {
              try {
                const r = await goldEmote(e.id);
                onEmote(r.emote, r.until);
                onClose();
              } catch (x) {
                setError(x instanceof Error ? x.message : tr("Could not connect to the game."));
              }
            }}
          >
            <span aria-hidden="true">{EMOTE_GLYPH[e.id]}</span>
          </button>
        ))}
      </div>
      <button type="button" className="emote-picker-more" onClick={onShop}>
        {tr("More emotes in the shop")}
      </button>
    </div>
  );
}
