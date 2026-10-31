type JournalStorage = Pick<
  Storage,
  "getItem" | "setItem" | "removeItem" | "key" | "length"
>;
export type NotePublicationIntent = {
  clientId: string;
  draftRevision?: string | null;
};
const operationId = (v: unknown): v is string =>
  typeof v === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(v);
export function createNotePublicationJournal(
  playerId: string,
  arena: boolean,
  storage: JournalStorage | null,
  legacyStorage?: Pick<Storage, "getItem" | "removeItem"> | null,
) {
  const prefix = `questlayer:note-operation:v2:${JSON.stringify([playerId, arena ? "arena" : "physical"])}:`;
  const legacyKey = `questlayer:note-operation:v1:${playerId}:${arena ? "arena" : "physical"}`;
  function loadFirst(): NotePublicationIntent | null {
    const intents: {
      clientId: string;
      draftRevision: string | null;
      createdAt: number;
    }[] = [];
    try {
      for (let index = 0; storage && index < storage.length; index++) {
        const key = storage.key(index);
        if (!key?.startsWith(prefix)) continue;
        const raw = storage.getItem(key);
        if (!raw || raw.length > 1024) continue;
        try {
          const value = JSON.parse(raw);
          if (
            value?.version === 2 &&
            operationId(value.clientId) &&
            key === prefix + value.clientId &&
            (value.draftRevision === null ||
              (typeof value.draftRevision === "string" &&
                value.draftRevision.length <= 128)) &&
            Number.isFinite(value.createdAt)
          ) {
            intents.push({
              clientId: value.clientId,
              draftRevision: value.draftRevision,
              createdAt: value.createdAt,
            });
            if (intents.length >= 64) break;
          }
        } catch {
          /* A corrupted local record never establishes a publication outcome. */
        }
      }
    } catch {
      /* Legacy status recovery is still useful if durable storage is blocked. */
    }
    if (intents.length) {
      const oldest = intents.sort(
        (a, b) =>
          a.createdAt - b.createdAt || a.clientId.localeCompare(b.clientId),
      )[0];
      return { clientId: oldest.clientId, draftRevision: oldest.draftRevision };
    }
    try {
      const legacy = legacyStorage?.getItem(legacyKey);
      if (operationId(legacy)) return { clientId: legacy };
    } catch {
      /* Never turn a storage failure into a successful receipt. */
    }
    return null;
  }
  function remember(clientId: string, draftRevision: string | null) {
    if (!storage || !operationId(clientId))
      throw new Error("A durable publication receipt could not be saved.");
    const key = prefix + clientId;
    // One record per operation avoids one tab overwriting another unknown outcome.
    try {
      const raw = storage.getItem(key);
      const prior = raw ? JSON.parse(raw) : null;
      if (
        prior?.version === 2 &&
        prior.clientId === clientId &&
        (prior.draftRevision === null ||
          typeof prior.draftRevision === "string") &&
        Number.isFinite(prior.createdAt)
      )
        return;
    } catch {
      /* Replace malformed metadata; get/set failures still fail before sending. */
    }
    storage.setItem(
      key,
      JSON.stringify({
        version: 2,
        clientId,
        draftRevision,
        createdAt: Date.now(),
      }),
    );
  }
  function clear(clientId: string) {
    if (!operationId(clientId)) return;
    storage?.removeItem(prefix + clientId);
    if (legacyStorage?.getItem(legacyKey) === clientId)
      legacyStorage.removeItem(legacyKey);
  }
  return { loadFirst, remember, clear };
}
