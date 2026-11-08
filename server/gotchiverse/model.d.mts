export type Material = "grass" | "stone" | "sand" | "water";
export type Cell = {
  height: number;
  material: Material;
  object: "lantern" | null;
};
export type Workshop = {
  id: string;
  ownerName: string;
  revision: number;
  cells: Record<string, Cell>;
  role: "owner" | "editor";
  members: { id: string; name: string }[];
  visitors: { id: string; name: string; x: number; z: number }[];
  progress: { shaped: number; lantern: boolean; completedAt: number | null };
};
export type Edit = {
  workshopId: string;
  revision: number;
  requestId: string;
  x: number;
  z: number;
  cell: Cell;
};
export const GRID_SIZE: 16;
export const MAX_HEIGHT: 5;
export function cellKey(x: number, z: number): string;
export function naturalCell(x: number, z: number): Cell;
export function terrainCell(workshop: Workshop, x: number, z: number): Cell;
export function movePoint(
  point: [number, number],
  dx: number,
  dz: number,
): [number, number];
export function changedCell(cell: Cell, tool: string): Cell | null;
