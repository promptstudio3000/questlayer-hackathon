import { useEffect, useRef, useState } from "react";
import { Camera, Flag, LockKey, Trash } from "@phosphor-icons/react";
import {
  evidencePhotoStatus,
  listEvidencePhotos,
  loadEvidencePhoto,
  readPhotoFile,
  removeEvidencePhoto,
  reportEvidencePhoto,
  uploadEvidencePhoto,
  type EvidencePhoto,
} from "./task-evidence-photo";
import { tr } from "./i18n";

type PickerState =
  | { kind: "idle" }
  | { kind: "working"; label: string }
  | { kind: "ready"; photo: EvidencePhoto }
  | { kind: "error"; message: string; limited: boolean };

function usePhotoUrl(
  photo: EvidencePhoto | null,
  accountId: string,
  taskId: number,
) {
  const [state, setState] = useState<
    { url: string } | { error: string } | null
  >(null);
  useEffect(() => {
    if (!photo || !["staged", "committed"].includes(photo.state)) {
      setState(null);
      return;
    }
    let url = "",
      live = true;
    setState(null);
    loadEvidencePhoto(photo.id, accountId, taskId)
      .then((value) => {
        url = value;
        if (live) setState({ url });
        else URL.revokeObjectURL(url);
      })
      .catch((e: Error) => live && setState({ error: e.message }));
    return () => {
      live = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [photo?.id, photo?.state, accountId, taskId]);
  return state;
}

// Claimant side: attach one private photo whose digest the evidence commits to.
export function EvidencePhotoPicker({
  accountId,
  taskId,
  disabled,
  onPhoto,
}: {
  accountId: string;
  taskId: number;
  disabled: boolean;
  onPhoto: (photo: EvidencePhoto | null) => void;
}) {
  const [state, setState] = useState<PickerState>({ kind: "idle" });
  const input = useRef<HTMLInputElement>(null);
  const photo = state.kind === "ready" ? state.photo : null;
  const preview = usePhotoUrl(photo, accountId, taskId);
  useEffect(() => {
    let live = true;
    setState({ kind: "idle" });
    onPhoto(null);
    if (!accountId) return;
    // Recover a photo uploaded earlier for this task that is not submitted yet.
    listEvidencePhotos(accountId, taskId)
      .then((list) => {
        const staged = list.own.find((p) => p.state === "staged");
        if (live && staged) {
          setState({ kind: "ready", photo: staged });
          onPhoto(staged);
        }
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [accountId, taskId]);
  async function choose(file: File | undefined) {
    if (!file) return;
    try {
      setState({ kind: "working", label: tr("Removing location data…") });
      const data = await readPhotoFile(file);
      setState({ kind: "working", label: tr("Uploading privately…") });
      const uploaded = await uploadEvidencePhoto(accountId, taskId, data);
      setState({ kind: "ready", photo: uploaded });
      onPhoto(uploaded);
    } catch (e) {
      const error = e as Error & { status?: number };
      setState({
        kind: "error",
        message: error.message,
        limited: error.status === 429,
      });
      onPhoto(null);
    } finally {
      if (input.current) input.current.value = "";
    }
  }
  async function remove() {
    if (!photo) return;
    try {
      setState({ kind: "working", label: tr("Erasing photo…") });
      await removeEvidencePhoto(photo.id);
      setState({ kind: "idle" });
      onPhoto(null);
    } catch (e) {
      setState({
        kind: "error",
        message: (e as Error).message,
        limited: false,
      });
    }
  }
  return (
    <fieldset className="task-photo" aria-live="polite">
      <legend>
        <LockKey aria-hidden="true" /> {" "}{tr("Private photo (optional)")}</legend>
      <p className="task-secondary">
        {tr("Only you, the sponsor and the arbiter can see it. Location data is removed. Only its fingerprint goes on chain; the photo is erased 30 days after the task settles, or within 24 hours if you do not submit.")}</p>
      <input
        ref={input}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        capture="environment"
        hidden
        onChange={(e) => void choose(e.target.files?.[0])}
      />
      {state.kind === "working" && (
        <p className="task-photo-status" role="status">
          {state.label}
        </p>
      )}
      {state.kind === "error" && (
        <p className="task-photo-status task-alert" role="alert">
          {state.message}
          {state.limited ? tr(" Your text evidence can still be submitted.") : ""}
        </p>
      )}
      {photo && (
        <div className="task-photo-ready">
          {preview && "url" in preview ? (
            <img src={preview.url} alt={tr("Your private evidence photo")} />
          ) : (
            <span className="task-photo-placeholder" aria-hidden="true">
              <Camera />
            </span>
          )}
          <p className="task-secondary">{evidencePhotoStatus(photo)}</p>
          <button
            type="button"
            className="secondary-button"
            onClick={() => void remove()}
            disabled={disabled}
          >
            <Trash aria-hidden="true" /> {" "}{tr("Erase photo")}</button>
        </div>
      )}
      {!photo && state.kind !== "working" && (
        <button
          type="button"
          className="secondary-button"
          disabled={disabled || !accountId}
          onClick={() => input.current?.click()}
        >
          <Camera aria-hidden="true" />{" "}
          {state.kind === "error" ? tr("Try another photo") : tr("Add private photo")}
        </button>
      )}
    </fieldset>
  );
}

// Sponsor/arbiter side, and the claimant's own receipt: the photo bound to one
// submission, if any.
export function EvidencePhotoViewer({
  accountId,
  taskId,
  submissionId,
  canReport,
}: {
  accountId: string;
  taskId: number;
  submissionId: number;
  canReport: boolean;
}) {
  const [photo, setPhoto] = useState<EvidencePhoto | null | undefined>(
    undefined,
  );
  const [error, setError] = useState("");
  const [reported, setReported] = useState(false);
  useEffect(() => {
    let live = true;
    setPhoto(undefined);
    setError("");
    setReported(false);
    if (!accountId) return;
    listEvidencePhotos(accountId, taskId)
      .then((list) => {
        if (!live) return;
        const found = [...list.review, ...list.own].find(
          (p) => p.submissionId === submissionId,
        );
        setPhoto(found ?? null);
      })
      .catch((e: Error) => live && setError(e.message));
    return () => {
      live = false;
    };
  }, [accountId, taskId, submissionId]);
  const image = usePhotoUrl(photo ?? null, accountId, taskId);
  if (error)
    return (
      <p className="task-photo-status task-secondary" role="status">
        {tr("Private photo status is unavailable:")}{" "}{error}
      </p>
    );
  if (photo === undefined)
    return (
      <p className="task-photo-status task-secondary" role="status">
        {tr("Checking for a private photo…")}</p>
    );
  if (photo === null) return null;
  return (
    <div className="task-photo-ready">
      {image && "url" in image ? (
        <img
          src={image.url}
          alt={tr("Private photo for evidence #{0}", { 0: submissionId + 1 })}
        />
      ) : image && "error" in image ? (
        <p className="task-secondary" role="status">
          {image.error}
        </p>
      ) : ["staged", "committed"].includes(photo.state) ? (
        <p className="task-secondary" role="status">
          {tr("Loading private photo…")}</p>
      ) : null}
      <p className="task-secondary">{evidencePhotoStatus(photo)}</p>
      {canReport && photo.role !== "owner" && photo.state === "committed" && (
        <button
          type="button"
          className="secondary-button"
          disabled={reported}
          onClick={() =>
            reportEvidencePhoto(photo.id, accountId, taskId, "harassment")
              .then(() => setReported(true))
              .catch((e: Error) => setError(e.message))
          }
        >
          <Flag aria-hidden="true" />{" "}
          {reported ? tr("Reported to moderation") : tr("Report this photo")}
        </button>
      )}
    </div>
  );
}
