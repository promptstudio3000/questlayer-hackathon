// A zone above the player's tier (Lubos, 11 Nov 2026): shown on the map but
// locked. Entering one opens this dialog once per zone and visit; tapping the
// zone shows the same card in its panel. It says which tier opens the zone and
// how much to stake, with a Stake button (the stake sheet, amount prefilled)
// and a link to How it works. Never odds or payouts.
import { LockKey, X } from "@phosphor-icons/react";
import { Dialog } from "./Dialog";
import { openStakeScreen } from "./LockedChip";
import { tierStakeNear } from "./tier-stake";
import { tr } from "./i18n";
import "./locked-zone.css";
import type { Zone } from "./types";

export function LockedZoneCard({ zone, onStake }: { zone: Zone; onStake?: () => void }) {
  const near = tierStakeNear(zone.tier);
  return (
    <div className="locked-panel locked-zone-card">
      <LockKey size={25} aria-hidden="true" />
      <h3>{tr("Opens at Tier")}{" "}{zone.tier}</h3>
      <p>
        {tr("{0} is a Tier {1} zone. It opens with {2} NEAR of matured stake in the vault (at a 100 % prize-pool share). Free places nearby are open to everyone.", { 0: zone.name, 1: zone.tier, 2: near })}
      </p>
      <p className="locked-zone-note">
        {tr("Already staking less? One stake per explorer: withdraw it and stake {0} NEAR at once.", { 0: near })}
      </p>
      <div className="locked-zone-actions">
        <button
          type="button"
          className="primary-button"
          onClick={() => {
            onStake?.();
            openStakeScreen(String(near));
          }}
        >
          {tr("Stake {0} NEAR", { 0: near })}
        </button>
        <a className="locked-zone-how" href="/how-it-works#staking">
          {tr("How it works")}
        </a>
      </div>
    </div>
  );
}

export function LockedZoneDialog({ zone, onClose }: { zone: Zone; onClose: () => void }) {
  return (
    <Dialog label={tr("Tier {0} zone", { 0: zone.tier })} onClose={onClose}>
      <section className="locked-zone-dialog">
        <div className="panel-heading">
          <h2>{zone.name}</h2>
          <button type="button" className="icon-button" aria-label={tr("Close")} onClick={onClose}>
            <X size={20} />
          </button>
        </div>
        <LockedZoneCard zone={zone} onStake={onClose} />
      </section>
    </Dialog>
  );
}
