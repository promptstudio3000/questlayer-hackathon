import { EmptyState } from "./EmptyState";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowClockwise,
  Camera,
  Cube,
  DotsThree,
  Flag,
  MapPin,
  PencilSimple,
  Plus,
  Prohibit,
  Trash,
  X,
} from "@phosphor-icons/react";
import { ArrowLeft } from "./dir-icons";
import { Dialog } from "./Dialog";
import { Ghost } from "./Ghost";
import type { Fix, Point } from "./types";
import { useFormDraft } from "./useFormDraft";
import { browserDraftStorage } from "./form-draft";
import { createReadEpoch } from "./read-epoch";
import { createNotePublicationJournal } from "./note-publication-journal";
import { NoteRecordDialog } from "./NoteRecordDialog";
import { NotePinArt } from "./NotePinArt";
import { PinLine } from "./PinLine";
import { remaining } from "./api";
import "./local-chat.css";
import type { NoteRecordKind } from "./note-record";
import "./map-notes.css";
import { tr } from "./i18n";

export type MapNote = Point & {
  id: string;
  player_id: string;
  author: string;
  text: string;
  image: string | null;
  author_fix: Fix | null;
  created_at: number;
  expires_at: number | null;
  arena: boolean;
  own: boolean;
  state: "published";
};
type BlockedPerson = { playerId: string; name: string; createdAt: number };
type Publication = Point & {
  clientId: string;
  text: string;
  arena: boolean;
  image: string | null;
  publicConsent: true;
  shareGps: boolean;
  fix: Fix | null;
  days: NoteDays;
};
/** How long a note stays: 1 day, 7 days or until the author removes it (0). */
type NoteDays = 1 | 7 | 0;
const NOTE_DAYS: { days: NoteDays; label: () => string }[] = [
  { days: 1, label: () => tr("1 day") },
  { days: 7, label: () => tr("1 week") },
  { days: 0, label: () => tr("Keep") },
];
type Receipt = {
  found: boolean;
  id?: string;
  state?:
    | "processing"
    | "retryable"
    | "published"
    | "hidden"
    | "deleted"
    | "abandoned";
  retryAfterMs?: number;
};
type PendingNote = {
  clientId: string;
  draftRevision?: string | null;
  payload?: Publication;
  receipt?: Receipt;
};
type Decision = { kind: "remove" | "report" | "block"; note: MapNote };
export type MapNotesView = "browse" | "compose" | "blocked";
const NOTE_DRAFT_FIELDS = { text: 500 } as const;
class NoteError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}
async function request<T>(
  path: string,
  method = "GET",
  body?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  const controller = new AbortController();
  const cancel = () => controller.abort();
  signal?.addEventListener("abort", cancel, { once: true });
  if (signal?.aborted) controller.abort();
  const timer = setTimeout(cancel, 20000);
  try {
    const response = await fetch(`/api${path}`, {
      method,
      credentials: "same-origin",
      signal: controller.signal,
      ...(method === "GET"
        ? {}
        : {
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body ?? {}),
          }),
    });
    const value = await response.json();
    if (!response.ok)
      throw new NoteError(
        value.error ||
          "Notes are unavailable right now. Try again in a moment.",
        response.status,
      );
    return value as T;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", cancel);
  }
}
function freshFix(fix: Fix | null) {
  return (
    !!fix &&
    [fix.lat, fix.lng, fix.accuracy, fix.timestamp].every(Number.isFinite) &&
    Math.abs(fix.lat) <= 90 &&
    Math.abs(fix.lng) <= 180 &&
    fix.accuracy >= 0 &&
    fix.accuracy <= 35 &&
    Date.now() - fix.timestamp <= 15000 &&
    fix.timestamp <= Date.now() + 2000
  );
}
/** "3 d" for a long wait, "5 h 10 min" under a day and a half. */
function timeLeft(at: number) {
  const ms = at - Date.now();
  return ms > 36 * 3600000 ? tr("{0} d", { 0: Math.round(ms / 86400000) }) : remaining(at);
}
function message(error: unknown) {
  return error instanceof Error && error.name !== "AbortError"
    ? error.message
    : tr("The connection dropped. Use Check status before trying again.");
}

export function MapNotes({
  playerId,
  position,
  fix,
  arena,
  notify,
  onBlockChange,
  onViewChange,
  view: requestedView,
  recordAccount,
  onRecord,
  quick = false,
  onDone,
}: {
  playerId: string;
  position: Point;
  fix: Fix | null;
  arena: boolean;
  notify?: (message: string, error?: boolean) => void;
  onBlockChange?: () => void;
  onViewChange?: (view: MapNotesView) => void;
  view?: MapNotesView;
  recordAccount?: { accountId: string; managed: boolean } | null;
  onRecord?: (noteId: string, kind: NoteRecordKind) => Promise<boolean>;
  /** Only the compact create dialog (Actions button); onDone closes it. */
  quick?: boolean;
  onDone?: () => void;
}) {
  const [recordNote, setRecordNote] = useState<MapNote | null>(null);
  const identity = `${playerId}:${arena ? "arena" : "physical"}`;
  const latest = useRef(identity);
  const operations = useRef(createReadEpoch());
  if (latest.current !== identity) operations.current.invalidate();
  latest.current = identity;
  const latestPosition = useRef(position);
  latestPosition.current = position;
  const mounted = useRef(true),
    flight = useRef(false),
    generation = useRef(0),
    photoGeneration = useRef(0);
  const controllers = useRef(new Set<AbortController>()),
    heading = useRef<HTMLHeadingElement>(null),
    composer = useRef<HTMLTextAreaElement>(null);
  const journal = useMemo(() => {
    let legacy: Storage | null = null;
    try {
      legacy = sessionStorage;
    } catch {
      /* Old tab-only intents may be unavailable. */
    }
    return createNotePublicationJournal(
      playerId,
      arena,
      browserDraftStorage(),
      legacy,
    );
  }, [identity]);
  const [localView, setLocalView] = useState<MapNotesView>(quick ? "compose" : "browse");
  const view = requestedView ?? localView;
  function setView(next: MapNotesView) {
    if (next !== "compose") {
      setShareGps(false);
    }
    setLocalView(next);
    onViewChange?.(next);
    if (quick && next !== "compose") onDone?.();
  }
  const draft = useFormDraft({
    playerId,
    form: "map-note",
    realm: arena ? "arena" : "physical",
    fields: NOTE_DRAFT_FIELDS,
    initial: { text: "" },
  });
  const text = draft.values.text;
  const setText = (next: string) => draft.setField("text", next);
  const viewIdentity = useRef(identity);
  const [notes, setNotes] = useState<MapNote[]>([]),
    [blocks, setBlocks] = useState<BlockedPerson[]>([]);
  const [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [image, setImage] = useState<string | null>(null),
    [reading, setReading] = useState(false);
  const [anchor, setAnchor] = useState<Point>({ ...position }),
    [shareGps, setShareGps] = useState(false),
    [days, setDays] = useState<NoteDays>(7);
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);
  const [pending, setPending] = useState<PendingNote | null>(() =>
    journal.loadFirst(),
  );
  const pendingRef = useRef(pending);
  pendingRef.current = pending;
  const [decision, setDecision] = useState<Decision | null>(null),
    [reason, setReason] = useState("spam"),
    [detail, setDetail] = useState("");
  const coordinates = `${position.lat.toFixed(2)}:${position.lng.toFixed(2)}`;
  const current = (who: string) => mounted.current && latest.current === who;

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      operations.current.invalidate();
      for (const c of controllers.current) c.abort();
      controllers.current.clear();
    };
  }, []);
  useEffect(() => {
    generation.current++;
    photoGeneration.current++;
    for (const c of controllers.current) c.abort();
    controllers.current.clear();
    flight.current = false;
    setBusy(false);
    setDecision(null);
    if (viewIdentity.current !== identity) setView("browse");
    viewIdentity.current = identity;
    setNotes([]);
    setBlocks([]);
    setImage(null);
    setReading(false);
    setShareGps(false);
    setError("");
    setNotice("");
    const restored = journal.loadFirst();
    pendingRef.current = restored;
    setPending(restored);
    setAnchor({ ...position });
  }, [identity]);
  useEffect(() => {
    setShareGps(false);
    if (view === "compose") composer.current?.focus();
    else heading.current?.focus();
  }, [view]);
  async function call<T>(
    path: string,
    method = "GET",
    value?: unknown,
  ): Promise<T> {
    const controller = new AbortController();
    controllers.current.add(controller);
    try {
      return await request<T>(path, method, value, controller.signal);
    } finally {
      controllers.current.delete(controller);
    }
  }
  async function load() {
    const who = identity,
      version = ++generation.current;
    const place = latestPosition.current;
    setLoading(true);
    setError("");
    try {
      const value = await call<{ messages: MapNote[] }>(
        `/messages?lat=${place.lat.toFixed(2)}&lng=${place.lng.toFixed(2)}&arena=${arena ? 1 : 0}`,
      );
      if (current(who) && version === generation.current)
        setNotes(value.messages);
    } catch (e) {
      if (current(who) && version === generation.current) {
        setNotes([]);
        setError(message(e));
      }
    } finally {
      if (current(who) && version === generation.current) setLoading(false);
    }
  }
  useEffect(() => {
    void load();
  }, [identity, coordinates]);
  async function loadBlocks() {
    const who = identity;
    const value = await call<{ blocks: BlockedPerson[] }>("/social/blocks");
    if (current(who)) setBlocks(value.blocks);
  }
  async function operate(action: () => Promise<void>) {
    if (flight.current) return;
    const who = identity;
    const operation = operations.current.begin(who);
    flight.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await action();
    } catch (e) {
      if (current(who) && operations.current.isCurrent(operation, identity))
        setError(message(e));
    } finally {
      if (current(who) && operations.current.isCurrent(operation, identity)) {
        flight.current = false;
        setBusy(false);
      }
    }
  }
  function clearIntent() {
    const completed = pendingRef.current;
    try {
      if (completed) journal.clear(completed.clientId);
    } catch {
      /* A stale operation ID only triggers a read-back on the next visit. */
    }
    const next = journal.loadFirst();
    pendingRef.current = next;
    setPending(next);
  }
  async function settleIntent(receipt: Receipt) {
    if (
      !receipt.found ||
      !["published", "hidden", "deleted", "abandoned"].includes(
        receipt.state || "",
      )
    )
      return false;
    const intent = pendingRef.current;
    clearIntent();
    if (receipt.state !== "abandoned") {
      if (intent?.draftRevision !== undefined)
        draft.discard(intent.draftRevision);
      setImage(null);
    }
    setShareGps(false);
    setView(receipt.state === "abandoned" && text ? "compose" : "browse");
    const result =
      receipt.state === "published"
        ? tr("Your note is on the map.")
        : receipt.state === "abandoned"
          ? tr("The unfinished note was discarded.")
          : tr("This note is no longer visible. It was not posted again.");
    setNotice(result);
    notify?.(result);
    await load();
    return true;
  }
  async function checkPending() {
    const intent = pendingRef.current;
    if (!intent) return;
    const who = identity;
    const receipt = await call<Receipt>(
      `/messages/operation?clientId=${encodeURIComponent(intent.clientId)}`,
    );
    if (!current(who) || pendingRef.current?.clientId !== intent.clientId)
      return;
    const updated = { ...intent, receipt };
    pendingRef.current = updated;
    setPending(updated);
    await settleIntent(receipt);
  }
  useEffect(() => {
    if (journal.loadFirst()) void operate(checkPending);
  }, [identity]);
  async function publish(payload: Publication) {
    const who = identity;
    // Keep operation identity separate from editable text; never persist photo,
    // map pin, GPS evidence or the consented publication payload.
    const existing = journal.loadFirst();
    if (existing && existing.clientId !== payload.clientId) {
      pendingRef.current = existing;
      setPending(existing);
      throw Error("Check your last note first. Your text is kept.");
    }
    const draftRevision =
      pendingRef.current?.clientId === payload.clientId
        ? (pendingRef.current.draftRevision ?? null)
        : draft.revision;
    try {
      journal.remember(payload.clientId, draftRevision);
    } catch {
      throw Error(
        "This browser could not save the note receipt. Nothing was sent; your text is kept.",
      );
    }
    const intent = { clientId: payload.clientId, payload, draftRevision };
    pendingRef.current = intent;
    setPending(intent);
    try {
      const receipt = await call<{
        id: string;
        state: "published" | "hidden" | "deleted";
        replayed: boolean;
      }>("/messages", "POST", payload);
      if (!current(who) || pendingRef.current?.clientId !== payload.clientId)
        return;
      await settleIntent({ found: true, id: receipt.id, state: receipt.state });
    } catch (e) {
      if (!current(who) || pendingRef.current?.clientId !== payload.clientId)
        return;
      setError(
        tr("{0} The receipt is kept. Use Check status before writing another note.", { 0: message(e) }),
      );
      try {
        await checkPending();
      } catch {
        /* The stable operation stays available for a manual status check. */
      }
    }
  }
  async function submit() {
    if (pendingRef.current) return;
    if (shareGps && (arena || !freshFix(fix)))
      throw Error(
        "Wait for a fresh GPS fix before attaching your exact position.",
      );
    if (!text.trim()) throw Error("Write your note first.");
    await publish({
      clientId: crypto.randomUUID(),
      text: text.trim(),
      ...anchor,
      arena,
      image,
      publicConsent: true,
      shareGps,
      fix: shareGps && fix ? { ...fix } : null,
      days,
    });
  }
  function choosePhoto(file?: File) {
    if (!file) return;
    if (
      !["image/jpeg", "image/png", "image/webp"].includes(file.type) ||
      file.size > 1000000
    ) {
      setError(tr("Choose a JPG, PNG or WebP photo smaller than 1 MB."));
      return;
    }
    const who = identity,
      version = ++photoGeneration.current;
    const reader = new FileReader();
    setReading(true);
    setError("");
    reader.onload = () => {
      if (current(who) && version === photoGeneration.current) {
        setImage(String(reader.result));
        setReading(false);
      }
    };
    reader.onerror = () => {
      if (current(who) && version === photoGeneration.current) {
        setError(tr("That photo could not be opened. Choose it again."));
        setReading(false);
      }
    };
    reader.readAsDataURL(file);
  }
  async function confirmDecision() {
    if (!decision) return;
    const who = identity,
      selected = decision;
    let reportResult: { state: string; replayed?: boolean } | undefined;
    if (selected.kind === "remove")
      await call(`/messages/${encodeURIComponent(selected.note.id)}`, "DELETE");
    if (selected.kind === "report")
      reportResult = await call<{ state: string; replayed?: boolean }>(
        `/messages/${encodeURIComponent(selected.note.id)}/report`,
        "POST",
        { reason, detail: detail.trim() },
      );
    if (selected.kind === "block")
      await call("/social/blocks", "POST", {
        targetPlayerId: selected.note.player_id,
      });
    if (!current(who)) return;
    setDecision(null);
    setDetail("");
    if (selected.kind === "block") {
      onBlockChange?.();
      await load();
      if (!current(who)) return;
      heading.current?.focus();
      setNotice(
        tr("Player blocked. Their notes and map presence are hidden from you."),
      );
    }
    if (selected.kind === "remove") {
      await load();
      if (!current(who)) return;
      heading.current?.focus();
      setNotice(tr("Note removed."));
    }
    if (selected.kind === "report")
      setNotice(
        reportResult?.state === "resolved"
          ? tr("Your previous report has already been reviewed. No new report was opened.")
          : reportResult?.replayed
            ? tr("Your report is already in the review queue.")
            : tr("Report received. A reviewer will look at it; the note stays until then."),
      );
  }
  const locked = busy || !!pending;
  const retryGpsExpired =
    !!pending?.payload?.shareGps && !freshFix(pending.payload.fix);
  function discardDraft() {
    const removed = draft.discard();
    photoGeneration.current++;
    setImage(null);
    setReading(false);
    setShareGps(false);
    setView("browse");
    setNotice(
      removed
        ? tr("Draft discarded. Published notes are untouched.")
        : tr("Draft cleared here, but this browser kept a copy that may return after reload."),
    );
  }
  async function saveEdit() {
    if (!editing) return;
    const who = identity,
      target = editing;
    await call(`/messages/${encodeURIComponent(target.id)}`, "PATCH", { text: target.text.trim() });
    if (!current(who)) return;
    setEditing(null);
    setNotice(tr("Note updated."));
    await load();
  }
  const pendingCard = pending && (
    <section className="map-notes-pending" aria-label={tr("Last note status")}>
      <b>{tr("Check your last note")}</b>
      <p>
        {pending.receipt?.state === "retryable"
          ? tr("That attempt did not finish. Retry it or discard it before writing another.")
          : tr("It may already be on the map. Checking never posts it twice.")}
      </p>
      {!pending.payload && (
        <p>
          {tr("Your text is kept, but the photo, pin and consent are not. Check or discard this note before sending again.")}</p>
      )}
      {pending.receipt?.state === "retryable" && retryGpsExpired && (
        <p>
          {tr("Its GPS fix has expired. Discard this note and publish your draft with a fresh fix.")}</p>
      )}
      <div className="map-notes-actions">
        <button disabled={busy} onClick={() => void operate(checkPending)}>
          <ArrowClockwise size={20} />
          {tr("Check status")}</button>
        {pending.receipt?.state === "retryable" && pending.payload && (
          <button
            disabled={busy || retryGpsExpired}
            onClick={() => void operate(() => publish(pending.payload!))}
          >
            {tr("Retry this note")}</button>
        )}
        <button
          disabled={busy}
          onClick={() =>
            void operate(async () => {
              const who = identity;
              const result = await call<Receipt>(
                "/messages/operation/abandon",
                "POST",
                { clientId: pending.clientId },
              );
              if (
                current(who) &&
                pendingRef.current?.clientId === pending.clientId
              )
                await settleIntent(result);
            })
          }
        >
          {tr("Discard note")}</button>
      </div>
    </section>
  );
  const feedback = (
    <>
      {notice && (
        <p className="map-notes-notice" role="status">
          {notice}
        </p>
      )}
      {error && (
        <p className="map-notes-error" role="alert">
          {error}
        </p>
      )}
    </>
  );
  // Compact create dialog (Lubos, 10 Nov 2026): the illustration of a note
  // pinned into the ground, the text, a small "how long" switch, and one
  // button. The map stays where it was.
  const composeDialog = view === "compose" && (
    <Dialog
      label={tr("Leave a note")}
      onClose={() => {
        if (!busy) setView("browse");
      }}
    >
      <form
        className="map-notes-dialog quick-create"
        onSubmit={(e) => {
          e.preventDefault();
          void operate(submit);
        }}
      >
        <button
          type="button"
          className="quick-create-close"
          aria-label={tr("Close")}
          disabled={busy}
          onClick={() => setView("browse")}
        >
          <X size={22} aria-hidden="true" />
        </button>
        <NotePinArt />
        <h2 ref={heading} tabIndex={-1}>{tr("Leave a note")}</h2>
        {feedback}
        {pendingCard}
        <label className="sr-only" htmlFor="map-note-text">{tr("What did you discover?")}</label>
        <textarea
          id="map-note-text"
          ref={composer}
          value={text}
          disabled={locked}
          maxLength={500}
          required
          rows={3}
          placeholder={tr("A quiet bench, a hidden detail, a tip for the next ghost…")}
          onChange={(e) => setText(e.target.value)}
        />
        {image && (
          <div className="map-notes-preview">
            <img src={image} alt={tr("Photo selected for this note")} />
            <button
              type="button"
              className="map-notes-icon"
              aria-label={tr("Remove selected photo")}
              disabled={locked}
              onClick={() => {
                photoGeneration.current++;
                setImage(null);
                setReading(false);
              }}
            >
              <X size={20} />
            </button>
          </div>
        )}
        <div className="quick-create-tools">
          <label
            className={`quick-create-tool ${locked ? "is-disabled" : ""}`}
            title={image ? tr("Change photo") : tr("Add photo")}
          >
            <Camera size={22} aria-hidden="true" />
            <span className="sr-only">{reading ? tr("Opening photo…") : image ? tr("Change photo") : tr("Add photo")}</span>
            <input
              aria-label={tr("Choose a photo")}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              disabled={locked || reading}
              onChange={(e) => {
                choosePhoto(e.target.files?.[0]);
                e.target.value = "";
              }}
            />
          </label>
          <div className="quick-create-days" role="radiogroup" aria-label={tr("How long it stays")}>
            {NOTE_DAYS.map((option) => (
              <button
                key={option.days}
                type="button"
                role="radio"
                aria-checked={days === option.days}
                disabled={locked}
                onClick={() => setDays(option.days)}
              >
                {option.label()}
              </button>
            ))}
          </div>
          <span className="map-notes-secondary quick-create-count">{text.length}/500</span>
        </div>
        {!arena && (
          <label className="map-notes-check quick-create-gps">
            <input
              type="checkbox"
              checked={shareGps}
              disabled={locked || (!shareGps && !freshFix(fix))}
              onChange={(e) => setShareGps(e.target.checked)}
            />
            <span>
              {tr("Also attach my exact GPS position and time")}
              {!freshFix(fix) && <small> · {tr("Needs a fresh, accurate GPS fix.")}</small>}
            </span>
          </label>
        )}
        <p className="map-notes-secondary quick-create-fine">
          <MapPin size={16} weight="fill" aria-hidden="true" />{" "}
          {tr("Public at this pin ({0}) with its time and photo. Photo metadata is removed. Stored by QuestLayer only.", {
            0: `${anchor.lat.toFixed(5)}, ${anchor.lng.toFixed(5)}`,
          })}
        </p>
        {draft.restored && !pending && (
          <button type="button" className="quick-create-link" disabled={locked} onClick={discardDraft}>
            <Trash size={18} aria-hidden="true" /> {tr("Discard draft")}
          </button>
        )}
        <button
          className="map-notes-primary"
          type="submit"
          disabled={locked || reading || !text.trim() || (shareGps && !freshFix(fix))}
        >
          {busy ? tr("Publishing…") : tr("Leave the note here")}
        </button>
      </form>
    </Dialog>
  );
  if (quick)
    return <>{composeDialog}</>;
  return (
    <section className="map-notes" aria-label={tr("Local chat")}>
      <div className="map-notes-heading">
        {view === "blocked" && (
          <button
            className="panel-back"
            aria-label={tr("Back to nearby notes")}
            title={tr("Back to nearby notes")}
            disabled={busy}
            onClick={() => setView("browse")}
          >
            <ArrowLeft size={20} />
          </button>
        )}
        <h2 ref={view === "compose" ? undefined : heading} tabIndex={-1} title={arena ? tr("Demo arena") : tr("Real-world map")}>
          {view === "blocked" ? tr("Blocked players") : tr("Around you")}
        </h2>
        {view !== "blocked" && (
          <>
            <button
              className="map-notes-icon"
              aria-label={tr("Refresh nearby notes")}
              title={tr("Refresh nearby notes")}
              disabled={busy || loading}
              onClick={() => void load()}
            >
              <ArrowClockwise size={20} />
            </button>
            <button
              className="map-notes-primary"
              disabled={locked}
              onClick={() => {
                if (!text && !image) setAnchor({ ...position });
                setShareGps(false);
                setView("compose");
                setError("");
              }}
            >
              <Plus size={20} />
              {draft.hasDraft ? tr("Resume draft") : tr("Write a note")}
            </button>
          </>
        )}
      </div>
      {view !== "compose" && feedback}
      {view !== "compose" && pendingCard}
      {composeDialog}
      {view !== "blocked" && (
        <>
          {loading ? (
            <p role="status">{tr("Looking for nearby notes…")}</p>
          ) : notes.length ? (
            <ul className="map-notes-list">
              {notes.map((note) => (
                <li key={note.id} className={`map-note${note.own ? " is-own" : ""}`}>
                  <Ghost className="map-note-ghost" />
                  <div className="map-note-body">
                    <div className="map-note-meta">
                      <b>{note.own ? tr("You") : note.author}</b>
                      <time dateTime={new Date(note.created_at).toISOString()}>
                        {new Date(note.created_at).toLocaleString("en-US", {
                          day: "numeric",
                          month: "short",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </time>
                      {note.expires_at && (
                        <span className="map-note-expiry">· {tr("{0} left", { 0: timeLeft(note.expires_at) })}</span>
                      )}
                    </div>
                    {editing?.id === note.id ? (
                      <form
                        className="map-note-edit"
                        onSubmit={(e) => {
                          e.preventDefault();
                          void operate(saveEdit);
                        }}
                      >
                        <label className="sr-only" htmlFor={`edit-${note.id}`}>{tr("Edit your note")}</label>
                        <textarea
                          id={`edit-${note.id}`}
                          value={editing.text}
                          maxLength={500}
                          rows={3}
                          autoFocus
                          disabled={busy}
                          onChange={(e) => setEditing({ id: note.id, text: e.target.value })}
                        />
                        <div className="map-notes-actions">
                          <button type="button" disabled={busy} onClick={() => setEditing(null)}>
                            {tr("Cancel")}
                          </button>
                          <button className="map-notes-primary" disabled={busy || !editing.text.trim()}>
                            {busy ? tr("Saving…") : tr("Save")}
                          </button>
                        </div>
                      </form>
                    ) : (
                      <p className="map-note-text">{note.text}</p>
                    )}
                    {note.image && (
                      <img
                        className="map-note-image"
                        src={note.image}
                        alt={tr("Photo attached to {0}'s note", { 0: note.author })}
                        loading="lazy"
                      />
                    )}
                    <div className="map-note-foot">
                      <PinLine at={note} you={position} title={note.text} />
                      {note.author_fix && (
                        <span
                          className="map-note-verified"
                          title={tr("Author GPS: {0} · accuracy {1} m", {
                            0: `${note.author_fix.lat.toFixed(5)}, ${note.author_fix.lng.toFixed(5)}`,
                            1: Math.round(note.author_fix.accuracy),
                          })}
                        >
                          {tr("GPS attached")}
                        </span>
                      )}
                    </div>
                  </div>
                  <details className="map-note-menu">
                    <summary aria-label={tr("Actions for {0}'s note", { 0: note.author })}>
                      <DotsThree size={26} />
                    </summary>
                    <div>
                      {note.own ? (
                        <>
                          <button
                            disabled={busy}
                            onClick={(e) => {
                              (e.currentTarget.closest("details") as HTMLDetailsElement | null)?.removeAttribute("open");
                              setError("");
                              setEditing({ id: note.id, text: note.text });
                            }}
                          >
                            <PencilSimple size={19} />
                            {tr("Edit note")}</button>
                          {onRecord && (
                            <button
                              disabled={busy}
                              onClick={() => setRecordNote(note)}
                            >
                              <Cube size={19} />
                              {tr("Public record")}</button>
                          )}
                          <button
                            disabled={busy}
                            onClick={() => {
                              setError("");
                              setDecision({ kind: "remove", note });
                            }}
                          >
                            <Trash size={19} />
                            {tr("Remove note")}</button>
                        </>
                      ) : (
                        <>
                          <button
                            disabled={busy}
                            onClick={() => {
                              setReason("spam");
                              setDetail("");
                              setError("");
                              setDecision({ kind: "report", note });
                            }}
                          >
                            <Flag size={19} />
                            {tr("Report note")}</button>
                          <button
                            disabled={busy}
                            onClick={() => {
                              setError("");
                              setDecision({ kind: "block", note });
                            }}
                          >
                            <Prohibit size={19} />
                            {tr("Block player")}</button>
                        </>
                      )}
                    </div>
                  </details>
                </li>
              ))}
            </ul>
          ) : (
            !error && (
              <EmptyState art="ghost" title={tr("No notes nearby yet")}>
                {tr("Leave something for the next ghost passing through.")}</EmptyState>
            )
          )}
          <button
            className="map-notes-secondary-action"
            disabled={busy}
            onClick={() =>
              void operate(async () => {
                await loadBlocks();
                if (current(identity)) setView("blocked");
              })
            }
          >
            <Prohibit size={20} />
            {tr("Blocked players")}</button>
        </>
      )}
      {view === "blocked" && (
        <div className="map-notes-blocks">
          <p>
            {tr("You and blocked players cannot see each other's notes or map position.")}</p>
          {blocks.length ? (
            blocks.map((person) => (
              <div className="map-notes-block" key={person.playerId}>
                <b>{person.name}</b>
                <button
                  disabled={busy}
                  onClick={() =>
                    void operate(async () => {
                      const who = identity;
                      await call("/social/blocks", "DELETE", {
                        targetPlayerId: person.playerId,
                      });
                      if (!current(who)) return;
                      onBlockChange?.();
                      await loadBlocks();
                      if (current(who)) {
                        heading.current?.focus();
                        setNotice(tr("Player unblocked."));
                      }
                    })
                  }
                >
                  {tr("Unblock")}</button>
              </div>
            ))
          ) : (
            <p>{tr("No blocked players.")}</p>
          )}
        </div>
      )}
      {recordNote && onRecord && (
        <NoteRecordDialog
          noteId={recordNote.id}
          noteText={recordNote.text}
          account={recordAccount || null}
          onRecord={onRecord}
          onClose={() => setRecordNote(null)}
        />
      )}
      {decision && (
        <Dialog
          label={
            decision.kind === "remove"
              ? tr("Remove this note?")
              : decision.kind === "block"
                ? tr("Block this player?")
                : tr("Report this note")
          }
          onClose={() => {
            if (!busy) {
              setDecision(null);
              setError("");
            }
          }}
        >
          <form
            className="map-notes-dialog"
            onSubmit={(e) => {
              e.preventDefault();
              void operate(confirmDecision);
            }}
          >
            <h2>
              {decision.kind === "remove"
                ? tr("Remove this note?")
                : decision.kind === "block"
                  ? tr("Block {0}?", { 0: decision.note.author })
                  : tr("Report this note")}
            </h2>
            {decision.kind === "remove" ? (
              <p>
                {tr("It disappears from the map. Copies others saved may remain.")}{onRecord &&
                  tr(" If you kept it as a public record, mark that record removed first under Public record.")}
              </p>
            ) : decision.kind === "block" ? (
              <p>
                {tr("You will no longer see each other's notes or position. Undo this under Blocked players.")}</p>
            ) : (
              <>
                <label htmlFor="map-note-reason">{tr("Reason")}</label>
                <select
                  id="map-note-reason"
                  value={reason}
                  disabled={busy}
                  onChange={(e) => setReason(e.target.value)}
                >
                  <option value="spam">{tr("Spam")}</option>
                  <option value="harassment">{tr("Harassment")}</option>
                  <option value="unsafe-place">{tr("Unsafe place")}</option>
                  <option value="privacy">{tr("Private information")}</option>
                  <option value="other">{tr("Something else")}</option>
                </select>
                <label htmlFor="map-note-detail">{tr("Details (optional)")}</label>
                <textarea
                  id="map-note-detail"
                  maxLength={500}
                  rows={3}
                  value={detail}
                  disabled={busy}
                  onChange={(e) => setDetail(e.target.value)}
                />
                <p>
                  {tr("A reviewer will look at it. Reporting alone does not remove the note.")}</p>
              </>
            )}
            {error && (
              <p className="map-notes-error" role="alert">
                {error}
              </p>
            )}
            <div className="map-notes-actions">
              <button
                type="button"
                autoFocus
                disabled={busy}
                onClick={() => {
                  setDecision(null);
                  setError("");
                }}
              >
                {tr("Cancel")}</button>
              <button className="map-notes-primary" disabled={busy}>
                {busy
                  ? tr("Saving…")
                  : decision.kind === "remove"
                    ? tr("Remove note")
                    : decision.kind === "block"
                      ? tr("Block player")
                      : tr("Send report")}
              </button>
            </div>
          </form>
        </Dialog>
      )}
    </section>
  );
}
