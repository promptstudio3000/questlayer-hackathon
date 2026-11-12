// First screen for a visitor without an explorer. Two steps, one decision each:
// "start" asks only for a name; "login" holds every way back in.
import { useState, type FormEvent } from "react";
import { Key, Lifebuoy, ShieldCheck, Wallet } from "@phosphor-icons/react";
import { api } from "./api";
import { Dialog } from "./Dialog";
import { ArrowLeft, ArrowRight } from "./dir-icons";
import { preloadGameMap } from "./DeferredGameMap";
import { GameObjectArt } from "./game-object-art";
import { Ghost } from "./Ghost";
import { tr } from "./i18n";
import { beginLearning } from "./learning-store";
import { NEAR_NETWORK } from "./near-network";
import type { Player } from "./types";
import "./welcome.css";

const webauthn = () => import("@simplewebauthn/browser");

export function Welcome({
  busy,
  error,
  onNear,
  onEthereum,
  action,
  onPlayer,
  onRestore,
}: {
  busy: string;
  error?: string;
  onRestore: () => Promise<boolean>;
  onNear: (name: string) => Promise<void>;
  onEthereum: (name: string) => Promise<void>;
  action: <T>(n: string, f: () => Promise<T>) => Promise<T | undefined>;
  onPlayer: (p: Player) => void;
}) {
  // /?tester opens the sign-in step directly (the owner's test explorers).
  const [step, setStep] = useState<"start" | "login">(() =>
    new URLSearchParams(location.search).has("tester") ? "login" : "start",
  );
  const [name, setName] = useState(""),
    [password, setPassword] = useState("");
  // Name and password sign in the owner's test explorers; mainnet refuses it.
  const passwordSignIn = NEAR_NETWORK !== "mainnet";

  async function start(e: FormEvent) {
    e.preventDefault();
    await action("welcome", async () => {
      const r = await api<{ player: Player }>("/session", { name: name || tr("Explorer") });
      if (!location.hash) beginLearning(r.player.id);
      onPlayer(r.player);
    });
  }
  async function passwordLogin(e: FormEvent) {
    e.preventDefault();
    await action("tester", async () => {
      const r = await api<{ player: Player }>("/auth/tester", { name: name.trim(), password });
      setPassword("");
      window.history.replaceState(null, "", location.pathname + location.hash);
      onPlayer(r.player);
    });
  }
  async function passkeyLogin() {
    await action("passkey", async () => {
      const r = await api<{ options: any; challengeId: string }>("/passkey/options", {
        action: "login",
        name: name || tr("Explorer"),
      });
      const response = await (await webauthn()).startAuthentication({ optionsJSON: r.options });
      const verified = await api<{ player: Player }>("/passkey/verify", {
        challengeId: r.challengeId,
        response,
      });
      onPlayer(verified.player);
    });
  }

  const passkeyButton = (
    <button type="button" className="signin-way" disabled={!!busy} onClick={() => void passkeyLogin()}>
      <Key size={22} aria-hidden="true" />
      <span>{tr("Passkey")}</span>
    </button>
  );
  return (
    <Dialog label={tr("Welcome to QuestLayer")} open={busy !== "near"} onClose={() => {}}>
      {step === "start" ? (
        <section className="signin" key="start">
          <div className="signin-art" aria-hidden="true">
            <Ghost />
            <span className="signin-coin">
              <GameObjectArt kind="coin" size={28} />
            </span>
          </div>
          <div className="signin-main">
            <h1 tabIndex={-1} autoFocus>
              {tr("Your city.")} <em>{tr("Your haunt to explore.")}</em>
            </h1>
            <p className="signin-sub">{tr("Walk real streets and open chests.")}</p>
            {error && (
              <p className="inline-error" role="alert">
                {error}
              </p>
            )}
            <form noValidate onSubmit={(e) => void start(e)}>
              <label htmlFor="nickname">{tr("What should we call you?")}</label>
              <input
                id="nickname"
                placeholder={tr("Your explorer name")}
                value={name}
                minLength={2}
                maxLength={24}
                onChange={(e) => setName(e.target.value)}
                onFocus={preloadGameMap}
                autoComplete="nickname"
              />
              <button className="primary-button" type="submit" disabled={!!busy}>
                {busy === "welcome" ? tr("Preparing your explorer…") : tr("Start exploring")}
                <ArrowRight size={20} aria-hidden="true" />
              </button>
            </form>
            <button type="button" className="text-button signin-switch" disabled={!!busy} onClick={() => setStep("login")}>
              {tr("I already have an explorer")}
            </button>
            <p className="signin-foot">
              <ShieldCheck size={16} aria-hidden="true" />
              <span>{tr("No sign-up, no deposit. Play first, secure later.")}</span>
              <a href="/how-it-works">{tr("How it works")}</a>
            </p>
          </div>
        </section>
      ) : (
        <section className="signin signin-login" key="login">
          <div className="signin-head">
            <button type="button" className="icon-button" aria-label={tr("Back")} disabled={!!busy} onClick={() => setStep("start")}>
              <ArrowLeft size={20} aria-hidden="true" />
            </button>
            <h1 tabIndex={-1} autoFocus>
              {tr("Welcome back")}
            </h1>
          </div>
          {error && (
            <p className="inline-error" role="alert">
              {error}
            </p>
          )}
          {passwordSignIn ? (
            <form className="signin-password" onSubmit={(e) => void passwordLogin(e)}>
              <input
                aria-label={tr("Tester name")}
                autoComplete="username"
                placeholder={tr("Your explorer name")}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
              <input
                aria-label={tr("Tester password")}
                type="password"
                autoComplete="current-password"
                placeholder={tr("Password")}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              <button className="primary-button" disabled={!!busy || !name.trim() || !password}>
                {busy === "tester" ? tr("Signing in…") : tr("Log in")}
              </button>
              <small>{tr("Passwords work for test explorers only.")}</small>
            </form>
          ) : (
            <button type="button" className="primary-button" disabled={!!busy} onClick={() => void passkeyLogin()}>
              <Key size={20} aria-hidden="true" /> {tr("Continue with a passkey")}
            </button>
          )}
          <p className="signin-or">{tr("Or continue with")}</p>
          <div className="signin-ways">
            {passwordSignIn && passkeyButton}
            <button
              type="button"
              className="signin-way"
              disabled={!!busy}
              title={tr("Continue with an external NEAR wallet")}
              onClick={() => void onNear(name || "Explorer")}
            >
              <Wallet size={22} aria-hidden="true" />
              <span>NEAR</span>
            </button>
            <button
              type="button"
              className="signin-way"
              disabled={!!busy}
              title={tr("Continue with MetaMask or Rabby")}
              onClick={() => void onEthereum(name || "Explorer")}
            >
              <Wallet size={22} aria-hidden="true" />
              <span>{tr("Ethereum")}</span>
            </button>
            <button
              type="button"
              className="signin-way"
              disabled={!!busy}
              title={tr("Restore with a recovery passkey")}
              onClick={() => void onRestore()}
            >
              <Lifebuoy size={22} aria-hidden="true" />
              <span>{busy === "recovery-restore" ? tr("Restoring your explorer…") : tr("Recovery")}</span>
            </button>
          </div>
          <p className="signin-foot">
            <span>{tr("A wallet signs a message, not a payment. Returning wallets restore the same explorer.")}</span>
          </p>
        </section>
      )}
    </Dialog>
  );
}
