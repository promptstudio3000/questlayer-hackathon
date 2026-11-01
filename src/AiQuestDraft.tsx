import { useState } from "react";
import { Sparkle } from "@phosphor-icons/react";
import type { CreatorPlaceTemplate } from "./creator-community-types";

type Point = { lat: number; lng: number };
type DraftPlace = { id: string; name: string; sector: string; stopCount: number };
type DraftStatus = {
  enabled: boolean;
  provider: string;
  cities: { id: string; name: string }[];
  limits: { remainingThisHour: number; remainingToday: number };
};
export type AiQuestSuggestion = {
  draft: {
    title: string;
    description: string;
    place: { template: CreatorPlaceTemplate; points: Point[] };
  };
  warnings: string[];
  provenance: { source: string; model: string | null };
};

async function call<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(`/api/creator-community/ai${path}`, {
    method: body === undefined ? "GET" : "POST",
    credentials: "same-origin",
    signal: AbortSignal.timeout(45000),
    ...(body === undefined
      ? {}
      : {
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }),
  });
  const value = await response.json().catch(() => null);
  if (!response.ok)
    throw new Error(value?.error || "The draft helper is unavailable.");
  return value as T;
}

/**
 * Optional helper inside the quest editor. It only fills the form with a
 * suggestion for a reviewed public place; the author edits it, saves the draft
 * and submits it for review as usual. Nothing is saved or published here.
 */
export function AiQuestDraft({
  template,
  disabled,
  onSuggestion,
}: {
  template: CreatorPlaceTemplate | null;
  disabled: boolean;
  onSuggestion: (suggestion: AiQuestSuggestion) => void;
}) {
  const [status, setStatus] = useState<DraftStatus | null>(null);
  const [places, setPlaces] = useState<DraftPlace[]>([]);
  const [placeId, setPlaceId] = useState("");
  const [stops, setStops] = useState(3);
  const [language, setLanguage] = useState<"en" | "cs">("en");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<AiQuestSuggestion | null>(null);
  const chosen = template ?? "visit";

  async function open() {
    if (status) return;
    try {
      const next = await call<DraftStatus>("/status");
      setStatus(next);
      const city = next.cities[0]?.id;
      if (city) {
        const list = await call<{ places: DraftPlace[] }>(
          `/places?city=${encodeURIComponent(city)}`,
        );
        setPlaces(list.places);
        setPlaceId(list.places[0]?.id ?? "");
      }
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function suggest() {
    if (!status || !placeId || busy) return;
    setBusy(true);
    setError("");
    try {
      const suggestion = await call<AiQuestSuggestion>("/quest-drafts", {
        cityId: status.cities[0].id,
        candidateId: placeId,
        template: chosen,
        ...(chosen === "trail" ? { stops } : {}),
        ...(notes.trim() ? { notes: notes.trim() } : {}),
        language,
      });
      setResult(suggestion);
      onSuggestion(suggestion);
      setStatus(await call<DraftStatus>("/status").catch(() => status));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const place = places.find((p) => p.id === placeId);
  const maxStops = Math.min(6, place?.stopCount ?? 6);
  return (
    <details
      className="creator-ai-draft"
      onToggle={(e) => {
        if ((e.currentTarget as HTMLDetailsElement).open) void open();
      }}
    >
      <summary>
        <Sparkle size={20} aria-hidden="true" /> Suggest a draft for a public
        place
      </summary>
      <p className="creator-hint">
        Pick a reviewed park and get a suggested{" "}
        {chosen === "trail" ? "trail" : chosen} with stops on mapped public
        paths. It only fills this form: you edit it, save it and submit it for
        review. Rewards and price are never part of the suggestion.
      </p>
      {status && !status.enabled && (
        <p role="status">The draft helper is turned off. Write the quest yourself.</p>
      )}
      {status?.enabled && (
        <div className="creator-ai-fields">
          <label>
            Place
            <select
              value={placeId}
              disabled={disabled || busy}
              onChange={(e) => setPlaceId(e.target.value)}
            >
              {places.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} · {p.sector}
                </option>
              ))}
            </select>
          </label>
          {chosen === "trail" && (
            <label>
              Stops
              <select
                value={Math.min(stops, maxStops)}
                disabled={disabled || busy}
                onChange={(e) => setStops(Number(e.target.value))}
              >
                {[2, 3, 4, 5, 6]
                  .filter((n) => n <= maxStops)
                  .map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
              </select>
            </label>
          )}
          <label>
            Language
            <select
              value={language}
              disabled={disabled || busy}
              onChange={(e) => setLanguage(e.target.value as "en" | "cs")}
            >
              <option value="en">English</option>
              <option value="cs">Čeština</option>
            </select>
          </label>
          <label>
            Idea (optional)
            <input
              type="text"
              maxLength={280}
              value={notes}
              disabled={disabled || busy}
              placeholder="A calm morning loop for families"
              onChange={(e) => setNotes(e.target.value)}
            />
          </label>
          <button
            type="button"
            className="secondary-button"
            disabled={disabled || busy || !placeId}
            onClick={suggest}
          >
            <Sparkle size={20} aria-hidden="true" />
            {busy ? "Preparing a suggestion…" : "Fill the form with a suggestion"}
          </button>
          <p className="creator-hint">
            {status.limits.remainingThisHour} suggestions left this hour.
          </p>
        </div>
      )}
      {result && (
        <div role="status" className="creator-hint">
          <p>
            Suggestion added to the form (
            {result.provenance.source === "template"
              ? "standard template"
              : "AI draft"}
            ). Check every stop and edit the text before you save.
          </p>
          <ul>
            {result.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </div>
      )}
      {error && <p role="alert">{error}</p>}
    </details>
  );
}
