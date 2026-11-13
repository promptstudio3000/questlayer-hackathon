import { formatGold } from "./gold-units.ts";
import { tr } from "./i18n.ts";

// Why a shop item cannot be bought right now, in plain words for the button.
// With the QGOLD vault open, spending burns real QGOLD from the player's NEAR
// account, so only QGOLD already on that account counts. Coins collected on
// the map reach it with the next payout, so a short balance is often only
// "on the way". When the balance could not be read the button stays usable:
// the burn itself checks the balance on chain.
export type ShopBalance = {
  realm: "practice" | "qgold";
  balanceU: number;
  balanceKnown?: boolean;
  pendingU?: number;
  hasAccount?: boolean;
};

export type BuyBlock = { kind: "account" | "on-the-way" | "short"; label: string; title: string };

export function buyBlock(shop: ShopBalance, price: number): BuyBlock | null {
  if (shop.realm === "qgold" && shop.hasAccount === false)
    return { kind: "account", label: tr("Needs a NEAR account"), title: tr("Your QGOLD lives on your NEAR account. Open Settings to set one up.") };
  if (shop.realm === "qgold" && shop.balanceKnown === false) return null;
  const missing = Math.round(price) - Math.max(0, shop.balanceU);
  if (missing <= 0) return null;
  if (shop.realm === "qgold" && (shop.pendingU || 0) >= missing)
    return { kind: "on-the-way", label: tr("Arrives soon"), title: tr("Your collected QGOLD is still on the way to your NEAR account. It arrives with the next payout.") };
  return { kind: "short", label: tr("{0} more needed", { 0: formatGold(missing) }), title: tr("Collect {0} more QGOLD on the map to unlock this.", { 0: formatGold(missing) }) };
}
