import { useMemo, useRef, useState } from "react";
import {
  createFormDraftStore,
  formDraftKey,
  type DraftFields,
} from "./form-draft";

export function useFormDraft<T extends Record<string, string>>(options: {
  playerId: string;
  form: string;
  realm: string;
  fields: DraftFields<T>;
  initial: T;
}) {
  const { playerId, form, realm, fields, initial } = options;
  const scope = { playerId, form, realm };
  const key = formDraftKey(scope);
  const schema = JSON.stringify(fields);
  const store = useMemo(
    () => createFormDraftStore<T>({ scope: { playerId, form, realm }, fields }),
    [key, schema],
  );
  function hydrate() {
    const loaded = store.load();
    return {
      key,
      values: loaded.draft?.values || { ...initial },
      revision: loaded.draft?.revision || null,
      restored: !!loaded.draft,
      storageAvailable: loaded.available,
    };
  }
  const [saved, setSaved] = useState(hydrate);
  // Keep current values synchronous with event handlers and synchronous navigation.
  // A different actor/realm never renders the previous scope's strings.
  const current = useRef(saved);
  if (current.current.key !== key) current.current = hydrate();
  else if (saved.key === key && saved !== current.current)
    current.current = saved;
  const value = current.current;
  function replace(values: T) {
    const draft = store.save(values);
    const next = {
      key,
      values: { ...values },
      revision: draft?.revision || null,
      restored: false,
      storageAvailable: !!draft,
    };
    current.current = next;
    setSaved(next);
  }
  function setField<K extends keyof T>(name: K, text: T[K]) {
    replace({ ...current.current.values, [name]: text });
  }
  function discard(expectedRevision?: string | null) {
    if (expectedRevision && current.current.revision !== expectedRevision)
      return false;
    // Null means a confirmed submission had no saved revision. Clear this tab's
    // text without deleting an unrelated saved draft. Undefined is user discard.
    const removed =
      expectedRevision === null ? false : store.remove(expectedRevision);
    const next = {
      key,
      values: { ...initial },
      revision: null,
      restored: false,
      storageAvailable: value.storageAvailable && removed,
    };
    current.current = next;
    setSaved(next);
    return removed;
  }
  return {
    values: value.values,
    revision: value.revision,
    setField,
    replace,
    discard,
    restored: value.restored,
    storageAvailable: value.storageAvailable,
    hasDraft: Object.keys(fields).some(
      (name) => value.values[name] !== initial[name],
    ),
  };
}
