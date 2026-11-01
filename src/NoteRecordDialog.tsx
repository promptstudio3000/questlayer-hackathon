import { useEffect, useState } from "react";
import { ArrowClockwise, ArrowSquareOut } from "@phosphor-icons/react";
import { Dialog } from "./Dialog";
import { EXPLORER_BASE } from "./near-network.ts";
import {
  recordView,
  type NoteRecordKind,
  type NoteRecordStatus,
} from "./note-record";

type Account = { accountId: string; managed: boolean };
const PIN_COPY: Record<string, string> = {
  computed: "Photo address ready, waiting to be pinned.",
  pinning: "Photo is being pinned.",
  pinned: "Photo pinned.",
  mismatch: "Photo pin returned a different address; we keep retrying.",
  unavailable: "Photo pinning is not set up on this server yet.",
};

async function readStatus(noteId: string, accountId: string) {
  const response = await fetch(
    `/api/native/records?note=${encodeURIComponent(noteId)}&accountId=${encodeURIComponent(accountId)}`,
    { credentials: "same-origin" },
  );
  const value = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = Error(
      value.error || "Public records are unavailable right now.",
    ) as Error & { code?: string };
    error.code = value.code;
    throw error;
  }
  return value as NoteRecordStatus;
}

// The author's view of one note's public record: current state, permanence
// disclosure, photo address and pin state, then publish or mark removed.
export function NoteRecordDialog({
  noteId,
  noteText,
  account,
  onRecord,
  onClose,
  read = readStatus,
}: {
  noteId: string;
  noteText: string;
  account: Account | null;
  onRecord: (noteId: string, kind: NoteRecordKind) => Promise<boolean>;
  onClose: () => void;
  read?: typeof readStatus;
}) {
  const [status, setStatus] = useState<NoteRecordStatus | null>(null),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [publicConsent, setPublicConsent] = useState(false),
    [permanence, setPermanence] = useState(false),
    [revision, setRevision] = useState(0);
  const accountId = account?.accountId || "";
  useEffect(() => {
    if (!accountId) {
      setLoading(false);
      return;
    }
    let current = true;
    setLoading(true);
    read(noteId, accountId)
      .then((value) => {
        if (!current) return;
        setStatus(value);
        setError("");
      })
      .catch((e: Error & { code?: string }) => {
        if (!current) return;
        setError(
          e.code === "RECORDS_DISABLED"
            ? "Public records are not switched on for this server yet."
            : e.code === "ACCOUNT_NOT_READY"
              ? "Your explorer account is still being prepared. Try again in a minute."
              : e.message,
        );
      })
      .finally(() => current && setLoading(false));
    return () => {
      current = false;
    };
  }, [noteId, accountId, revision, read]);
  const view = recordView(status, noteText),
    kind: NoteRecordKind = view === "published" ? "tombstone" : "note",
    ready = publicConsent && permanence && !busy && !loading && !!status;
  async function submit() {
    if (!ready) return;
    setBusy(true);
    try {
      await onRecord(noteId, kind);
      setPublicConsent(false);
      setPermanence(false);
    } finally {
      setBusy(false);
      setRevision((r) => r + 1);
    }
  }
  const title =
    view === "published" ? "Public record" : "Keep this note on NEAR Social";
  return (
    <Dialog label={title} onClose={() => !busy && onClose()}>
      <form
        className="map-notes-dialog note-record"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <h2>{title}</h2>
        {!account ? (
          <p role="status">
            Your explorer account is still being prepared. Records can be
            published once it is ready.
          </p>
        ) : loading && !status ? (
          <p role="status">Checking NEAR Social…</p>
        ) : error && !status ? (
          <p className="map-notes-error" role="alert">
            {error}
          </p>
        ) : status ? (
          <>
            <p className="note-record-state" role="status">
              {view === "none" &&
                "Not published yet. Today it lives only in QuestLayer."}
              {view === "pending" &&
                "A record was sent but is not confirmed yet. Refresh in a moment."}
              {view === "published" && "Published under your account."}
              {view === "outdated" &&
                "Published, but your note changed since. Publish again to update it."}
              {view === "removed" &&
                "Marked removed. Earlier versions stay readable in history."}
            </p>
            {status.media && (
              <p className="note-record-media">
                <span>Photo address</span>
                <code>{status.media.cid}</code>
                <small>{PIN_COPY[status.media.state] || ""}</small>
              </p>
            )}
            <p>
              {kind === "note"
                ? "This copies the note text, its map pin and photo address to a public record under "
                : "This replaces the record under "}
              <strong>{status.accountId}</strong>
              {kind === "note"
                ? "."
                : " with a removal marker. It does not erase copies others made."}
            </p>
            <label className="profile-consent">
              <input
                type="checkbox"
                checked={publicConsent}
                disabled={busy}
                onChange={(e) => setPublicConsent(e.target.checked)}
              />
              <span>
                {kind === "note"
                  ? "Anyone can read this record."
                  : "I want this record marked as removed."}
              </span>
            </label>
            <label className="profile-consent">
              <input
                type="checkbox"
                checked={permanence}
                disabled={busy}
                onChange={(e) => setPermanence(e.target.checked)}
              />
              <span>
                I understand a public record cannot be fully erased later.
                <small>{status.permanence}</small>
              </span>
            </label>
            <p className="note-record-fee">
              {account.managed
                ? "No popup and no fee: QuestLayer covers the storage."
                : "Your wallet asks you to approve. Storage credit may be attached."}
            </p>
            {error && (
              <p className="map-notes-error" role="alert">
                {error}
              </p>
            )}
          </>
        ) : null}
        <div className="map-notes-actions">
          <button type="button" disabled={busy} onClick={onClose}>
            Close
          </button>
          {status && (
            <button
              type="button"
              disabled={busy || loading}
              aria-label="Refresh record status"
              onClick={() => setRevision((r) => r + 1)}
            >
              <ArrowClockwise size={18} />
            </button>
          )}
          {status && (
            <button className="map-notes-primary" disabled={!ready}>
              {busy
                ? account?.managed
                  ? "Publishing…"
                  : "Confirm in your wallet…"
                : kind === "tombstone"
                  ? "Mark record removed"
                  : view === "outdated"
                    ? "Publish update"
                    : "Publish record"}
            </button>
          )}
        </div>
        {status?.chain && (
          <a
            className="note-record-link"
            href={`${EXPLORER_BASE}/address/${status.accountId}`}
            target="_blank"
            rel="noreferrer"
          >
            Account history
            <ArrowSquareOut aria-hidden="true" />
          </a>
        )}
      </form>
    </Dialog>
  );
}
