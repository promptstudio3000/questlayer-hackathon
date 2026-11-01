// Home-screen app plumbing: the install prompt and the "new version ready"
// signal from the service worker. One tiny store so React components can
// subscribe without the service worker code knowing about React.
import { useSyncExternalStore } from "react";

type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

export type PwaState = {
  /** Android/desktop Chrome: the browser offered an install prompt. */
  canInstall: boolean;
  /** iOS Safari never fires the prompt; show the Share → Add to Home Screen hint. */
  iosHint: boolean;
  /** Already running from the home screen. */
  standalone: boolean;
  /** A new service worker is installed and waiting. */
  updateReady: boolean;
};

let deferred: InstallPromptEvent | null = null;
let waiting: ServiceWorker | null = null;
let state: PwaState = {
  canInstall: false,
  iosHint: false,
  standalone: false,
  updateReady: false,
};
const listeners = new Set<() => void>();
function set(next: Partial<PwaState>) {
  state = { ...state, ...next };
  listeners.forEach((l) => l());
}

export function isStandalone(): boolean {
  try {
    return (
      window.matchMedia("(display-mode: standalone)").matches ||
      (navigator as Navigator & { standalone?: boolean }).standalone === true
    );
  } catch {
    return false;
  }
}

export function isIosSafari(ua = navigator.userAgent): boolean {
  const ios =
    /iPhone|iPad|iPod/.test(ua) ||
    (/Macintosh/.test(ua) && typeof navigator !== "undefined" && navigator.maxTouchPoints > 1);
  return ios && /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS|OPiOS/.test(ua);
}

export function initPwa() {
  const standalone = isStandalone();
  set({ standalone, iosHint: !standalone && isIosSafari() });
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferred = event as InstallPromptEvent;
    set({ canInstall: true });
  });
  window.addEventListener("appinstalled", () => {
    deferred = null;
    set({ canInstall: false, standalone: true, iosHint: false });
  });
}

export async function promptInstall(): Promise<boolean> {
  if (!deferred) return false;
  const event = deferred;
  deferred = null;
  set({ canInstall: false });
  await event.prompt();
  return (await event.userChoice).outcome === "accepted";
}

/** Called by the service worker registration when a new version is waiting. */
export function markUpdateReady(worker: ServiceWorker) {
  waiting = worker;
  set({ updateReady: true });
}

/** Activate the waiting version; the page reloads once it takes control. */
export function applyUpdate() {
  if (!waiting) return window.location.reload();
  let reloaded = false;
  navigator.serviceWorker?.addEventListener("controllerchange", () => {
    if (reloaded) return;
    reloaded = true;
    window.location.reload();
  });
  waiting.postMessage("SKIP_WAITING");
}

export function dismissUpdate() {
  set({ updateReady: false });
}

const INSTALL_DISMISSED = "questlayer-install-dismissed";
export function installDismissed(): boolean {
  try {
    return localStorage.getItem(INSTALL_DISMISSED) === "1";
  } catch {
    return false;
  }
}
export function dismissInstall() {
  try {
    localStorage.setItem(INSTALL_DISMISSED, "1");
  } catch {}
  listeners.forEach((l) => l());
}

export function usePwa(): PwaState {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
    () => state,
  );
}
