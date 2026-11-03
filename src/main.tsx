import { currentRelease } from "./pwa-boot";
import "./style.css";
import React, { Suspense, lazy } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { PwaPrompts } from "./pwa-prompts";
import { registerServiceWorker } from "./pwa-state";
import { loadLocale } from "./i18n";

// "How it works" one-pager (docs/HOW-IT-WORKS-PLAN.md): its own lazy chunk,
// so the welcome screen's first load does not grow.
const HowItWorks = lazy(() => import("./how-it-works/HowItWorks"));
const HOW_IT_WORKS_PATH = /^\/how-it-works\/?$/;

void loadLocale().then(() =>
  createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {HOW_IT_WORKS_PATH.test(location.pathname) ? (
      <Suspense fallback={null}>
        <HowItWorks />
      </Suspense>
    ) : (
      <>
        <App />
        <PwaPrompts />
      </>
    )}
  </React.StrictMode>,
  ),
);

// Offline-capable app shell, production builds only. A new version waits
// until the player chooses Reload in the "New version ready" notice, which
// also appears when the published shell names other assets.
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => registerServiceWorker(currentRelease));
}
