import { NativeContractReader } from "./reader.mjs";
import { nativeItem } from "./collectibles.mjs";
import { assert } from "../domain.mjs";
import { NETWORK } from "./network.mjs";
import { verifySignedOrderLocally } from "./signed-orders.mjs";
const MAX_RELAYED_ORDERS = 256;
export class NativeMarket extends NativeContractReader {
  constructor(provider, contractId, nfts) {
    super(provider, contractId);
    this.nfts = nfts;
    // Off-chain relay of signed orders. It is a convenience index only: the
    // contract is the authority, and every order is re-checked on chain.
    this.orders = new Map();
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
  async submitOrder(order, nowMs = Date.now()) {
    const stats = await this.view("get_stats", {});
    assert(stats.version === 2, "Signed orders need the version 2 market.", 503);
    const terms = verifySignedOrderLocally(order, {
      market: this.contractId,
      nftContract: this.nfts.contractId,
      nowMs,
    });
    const check = await this.view("check_order", { order }, true);
    assert(check.valid, check.reason || "The market rejected this order.", 409);
    const id = `${terms.maker}:${order.nonce}`;
    if (!this.orders.has(id) && this.orders.size >= MAX_RELAYED_ORDERS) this.pruneOrders(nowMs);
    assert(this.orders.has(id) || this.orders.size < MAX_RELAYED_ORDERS, "The order relay is full.", 503);
    this.orders.set(id, { id, terms, order, receivedAt: nowMs });
    return { id, terms, fillable: check.fillable };
  }
  pruneOrders(nowMs = Date.now()) {
    for (const [id, o] of this.orders)
      if (Number(o.terms.deadline_ms) <= nowMs) this.orders.delete(id);
  }
  async signedOrders({ tokenId = null, fresh = false } = {}, nowMs = Date.now()) {
    this.pruneOrders(nowMs);
    const rows = [...this.orders.values()]
      .filter((o) => !tokenId || o.terms.token_id === tokenId)
      .slice(0, 48);
    const checked = await Promise.all(
      rows.map(async (o) => {
        const check = await this.view("check_order", { order: o.order }, fresh);
        if (!check.valid) this.orders.delete(o.id);
        return { ...o, valid: check.valid, reason: check.reason, fillable: check.fillable };
      }),
    );
    return {
      network: NETWORK,
      marketContract: this.contractId,
      relay: "off-chain index; the market contract verifies every fill",
      orders: checked.filter((o) => o.valid),
    };
  }
  async signer(accountId) {
    assert(typeof accountId === "string" && accountId.length <= 64, "Choose an account.");
    return this.view("get_signer", { account_id: accountId }, true);
  }
  async orderStatuses(orders) {
    assert(Array.isArray(orders) && orders.length <= 12, "Check at most 12 orders.");
    return Promise.all(
      orders.map(async (order) => {
        const check = await this.view("check_order", { order }, true);
        return { valid: check.valid, reason: check.reason, fillable: check.fillable };
      }),
    );
  }
}
