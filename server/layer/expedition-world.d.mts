export const DIAMOND_ORE: number;
export const PLAZA: Readonly<{
  x0: number;
  z0: number;
  size: number;
  y: number;
}>;
export const PLAZA_SPAWN: Readonly<{ x: number; y: number; z: number }>;
export const DIAMOND_GOAL: number;
export const ORE_RENEW_MS: number;
export const MINING_REACH: number;
export const ATLAS_CELL: number;
export type Mine = Readonly<{
  id: string;
  kind: string;
  x: number;
  z: number;
  entranceX: number;
  entranceZ: number;
  radius: number;
}>;
export const MINES: readonly Mine[];
export function mineAt(x: number, z: number): Mine | null;
export function inPlaza(x: number, z: number): boolean;
export function protectedPlaza(x: number, z: number): boolean;
export function inExpeditionRegion(x: number, z: number): boolean;
export function expeditionBlock(
  seed: number,
  x: number,
  y: number,
  z: number,
): number | undefined;
export function naturalExpeditionBlock(
  seed: number,
  x: number,
  y: number,
  z: number,
): number;
export function miningDuration(block: number): number;
export function mineable(
  seed: number,
  x: number,
  y: number,
  z: number,
  block: number,
): boolean;
export function clearMiningRay(
  from: { x: number; y: number; z: number },
  target: { x: number; y: number; z: number },
  readBlock: (x: number, y: number, z: number) => number,
): boolean;

export function breakable(
  seed: number,
  x: number,
  y: number,
  z: number,
  block: number,
): boolean;
