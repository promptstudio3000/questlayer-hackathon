import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { NativeProfilePanel, SOCIAL_TESTNET } from "../src/NativeProfile";
import type { Player, NativeProfileState } from "../src/types";
import "../src/style.css";
const accounts = [
    "layout-review-wallet-with-long-name.testnet",
    "second-layout-wallet.testnet",
  ],
  player = {
    name: "Layout explorer",
    wallets: accounts.map((account_id) => ({ account_id })),
  } as Player;
const readProfile = async (accountId: string): Promise<NativeProfileState> => ({
  network: "testnet",
  contractId: SOCIAL_TESTNET,
  accountId,
  status: "unpublished",
  profile: null,
  avatarVerified: false,
  publishAvatar: {
    contractId: "nfts.questlayer-layout.testnet",
    tokenId: `avatar:${accountId}`,
  },
  storage: null,
  minimumStorage: "20000000000000000000000",
  deposit: "50000000000000000000000",
  publishEnabled: true,
});
function Review() {
  const [message, setMessage] = useState(
    "Layout fixture only. No connected wallet, signing, server state change or chain transaction.",
  );
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
        Development profile layout fixture
      </p>
      <p role="status" style={{ fontSize: 16 }}>
        {message}
      </p>
      <NativeProfilePanel
        player={player}
        busy=""
        onConnect={async () => {}}
        readProfile={readProfile}
        onPublish={async () => {
          setMessage(
            "Preview only: wallet cancellation simulated. No profile was published. Your choice is preserved.",
          );
          return false;
        }}
      />
    </main>
  );
}
createRoot(document.getElementById("root")!).render(<Review />);
