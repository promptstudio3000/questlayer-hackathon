import { useEffect, useState } from "react";
import { Flame } from "@phosphor-icons/react";
import { api } from "./api";
import { tr } from "./i18n";
import "./stake-tier-chip.css";

// Staking tier on the map (owner, 14 Nov 2026): staking is central but hidden
// in Profile, so a small chip under the world switcher (on phones beside the
// daily goals) says where the explorer stands and opens Profile → Stake.
// Same chip on the Test Layer, GotchiGO and MetaLayer.
type Step = "none" | "staker" | "tier2" | "tier3";
type Gates = { access?: { step?: string; tier?: number; maturing?: string } };

const STEPS: Step[] = ["none", "staker", "tier2", "tier3"];

export function stakeTierLabel(step: Step, maturing = false): string {
  if (step === "tier3") return tr("Tier {0}", { 0: 3 });
  if (step === "tier2") return tr("Tier {0}", { 0: 2 });
  if (step === "staker") return tr("Staker");
  return maturing ? tr("Staker soon") : tr("Free");
}

export function StakeTierChip({ fallbackTier = 1, refreshKey, onOpen }: { fallbackTier?: number; refreshKey?: string | number; onOpen: () => void }) {
  const [gates, setGates] = useState<Gates | null>(null);
  useEffect(() => {
    let live = true;
    api<Gates>("/staker/gates").then(
      (g) => live && setGates(g),
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [refreshKey]);
  const read = gates?.access?.step as Step | undefined;
  const step: Step = read && STEPS.includes(read) ? read : fallbackTier >= 3 ? "tier3" : fallbackTier === 2 ? "tier2" : "none";
  let maturing = false;
  try {
    maturing = BigInt(gates?.access?.maturing || "0") > 0n;
  } catch {
    maturing = false;
  }
  const label = stakeTierLabel(step, maturing);
  return (
    <button
      type="button"
      className="stake-tier-chip"
      data-step={step}
      aria-label={tr("Staking tier: {0}. Open staking", { 0: label })}
      title={tr("Your staking tier")}
      onClick={onOpen}
    >
      <Flame size={18} weight={step === "none" ? "regular" : "fill"} aria-hidden="true" />
      <b>{label}</b>
    </button>
  );
}
