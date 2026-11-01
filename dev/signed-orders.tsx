// Browser fixture for the signed-offer UI inside the real NativeMarketPanel.
// Requests are answered in memory and market calls never sign or send a
// transaction; orders are signed with a throwaway in-memory key.
// ?state=off | on | empty
import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { KeyPair } from "near-api-js";
import { NativeMarketPanel } from "../src/NativeMarketPanel";
import { orderTerms, signOrder } from "../src/signed-order";
import type { PlayerKeyRecord } from "../src/player-key";
import type { NativeWardrobeState, Player } from "../src/types";
import "../src/style.css";

const scenario = new URLSearchParams(location.search).get("state") || "on";
const me = "mira.players.questlayer.testnet",
  other = "tomas-with-a-long-explorer-name.players.questlayer.testnet",
  market = "questlayer-market-20261101b.testnet",
  nfts = "nfts.questlayer-dev-20261101.testnet";
const pair = KeyPair.fromRandom("ed25519"),
  otherPair = KeyPair.fromRandom("ed25519");
const key: PlayerKeyRecord = { publicKey: pair.getPublicKey().toString(), secretKey: pair.toString(), accountId: me, origin: "device", createdAt: 0 };
const otherKey: PlayerKeyRecord = { publicKey: otherPair.getPublicKey().toString(), secretKey: otherPair.toString(), accountId: other, origin: "device", createdAt: 0 };
const token = (id: string, title: string) => ({ kind: "aura", tokenId: id, ownerId: market, title, color: "#c2a0df", rarity: "epic", serial: Number(id.split(":")[2]), edition: id.split(":")[1], media: null });
const listings = scenario === "empty" ? [] : [
  { id: 7, token_id: "aura:moon:12", seller: other, price: "0", state: "deposited", buyer: null, available: false, token: token("aura:moon:12", "Moonwake Aura") },
  { id: 8, token_id: "aura:polar:4", seller: me, price: "0", state: "deposited", buyer: null, available: false, token: token("aura:polar:4", "Polar Drift Aura") },
];
const later = Date.now() + 26 * 3600 * 1000;
const relayed = scenario === "empty" ? [] : [
  { id: "a", terms: orderTerms({ kind: "sell", market, nftContract: nfts, maker: other, tokenId: "aura:moon:12", price: "2500000000000000000000000", deadlineMs: later, epoch: 0 }), fillable: true },
  { id: "b", terms: orderTerms({ kind: "buy", market, nftContract: nfts, maker: other, tokenId: "aura:polar:4", price: "1200000000000000000000000", deadlineMs: Date.now() + 50 * 60000, epoch: 0 }), fillable: true },
];
const orders = await Promise.all(relayed.map(async (o) => ({ ...o, order: await signOrder(otherKey, o.terms) })));
let registered = scenario !== "off";
const json = (body: unknown) => new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json" } });
window.fetch = async (input: RequestInfo | URL) => {
  const url = String(input);
  if (url.startsWith("/api/native/market/orders/status")) return json({ statuses: [{ valid: true }, { valid: false, reason: "Order expired" }] });
  if (url.startsWith("/api/native/market/orders")) return json({ orders });
  if (url.startsWith("/api/native/market/signer")) return json({ keys: registered ? [key.publicKey] : [], epoch: 0 });
  if (url.startsWith("/api/native/market/accounts")) return json({ accounts: [{ accountId: me, credit: "500000000000000000000000", withdrawing: "0", listed: 1, buying: 0 }] });
  if (url.startsWith("/api/native/market"))
    return json({ status: "available", network: "testnet", marketContract: market, nftContract: nfts, stats: { version: 2, paused: false, listing_count: listings.length, funded: "0", escrow: "0", credits: "0", withdrawing: "0", withdrawn: "0" }, listings, token: null, truncated: false, fromIndex: 0 });
  return json({});
};
if (scenario === "on") {
  const mine = await signOrder(key, orderTerms({ kind: "sell", market, nftContract: nfts, maker: me, tokenId: "aura:polar:4", price: "3000000000000000000000000", deadlineMs: later, epoch: 0 }));
  const old = await signOrder(key, orderTerms({ kind: "buy", market, nftContract: nfts, maker: me, tokenId: "aura:moon:12", price: "900000000000000000000000", deadlineMs: Date.now() + 60000, epoch: 0 }));
  localStorage.setItem(`questlayer-signed-orders:${me}`, JSON.stringify([
    { order: mine, terms: JSON.parse(mine.message), status: "open" },
    { order: old, terms: JSON.parse(old.message), status: "open" },
  ]));
} else localStorage.removeItem(`questlayer-signed-orders:${me}`);

function Review() {
  const [log, setLog] = useState("Fixture: market calls are recorded here and never sent.");
  const player = { wallets: [{ account_id: me }], nativeAccount: me } as Player;
  const wardrobe = { contractId: nfts, accounts: [{ accountId: me, items: [{ ...token("aura:gold:2", "Gilded Ember Aura"), ownerId: me }] }] } as NativeWardrobeState;
  return (
    <main style={{ maxWidth: 640, padding: 16, margin: "0 auto", background: "#fffaf0", color: "#493860" }}>
      <p style={{ fontSize: 16, fontWeight: 700 }}>Development fixture · signed offers · nothing is sent</p>
      <p role="log" style={{ fontSize: 14 }}>{log}</p>
      <NativeMarketPanel
        player={player}
        wardrobe={wardrobe}
        busy=""
        onConnect={async () => {}}
        onTrade={async () => false}
        deviceKey={key}
        onMarketCall={async (c) => {
          setLog(`Recorded ${c.methodName} (deposit ${c.deposit} yocto). Not sent.`);
          if (c.methodName === "add_signing_key") registered = true;
          return true;
        }}
      />
    </main>
  );
}
createRoot(document.getElementById("root")!).render(<Review />);
