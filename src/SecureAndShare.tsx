import { useEffect, useState } from "react";
import {
  CheckCircle,
  Fingerprint,
  ShareNetwork,
  ShieldCheck,
  WarningCircle,
  X,
} from "@phosphor-icons/react";
import { api } from "./api";
import { shareCard } from "./share-card";
import type { Item, Player } from "./types";
import "./secure-share.css";

export type SecureAvailability =
  /** Invisible account ready and the collectibles contract accepts our claims. */
  | "ready"
  /** Account still being prepared in the background. */
  | "preparing"
  /** This host cannot secure Auras (no relayer or claims paused). */
  | "off";

const PASSKEY_NUDGE = (playerId: string) => `questlayer-passkey-nudge:${playerId}`;

/**
 * After a reward: "Secure this Aura" (relayed by the invisible account, no
 * popup), then "Share" (PNG card), then once in a lifetime a passkey nudge.
 */
export function SecureAndShare({
  item,
  player,
  availability,
  busy,
  place,
  onSecure,
  onPasskey,
  onDone,
}: {
  item: Item;
  player: Player;
  availability: SecureAvailability;
  busy: boolean;
  place?: string | null;
  onSecure: (item: Item) => Promise<boolean>;
  onPasskey: () => Promise<void>;
  /** Called once the explorer secured or shared this Aura. */
  onDone?: () => void;
}) {
  const [state, setState] = useState<"idle" | "pending" | "failed">("idle");
  const [error, setError] = useState("");
  const [shareNote, setShareNote] = useState("");
  const [sharing, setSharing] = useState(false);
  const [nudge, setNudge] = useState(false);
  const secured = item.native_claim_state === "minted";
  const started = item.native_claim_state === "issued";

  // Once the first Aura is secured, offer a passkey once if the explorer has none.
  useEffect(() => {
    if (!secured) return;
    let seen = false;
    try {
      seen = localStorage.getItem(PASSKEY_NUDGE(player.id)) === "1";
    } catch {}
    if (seen) return;
    let alive = true;
    api<{ recovery: { demoPasskeys: number; nearAccounts: string[] } }>(
      "/identity/sessions",
    )
      .then((r) => {
        if (alive && !r.recovery.demoPasskeys) setNudge(true);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [secured, player.id]);

  function closeNudge() {
    try {
      localStorage.setItem(PASSKEY_NUDGE(player.id), "1");
    } catch {}
    setNudge(false);
  }

  async function secure() {
    setState("pending");
    setError("");
    const ok = await onSecure(item);
    setState(ok ? "idle" : "failed");
    if (ok) onDone?.();
    if (!ok) setError("Securing didn't finish. Your Aura is safe; try again.");
  }

  async function share() {
    setSharing(true);
    setShareNote("");
    try {
      const avatar = player.inventory.find((i) => i.kind === "avatar");
      const outcome = await shareCard({
        explorer: player.name,
        item,
        outfit: player.inventory,
        ghostColor: avatar?.color,
        place,
        secured,
      });
      if (outcome === "downloaded") setShareNote("Card saved to your downloads.");
      if (outcome !== "cancelled") onDone?.();
    } catch (e) {
      setShareNote((e as Error).message);
    } finally {
      setSharing(false);
    }
  }

  const pending = state === "pending" || (busy && state !== "idle");
  return (
    <div className="secure-share">
      {secured ? (
        <p className="secure-done" role="status">
          <CheckCircle size={20} weight="fill" aria-hidden="true" />
          <span>
            <b>Secured.</b> This Aura is yours, even outside this game.
          </span>
        </p>
      ) : availability === "ready" ? (
        <>
          <button
            className="primary-button secure-button"
            disabled={busy || pending}
            onClick={() => void secure()}
          >
            {pending
              ? "Securing your Aura…"
              : started
                ? "Finish securing this Aura"
                : "Secure this Aura"}
            <ShieldCheck size={20} />
          </button>
          <p className="secure-hint">
            {pending
              ? "This takes a few seconds. You can keep this open."
              : "No popup, nothing to pay: the game covers storage on the test network."}
          </p>
          {state === "failed" && (
            <p className="secure-error" role="alert">
              <WarningCircle size={18} aria-hidden="true" /> {error}
            </p>
          )}
        </>
      ) : availability === "preparing" ? (
        <p className="secure-hint" role="status">
          Preparing your account so you can secure this Aura…
        </p>
      ) : null}
      <button
        className="secondary-button share-button"
        disabled={sharing}
        onClick={() => void share()}
      >
        <ShareNetwork size={20} aria-hidden="true" />
        {sharing ? "Making your card…" : "Share your Aura"}
      </button>
      {shareNote && (
        <p className="secure-hint" role="status">
          {shareNote}
        </p>
      )}
      {nudge && (
        <div className="passkey-nudge" role="group" aria-label="Keep your explorer">
          <Fingerprint size={28} aria-hidden="true" />
          <div>
            <b>Secure your explorer with a passkey</b>
            <p>
              Your Aura is safe. A passkey lets you come back to this explorer
              from another phone or after clearing this browser.
            </p>
            <button
              className="primary-button"
              disabled={busy}
              onClick={() =>
                void onPasskey().then(() => closeNudge())
              }
            >
              Add a passkey <Fingerprint size={20} />
            </button>
          </div>
          <button
            className="passkey-nudge-close"
            aria-label="Not now"
            onClick={closeNudge}
          >
            <X size={18} />
          </button>
        </div>
      )}
    </div>
  );
}
