// Read-only API projections for the actual App. No wallets, GPS requests,
// signing, native visits, account linking or reward mutations are performed.
import React from "react";
import { createRoot } from "react-dom/client";
import App from "../src/App";
import type { Player, World } from "../src/types";
import type { NativeGameState } from "../src/native-game-types";
import "../src/style.css";

const params = new URLSearchParams(location.search);
const phase = params.get("phase") || "ready";
const alice = "alice-fixture.testnet",
  bob = "bob-fixture.testnet";
const player: Player = {
  id: "native-objective-browser-fixture",
  name: "Fixture explorer",
  appearance: {},
  gold_u: 0,
  xp: 0,
  level: 1,
  tier: 1,
  weighted_u: 0,
  inventory: [],
  positions: [],
  withdrawals: [],
  history: [],
  wallets:
    phase === "guest" ? [] : [{ account_id: alice }, { account_id: bob }],
};
const point = { lat: 49.74745, lng: 13.3774 };
const world = (): World => ({
  id: "fixture-demo-world",
  day: "fixture",
  region: "plzen",
  timezone: "Europe/Prague",
  arena: true,
  source: "Read-only fixture",
  center: point,
  endsAt: Date.now() + 3600000,
  zones: [],
  coins: [],
  quests: [],
});
function snapshot(account: string | null): NativeGameState {
  const now = Date.now();
  const quests = ["Park trail", "Riverbank expedition"].map((title, index) => ({
    index,
    title,
    name: index ? "Šafaříkovy sady" : "Chvojkovy lomy",
    prompt: "Follow the public path and check in at each marked stop.",
    tier: 1,
    reward: "500000000000000000000",
    xp: 60,
    opensAt: now - 3600000,
    closesAt: now + 3600000,
    targets: [
      point,
      { lat: 49.7479, lng: 13.378 },
      { lat: 49.7484, lng: 13.3788 },
    ],
    checkpoint:
      index === 1 && account === alice
        ? phase === "progress"
          ? 2
          : ["pending", "confirmed", "recorded"].includes(phase)
            ? 3
            : 1
        : 0,
    prizeClaimed: phase === "shared-claimed",
    prizePending: false,
  }));
  const receiptKind = params.get("kind") === "coin" ? "coin" : "quest";
  const confirmedAmount =
    receiptKind === "coin" ? "1000000000000000000" : "500000000000000000000";
  return {
    status: phase === "preparing" ? "preparing" : "ready",
    network: "testnet",
    accountId: account,
    generatedAt: phase === "stale" ? now - 60000 : now,
    contractId:
      phase === "contract-changed"
        ? "changed-fixture.testnet"
        : "rewards-fixture.testnet",
    enrolled: !!account,
    access: { tier: 1, weighted: "0" },
    balance: account
      ? {
          credit:
            phase === "confirmed" && account === alice ? confirmedAmount : "0",
          pending: "0",
          withdrawn: "0",
          xp: 60,
        }
      : null,
    collection: {
      available: phase !== "paused",
      paused: phase === "paused",
      coinLimit: 100,
      coinsAcceptedToday: 0,
      pendingCoinsToday: 0,
      minimumIntervalMs: 3000,
    },
    day:
      phase === "preparing"
        ? null
        : {
            id:
              phase === "next-day" ? "fixture-next-day" : "fixture-native-day",
            hash: "fixture-manifest-hash",
            day: "fixture",
            startsAt: now - 3600000,
            endsAt: phase === "expired" ? now - 1 : now + 3600000,
            map: { status: "unavailable", zones: [] },
            coinUnit: "1000000000000000000",
            coinCount: 20,
            claimsAccepted: 2,
            claimsLimit: 256,
            quests,
            coins: ["missing-coin", "pending", "confirmed"].includes(phase)
              ? []
              : [{ ...point, index: 17, distance: 0 }],
          },
    receipts:
      account === alice && ["pending", "confirmed"].includes(phase)
        ? [
            {
              id: "fixture-native-receipt",
              accountId: alice,
              dayId: "fixture-native-day",
              kind: receiptKind,
              index: receiptKind === "coin" ? 17 : 1,
              state: phase === "confirmed" ? "confirmed" : "retrying",
              amount: phase === "confirmed" ? confirmedAmount : null,
              xp:
                phase === "confirmed"
                  ? receiptKind === "coin"
                    ? 2
                    : 60
                  : null,
              createdAt: now - 20000,
              transaction: null,
              error: null,
            },
          ]
        : [],
    treasury: {
      coins: { available: "0", reserved: "0" },
      zones: { available: "0", reserved: "0" },
    },
    worker: { queued: phase === "pending" ? 1 : 0, last_error: null },
    vaults: [],
  };
}
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
  if (!url.pathname.startsWith("/api/")) return originalFetch(input, init);
  const body = init?.body ? JSON.parse(String(init.body)) : {};
  if (url.pathname === "/api/me") return Response.json({ player });
  if (url.pathname === "/api/world") return Response.json(world());
  if (url.pathname === "/api/presence") return Response.json({ players: [] });
  if (url.pathname === "/api/native/rewards/nearby") {
    if (phase === "error")
      return Response.json(
        { error: "Fixture: the testnet read is unavailable." },
        { status: 503 },
      );
    return Response.json(snapshot(body.accountId || null));
  }
  return Response.json(
    { error: "Unavailable in this read-only fixture." },
    { status: 503 },
  );
};
// Keep the demo event stream separate from the synthetic account projections.
window.EventSource = class extends EventTarget {
  close() {}
} as unknown as typeof EventSource;
if (params.get("text") === "large") {
  const style = document.createElement("style");
  style.textContent =
    ".native-objective strong{font-size:32px!important}.native-objective small{font-size:28px!important}.native-objective-recovery h2{font-size:40px!important}.native-objective-recovery p,.native-objective-recovery button{font-size:32px!important}";
  document.head.append(style);
}
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
