// "Convert QGOLD to gas" (owner request, 12 Nov 2026): the explorer's own small
// NEAR balance pays for their own payments (Aura buys, stakes). Instead of a
// card on the Stake page, a short dialog opens by itself when that balance runs
// low: turn QGOLD into gas, take the free daily refuel, or top it up from any
// wallet (docs/RELAYER.md, "Fuel and refuel").
import { useEffect, useState } from "react";
import { ArrowSquareOut, ArrowsClockwise } from "@phosphor-icons/react";
import { api, ApiError } from "./api";
import { tr } from "./i18n";
import { Dialog } from "./Dialog";
import { QGOLD_SWAP_URL } from "./funds-help";
import "./funds-help.css";

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
const DISMISSED = "questlayer:gas-dialog-dismissed";
const today = () => new Date().toISOString().slice(0, 10);

/** Watches the explorer's gas and opens the dialog once a day when it runs low. */
export function GasWatch({ refreshKey }: { refreshKey: string }) {
  const [fuel, setFuel] = useState<Fuel | null>(null),
    [open, setOpen] = useState(false),
    [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    void api<Fuel>("/account/fuel").then(
      (f) => {
        if (!live) return;
        setFuel(f);
        const low = !!f.accountId && f.balanceYocto !== null && BigInt(f.balanceYocto) < BigInt(f.belowYocto);
        let dismissed = false;
        try {
          dismissed = localStorage.getItem(DISMISSED) === today();
        } catch {}
        if (low && !dismissed) setOpen(true);
        if (!low) setOpen(false);
      },
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [refreshKey, tick]);
  if (!open || !fuel?.accountId) return null;
  const close = () => {
    try {
      localStorage.setItem(DISMISSED, today());
    } catch {}
    setOpen(false);
  };
  return <GasDialog fuel={fuel} onRefresh={() => setTick((t) => t + 1)} onClose={close} />;
}

function GasDialog({ fuel, onRefresh, onClose }: { fuel: Fuel; onRefresh: () => void; onClose: () => void }) {
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState<string | null>(null),
    [copied, setCopied] = useState(false);
  const refuel = async () => {
    setBusy(true);
    setMessage(null);
    try {
      await api("/account/refuel", {});
      setMessage(tr("Refuelled. Your account has NEAR for its next payments."));
      onRefresh();
    } catch (error) {
      setMessage(error instanceof ApiError ? error.message : tr("Could not refuel right now. Try again later."));
    } finally {
      setBusy(false);
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
  return (
    <Dialog label={tr("Convert QGOLD to gas")} onClose={onClose}>
      <section className="funds-help">
        <h2>{tr("Convert QGOLD to gas")}</h2>
        <p className="funds-help-reason">
          {tr("Your gas is low ({0} NEAR). Your own payments, like an Aura or a stake, need a little.", { 0: near(fuel.balanceYocto) })}
        </p>
        <a className="primary-button" href={QGOLD_SWAP_URL} target="_blank" rel="noreferrer">
          {tr("Convert QGOLD to gas")} <ArrowSquareOut size={16} aria-hidden="true" />
        </a>
        {fuel.canRefuel && (
          <button type="button" className="secondary-button" disabled={busy} onClick={() => void refuel()}>
            <ArrowsClockwise size={18} aria-hidden="true" /> {tr("Refuel to {0} NEAR", { 0: near(fuel.targetYocto) })}
          </button>
        )}
        {message && <p className="funds-help-reason" role="status">{message}</p>}
        <details className="funds-help-more">
          <summary>{tr("Top up gas")}</summary>
          <p className="funds-help-reason">{tr("Send NEAR from any wallet or exchange to your game address:")}</p>
          <code className="funds-help-address">{fuel.accountId}</code>
          <div className="funds-help-buttons">
            <button type="button" className="secondary-button" onClick={() => void copy()}>
              {copied ? tr("Copied") : tr("Copy address")}
            </button>
          </div>
        </details>
        <button type="button" className="secondary-button" onClick={onClose}>
          {tr("Not now")}
        </button>
      </section>
    </Dialog>
  );
}
