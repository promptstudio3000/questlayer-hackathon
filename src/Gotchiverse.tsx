import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowUp,
  ArrowDown,
  ArrowRight,
  Hammer,
  PersonSimpleWalk,
  Plus,
  Minus,
  FloppyDisk,
  Users,
  Copy,
  X,
  ArrowClockwise,
} from "@phosphor-icons/react";
import { api, ApiError } from "./api";
import { Character } from "./Character";
import { Ghost } from "./Ghost";
import { EmptyState } from "./EmptyState";
import { tr } from "./i18n";
import { drawTerrain, hitCell } from "./gotchiverse-canvas";
import {
  changedCell,
  movePoint,
  terrainCell,
  type Workshop,
  type Edit,
} from "./gotchiverse-model";
import type { Item, Player } from "./types";
import { REALMS } from "./realms";
import { wearableStarterMarkup } from "./character-art";
import "./gotchiverse.css";

type View = {
  workshopId: string;
  position: [number, number];
  selection: [number, number];
};
const materials = [
  { id: "grass", label: () => tr("Grass") },
  { id: "stone", label: () => tr("Stone") },
  { id: "sand", label: () => tr("Sand") },
  { id: "water", label: () => tr("Water") },
];
const INVITE = /^#gotchi-invite=(w_[a-f0-9]{32}\.[a-f0-9]{48})$/;
function savedView(key: string): View | null {
  try {
    const v = JSON.parse(sessionStorage.getItem(key) || "null");
    const point = (p: unknown): p is [number, number] =>
      Array.isArray(p) &&
      p.length === 2 &&
      p.every((n) => Number.isInteger(n) && n >= 0 && n < 16);
    return v &&
      /^w_[a-f0-9]{32}$/.test(v.workshopId) &&
      point(v.position) &&
      point(v.selection)
      ? v
      : null;
  } catch {
    return null;
  }
}
function pendingEdit(key: string): Edit | null {
  try {
    const v = JSON.parse(sessionStorage.getItem(key) || "null");
    return v &&
      /^w_[a-f0-9]{32}$/.test(v.workshopId) &&
      Number.isInteger(v.revision) &&
      v.revision >= 0 &&
      typeof v.requestId === "string" &&
      /^[a-zA-Z0-9_-]{16,80}$/.test(v.requestId) &&
      [v.x, v.z].every((n) => Number.isInteger(n) && n >= 0 && n < 16) &&
      v.cell &&
      Number.isInteger(v.cell.height) &&
      v.cell.height >= 0 &&
      v.cell.height <= 5 &&
      ["grass", "stone", "sand", "water"].includes(v.cell.material) &&
      [null, "lantern"].includes(v.cell.object)
      ? v
      : null;
  } catch {
    return null;
  }
}

export function Gotchiverse({
  player,
  items,
  onExit,
}: {
  player: Player;
  items: Item[];
  onExit: () => void;
}) {
  const viewKey = `questlayer.gotchiverse.view:${player.id}`,
    pendingKey = `questlayer.gotchiverse.pending:${player.id}`;
  const initial = useRef(savedView(viewKey));
  const [workshop, setWorkshop] = useState<Workshop | null>(null),
    [loading, setLoading] = useState(true),
    [saving, setSaving] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  const [position, setPosition] = useState<[number, number]>(
      initial.current?.position ?? [8, 8],
    ),
    [selection, setSelection] = useState<[number, number]>(
      initial.current?.selection ?? [7, 7],
    ),
    [building, setBuilding] = useState(true);
  const [pending, setPending] = useState<Edit | null>(() =>
      pendingEdit(pendingKey),
    ),
    [invite, setInvite] = useState(""),
    [friendsOpen, setFriendsOpen] = useState(false),
    [attempt, setAttempt] = useState(0),
    [storageBlocked, setStorageBlocked] = useState(false);
  const canvas = useRef<HTMLCanvasElement>(null),
    stage = useRef<HTMLDivElement>(null),
    drawing = useRef<ReturnType<typeof drawTerrain>>(null),
    [avatar, setAvatar] = useState({ left: 0, top: 0 });
  const alive = useRef(true),
    latest = useRef({ workshop, saving, pending, position });
  latest.current = { workshop, saving, pending, position };
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const rememberPending = (next: Edit | null) => {
    setPending(next);
    try {
      if (next) sessionStorage.setItem(pendingKey, JSON.stringify(next));
      else sessionStorage.removeItem(pendingKey);
    } catch {
      setStorageBlocked(true);
    }
  };
  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    setLoading(true);
    setError("");
    setInvite("");
    const token = location.hash.match(INVITE)?.[1];
    const path = token
      ? "/gotchiverse/join"
      : initial.current?.workshopId
        ? `/gotchiverse/workshop?id=${initial.current.workshopId}`
        : "/gotchiverse/open";
    void api<{ workshop: Workshop }>(
      path,
      token ? { token } : initial.current?.workshopId ? undefined : {},
      { signal: controller.signal },
    )
      .then((result) => {
        if (!active) return;
        setWorkshop(result.workshop);
        if (token)
          history.replaceState(
            history.state,
            "",
            location.pathname + location.search,
          );
      })
      .catch((e) => {
        if (active) {
          if (e instanceof ApiError && [403, 404].includes(e.status))
            rememberPending(null);
          setWorkshop(null);
          setError(
            e instanceof ApiError && e.status === 403
              ? tr(
                  "Access to this workshop ended. Open your own workshop to keep building.",
                )
              : tr(
                  "Could not open Gotchiverse. Check your connection and try again.",
                ),
          );
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [player.id, attempt]);
  useEffect(() => {
    if (!workshop) return;
    try {
      sessionStorage.setItem(
        viewKey,
        JSON.stringify({ workshopId: workshop.id, position, selection }),
      );
    } catch {
      setStorageBlocked(true);
    }
  }, [workshop?.id, position, selection, viewKey]);
  useEffect(() => {
    if (!workshop) return;
    const refresh = () => {
      if (
        document.hidden ||
        latest.current.saving ||
        latest.current.pending ||
        !navigator.onLine
      )
        return;
      const current = latest.current.workshop;
      if (!current) return;
      void api<{ workshop: Workshop }>("/gotchiverse/visit", {
        workshopId: current.id,
        position: latest.current.position,
      })
        .then((r) => {
          if (
            alive.current &&
            latest.current.workshop?.id === current.id &&
            !latest.current.saving &&
            !latest.current.pending &&
            r.workshop.revision >= latest.current.workshop.revision
          )
            setWorkshop(r.workshop);
        })
        .catch((e) => {
          if (alive.current && e instanceof ApiError && e.status === 403) {
            setWorkshop(null);
            setError(
              tr(
                "Access to this workshop ended. Open your own workshop to keep building.",
              ),
            );
          }
        });
    };
    refresh();
    const timer = window.setInterval(refresh, 4000);
    window.addEventListener("focus", refresh);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", refresh);
      void fetch("/api/gotchiverse/visit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        keepalive: true,
        body: JSON.stringify({ workshopId: workshop.id, leave: true }),
      }).catch(() => {});
    };
  }, [workshop?.id]);
  useEffect(() => {
    if (!canvas.current || !workshop) return;
    const draw = () => {
      drawing.current = drawTerrain(canvas.current!, workshop, selection);
      const projected = drawing.current?.project(position[0], position[1]);
      if (projected) setAvatar(projected);
    };
    draw();
    const observer = new ResizeObserver(draw);
    observer.observe(canvas.current);
    return () => observer.disconnect();
  }, [workshop, selection, position]);
  async function save(edit: Edit) {
    if (saving) return;
    setSaving(true);
    setError("");
    rememberPending(edit);
    try {
      const result = await api<{ workshop: Workshop; alreadySaved: boolean }>(
        "/gotchiverse/edit",
        edit,
      );
      if (!alive.current) return;
      setWorkshop(result.workshop);
      rememberPending(null);
      setMessage(tr("Saved. Your landscape is up to date."));
    } catch (e) {
      if (!alive.current) return;
      if (e instanceof ApiError && e.status === 409) {
        rememberPending(null);
        try {
          const r = await api<{ workshop: Workshop }>(
            `/gotchiverse/workshop?id=${edit.workshopId}`,
          );
          if (alive.current) setWorkshop(r.workshop);
        } catch {
          if (alive.current) {
            setWorkshop(null);
            setError(tr("Could not open Gotchiverse. Check your connection and try again."));
          }
          return;
        }
        setError(
          tr(
            "A friend changed this workshop. The latest terrain is loaded; choose your change again.",
          ),
        );
      } else if (e instanceof ApiError && e.status === 403) {
        rememberPending(null);
        setWorkshop(null);
        setError(
          tr(
            "Access to this workshop ended. Open your own workshop to keep building.",
          ),
        );
      } else
        setError(
          tr(
            "The save could not be confirmed. Retry the same save before making another change.",
          ),
        );
    } finally {
      if (alive.current) setSaving(false);
    }
  }
  function tool(name: string) {
    if (!workshop || saving || pending || !navigator.onLine) return;
    const cell = changedCell(terrainCell(workshop, ...selection), name);
    if (!cell) {
      setMessage(tr("This block has reached its height limit."));
      return;
    }
    if (
      JSON.stringify(cell) ===
      JSON.stringify(terrainCell(workshop, ...selection))
    )
      return;
    void save({
      workshopId: workshop.id,
      revision: workshop.revision,
      requestId: crypto.randomUUID(),
      x: selection[0],
      z: selection[1],
      cell,
    });
  }
  function move(dx: number, dz: number) {
    if (building) setSelection((p) => movePoint(p, dx, dz));
    else setPosition((p) => movePoint(p, dx, dz));
  }
  async function own() {
    if (saving || pending) return;
    initial.current = null;
    if (INVITE.test(location.hash))
      history.replaceState(
        history.state,
        "",
        location.pathname + location.search,
      );
    setPosition([8, 8]);
    setSelection([7, 7]);
    setFriendsOpen(false);
    setAttempt((a) => a + 1);
  }
  async function createInvite() {
    if (!workshop || saving || pending) return;
    setSaving(true);
    setError("");
    try {
      const r = await api<{ token: string; workshop: Workshop }>(
        "/gotchiverse/invite",
        { workshopId: workshop.id },
      );
      if (!alive.current) return;
      setWorkshop(r.workshop);
      setInvite(
        `${location.origin}${location.pathname}${location.search}#gotchi-invite=${r.token}`,
      );
    } catch {
      if (alive.current)
        setError(tr("Could not create an invitation. Try again."));
    } finally {
      if (alive.current) setSaving(false);
    }
  }
  async function revoke(memberId: string) {
    if (!workshop || saving || pending) return;
    setSaving(true);
    setError("");
    try {
      const r = await api<{ workshop: Workshop }>("/gotchiverse/revoke", {
        workshopId: workshop.id,
        memberId,
      });
      if (alive.current) {
        setWorkshop(r.workshop);
        setInvite("");
        setMessage(tr("Your friend can no longer edit this workshop."));
      }
    } catch {
      if (alive.current)
        setError(tr("Could not update workshop access. Try again."));
    } finally {
      if (alive.current) setSaving(false);
    }
  }
  const cell = workshop ? terrainCell(workshop, ...selection) : null;
  const locked = saving || !!pending || !navigator.onLine;
  const worn =
    !player.appearance.originTokenId &&
    !player.nativeOutfit &&
    player.wearables?.length
      ? player.wearables
      : null;
  return (
    <section className="gotchiverse" aria-label={REALMS.gotchiverse.name}>
      <div className="gotchi-heading">
        <div>
          <span className="gotchi-eyebrow">
            {REALMS.gotchiverse.name.toUpperCase()}
          </span>
          <h1 tabIndex={-1}>{tr("A world you can shape.")}</h1>
        </div>
        <button
          className="secondary-button"
          onClick={onExit}
          aria-label={tr("Back outdoors")}
        >
          <ArrowLeft size={20} aria-hidden="true" />
          <span className="gotchi-return-label">{tr("Back outdoors")}</span>
        </button>
      </div>
      <p className="gotchi-disclosure">
        {tr(
          "A shared workshop. Building here does not claim public land or earn rewards.",
        )}
      </p>
      {loading ? (
        <EmptyState title={tr("Opening Gotchiverse…")} status />
      ) : !workshop ? (
        <EmptyState title={tr("Your workshop is out of reach")}>
          <p role="alert">{error}</p>
          <button className="primary-button" onClick={() => void own()}>
            {tr("Open my workshop")}
          </button>
        </EmptyState>
      ) : (
        <>
          <div
            className="gotchi-objective"
            role="group"
            aria-label={tr("Make your first little landscape.")}
          >
            <strong>
              {workshop.progress.completedAt
                ? tr("Your first build is complete.")
                : tr("Shape three blocks and place a garden lantern.")}
            </strong>
            <span>
              {tr("{0} / 3 blocks shaped", {
                0: Math.min(3, workshop.progress.shaped),
              })}{" "}
              ·{" "}
              {workshop.progress.lantern
                ? tr("Lantern placed")
                : tr("Add a lantern")}
            </span>
          </div>
          <div className="gotchi-workspace">
            <div className="gotchi-land">
              <div className="gotchi-map-heading">
                <strong>
                  {workshop.role === "owner"
                    ? tr("Your workshop")
                    : tr("{0}’s workshop", { 0: workshop.ownerName })}
                </strong>
                <span className="gotchi-saved" role="status">
                  <FloppyDisk size={18} aria-hidden="true" />
                  {saving
                    ? tr("Saving…")
                    : pending
                      ? tr("Save pending")
                      : tr("Saved")}
                </span>
              </div>
              <div
                className="gotchi-quick-tools"
                aria-label={tr("Terrain tools")}
              >
                <button disabled={locked} onClick={() => tool("raise")}>
                  <Plus size={20} aria-hidden="true" />
                  {tr("Raise")}
                </button>
                <button disabled={locked} onClick={() => tool("lower")}>
                  <Minus size={20} aria-hidden="true" />
                  {tr("Lower")}
                </button>
              </div>
              <div
                ref={stage}
                className="gotchi-stage"
                tabIndex={0}
                role="group"
                aria-label={tr(
                  "Virtual landscape. Use arrows or WASD to move or select a block.",
                )}
                onKeyDown={(e) => {
                  if (
                    e.target !== e.currentTarget ||
                    e.altKey ||
                    e.ctrlKey ||
                    e.metaKey
                  )
                    return;
                  const keys: Record<string, [number, number]> = {
                    ArrowUp: [0, -1],
                    ArrowDown: [0, 1],
                    ArrowLeft: [-1, 0],
                    ArrowRight: [1, 0],
                    w: [0, -1],
                    s: [0, 1],
                    a: [-1, 0],
                    d: [1, 0],
                  };
                  const dir = keys[e.key] || keys[e.key.toLowerCase()];
                  if (dir) {
                    e.preventDefault();
                    move(...dir);
                  }
                }}
              >
                <canvas
                  ref={canvas}
                  aria-hidden="true"
                  onClick={(e) => {
                    const r = e.currentTarget.getBoundingClientRect();
                    const point =
                      drawing.current &&
                      hitCell(
                        drawing.current.faces,
                        e.clientX - r.left,
                        e.clientY - r.top,
                      );
                    if (point) {
                      setSelection(point);
                      setBuilding(true);
                      stage.current?.focus({ preventScroll: true });
                    }
                  }}
                />
                <div
                  className="gotchi-avatar"
                  data-worn={!!worn}
                  style={avatar}
                >
                  <Character
                    items={items}
                    originTokenId={player.appearance.originTokenId}
                    compact
                  />
                  {worn && (
                    <span
                      className="gotchi-worn"
                      aria-hidden="true"
                      dangerouslySetInnerHTML={{
                        __html: wearableStarterMarkup(worn),
                      }}
                    />
                  )}
                </div>
                {workshop.visitors.map((visitor) => {
                  const point = drawing.current?.project(visitor.x, visitor.z);
                  return point ? (
                    <div
                      key={visitor.id}
                      className="gotchi-visitor"
                      style={point}
                    >
                      <Ghost />
                      <span>{visitor.name}</span>
                    </div>
                  ) : null;
                })}
              </div>
              <div className="gotchi-map-footer">
                <output>
                  {tr("Block {x}, {z} · height {h}", {
                    x: selection[0] + 1,
                    z: selection[1] + 1,
                    h: cell?.height ?? 0,
                  })}
                </output>
                <span>{tr("Virtual movement · no GPS")}</span>
              </div>
              <div className="gotchi-movement">
                <div className="gotchi-modes">
                  <button
                    aria-pressed={!building}
                    onClick={() => setBuilding(false)}
                  >
                    <PersonSimpleWalk size={20} aria-hidden="true" />
                    {tr("Move explorer")}
                  </button>
                  <button
                    aria-pressed={building}
                    onClick={() => setBuilding(true)}
                  >
                    <Hammer size={20} aria-hidden="true" />
                    {tr("Build")}
                  </button>
                </div>
                <div
                  className="gotchi-pad"
                  aria-label={tr("Virtual movement controls")}
                >
                  {(
                    [
                      [0, -1, ArrowUp, tr("North")],
                      [-1, 0, ArrowLeft, tr("West")],
                      [1, 0, ArrowRight, tr("East")],
                      [0, 1, ArrowDown, tr("South")],
                    ] as const
                  ).map(([dx, dz, Icon, label]) => (
                    <button
                      key={label}
                      aria-label={
                        building
                          ? tr("Select block {0}", { 0: label })
                          : tr("Move {0}", { 0: label })
                      }
                      onClick={() => move(dx, dz)}
                    >
                      <Icon size={22} aria-hidden="true" />
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <aside className="gotchi-tools" aria-label={tr("Building tools")}>
              <div
                className="gotchi-tool-grid"
                aria-label={tr("Terrain tools")}
              >
                <button
                  className="gotchi-height-tool"
                  disabled={locked}
                  onClick={() => tool("raise")}
                >
                  <Plus size={20} aria-hidden="true" />
                  {tr("Raise")}
                </button>
                <button
                  className="gotchi-height-tool"
                  disabled={locked}
                  onClick={() => tool("lower")}
                >
                  <Minus size={20} aria-hidden="true" />
                  {tr("Lower")}
                </button>
                {materials.map((material) => (
                  <button
                    key={material.id}
                    disabled={locked}
                    aria-pressed={cell?.material === material.id}
                    onClick={() => tool(material.id)}
                  >
                    <span
                      className={`gotchi-swatch ${material.id}`}
                      aria-hidden="true"
                    />
                    {material.label()}
                  </button>
                ))}
                <button disabled={locked} onClick={() => tool("lantern")}>
                  <svg
                    className="gotchi-lantern"
                    viewBox="0 0 24 24"
                    aria-hidden="true"
                  >
                    <path
                      fill="#73519c"
                      d="M5 2h14v3H5zM7 5h2v11H7zm8 0h2v11h-2zM5 16h14v3H5zm6 3h2v5h-2z"
                    />
                    <path fill="#fae77d" d="M9 5h6v10H9z" />
                  </svg>
                  {tr("Garden lantern")}
                </button>
                <button disabled={locked} onClick={() => tool("remove")}>
                  <X size={20} aria-hidden="true" />
                  {tr("Remove object")}
                </button>
              </div>
              <button
                className="secondary-button"
                onClick={() => setFriendsOpen((v) => !v)}
                aria-expanded={friendsOpen}
              >
                <Users size={22} aria-hidden="true" />
                {tr("Build with friends")}
              </button>
              {workshop.role === "editor" && (
                <button
                  className="secondary-button"
                  disabled={locked}
                  onClick={() => void own()}
                >
                  {tr("Open my workshop")}
                </button>
              )}
            </aside>
          </div>
          {friendsOpen && (
            <section
              className="gotchi-friends"
              aria-label={tr("Workshop friends")}
            >
              <h2>{tr("Build with friends")}</h2>
              {workshop.role === "owner" ? (
                <>
                  <p>
                    {tr(
                      "Share a single-use invitation. Your friend can edit terrain, but cannot invite others or manage access.",
                    )}
                  </p>
                  <button
                    className="primary-button"
                    disabled={locked}
                    onClick={() => void createInvite()}
                  >
                    {tr("Create invitation")}
                  </button>
                  {invite && (
                    <>
                      <label htmlFor="gotchi-invite">
                        {tr("Invitation link · valid for one day")}
                      </label>
                      <div className="gotchi-copy">
                        <input
                          id="gotchi-invite"
                          value={invite}
                          readOnly
                          onFocus={(e) => e.currentTarget.select()}
                        />
                        <button
                          className="secondary-button"
                          onClick={() =>
                            void navigator.clipboard
                              ?.writeText(invite)
                              .then(() => setMessage(tr("Invitation copied.")))
                              .catch(() =>
                                setMessage(
                                  tr("Select and copy the invitation link."),
                                ),
                              )
                          }
                        >
                          <Copy size={20} aria-hidden="true" />
                          {tr("Copy")}
                        </button>
                      </div>
                    </>
                  )}
                  {workshop.members.map((member) => (
                    <div className="gotchi-member" key={member.id}>
                      <span>{member.name}</span>
                      <button
                        disabled={locked}
                        onClick={() => void revoke(member.id)}
                      >
                        {tr("Remove access")}
                      </button>
                    </div>
                  ))}
                </>
              ) : (
                <p>
                  {tr("The workshop owner manages invitations and access.")}
                </p>
              )}
            </section>
          )}
          {pending && (
            <div className="gotchi-pending">
              <p>
                {tr(
                  "An edit is waiting for confirmation. Retry it to avoid losing or repeating your change.",
                )}
              </p>
              <button
                className="primary-button"
                disabled={saving || !navigator.onLine}
                onClick={() => void save(pending)}
              >
                <ArrowClockwise size={20} aria-hidden="true" />
                {tr("Retry save")}
              </button>
            </div>
          )}
          {storageBlocked && (
            <p className="gotchi-notice">
              {tr(
                "This browser cannot remember an unfinished save. Keep this page open until Saved appears.",
              )}
            </p>
          )}
          {!navigator.onLine && (
            <p className="gotchi-notice" role="status">
              {tr(
                "You are offline. Your landscape stays visible; building resumes when you reconnect.",
              )}
            </p>
          )}
          {error && (
            <p className="gotchi-error" role="alert">
              {error}
            </p>
          )}
          <p className="gotchi-message" role="status">
            {message}
          </p>
        </>
      )}
    </section>
  );
}
