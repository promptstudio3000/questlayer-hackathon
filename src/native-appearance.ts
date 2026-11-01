import type { NativeAccount, Item } from "./types";

export function nativeAppearanceItems(
  account: NativeAccount | undefined,
): Item[] {
  return (
    account?.items.map((item) => ({
      id: "native:" + item.tokenId,
      kind: item.kind,
      name: item.title,
      rarity: item.rarity,
      color: item.color,
      serial: item.serial,
      slot:
        item.kind === "avatar"
          ? "avatar"
          : account.equipment.above === item.tokenId
            ? "above"
            : "below",
      equipped:
        item.kind === "avatar" ||
        account.equipment.above === item.tokenId ||
        account.equipment.below === item.tokenId
          ? 1
          : 0,
    })) || []
  );
}
