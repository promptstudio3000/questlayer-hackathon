// Profile → Stake → Earnings: the explorer's own NEAR ("fuel"). Gas for game
// actions is sponsored; this small balance covers account storage and the
// player's own payments (Aura buys, deposits). When it runs low the player can
// send NEAR from any wallet or exchange, or sell QGOLD for
// NEAR at the vault (docs/RELAYER.md, "Fuel and refuel").
import { useEffect, useState } from "react";
import { ArrowsClockwise, Copy, GasPump } from "@phosphor-icons/react";
import { api, ApiError } from "./api";
import { tr } from "./i18n";

type Fuel = {
  accountId: string | null;
  balanceYocto: string | null;
  targetYocto: string;
  belowYocto: string;
  canRefuel: boolean;
  reason: string | null;
};
const near = (yocto: string | null) =>
  yocto === null ? "…" : (Number(BigInt(yocto) / 10n ** 18n) / 1e6).toLocaleString("en-US", { maximumFractionDigits: 4 });

export function FuelCard({ refreshKey }: { refreshKey: string }) {
  const [fuel, setFuel] = useState<Fuel | null>(null),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState<string | null>(null),
    [copied, setCopied] = useState(false),
    [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    void api<Fuel>("/account/fuel").then((f) => live && setFuel(f), () => live && setFuel(null));
    return () => {
      live = false;
    };
  }, [refreshKey, tick]);
  if (!fuel?.accountId) return null;
  const refuel = async () => {
    setBusy(true);
    setMessage(null);
    try {
      await api("/account/refuel", {});
      setMessage(tr("Refuelled. Your account has NEAR for its next payments."));
    } catch (error) {
      setMessage(error instanceof ApiError ? error.message : tr("Could not refuel right now. Try again later."));
    } finally {
      setBusy(false);
      setTick((t) => t + 1);
    }
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(fuel.accountId!);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };
  const low = fuel.balanceYocto !== null && BigInt(fuel.balanceYocto) < BigInt(fuel.belowYocto);
  return (
    <section className="fuel-card" aria-labelledby="fuel-title">
      <h3 id="fuel-title">
        <GasPump size={18} weight="duotone" aria-hidden="true" /> {tr("NEAR for your payments")}
      </h3>
      <p className="fuel-balance">
        <strong>{near(fuel.balanceYocto)} NEAR</strong>
        {low && <span className="fuel-low">{tr("Running low")}</span>}
      </p>
      <p className="fuel-note">
        {tr("The game pays the gas for every action. This small balance covers your account's storage and your own payments, such as buying an Aura.")}
      </p>
      <div className="fuel-actions">
        {fuel.reason !== "FUEL_START_ONLY" && (
          <button type="button" className="secondary-button" onClick={refuel} disabled={busy || !fuel.canRefuel}>
            <ArrowsClockwise size={18} aria-hidden="true" /> {tr("Refuel to {0} NEAR", { 0: near(fuel.targetYocto) })}
          </button>
        )}
        <a className="secondary-button" href="/economy#qgold">
          {tr("Convert QGOLD to NEAR")}
        </a>
        <button type="button" className="secondary-button" onClick={copy}>
          <Copy size={18} aria-hidden="true" /> {copied ? tr("Account name copied") : tr("Add your own NEAR")}
        </button>
      </div>
      <small className="fuel-hint">
        {fuel.reason === "FUEL_START_ONLY"
          ? tr("Your account got its starting NEAR once, when it was created. Add your own NEAR: send it from any wallet or exchange to {0}.", { 0: fuel.accountId })
          : fuel.reason === "FUEL_REFUELED_TODAY"
          ? tr("You already refuelled today. Tomorrow you can again.")
          : fuel.reason === "FUEL_NOT_LOW"
            ? tr("Refuel opens when your balance drops below {0} NEAR, once a day.", { 0: near(fuel.belowYocto) })
            : tr("Add your own NEAR: send it from any wallet or exchange to {0}.", { 0: fuel.accountId })}
      </small>
      {message && <p className="fuel-message" role="status">{message}</p>}
    </section>
  );
}
