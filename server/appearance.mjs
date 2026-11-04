import { nativeItem } from "./native/collectibles.mjs";
import { wornWearables } from "./gotchi-wearables.mjs";
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
    // Aavegotchi wearable clones (ids, slot, placement, gold check only).
    wearables: wornWearables(db, player.id, now).map((w) => ({
      id: w.id,
      slot: w.slot,
      dims: w.dims,
      verified: w.verified,
    })),
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

// A viewer must not need to own another consenting explorer's original skin.
export function sharedOriginalSvg(db, playerId, now = Date.now()) {
  const player = db
    .prepare(
      "SELECT p.appearance FROM players p JOIN presence pr ON pr.player_id=p.id WHERE p.id=? AND pr.expires_at>? AND pr.updated_at>?",
    )
    .get(playerId, now, now - 30000);
  if (!player) return null;
  const appearance = JSON.parse(player.appearance || "{}");
  if (!/^\d{1,24}$/.test(appearance.originTokenId || "")) return null;
  const link = db
    .prepare(
      "SELECT data FROM external_links WHERE player_id=? AND address=? AND verified_at>=?",
    )
    .get(playerId, appearance.address, now - 300000);
  const gotchi =
    link &&
    JSON.parse(link.data).gotchis?.find(
      (g) => g.tokenId === appearance.originTokenId,
    );
  return typeof gotchi?.svg === "string" && gotchi.svg.length <= 200000
    ? gotchi.svg
    : null;
}
