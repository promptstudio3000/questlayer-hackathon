import "./style.css";
import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

// Offline-capable app shell. Registered only for production builds; a new
// version activates on the next load without interrupting the current play.
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("/sw.js")
      .then((registration) => {
        registration.addEventListener("updatefound", () => {
          const worker = registration.installing;
          worker?.addEventListener("statechange", () => {
            if (worker.state === "installed" && navigator.serviceWorker.controller)
              worker.postMessage("SKIP_WAITING");
          });
        });
      })
      .catch(() => {
        /* The app works without the service worker. */
      });
  });
}
