import { Coins, Sparkle, Trophy, Star } from "@phosphor-icons/react";
import type { RewardBurst } from "./reward-burst";
import { ChainLink } from "./lazy-panels";
import "./reward-burst.css";

const ICON = { coin: Coins, xp: Star, find: Sparkle, quest: Trophy, level: Star };

/** Points an XP chip at the XP counter beside the avatar, wherever the HUD puts it. */
function aimAtXpCounter(el: HTMLDivElement | null) {
  const target = el && document.getElementById("hud-xp-count");
  if (!el || !target) return;
  const from = el.getBoundingClientRect(), to = target.getBoundingClientRect();
  if (!to.width) return;
  el.style.setProperty("--fly-x", `${Math.round(to.left + to.width / 2 - (from.left + from.width / 2))}px`);
  el.style.setProperty("--fly-y", `${Math.round(to.top + to.height / 2 - (from.top + from.height / 2))}px`);
}

/** Screen readers get the same news from the toast and pickup summary. */
export function RewardBursts({ bursts }: { bursts: readonly RewardBurst[] }) {
  if (!bursts.length) return null;
  return (
    <div className="reward-bursts" aria-hidden="true">
      {bursts.map((b) => {
        const Icon = ICON[b.tone];
        return (
          <div key={b.id} ref={b.tone === "xp" ? aimAtXpCounter : undefined} className={`reward-burst tone-${b.tone}`}>
            <Icon size={b.tone === "coin" || b.tone === "xp" ? 18 : 26} weight="fill" />
            <span>
              <strong>{b.title}</strong>
              {b.detail && <small>{b.detail}</small>}
            </span>
            {b.chain && <ChainLink chain={b.chain} interactive={false} />}
          </div>
        );
      })}
    </div>
  );
}
