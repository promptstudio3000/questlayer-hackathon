import React, { useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { NativeLevelRewards, type Progress } from "../src/NativeLevelRewards";
import { AccountSessions, type SessionView } from "../src/AccountSessions";
import type { Player } from "../src/types";
import "../src/style.css";
import "../src/styles.css";
import "../src/play-ui.css";
const account = "long-explorer-account-for-mobile-layout-review.testnet",
  player = { id: "layout", wallets: [{ account_id: account }] } as Player;
const fail = new URLSearchParams(location.search).has("failure");
const readProgress = async (): Promise<Progress> => ({
  status: fail ? "unavailable" : "available",
  network: "testnet",
  accountId: account,
  sourceContractId: "example.testnet",
  policy: "native-xp-level-v1",
  xp: fail ? null : "100",
  level: 2,
  levelStartXp: "100",
  nextLevelXp: "400",
  xpToNextLevel: "300",
  reason: fail
    ? "Confirmed XP is currently unavailable. Refresh to retry."
    : undefined,
  milestones: [
    {
      level: 2,
      edition: "polar",
      name: "Northern Lights",
      requiredXp: "100",
      state: "available",
      claimable: true,
      claimId: "fixture",
    },
    {
      level: 3,
      edition: "moon",
      name: "Moonwake Aura",
      requiredXp: "400",
      state: "locked",
      claimable: false,
      claimId: "fixture-3",
    },
    {
      level: 4,
      edition: "gold",
      name: "Sunlit Aura",
      requiredXp: "900",
      state: "sold_out",
      claimable: false,
      claimId: "fixture-4",
    },
  ],
});
function Review() {
  const revoked = useRef(false),
    [message, setMessage] = useState(
      "Layout fixture · no wallet signing or chain transactions.",
    );
  const readSessions = async (): Promise<SessionView> => ({
    network: "testnet",
    activeSessionCount: revoked.current ? 1 : 2,
    hasMoreSessions: false,
    sessions: [
      {
        id: "current",
        current: true,
        kind: "near-wallet",
        accountId: account,
        createdAt: Date.now(),
        lastSeenAt: Date.now(),
        expiresAt: Date.now() + 30000,
      },
      ...(revoked
        ? []
        : [
            {
              id: "other",
              current: false,
              kind: "guest",
              accountId: null,
              createdAt: Date.now(),
              lastSeenAt: Date.now(),
              expiresAt: Date.now() + 30000,
            },
          ]),
    ],
    recovery: {
      nearAccounts: [account],
      demoPasskeys: 1,
      canRevokeOtherSessions: true,
      nativePasskeyAccount: false,
    },
  });
  return (
    <main
      style={{
        maxWidth: 640,
        padding: 16,
        margin: "0 auto",
        background: "#FCFAFF",
        color: "#1A0335",
      }}
    >
      <p role="status">{message}</p>
      <NativeLevelRewards
        player={player}
        account={account}
        onAccount={() => {}}
        onConnect={() => {}}
        busy=""
        readProgress={readProgress}
        onMint={async () => {
          setMessage(
            "Wallet cancellation simulated. No NFT minted or test NEAR spent.",
          );
          return false;
        }}
        onConfirm={async () => false}
      />
      <AccountSessions
        player={player}
        onConnect={() => {}}
        busy=""
        readSessions={readSessions}
        onRevoke={async () => {
          revoked.current = true;
          setMessage("Other session signed out in this fixture only.");
          return true;
        }}
      />
    </main>
  );
}
createRoot(document.getElementById("root")!).render(<Review />);
