import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { NativeMarketPanel } from "../src/NativeMarketPanel";
import type { Player, NativeWardrobeState } from "../src/types";
import "../src/style.css";
function Review() {
  const [message, setMessage] = useState(
    "Mock wallet and asset for form layout only. Public offers are read from testnet; trade callbacks never sign or send transactions.",
  );
  const account = "layout-review-wallet-with-long-name.testnet",
    player = {
      wallets: [{ account_id: account }],
      nativeAccount: account,
    } as Player,
    wardrobe = {
      contractId: "nfts.questlayer-dev-20261031.testnet",
      accounts: [
        {
          accountId: account,
          items: [
            {
              kind: "aura",
              tokenId: "aura:moon:250",
              ownerId: account,
              title: "Moonwake Aura · layout example",
              color: "#c2a0df",
              rarity: "epic",
              serial: 250,
              edition: "moon",
              media: null,
            },
          ],
        },
      ],
    } as NativeWardrobeState;
  return (
    <main
      style={{
        maxWidth: 640,
        padding: 16,
        margin: "0 auto",
        background: "#fffaf0",
        color: "#493860",
      }}
    >
      <p style={{ fontSize: 16, fontWeight: 700 }}>
        Development layout fixture · no connected wallet
      </p>
      <p role="status" style={{ fontSize: 16 }}>
        {message}
      </p>
      <NativeMarketPanel
        player={player}
        wardrobe={wardrobe}
        busy=""
        onConnect={async () => {}}
        onTrade={async () => {
          setMessage("Preview only: no trade was submitted.");
          return false;
        }}
      />
    </main>
  );
}
createRoot(document.getElementById("root")!).render(<Review />);
