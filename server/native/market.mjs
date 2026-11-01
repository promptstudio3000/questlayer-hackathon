import { NativeContractReader } from "./reader.mjs";
import { nativeItem } from "./collectibles.mjs";
import { assert } from "../domain.mjs";
import { NETWORK } from "./network.mjs";
export class NativeMarket extends NativeContractReader {
  constructor(provider, contractId, nfts) {
    super(provider, contractId);
    this.nfts = nfts;
  }
  async snapshot({ fresh = false, fromIndex = 0, verifyTokenId = null } = {}) {
    assert(
      Number.isInteger(fromIndex) && fromIndex >= 0 && fromIndex <= 128,
      "Invalid market page.",
    );
    const [stats, offers] = await Promise.all([
      this.view("get_stats", {}, fresh),
      this.view("get_listings", { from_index: fromIndex, limit: 24 }, fresh),
    ]);
    assert(
      (stats.version === 1 || stats.version === 2) &&
        stats.network === NETWORK &&
        stats.nft_contract === this.nfts.contractId,
      "This market does not match the QuestLayer collection.",
      503,
    );
    const listings = await Promise.all(
      offers.map(async (offer) => {
        const token = nativeItem(
          await this.nfts.view(
            "nft_token",
            { token_id: offer.token_id },
            fresh,
          ),
        );
        return {
          ...offer,
          token,
          available:
            offer.state === "active" && token?.ownerId === this.contractId,
        };
      }),
    );
    let token = null,
      verifiedListing = null;
    if (verifyTokenId) {
      assert(
        /^aura:(polar|moon|gold):\d{1,3}$/.test(verifyTokenId),
        "Choose a native Aura.",
      );
      verifiedListing = await this.view(
        "get_listing",
        { token_id: verifyTokenId },
        true,
      );
      token = nativeItem(
        await this.nfts.view("nft_token", { token_id: verifyTokenId }, true),
      );
    }
    return {
      status: "available",
      network: NETWORK,
      marketContract: this.contractId,
      nftContract: this.nfts.contractId,
      stats,
      listings,
      token,
      verifiedListing,
      fromIndex,
      truncated: fromIndex + offers.length < stats.listing_count,
    };
  }
  async balances(accountIds, fresh = false) {
    return {
      network: NETWORK,
      marketContract: this.contractId,
      accounts: await Promise.all(
        accountIds.slice(0, 5).map(async (accountId) => ({
          accountId,
          ...(await this.view("get_account", { account_id: accountId }, fresh)),
        })),
      ),
    };
  }
  async signer(accountId) {
    assert(typeof accountId === "string" && accountId.length <= 64, "Choose an account.");
    return this.view("get_signer", { account_id: accountId }, true);
  }
}
