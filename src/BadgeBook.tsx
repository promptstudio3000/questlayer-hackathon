import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowRight, Medal } from "@phosphor-icons/react";
import { api } from "./api";
import { Dialog } from "./Dialog";
import type { Fix } from "./types";
import "./badges.css";

// Badge book (docs/BADGES.md). Place badges: one per notable place, earned by
// reaching it with GPS; cosmetic, never sellable. Player badges: POAP-like
// designs on NEAR that explorers create for a place, an event or their quest.
type Kind = "peak" | "viewpoint" | "landmark" | "city";
type PlaceBadge = {
  id: string;
  name: string;
  nameCs: string;
  kind: Kind;
  rarity: string;
  icon: string;
  region: string;
  country: string;
  elevationM: number | null;
  note: string;
  radiusM: number;
  lat: number;
  lng: number;
  earnedAt: number | null;
};
type UserBadge = {
  id: string;
  title: string;
  description: string;
  icon: string;
  color: string;
  kind: "place" | "event" | "quest";
  place: { lat: number; lng: number; radiusM: number } | null;
  needsCode: boolean;
  code?: string;
  creatorAccount: string;
  mine: boolean;
  maxSupply: number;
  claimed: number;
  endsAt: number | null;
  state: "queued" | "live" | "hidden" | "failed";
  onChain: boolean;
  holding: { state: "queued" | "minted" | "failed"; tokenId: string | null; tx: string | null } | null;
  distanceM?: number;
};
type Overview = {
  enabled: boolean;
  places?: {
    total: number;
    earned: number;
    byKind: Record<Kind, { earned: number; total: number }>;
    badges: PlaceBadge[];
    next: { id: string; distanceM: number; toEdgeM: number }[];
  };
  user?: {
    enabled: boolean;
    contractId: string | null;
    minting: boolean;
    account: string | null;
    limits: { maxActive: number; maxPerDay: number; maxSupply: number };
    icons: string[];
    colors: string[];
    created: UserBadge[];
    held: UserBadge[];
    nearby: UserBadge[];
  };
};
const KINDS: { id: Kind | "all"; label: string }[] = [
  { id: "all", label: "All" },
  { id: "peak", label: "Peaks" },
  { id: "viewpoint", label: "Viewpoints" },
  { id: "landmark", label: "Landmarks" },
  { id: "city", label: "Cities" },
];
export const BADGES_CHANGED = "questlayer:badges";

function km(m: number) {
  return m < 1000 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toFixed(m < 10_000 ? 1 : 0)} km`;
}
const date = (t: number) => new Date(t).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
const freshFix = (fix: Fix | null) => (fix && Date.now() - fix.timestamp < 15_000 ? fix : null);

export function BadgeBook({ fix, arena, onConnectNear }: { fix: Fix | null; arena: boolean; onConnectNear?: () => void }) {
  const [data, setData] = useState<Overview | null>(null);
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<"places" | "player">("places");
  const [kind, setKind] = useState<Kind | "all">("all");
  const [detail, setDetail] = useState<PlaceBadge | null>(null);
  const gps = arena ? null : fix;
  const at = gps ? `?lat=${gps.lat.toFixed(5)}&lng=${gps.lng.toFixed(5)}` : "";
  const load = useCallback(async () => {
    try {
      setData(await api<Overview>(`/badges${at}`));
    } catch {
      /* The entry just keeps its last state. */
    }
  }, [at]);
  useEffect(() => {
    void load();
    const again = () => void load();
    window.addEventListener(BADGES_CHANGED, again);
    return () => window.removeEventListener(BADGES_CHANGED, again);
    // Reload on open and when the badge events fire, not on every GPS tick.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const places = data?.places;
  const shown = useMemo(
    () => (places ? places.badges.filter((b) => kind === "all" || b.kind === kind) : []),
    [places, kind],
  );
  if (!data?.enabled || !places) return null;
  const byId = new Map(places.badges.map((b) => [b.id, b]));
  return (
    <>
      <button className="play-entry" onClick={() => setOpen(true)}>
        <Medal size={24} />
        <span>
          <b>Badges</b>
          <small>
            {places.earned} of {places.total} places
            {data.user?.held.length ? ` · ${data.user.held.length} player badges` : ""}
          </small>
        </span>
        <ArrowRight size={20} />
      </button>
      {open && (
        <Dialog label="Badges" onClose={() => setOpen(false)}>
          <section className="badge-book">
            <h2>Badges</h2>
            <div className="badge-tabs" role="tablist" aria-label="Badge kind">
              <button role="tab" aria-selected={view === "places"} onClick={() => setView("places")}>
                Places {places.earned}/{places.total}
              </button>
              <button role="tab" aria-selected={view === "player"} onClick={() => setView("player")}>
                Player badges
              </button>
            </div>
            {view === "places" ? (
              <>
                <p className="badge-lead">
                  Reach a peak, a viewpoint, a landmark or a bigger city with GPS on and its badge is yours for good.
                  Badges are decorations: they cannot be sold or traded.
                </p>
                {places.next.length > 0 && (
                  <div className="badge-next">
                    <b>Nearest new badges</b>
                    <ul>
                      {places.next.slice(0, 3).map((n) => {
                        const b = byId.get(n.id);
                        if (!b) return null;
                        return (
                          <li key={n.id}>
                            <button onClick={() => setDetail(b)}>
                              <span aria-hidden="true">{b.icon}</span> {b.nameCs}
                              <small>{n.toEdgeM === 0 ? "You are here" : km(n.toEdgeM)}</small>
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                )}
                {arena && <p className="fine-print">Badges need real GPS. Turn on your location on the map to collect them.</p>}
                <div className="badge-filter" role="group" aria-label="Filter">
                  {KINDS.map((k) => (
                    <button key={k.id} aria-pressed={kind === k.id} onClick={() => setKind(k.id)}>
                      {k.label}
                      {k.id !== "all" && (
                        <small>
                          {places.byKind[k.id].earned}/{places.byKind[k.id].total}
                        </small>
                      )}
                    </button>
                  ))}
                </div>
                <ul className="badge-grid">
                  {shown.map((b) => (
                    <li key={b.id}>
                      <button
                        className={`badge-medal rarity-${b.rarity}${b.earnedAt ? " is-earned" : ""}`}
                        onClick={() => setDetail(b)}
                        aria-label={`${b.nameCs}${b.earnedAt ? ", earned" : ", not yet"}`}
                      >
                        <span className="badge-medal-face" aria-hidden="true">
                          {b.icon}
                        </span>
                        <span className="badge-medal-name">{b.nameCs}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <PlayerBadges data={data} gps={freshFix(gps)} reload={load} onConnectNear={onConnectNear} />
            )}
            <button className="secondary-button" onClick={() => setOpen(false)}>
              Close
            </button>
          </section>
        </Dialog>
      )}
      {detail && (
        <Dialog label={detail.nameCs} onClose={() => setDetail(null)}>
          <section className={`badge-detail rarity-${detail.rarity}`}>
            <span className={`badge-medal-face big${detail.earnedAt ? "" : " is-locked"}`} aria-hidden="true">
              {detail.icon}
            </span>
            <h2>{detail.nameCs}</h2>
            {detail.nameCs !== detail.name && <p className="badge-sub">{detail.name}</p>}
            <p className="badge-sub">
              {[detail.region, detail.country, detail.elevationM ? `${detail.elevationM} m` : ""].filter(Boolean).join(" · ")}
            </p>
            {detail.note && <p>{detail.note}</p>}
            <p className={`badge-rarity rarity-${detail.rarity}`}>{detail.rarity}</p>
            <p>
              {detail.earnedAt
                ? `Earned ${date(detail.earnedAt)}.`
                : `Get within ${km(detail.radiusM)} of it with GPS on to earn it.`}
            </p>
            <a
              className="secondary-button"
              href={`https://www.openstreetmap.org/?mlat=${detail.lat}&mlon=${detail.lng}#map=15/${detail.lat}/${detail.lng}`}
              target="_blank"
              rel="noreferrer"
            >
              Show on map
            </a>
            <button className="primary-button" onClick={() => setDetail(null)}>
              Close
            </button>
          </section>
        </Dialog>
      )}
    </>
  );
}

function UserMedal({ b }: { b: UserBadge }) {
  return (
    <span className="badge-medal-face user" style={{ background: b.color }} aria-hidden="true">
      {b.icon}
    </span>
  );
}
function holdingLabel(b: UserBadge) {
  if (!b.holding) return "";
  if (b.holding.state === "minted") return "On NEAR";
  if (b.holding.state === "failed") return "Could not mint";
  return b.onChain ? "Minting on NEAR…" : "Waiting for the design to reach NEAR…";
}

function PlayerBadges({
  data,
  gps,
  reload,
  onConnectNear,
}: {
  data: Overview;
  gps: Fix | null;
  reload: () => Promise<void>;
  onConnectNear?: () => void;
}) {
  const u = data.user!;
  const [creating, setCreating] = useState(false);
  const [codes, setCodes] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [lookup, setLookup] = useState("");
  const [found, setFound] = useState<UserBadge | null>(null);
  const run = async (key: string, fn: () => Promise<unknown>, ok: string) => {
    setBusy(key);
    setMessage("");
    try {
      await fn();
      setMessage(ok);
      await reload();
      window.dispatchEvent(new Event(BADGES_CHANGED));
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setBusy("");
    }
  };
  const claim = (b: UserBadge) =>
    run(
      `claim:${b.id}`,
      () => api("/badges/user/claim", { badgeId: b.id, fix: gps ?? undefined, code: codes[b.id] }),
      `${b.title} is yours. It is being minted on NEAR.`,
    );
  if (!u.enabled) return <p className="badge-lead">Player badges are not open on this server yet.</p>;
  const claimable = (b: UserBadge) => !b.holding || b.holding.state === "failed";
  const card = (b: UserBadge, showClaim: boolean) => (
    <li key={b.id} className="user-badge">
      <UserMedal b={b} />
      <span>
        <b>{b.title}</b>
        <small>
          {b.kind === "place" ? "Place" : b.kind === "event" ? "Event" : "Quest"} · {b.claimed}/{b.maxSupply} given
          {b.distanceM !== undefined ? ` · ${km(b.distanceM)}` : ""}
          {b.holding ? ` · ${holdingLabel(b)}` : ""}
          {b.mine ? ` · ${b.onChain ? "design on NEAR" : b.state === "failed" ? "design failed" : "design queued"}` : ""}
        </small>
        {b.description && <small className="user-badge-desc">{b.description}</small>}
        {b.mine && b.code && (
          <small className="user-badge-code">
            Event code: <code>{b.code}</code> · share it with the people who come
          </small>
        )}
        {showClaim && claimable(b) && (
          <span className="user-badge-claim">
            {b.needsCode && (
              <input
                aria-label="Event code"
                placeholder="Event code"
                value={codes[b.id] || ""}
                onChange={(e) => setCodes({ ...codes, [b.id]: e.target.value })}
              />
            )}
            <button className="primary-button" disabled={!!busy || (!!b.place && !gps)} onClick={() => void claim(b)}>
              {b.place && !gps ? "Needs GPS here" : "Claim"}
            </button>
          </span>
        )}
      </span>
    </li>
  );
  return (
    <div className="player-badges">
      <p className="badge-lead">
        Badges explorers make for a place, an event or their own quest. Each one is a soulbound token on NEAR: proof
        you were there, never for sale.
        {u.contractId ? ` Contract ${u.contractId}.` : " The badge contract is being deployed; claims wait in line until then."}
      </p>
      {!u.account && (
        <p className="badge-warn">
          Link a NEAR account to create or collect player badges.{" "}
          {onConnectNear && (
            <button onClick={onConnectNear}>
              Link NEAR
            </button>
          )}
        </p>
      )}
      {message && <p className="badge-message" role="status">{message}</p>}
      {u.nearby.length > 0 && (
        <>
          <h3>Near you</h3>
          <ul className="user-badges">{u.nearby.map((b) => card(b, true))}</ul>
        </>
      )}
      <h3>Have a badge id?</h3>
      <form
        className="badge-lookup"
        onSubmit={(e) => {
          e.preventDefault();
          setMessage("");
          api<UserBadge>(`/badges/user/${encodeURIComponent(lookup.trim().toLowerCase())}`)
            .then(setFound)
            .catch((err) => {
              setFound(null);
              setMessage(err instanceof Error ? err.message : "Not found.");
            });
        }}
      >
        <input aria-label="Badge id" placeholder="e.g. demo-night-3f2a1b" value={lookup} onChange={(e) => setLookup(e.target.value)} />
        <button className="secondary-button" disabled={lookup.trim().length < 3}>
          Find
        </button>
      </form>
      {found && <ul className="user-badges">{card(found, true)}</ul>}
      <h3>Collected</h3>
      {u.held.length ? <ul className="user-badges">{u.held.map((b) => card(b, false))}</ul> : <p className="fine-print">None yet.</p>}
      <h3>Made by you</h3>
      {u.created.length ? (
        <ul className="user-badges">{u.created.map((b) => card(b, false))}</ul>
      ) : (
        <p className="fine-print">Make a badge for your favourite spot, a meetup or your community quest.</p>
      )}
      {u.account &&
        (creating ? (
          <CreateBadge
            u={u}
            gps={gps}
            busy={busy === "create"}
            onCancel={() => setCreating(false)}
            onCreate={(input) =>
              run(
                "create",
                async () => {
                  const b = await api<UserBadge>("/badges/user", input);
                  setCreating(false);
                  setFound(b);
                },
                "Badge created. Its design goes on NEAR in a moment; share its id so others can find it.",
              )
            }
          />
        ) : (
          <button className="secondary-button" onClick={() => setCreating(true)}>
            Create a badge
          </button>
        ))}
    </div>
  );
}

function CreateBadge({
  u,
  gps,
  busy,
  onCancel,
  onCreate,
}: {
  u: NonNullable<Overview["user"]>;
  gps: Fix | null;
  busy: boolean;
  onCancel: () => void;
  onCreate: (input: Record<string, unknown>) => void;
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [icon, setIcon] = useState(u.icons[0]);
  const [color, setColor] = useState(u.colors[0]);
  const [kind, setKind] = useState<"place" | "event" | "quest">("place");
  const [radius, setRadius] = useState(100);
  const [supply, setSupply] = useState(50);
  const [code, setCode] = useState("");
  const [questRef, setQuestRef] = useState("");
  const [days, setDays] = useState(0);
  const needsGps = kind === "place";
  return (
    <form
      className="badge-create"
      onSubmit={(e) => {
        e.preventDefault();
        onCreate({
          title,
          description,
          icon,
          color,
          kind,
          maxSupply: supply,
          radiusM: radius,
          fix: kind !== "quest" ? (gps ?? undefined) : undefined,
          code: kind === "event" ? code : undefined,
          questRef: kind === "quest" ? `creator:${questRef.trim()}` : undefined,
          endsAt: days > 0 ? Date.now() + days * 86_400_000 : undefined,
        });
      }}
    >
      <h3>New badge</h3>
      <div className="badge-preview">
        <span className="badge-medal-face user big" style={{ background: color }} aria-hidden="true">
          {icon}
        </span>
        <b>{title || "Your badge"}</b>
      </div>
      <label>
        Title
        <input value={title} maxLength={48} required minLength={3} onChange={(e) => setTitle(e.target.value)} />
      </label>
      <label>
        Description
        <textarea value={description} maxLength={280} rows={2} onChange={(e) => setDescription(e.target.value)} />
      </label>
      <fieldset className="badge-icons">
        <legend>Icon</legend>
        {u.icons.map((i) => (
          <button type="button" key={i} aria-pressed={icon === i} onClick={() => setIcon(i)}>
            {i}
          </button>
        ))}
      </fieldset>
      <fieldset className="badge-colors">
        <legend>Colour</legend>
        {u.colors.map((c) => (
          <button type="button" key={c} aria-label={c} aria-pressed={color === c} style={{ background: c }} onClick={() => setColor(c)} />
        ))}
      </fieldset>
      <label>
        For
        <select value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
          <option value="place">Visiting this place (where you stand now)</option>
          <option value="event">An event (people enter a code)</option>
          <option value="quest">Finishing my community quest</option>
        </select>
      </label>
      {kind !== "quest" && (
        <label>
          Radius {kind === "event" ? "(optional, only with GPS on)" : ""}: {radius} m
          <input type="range" min={30} max={2000} step={10} value={radius} onChange={(e) => setRadius(Number(e.target.value))} />
        </label>
      )}
      {kind === "event" && (
        <label>
          Event code (leave empty for a random one)
          <input value={code} maxLength={32} onChange={(e) => setCode(e.target.value)} />
        </label>
      )}
      {kind === "quest" && (
        <label>
          Community quest id
          <input value={questRef} required onChange={(e) => setQuestRef(e.target.value)} placeholder="cq_…" />
        </label>
      )}
      <label>
        How many (1–{u.limits.maxSupply})
        <input type="number" min={1} max={u.limits.maxSupply} value={supply} onChange={(e) => setSupply(Number(e.target.value))} />
      </label>
      <label>
        Ends after (days, 0 = no end)
        <input type="number" min={0} max={365} value={days} onChange={(e) => setDays(Number(e.target.value))} />
      </label>
      {needsGps && !gps && <p className="badge-warn">Turn on GPS on the map: a place badge is made where you stand.</p>}
      <p className="fine-print">
        The game pays the NEAR storage on the test network. Up to {u.limits.maxActive} badges at a time, {u.limits.maxPerDay} a day.
      </p>
      <div className="badge-create-actions">
        <button type="button" className="secondary-button" onClick={onCancel}>
          Cancel
        </button>
        <button className="primary-button" disabled={busy || title.trim().length < 3 || (needsGps && !gps)}>
          Create
        </button>
      </div>
    </form>
  );
}
