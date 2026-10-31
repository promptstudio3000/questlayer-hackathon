export type CharacterModelDescriptor = {
  available: true;
  source: "starter" | "original";
  tokenId: string | null;
  src: string;
  digest: string;
  complete: boolean;
  mapCompatible?: boolean;
  backgroundOmitted?: boolean;
  optimized?: boolean;
  stats: { bytes: number; meshes: number };
};

// Keep at most two verified downloads, never ownership/descriptor responses.
const downloads = new Map<string, { bytes: ArrayBuffer; until: number }>();
export async function loadCharacterModel(
  originTokenId: string | undefined,
  signal: AbortSignal,
  { forMap = false }: { forMap?: boolean } = {},
) {
  const response = await fetch("/api/character/model", {
    credentials: "same-origin",
    signal,
  });
  const data = await response.json();
  if (!response.ok) throw Error(data.error || "This 3D look is unavailable.");
  if (
    data.available !== true ||
    typeof data.complete !== "boolean" ||
    !/^[a-f0-9]{64}$/.test(data.digest) ||
    data.src !== `/api/character/assets/${data.digest}.glb` ||
    data.source !== (originTokenId ? "original" : "starter") ||
    (originTokenId && data.tokenId !== originTokenId)
  )
    throw Error("This 3D look does not match your selected appearance.");
  if (forMap && !data.complete && data.mapCompatible !== true)
    throw Error(
      "This outfit uses its complete original 2D appearance on the map.",
    );
  const cached = downloads.get(data.digest);
  if (cached && cached.until > Date.now()) {
    signal.throwIfAborted();
    return {
      descriptor: data as CharacterModelDescriptor,
      bytes: cached.bytes.slice(0),
    };
  }
  const model = await fetch(data.src, { credentials: "same-origin", signal });
  if (!model.ok) throw Error("The 3D look expired. Please try again.");
  const bytes = await model.arrayBuffer();
  if (!bytes.byteLength || bytes.byteLength > 6 * 1024 * 1024)
    throw Error("This 3D look exceeds the device download budget.");
  const digest = [
    ...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
  ]
    .map((n) => n.toString(16).padStart(2, "0"))
    .join("");
  if (digest !== data.digest) throw Error("The 3D look could not be verified.");
  signal.throwIfAborted();
  for (const [key, entry] of downloads)
    if (entry.until <= Date.now()) downloads.delete(key);
  while (downloads.size >= 2) downloads.delete(downloads.keys().next().value!);
  downloads.set(digest, { bytes: bytes.slice(0), until: Date.now() + 300000 });
  return { descriptor: data as CharacterModelDescriptor, bytes };
}
