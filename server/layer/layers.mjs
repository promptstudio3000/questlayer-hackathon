// Layer registry (docs/LAYER.md). A layer is one community's copy of the
// virtual voxel world: its own seed (so its own landscape), its own name and
// the display name of its coin. Every layer runs the same QGOLD mechanics; a
// community shows the coin under its own name (the first layer: MINECOIN).
//
// Money is NOT active in any layer yet. `economy` documents the agreed model
// only (owner, 11 Nov 2026): each layer gets its own treasury and QGOLD
// staking; its share of the daily staking yield follows what its players
// staked; the coin pays for tasks created in the layer (or on the web) and
// for completing them. Turning that on needs its own reviewed change.

export const LAYER_REGISTRY = Object.freeze([
  Object.freeze({
    id: "space",
    name: "Space Layer",
    community: "QuestLayer",
    seed: 0x51a7e,
    coin: Object.freeze({ symbol: "MINECOIN", mechanics: "qgold" }),
    economy: Object.freeze({
      active: false,
      treasury: "per-layer",
      yieldShare: "stake-weighted",
      uses: Object.freeze(["tasks"]),
    }),
  }),
]);
export const DEFAULT_LAYER = LAYER_REGISTRY[0].id;

export function layerById(id) {
  return LAYER_REGISTRY.find((layer) => layer.id === id) ?? null;
}

/** Fields the browser may see. */
export const publicLayer = (layer) => ({
  id: layer.id,
  name: layer.name,
  community: layer.community,
  seed: layer.seed,
  coin: layer.coin.symbol,
  economyActive: layer.economy.active,
});
