// Settings → Account and devices → "Open in a wallet". The game only explains
// and links: the 12 words are made, shown and checked in the secure account
// window, so this page never sees them.
import { useEffect, useState } from "react";
import { ArrowSquareOut, Copy, Key, PencilSimpleLine, Wallet, WarningCircle } from "@phosphor-icons/react";
import { tr } from "./i18n";
import { Dialog } from "./Dialog";
import { NEAR_NETWORK, NETWORK_LABEL } from "./near-network";
import "./funds-help.css";

// Wallets that import a 12-word phrase. MyNearWallet is not listed: it went
// into limited mode in November 2026 and sends its own users to Meteor.
export const IMPORT_WALLETS = [
  { name: "Meteor Wallet", href: "https://wallet.meteorwallet.app/" },
  { name: "Intear Wallet", href: "https://wallet.intear.tech/" },
];

export function WalletWords({
  accountId,
  hasWords,
  busy,
  onExport,
}: {
  accountId: string;
  /** Wallet words were already made for this account. */
  hasWords: boolean;
  busy: string;
  onExport: () => Promise<boolean>;
}) {
  const [step, setStep] = useState<"closed" | "intro" | "done">("closed"),
    [copied, setCopied] = useState(false),
    working = busy === "wallet-words";
  // Load the secure window's code while the warning is read, so Continue opens
  // the window at once: a browser blocks it once the tap is a few seconds old.
  useEffect(() => {
    if (step !== "intro") return;
    void import("./account-recovery").catch(() => undefined);
    void import("./signing-vault/client.ts").catch(() => undefined);
  }, [step]);
  const testnet = NEAR_NETWORK === "testnet";
  // The account name is public; only this is ever copied.
  async function copy() {
    try {
      await navigator.clipboard.writeText(accountId);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }
  return (
    <>
      <div className="play-section-heading">
        <h2>
          <Wallet size={22} /> {" "}{tr("NEAR wallet")}</h2>
      </div>
      <div className="session-review wallet-account">
        <code>{accountId}</code>
        <p>{tr("Your account on {0}. Get 12 words to open it in Meteor or another NEAR wallet.", { 0: NETWORK_LABEL })}</p>
        <div className="wallet-account-actions">
          <button className="secondary-button" onClick={() => void copy()}>
            <Copy size={20} />
            {copied ? tr("Copied") : tr("Copy name")}
          </button>
          <button className="secondary-button" disabled={!!busy} onClick={() => setStep("intro")}>
            <Key size={20} />
            {tr("Open in a wallet")}
          </button>
        </div>
      </div>
      {step === "intro" && (
        <Dialog label={tr("Open in a wallet")} onClose={() => setStep("closed")}>
          <section className="funds-help">
            <h2>{tr("Open in a wallet")}</h2>
            <ol className="funds-help-options">
              <li>
                <b><Key size={18} aria-hidden="true" /> {tr("You get 12 secret words")}</b>
                <span>{tr("A secure window shows them once. Nobody can show them again.")}</span>
              </li>
              <li>
                <b><PencilSimpleLine size={18} aria-hidden="true" /> {tr("Write them on paper")}</b>
                <span>{tr("No screenshot, no chat, no email.")}</span>
              </li>
              <li>
                <b><WarningCircle size={18} aria-hidden="true" /> {tr("Whoever has the words has the account")}</b>
                <span>{tr("A wallet with these words can move everything without asking QuestLayer.")}</span>
              </li>
            </ol>
            {hasWords && (
              <p className="funds-help-reason">
                {tr("You already have wallet words. New ones are added next to them; revoke the old ones under Devices if you lost them.")}
              </p>
            )}
            <div className="funds-help-buttons">
              <button
                type="button"
                className="primary-button"
                disabled={!!busy}
                onClick={async () => {
                  if (await onExport()) setStep("done");
                }}
              >
                {working ? tr("Finish in the secure window…") : tr("Continue")}
              </button>
              <button type="button" className="secondary-button" disabled={working} onClick={() => setStep("closed")}>
                {tr("Not now")}
              </button>
            </div>
          </section>
        </Dialog>
      )}
      {step === "done" && (
        <Dialog label={tr("Your words work now")} onClose={() => setStep("closed")}>
          <section className="funds-help">
            <h2>{tr("Your words work now")}</h2>
            <ol className="funds-help-options">
              <li>
                <b>{tr("1. Get a wallet")}</b>
                <div className="funds-help-buttons">
                  {IMPORT_WALLETS.map((w) => (
                    <a key={w.name} className="secondary-button" href={w.href} target="_blank" rel="noreferrer">
                      {w.name} <ArrowSquareOut size={16} aria-hidden="true" />
                    </a>
                  ))}
                </div>
              </li>
              <li>
                <b>{tr("2. Choose Import, then Seed phrase")}</b>
                {testnet && <span>{tr("Switch the wallet to Testnet first.")}</span>}
              </li>
              <li>
                <b>{tr("3. Type your 12 words")}</b>
                <span>{tr("The wallet finds this account:")}</span>
                <code>{accountId}</code>
                <div className="funds-help-buttons">
                  <button type="button" className="secondary-button" onClick={() => void copy()}>
                    {copied ? tr("Copied") : tr("Copy account name")}
                  </button>
                </div>
              </li>
            </ol>
            <p className="funds-help-reason">
              {tr("Lost the paper? Revoke “Wallet words” under Devices and make new ones.")}
            </p>
            <div className="funds-help-buttons">
              <button type="button" className="primary-button" onClick={() => setStep("closed")}>
                {tr("Done")}
              </button>
            </div>
          </section>
        </Dialog>
      )}
    </>
  );
}
