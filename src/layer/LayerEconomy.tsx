// The explorer's MetaLayer wallet: MetaGold (this world's own coin), MetaXP,
// badges and land, read from the MetaLayer contract by the server. Rewards
// still on their way are listed so a story step never looks unpaid.
import { CoinIcon } from "../app-bits";
import { formatGold } from "../gold-units";
import { tr } from "../i18n";

export type Economy = {
  active: boolean;
  account: string | null;
  metagold: string | null;
  metaXp: number | null;
  badges: string[];
  parcels: string[];
  pending: { kind: string; metagold: number; metaXp: number; waiting: string }[];
  treasury: { available: string; paidToday: string; dailyCap: string; parcelPrice: string } | null;
  error?: string;
};

const BADGES: Record<string, string> = {
  "quiet-beacon": "Quiet Beacon",
  "crystal-hollow": "Crystal Hollow",
};
const parcelName = (id: string) => id.replace(/^parcel:/, "").replace(":", ", ");

export function LayerEconomy({ economy: e }: { economy: Economy }) {
  const waitingGold = e.pending.reduce((sum, p) => sum + p.metagold, 0);
  return (
    <section className="ml-economy" aria-label={tr("MetaGold")}>
      <div className="ml-inventory">
        <div><CoinIcon /><strong>{e.metagold === null ? "—" : formatGold(Number(e.metagold))}</strong><span>{tr("MetaGold")}</span></div>
        <div><strong>{e.metaXp ?? "—"}</strong><span>{tr("MetaXP")}</span></div>
      </div>
      {!e.account && <p className="ml-story-note">{tr("Secure your explorer in Settings → Account to receive MetaGold. Your rewards wait until then.")}</p>}
      {e.pending.length > 0 && (
        <p className="ml-story-note">{tr("On the way: {0} MetaGold from {1} story steps.", { 0: formatGold(waitingGold), 1: e.pending.length })}</p>
      )}
      {e.badges.length > 0 && (
        <>
          <h3>{tr("Badges")}</h3>
          <ul className="ml-badges">{e.badges.map(b => <li key={b}>{tr(BADGES[b] ?? b)}</li>)}</ul>
        </>
      )}
      {e.parcels.length > 0 && (
        <>
          <h3>{tr("Your land")}</h3>
          <ul className="ml-badges">{e.parcels.map(p => <li key={p}>{parcelName(p)}</li>)}</ul>
        </>
      )}
      {e.error && <p className="ml-story-note">{tr(e.error)}</p>}
    </section>
  );
}
