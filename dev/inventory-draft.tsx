import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { Inventory, type OriginalInventory } from "../src/Inventory";
import type { Item, Player } from "../src/types";
import "../src/style.css";

const aura: Item = {
  id: "inventory-price-fixture-aura",
  kind: "aura",
  name: "Riverbank Starlight",
  rarity: "rare",
  slot: "above",
  color: "#ad72f1",
  equipped: 0,
  serial: 7,
};
const player: Player = {
  id: "inventory-price-draft-fixture",
  name: "Synthetic riverbank explorer",
  appearance: {},
  gold_u: 50000000,
  xp: 250,
  level: 2,
  tier: 1,
  weighted_u: 0,
  inventory: [aura],
  positions: [],
  withdrawals: [],
  history: [],
  wallets: [],
};
const loadOriginals = async (): Promise<OriginalInventory> => ({
  linked: false,
  status: "unlinked",
  count: 0,
  gotchis: [],
  wearables: [],
});
const large = new URLSearchParams(location.search).get("text") === "large";

function Review() {
  const [message, setMessage] = useState(
    "Synthetic inventory fixture. No API requests, wallet, listing or balance changes. Price text stays only in this browser's separate fixture draft.",
  );
  const [map3D, setMap3D] = useState(false);
  return (
    <main className="inventory-draft-fixture">
      <p role="status">{message}</p>
      <Inventory
        player={player}
        characterItems={[aura]}
        nativeContent={<p>NEAR ownership is not simulated in this fixture.</p>}
        initialCollection="demo"
        busy=""
        map3D={map3D}
        onMap3D={() => setMap3D(!map3D)}
        loadOriginals={loadOriginals}
        onOriginalAppearance={() => {}}
        onEvm={async () => {
          setMessage("Fixture only. No wallet connection was opened.");
        }}
        onSkin={async () => {}}
        onEquip={() => {
          setMessage("Fixture only. No equipment or ownership was changed.");
        }}
        onSell={async (_item, price) => {
          setMessage(
            `Simulated listing callback received ${price} micro-GOLD. No listing was created; the price draft is retained.`,
          );
          return false;
        }}
      />
      <style>{`
        body { margin:0; overflow:auto; background:#f2ebff; }
        #root { min-height:100dvh; }
        .inventory-draft-fixture { max-width:620px; margin:0 auto; padding:16px; background:#fcfaff; min-height:100dvh; }
        .inventory-draft-fixture>p { font-size:16px; line-height:1.5; color:#665577; }
        ${large ? ".game-dialog .inventory-dialog :is(p,small,span,label,input,button,h2,h3) { font-size:32px!important; line-height:1.5; }" : ""}
      `}</style>
    </main>
  );
}
createRoot(document.getElementById("root")!).render(<Review />);
