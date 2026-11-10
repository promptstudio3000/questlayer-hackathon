// Explore · Nearby: everything on the map around the explorer in one list
// (places, their activities, NPCs and monsters, community content), with a
// type filter and a sort menu. Tapping a row opens the same view its map pin
// opens. Player tasks and Secrets keep their dialogs in NearbyMarket.
import { useEffect, useMemo, useState, type ComponentProps } from "react";
import {
  ArrowRight,
  CaretDown,
  ChatsCircle,
  Eye,
  Flag,
  HandCoins,
  LockKey,
  Megaphone,
  NotePencil,
  Plus,
  Question,
  Sparkle,
} from "@phosphor-icons/react";
import { api, gold, meters, remaining } from "./api";
import { tr } from "./i18n";
import { Badge, CoinIcon, distanceLabel } from "./app-bits";
import { EmptyState } from "./EmptyState";
import { InfoTip } from "./InfoTip";
import { QuestThumbnail } from "./QuestThumbnail";
import { ActorPortrait } from "./ActorPortrait";
import { NearbyMarket, type MarketSecret, type MarketTask } from "./NearbyMarket";
import { questObjectPresentation, representativeZoneQuest } from "./game-object-art-data";
import { activityLabel } from "./activity-view";
import { questDisplayTitle } from "./quest-copy";
import { actorPositionAt } from "./actor-position";
import type { ActorView, ActorsResponse } from "./actor-types";
import type { PlaceThread } from "./gold-spend-client";
import type { MapNote } from "./MapNotes";
import type { Point, Quest, World, Zone } from "./types";
import {
  NEARBY_FILTERS,
  distanceTo,
  nearbyCounts,
  nearbyRows,
  nearbySortOf,
  type NearbyEntry,
  type NearbyFilter,
  type NearbySort,
} from "./nearby-list";
import "./nearby-market.css";
import "./nearby-list.css";

/** Community tasks (bounties) count as nearby within the same 5 km as player tasks. */
const COMMUNITY_TASK_M = 5_000;
const PAGE = 30;
const SORT_KEY = "questlayer.nearbySort";

type Bounty = { id: string; title: string; amount_u: number; lat: number; lng: number; state: string };
type CommunityItem = {
  id: string;
  type: "task" | "bounty" | "secret" | "topic" | "shout" | "note";
  title: string;
  detail: string;
  distanceM: number;
  reward: number;
  inside?: boolean;
  revealed?: boolean;
};

const FILTER_LABEL: Record<NearbyFilter, () => string> = {
  all: () => tr("All"),
  zones: () => tr("Zones"),
  quests: () => tr("Quests"),
  npcs: () => tr("NPCs"),
  community: () => tr("Community"),
};
const SORT_LABEL: Record<NearbySort, () => string> = {
  distance: () => tr("Nearest"),
  xp: () => tr("Most XP"),
  reward: () => tr("Top reward"),
};
const COMMUNITY_LABEL: Record<CommunityItem["type"], () => string> = {
  task: () => tr("Player task"),
  bounty: () => tr("Community task"),
  secret: () => tr("Secret"),
  topic: () => tr("Topic"),
  shout: () => tr("Shout"),
  note: () => tr("Map note"),
};

function readSort(): NearbySort {
  try {
    return nearbySortOf(localStorage.getItem(SORT_KEY));
  } catch {
    return "distance";
  }
}
const short = (text: string, n = 80) => (text.length > n ? `${text.slice(0, n - 1).trimEnd()}…` : text);
const openQuest = (q: Quest, now: number) => !q.completed && q.opens_at <= now && q.closes_at > now;

export function NearbyList({
  world,
  position,
  now,
  playerTier,
  arena,
  filter,
  onFilter,
  onZone,
  onActor,
  onPlace,
  onNotes,
  onCommunityTasks,
  market,
}: {
  world: World;
  position: Point;
  now: number;
  playerTier: number;
  /** City demo (arena) or real GPS: map notes are read for the same realm. */
  arena: boolean;
  filter: NearbyFilter;
  onFilter: (next: NearbyFilter) => void;
  /** Opens a place, or one activity inside it. */
  onZone: (zone: Zone, questId?: string) => void;
  /** Opens an NPC or monster (or shows it on the map when it is far). */
  onActor: (actor: ActorView, distanceM: number) => void;
  /** Opens a place shout or topic. */
  onPlace: (id: string) => void;
  /** Opens the map notes (local chat). */
  onNotes: () => void;
  /** Opens every community task. */
  onCommunityTasks: () => void;
  /** NearbyMarket's own props: it keeps the task and Secret dialogs and forms. */
  market: Omit<ComponentProps<typeof NearbyMarket>, "listed" | "onData" | "position" | "openForm" | "onFormOpened"> & {
    openForm?: "" | "task" | "secret";
    onFormOpened?: () => void;
  };
}) {
  const [sort, setSortState] = useState<NearbySort>(readSort);
  const [limit, setLimit] = useState(PAGE);
  const [form, setForm] = useState<"" | "task" | "secret" | "send">("");
  const [actors, setActors] = useState<{ list: ActorView[]; skew: number }>({ list: [], skew: 0 });
  const [marketData, setMarketData] = useState<{ tasks: MarketTask[]; active: MarketTask[]; secrets: MarketSecret[] } | null>(null);
  const [bounties, setBounties] = useState<Bounty[]>([]);
  const [places, setPlaces] = useState<PlaceThread[]>([]);
  const [notes, setNotes] = useState<MapNote[]>([]);
  const setSort = (next: NearbySort) => {
    setSortState(next);
    setLimit(PAGE);
    try {
      localStorage.setItem(SORT_KEY, next);
    } catch {
      /* private mode: the order lasts for this visit */
    }
  };
  useEffect(() => setLimit(PAGE), [filter]);
  // The map's Actions button asked for a create form.
  const asked = market.openForm;
  useEffect(() => {
    if (!asked) return;
    setForm(asked);
    market.onFormOpened?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [asked]);

  // Re-read on a ~100 m move, not every GPS tick.
  const lat = Math.round(position.lat * 1000) / 1000,
    lng = Math.round(position.lng * 1000) / 1000;
  useEffect(() => {
    let live = true;
    const ignore = () => {
      /* each source is optional: the list shows what it could read */
    };
    api<ActorsResponse>(`/actors?worldId=${encodeURIComponent(world.id)}&lat=${lat.toFixed(5)}&lng=${lng.toFixed(5)}`)
      .then((r) => { if (live) setActors({ list: r.enabled ? r.actors : [], skew: r.now - Date.now() }); }, ignore);
    api<{ items: PlaceThread[] }>(`/places?lat=${lat}&lng=${lng}&radiusKm=3&sort=latest`)
      .then((r) => { if (live) setPlaces(r.items); }, ignore);
    api<{ messages: MapNote[] }>(`/messages?lat=${lat.toFixed(2)}&lng=${lng.toFixed(2)}&arena=${arena ? 1 : 0}`)
      .then((r) => { if (live) setNotes(r.messages); }, ignore);
    api<{ bounties: Bounty[] }>("/bounties")
      .then((r) => { if (live) setBounties(r.bounties); }, ignore);
    return () => { live = false; };
  }, [world.id, lat, lng, arena]);

  const community = useMemo<CommunityItem[]>(() => {
    const active = new Set(marketData?.active.map((t) => t.id));
    const items: CommunityItem[] = [];
    for (const t of marketData?.tasks || [])
      if (!active.has(t.id))
        items.push({ id: t.id, type: "task", title: t.title, detail: t.poster.name, distanceM: t.distanceM ?? distanceTo(position, t), reward: t.reward });
    for (const b of bounties) {
      const d = distanceTo(position, b);
      if (b.state === "open" && d <= COMMUNITY_TASK_M)
        items.push({ id: b.id, type: "bounty", title: b.title, detail: "", distanceM: d, reward: b.amount_u });
    }
    for (const s of marketData?.secrets || [])
      items.push({
        id: s.id, type: "secret", title: s.title, inside: s.inside, revealed: s.revealed,
        detail: s.kind === "sponsored" ? tr("Free · {0} GOLD for finding it", { 0: gold(s.visitReward) }) : s.price > 0 ? `${gold(s.price)} GOLD` : tr("Free"),
        distanceM: s.inside ? 0 : s.distanceM ?? distanceTo(position, s.fog),
        reward: s.kind === "sponsored" ? s.visitReward : 0,
      });
    for (const p of places)
      if (p.state === "live")
        items.push({ id: p.id, type: p.kind, title: short(p.kind === "topic" ? p.title || p.text : p.text), detail: p.author.name, distanceM: distanceTo(position, p), reward: 0 });
    for (const n of notes)
      items.push({ id: n.id, type: "note", title: short(n.text), detail: n.author, distanceM: distanceTo(position, n), reward: 0 });
    return items;
  }, [marketData, bounties, places, notes, position]);

  const zones = world.zones.filter((z) => z.closesAt > now);
  const zoneById = new Map(zones.map((z) => [z.id, z]));
  const shown = new Map(
    zones.map((z) => [z.id, representativeZoneQuest(z, world.quests, { now, playerTier })]),
  );
  const actorSpots = actors.list.flatMap((actor) => {
    const p = actorPositionAt(actor.segments, Date.now() + actors.skew);
    if (!p) return [];
    const d = meters(position, p);
    // Hidden lurkers stay a surprise until the explorer is near.
    if (actor.revealRadiusM !== undefined && d > actor.revealRadiusM) return [];
    return [{ actor, distanceM: d }];
  });

  const entries: NearbyEntry[] = [];
  for (const z of zones) {
    const qs = world.quests.filter((q) => q.zone_id === z.id && openQuest(q, now));
    entries.push({
      key: `zone:${z.id}`, kind: "zone", ref: z.id, distanceM: meters(position, z),
      xp: Math.max(0, ...qs.map((q) => q.xp)),
      reward: Math.max(0, ...qs.map((q) => (q.claimant ? 0 : q.gold_u || 0))),
      locked: z.tier > playerTier || z.opensAt > now,
    });
  }
  for (const q of world.quests) {
    const z = q.zone_id ? zoneById.get(q.zone_id) : undefined;
    if (!z || !openQuest(q, now)) continue;
    entries.push({
      key: `quest:${q.id}`, kind: "quest", ref: q.id, distanceM: distanceTo(position, q.nextPoint || q),
      xp: q.xp, reward: q.claimant ? 0 : q.gold_u || 0, locked: q.tier > playerTier,
      shownByZone: shown.get(z.id)?.id === q.id,
    });
  }
  for (const { actor, distanceM } of actorSpots)
    entries.push({ key: `npc:${actor.id}`, kind: "npc", ref: actor.id, distanceM, xp: 0, reward: 0, locked: actor.state === "defeated" || actor.state === "cooldown" });
  for (const c of community)
    entries.push({ key: `community:${c.type}:${c.id}`, kind: "community", ref: `${c.type}:${c.id}`, distanceM: c.distanceM, xp: 0, reward: c.reward });

  const counts = nearbyCounts(entries);
  const rows = nearbyRows(entries, filter, sort);
  const questById = new Map(world.quests.map((q) => [q.id, q]));
  const actorById = new Map(actorSpots.map((a) => [a.actor.id, a]));
  const communityByRef = new Map(community.map((c) => [`${c.type}:${c.id}`, c]));
  const openMarket = (kind: "task" | "secret", id: string) => {
    const hash = `${kind}=${encodeURIComponent(id)}`;
    // The same row twice: the hash does not change, so announce it again.
    if (location.hash === `#${hash}`) dispatchEvent(new HashChangeEvent("hashchange"));
    else location.hash = hash;
  };

  function row(e: NearbyEntry) {
    if (e.kind === "zone") {
      const z = zoneById.get(e.ref)!;
      const q = shown.get(z.id);
      const art = q ? questObjectPresentation(q, { now, playerTier }) : null;
      return (
        <button className="zone-card zone-row" data-zone-id={z.id} key={e.key} onClick={() => onZone(z)}>
          <span className={`zone-row-art art-${z.kind}`} aria-hidden="true">
            <QuestThumbnail quest={q} now={now} playerTier={playerTier} size={40} />
          </span>
          <span className="zone-row-body">
            <strong>{z.name}</strong>
            <small>
              <Badge tone={z.tier === 1 ? "green" : "purple"}>{z.tier === 1 ? tr("FREE") : tr("TIER {0}", { 0: z.tier })}</Badge>
              <span>{distanceLabel(e.distanceM)}</span>
              {z.opensAt > now ? (
                <span>{tr("Opens in")}{" "}{remaining(z.opensAt)}</span>
              ) : (
                <span>
                  {!q ? tr("See what's here") : q.completed ? tr("Completed") : art?.state === "locked" ? art.label
                    : q.kind === "chest" && q.itemAvailable === true ? tr("Aura chest") : activityLabel(q)}
                </span>
              )}
              <Reward xp={e.xp} gold={e.reward} />
            </small>
          </span>
          <ArrowRight size={18} aria-hidden="true" />
        </button>
      );
    }
    if (e.kind === "quest") {
      const q = questById.get(e.ref)!;
      const z = zoneById.get(q.zone_id!)!;
      return (
        <button className="nearby-row" data-kind="quest" key={e.key} onClick={() => onZone(z, q.id)}>
          <span className="zone-row-art" aria-hidden="true">
            <QuestThumbnail quest={q} now={now} playerTier={playerTier} size={40} />
          </span>
          <span className="zone-row-body">
            <strong>{questDisplayTitle(q.title)}</strong>
            <small>
              <span className="nearby-place-name">{z.name}</span>
              <span>{distanceLabel(e.distanceM)}</span>
              {e.locked ? <span><LockKey size={12} aria-hidden="true" />{tr("TIER {0}", { 0: q.tier })}</span> : <Reward xp={e.xp} gold={e.reward} />}
            </small>
          </span>
          <ArrowRight size={18} aria-hidden="true" />
        </button>
      );
    }
    if (e.kind === "npc") {
      const { actor } = actorById.get(e.ref)!;
      return (
        <button className="nearby-row" data-kind="npc" key={e.key} onClick={() => onActor(actor, e.distanceM)}>
          <span className="zone-row-art nearby-portrait" aria-hidden="true">
            <ActorPortrait model={actor.model} label="" />
          </span>
          <span className="zone-row-body">
            <strong>{actor.name}</strong>
            <small>
              <span>{actor.title || (actor.kind === "monster" ? tr("Monster") : tr("NPC"))}</span>
              <span>{distanceLabel(e.distanceM)}</span>
              {e.locked && <span>{tr("Resting")}</span>}
            </small>
          </span>
          <ArrowRight size={18} aria-hidden="true" />
        </button>
      );
    }
    const c = communityByRef.get(e.ref)!;
    const open =
      c.type === "task" ? () => openMarket("task", c.id)
        : c.type === "secret" ? () => openMarket("secret", c.id)
          : c.type === "bounty" ? onCommunityTasks
            : c.type === "note" ? onNotes
              : () => onPlace(c.id);
    const Icon = c.type === "task" || c.type === "bounty" ? Flag : c.type === "topic" ? ChatsCircle : c.type === "shout" ? Megaphone : NotePencil;
    return (
      <button className="nearby-row" data-kind={c.type} key={e.key} onClick={open}>
        {c.type === "secret" ? (
          <span className={`secret-fog${c.inside ? " inside" : ""}`} aria-hidden="true">
            {c.revealed ? <Eye size={22} /> : <Question size={22} weight="bold" />}
          </span>
        ) : (
          <span className={`zone-row-art nearby-icon nearby-icon-${c.type}`} aria-hidden="true"><Icon size={22} /></span>
        )}
        <span className="zone-row-body">
          <strong>{c.title}</strong>
          <small>
            <span>{COMMUNITY_LABEL[c.type]()}</span>
            <span>{c.type === "secret" && c.inside ? tr("You are inside the fog") : distanceLabel(c.distanceM)}</span>
            {c.type === "secret" ? <span>{c.detail}</span> : c.reward > 0 ? <Reward xp={0} gold={c.reward} /> : c.detail && <span>{c.detail}</span>}
          </small>
        </span>
        <ArrowRight size={18} aria-hidden="true" />
      </button>
    );
  }

  return (
    <div className="nearby-list">
      <div className="nearby-filters">
        <div className="nearby-chips" role="group" aria-label={tr("Show")}>
          {NEARBY_FILTERS.map((f) => (
            <button key={f} type="button" aria-pressed={filter === f} onClick={() => onFilter(f)}>
              {FILTER_LABEL[f]()}
              <span className="nearby-chip-count">{counts[f]}</span>
            </button>
          ))}
        </div>
        <label className="nearby-sort">
          <span className="sr-only">{tr("Sort")}</span>
          <select className="nearby-sort-select" value={sort} onChange={(ev) => setSort(nearbySortOf(ev.target.value))}>
            {(["distance", "xp", "reward"] as const).map((s) => (
              <option key={s} value={s}>{SORT_LABEL[s]()}</option>
            ))}
          </select>
          <CaretDown size={14} weight="bold" aria-hidden="true" />
        </label>
      </div>
      {filter === "community" && (
        <div className="nearby-create">
          <button type="button" className="nearby-add" onClick={() => setForm("task")}>
            <Plus size={16} weight="bold" aria-hidden="true" /> {tr("Post a task")}
          </button>
          <button type="button" className="nearby-add" onClick={() => setForm("secret")}>
            <LockKey size={16} weight="bold" aria-hidden="true" /> {tr("Hide a Secret")}
          </button>
          <button type="button" className="nearby-add" onClick={() => setForm("send")}>
            <HandCoins size={16} weight="bold" aria-hidden="true" /> {tr("Send on a condition")}
          </button>
          <InfoTip label={tr("Tasks nearby")}>
            {tr("Real QGOLD from your account, held by the escrow contract until the task is done. Posting a task adds a 10 % fee on top; sends are free.")}
          </InfoTip>
        </div>
      )}
      {rows.length === 0 ? (
        <EmptyState art="place" title={tr("Nothing of this kind near you right now")} status>
          {filter === "community"
            ? tr("Post a task, hide a Secret or leave a note, and it shows up here for explorers nearby.")
            : tr("Walk a little or check back later: places, NPCs and community posts change during the day.")}
        </EmptyState>
      ) : (
        <div className="zone-list nearby-rows">{rows.slice(0, limit).map(row)}</div>
      )}
      {rows.length > limit && (
        <button type="button" className="subtle-link nearby-more" onClick={() => setLimit((n) => n + PAGE)}>
          {tr("Show more")}{" "}<span className="nearby-chip-count">{rows.length - limit}</span>
        </button>
      )}
      {filter === "community" && (
        <button type="button" className="subtle-link" onClick={onCommunityTasks}>
          {tr("All community tasks")}{" "}<ArrowRight size={15} />
        </button>
      )}
      <NearbyMarket
        {...market}
        position={position}
        listed={filter === "community"}
        onData={setMarketData}
        openForm={form}
        onFormOpened={() => setForm("")}
      />
    </div>
  );
}

function Reward({ xp, gold: amount }: { xp: number; gold: number }) {
  if (amount > 0) return <span><CoinIcon />{gold(amount)}</span>;
  if (xp > 0) return <span><Sparkle size={12} aria-hidden="true" />{xp} XP</span>;
  return null;
}
