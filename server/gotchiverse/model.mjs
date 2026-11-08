/** Nonfinancial workshop contract. Virtual coordinates are never GPS evidence. */
export const GRID_SIZE = 16;
export const MAX_HEIGHT = 5;
export const cellKey = (x, z) => `${x},${z}`;
export function naturalCell(x, z) {
  let h = Math.imul(x + 31, 374761393) ^ Math.imul(z + 17, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return {
    height: h % 13 === 0 ? 2 : 1,
    material: h % 23 === 0 ? "water" : "grass",
    object: null,
  };
}
export function terrainCell(workshop, x, z) {
  return workshop.cells[cellKey(x, z)] ?? naturalCell(x, z);
}
export function movePoint(point, dx, dz) {
  return [
    Math.max(0, Math.min(GRID_SIZE - 1, point[0] + dx)),
    Math.max(0, Math.min(GRID_SIZE - 1, point[1] + dz)),
  ];
}
export function changedCell(cell, tool) {
  if (tool === "raise")
    return cell.height < MAX_HEIGHT
      ? { ...cell, height: cell.height + 1 }
      : null;
  if (tool === "lower")
    return cell.height > 0 ? { ...cell, height: cell.height - 1 } : null;
  if (["grass", "stone", "sand", "water"].includes(tool))
    return { ...cell, material: tool };
  if (tool === "lantern") return { ...cell, object: "lantern" };
  if (tool === "remove") return { ...cell, object: null };
  return null;
}
