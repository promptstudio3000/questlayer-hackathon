import { mkdir, writeFile } from "node:fs/promises";
import { createPublicClient, http } from "viem";
import { base } from "viem/chains";
import { AAVEGOTCHI, AAVEGOTCHI_ABI } from "../server/aavegotchi.mjs";
import { GotchiModels } from "../server/gotchi-models.mjs";
const models = new GotchiModels();
const starter = await models.describe();
const client = createPublicClient({
  chain: base,
  transport: http("https://mainnet.base.org", {
    timeout: 12000,
    retryCount: 1,
  }),
});
let original;
try {
  const equipped = await client.readContract({
    address: AAVEGOTCHI,
    abi: AAVEGOTCHI_ABI,
    functionName: "equippedWearables",
    args: [6741n],
  });
  original = {
    ...(await models.describe({
      tokenId: "6741",
      expectedWearables: equipped.map(String),
    })),
    wardrobeComparedToBaseRpc: true,
    ownershipClaimed: false,
  };
} catch (error) {
  original = {
    tokenId: "6741",
    available: false,
    reason: error.message,
    ownershipClaimed: false,
  };
}
if (process.env.QUESTLAYER_MODEL_QA_ASSET === "1" && original.available) {
  await writeFile(
    "dev/reference-6741.glb",
    models.asset(original.digest).bytes,
  );
}
const report = {
  verifiedAt: new Date().toISOString(),
  mode: "public artwork reference probes; no ownership claim, wallet key or transaction",
  starter,
  original,
  permissionBasis:
    "Published SDK invitation to build Gotchi experiences; see the asset catalog for scope and remaining rights review.",
  source: "https://www.aavegotchi.com/sdk",
  renderer: "https://github.com/aavegotchi/aavegotchi-3d-render-skill",
  hosting: "bounded on-demand memory cache; not a full catalog mirror",
};
await mkdir("output/qa/W04-models", { recursive: true });
await writeFile(
  "output/qa/W04-models/character-model-probes.json",
  JSON.stringify(report, null, 2) + "\n",
);
console.log(
  JSON.stringify({
    starter: starter.stats,
    originalAvailable: original.available,
    originalStats: original.stats,
    originalReason: original.reason,
  }),
);
