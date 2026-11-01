// Shared locked chip for stakers-only lures (docs/GAME-LOOPS.md §5, §8):
// greyed art, a lock, "Stakers · Tier 2". Tapping it opens a short preview of
// what unlocks it and a button to the stake screen. Lures are only things to do
// or wear; this chip never shows odds or payouts.
import { useState } from "react";
import "./locked-chip.css";

export const OPEN_STAKE_EVENT = "questlayer:open-stake";
export const openStakeScreen = () => window.dispatchEvent(new Event(OPEN_STAKE_EVENT));

export interface LockGate {
  tier: number;
}

export const lockLabel = (gate: LockGate) => `Stakers · Tier ${gate.tier}`;

export default function LockedChip({
  label,
  perk,
  gate,
  onStake = openStakeScreen,
}: {
  label: string;
  perk?: string;
  gate: LockGate;
  onStake?: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className={`locked-chip${open ? " open" : ""}`}>
      <button type="button" className="locked-chip-face" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <span className="locked-chip-lock" aria-hidden="true">🔒</span>
        <span className="locked-chip-label">{label}</span>
        <small>{lockLabel(gate)}</small>
      </button>
      {open && (
        <div className="locked-chip-preview">
          {perk && <p>{perk}.</p>}
          <p>Stake NEAR to reach Tier {gate.tier}. It turns on two epochs after the deposit.</p>
          <p className="locked-chip-fair">Staking unlocks things to do and wear, never better odds.</p>
          <button type="button" onClick={onStake}>
            See staking
          </button>
        </div>
      )}
    </div>
  );
}
