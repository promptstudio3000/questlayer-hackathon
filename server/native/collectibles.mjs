import { NativeContractReader } from "./reader.mjs";
import { assert } from "../domain.mjs";
import { nearAccountId, assertTestnetRpc } from "../identity/near.mjs";
import { NETWORK } from "./network.mjs";
import { AURA_CATALOG, nativeAuraToken } from "../aura-catalog.mjs";
const EDITIONS = Object.fromEntries(
  AURA_CATALOG.filter((e) => e.native).map((e) => [
    e.id,
    { name: e.name, color: e.color, rarity: e.rarity },
  ]),
);
export function nativeItem(token) {
  if (
    !token ||
    typeof token.token_id !== "string" ||
    typeof token.owner_id !== "string"
  )
    return null;
  const aura = nativeAuraToken(token.token_id),
    avatar = token.token_id.startsWith("avatar:");
  if (!aura && !avatar) return null;
  const edition = aura ? EDITIONS[aura.edition] : null,
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
    edition: aura?.edition || null,
    title: String(meta.title || edition?.name || "QuestLayer Explorer").slice(
      0,
      120,
    ),
    media,
    color: edition?.color || "#b8a1ed",
    rarity: edition?.rarity || "common",
    serial: aura ? aura.serial : null,
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
      network: NETWORK,
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
      network: NETWORK,
      contractId: this.contractId,
      accounts,
    };
  }
}
