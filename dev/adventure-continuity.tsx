// Local browser QA only: render the actual App with explicit adverse read states.
// No request bodies, player data or server-side world records are changed.
import React from "react";
import { createRoot } from "react-dom/client";
import App from "../src/App";
import "../src/style.css";

const params = new URLSearchParams(location.search);
const state = params.get("state");
if (state === "expired" || state === "offline-world") {
  const originalFetch = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const url = new URL(
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url,
      location.href,
    );
    if (url.pathname !== "/api/world") return originalFetch(input, init);
    if (state === "offline-world")
      throw new TypeError("QA: world connection unavailable");
    const response = await originalFetch(input, init);
    if (!response.ok) return response;
    const world = await response.json();
    world.zones = world.zones.map((zone: object) => ({ ...zone, closesAt: 0 }));
    world.quests = world.quests.map((quest: object) => ({
      ...quest,
      closes_at: 0,
    }));
    return Response.json(world);
  };
}
if (params.get("text") === "large") {
  const style = document.createElement("style");
  style.textContent =
    ".adventure-return strong,.adventure-notice strong{font-size:32px!important;line-height:1.5}.adventure-return small,.adventure-notice small{font-size:28px!important;line-height:1.5}";
  document.head.append(style);
}
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
