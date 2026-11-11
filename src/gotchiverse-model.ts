// Shared, node-free realm contract. The packaged server never imports frontend source.
export {
  GRID_SIZE,
  MAX_HEIGHT,
  cellKey,
  naturalCell,
  terrainCell,
  movePoint,
  changedCell,
  type Material,
  type Cell,
  type Workshop,
  type Edit,
} from "../server/gotchiverse/model.mjs";
