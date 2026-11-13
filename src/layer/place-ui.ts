import { tr } from "../i18n";
import { placeById, SIGNAL_SITES, type WorldPlaceId } from "../../server/layer/story-world.mjs";
import type { ExpeditionProgress } from "./story-ui";

export const placeName = (id: WorldPlaceId) => ({
  nera: tr("Keeper Nera"), treasury: tr("MetaGold treasury"), workshop: tr("Luma's workshop"),
  hollow: tr("Crystal Hollow"), quarry: tr("Basalt Quarry"), garden: tr("Spore Garden"),
  arch: tr("Tide Arch"), observatory: tr("Star Observatory"), marker: tr("Trail marker"), beacon: tr("Central beacon"),
})[id];
export function objectivePlace(p: ExpeditionProgress | null): WorldPlaceId | null {
  if (!p || p.quest.state === "available") return "nera";
  return p.story.stage === "expedition" ? "hollow" : p.story.stage === "quarry" ? "quarry"
    : p.story.stage === "signals" ? SIGNAL_SITES[p.story.signals.length].id as WorldPlaceId
    : p.story.stage === "marker" ? "marker" : p.story.stage === "beacon" ? "beacon" : null;
}
export const placeTarget = (id: WorldPlaceId) => placeById(id)!;
