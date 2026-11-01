// Wires monster challenges onto the shared actor service (docs/NPC-PLAN.md
// §13.2 and §14): the encounter verifier, the offer menu for monsters and the
// durable store. Returns null when actors are off, so the routes answer 503.
import { readFileSync } from "node:fs";
import { registerMenuBuilder } from "../menu.mjs";
import { createChallengeService } from "./service.mjs";
import { dbChallengeStore } from "./store.mjs";

const DATA = new URL("../../data/", import.meta.url);
const PLACE_RADIUS_M = 300;

function defaultCity() {
  const registry = JSON.parse(readFileSync(new URL("cities.json", DATA), "utf8"));
  const city = registry.cities.find((c) => c.default) || registry.cities[0];
  const pack = JSON.parse(readFileSync(new URL(city.pack, DATA), "utf8"));
  const places = (pack.candidates || []).flatMap((c) => {
    const ring = c.geometry?.type === "Polygon" ? c.geometry.coordinates[0] : null;
    if (!ring?.length) return [];
    const lng = ring.reduce((s, p) => s + p[0], 0) / ring.length;
    const lat = ring.reduce((s, p) => s + p[1], 0) / ring.length;
    return [{ name: c.name, lat, lng }];
  });
  return { id: city.id, places };
}

const meters = (a, b) => {
  const r = Math.PI / 180;
  const x = (b.lng - a.lng) * r * Math.cos(((a.lat + b.lat) * r) / 2);
  const y = (b.lat - a.lat) * r;
  return Math.hypot(x, y) * 6371000;
};

// Where the actor stands now: the last path point of the segment under way.
export function actorPosition(actor, t = Date.now()) {
  const seg = (actor?.segments || []).find((s) => s.from <= t && t <= s.to) || actor?.segments?.[0];
  const p = seg?.path?.at(seg.dwell ? 0 : -1);
  return p ? { lng: p[0], lat: p[1] } : null;
}

export function nearestPlace(places, at) {
  if (!at) return null;
  let best = null;
  for (const p of places) {
    const d = meters(at, p);
    if (d <= PLACE_RADIUS_M && (!best || d < best.d)) best = { name: p.name, d };
  }
  return best?.name || null;
}

export function createMonsterChallenges(db, actorService, { levelOf, secret, now = () => Date.now(), onResult } = {}) {
  if (!actorService) return null;
  const city = defaultCity();
  const encounters = {
    async requireEncounter(args) {
      const enc = await actorService.requireEncounter(args);
      return {
        ...enc,
        cityId: city.id,
        placeName: nearestPlace(city.places, actorPosition(enc.actor, now())),
      };
    },
  };
  const service = createChallengeService({
    secret,
    encounters,
    levelOf,
    now,
    store: dbChallengeStore(db),
    onResult,
  });
  // Monster menus list the three formats on offer today (boss events: M4).
  registerMenuBuilder("monster", ({ actor, player, dayId, expiresAt }) =>
    service.offers(player, actor, dayId, expiresAt),
  );
  return service;
}
