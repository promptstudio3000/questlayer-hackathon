import { currentRelease } from "./pwa-boot";
import "./style.css";
import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { PwaPrompts } from "./pwa-prompts";
import { registerServiceWorker } from "./pwa-state";

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
    <PwaPrompts />
  </React.StrictMode>,
);

// Offline-capable app shell, production builds only. A new version waits
// until the player chooses Reload in the "New version ready" notice, which
// also appears when the published shell names other assets.
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => registerServiceWorker(currentRelease));
}
