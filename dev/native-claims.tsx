import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { AuraClaims } from "../src/AuraClaims";
import type { Player } from "../src/types";
import "../src/style.css";
function Review() {
  const [message, setMessage] = useState(
    "Layout fixture only. No account, signature or transaction is connected.",
  );
  const player = {
    wallets: [{ account_id: "layout-only.testnet" }],
    inventory: [
      {
        id: "ready",
        kind: "aura",
        name: "Northern Lights",
        rarity: "rare",
        slot: "above",
        color: "#9edfc5",
        equipped: 0,
        serial: 17,
      },
      {
        id: "pending",
        kind: "aura",
        name: "Moonwake Aura",
        rarity: "epic",
        slot: "below",
        color: "#c2a0df",
        equipped: 0,
        serial: 23,
        native_claim_state: "issued",
        native_claim_receiver: "long-layout-account-for-recovery.testnet",
        native_claim_expires_at: Date.now() + 15 * 60000,
      },
    ],
  } as Player;
  const preview = async () =>
    setMessage(
      "Preview action selected. The real app uses your NEAR wallet and checks finalized chain state.",
    );
  return (
    <main
      style={{
        maxWidth: 600,
        padding: 16,
        margin: "0 auto",
        background: "#fffaf0",
        color: "#493860",
      }}
    >
      <p style={{ fontSize: 16, fontWeight: 700 }}>
        Development layout review · fixture data
      </p>
      <p role="status" style={{ fontSize: 16 }}>
        {message}
      </p>
      <AuraClaims
        player={player}
        enabled={!new URLSearchParams(location.search).has("disabled")}
        busy=""
        onConnect={preview}
        onMint={preview}
        onConfirm={preview}
        onRestore={preview}
      />
    </main>
  );
}
createRoot(document.getElementById("root")!).render(<Review />);
