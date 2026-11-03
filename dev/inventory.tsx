import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { Inventory, type OriginalInventory } from "../src/Inventory";
import { NativeWardrobe, nativeAppearanceItems } from "../src/NativeWardrobe";
import type { Item, Player, NativeWardrobeState } from "../src/types";
import "../src/style.css";
const accountId = "long-name-explorer-wallet.questlayer.testnet";
const original: OriginalInventory = {
  linked: true,
  status: "verified",
  count: 1,
  verifiedAt: 1793454000000,
  gotchis: [
    {
      tokenId: "fixture-unavailable",
      name: "Cloudkeeper original",
      hasImage: false,
    },
  ],
  wearables: [],
  warnings: ["Loose wearables could not be loaded."],
};
const loadOriginals = async () => original;
const items: Item[] = [
  ...(
    [
      ["Northern Lights", "rare", "above", "#8dd8bd", 1],
      ["Moon Ring", "epic", "below", "#b49beb", 1],
      ["Ember Wisp", "common", "above", "#ff8a4c", 0],
      ["Comet Trail", "epic", "below", "#e6ecff", 0],
      ["Nova Bloom", "legendary", "below", "#ff5fa8", 0],
      ["Stormcrown", "epic", "above", "#8fa6ff", 0],
    ] as const
  ).map(([name, rarity, slot, color, equipped], i) => ({
    id: `demo-catalog-${i}`,
    kind: "aura" as const,
    name,
    rarity,
    slot,
    color,
    equipped,
    serial: 3 + i,
  })),
  {
    id: "demo-moon",
    kind: "aura",
    name: "Moonwake over the river",
    rarity: "epic",
    slot: "above",
    color: "#ad72f1",
    equipped: 0,
    serial: 7,
  },
  {
    id: "demo-moss",
    kind: "aura",
    name: "Mosslight",
    rarity: "uncommon",
    slot: "below",
    color: "#52ad87",
    equipped: 0,
    serial: 25,
  },
  {
    id: "demo-reserved",
    kind: "aura",
    name: "Reserved Starlight",
    rarity: "rare",
    slot: "above",
    color: "#c2a0df",
    equipped: 0,
    serial: 19,
    native_claim_state: "issued",
  },
];
const initial: Player = {
  id: "fixture",
  name: "Cloudkeeper on the river",
  appearance: {},
  gold_u: 50000000,
  xp: 250,
  level: 2,
  tier: 1,
  weighted_u: 0,
  inventory: items,
  positions: [],
  withdrawals: [],
  history: [],
  wallets: [{ account_id: accountId }],
};
const initialWardrobe: NativeWardrobeState = {
  status: "ready",
  network: "testnet",
  contractId: "fixture-collectibles.testnet",
  accounts: [
    {
      accountId,
      equipment: { above: null, below: "aura:moon:7" },
      starterMinted: true,
      starterOwned: true,
      supply: "2",
      truncated: false,
      items: [
        {
          kind: "aura",
          tokenId: "aura:moon:7",
          title: "Moonwake on the river",
          color: "#ad72f1",
          rarity: "epic",
          serial: 7,
          ownerId: accountId,
          edition: "moon",
          media: null,
        },
        {
          kind: "avatar",
          tokenId: "avatar:" + accountId,
          title: "Cloudkeeper Explorer",
          color: "#fff",
          rarity: "common",
          serial: null,
          ownerId: accountId,
          edition: "explorer",
          media: null,
        },
      ],
    },
  ],
};
function Review() {
  const [player, setPlayer] = useState(initial);
  const [data, setData] = useState(initialWardrobe);
  const [busy, setBusy] = useState("");
  const [map3D, setMap3D] = useState(false);
  const [failSale, setFailSale] = useState(true);
  const [nativeError, setNativeError] = useState("");
  const [message, setMessage] = useState(
    "Development fixture. Changes are local to this page. No wallet signing or transactions.",
  );
  const pause = () => new Promise((resolve) => setTimeout(resolve, 700));
  return (
    <main
      style={{
        maxWidth: 480,
        margin: "0 auto",
        padding: 16,
        background: "#fcfaff",
      }}
    >
      <details style={{ marginBottom: 16 }}>
        <summary style={{ minHeight: 48 }}>Layout fixture controls</summary>
        <p role="status">{message}</p>
        <label style={{ display: "block", minHeight: 48 }}>
          <input
            type="checkbox"
            checked={failSale}
            onChange={(event) => setFailSale(event.target.checked)}
          />{" "}
          Fail demo listing
        </label>
        <button
          style={{ minHeight: 48 }}
          onClick={() =>
            setPlayer((current) => ({ ...current, inventory: [] }))
          }
        >
          Empty demo collection
        </button>
        <button style={{ minHeight: 48 }} onClick={() => setPlayer(initial)}>
          Reset demo collection
        </button>
        <button
          style={{ minHeight: 48 }}
          onClick={() =>
            setNativeError(
              "NEAR inventory is temporarily unavailable. Previous results are preserved.",
            )
          }
        >
          Simulate stale NEAR ownership
        </button>
      </details>
      <Inventory
        player={player}
        characterItems={
          player.nativeOutfit
            ? nativeAppearanceItems(data.accounts[0])
            : player.inventory
        }
        busy={busy}
        map3D={map3D}
        onMap3D={() => setMap3D((current) => !current)}
        loadOriginals={loadOriginals}
        onOriginalAppearance={() => {}}
        onEvm={async () => setMessage("EVM linking is a fixture placeholder.")}
        onSkin={async () => {}}
        onExplore={() => setMessage("Returned to the map (fixture only).")}
        onEquip={(selected) => {
          setBusy("equip");
          void pause().then(() => {
            setPlayer((current) => ({
              ...current,
              nativeOutfit: false,
              inventory: current.inventory.map((item) => ({
                ...item,
                equipped:
                  item.slot === selected.slot
                    ? item.id === selected.id
                      ? 1 - item.equipped
                      : 0
                    : item.equipped,
              })),
            }));
            setBusy("");
          });
        }}
        onSell={async (selected, price) => {
          setBusy("listing");
          await pause();
          setBusy("");
          setMessage(`Listing callback received ${price} micro-GOLD.`);
          if (failSale) return false;
          setPlayer((current) => ({
            ...current,
            inventory: current.inventory.filter(
              (item) => item.id !== selected.id,
            ),
          }));
          return true;
        }}
        nativeContent={
          <NativeWardrobe
            player={player}
            data={data}
            error={nativeError}
            busy={busy}
            onConnect={async () => {}}
            onRefresh={() => setNativeError("")}
            onMint={async () => {}}
            onSource={async (account) =>
              setPlayer((current) => ({
                ...current,
                nativeOutfit: !!account,
                nativeAccount: account,
              }))
            }
            onEquip={async (_account, item, slot) => {
              setBusy("native:equip");
              await pause();
              setData((current) => ({
                ...current,
                accounts: current.accounts.map((account) => ({
                  ...account,
                  equipment: {
                    above:
                      slot === "above"
                        ? account.equipment.above === item.tokenId
                          ? null
                          : item.tokenId
                        : account.equipment.above === item.tokenId
                          ? null
                          : account.equipment.above,
                    below:
                      slot === "below"
                        ? account.equipment.below === item.tokenId
                          ? null
                          : item.tokenId
                        : account.equipment.below === item.tokenId
                          ? null
                          : account.equipment.below,
                  },
                })),
              }));
              setBusy("");
            }}
          />
        }
        nativeExtras={
          <p>
            Claim and public profile forms are separate integrations. This
            fixture does not submit them.
          </p>
        }
      />
    </main>
  );
}
createRoot(document.getElementById("root")!).render(<Review />);
