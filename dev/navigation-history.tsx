// Uses the actual navigation hook and Dialog in StrictMode. No app/API mocks,
// rewards, GPS, wallet calls or saved actions are involved in this fixture.
import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { Dialog } from "../src/Dialog";
import { useAppNavigation } from "../src/useAppNavigation";

function NavigationHistoryFixture() {
  const navigation = useAppNavigation("fixture-navigation-qa");
  const [modal, setModal] = useState(false);
  return (
    <main tabIndex={-1}>
      <h1 tabIndex={-1}>Navigation history fixture</h1>
      <p>
        Actual useAppNavigation and Dialog in React.StrictMode. This page uses
        browser history only: no APIs, GPS, wallet or reward operations.
      </p>
      <p role="status">
        Current page: <strong data-current-tab>{navigation.tab}</strong>
      </p>
      <div className="fixture-actions">
        <button disabled={!navigation.ready} onClick={() => setModal(true)}>
          Open modal
        </button>
        <button
          disabled={!navigation.ready}
          onClick={() => navigation.update({ tab: "inventory" })}
        >
          Inventory
        </button>
        <button
          disabled={!navigation.ready}
          onClick={() => navigation.update({ tab: "explore" })}
        >
          Explore
        </button>
      </div>
      <p>
        Open the modal, then use browser Back, Close or Escape. To check the
        simultaneous close/navigation case, choose Close and open inventory,
        then use Back and Forward. Reload restores presentation only.
      </p>
      {modal && (
        <Dialog
          label="Navigation history test modal"
          onClose={() => setModal(false)}
        >
          <h2>Navigation history test modal</h2>
          <p>This modal represents no reward, financial review or consent.</p>
          <div className="fixture-actions">
            <button onClick={() => setModal(false)}>Close</button>
            <button
              onClick={() => {
                setModal(false);
                navigation.update({ tab: "inventory" });
              }}
            >
              Close and open inventory
            </button>
          </div>
        </Dialog>
      )}
      <style>{`
        body.navigation-history-fixture {
          margin: 0; overflow: auto; background: #fffdf8; color: #1a0335;
          font: 16px/1.5 system-ui, sans-serif;
        }
        .navigation-history-fixture main { max-width: 48rem; margin: auto; padding: 24px; }
        .navigation-history-fixture .fixture-actions { display: flex; flex-wrap: wrap; gap: 12px; }
        .navigation-history-fixture button {
          min-height: 48px; min-width: 48px; padding: 10px 16px;
          font: inherit; color: inherit; background: white; border: 2px solid #672eeb;
          border-radius: 8px; cursor: pointer;
        }
        .navigation-history-fixture button:focus-visible { outline: 3px solid #1a0335; outline-offset: 3px; }
        .navigation-history-fixture dialog { max-width: min(32rem, calc(100vw - 48px)); padding: 24px; border: 2px solid #672eeb; border-radius: 12px; }
        .navigation-history-fixture dialog::backdrop { background: #1a033580; }
      `}</style>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <NavigationHistoryFixture />
  </React.StrictMode>,
);
