/** Realm identity is separate from geography/day/receipt identity. */
export const REALMS = {
  questlayer: {
    id: "questlayer",
    name: "QuestLayer",
    movement: "gps-or-labelled-arena",
  },
  gotchiverse: {
    id: "gotchiverse",
    name: "Gotchiverse",
    movement: "virtual-workshop",
  },
} as const;
export type RealmId = keyof typeof REALMS;
