/* Installable-app prompts that sit beside the game, never inside it:
   a one-time install offer after the player has started playing, a
   "New version ready" notice and an honest offline state. Mounted from
   main.tsx next to <App />; it reads the app only through the DOM. */
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent,
} from "react";
import {
  ArrowsClockwise,
  Export,
  PlusSquare,
  WifiHigh,
  WifiSlash,
} from "@phosphor-icons/react";
import {
  INSTALL_OFFER_AFTER_MS,
  applyUpdate,
  installChoice,
  installOfferKind,
  isIosDevice,
  isPhoneLike,
  isStandaloneDisplay,
  promptInstall,
  pwaStore,
  rememberChoice,
} from "./pwa-state";
import "./pwa-prompts.css";

const TICK_MS = 2000;
const BACK_ONLINE_MS = 4000;

/** The player is in the game: the explore/inventory panel exists. */
const playing = () => !!document.querySelector(".main-panel");

/** No dialog, expanded sheet, toast or text entry competes for attention. */
function calmMoment(): boolean {
  if (document.visibilityState !== "visible" || !navigator.onLine) return false;
  if (document.querySelector("dialog[open], [aria-modal='true']")) return false;
  if (document.querySelector(".sheet-expanded, .app-shell > .toast"))
    return false;
  const active = document.activeElement as HTMLElement | null;
  return !(
    active &&
    (active.isContentEditable ||
      /^(INPUT|TEXTAREA|SELECT)$/.test(active.tagName))
  );
}

/** Return focus to the game when a prompt that held it disappears. */
function restoreFocus(container: HTMLElement | null) {
  if (!container?.contains(document.activeElement)) return;
  const target = document.querySelector<HTMLElement>(".main-panel");
  if (target) target.focus({ preventScroll: true });
  else (document.activeElement as HTMLElement | null)?.blur();
}

/** Sits the prompts just under the app's top bar, whatever its height. */
function useAnchorTop(active: boolean) {
  const [top, setTop] = useState<number | null>(null);
  useLayoutEffect(() => {
    if (!active) return;
    const measure = () => {
      const bar = document.querySelector(".topbar");
      setTop(bar ? Math.round(bar.getBoundingClientRect().bottom) + 8 : null);
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [active]);
  return top === null ? undefined : { top: `${top}px` };
}

function useOnline() {
  const [online, setOnline] = useState(() => navigator.onLine);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);
  return online;
}

/** Waits for enough visible play time and a calm moment, once per visit. */
function useInstallMoment(eligible: boolean) {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (!eligible || ready) return;
    let played = 0;
    const id = window.setInterval(() => {
      if (!playing() || document.visibilityState !== "visible") return;
      played += TICK_MS;
      if (played >= INSTALL_OFFER_AFTER_MS && calmMoment()) setReady(true);
    }, TICK_MS);
    return () => window.clearInterval(id);
  }, [eligible, ready]);
  return ready;
}

export function PwaPrompts() {
  const state = useSyncExternalStore(pwaStore.subscribe, pwaStore.getSnapshot);
  const online = useOnline();
  const [platform] = useState(() => {
    const ios = isIosDevice(
      navigator.userAgent,
      navigator.platform,
      navigator.maxTouchPoints,
    );
    return { ios, phone: isPhoneLike(navigator.userAgent, ios) };
  });
  const [closedOffer, setClosedOffer] = useState(false);
  const [laterUpdate, setLaterUpdate] = useState(false);
  const [backOnline, setBackOnline] = useState(false);
  const wasOffline = useRef(!navigator.onLine);
  const installRef = useRef<HTMLElement>(null);
  const updateRef = useRef<HTMLDivElement>(null);
  const offlineRef = useRef<HTMLDivElement>(null);

  const offer = closedOffer
    ? null
    : installOfferKind({
        standalone: isStandaloneDisplay(),
        choice: state.installed ? "installed" : installChoice(),
        hasPrompt: !!state.installPrompt,
        ios: platform.ios,
      });
  const moment = useInstallMoment(!!offer);
  const showOffer = !!offer && moment && online;
  const showUpdate = state.updateReady && !laterUpdate && online;
  const anchor = useAnchorTop(showOffer || showUpdate || !online || backOnline);

  useEffect(() => {
    if (!online) {
      wasOffline.current = true;
      setBackOnline(false);
      return;
    }
    if (!wasOffline.current) return;
    wasOffline.current = false;
    setBackOnline(true);
    const id = window.setTimeout(() => setBackOnline(false), BACK_ONLINE_MS);
    return () => window.clearTimeout(id);
  }, [online]);

  // The offline notice joins the top layer so it stays readable above a
  // modal dialog (for example the welcome card when the session can't load).
  const raiseOffline = useCallback(() => {
    const el = offlineRef.current as
      | (HTMLDivElement & {
          showPopover?: () => void;
          hidePopover?: () => void;
        })
      | null;
    if (!el?.showPopover) return;
    try {
      if (el.matches(":popover-open")) el.hidePopover?.();
      el.showPopover();
    } catch {
      /* Unsupported: the fixed-position fallback still shows it. */
    }
  }, []);
  useEffect(() => {
    if (online) return;
    raiseOffline();
    const watcher = new MutationObserver((records) => {
      if (records.some((r) => (r.target as Element).tagName === "DIALOG"))
        raiseOffline();
    });
    watcher.observe(document.body, {
      subtree: true,
      attributes: true,
      attributeFilter: ["open"],
    });
    return () => watcher.disconnect();
  }, [online, raiseOffline]);

  const closeOffer = (choice: "dismissed" | null) => {
    if (choice) rememberChoice(choice);
    restoreFocus(installRef.current);
    setClosedOffer(true);
  };
  const install = async () => {
    restoreFocus(installRef.current);
    setClosedOffer(true);
    await promptInstall();
  };
  const onOfferKey = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      event.stopPropagation();
      closeOffer("dismissed");
    }
  };

  const announcement = !online
    ? "You're offline. New map areas and rewards need a connection. Nothing is collected until you're back online."
    : showUpdate
      ? "New version ready. Reload to get the latest QuestLayer."
      : backOnline
        ? "You're back online."
        : "";

  return (
    <>
      <div
        className="pwa-sr-only"
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        {announcement}
      </div>
      {!online && (
        <div
          ref={offlineRef}
          className="pwa-card pwa-offline"
          popover="manual"
          style={anchor}
        >
          <WifiSlash
            className="pwa-card-icon"
            size={24}
            weight="bold"
            aria-hidden="true"
          />
          <div className="pwa-copy">
            <strong>You're offline</strong>
            <p>
              QuestLayer still opens, but new map areas and rewards need a
              connection. Nothing is collected until you're back online.
            </p>
          </div>
        </div>
      )}
      {(showUpdate || showOffer || (backOnline && online)) && (
        <div className="pwa-stack" style={anchor}>
          {backOnline && online && (
            <div className="pwa-card pwa-back-online">
              <WifiHigh
                className="pwa-card-icon"
                size={24}
                weight="bold"
                aria-hidden="true"
              />
              <div className="pwa-copy">
                <strong>You're back online</strong>
              </div>
            </div>
          )}
          {showUpdate && (
            <div
              ref={updateRef}
              className="pwa-card pwa-update"
              aria-labelledby="pwa-update-title"
              role="group"
            >
              <ArrowsClockwise
                className="pwa-card-icon"
                size={24}
                weight="bold"
                aria-hidden="true"
              />
              <div className="pwa-copy">
                <strong id="pwa-update-title">New version ready</strong>
                <p>Reload to get the latest QuestLayer.</p>
              </div>
              <div className="pwa-actions">
                <button
                  type="button"
                  className="pwa-button pwa-primary"
                  onClick={applyUpdate}
                  disabled={state.reloading}
                >
                  <ArrowsClockwise size={20} weight="bold" aria-hidden="true" />
                  {state.reloading ? "Reloading…" : "Reload"}
                </button>
                <button
                  type="button"
                  className="pwa-button pwa-quiet"
                  disabled={state.reloading}
                  onClick={() => {
                    restoreFocus(updateRef.current);
                    setLaterUpdate(true);
                  }}
                >
                  Later
                </button>
              </div>
            </div>
          )}
          {showOffer && !showUpdate && (
            <aside
              ref={installRef}
              className="pwa-card pwa-install"
              aria-labelledby="pwa-install-title"
              onKeyDown={onOfferKey}
            >
              <img
                className="pwa-app-icon"
                src="/icon.svg"
                alt=""
                width={40}
                height={40}
              />
              <div className="pwa-copy">
                <strong id="pwa-install-title">
                  {offer === "prompt" && !platform.phone
                    ? "Install QuestLayer"
                    : "Add QuestLayer to your home screen"}
                </strong>
                {offer === "prompt" && (
                  <p>
                    {platform.phone
                      ? "One tap opens your next adventure."
                      : "Keep it one click away in its own window."}
                  </p>
                )}
              </div>
              {offer === "ios" && (
                <ol className="pwa-steps">
                  <li>
                    Tap Share
                    <Export size={20} weight="bold" aria-hidden="true" />
                  </li>
                  <li>
                    Choose Add to Home Screen
                    <PlusSquare size={20} weight="bold" aria-hidden="true" />
                  </li>
                </ol>
              )}
              <div className="pwa-actions">
                {offer === "prompt" ? (
                  <>
                    <button
                      type="button"
                      className="pwa-button pwa-primary"
                      onClick={() => void install()}
                    >
                      {platform.phone ? "Add to home screen" : "Install"}
                    </button>
                    <button
                      type="button"
                      className="pwa-button pwa-quiet"
                      onClick={() => closeOffer("dismissed")}
                    >
                      Not now
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    className="pwa-button pwa-quiet"
                    onClick={() => closeOffer("dismissed")}
                  >
                    Got it
                  </button>
                )}
              </div>
            </aside>
          )}
        </div>
      )}
    </>
  );
}
