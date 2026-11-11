/** Realm identity is separate from geography/day/receipt identity. */
export const REALMS = {
  questlayer: {
    id: "questlayer",
    name: "QuestLayer",
    movement: "gps-or-labelled-arena",
  },
  layer: {
    id: "layer",
    name: "Layer",
    movement: "virtual-voxel",
  },
} as const;
export type RealmId = keyof typeof REALMS;
