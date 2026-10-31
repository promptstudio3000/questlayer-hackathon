import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { NativeStaking, type VaultSnapshot } from "../src/NativeStaking";
import type { Player } from "../src/types";
import "../src/style.css";
import "../src/styles.css";
const account = "layout-review-wallet-with-long-name.testnet";
const player = { wallets: [{ account_id: account }] } as Player;
const fixturePhase =
  new URLSearchParams(location.search).get("phase") || "idle";
const readVaults = async (): Promise<VaultSnapshot> => {
  if (new URLSearchParams(location.search).has("failure"))
    throw Error(
      "The testnet network is unavailable. Your position has not changed.",
    );
  return {
    network: "testnet",
    factoryId: "questlayer-vaults-20261031.testnet",
    config: {
      setup_deposit: "3520000000000000000000000",
      vault_reserve: "3500000000000000000000000",
      factory_storage: "20000000000000000000000",
      created: 1,
      capacity: 32,
    },
    pools: [
      { id: "aurora.pool.f863973.m0", name: "Aurora validator (testnet)" },
    ],
    positions: [
      {
        id: "0",
        account_id: "v0.questlayer-vaults-20261031.testnet",
        beneficiary: account,
        pool: "aurora.pool.f863973.m0",
        contribution_bps: 5000,
        state: "ready",
        position: {
          stage: fixturePhase === "unlocking" ? "unlocking" : "idle",
          exit_requested: fixturePhase !== "idle",
          staked: "10000000000000000000000",
          unstaked: "0",
          weighted_stake: "5000000000000000000000",
          owner_credit:
            fixturePhase === "credit" ? "10000000000000000000000" : "0",
          owner_pending: "0",
          principal: "10000000000000000000000",
          deposited: "10000000000000000000000",
          game_pending: "0",
          game_credit: "0",
          epoch: "5400",
          unlock_epoch: fixturePhase === "unlocking" ? "5402" : "0",
        },
      },
    ],
    refund: null,
  };
};
function Review() {
  const [message, setMessage] = useState(
    "Layout fixture: example values, no wallet signing or blockchain transactions.",
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
      <p role="status">{message}</p>
      <NativeStaking
        player={player}
        readVaults={readVaults}
        onConnect={() => {}}
        onTransaction={async () => {
          setMessage(
            "Wallet cancellation simulated. No test NEAR was transferred. Your entered amount is preserved.",
          );
          return false;
        }}
      />
    </main>
  );
}
createRoot(document.getElementById("root")!).render(<Review />);
