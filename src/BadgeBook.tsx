import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Medal,
} from "@phosphor-icons/react";
import { ArrowRight } from "./dir-icons";
import { api } from "./api";
import { Dialog } from "./Dialog";
import type { Fix } from "./types";
import "./badges.css";
import { tr } from "./i18n";

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
  { id: "all", get label() { return tr("All"); } },
  { id: "peak", get label() { return tr("Peaks"); } },
  { id: "viewpoint", get label() { return tr("Viewpoints"); } },
  { id: "landmark", get label() { return tr("Landmarks"); } },
  { id: "city", get label() { return tr("Cities"); } },
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
          <b>{tr("Badges")}</b>
          <small>
            {tr("{0} of {1} places", { 0: places.earned, 1: places.total })}
            {data.user?.held.length ? tr(" · {0} player badges", { 0: data.user.held.length }) : ""}
          </small>
        </span>
        <ArrowRight size={20} />
      </button>
      {open && (
        <Dialog label={tr("Badges")} onClose={() => setOpen(false)}>
          <section className="badge-book">
            <h2>{tr("Badges")}</h2>
            <div className="badge-tabs" role="tablist" aria-label={tr("Badge kind")}>
              <button role="tab" aria-selected={view === "places"} onClick={() => setView("places")}>
                {tr("Places")}{" "}{places.earned}/{places.total}
              </button>
              <button role="tab" aria-selected={view === "player"} onClick={() => setView("player")}>
                {tr("Player badges")}</button>
            </div>
            {view === "places" ? (
              <>
                <p className="badge-lead">
                  {tr("Reach a peak, a viewpoint, a landmark or a bigger city with GPS on and its badge is yours for good. Badges are decorations: they cannot be sold or traded.")}</p>
                {places.next.length > 0 && (
                  <div className="badge-next">
                    <b>{tr("Nearest new badges")}</b>
                    <ul>
                      {places.next.slice(0, 3).map((n) => {
                        const b = byId.get(n.id);
                        if (!b) return null;
                        return (
                          <li key={n.id}>
                            <button onClick={() => setDetail(b)}>
                              <span aria-hidden="true">{b.icon}</span> {b.nameCs}
                              <small>{n.toEdgeM === 0 ? tr("You are here") : km(n.toEdgeM)}</small>
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                )}
                {arena && <p className="fine-print">{tr("Badges need real GPS. Turn on your location on the map to collect them.")}</p>}
                <div className="badge-filter" role="group" aria-label={tr("Filter")}>
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
                        aria-label={b.earnedAt ? tr("{0}, earned", { 0: b.nameCs }) : tr("{0}, not yet", { 0: b.nameCs })}
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
              {tr("Close")}</button>
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
                ? tr("Earned {0}.", { 0: date(detail.earnedAt) })
                : tr("Get within {0} of it with GPS on to earn it.", { 0: km(detail.radiusM) })}
            </p>
            <a
              className="secondary-button"
              href={`https://www.openstreetmap.org/?mlat=${detail.lat}&mlon=${detail.lng}#map=15/${detail.lat}/${detail.lng}`}
              target="_blank"
              rel="noreferrer"
            >
              {tr("Show on map")}</a>
            <button className="primary-button" onClick={() => setDetail(null)}>
              {tr("Close")}</button>
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
  if (b.holding.state === "minted") return tr("On NEAR");
  if (b.holding.state === "failed") return tr("Could not mint");
  return b.onChain ? tr("Minting on NEAR…") : tr("Waiting for the design to reach NEAR…");
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
      setMessage(e instanceof Error ? e.message : tr("Something went wrong."));
    } finally {
      setBusy("");
    }
  };
  const claim = (b: UserBadge) =>
    run(
      `claim:${b.id}`,
      () => api("/badges/user/claim", { badgeId: b.id, fix: gps ?? undefined, code: codes[b.id] }),
      tr("{0} is yours. It is being minted on NEAR.", { 0: b.title }),
    );
  if (!u.enabled) return <p className="badge-lead">{tr("Player badges are not open on this server yet.")}</p>;
  const claimable = (b: UserBadge) => !b.holding || b.holding.state === "failed";
  const card = (b: UserBadge, showClaim: boolean) => (
    <li key={b.id} className="user-badge">
      <UserMedal b={b} />
      <span>
        <b>{b.title}</b>
        <small>
          {b.kind === "place" ? tr("Place") : b.kind === "event" ? tr("Event") : tr("Quest")} · {tr("{0}/{1} given", { 0: b.claimed, 1: b.maxSupply })}
          {b.distanceM !== undefined ? ` · ${km(b.distanceM)}` : ""}
          {b.holding ? ` · ${holdingLabel(b)}` : ""}
          {b.mine ? ` · ${b.onChain ? tr("design on NEAR") : b.state === "failed" ? tr("design failed") : tr("design queued")}` : ""}
        </small>
        {b.description && <small className="user-badge-desc">{b.description}</small>}
        {b.mine && b.code && (
          <small className="user-badge-code">
            {tr("Event code:")}{" "}<code>{b.code}</code> {" "}{tr("· share it with the people who come")}</small>
        )}
        {showClaim && claimable(b) && (
          <span className="user-badge-claim">
            {b.needsCode && (
              <input
                aria-label={tr("Event code")}
                placeholder={tr("Event code")}
                value={codes[b.id] || ""}
                onChange={(e) => setCodes({ ...codes, [b.id]: e.target.value })}
              />
            )}
            <button className="primary-button" disabled={!!busy || (!!b.place && !gps)} onClick={() => void claim(b)}>
              {b.place && !gps ? tr("Needs GPS here") : tr("Claim")}
            </button>
          </span>
        )}
      </span>
    </li>
  );
  return (
    <div className="player-badges">
      <p className="badge-lead">
        {tr("Badges explorers make for a place, an event or their own quest. Each one is a soulbound token on NEAR: proof you were there, never for sale.")}{u.contractId ? tr(" Contract {0}.", { 0: u.contractId }) : tr(" The badge contract is being deployed; claims wait in line until then.")}
      </p>
      {!u.account && (
        <p className="badge-warn">
          {tr("Link a NEAR account to create or collect player badges.")}{" "}
          {onConnectNear && (
            <button onClick={onConnectNear}>
              {tr("Link NEAR")}</button>
          )}
        </p>
      )}
      {message && <p className="badge-message" role="status">{message}</p>}
      {u.nearby.length > 0 && (
        <>
          <h3>{tr("Near you")}</h3>
          <ul className="user-badges">{u.nearby.map((b) => card(b, true))}</ul>
        </>
      )}
      <h3>{tr("Have a badge id?")}</h3>
      <form
        className="badge-lookup"
        onSubmit={(e) => {
          e.preventDefault();
          setMessage("");
          api<UserBadge>(`/badges/user/${encodeURIComponent(lookup.trim().toLowerCase())}`)
            .then(setFound)
            .catch((err) => {
              setFound(null);
              setMessage(err instanceof Error ? err.message : tr("Not found."));
            });
        }}
      >
        <input aria-label={tr("Badge id")} placeholder={tr("e.g. demo-night-3f2a1b")} value={lookup} onChange={(e) => setLookup(e.target.value)} />
        <button className="secondary-button" disabled={lookup.trim().length < 3}>
          {tr("Find")}</button>
      </form>
      {found && <ul className="user-badges">{card(found, true)}</ul>}
      <h3>{tr("Collected")}</h3>
      {u.held.length ? <ul className="user-badges">{u.held.map((b) => card(b, false))}</ul> : <p className="fine-print">{tr("None yet.")}</p>}
      <h3>{tr("Made by you")}</h3>
      {u.created.length ? (
        <ul className="user-badges">{u.created.map((b) => card(b, false))}</ul>
      ) : (
        <p className="fine-print">{tr("Make a badge for your favourite spot, a meetup or your community quest.")}</p>
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
                tr("Badge created. Its design goes on NEAR in a moment; share its id so others can find it."),
              )
            }
          />
        ) : (
          <button className="secondary-button" onClick={() => setCreating(true)}>
            {tr("Create a badge")}</button>
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
      <h3>{tr("New badge")}</h3>
      <div className="badge-preview">
        <span className="badge-medal-face user big" style={{ background: color }} aria-hidden="true">
          {icon}
        </span>
        <b>{title || tr("Your badge")}</b>
      </div>
      <label>
        {tr("Title")}<input value={title} maxLength={48} required minLength={3} onChange={(e) => setTitle(e.target.value)} />
      </label>
      <label>
        {tr("Description")}<textarea value={description} maxLength={280} rows={2} onChange={(e) => setDescription(e.target.value)} />
      </label>
      <fieldset className="badge-icons">
        <legend>{tr("Icon")}</legend>
        {u.icons.map((i) => (
          <button type="button" key={i} aria-pressed={icon === i} onClick={() => setIcon(i)}>
            {i}
          </button>
        ))}
      </fieldset>
      <fieldset className="badge-colors">
        <legend>{tr("Colour")}</legend>
        {u.colors.map((c) => (
          <button type="button" key={c} aria-label={c} aria-pressed={color === c} style={{ background: c }} onClick={() => setColor(c)} />
        ))}
      </fieldset>
      <label>
        {tr("For")}<select value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
          <option value="place">{tr("Visiting this place (where you stand now)")}</option>
          <option value="event">{tr("An event (people enter a code)")}</option>
          <option value="quest">{tr("Finishing my community quest")}</option>
        </select>
      </label>
      {kind !== "quest" && (
        <label>
          {tr("Radius")}{" "}{kind === "event" ? tr("(optional, only with GPS on)") : ""}: {radius} m
          <input type="range" min={30} max={2000} step={10} value={radius} onChange={(e) => setRadius(Number(e.target.value))} />
        </label>
      )}
      {kind === "event" && (
        <label>
          {tr("Event code (leave empty for a random one)")}<input value={code} maxLength={32} onChange={(e) => setCode(e.target.value)} />
        </label>
      )}
      {kind === "quest" && (
        <label>
          {tr("Community quest id")}<input value={questRef} required onChange={(e) => setQuestRef(e.target.value)} placeholder="cq_…" />
        </label>
      )}
      <label>
        {tr("How many (1–")}{u.limits.maxSupply})
        <input type="number" min={1} max={u.limits.maxSupply} value={supply} onChange={(e) => setSupply(Number(e.target.value))} />
      </label>
      <label>
        {tr("Ends after (days, 0 = no end)")}<input type="number" min={0} max={365} value={days} onChange={(e) => setDays(Number(e.target.value))} />
      </label>
      {needsGps && !gps && <p className="badge-warn">{tr("Turn on GPS on the map: a place badge is made where you stand.")}</p>}
      <p className="fine-print">
        {tr("The game pays the NEAR storage on the test network. Up to")}{" "}{u.limits.maxActive} {" "}{tr("badges at a time,")}{" "}{u.limits.maxPerDay} {" "}{tr("a day.")}</p>
      <div className="badge-create-actions">
        <button type="button" className="secondary-button" onClick={onCancel}>
          {tr("Cancel")}</button>
        <button className="primary-button" disabled={busy || title.trim().length < 3 || (needsGps && !gps)}>
          {tr("Create")}</button>
      </div>
    </form>
  );
}
