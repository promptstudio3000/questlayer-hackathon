import type { Item, Player } from "./types";

export type AdventureRealm = "arena" | "gps";
export type AdventureResult = {
  id: string;
  version: 1;
  domain: "demo";
  source: "system-quest";
  status: "confirmed" | "legacy-unavailable";
  playerId: string;
  worldId: string;
  realm: AdventureRealm;
  questId: string;
  questKind: string;
  title: string;
  completedAt: number;
  viewedAt: number | null;
  /** On-chain proof of this reward, when it was recorded on NEAR. */
  chain?: import("./chain-proof").ChainRef | null;
  reward: {
    xp: number;
    goldU: number;
    item: Pick<
      Item,
      "id" | "kind" | "name" | "rarity" | "slot" | "color" | "serial"
    > | null;
  } | null;
  itemCurrent: {
    status:
      | "none"
      | "owned"
      | "listed"
      | "reserved"
      | "minted"
      | "not-owned"
      | "missing"
      | "legacy-unavailable";
    equippable: boolean;
    equipped: boolean;
    reason: string | null;
    item?: Item | null;
  };
};

export function adventureResultScope(
  playerId: string | undefined,
  realm: AdventureRealm,
  enabled: boolean,
) {
  return playerId && enabled ? JSON.stringify([playerId, realm]) : "";
}

export function belongsToAdventureScope(
  result: AdventureResult,
  playerId: string | undefined,
  realm: AdventureRealm,
) {
  return (
    result.version === 1 &&
    result.domain === "demo" &&
    result.source === "system-quest" &&
    result.playerId === playerId &&
    result.realm === realm
  );
}

// A saved result establishes the award. Only current inventory and the live server
// projection establish whether a deliberate equipment action can be offered now.
export function adventureItemForEquip(
  result: AdventureResult | null,
  player: Player,
  realm: AdventureRealm,
): Item | null {
  if (
    !result ||
    !belongsToAdventureScope(result, player.id, realm) ||
    result.status !== "confirmed" ||
    result.itemCurrent.status !== "owned" ||
    !result.itemCurrent.equippable ||
    result.itemCurrent.equipped
  )
    return null;
  const id = result.reward?.item?.id;
  const item = player.inventory.find((item) => item.id === id);
  return item &&
    (!item.equipped || player.nativeOutfit) &&
    !item.native_token_id &&
    !item.native_claim_id
    ? item
    : null;
}

export type AdventureReadContext = {
  scope: string;
  online: boolean;
  connection: number;
};

// Returning to the same actor/realm is a new inspection context. An old dialog
// must not become current again, and reconnecting cannot refresh ownership.
export function createAdventureReadContext() {
  let previous = "",
    generation = 0,
    connection = 0,
    wasOnline = true;
  return {
    update(base: string, online: boolean): AdventureReadContext {
      if (base !== previous) {
        previous = base;
        generation++;
      }
      if (online !== wasOnline) {
        wasOnline = online;
        connection++;
      }
      return {
        scope: base ? JSON.stringify([base, generation]) : "",
        online,
        connection,
      };
    },
  };
}

export function isFreshAdventureRead(
  checked: AdventureReadContext,
  current: AdventureReadContext,
) {
  return (
    !!checked.scope &&
    checked.scope === current.scope &&
    current.online &&
    checked.connection === current.connection
  );
}
