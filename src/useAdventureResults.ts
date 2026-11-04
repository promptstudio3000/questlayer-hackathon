import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "./api";
import { createReadEpoch } from "./read-epoch";
import {
  adventureResultScope,
  belongsToAdventureScope,
  createAdventureReadContext,
  isFreshAdventureRead,
  type AdventureReadContext,
  type AdventureRealm,
  type AdventureResult,
} from "./adventure-results";
import { tr } from "./i18n.ts";

type Request = typeof api;
type Selection = {
  scope: string;
  mode: "history" | "detail";
  id?: string;
  result?: AdventureResult;
  fresh: boolean;
  checking: boolean;
  checked: AdventureReadContext;
};

export function useAdventureResults({
  playerId,
  realm,
  enabled,
  online,
  request = api,
}: {
  playerId: string | undefined;
  realm: AdventureRealm;
  enabled: boolean;
  online: boolean;
  request?: Request;
}) {
  const contexts = useRef(createAdventureReadContext());
  const current = contexts.current.update(
    adventureResultScope(playerId, realm, enabled),
    online,
  );
  const scope = current.scope;
  const latest = useRef(current);
  latest.current = current;
  const reads = useRef(createReadEpoch());
  const details = useRef(createReadEpoch());
  const listAbort = useRef<AbortController | null>(null);
  const detailAbort = useRef<AbortController | null>(null);
  const inspection = useRef(0);
  const inspected = useRef({ scope: "", times: new Map<string, number>() });
  const [view, setView] = useState<{
    scope: string;
    results: AdventureResult[];
    nextCursor: string | null;
    unread: AdventureResult | null;
  }>({ scope: "", results: [], nextCursor: null, unread: null });
  const [selection, setSelection] = useState<Selection | null>(null);
  const [loading, setLoading] = useState("");
  const [error, setError] = useState({ scope: "", text: "" });
  const [detailError, setDetailError] = useState({ scope: "", text: "" });

  const refresh = useCallback(
    async (cursor?: string) => {
      if (!scope || latest.current.scope !== scope || !latest.current.online)
        return;
      listAbort.current?.abort();
      const controller = new AbortController();
      listAbort.current = controller;
      const token = reads.current.begin(scope);
      setLoading(scope);
      const timeout = setTimeout(() => controller.abort(), 15_000);
      try {
        const [page, unseen] = await Promise.all([
          request<{ results: AdventureResult[]; nextCursor: string | null }>(
            `/adventure-results?realm=${realm}&limit=20${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
            undefined,
            { signal: controller.signal },
          ),
          request<{ results: AdventureResult[]; nextCursor: string | null }>(
            `/adventure-results?realm=${realm}&limit=1&unviewedOnly=true`,
            undefined,
            { signal: controller.signal },
          ),
        ]);
        if (!reads.current.isCurrent(token, latest.current.scope)) return;
        const results = page.results
          .filter((result) => belongsToAdventureScope(result, playerId, realm))
          .map((result) => {
            const viewedAt =
              inspected.current.scope === scope
                ? inspected.current.times.get(result.id)
                : undefined;
            return viewedAt === undefined ? result : { ...result, viewedAt };
          });
        const unread =
          unseen.results.find(
            (result) =>
              belongsToAdventureScope(result, playerId, realm) &&
              result.status === "confirmed" &&
              result.viewedAt === null &&
              !(
                inspected.current.scope === scope &&
                inspected.current.times.has(result.id)
              ),
          ) ?? null;
        setView({ scope, results, unread, nextCursor: page.nextCursor });
        setError({ scope, text: "" });
      } catch (e) {
        if (reads.current.isCurrent(token, latest.current.scope))
          setError({
            scope,
            text: controller.signal.aborted
              ? tr("Results took too long to load. Try again.")
              : e instanceof Error
                ? e.message
                : tr("Adventure results are unavailable. Try again."),
          });
      } finally {
        clearTimeout(timeout);
        if (reads.current.isCurrent(token, latest.current.scope))
          setLoading("");
      }
    },
    [scope, realm, playerId, request],
  );

  useEffect(() => {
    void refresh();
    const resume = () => {
      if (!document.hidden) void refresh();
    };
    window.addEventListener("focus", resume);
    document.addEventListener("visibilitychange", resume);
    return () => {
      reads.current.invalidate();
      details.current.invalidate();
      listAbort.current?.abort();
      detailAbort.current?.abort();
      window.removeEventListener("focus", resume);
      document.removeEventListener("visibilitychange", resume);
    };
  }, [refresh, online]);

  // Only called from a deliberate inspection or its directly confirmed claim.
  // Background reads, reload and dialog history never acknowledge a result.
  async function acknowledge(result: AdventureResult) {
    try {
      const data = await request<{ result: AdventureResult }>(
        `/adventure-results/${encodeURIComponent(result.id)}/viewed`,
        {},
      );
      if (
        latest.current.scope !== scope ||
        !belongsToAdventureScope(data.result, playerId, realm)
      )
        return;
      if (data.result.viewedAt !== null) {
        if (inspected.current.scope !== scope)
          inspected.current = { scope, times: new Map() };
        inspected.current.times.set(result.id, data.result.viewedAt);
        if (inspected.current.times.size > 2048)
          inspected.current.times.delete(
            inspected.current.times.keys().next().value!,
          );
      }
      setView((previous) =>
        previous.scope === scope
          ? {
              ...previous,
              results: previous.results.map((r) =>
                r.id === result.id ? data.result : r,
              ),
              unread:
                previous.unread?.id === result.id
                  ? (previous.results.find(
                      (r) =>
                        r.id !== result.id &&
                        r.status === "confirmed" &&
                        r.viewedAt === null,
                    ) ?? null)
                  : previous.unread,
            }
          : previous,
      );
      void refresh();
    } catch {
      /* The durable award remains recoverable if recording inspection fails. */
    }
  }

  async function inspect(id: string) {
    if (!scope || latest.current.scope !== scope) return;
    inspection.current++;
    detailAbort.current?.abort();
    const controller = new AbortController();
    detailAbort.current = controller;
    const token = details.current.begin(scope);
    const cached =
      view.scope === scope
        ? view.results.find((result) => result.id === id)
        : undefined;
    setSelection({
      scope,
      mode: "detail",
      id,
      result: cached,
      fresh: false,
      checked: current,
      checking: online,
    });
    setDetailError({ scope, text: "" });
    if (!latest.current.online) {
      setDetailError({
        scope,
        text: tr("You are offline. Reconnect to check this result and current ownership."),
      });
      return;
    }
    const timeout = setTimeout(() => controller.abort(), 15_000);
    try {
      const data = await request<{ result: AdventureResult }>(
        `/adventure-results/${encodeURIComponent(id)}`,
        undefined,
        { signal: controller.signal },
      );
      if (!details.current.isCurrent(token, latest.current.scope)) return;
      if (!belongsToAdventureScope(data.result, playerId, realm))
        throw new Error("This result belongs to another adventure mode.");
      setSelection({
        scope,
        mode: "detail",
        id,
        result: data.result,
        fresh: true,
        checked: current,
        checking: false,
      });
      void acknowledge(data.result);
    } catch (e) {
      if (details.current.isCurrent(token, latest.current.scope))
        setDetailError({
          scope,
          text: controller.signal.aborted
            ? tr("Result took too long to load. Try again.")
            : e instanceof Error
              ? e.message
              : tr("Could not check this result. Try again."),
        });
    } finally {
      clearTimeout(timeout);
      if (details.current.isCurrent(token, latest.current.scope))
        setSelection((value) =>
          value?.scope === scope && value.id === id
            ? { ...value, checking: false }
            : value,
        );
    }
  }
  function accept(result: AdventureResult) {
    if (
      !scope ||
      latest.current.scope !== scope ||
      !belongsToAdventureScope(result, playerId, realm)
    )
      return;
    inspection.current++;
    details.current.invalidate();
    detailAbort.current?.abort();
    setSelection({
      scope,
      mode: "detail",
      id: result.id,
      result,
      fresh: true,
      checked: current,
      checking: false,
    });
    setView((previous) => ({
      scope,
      results: [
        result,
        ...(previous.scope === scope
          ? previous.results.filter((r) => r.id !== result.id)
          : []),
      ].slice(0, 200),
      nextCursor: previous.scope === scope ? previous.nextCursor : null,
      unread:
        result.viewedAt === null
          ? result
          : previous.scope === scope
            ? previous.unread
            : null,
    }));
    setDetailError({ scope, text: "" });
    void acknowledge(result);
  }
  function close() {
    inspection.current++;
    details.current.invalidate();
    detailAbort.current?.abort();
    setSelection(null);
  }
  function history() {
    if (!scope) return;
    inspection.current++;
    details.current.invalidate();
    detailAbort.current?.abort();
    setSelection({
      scope,
      mode: "history",
      fresh: false,
      checked: current,
      checking: false,
    });
    void refresh();
  }
  const results = scope && view.scope === scope ? view.results : [];
  return {
    results,
    unread: scope && view.scope === scope ? view.unread : null,
    nextCursor: view.scope === scope ? view.nextCursor : null,
    selection:
      scope && selection?.scope === scope
        ? {
            ...selection,
            fresh:
              selection.fresh &&
              isFreshAdventureRead(selection.checked, current),
            checking:
              selection.checking &&
              isFreshAdventureRead(selection.checked, current),
          }
        : null,
    loading: !!scope && online && loading === scope,
    error:
      selection?.scope === scope && selection.mode === "detail"
        ? detailError.scope === scope
          ? detailError.text
          : ""
        : error.scope === scope
          ? error.text
          : "",
    refresh,
    inspect,
    accept,
    close,
    history,
    inspectionVersion: () => inspection.current,
    isCurrentInspection: (version: number) =>
      latest.current.scope === scope && inspection.current === version,
  };
}
