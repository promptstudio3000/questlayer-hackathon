// "Why you can't pay yet" dialog (owner request, 11 Nov 2026): shown instead of
// a bare error when a stake or a NEAR purchase can't go through. It says why
// (no account yet, not enough NEAR, QGOLD that could be swapped) and what the
// explorer can do: send or get test NEAR, swap QGOLD, connect or install a
// NEAR wallet. NEAR Intents payment is shown, disabled, until mainnet.
import { useState } from "react";
import { ArrowsClockwise, ArrowSquareOut } from "@phosphor-icons/react";
import { tr } from "./i18n";
import { Dialog } from "./Dialog";
import { NEAR_NETWORK } from "./near-network";
import {
  fundsReason,
  missingNear,
  nearText,
  qgoldText,
  NEAR_WALLETS,
  QGOLD_SWAP_URL,
  TEST_NEAR_FAUCET,
  type FundsShortfall,
} from "./funds-help";
import "./funds-help.css";

export function FundsHelp({
  title,
  needLine,
  funds,
  explorerAccount,
  explorerStatus,
  onRecheck,
  onLinkWallet,
  onClose,
}: {
  /** "Why you can't buy this yet", "Why you can't stake yet", … */
  title: string;
  /** What the payment needs, e.g. "Buying it needs about 1.07 NEAR (price and a little gas)." */
  needLine: string;
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
  const missing = missingNear(funds);
  const who = account === explorerAccount ? tr("Your explorer account") : account;

  const lines: string[] = [];
  if (reason === "no-account")
    lines.push(
      explorerStatus === "play-first"
        ? tr("Your explorer account opens with your first find. Collect a coin or finish a quest on the map, or connect a NEAR wallet you already have.")
        : explorerStatus === "needs-recovery"
          ? tr("This device doesn't hold your explorer account's key yet. Restore it with your passkey in Profile → Account and devices, or connect a NEAR wallet you already have.")
          : tr("Your explorer account is still being prepared. You can wait a moment, or connect a NEAR wallet you already have."),
    );
  else {
    lines.push(tr("{0} has {1} NEAR.", { 0: who, 1: nearText(have, 2) }), needLine);
    lines.push(tr("About {0} NEAR is missing.", { 0: nearText(missing, 2) }));
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(account);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  const swap = account && qgold && qgold.units > 0n && (
    <li key="qgold">
      <b>{tr("Swap QGOLD for NEAR")}</b>
      <span>
        {reason === "qgold-covers"
          ? tr("You have {0} QGOLD, worth about {1} NEAR. Swap part of it for NEAR at the QGOLD vault, then come back and buy.", {
              0: qgoldText(qgold.units),
              1: nearText(qgold.worth, 2),
            })
          : tr("You have {0} QGOLD, worth about {1} NEAR. That is not enough to cover the missing {2} NEAR yet; collect more on the map or add NEAR.", {
              0: qgoldText(qgold.units),
              1: nearText(qgold.worth, 2),
              2: nearText(missing, 2),
            })}
      </span>
      {reason === "qgold-covers" && (
        <a className="secondary-button" href={QGOLD_SWAP_URL} target="_blank" rel="noreferrer">
          {tr("Swap QGOLD for NEAR")} <ArrowSquareOut size={16} aria-hidden="true" />
        </a>
      )}
    </li>
  );
  const noQgold = account && reason === "no-near" && (
    <li key="no-qgold">
      <b>{tr("No QGOLD to swap yet")}</b>
      <span>{tr("Gold you collect on the map becomes QGOLD in the nightly payout. QGOLD can be swapped for NEAR.")}</span>
    </li>
  );

  return (
    <Dialog label={title} onClose={onClose}>
      <section className="funds-help">
        <h2>{title}</h2>
        {lines.map((line) => (
          <p key={line} className="funds-help-reason">
            {line}
          </p>
        ))}
        <ol className="funds-help-options">
          {reason === "qgold-covers" && swap}
          {account && (
            <li>
              <b>{testnet ? tr("Send test NEAR to this account") : tr("Send NEAR to this account")}</b>
              <code>{account}</code>
              <div className="funds-help-buttons">
                <button type="button" className="secondary-button" onClick={() => void copy()}>
                  {copied ? tr("Copied") : tr("Copy address")}
                </button>
                {testnet && (
                  <a className="secondary-button" href={TEST_NEAR_FAUCET} target="_blank" rel="noreferrer">
                    {tr("Get test NEAR")}
                  </a>
                )}
                {onRecheck && (
                  <button type="button" className="secondary-button" onClick={onRecheck}>
                    <ArrowsClockwise size={18} aria-hidden="true" /> {tr("Check again")}
                  </button>
                )}
              </div>
            </li>
          )}
          {reason !== "qgold-covers" && swap}
          {noQgold}
          {onLinkWallet && (
            <li>
              <b>{tr("Use a NEAR wallet you already have")}</b>
              <span>{tr("Connect it and pay from it; your wallet asks you to approve each step.")}</span>
              <button type="button" className="secondary-button" onClick={() => void onLinkWallet()}>
                {tr("Connect a NEAR wallet")}
              </button>
            </li>
          )}
          <li>
            <b>{tr("No NEAR wallet yet?")}</b>
            <span>{tr("Install one, create an account, then come back and connect it.")}</span>
            <div className="funds-help-buttons">
              {NEAR_WALLETS.map((w) => (
                <a key={w.href} className="secondary-button" href={w.href} target="_blank" rel="noreferrer">
                  {w.name}
                </a>
              ))}
            </div>
          </li>
          <li>
            <b>{tr("Pay from another crypto wallet")}</b>
            <span>
              {tr("With NEAR Intents you will pay in ETH, SOL, BTC or USDC from any wallet. Intents run on NEAR mainnet only, so this opens with the mainnet launch.")}
            </span>
            <button type="button" className="secondary-button" disabled>
              {tr("Pay with NEAR Intents · at mainnet")}
            </button>
          </li>
        </ol>
        <button type="button" className="primary-button" onClick={onClose}>
          {tr("Close")}
        </button>
      </section>
    </Dialog>
  );
}
