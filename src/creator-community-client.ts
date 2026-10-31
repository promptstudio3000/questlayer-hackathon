type StoragePort = Pick<Storage, "getItem" | "setItem" | "removeItem">;
type JournalEntry = { fingerprint: string; operationId: string };
export class CreatorClientError extends Error {
  status: number;
  code: string;
  constructor(message: string, status = 0, code = "CREATOR_UNAVAILABLE") {
    super(message);
    this.status = status;
    this.code = code;
  }
}
const canonical = (value: unknown): string =>
  JSON.stringify(value, (_, v) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(
          Object.keys(v)
            .sort()
            .map((k) => [k, v[k]]),
        )
      : v,
  );
const browserStorage = () => {
  try {
    return localStorage;
  } catch {
    return null;
  }
};
const digest = async (value: string) =>
  [
    ...new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
    ),
  ]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

export function createCreatorClient(options: {
  playerId: string;
  fetcher?: typeof fetch;
  storage?: StoragePort | null;
  makeId?: () => string;
}) {
  const fetcher = options.fetcher || fetch;
  const storage =
    options.storage === undefined ? browserStorage() : options.storage;
  const makeId = options.makeId || (() => `creator-ui:${crypto.randomUUID()}`);
  const key = `questlayer.creator-retries.v1:${encodeURIComponent(options.playerId)}`;
  let entries: JournalEntry[] = [];
  let durable = !!storage;
  try {
    const raw = storage?.getItem(key);
    if (raw && raw.length <= 32768) {
      const saved = JSON.parse(raw);
      if (saved.version === 1 && Array.isArray(saved.entries))
        entries = saved.entries
          .filter(
            (r: JournalEntry) =>
              r &&
              /^[a-f0-9]{64}$/.test(r.fingerprint) &&
              /^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,127}$/.test(r.operationId),
          )
          .slice(-64);
    }
  } catch {
    durable = false;
  }
  const persist = () => {
    if (!durable || !storage) return;
    try {
      storage.setItem(key, JSON.stringify({ version: 1, entries }));
    } catch {
      durable = false;
    }
  };
  async function request<T>(
    path: string,
    method: string,
    body?: unknown,
    signal?: AbortSignal,
  ): Promise<T> {
    const controller = new AbortController();
    const cancel = () => controller.abort();
    signal?.addEventListener("abort", cancel, { once: true });
    if (signal?.aborted) cancel();
    const timeout = setTimeout(cancel, 20000);
    try {
      const response = await fetcher(`/api/creator-community${path}`, {
        method,
        credentials: "same-origin",
        signal: controller.signal,
        ...(body === undefined
          ? {}
          : {
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(body),
            }),
      });
      let value;
      try {
        value = await response.json();
      } catch {
        throw new CreatorClientError(
          "The creator service returned an unreadable response. Refresh, then retry the same action.",
          response.status,
        );
      }
      if (!response.ok)
        throw new CreatorClientError(
          value?.error || "Creator action could not be confirmed.",
          response.status,
          value?.code,
        );
      return value as T;
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", cancel);
    }
  }
  return {
    playerId: options.playerId,
    read: <T>(path: string, signal?: AbortSignal) =>
      request<T>(path, "GET", undefined, signal),
    get durable() {
      return durable;
    },
    async mutate<T = Record<string, unknown>>(
      path: string,
      method: "POST" | "PUT",
      body: Record<string, unknown>,
    ): Promise<T> {
      // Only opaque fingerprints and IDs persist: no content, GPS or consent.
      // A retry happens only after another deliberate player action.
      const fingerprint = await digest(
        canonical({ playerId: options.playerId, path, method, body }),
      );
      const social =
        method === "PUT" && path.match(/^\/creators\/[^/]+\/(follow|block)$/);
      const desired =
        social && (social[1] === "follow" ? "following" : "blocked");
      if (desired && typeof body[desired] === "boolean") {
        // A later explicit opposite intent supersedes an unconfirmed old toggle.
        // Otherwise true -> lost reply -> false -> true could replay the first receipt.
        const obsolete = await digest(
          canonical({
            playerId: options.playerId,
            path,
            method,
            body: { ...body, [desired]: !body[desired] },
          }),
        );
        if (entries.some((r) => r.fingerprint === obsolete)) {
          entries = entries.filter((r) => r.fingerprint !== obsolete);
          persist();
        }
      }
      let entry = entries.find((r) => r.fingerprint === fingerprint);
      if (!entry) {
        entry = { fingerprint, operationId: makeId() };
        entries = [...entries, entry].slice(-64);
        persist();
      }
      const value = await request<
        T & { operationId?: string; domain?: string }
      >(path, method, { ...body, operationId: entry.operationId });
      if (
        !value ||
        value.operationId !== entry.operationId ||
        value.domain !== "demo"
      )
        throw new CreatorClientError(
          "This action did not return a matching demo receipt. Refresh, then retry the same terms.",
        );
      entries = entries.filter((r) => r !== entry);
      persist();
      return value;
    },
  };
}
export type CreatorClient = ReturnType<typeof createCreatorClient>;

export function creatorDraftIdentity(
  playerId: string,
  storage: StoragePort | null = browserStorage(),
) {
  const key = `questlayer.creator-new-quest.v1:${encodeURIComponent(playerId)}`;
  let id: string | null = null;
  try {
    id = storage?.getItem(key) || null;
  } catch {
    /* Current-tab draft creation remains available. */
  }
  if (!id || !/^creator-[a-f0-9-]{36}$/.test(id)) {
    id = `creator-${crypto.randomUUID()}`;
    try {
      storage?.setItem(key, id);
    } catch {
      /* The server still enforces stable request identity. */
    }
  }
  return {
    id,
    clear: () => {
      try {
        if (storage?.getItem(key) === id) storage.removeItem(key);
      } catch {
        /* No claim or publication right is removed here. */
      }
    },
  };
}
