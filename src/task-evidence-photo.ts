// Private photo evidence for sponsored tasks: client helpers.
// The photo itself stays on the QuestLayer server, visible only to the
// claimant, the task sponsor and the disclosed arbiter. The chain stores only
// the content hash of {text, reference, photo}; the key order is part of the
// commitment and matches server/task-evidence.mjs.

export type EvidencePhotoState =
  "staged" | "committed" | "withheld" | "deleted" | "expired" | "erased";
export type EvidencePhoto = {
  id: string;
  taskId: number;
  accountId: string;
  sha256: string;
  state: EvidencePhotoState;
  submissionId: number | null;
  createdAt: number;
  expiresAt: number;
  closedAt: number | null;
  closeReason: string | null;
  role: "owner" | "sponsor" | "arbiter";
};
export type EvidencePhotoList = {
  taskId: number;
  own: EvidencePhoto[];
  review: EvidencePhoto[];
  policy: {
    stagedTtlMs: number;
    afterSettlementMs: number;
    maxRetentionMs: number;
  };
};

export function evidenceCommitment(
  text: string,
  reference: string,
  photo = "",
) {
  return photo ? { text, reference, photo } : { text, reference };
}

// UI copy for each state, used by both the claimant and reviewer views.
export function evidencePhotoStatus(photo: EvidencePhoto, now = Date.now()) {
  const days = Math.max(0, Math.ceil((photo.expiresAt - now) / 86400000));
  const hours = Math.max(0, Math.ceil((photo.expiresAt - now) / 3600000));
  switch (photo.state) {
    case "staged":
      return `Private photo ready. Submit evidence within ${hours} h or it is erased.`;
    case "committed":
      return `Private photo linked to evidence #${(photo.submissionId ?? 0) + 1}. Visible only to you, the sponsor and the arbiter. Erased within ${days} days.`;
    case "withheld":
      return "Withheld while moderation reviews this photo.";
    case "deleted":
      return "You erased this photo.";
    case "expired":
      return "Erased by the retention policy.";
    case "erased":
      return "Erased by moderation.";
  }
}

export function photoQuery(accountId: string, taskId: number) {
  return `accountId=${encodeURIComponent(accountId)}&taskId=${taskId}`;
}

async function json<T>(response: Response): Promise<T> {
  const data = await response.json().catch(() => ({}));
  if (!response.ok)
    throw Object.assign(
      new Error(data.error || "Photo evidence is unavailable right now."),
      { status: response.status },
    );
  return data as T;
}
export async function listEvidencePhotos(accountId: string, taskId: number) {
  return json<EvidencePhotoList>(
    await fetch(`/api/native/tasks/evidence?${photoQuery(accountId, taskId)}`, {
      credentials: "same-origin",
    }),
  );
}
export async function uploadEvidencePhoto(
  accountId: string,
  taskId: number,
  image: string,
) {
  return json<EvidencePhoto>(
    await fetch("/api/native/tasks/evidence", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accountId, taskId, image }),
    }),
  );
}
export async function removeEvidencePhoto(photoId: string) {
  return json<EvidencePhoto>(
    await fetch(`/api/native/tasks/evidence/${photoId}`, {
      method: "DELETE",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    }),
  );
}
export async function reportEvidencePhoto(
  photoId: string,
  accountId: string,
  taskId: number,
  reason: string,
) {
  return json<{ id: string; state: string }>(
    await fetch(`/api/native/tasks/evidence/${photoId}/report`, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accountId, taskId, reason }),
    }),
  );
}
// Reads go through fetch so the session cookie and role checks apply; the
// result is a short-lived object URL the caller must revoke.
export async function loadEvidencePhoto(
  photoId: string,
  accountId: string,
  taskId: number,
) {
  const response = await fetch(
    `/api/native/tasks/evidence/${photoId}?${photoQuery(accountId, taskId)}`,
    { credentials: "same-origin" },
  );
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw Object.assign(
      new Error(data.error || "This photo is not available."),
      { status: response.status },
    );
  }
  return URL.createObjectURL(await response.blob());
}
export function readPhotoFile(file: File) {
  return new Promise<string>((resolve, reject) => {
    if (!/^image\/(jpeg|png|webp)$/.test(file.type))
      return reject(new Error("Use a JPG, PNG or WebP image."));
    if (file.size > 1_000_000)
      return reject(new Error("Use an image smaller than 1 MB."));
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("This image could not be read."));
    reader.readAsDataURL(file);
  });
}
