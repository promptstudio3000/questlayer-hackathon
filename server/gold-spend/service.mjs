import { purchaseAtomic } from "./purchases.mjs";
// GOLD spending (QGOLD build plan, stream 4; doc "QGOLD: návrh ekonomiky").
// Every spend burns: nothing here pays another player or the treasury, and
// nothing creates money or changes odds.
//   - emotes above the character: basic ones are free for everyone, premium
//     ones are unlocked once for GOLD;
//   - cosmetics: a marker frame, unlocked once, one equipped at a time;
//   - NPC premium gear: a trader sells a chest-edition Aura from the shared
//     supply for GOLD (burn first, then the Aura lands in the wardrobe and the
//     player secures it as an NFT through the ordinary redeem_aura claim);
//   - the Golden Altar fee (server/actors/hunt/rewards.mjs calls altarFee);
//   - lures: for 30 minutes an actor that is already on today's map dwells at
//     a safe public place where the player physically stands, or a cosmetic
//     beacon marks the spot as a meeting point. One per player, 200 m apart,
//     07:00–22:00 local time, GPS only.
import { latLngToCell } from "h3-js";
import { assert, distance, GOLD, id, validateFix } from "../domain.mjs";
import { atomic } from "../database.mjs";
import { AURA_CATALOG } from "../aura-catalog.mjs";
import { grantEdition } from "../actors/hunt/rewards.mjs";
import { registerActorDecorator, registerSegmentOverride } from "../actors/service.mjs";
import { burnGold, burnTotals, ensureGoldSpend, GOLD_SPEND, priceU } from "./ledger.mjs";
export { altarFee } from "./ledger.mjs";

const MIN = 60_000;
const minutes = (hhmm) => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
};
/** Minutes since local midnight in a time zone. */
export function localMinutes(now, timezone = "Europe/Prague") {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: timezone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(now);
  const get = (t) => Number(parts.find((p) => p.type === t)?.value || 0);
  return get("hour") * 60 + get("minute");
}
export function lureHoursOpen(now, timezone, hours = GOLD_SPEND.lures.hours) {
  const m = localMinutes(now, timezone);
  return m >= minutes(hours[0]) && m < minutes(hours[1]);
}

export const FREE_EMOTES = Object.freeze([...GOLD_SPEND.emotes.free]);
export const PREMIUM_EMOTES = Object.freeze(GOLD_SPEND.emotes.premium.map((e) => Object.freeze({ ...e })));
export const COSMETICS = Object.freeze(GOLD_SPEND.cosmetics.map((c) => Object.freeze({ ...c })));
export const GEAR = Object.freeze(
  GOLD_SPEND.gear.editions
    .map((e) => AURA_CATALOG.find((x) => x.id === e))
    .filter((e) => e && e.source === "chest")
    .map((e) => Object.freeze({ id: e.id, name: e.demoName, rarity: e.rarity, slot: e.slot, price: GOLD_SPEND.gear.price[e.rarity] })),
);
export const LURE = GOLD_SPEND.lures;


export function createGoldSpend(db, { actors = null, poiSource = null, now = () => Date.now(), allowArenaLures = false } = {}) {
  ensureGoldSpend(db);
  const owned = (player) =>
    new Set(db.prepare("SELECT sku FROM gold_unlocks WHERE player_id=?").all(player).map((r) => r.sku));
  const balance = (player) => db.prepare("SELECT gold_u FROM players WHERE id=?").get(player)?.gold_u ?? 0;
  const looks = (player) => db.prepare("SELECT * FROM gold_looks WHERE player_id=?").get(player) || null;
  const setLook = (player, fields, at) => {
    const cur = looks(player) || { frame: null, emote: null, emote_until: 0 };
    const next = { ...cur, ...fields };
    db.prepare(
      "INSERT INTO gold_looks(player_id,frame,emote,emote_until,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(player_id) DO UPDATE SET frame=excluded.frame,emote=excluded.emote,emote_until=excluded.emote_until,updated_at=excluded.updated_at",
    ).run(player, next.frame ?? null, next.emote ?? null, next.emote_until ?? 0, at);
    return next;
  };
  const gearToday = (player, at) =>
    db.prepare("SELECT COUNT(*) AS n FROM gold_burns WHERE player_id=? AND kind='gear' AND created_at>?").get(player, at - 86_400_000).n;

  function shop(player) {
    assert(player, "Sign in to open the shop.", 401, "AUTH");
    const have = owned(player),
      look = looks(player),
      at = now();
    return {
      version: GOLD_SPEND.version,
      realm: "practice",
      balanceU: balance(player),
      emotes: [
        ...FREE_EMOTES.map((e) => ({ id: e, price: 0, owned: true, free: true })),
        ...PREMIUM_EMOTES.map((e) => ({ id: e.id, price: e.price, owned: have.has(`emote:${e.id}`), free: false })),
      ],
      cosmetics: COSMETICS.map((c) => ({ ...c, owned: have.has(`cosmetic:${c.id}`), equipped: look?.frame === c.id })),
      gear: {
        perDay: GOLD_SPEND.gear.perDay,
        boughtToday: gearToday(player, at),
        items: GEAR.map((g) => {
          const row = db.prepare("SELECT minted,max_supply FROM editions WHERE name=?").get(g.name);
          return { ...g, left: row ? Math.max(0, row.max_supply - row.minted) : null };
        }),
      },
      lures: { prices: LURE.price, minutes: LURE.minutes, hours: LURE.hours, active: activeLureOf(player, at) },
      look: look ? { frame: look.frame, emote: look.emote_until > at ? look.emote : null, emoteUntil: look.emote_until } : null,
      altar: { default: GOLD_SPEND.altar.default, byRecipe: GOLD_SPEND.altar.byRecipe },
    };
  }

  /** Unlock a premium emote or a cosmetic once. */
  function buy(player, { sku } = {}) {
    assert(player, "Sign in to spend QGOLD.", 401, "AUTH");
    assert(typeof sku === "string" && /^(emote|cosmetic):[a-z0-9-]{2,30}$/.test(sku), "Pick something from the shop.", 400, "SKU");
    const [kind, itemId] = sku.split(":");
    const item = kind === "emote" ? PREMIUM_EMOTES.find((e) => e.id === itemId) : COSMETICS.find((c) => c.id === itemId);
    assert(item, "This is not in the shop.", 404, "SKU");
    const at = now();
    return purchaseAtomic(db, () => {
      assert(!owned(player).has(sku), "You already have this.", 409, "OWNED");
      const burn = burnGold(db, { player, kind, ref: itemId, amountU: priceU(item.price), title: kind === "emote" ? `Emote unlocked: ${itemId}` : `Cosmetic unlocked: ${itemId}`, now: at });
      db.prepare("INSERT INTO gold_unlocks(player_id,sku,burn_id,created_at) VALUES(?,?,?,?)").run(player, sku, burn.id, at);
      if (kind === "cosmetic") setLook(player, { frame: itemId }, at);
      return { sku, burn, balanceU: burn.balanceU };
    });
  }

  function equip(player, { frame = null } = {}) {
    assert(player, "Sign in first.", 401, "AUTH");
    assert(frame === null || (typeof frame === "string" && owned(player).has(`cosmetic:${frame}`)), "Unlock this frame first.", 409, "NOT_OWNED");
    return { look: setLook(player, { frame }, now()) };
  }

  /** Show an emote above the character for a short while. */
  function emote(player, { emote: e } = {}) {
    assert(player, "Sign in first.", 401, "AUTH");
    assert(typeof e === "string", "Pick an emote.", 400, "EMOTE");
    const free = FREE_EMOTES.includes(e),
      premium = PREMIUM_EMOTES.some((x) => x.id === e);
    assert(free || premium, "Unknown emote.", 404, "EMOTE");
    assert(free || owned(player).has(`emote:${e}`), "Unlock this emote in the shop first.", 402, "EMOTE_LOCKED");
    const at = now(),
      until = at + GOLD_SPEND.emotes.showSeconds * 1000;
    setLook(player, { emote: e, emote_until: until }, at);
    return { emote: e, until };
  }

  /** What other players see on a nearby explorer: frame and a live emote. */
  function lookOf(player, at = now()) {
    const l = looks(player);
    if (!l) return null;
    const out = {};
    if (l.frame) out.frame = l.frame;
    if (l.emote && l.emote_until > at) {
      out.emote = l.emote;
      out.emoteUntil = l.emote_until;
    }
    return Object.keys(out).length ? out : null;
  }

  // ---- NPC premium gear --------------------------------------------------------
  async function buyGear(player, { actorId, encounter, edition } = {}) {
    assert(player, "Sign in to spend QGOLD.", 401, "AUTH");
    assert(actors, "Characters on the map are not enabled here.", 503, "ACTORS_DISABLED");
    const enc = await actors.requireEncounter({ token: encounter, player, actorId });
    assert(enc.actor?.archetype === "trader", "Only a trader sells premium gear.", 409, "NOT_TRADER");
    const g = GEAR.find((x) => x.id === edition);
    assert(g, "The trader does not sell this.", 404, "GEAR");
    const at = now();
    return purchaseAtomic(db, () => {
      assert(gearToday(player, at) < GOLD_SPEND.gear.perDay, "One premium piece per day. Come back tomorrow.", 429, "GEAR_DAILY");
      const burn = burnGold(db, { player, kind: "gear", ref: `${g.id}@${actorId}`, amountU: priceU(g.price), title: `Premium gear: ${g.name}`, now: at, meta: { trader: actorId } });
      const item = grantEdition(db, player, g.id, at);
      assert(item, "This edition is sold out. Your QGOLD is safe.", 409, "GEAR_SOLD_OUT");
      return { item, burn, balanceU: burn.balanceU };
    });
  }

  // ---- Lures -----------------------------------------------------------------------
  function activeLureOf(player, at) {
    const r = db.prepare("SELECT * FROM gold_lures WHERE player_id=? AND ends_at>? ORDER BY ends_at DESC LIMIT 1").get(player, at);
    return r ? lureView(r, at) : null;
  }
  function lureView(r, at = now()) {
    return {
      id: r.id,
      kind: r.kind,
      actorId: r.actor_id,
      actorName: r.actor_name,
      place: r.poi_name,
      lat: r.lat,
      lng: r.lng,
      startsAt: r.starts_at,
      endsAt: r.ends_at,
      secondsLeft: Math.max(0, Math.ceil((r.ends_at - at) / 1000)),
      mine: false,
    };
  }

  // The nearest safe public place within poiSnapM of the player. POIs come from
  // the classified POI database (safety='ok', on a mapped path); without it,
  // today's zones and quests of the world stand in (they passed the same
  // safety review when the world was planned).
  function safePlace(world, here) {
    let best = null;
    const consider = (p) => {
      if (!p || !Number.isFinite(p.lat) || !Number.isFinite(p.lng)) return;
      const d = distance(here, p);
      if (d <= LURE.poiSnapM && (!best || d < best.d)) best = { ...p, d };
    };
    try {
      const cell = latLngToCell(here.lat, here.lng, 7);
      if (poiSource?.available?.() && cell) for (const p of poiSource.cellPois(cell) || []) consider({ id: `poi:${p.id}`, name: p.name || p.category, lat: p.lat, lng: p.lng });
    } catch {
      /* POI file unavailable: fall back to the world's own places. */
    }
    for (const z of world.zones || []) consider({ id: `zone:${z.id}`, name: z.name || "", lat: z.lat ?? z.center?.lat, lng: z.lng ?? z.center?.lng });
    try {
      for (const q of db.prepare("SELECT id,title,lat,lng FROM quests WHERE world_id=?").all(world.id)) consider({ id: `quest:${q.id}`, name: q.title, lat: q.lat, lng: q.lng });
    } catch {
      /* No quests table in a slim test database. */
    }
    return best;
  }

  function lureChecks(player, { worldId, fix }, at) {
    assert(player, "Sign in to set a lure.", 401, "AUTH");
    assert(actors, "Characters on the map are not enabled here.", 503, "ACTORS_DISABLED");
    const world = actors.manifestFor(worldId);
    assert(!world.arena || allowArenaLures, "Lures work only where you physically stand. Switch to GPS play.", 409, "LURE_GPS");
    assert(fix && typeof fix === "object", "Lures need your GPS position.", 422, "LURE_GPS");
    validateFix(fix, fix, at);
    assert(lureHoursOpen(at, world.timezone || "Europe/Prague"), `Lures work between ${LURE.hours[0]} and ${LURE.hours[1]} local time.`, 409, "LURE_HOURS");
    const place = safePlace(world, fix);
    assert(place, "Stand at a public place on the map (a square, park or landmark) to set a lure.", 409, "LURE_PLACE");
    return { world, place };
  }

  function nearbyLures(here, at) {
    const dLat = 0.02,
      dLng = 0.03;
    return db
      .prepare("SELECT * FROM gold_lures WHERE ends_at>? AND lat BETWEEN ? AND ? AND lng BETWEEN ? AND ?")
      .all(at, here.lat - dLat, here.lat + dLat, here.lng - dLng, here.lng + dLng)
      .map((r) => ({ r, d: distance(here, r) }));
  }

  /** Lure options at the player's spot: what can come and for how much. */
  function lureQuote(player, input = {}) {
    const at = now();
    const { world, place } = lureChecks(player, input, at);
    const mine = activeLureOf(player, at);
    const close = nearbyLures(place, at).filter((x) => x.d < LURE.spacingM);
    const cast = actors.castNow(world.id);
    const busy = new Set(db.prepare("SELECT actor_id FROM gold_lures WHERE world_id=? AND ends_at>? AND actor_id IS NOT NULL").all(world.id, at).map((r) => r.actor_id));
    const pick = (archetypes) =>
      cast.actors
        .filter((a) => archetypes.includes(a.archetype) && a.pos && !busy.has(a.id))
        .map((a) => ({ ...a, d: distance(place, a.pos) }))
        .filter((a) => a.d <= LURE.searchM)
        .sort((a, b) => a.d - b.d)[0] || null;
    const options = [];
    for (const [kind, archetypes] of Object.entries(LURE.kinds)) {
      const a = pick(archetypes);
      options.push(
        a
          ? { kind, actorId: a.id, name: a.name, archetype: a.archetype, distanceM: Math.round(a.d), price: LURE.price[a.archetype] ?? LURE.price[kind] ?? 1000 }
          : { kind, actorId: null, name: null, archetype: null, distanceM: null, price: null, reason: kind === "trader" ? "No trader is out near you right now." : "No monster is out near you right now." },
      );
    }
    options.push({ kind: "beacon", actorId: null, name: null, archetype: null, distanceM: 0, price: LURE.price.beacon });
    return {
      place: { id: place.id, name: place.name, lat: place.lat, lng: place.lng },
      minutes: LURE.minutes,
      blocked: mine ? "You already have an active lure." : close.length ? `Another lure is within ${LURE.spacingM} m.` : null,
      options,
      balanceU: balance(player),
    };
  }

  function setLure(player, input = {}) {
    const at = now();
    const { world, place } = lureChecks(player, input, at);
    const kind = input.kind;
    assert(["monster", "trader", "beacon"].includes(kind), "Pick a lure.", 400, "LURE_KIND");
    let actor = null;
    if (kind !== "beacon") {
      const cast = actors.castNow(world.id);
      actor = cast.actors.find((a) => a.id === input.actorId);
      assert(actor && LURE.kinds[kind].includes(actor.archetype), "This character can't be lured.", 409, "LURE_ACTOR");
      assert(actor.pos, `${actor.name} is not out right now.`, 409, "LURE_AWAY");
      assert(distance(place, actor.pos) <= LURE.searchM, `${actor.name} is too far away to hear the lure.`, 409, "LURE_FAR");
    }
    const price = kind === "beacon" ? LURE.price.beacon : LURE.price[actor.archetype] ?? LURE.price[kind];
    return purchaseAtomic(db, () => {
      assert(!db.prepare("SELECT 1 FROM gold_lures WHERE player_id=? AND ends_at>?").get(player, at), "You already have an active lure.", 409, "LURE_ACTIVE");
      assert(!nearbyLures(place, at).some((x) => x.d < LURE.spacingM), `Another lure is within ${LURE.spacingM} m. Walk a bit further.`, 409, "LURE_SPACING");
      if (actor)
        assert(!db.prepare("SELECT 1 FROM gold_lures WHERE world_id=? AND actor_id=? AND ends_at>?").get(world.id, actor.id, at), `${actor.name} is already answering another lure.`, 409, "LURE_BUSY");
      const lureId = id("lure");
      const burn = burnGold(db, {
        player,
        kind: "lure",
        ref: `${kind}:${actor?.id || place.id}`,
        amountU: priceU(price),
        title: kind === "beacon" ? "Lure: beacon" : `Lure: ${actor.name}`,
        now: at,
        meta: { lure: lureId, place: place.id },
      });
      const endsAt = at + LURE.minutes * MIN;
      db.prepare(
        "INSERT INTO gold_lures(id,player_id,kind,world_id,actor_id,actor_name,poi_id,poi_name,lat,lng,starts_at,ends_at,burn_id,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
      ).run(lureId, player, kind, world.id, actor?.id || null, actor?.name || null, place.id, place.name || "", place.lat, place.lng, at, endsAt, burn.id, at);
      const row = db.prepare("SELECT * FROM gold_lures WHERE id=?").get(lureId);
      return { lure: { ...lureView(row, at), mine: true }, burn, balanceU: burn.balanceU };
    });
  }

  /** Lures within visibleM of a point, with countdowns, for the map. */
  function luresNear(player, here, at = now()) {
    return nearbyLures(here, at)
      .filter((x) => x.d <= LURE.visibleM)
      .map((x) => ({ ...lureView(x.r, at), mine: x.r.player_id === player }));
  }

  // The actor service asks every request where a lured actor dwells.
  const lureFor = db.prepare("SELECT starts_at,ends_at,lat,lng FROM gold_lures WHERE world_id=? AND actor_id=? AND ends_at>? AND starts_at<=? ORDER BY starts_at DESC LIMIT 1");
  registerSegmentOverride(({ instance, worldId, now: t }) => {
    if (!worldId) return null;
    const r = lureFor.get(worldId, instance.id, t, t);
    return r ? { from: r.starts_at, to: r.ends_at, lat: r.lat, lng: r.lng } : null;
  });
  const lureEnds = db.prepare("SELECT ends_at FROM gold_lures WHERE world_id=? AND actor_id=? AND ends_at>? AND starts_at<=? LIMIT 1");
  registerActorDecorator((view, { worldId, now: t }) => {
    if (!worldId) return null;
    const r = lureEnds.get(worldId, view.id, t, t);
    return r ? { luredUntil: r.ends_at } : null;
  });

  /** The game balance; with the QGOLD vault open the routes replace it with the wallet. */
  const wallet = (player) => {
    assert(player, "Sign in first.", 401, "AUTH");
    return { realm: "practice", balanceU: balance(player) };
  };
  return { shop, wallet, buy, equip, emote, lookOf, buyGear, lureQuote, setLure, luresNear, burns: () => burnTotals(db, now()), GOLD };
}
