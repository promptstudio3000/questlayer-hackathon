// Reads the official Aavegotchi wearable item types from the Aavegotchi Diamond
// on Base and writes server/data/gotchi-wearables.json (names, slot, rarity,
// placement on the 64×64 gotchi canvas). Artwork is not copied: the game reads
// each item's SVG from the same contract at runtime (server/gotchi-items.mjs).
// Usage: node scripts/build-gotchi-wearables.mjs [maxItemId]
import { writeFileSync } from "node:fs";
import { createPublicClient, http, parseAbi } from "viem";
import { base } from "viem/chains";
import { AAVEGOTCHI } from "../server/aavegotchi.mjs";

const abi = parseAbi([
  "struct Dim { uint8 x; uint8 y; uint8 width; uint8 height; }",
  "struct ItemType { string name; string description; string author; int8[6] traitModifiers; bool[16] slotPositions; uint8[] allowedCollaterals; Dim dimensions; uint256 ghstPrice; uint256 maxQuantity; uint256 totalQuantity; uint32 svgId; uint8 rarityScoreModifier; bool canPurchaseWithGhst; uint16 minLevel; bool canBeTransferred; uint8 category; int16 kinshipBonus; uint32 experienceBonus; }",
  "function getItemType(uint256 _itemId) view returns (ItemType)",
]);
const RARITY = { 1: "common", 2: "uncommon", 5: "rare", 10: "legendary", 20: "mythical", 50: "godlike" };
// LibItems slot indexes: BODY 0, FACE 1, EYES 2, HEAD 3, HAND_LEFT 4, HAND_RIGHT 5, PET 6, BG 7.
const SLOTS = ["body", "face", "eyes", "head", "hand", "hand", "pet"];
const max = Number(process.argv[2] || 420);
const client = createPublicClient({
  chain: base,
  transport: http(process.env.BASE_RPC_URL || "https://mainnet.base.org", { timeout: 15000, retryCount: 3 }),
});
const items = [];
for (let start = 1; start <= max; start += 8) {
  const ids = Array.from({ length: Math.min(8, max - start + 1) }, (_, i) => start + i);
  const rows = await Promise.all(
    ids.map((id) =>
      client
        .readContract({ address: AAVEGOTCHI, abi, functionName: "getItemType", args: [BigInt(id)] })
        .then((t) => [id, t])
        .catch(() => [id, null]),
    ),
  );
  for (const [id, t] of rows) {
    if (!t || t.category !== 0 || !t.name || t.maxQuantity === 0n) continue;
    const slotIndex = t.slotPositions.findIndex((on, i) => on && i < 7);
    const rarity = RARITY[t.rarityScoreModifier];
    const { x, y, width, height } = t.dimensions;
    if (slotIndex < 0 || !rarity || !width || !height) continue;
    items.push({
      id,
      name: t.name.trim(),
      slot: SLOTS[slotIndex],
      rarity,
      dims: [x, y, width, height],
      supply: Number(t.maxQuantity),
    });
  }
}
const out = {
  source: "Aavegotchi Diamond on Base (chain 8453), getItemType(itemId)",
  contract: AAVEGOTCHI,
  note: "Names and placement from the official contract. Item artwork is read from getItemSvg(itemId) at runtime and is not stored here.",
  generatedAt: new Date().toISOString().slice(0, 10),
  // Percent of wearable finds per rarity (game tuning, not contract data).
  dropWeights: { common: 40, uncommon: 26, rare: 18, legendary: 10, mythical: 5, godlike: 1 },
  items,
};
writeFileSync(new URL("../server/data/gotchi-wearables.json", import.meta.url), JSON.stringify(out, null, 1) + "\n");
console.log(`Wrote ${items.length} wearables.`);
