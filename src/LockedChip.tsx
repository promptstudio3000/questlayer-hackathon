// Shared locked chip for stakers-only lures (docs/GAME-LOOPS.md §5, §8):
// greyed art, a lock and exactly what is missing ("Stake 2 NEAR (~5 €) ·
// Reach level 4", from server/staker-gates.mjs). Tapping it opens a short
// preview and a button to the stake sheet with the amount prefilled. Lures are
// only things to do or wear; this chip never shows odds or payouts.
import { useState } from "react";
import "./locked-chip.css";
import { tr } from "./i18n";

import { nearTextInQgold, qgoldOfNear } from "./qgold-display";
export const OPEN_STAKE_EVENT = "questlayer:open-stake";
export const STAKER_SUGGEST_NEAR = "2";

// The stake sheet mounts after the tab switch, so the prefill waits here.
let stakePrefill: string | null = null;
/** Amount a chip asked the stake sheet to prefill (read once). */
export function takeStakePrefill(): string | null {
  const v = stakePrefill;
  stakePrefill = null;
  return v;
}
export const openStakeScreen = (near: string = STAKER_SUGGEST_NEAR) => {
  stakePrefill = /^\d{1,4}(\.\d{1,3})?$/.test(near) ? near : STAKER_SUGGEST_NEAR;
  window.dispatchEvent(new CustomEvent(OPEN_STAKE_EVENT, { detail: { near: stakePrefill } }));
};

export interface LockGate {
  tier?: number;
  step?: "staker" | "tier2" | "tier3" | string;
  level?: number;
  /** Exactly what is missing, ready to show: "Stake 2 NEAR (~5 €)", "Reach level 4". */
  missing?: string[];
  /** NEAR to prefill on the stake sheet. */
  stakeNear?: string;
}

const stepName = (gate: LockGate) =>
  gate.step === "staker" ? tr("Stakers") : gate.step?.startsWith("tier") ? tr("Tier {0}", { 0: gate.step.slice(4) }) : gate.tier ? tr("Tier {0}", { 0: gate.tier }) : tr("Stakers");

export const lockLabel = (gate: LockGate) =>
  gate.missing?.length ? nearTextInQgold(gate.missing.join(" · ")) : `${stepName(gate)}${gate.level && gate.level > 1 ? ` · Level ${gate.level}` : ""}`;

const needsStake = (gate: LockGate) =>
  !gate.missing || gate.missing.some((m) => /^(Stake|Reach Tier|Your stake)/.test(m));

export default function LockedChip({
  label,
  perk,
  gate,
  onStake = openStakeScreen,
}: {
  label: string;
  perk?: string;
  gate: LockGate;
  onStake?: (near?: string) => void;
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
          <p>
            {gate.missing?.length
              ? tr("Missing: {0}.", { 0: nearTextInQgold(gate.missing.join(", ")) })
              : tr("Stake to reach {0}.", { 0: stepName(gate) })}{" "}
            {needsStake(gate) ? tr("A stake counts two epochs after the deposit.") : tr("Keep exploring to level up.")}
          </p>
          <p className="locked-chip-fair">{tr("Staking unlocks things to do and wear, never better odds.")}</p>
          {needsStake(gate) && (
            <button type="button" onClick={() => onStake(gate.stakeNear || STAKER_SUGGEST_NEAR)}>
              {tr("Stake {0} QGOLD", { 0: qgoldOfNear(gate.stakeNear || STAKER_SUGGEST_NEAR) })}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
