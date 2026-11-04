import { Coins, Sparkle, Trophy, Star } from "@phosphor-icons/react";
import type { RewardBurst } from "./reward-burst";
import { ChainLink } from "./lazy-panels";
import "./reward-burst.css";

const ICON = { coin: Coins, find: Sparkle, quest: Trophy, level: Star };

/** Screen readers get the same news from the toast and pickup summary. */
export function RewardBursts({ bursts }: { bursts: readonly RewardBurst[] }) {
  if (!bursts.length) return null;
  return (
    <div className="reward-bursts" aria-hidden="true">
      {bursts.map((b) => {
        const Icon = ICON[b.tone];
        return (
          <div key={b.id} className={`reward-burst tone-${b.tone}`}>
            <Icon size={b.tone === "coin" ? 18 : 26} weight="fill" />
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
