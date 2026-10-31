import React from "react";
import { createRoot } from "react-dom/client";
import { MapBoundary } from "../src/DeferredGameMap";
import "../src/style.css";
function UnavailableMap(): React.ReactNode {
  throw Error("Deliberate map failure in a development layout fixture.");
}
createRoot(document.getElementById("root")!).render(
  <main className="app-shell">
    <p
      style={{
        position: "absolute",
        top: 16,
        left: 16,
        fontSize: 16,
        maxWidth: "calc(100vw - 32px)",
      }}
    >
      Development fixture · deliberate map failure. No game state or wallet is
      connected.
    </p>
    <MapBoundary>
      <UnavailableMap />
    </MapBoundary>
    <button
      className="secondary-button"
      style={{ position: "absolute", bottom: 32, left: 16 }}
      onClick={(e) => {
        e.currentTarget.textContent = "Other controls still work";
      }}
    >
      Check another control
    </button>
  </main>,
);
