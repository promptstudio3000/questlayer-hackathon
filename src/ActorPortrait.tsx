import { useEffect, useState } from "react";
import { artUrl } from "./art-registry";
import "./art-world";

const BAKED = new Set(["chronicler", "merchant", "keeper", "pilgrim", "wisp"]);

/** Reuse the actor's actual art; a contain frame preserves the entire silhouette. */
export function ActorPortrait({ model, label }: { model?: string; label: string }) {
  const supplied = model ? artUrl(`portraits/${model}`, `actors/${model}`) : null;
  const initial = supplied || (model && BAKED.has(model) ? `/art/npc/${model}.png` : "");
  const [image, setImage] = useState(initial);
  useEffect(() => {
    setImage(initial);
    if (initial || !model) return;
    let live = true;
    import("./actor-models").then(m => m.actorSprite(model, 384)).then(src => {
      if (live) setImage(src);
    }).catch(() => {});
    return () => { live = false; };
  }, [initial, model]);
  return image ? <img src={image} alt={label} width={384} height={384} /> : null;
}
