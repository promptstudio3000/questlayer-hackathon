// MetaLayer registry. The internal world ID remains stable for current clients.
// MetaGold and its independent treasury are an accepted target only. The first
// expedition preview grants local resources, with economy.active kept false.
export const LAYER_REGISTRY = Object.freeze([
  Object.freeze({
    id: "space",
    name: "MetaLayer",
    community: "QuestLayer",
    seed: 0x51a7e,
    coin: Object.freeze({ symbol: "MetaGold", mechanics: "metalayer" }),
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
