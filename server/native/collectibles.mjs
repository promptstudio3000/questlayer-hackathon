import { NativeContractReader } from "./reader.mjs";
import { assert } from "../domain.mjs";
import { nearAccountId, assertTestnetRpc } from "../identity/near.mjs";
const EDITIONS = {
  polar: { name: "Northern Lights", color: "#9edfc5", rarity: "rare" },
  moon: { name: "Moonwake Aura", color: "#c2a0df", rarity: "epic" },
  gold: { name: "Sunlit Aura", color: "#e7c35f", rarity: "legendary" },
};
export function nativeItem(token) {
  if (
    !token ||
    typeof token.token_id !== "string" ||
    typeof token.owner_id !== "string"
  )
    return null;
  const aura = /^aura:(polar|moon|gold):(\d{1,3})$/.exec(token.token_id),
    avatar = token.token_id.startsWith("avatar:");
  if (!aura && !avatar) return null;
  if (aura && (Number(aura[2]) < 1 || Number(aura[2]) > 256)) return null;
  const edition = aura ? EDITIONS[aura[1]] : null,
    meta = token.metadata || {},
    media =
      typeof meta.media === "string" &&
      meta.media.length < 400000 &&
      /^(data:image\/(svg\+xml|png|webp);base64,|https:\/\/)/.test(meta.media)
        ? meta.media
        : null;
  return {
    tokenId: token.token_id,
    ownerId: token.owner_id,
    kind: avatar ? "avatar" : "aura",
    edition: aura?.[1] || null,
    title: String(meta.title || edition?.name || "QuestLayer Explorer").slice(
      0,
      120,
    ),
    media,
    color: edition?.color || "#b8a1ed",
    rarity: edition?.rarity || "common",
    serial: aura ? Number(aura[2]) : null,
  };
}
export class NativeCollectibles extends NativeContractReader {
  async claimSnapshot(claimId) {
    await assertTestnetRpc(this.provider);
    const response = await this.provider.query({
      request_type: "call_function",
      account_id: this.contractId,
      method_name: "get_claim",
      args_base64: Buffer.from(JSON.stringify({ claim_id: claimId })).toString(
        "base64",
      ),
      finality: "final",
    });
    const claim = JSON.parse(Buffer.from(response.result).toString());
    const block = await this.provider.viewBlock({
      blockId: response.block_hash,
    });
    const blockTimestampMs = Number(
      BigInt(block.header.timestamp_nanosec) / 1000000n,
    );
    assert(
      Number.isSafeInteger(blockTimestampMs),
      "The finalized block time is unavailable.",
      503,
    );
    return {
      tokenId: claim?.token_id || null,
      receiverId: claim?.receiver_id || null,
      edition: claim?.edition || null,
      blockTimestampMs,
      blockHash: response.block_hash,
    };
  }
  async collection(fresh = false) {
    const [metadata, supply, tokens, version] = await Promise.all([
      this.view("nft_metadata", {}, fresh),
      this.view("nft_total_supply", {}, fresh),
      this.view("nft_tokens", { from_index: "0", limit: 24 }, fresh),
      this.view("get_version", {}, fresh),
    ]);
    assert(
      version === 2 || version === 3,
      "Native wardrobe is awaiting its contract upgrade.",
      503,
    );
    const ownerIds = [...new Set(tokens.map((t) => t.owner_id))].slice(0, 3);
    const previews = await Promise.allSettled(
      ownerIds.map((id) => this.wardrobe([id], fresh)),
    );
    const outfits = previews.flatMap((r) =>
      r.status === "fulfilled"
        ? r.value.accounts.filter(
            (a) => a.starterOwned || a.equipment.above || a.equipment.below,
          )
        : [],
    );
    return {
      status: "available",
      network: "testnet",
      contractId: this.contractId,
      version,
      name: metadata.name,
      supply: String(supply),
      items: tokens.map(nativeItem).filter(Boolean),
      outfits,
      truncated: BigInt(supply) > 24n,
    };
  }
  async wardrobe(accountIds, fresh = false) {
    const ids = [...new Set(accountIds)].slice(0, 5);
    const accounts = await Promise.all(
      ids.map(async (accountId) => {
        nearAccountId(accountId);
        const [tokens, equipment, supply, starter] = await Promise.all([
          this.view(
            "nft_tokens_for_owner",
            { account_id: accountId, from_index: "0", limit: 100 },
            fresh,
          ),
          this.view("get_equipment", { account_id: accountId }, fresh),
          this.view("nft_supply_for_owner", { account_id: accountId }, fresh),
          this.view("nft_token", { token_id: "avatar:" + accountId }, fresh),
        ]);
        const items = tokens
          .map(nativeItem)
          .filter((t) => t?.ownerId === accountId);
        const slots = { above: null, below: null };
        for (const slot of ["above", "below"]) {
          const tokenId = equipment[slot];
          if (!tokenId) continue;
          let item = items.find((t) => t.tokenId === tokenId);
          if (!item) {
            item = nativeItem(
              await this.view("nft_token", { token_id: tokenId }, fresh),
            );
            if (item?.ownerId === accountId) items.push(item);
          }
          if (
            item?.ownerId === accountId &&
            item.kind === "aura" &&
            !(slot === "below" && slots.above === tokenId)
          )
            slots[slot] = tokenId;
        }
        return {
          accountId,
          items,
          equipment: slots,
          starterMinted: !!starter,
          starterOwned: starter?.owner_id === accountId,
          supply: String(supply),
          truncated: BigInt(supply) > 100n,
        };
      }),
    );
    return {
      status: "available",
      network: "testnet",
      contractId: this.contractId,
      accounts,
    };
  }
}
