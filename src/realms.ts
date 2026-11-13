/** Realm identity is separate from geography/day/receipt identity. */
/** The app and platform. The real-world GPS layer inside it is GotchiGO. */
export const APP_NAME = "QuestLayer";
export const REALMS = {
  questlayer: {
    id: "questlayer",
    name: "GotchiGO",
    movement: "gps-or-labelled-arena",
  },
  layer: {
    id: "layer",
    name: "Layer",
    movement: "virtual-voxel",
  },
} as const;
export type RealmId = keyof typeof REALMS;
