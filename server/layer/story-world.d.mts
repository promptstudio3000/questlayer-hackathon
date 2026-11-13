export const STORY_SEED: string;
export const BASALT_GOAL: number;
export type SignalSite = Readonly<{ id: string; x: number; z: number; symbol: string }>;
export const SIGNAL_SITES: readonly SignalSite[];
export const MARKER: Readonly<{ x: number; z: number; blocks: readonly Readonly<{ x: number; y: number; z: number; material: string }>[] }>;
export function storySiteAt(x: number, z: number): SignalSite | undefined;
