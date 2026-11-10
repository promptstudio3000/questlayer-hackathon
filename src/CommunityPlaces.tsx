import { useCallback, useEffect, useState } from "react";
import {
  Bank,
  Binoculars,
  Coffee,
  Flag,
  PaintBrush,
  PencilSimple,
  PersonSimpleWalk,
  Plus,
  Sparkle,
  Trash,
  Tree,
  X,
  type Icon,
} from "@phosphor-icons/react";
import { Dialog } from "./Dialog";
import { EmptyState } from "./EmptyState";
import { NotePinArt } from "./NotePinArt";
import { PinLine } from "./PinLine";
import { tr } from "./i18n";
import type { Fix } from "./types";
import {
  addCommunityPlace,
  communityPlaces,
  editCommunityPlace,
  removeCommunityPlace,
  reportCommunityPlace,
  type CommunityPlace,
  type PlaceKind,
} from "./community-places-client";
import "./local-chat.css";

export const PLACE_KINDS: { id: PlaceKind; icon: Icon; label: () => string }[] = [
  { id: "view", icon: Binoculars, label: () => tr("View") },
  { id: "nature", icon: Tree, label: () => tr("Nature") },
  { id: "history", icon: Bank, label: () => tr("History") },
  { id: "art", icon: PaintBrush, label: () => tr("Art") },
  { id: "food", icon: Coffee, label: () => tr("Food & drink") },
  { id: "hidden", icon: Sparkle, label: () => tr("Hidden gem") },
  { id: "play", icon: PersonSimpleWalk, label: () => tr("Walk & play") },
];
const kindOf = (id: PlaceKind) => PLACE_KINDS.find((k) => k.id === id) || PLACE_KINDS[0];
type Sort = "near" | "new" | "name";

/**
 * Community · Places (Lubos, 10 Nov 2026): interesting spots other explorers
 * recommend, nearest first, with a GPS line that shows each one on the map.
 * Free; no GOLD or XP moves.
 */
export function CommunityPlaces({
  position,
  fix,
  arena,
  notify,
}: {
  position: { lat: number; lng: number };
  fix: Fix | null;
  arena: boolean;
  notify: (text: string, error?: boolean) => void;
}) {
  const [places, setPlaces] = useState<CommunityPlace[] | null>(null);
  const [error, setError] = useState("");
  const [adding, setAdding] = useState(false);
  const [sort, setSort] = useState<Sort>("near");
  const [kind, setKind] = useState<PlaceKind | "all">("all");
  const [editing, setEditing] = useState<{ id: string; name: string; note: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const { lat, lng } = position;
  const load = useCallback(
    () =>
      communityPlaces(lat, lng, arena).then(
        (r) => {
          setPlaces(r.places);
          setError("");
        },
        (e) => setError(e instanceof Error ? e.message : String(e)),
      ),
    // Re-read on a ~100 m move, not every GPS tick.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [Math.round(lat * 1000), Math.round(lng * 1000), arena],
  );
  useEffect(() => {
    void load();
  }, [load]);
  const run = async (task: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await task();
    } catch (e) {
      notify(e instanceof Error ? e.message : tr("Could not connect to the game."), true);
    } finally {
      setBusy(false);
    }
  };
  const shown = (places || [])
    .filter((p) => kind === "all" || p.kind === kind)
    .sort((a, b) =>
      sort === "new"
        ? b.createdAt - a.createdAt
        : sort === "name"
          ? a.name.localeCompare(b.name)
          : (a.distanceM ?? 0) - (b.distanceM ?? 0),
    );
  return (
    <section className="community-places" aria-label={tr("Places")}>
      <div className="community-head">
        <h2>{tr("Places worth a visit")}</h2>
        <div className="community-head-actions">
          <button type="button" onClick={() => setAdding(true)}>
            <Plus size={18} weight="bold" aria-hidden="true" /> {tr("Add a place")}
          </button>
        </div>
      </div>
      <div className="community-filter">
        <select value={kind} onChange={(e) => setKind(e.target.value as PlaceKind | "all")} aria-label={tr("Kind of place")}>
          <option value="all">{tr("All kinds")}</option>
          {PLACE_KINDS.map((k) => (
            <option key={k.id} value={k.id}>
              {k.label()}
            </option>
          ))}
        </select>
        <select value={sort} onChange={(e) => setSort(e.target.value as Sort)} aria-label={tr("Sort")}>
          <option value="near">{tr("Nearest")}</option>
          <option value="new">{tr("Newest")}</option>
          <option value="name">{tr("A to Z")}</option>
        </select>
      </div>
      {error && (
        <EmptyState title={tr("Places")} action={{ label: tr("Try again"), onClick: () => void load() }}>
          {error}
        </EmptyState>
      )}
      {!places ? (
        !error && <EmptyState title={tr("Loading…")} status />
      ) : !shown.length ? (
        <EmptyState title={tr("No places around you yet")}>{tr("Recommend a spot you like to the next explorer.")}</EmptyState>
      ) : (
        <ul className="community-rows">
          {shown.map((p) => {
            const k = kindOf(p.kind);
            return (
              <li key={p.id} className="community-row">
                <span className="community-row-icon" data-kind={p.kind} aria-hidden="true">
                  <k.icon size={20} weight="duotone" />
                </span>
                <div className="community-row-body">
                  {editing?.id === p.id ? (
                    <form
                      className="community-place-edit"
                      onSubmit={(e) => {
                        e.preventDefault();
                        void run(async () => {
                          await editCommunityPlace(p.id, { name: editing.name, note: editing.note });
                          setEditing(null);
                          notify(tr("Place updated."));
                          await load();
                        });
                      }}
                    >
                      <input value={editing.name} maxLength={60} aria-label={tr("Name of the place")} onChange={(e) => setEditing({ ...editing, name: e.target.value })} required />
                      <textarea value={editing.note} maxLength={280} rows={3} aria-label={tr("Why is it worth a visit?")} onChange={(e) => setEditing({ ...editing, note: e.target.value })} required />
                      <div>
                        <button type="button" disabled={busy} onClick={() => setEditing(null)}>
                          {tr("Cancel")}
                        </button>
                        <button className="is-primary" disabled={busy || !editing.name.trim() || !editing.note.trim()}>
                          {tr("Save")}
                        </button>
                      </div>
                    </form>
                  ) : (
                    <>
                      <b>{p.name}</b>
                      <p>{p.note}</p>
                      <span className="community-row-meta">
                        {k.label()} · {p.mine ? tr("You") : p.author.name}
                      </span>
                    </>
                  )}
                  <PinLine at={p} you={position} title={p.name} />
                </div>
                <div className="community-row-actions">
                  {p.mine ? (
                    <>
                      <button type="button" aria-label={tr("Edit {0}", { 0: p.name })} title={tr("Edit")} disabled={busy} onClick={() => setEditing({ id: p.id, name: p.name, note: p.note })}>
                        <PencilSimple size={20} aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        aria-label={tr("Remove {0}", { 0: p.name })}
                        title={tr("Remove")}
                        disabled={busy}
                        onClick={() =>
                          void run(async () => {
                            await removeCommunityPlace(p.id);
                            notify(tr("Place removed."));
                            await load();
                          })
                        }
                      >
                        <Trash size={20} aria-hidden="true" />
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      aria-label={tr("Report {0}", { 0: p.name })}
                      title={tr("Report")}
                      disabled={busy}
                      onClick={() =>
                        void run(async () => {
                          await reportCommunityPlace(p.id);
                          notify(tr("Thanks. Moderators will look at it."));
                        })
                      }
                    >
                      <Flag size={20} aria-hidden="true" />
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {adding && (
        <AddPlaceDialog
          position={position}
          fix={fix}
          arena={arena}
          notify={notify}
          onClose={() => setAdding(false)}
          onAdded={() => {
            setAdding(false);
            void load();
          }}
        />
      )}
    </section>
  );
}

/** Compact "recommend this spot" dialog; also opens from the Actions button. */
export function AddPlaceDialog({
  position,
  fix,
  arena,
  notify,
  onClose,
  onAdded,
}: {
  position: { lat: number; lng: number };
  fix: Fix | null;
  arena: boolean;
  notify: (text: string, error?: boolean) => void;
  onClose: () => void;
  onAdded: (place: CommunityPlace) => void;
}) {
  const [anchor] = useState({ lat: position.lat, lng: position.lng });
  const [name, setName] = useState("");
  const [note, setNote] = useState("");
  const [kind, setKind] = useState<PlaceKind>("view");
  const [busy, setBusy] = useState(false);
  return (
    <Dialog label={tr("Add a place")} onClose={() => !busy && onClose()}>
      <form
        className="quick-create"
        onSubmit={(e) => {
          e.preventDefault();
          setBusy(true);
          addCommunityPlace({ name, note, kind, lat: anchor.lat, lng: anchor.lng, arena, fix: arena ? null : fix })
            .then(
              (r) => {
                notify(tr("Your place is listed for explorers nearby."));
                onAdded(r.place);
              },
              (err) => notify(err instanceof Error ? err.message : tr("Could not connect to the game."), true),
            )
            .finally(() => setBusy(false));
        }}
      >
        <button type="button" className="quick-create-close" aria-label={tr("Close")} disabled={busy} onClick={onClose}>
          <X size={22} aria-hidden="true" />
        </button>
        <NotePinArt kind="place" />
        <h2>{tr("Add a place")}</h2>
        <input type="text" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} placeholder={tr("Name of the place")} aria-label={tr("Name of the place")} required autoFocus />
        <textarea value={note} rows={3} maxLength={280} onChange={(e) => setNote(e.target.value)} placeholder={tr("Why is it worth a visit?")} aria-label={tr("Why is it worth a visit?")} required />
        <div className="quick-create-kinds" role="radiogroup" aria-label={tr("Kind of place")}>
          {PLACE_KINDS.map((k) => (
            <button key={k.id} type="button" role="radio" aria-checked={kind === k.id} disabled={busy} onClick={() => setKind(k.id)}>
              <k.icon size={16} weight="duotone" aria-hidden="true" />
              {k.label()}
            </button>
          ))}
        </div>
        <p className="quick-create-fine">
          {tr("Public at the spot where you stand ({0}). Free.", { 0: `${anchor.lat.toFixed(5)}, ${anchor.lng.toFixed(5)}` })}
        </p>
        <button type="submit" className="map-notes-primary gold-primary" disabled={busy || !name.trim() || !note.trim()}>
          {busy ? tr("Saving…") : tr("Recommend this place")}
        </button>
      </form>
    </Dialog>
  );
}
