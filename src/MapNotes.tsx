import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowClockwise,
  ArrowLeft,
  Camera,
  ChatCircle,
  Cube,
  DotsThree,
  Flag,
  MapPin,
  Plus,
  Prohibit,
  Trash,
  X,
} from "@phosphor-icons/react";
import { Dialog } from "./Dialog";
import { Ghost } from "./Ghost";
import type { Fix, Point } from "./types";
import { useFormDraft } from "./useFormDraft";
import { browserDraftStorage } from "./form-draft";
import { createReadEpoch } from "./read-epoch";
import { createNotePublicationJournal } from "./note-publication-journal";
import { NoteRecordDialog } from "./NoteRecordDialog";
import type { NoteRecordKind } from "./note-record";
import "./map-notes.css";

export type MapNote = Point & {
  id: string;
  player_id: string;
  author: string;
  text: string;
  image: string | null;
  author_fix: Fix | null;
  created_at: number;
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
};
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
function message(error: unknown) {
  return error instanceof Error && error.name !== "AbortError"
    ? error.message
    : "The connection dropped. Use Check status before trying again.";
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
  const [localView, setLocalView] = useState<MapNotesView>("browse");
  const view = requestedView ?? localView;
  function setView(next: MapNotesView) {
    if (next !== "compose") {
      setConsent(false);
      setShareGps(false);
    }
    setLocalView(next);
    onViewChange?.(next);
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
    [consent, setConsent] = useState(false);
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
    setConsent(false);
    setShareGps(false);
    setError("");
    setNotice("");
    const restored = journal.loadFirst();
    pendingRef.current = restored;
    setPending(restored);
    setAnchor({ ...position });
  }, [identity]);
  useEffect(() => {
    setConsent(false);
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
    setConsent(false);
    setShareGps(false);
    setView(receipt.state === "abandoned" && text ? "compose" : "browse");
    const result =
      receipt.state === "published"
        ? "Your note is on the map."
        : receipt.state === "abandoned"
          ? "The unfinished note was discarded."
          : "This note is no longer visible. It was not posted again.";
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
        `${message(e)} The receipt is kept. Use Check status before writing another note.`,
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
    if (!consent || !text.trim())
      throw Error("Write your note and tick the public-note box first.");
    await publish({
      clientId: crypto.randomUUID(),
      text: text.trim(),
      ...anchor,
      arena,
      image,
      publicConsent: true,
      shareGps,
      fix: shareGps && fix ? { ...fix } : null,
    });
  }
  function choosePhoto(file?: File) {
    if (!file) return;
    if (
      !["image/jpeg", "image/png", "image/webp"].includes(file.type) ||
      file.size > 1000000
    ) {
      setError("Choose a JPG, PNG or WebP photo smaller than 1 MB.");
      return;
    }
    const who = identity,
      version = ++photoGeneration.current;
    const reader = new FileReader();
    setReading(true);
    setError("");
    setConsent(false);
    reader.onload = () => {
      if (current(who) && version === photoGeneration.current) {
        setImage(String(reader.result));
        setReading(false);
      }
    };
    reader.onerror = () => {
      if (current(who) && version === photoGeneration.current) {
        setError("That photo could not be opened. Choose it again.");
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
        "Player blocked. Their notes and map presence are hidden from you.",
      );
    }
    if (selected.kind === "remove") {
      await load();
      if (!current(who)) return;
      heading.current?.focus();
      setNotice("Note removed.");
    }
    if (selected.kind === "report")
      setNotice(
        reportResult?.state === "resolved"
          ? "Your previous report has already been reviewed. No new report was opened."
          : reportResult?.replayed
            ? "Your report is already in the review queue."
            : "Report received. A reviewer will look at it; the note stays until then.",
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
    setConsent(false);
    setShareGps(false);
    setView("browse");
    setNotice(
      removed
        ? "Draft discarded. Published notes are untouched."
        : "Draft cleared here, but this browser kept a copy that may return after reload.",
    );
  }
  return (
    <section className="map-notes" aria-label="Map notes">
      <div className="map-notes-heading">
        <div>
          <span className="map-notes-mode">
            {arena ? "Demo arena" : "Real-world map"}
          </span>
          <h2 ref={heading} tabIndex={-1}>
            {view === "compose"
              ? "Leave a note"
              : view === "blocked"
                ? "Blocked players"
                : "Around you"}
          </h2>
        </div>
        {view === "browse" ? (
          <button
            className="map-notes-primary"
            disabled={locked}
            onClick={() => {
              if (!text && !image) setAnchor({ ...position });
              setConsent(false);
              setShareGps(false);
              setView("compose");
              setError("");
            }}
          >
            <Plus size={20} />
            {draft.hasDraft ? "Resume draft" : "Write a note"}
          </button>
        ) : (
          <button
            className="map-notes-icon"
            aria-label="Back to nearby notes"
            disabled={busy}
            onClick={() => setView("browse")}
          >
            <ArrowLeft size={22} />
          </button>
        )}
      </div>
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
      {draft.hasDraft && (
        <div className="map-notes-draft" aria-label="Note text draft">
          <p className="map-notes-secondary" role="status">
            {draft.storageAvailable
              ? draft.restored
                ? "Your text is back. Check the pin, add a photo again and publish when ready."
                : "Your text is kept on this device. Photo, pin and GPS choice are not."
              : "Your text stays only in this tab; closing or reloading loses it."}
          </p>
          <button type="button" disabled={locked} onClick={discardDraft}>
            <Trash size={18} /> Discard draft
          </button>
        </div>
      )}
      {pending && (
        <section className="map-notes-pending" aria-label="Last note status">
          <b>Check your last note</b>
          <p>
            {pending.receipt?.state === "retryable"
              ? "That attempt did not finish. Retry it or discard it before writing another."
              : "It may already be on the map. Checking never posts it twice."}
          </p>
          {!pending.payload && (
            <p>
              Your text is kept, but the photo, pin and consent are not. Check
              or discard this note before sending again.
            </p>
          )}
          {pending.receipt?.state === "retryable" && retryGpsExpired && (
            <p>
              Its GPS fix has expired. Discard this note and publish your draft
              with a fresh fix.
            </p>
          )}
          <div className="map-notes-actions">
            <button disabled={busy} onClick={() => void operate(checkPending)}>
              <ArrowClockwise size={20} />
              Check status
            </button>
            {pending.receipt?.state === "retryable" && pending.payload && (
              <button
                disabled={busy || retryGpsExpired}
                onClick={() => void operate(() => publish(pending.payload!))}
              >
                Retry this note
              </button>
            )}
            {
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
                Discard note
              </button>
            }
          </div>
        </section>
      )}
      {view === "compose" && (
        <form
          className="map-notes-compose"
          onSubmit={(e) => {
            e.preventDefault();
            void operate(submit);
          }}
        >
          <label htmlFor="map-note-text">What did you discover?</label>
          <textarea
            id="map-note-text"
            ref={composer}
            value={text}
            disabled={locked}
            maxLength={500}
            required
            rows={4}
            placeholder="A quiet bench, a hidden detail, a tip for the next ghost…"
            onChange={(e) => {
              setText(e.target.value);
              setConsent(false);
            }}
          />
          <div className="map-notes-photo-row">
            <label
              className={`map-notes-photo-button ${locked ? "is-disabled" : ""}`}
            >
              <Camera size={22} />
              <span>
                {reading
                  ? "Opening photo…"
                  : image
                    ? "Change photo"
                    : "Add photo"}
              </span>
              <input
                aria-label="Choose a photo"
                type="file"
                accept="image/jpeg,image/png,image/webp"
                disabled={locked || reading}
                onChange={(e) => {
                  choosePhoto(e.target.files?.[0]);
                  e.target.value = "";
                }}
              />
            </label>
            <span className="map-notes-secondary">{text.length}/500</span>
          </div>
          {image && (
            <div className="map-notes-preview">
              <img src={image} alt="Photo selected for this note" />
              <button
                type="button"
                className="map-notes-icon"
                aria-label="Remove selected photo"
                disabled={locked}
                onClick={() => {
                  photoGeneration.current++;
                  setImage(null);
                  setReading(false);
                  setConsent(false);
                }}
              >
                <X size={20} />
              </button>
            </div>
          )}
          <div className="map-notes-anchor">
            <MapPin size={20} />
            <span>
              Public map pin
              <br />
              <span className="map-notes-secondary">
                {anchor.lat.toFixed(5)}, {anchor.lng.toFixed(5)}
              </span>
            </span>
            <button
              type="button"
              disabled={locked}
              onClick={() => {
                setAnchor({ ...position });
                setConsent(false);
              }}
            >
              Use current pin
            </button>
          </div>
          <p className="map-notes-secondary">
            The pin, note, photo and time are public. Photo metadata is removed.
            Notes are stored by QuestLayer only.
          </p>
          <label className="map-notes-check">
            <input
              type="checkbox"
              checked={shareGps}
              disabled={locked || arena || (!shareGps && !freshFix(fix))}
              onChange={(e) => {
                setShareGps(e.target.checked);
                setConsent(false);
              }}
            />
            <span>Also attach my exact GPS position and time</span>
          </label>
          {arena ? (
            <p className="map-notes-secondary">
              The city demo has no real GPS to attach.
            </p>
          ) : (
            !freshFix(fix) && (
              <p className="map-notes-secondary">
                Needs a fresh, accurate GPS fix.
              </p>
            )
          )}
          <label className="map-notes-check">
            <input
              type="checkbox"
              required
              checked={consent}
              disabled={locked}
              onChange={(e) => setConsent(e.target.checked)}
            />
            <span>Publish this note and its pin publicly.</span>
          </label>
          <button
            className="map-notes-primary"
            type="submit"
            disabled={
              locked ||
              reading ||
              !consent ||
              !text.trim() ||
              (shareGps && !freshFix(fix))
            }
          >
            {busy ? "Publishing…" : "Publish note"}
          </button>
        </form>
      )}
      {view === "browse" && (
        <>
          <div className="map-notes-toolbar">
            <span className="map-notes-secondary">Notes near you</span>
            <button
              className="map-notes-icon"
              aria-label="Refresh nearby notes"
              disabled={busy || loading}
              onClick={() => void load()}
            >
              <ArrowClockwise size={21} />
            </button>
          </div>
          {loading ? (
            <p role="status">Looking for nearby notes…</p>
          ) : notes.length ? (
            <div className="map-notes-list">
              {notes.map((note) => (
                <article key={note.id} className="map-note">
                  <header>
                    <Ghost className="map-note-ghost" />
                    <div className="map-note-author">
                      <b>{note.author}</b>
                      <time dateTime={new Date(note.created_at).toISOString()}>
                        {new Date(note.created_at).toLocaleString("en-US", {
                          day: "numeric",
                          month: "short",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </time>
                    </div>
                    <details className="map-note-menu">
                      <summary aria-label={`Actions for ${note.author}'s note`}>
                        <DotsThree size={26} />
                      </summary>
                      <div>
                        {note.own ? (
                          <>
                            {onRecord && (
                              <button
                                disabled={busy}
                                onClick={() => setRecordNote(note)}
                              >
                                <Cube size={19} />
                                Public record
                              </button>
                            )}
                            <button
                              disabled={busy}
                              onClick={() => {
                                setError("");
                                setDecision({ kind: "remove", note });
                              }}
                            >
                              <Trash size={19} />
                              Remove note
                            </button>
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
                              Report note
                            </button>
                            <button
                              disabled={busy}
                              onClick={() => {
                                setError("");
                                setDecision({ kind: "block", note });
                              }}
                            >
                              <Prohibit size={19} />
                              Block player
                            </button>
                          </>
                        )}
                      </div>
                    </details>
                  </header>
                  <p>{note.text}</p>
                  {note.image && (
                    <img
                      className="map-note-image"
                      src={note.image}
                      alt={`Photo attached to ${note.author}'s note`}
                      loading="lazy"
                    />
                  )}
                  <details className="map-note-location">
                    <summary>
                      <MapPin size={18} />
                      Location details
                    </summary>
                    <p>
                      Map pin: {note.lat.toFixed(5)}, {note.lng.toFixed(5)}
                    </p>
                    {note.author_fix && (
                      <p>
                        Author GPS: {note.author_fix.lat.toFixed(5)},{" "}
                        {note.author_fix.lng.toFixed(5)} · accuracy{" "}
                        {Math.round(note.author_fix.accuracy)} m ·{" "}
                        {new Date(note.author_fix.timestamp).toLocaleString(
                          "en-US",
                        )}
                      </p>
                    )}
                  </details>
                </article>
              ))}
            </div>
          ) : (
            !error && (
              <div className="map-notes-empty">
                <ChatCircle size={36} />
                <h3>No notes nearby yet</h3>
                <p>Leave something for the next ghost passing through.</p>
              </div>
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
            Blocked players
          </button>
        </>
      )}
      {view === "blocked" && (
        <div className="map-notes-blocks">
          <p>
            You and blocked players cannot see each other's notes or map
            position.
          </p>
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
                        setNotice("Player unblocked.");
                      }
                    })
                  }
                >
                  Unblock
                </button>
              </div>
            ))
          ) : (
            <p>No blocked players.</p>
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
              ? "Remove this note?"
              : decision.kind === "block"
                ? "Block this player?"
                : "Report this note"
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
                ? "Remove this note?"
                : decision.kind === "block"
                  ? `Block ${decision.note.author}?`
                  : "Report this note"}
            </h2>
            {decision.kind === "remove" ? (
              <p>
                It disappears from the map. Copies others saved may remain.
                {onRecord &&
                  " If you kept it as a public record, mark that record removed first under Public record."}
              </p>
            ) : decision.kind === "block" ? (
              <p>
                You will no longer see each other's notes or position. Undo this
                under Blocked players.
              </p>
            ) : (
              <>
                <label htmlFor="map-note-reason">Reason</label>
                <select
                  id="map-note-reason"
                  value={reason}
                  disabled={busy}
                  onChange={(e) => setReason(e.target.value)}
                >
                  <option value="spam">Spam</option>
                  <option value="harassment">Harassment</option>
                  <option value="unsafe-place">Unsafe place</option>
                  <option value="privacy">Private information</option>
                  <option value="other">Something else</option>
                </select>
                <label htmlFor="map-note-detail">Details (optional)</label>
                <textarea
                  id="map-note-detail"
                  maxLength={500}
                  rows={3}
                  value={detail}
                  disabled={busy}
                  onChange={(e) => setDetail(e.target.value)}
                />
                <p>
                  A reviewer will look at it. Reporting alone does not remove
                  the note.
                </p>
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
                Cancel
              </button>
              <button className="map-notes-primary" disabled={busy}>
                {busy
                  ? "Saving…"
                  : decision.kind === "remove"
                    ? "Remove note"
                    : decision.kind === "block"
                      ? "Block player"
                      : "Send report"}
              </button>
            </div>
          </form>
        </Dialog>
      )}
    </section>
  );
}
