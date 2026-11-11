// Shop → Market listing order and price display (MarketBoard.tsx), kept
// pure so tests can pin them.
import { formatNativeNear } from "./native-amounts.ts";

export type MarketListing = {
  key: string;
  source: "intents" | "market";
  id: string;
  listingId?: number;
  tokenId: string;
  title: string;
  edition: string | null;
  rarity: string;
  slot: "above" | "below";
  color: string | null;
  /** What the seller receives. */
  price: string;
  /** What the buyer pays: the Intents fee is added on top. */
  pays: string;
  seller: string;
  mine: boolean;
  order: number;
};
export type MarketSort = "newest" | "name" | "rarity" | "price-up" | "price-down";
export type MarketFilter = "all" | "above" | "below" | "mine";
/** A short NEAR amount for cards: 4 decimals, rounded up so a buyer never pays more than shown. */
export function shortNear(yocto: string) {
  const unit = 10n ** 20n;
  const value = BigInt(yocto);
  if (value > 0n && value < unit) return formatNativeNear(yocto);
  return formatNativeNear(String(((value + unit - 1n) / unit) * unit));
}
const RARITY_RANK: Record<string, number> = { common: 0, uncommon: 1, rare: 2, epic: 3, legendary: 4 };

/** Filter and order listings; pure so tests can pin the order. */
export function arrangeListings(list: MarketListing[], filter: MarketFilter, sort: MarketSort) {
  const shown = list.filter((l) => (filter === "all" ? true : filter === "mine" ? l.mine : l.slot === filter));
  const price = (l: MarketListing) => BigInt(l.pays);
  return shown.sort((a, b) => {
    if (sort === "name") return a.title.localeCompare(b.title) || a.tokenId.localeCompare(b.tokenId);
    if (sort === "rarity") return (RARITY_RANK[b.rarity] ?? 0) - (RARITY_RANK[a.rarity] ?? 0) || a.title.localeCompare(b.title);
    if (sort === "price-up" || sort === "price-down") {
      const d = price(a) === price(b) ? 0 : price(a) < price(b) ? -1 : 1;
      return sort === "price-up" ? d : -d;
    }
    return b.order - a.order;
  });
}

