export const CHUNK: number;
export const HEIGHT: number;
export const SEA_LEVEL: number;
export const DISTRICT: number;
export const PLOT: number;
export const PLOT_PITCH: number;
export const PLOT_GRID: number;
export const SETTLE_Y: number;
export const PLOT_DEPTH: number;
export const BEACON_REGION: number;
export const BEACON_REACH: number;
export const BLOCK: Readonly<Record<
  | "air" | "grass" | "dirt" | "stone" | "sand" | "water" | "wood" | "leaves" | "snow" | "mud"
  | "crystal" | "plank" | "brick" | "glass" | "lantern" | "moss" | "path" | "forest" | "bloom" | "cactus",
  number
>>;
export const BUILD_BLOCKS: readonly number[];
export const BLOCK_NAMES: Readonly<Record<number, string>>;
export const BIOMES: readonly Biome[];
export type Biome = "meadow" | "forest" | "desert" | "wetland" | "crag" | "crystal" | "settlement";
export type Column = { height: number; biome: Biome; top: number };
export type PlotRect = { x0: number; z0: number; size: number };
export type Beacon = { id: string; x: number; z: number; y: number; biome: Biome };
export type Outfit = { id: string; suit: string; trim: string; visor: string };
export function isSolid(block: number): boolean;
export function hash(seed: number, x: number, z: number): number;
export function districtOf(x: number, z: number): [number, number];
export function districtSlots(dx: number, dz: number): PlotRect[];
export const SLOTS_PER_DISTRICT: number;
export function districtAt(n: number): [number, number];
export function slotPlot(slot: number): PlotRect;
export function inPlot(plot: PlotRect, x: number, z: number): boolean;
export function column(seed: number, x: number, z: number): Column;
export function columnBlock(col: Column, y: number): number;
export function regionBeacon(seed: number, rx: number, rz: number): Beacon | null;
export function beaconsNear(seed: number, x: number, z: number, radius: number): Beacon[];
export function beaconById(seed: number, id: string): Beacon | null;
export function forEachFeature(
  seed: number, x0: number, z0: number, x1: number, z1: number,
  put: (x: number, y: number, z: number, block: number) => void,
): void;
export function biomeAt(seed: number, x: number, z: number): Biome;
export const OUTFITS: readonly Outfit[];
export function outfitById(id: string): Outfit;
