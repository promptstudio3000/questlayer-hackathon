import "./style.css";
import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { initPwa, markUpdateReady } from "./pwa";
initPwa();
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

// Offline-capable app shell. Registered only for production builds. A new
// version waits until the player taps "Reload" on the update toast, so an
// adventure in progress is never interrupted by a surprise reload.
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("/sw.js")
      .then((registration) => {
        if (registration.waiting && navigator.serviceWorker.controller)
          markUpdateReady(registration.waiting);
        registration.addEventListener("updatefound", () => {
          const worker = registration.installing;
          worker?.addEventListener("statechange", () => {
            if (worker.state === "installed" && navigator.serviceWorker.controller)
              markUpdateReady(worker);
          });
        });
        // Look for a new version when the player comes back to the app.
        document.addEventListener("visibilitychange", () => {
          if (document.visibilityState === "visible")
            void registration.update().catch(() => undefined);
        });
      })
      .catch(() => {
        /* The app works without the service worker. */
      });
  });
}
