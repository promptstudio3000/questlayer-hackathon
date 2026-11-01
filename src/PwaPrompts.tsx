import { useState } from "react";
import {
  ArrowClockwise,
  DeviceMobile,
  Export,
  PlusSquare,
  X,
} from "@phosphor-icons/react";
import {
  applyUpdate,
  dismissInstall,
  dismissUpdate,
  installDismissed,
  promptInstall,
  usePwa,
} from "./pwa";
import "./pwa.css";

/** "A new version is ready" with an explicit Reload, shown above the tab bar. */
export function UpdateToast() {
  const pwa = usePwa();
  const [busy, setBusy] = useState(false);
  if (!pwa.updateReady) return null;
  return (
    <div className="update-toast" role="status">
      <ArrowClockwise size={20} aria-hidden="true" />
      <span>A new version of QuestLayer is ready.</span>
      <button
        className="update-reload"
        disabled={busy}
        onClick={() => {
          setBusy(true);
          applyUpdate();
        }}
      >
        {busy ? "Reloading…" : "Reload"}
      </button>
      <button
        className="update-later"
        aria-label="Update later"
        onClick={dismissUpdate}
      >
        <X size={18} />
      </button>
    </div>
  );
}

/**
 * Add-to-home-screen card. `variant="nudge"` is the one-time card on the
 * Explore sheet (dismissible, remembered); `variant="menu"` is the permanent
 * Profile entry.
 */
export function InstallCard({ variant }: { variant: "nudge" | "menu" }) {
  const pwa = usePwa();
  const [showIos, setShowIos] = useState(false);
  if (pwa.standalone || (!pwa.canInstall && !pwa.iosHint)) return null;
  if (variant === "nudge" && installDismissed()) return null;
  const open = () => {
    if (pwa.canInstall) void promptInstall();
    else setShowIos((v) => !v);
  };
  return (
    <div className={`install-card install-${variant}`}>
      <button className="install-open" onClick={open} aria-expanded={pwa.iosHint ? showIos : undefined}>
        <span className="install-icon">
          <DeviceMobile size={22} aria-hidden="true" />
        </span>
        <span>
          <b>Add QuestLayer to your home screen</b>
          <small>Opens full screen, like an app. Nothing to download from a store.</small>
        </span>
      </button>
      {variant === "nudge" && (
        <button
          className="install-dismiss"
          aria-label="Not now"
          onClick={dismissInstall}
        >
          <X size={18} />
        </button>
      )}
      {showIos && (
        <ol className="install-ios">
          <li>
            Tap <Export size={16} aria-label="Share" /> Share in Safari's toolbar.
          </li>
          <li>
            Choose <PlusSquare size={16} aria-hidden="true" /> <b>Add to Home Screen</b>.
          </li>
        </ol>
      )}
    </div>
  );
}
