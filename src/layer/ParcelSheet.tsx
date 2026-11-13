// One 16 × 16 MetaLayer parcel: who owns it and, when it is open land, one
// button to buy it with MetaGold. The explorer's own account signs the purchase
// (contracts/metalayer buy_parcel); the server then re-reads the owner so the
// building rule (server/layer/expedition.mjs) opens the parcel at once.
import { useEffect, useState, type ReactNode } from "react";
import { api } from "../api";
import { CoinIcon } from "../app-bits";
import { formatGold } from "../gold-units";
import { tr } from "../i18n";
import type { Economy } from "./LayerEconomy";

/** Same rule as the contract: parcels touching the central square stay public. */
const SQUARE_HALF = 64;
export const parcelCorner = (v: number) => Math.floor(v / 16) * 16;
export const publicParcel = (x0: number, z0: number) =>
  x0 < SQUARE_HALF && x0 + 16 > -SQUARE_HALF && z0 < SQUARE_HALF && z0 + 16 > -SQUARE_HALF;

export type BuyParcel = (account: string, contractId: string, x0: number, z0: number) => Promise<void>;

export function ParcelSheet({
  x,
  z,
  layerId,
  economy,
  buyParcel,
  onEconomy,
  onAccount,
  onSquare,
}: {
  x: number;
  z: number;
  layerId: string;
  economy: Economy | null;
  buyParcel?: BuyParcel;
  onEconomy: () => void;
  onAccount: () => void;
  onSquare: () => void;
}) {
  const x0 = parcelCorner(x), z0 = parcelCorner(z), open = !publicParcel(x0, z0);
  const id = `parcel:${x0}:${z0}`;
  const [owner, setOwner] = useState<"you" | "someone" | null | undefined>(undefined);
  const [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  const mine = owner === "you" || !!economy?.parcels.includes(id);
  const active = !!economy?.active && open;

  useEffect(() => {
    if (!active) return;
    let live = true;
    setOwner(undefined);
    api<{ owner: "you" | "someone" | null }>("/layer/expedition/parcel", { layer: layerId, x0, z0 })
      .then(r => { if (live) setOwner(r.owner); })
      .catch(() => { if (live) setOwner(null); });
    return () => { live = false; };
  }, [active, layerId, x0, z0]);

  const price = Number(economy?.treasury?.parcelPrice ?? 0), balance = Number(economy?.metagold ?? 0);
  async function buy() {
    if (!economy?.account || !economy.contract || !buyParcel) return;
    setBusy(true); setMessage("");
    try {
      await buyParcel(economy.account, economy.contract, x0, z0);
      const r = await api<{ owner: "you" | "someone" | null }>("/layer/expedition/parcel", { layer: layerId, x0, z0 });
      setOwner(r.owner);
      setMessage(r.owner === "you" ? tr("This land is yours. Build anywhere on it.") : tr("The purchase is on its way. Look again in a moment."));
      onEconomy();
    } catch (e) {
      setMessage(e instanceof Error ? tr(e.message) : tr("The purchase did not go through. Try again."));
    } finally {
      setBusy(false);
    }
  }

  let text: string, action: ReactNode = null;
  if (!open) text = tr("Public square. Everyone can build on its green areas.");
  else if (!economy?.active) text = tr("Open land. Your own plot here opens later.");
  else if (mine) text = tr("This land is yours. Build anywhere on it.");
  else if (owner === "someone") text = tr("Another explorer owns this land.");
  else if (owner === undefined) text = tr("Checking who owns this land…");
  else {
    text = tr("Open land. Buy it to build here.");
    if (!economy.account)
      action = <button className="primary-button ml-wide" onClick={onAccount}>{tr("Secure my account")}</button>;
    else if (balance < price)
      action = <button className="primary-button ml-wide" disabled>{tr("You need {0} MetaGold", { 0: formatGold(price) })}</button>;
    else
      action = (
        <button className="primary-button ml-wide" disabled={busy || !buyParcel} onClick={() => void buy()}>
          <CoinIcon /> {busy ? tr("Buying…") : tr("Buy land for {0} MetaGold", { 0: formatGold(price) })}
        </button>
      );
  }
  return (
    <>
      <h2>{tr("Parcel detail")}</h2>
      <p className="ml-coordinate">{x0}, {z0} · 16 × 16</p>
      <p>{text}</p>
      {message && <p className="ml-story-note" role="status">{message}</p>}
      <div className="ml-story-actions">
        {action}
        <button className={action ? "secondary-button ml-wide" : "primary-button ml-wide"} onClick={onSquare}>
          {tr("Return to the central square")}
        </button>
      </div>
    </>
  );
}
