// A zone above the player's tier (Lubos, 11 Nov 2026): shown on the map but
// locked. Entering one opens this dialog once per zone and visit; tapping the
// zone shows the same card in its panel. It says which tier opens the zone and
// how much to stake, with a Stake button (the stake sheet, amount prefilled)
// and a link to How it works. Never odds or payouts.
import { LockKey, X } from "@phosphor-icons/react";
import { Dialog } from "./Dialog";
import { openStakeScreen } from "./LockedChip";
import { tierStakeNear } from "./tier-stake";
import { qgoldOfNear } from "./qgold-display";
import { tr } from "./i18n";
import "./locked-zone.css";
import type { Zone } from "./types";

export function LockedZoneCard({ zone, onStake }: { zone: Zone; onStake?: () => void }) {
  const near = tierStakeNear(zone.tier);
  return (
    <div className="locked-panel locked-zone-card">
      <LockKey size={25} aria-hidden="true" />
      <h3>{tr("Tier {0} zone", { 0: zone.tier })}</h3>
      <p>{tr("Stake {0} QGOLD in one go to enter.", { 0: qgoldOfNear(near) })}</p>
      <div className="locked-zone-actions">
        <button
          type="button"
          className="primary-button"
          onClick={() => {
            onStake?.();
            openStakeScreen(String(near));
          }}
        >
          {tr("Stake {0} QGOLD", { 0: qgoldOfNear(near) })}
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
