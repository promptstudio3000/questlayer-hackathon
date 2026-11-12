// "Why you can't pay yet" dialog (owner request, 11 Nov 2026): shown instead of
// a bare error when a stake or a purchase can't go through. Since 12 Nov it is
// one line (needs / has, in QGOLD at 1 QGOLD = 1 microNEAR) and one main
// button; wallets and NEAR Intents (mainnet only) sit folded under "More ways".
import { useState } from "react";
import { ArrowsClockwise, ArrowSquareOut } from "@phosphor-icons/react";
import { tr } from "./i18n";
import { Dialog } from "./Dialog";
import { NEAR_NETWORK } from "./near-network";
import {
  fundsReason,
  nearText,
  qgoldText,
  NEAR_WALLETS,
  QGOLD_SWAP_URL,
  TEST_NEAR_FAUCET,
  type FundsShortfall,
} from "./funds-help";
import { qgoldOfNear } from "./qgold-display";
import "./funds-help.css";

export function FundsHelp({
  title,
  funds,
  explorerAccount,
  explorerStatus,
  onRecheck,
  onLinkWallet,
  onClose,
}: {
  /** "Why you can't buy this yet", "Why you can't stake yet", … */
  title: string;
  funds: FundsShortfall;
  explorerAccount?: string;
  /** Why the explorer account is not ready yet (play-first, creating, needs-recovery, ...). */
  explorerStatus?: string;
  onRecheck?: () => void;
  /** Links a NEAR wallet the player already has (wallet picker + signed message). */
  onLinkWallet?: () => Promise<void> | void;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const testnet = NEAR_NETWORK === "testnet";
  const { account, have, qgold } = funds;
  const reason = fundsReason(funds);

  const q = (yocto: bigint | null) => (yocto === null ? "?" : qgoldOfNear(nearText(yocto, 2).replace(/,/g, "")));
  const line =
    reason === "no-account"
      ? explorerStatus === "play-first"
        ? tr("Collect a coin or finish a quest first. That opens your account.")
        : explorerStatus === "needs-recovery"
          ? tr("Restore your account on this device: Profile → Account and devices.")
          : tr("Your account is still being prepared. Try again in a moment.")
      : tr("Needs {0} QGOLD · you have {1} · paid in NEAR", { 0: q(funds.need), 1: q(have) });
  const canSwap = !!account && reason === "qgold-covers" && !!qgold && qgold.units > 0n;

  async function copy() {
    try {
      await navigator.clipboard.writeText(account);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  return (
    <Dialog label={title} onClose={onClose}>
      <section className="funds-help">
        <h2>{title}</h2>
        <p className="funds-help-reason">{line}</p>
        {canSwap ? (
          <a className="primary-button" href={QGOLD_SWAP_URL} target="_blank" rel="noreferrer">
            {tr("Use my {0} QGOLD", { 0: qgoldText(qgold!.units) })} <ArrowSquareOut size={16} aria-hidden="true" />
          </a>
        ) : account && testnet ? (
          <a className="primary-button" href={TEST_NEAR_FAUCET} target="_blank" rel="noreferrer">
            {tr("Get test NEAR")} <ArrowSquareOut size={16} aria-hidden="true" />
          </a>
        ) : onLinkWallet ? (
          <button type="button" className="primary-button" onClick={() => void onLinkWallet()}>
            {tr("Connect a NEAR wallet")}
          </button>
        ) : null}
        <div className="funds-help-buttons">
          {account && (
            <button type="button" className="secondary-button" title={account} onClick={() => void copy()}>
              {copied ? tr("Copied") : tr("Copy address")}
            </button>
          )}
          {account && onRecheck && (
            <button type="button" className="secondary-button" onClick={onRecheck}>
              <ArrowsClockwise size={18} aria-hidden="true" /> {tr("Check again")}
            </button>
          )}
          {onLinkWallet && (canSwap || (account && testnet)) && (
            <button type="button" className="secondary-button" onClick={() => void onLinkWallet()}>
              {tr("Connect a NEAR wallet")}
            </button>
          )}
        </div>
        <details className="funds-help-more">
          <summary>{tr("More ways")}</summary>
          <div className="funds-help-buttons">
            {NEAR_WALLETS.map((w) => (
              <a key={w.href} className="secondary-button" href={w.href} target="_blank" rel="noreferrer">
                {w.name}
              </a>
            ))}
            <button type="button" className="secondary-button" disabled>
              {tr("Pay with NEAR Intents · at mainnet")}
            </button>
          </div>
        </details>
      </section>
    </Dialog>
  );
}
