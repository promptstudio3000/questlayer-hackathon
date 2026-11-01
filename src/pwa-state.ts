/* Installable-app state shared by main.tsx and the PWA prompts: the deferred
   install prompt, a waiting service worker and a newer published release.
   Pure helpers are exported for tests; the store is a tiny external store for
   useSyncExternalStore. Nothing here touches rewards or player data. */

export type InstallChoice = "dismissed" | "installed";
export type InstallOffer = "prompt" | "ios" | null;
export type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};
type StorageLike = Pick<Storage, "getItem" | "setItem">;

export const INSTALL_CHOICE_KEY = "questlayer.install-offer";
/** Visible play time before the install offer may appear. */
export const INSTALL_OFFER_AFTER_MS = 45_000;

export function readInstallChoice(
  storage: StorageLike | null | undefined,
): InstallChoice | null {
  try {
    const value = storage?.getItem(INSTALL_CHOICE_KEY);
    return value === "dismissed" || value === "installed" ? value : null;
  } catch {
    return null;
  }
}

export function rememberInstallChoice(
  storage: StorageLike | null | undefined,
  choice: InstallChoice,
): void {
  try {
    storage?.setItem(INSTALL_CHOICE_KEY, choice);
  } catch {
    /* Private mode or blocked storage: the offer simply stays hidden this visit. */
  }
}

/** iPhone, iPod and iPad (iPadOS reports a Mac platform with touch). */
export function isIosDevice(
  userAgent: string,
  platform = "",
  maxTouchPoints = 0,
): boolean {
  if (/iPhone|iPad|iPod/i.test(userAgent)) return true;
  return platform === "MacIntel" && maxTouchPoints > 1;
}

export function isPhoneLike(userAgent: string, ios: boolean): boolean {
  return ios || /Android|Mobi/i.test(userAgent);
}

/** Which install offer, if any, this browser can honestly make. */
export function installOfferKind(options: {
  standalone: boolean;
  choice: InstallChoice | null;
  hasPrompt: boolean;
  ios: boolean;
}): InstallOffer {
  if (options.standalone || options.choice) return null;
  if (options.hasPrompt) return "prompt";
  // iOS has no install prompt; Share → Add to Home Screen is the only path.
  return options.ios ? "ios" : null;
}

/**
 * The hashed entry script and stylesheets a built index.html references.
 * Two shells with different signatures belong to different releases.
 */
export function releaseSignature(html: string): string | null {
  const assets = new Set<string>();
  for (const [tag] of html.matchAll(/<(?:script|link)\b[^>]*>/g)) {
    if (!/type="module"|rel="stylesheet"/.test(tag)) continue;
    const url = tag.match(/(?:src|href)="(\/assets\/[^"]+)"/);
    if (url) assets.add(url[1]);
  }
  return assets.size ? [...assets].sort().join(" ") : null;
}

/** A newer release exists when the served shell references other assets. */
export function isNewerRelease(
  current: string | null,
  served: string | null,
): boolean {
  return !!current && !!served && current !== served;
}

/* ---------- Browser store ---------- */

export type PwaSnapshot = {
  installPrompt: InstallPromptEvent | null;
  installed: boolean;
  /** A new version is available (waiting worker or newer published shell). */
  updateReady: boolean;
  reloading: boolean;
};

let snapshot: PwaSnapshot = {
  installPrompt: null,
  installed: false,
  updateReady: false,
  reloading: false,
};
const listeners = new Set<() => void>();
let waitingWorker: ServiceWorker | null = null;
let reloadRequested = false;

function set(patch: Partial<PwaSnapshot>) {
  snapshot = { ...snapshot, ...patch };
  listeners.forEach((listener) => listener());
}
export const pwaStore = {
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  getSnapshot: () => snapshot,
};

function localStore(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}
export const installChoice = () => readInstallChoice(localStore());
export const rememberChoice = (choice: InstallChoice) =>
  rememberInstallChoice(localStore(), choice);

export function isStandaloneDisplay(): boolean {
  return (
    window.matchMedia?.("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

/** Must run before the first render: browsers can fire the event early. */
export function capturePwaEvents(): void {
  window.addEventListener("beforeinstallprompt", (event) => {
    // Hold the browser's prompt so it can be offered at a calm moment instead.
    event.preventDefault();
    set({ installPrompt: event as InstallPromptEvent });
  });
  window.addEventListener("appinstalled", () => {
    rememberChoice("installed");
    set({ installPrompt: null, installed: true });
  });
}

/** Shows the held browser prompt once and remembers the player's answer. */
export async function promptInstall(): Promise<"accepted" | "dismissed"> {
  const event = snapshot.installPrompt;
  if (!event) return "dismissed";
  set({ installPrompt: null }); // A deferred prompt can be used only once.
  try {
    await event.prompt();
    const { outcome } = await event.userChoice;
    rememberChoice(outcome === "accepted" ? "installed" : "dismissed");
    return outcome;
  } catch {
    rememberChoice("dismissed");
    return "dismissed";
  }
}

/** Activates the waiting worker (or reloads for a newer shell) on request only. */
export function applyUpdate(): void {
  if (snapshot.reloading) return;
  set({ reloading: true });
  reloadRequested = true;
  if (waitingWorker) {
    waitingWorker.postMessage("SKIP_WAITING");
    // controllerchange reloads; this covers a worker that never takes over.
    window.setTimeout(() => window.location.reload(), 4000);
  } else window.location.reload();
}

function trackWaiting(registration: ServiceWorkerRegistration) {
  const offer = (worker: ServiceWorker | null) => {
    // Only an update to an existing controller waits; a first install does not.
    if (!worker || !navigator.serviceWorker.controller) return;
    waitingWorker = worker;
    set({ updateReady: true });
  };
  offer(registration.waiting);
  registration.addEventListener("updatefound", () => {
    const worker = registration.installing;
    worker?.addEventListener("statechange", () => {
      if (worker.state === "installed") offer(registration.waiting || worker);
    });
  });
}

async function checkForRelease(current: string | null) {
  if (!current || !navigator.onLine) return;
  try {
    const response = await fetch("/", {
      cache: "no-store",
      credentials: "same-origin",
    });
    if (!response.ok) return;
    if (isNewerRelease(current, releaseSignature(await response.text())))
      set({ updateReady: true });
  } catch {
    /* Offline or server busy: check again later. */
  }
}

/**
 * Registers the offline-capable shell. A new version never activates by
 * itself while the player is mid-adventure: it waits for the Reload button.
 */
export function registerServiceWorker(currentRelease: string | null): void {
  if (!("serviceWorker" in navigator)) return;
  let controlled = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    // A first install claiming this page is not an update.
    const replaced = controlled;
    controlled = true;
    if (reloadRequested) window.location.reload();
    else if (replaced) {
      // Another tab activated the new version; this one still runs old code.
      waitingWorker = null;
      set({ updateReady: true });
    }
  });
  navigator.serviceWorker
    .register("/sw.js")
    .then((registration) => {
      trackWaiting(registration);
      const check = () => {
        if (document.visibilityState !== "visible" || !navigator.onLine) return;
        void registration.update().catch(() => undefined);
        void checkForRelease(currentRelease);
      };
      document.addEventListener("visibilitychange", check);
      window.setInterval(check, 30 * 60_000);
    })
    .catch(() => {
      /* The app works without the service worker. */
    });
}
