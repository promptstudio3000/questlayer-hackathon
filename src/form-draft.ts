// Local editable strings only. A draft never proves consent, a visit or an operation result.
export type DraftStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
export type DraftFields<T extends Record<string, string>> = {
  readonly [K in keyof T]: number;
};
export type DraftScope = { playerId: string; form: string; realm: string };
export type StoredFormDraft<T extends Record<string, string>> = {
  values: T;
  revision: string;
  updatedAt: number;
};
export function formDraftKey(scope: DraftScope) {
  return `questlayer:form-draft:v1:${JSON.stringify([scope.playerId, scope.form, scope.realm])}`;
}
export function browserDraftStorage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}
export function createFormDraftStore<
  T extends Record<string, string>,
>(options: {
  scope: DraftScope;
  fields: DraftFields<T>;
  storage?: DraftStorage | null;
  clock?: () => number;
  newRevision?: () => string;
}) {
  const { scope, fields } = options;
  const storage =
    options.storage === undefined ? browserDraftStorage() : options.storage;
  const key = formDraftKey(scope);
  const names = Object.keys(fields) as (keyof T)[];
  if (
    !scope.playerId ||
    !scope.form ||
    !scope.realm ||
    !names.length ||
    names.some(
      (name) =>
        !Number.isSafeInteger(fields[name]) ||
        fields[name] < 1 ||
        fields[name] > 20000,
    )
  )
    throw new Error(
      "A draft needs an explicit scope and bounded string fields.",
    );
  function project(input: unknown): T | null {
    if (!input || typeof input !== "object" || Array.isArray(input))
      return null;
    const value = input as Record<string, unknown>;
    const result: Record<string, string> = {};
    for (const name of names) {
      if (
        typeof value[name as string] !== "string" ||
        (value[name as string] as string).length > fields[name]
      )
        return null;
      result[name as string] = value[name as string] as string;
    }
    return result as T;
  }
  function load(): { draft: StoredFormDraft<T> | null; available: boolean } {
    if (!storage) return { draft: null, available: false };
    let raw: string | null;
    try {
      raw = storage.getItem(key);
    } catch {
      return { draft: null, available: false };
    }
    if (!raw || raw.length > 65536) return { draft: null, available: true };
    try {
      const value = JSON.parse(raw);
      const values = project(value?.values);
      if (
        value?.version !== 1 ||
        value?.scope?.playerId !== scope.playerId ||
        value?.scope?.form !== scope.form ||
        value?.scope?.realm !== scope.realm ||
        typeof value.revision !== "string" ||
        !value.revision ||
        value.revision.length > 128 ||
        !Number.isFinite(value.updatedAt) ||
        !values
      )
        return { draft: null, available: true };
      return {
        draft: { values, revision: value.revision, updatedAt: value.updatedAt },
        available: true,
      };
    } catch {
      return { draft: null, available: true };
    }
  }
  function save(input: T): StoredFormDraft<T> | null {
    const values = project(input);
    if (!storage || !values) return null;
    const draft = {
      values,
      revision: options.newRevision?.() || crypto.randomUUID(),
      updatedAt: (options.clock || Date.now)(),
    };
    const raw = JSON.stringify({ version: 1, scope, ...draft });
    if (raw.length > 65536) return null;
    try {
      storage.setItem(key, raw);
      return draft;
    } catch {
      return null;
    }
  }
  function remove(expectedRevision?: string) {
    if (!storage) return false;
    if (expectedRevision !== undefined) {
      const current = load();
      if (!current.available || current.draft?.revision !== expectedRevision)
        return false;
    }
    try {
      storage.removeItem(key);
      return true;
    } catch {
      return false;
    }
  }
  return { key, load, save, remove };
}
