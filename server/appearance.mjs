import { nativeItem } from "./native/collectibles.mjs";
const validColor = (value) =>
  typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value) ? value : null;
export async function publicAppearance(
  db,
  player,
  native,
  { now = Date.now() } = {},
) {
  const result = {
    color: "#b8a1ed",
    above: null,
    below: null,
    skinTokenId: null,
    source: "demo",
  };
  const appearance =
    typeof player.appearance === "string"
      ? JSON.parse(player.appearance || "{}")
      : player.appearance || {};
  if (/^\d{1,24}$/.test(appearance.originTokenId || "")) {
    const link = db
      .prepare(
        "SELECT data,verified_at FROM external_links WHERE player_id=? AND address=?",
      )
      .get(player.id, appearance.address);
    if (
      link &&
      link.verified_at >= now - 300000 &&
      JSON.parse(link.data).gotchis?.some(
        (g) => g.tokenId === appearance.originTokenId,
      )
    )
      result.skinTokenId = appearance.originTokenId;
  }
  if (player.native_outfit) {
    result.source = "native";
    const account = player.native_account;
    if (
      !account ||
      !db
        .prepare(
          "SELECT 1 FROM wallet_links WHERE player_id=? AND account_id=?",
        )
        .get(player.id, account)
    )
      return { ...result, source: "unavailable" };
    try {
      const gear = await native.view("get_equipment", { account_id: account });
      for (const slot of ["above", "below"]) {
        if (!gear[slot]) continue;
        const item = nativeItem(
          await native.view("nft_token", { token_id: gear[slot] }),
        );
        if (item?.kind === "aura" && item.ownerId === account)
          result[slot] = item.color;
      }
    } catch {
      return { ...result, above: null, below: null, source: "unavailable" };
    }
  } else {
    const rows = db
      .prepare(
        "SELECT kind,color,slot FROM inventory WHERE player_id=? AND (kind='avatar' OR equipped=1)",
      )
      .all(player.id);
    result.color =
      validColor(rows.find((i) => i.kind === "avatar")?.color) || result.color;
    for (const slot of ["above", "below"])
      result[slot] = validColor(
        rows.find((i) => i.kind === "aura" && i.slot === slot)?.color,
      );
  }
  return result;
}
export async function publicAppearances(db, players, native, options) {
  const results = new Array(players.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(4, players.length) }, async () => {
      while (next < players.length) {
        const index = next++;
        results[index] = await publicAppearance(
          db,
          players[index],
          native,
          options,
        );
      }
    }),
  );
  return results;
}
