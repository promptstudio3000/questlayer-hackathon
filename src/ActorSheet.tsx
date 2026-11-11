// Encounter sheet for a roaming NPC or monster tapped on the map. Asks the
// server for an encounter (distance, GPS and speed are checked there), shows
// the animated 3D model and the offer menu, and hands off to the NPC talk
// sheet or the monster challenge when those slices are present.
import { lazy, Suspense, useEffect, useRef, useState, type ComponentType } from "react";
import { Dialog } from "./Dialog";
import { api, ApiError } from "./api";
import type { ActorEncounter, ActorView } from "./actor-types";
import { actorRoleLabel } from "./actors-layer";
import "./actors.css";
import { tr } from "./i18n";
import { FORMAT_COPY, type ChallengeFormat } from "./monster-challenge";

type Location = { lat: number; lng: number; accuracy?: number; timestamp?: number };
type HandoffProps = {
  playerId: string;
  draftRealm: string;
  actor: ActorView;
  actorId: string;
  encounter: string | ActorEncounter;
  onClose: () => void;
  onQuest?: (questId: string) => void;
  format?: ChallengeFormat | null;
};

// Optional slices: NPC talk (N1/N2) and monster challenges (M1/M2).
function optional(files: Record<string, () => Promise<unknown>>, name: string) {
  const load = Object.values(files)[0];
  return load
    ? lazy(async () => ({ default: ((m) => m[name] || m.default)(await load() as Record<string, ComponentType<HandoffProps>>) }))
    : null;
}
const NpcSheet = optional(import.meta.glob("./NpcSheet.tsx"), "NpcSheet");
const MonsterChallenge = optional(import.meta.glob("./MonsterChallenge.tsx"), "MonsterChallenge");
const BossFight = lazy(async () => ({ default: (await import("./BossFight")).BossFight }));

const PROBLEM: Record<string, string> = {
  get OUT_OF_RANGE() { return tr("Too far. Get within 35 m."); },
  get GPS_ACCURACY() { return tr("Your GPS is not precise enough yet. Step into the open and try again."); },
  get GPS_STALE() { return tr("Waiting for a fresh location. Try again in a moment."); },
  get IMPLAUSIBLE_MOVE() { return tr("Your location jumped too fast. Wait for a steady GPS fix."); },
  get ACTOR_AWAY() { return tr("They have left for now. Check the map again later."); },
  get ACTOR_COOLDOWN() { return tr("They need a rest. Come back a little later."); },
  get ENCOUNTER_LIMIT() { return tr("Take a short break before meeting more characters."); },
  get WORLD_PAUSED() { return tr("Operators paused today's world for a moment. Your progress is safe."); },
  get ACTORS_DISABLED() { return tr("Characters are not available on this server."); },
};

export function ActorSheet({
  actor,
  playerId,
  worldId,
  location,
  onQuest,
  onGo,
  onClose,
}: {
  /** Too far to meet: one tap marks the character on the map instead. */
  onGo?: () => void;
  actor: ActorView;
  playerId: string;
  worldId: string;
  location: Location | null;
  onQuest?: (questId: string) => void;
  onClose: () => void;
}) {
  const [state, setState] = useState<
    | { kind: "loading" }
    | { kind: "ready"; encounter: ActorEncounter }
    | { kind: "error"; message: string; retry: boolean; far?: boolean }
  >({ kind: "loading" });
  const [handoff, setHandoff] = useState<"npc" | "challenge" | "boss" | null>(null);
  // The format picked here starts right away: the challenge sheet never asks again.
  const [format, setFormat] = useState<ChallengeFormat | null>(null);
  const stage = useRef<HTMLDivElement>(null);
  const attempt = useRef(0);

  async function meet() {
    const mine = ++attempt.current;
    if (!location) {
      setState({ kind: "error", message: tr("Waiting for your location."), retry: true });
      return;
    }
    setState({ kind: "loading" });
    try {
      const encounter = await api<ActorEncounter>(`/actors/${encodeURIComponent(actor.id)}/encounter`, {
        worldId,
        location,
      });
      if (mine !== attempt.current) return;
      setState({ kind: "ready", encounter });
      if (actor.kind === "npc" && NpcSheet) setHandoff("npc");
    } catch (e) {
      if (mine !== attempt.current) return;
      const code = e instanceof ApiError ? e.code : "";
      setState({
        kind: "error",
        message: PROBLEM[code] || (e instanceof ApiError ? e.message : tr("Could not reach the game. Try again.")),
        retry: code !== "ACTORS_DISABLED",
        far: code === "OUT_OF_RANGE",
      });
    }
  }
  useEffect(() => {
    void meet();
    // A new location should not re-run the meeting by itself; Retry does.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actor.id]);
  useEffect(() => {
    const host = stage.current;
    if (!host) return;
    let scene: { dispose(): void } | null = null,
      gone = false;
    import("./actor-models")
      .then((m) => {
        if (!gone) scene = m.createActorScene(host, actor.model, { label: actor.name });
      })
      .catch(() => {});
    return () => {
      gone = true;
      scene?.dispose();
    };
  }, [actor.model, actor.name]);

  const ready = state.kind === "ready" ? state.encounter : null;
  if (ready && handoff === "npc" && NpcSheet)
    return (
      <Suspense fallback={null}>
        <NpcSheet playerId={playerId} draftRealm={worldId} actor={ready.actor} actorId={actor.id} encounter={ready} onClose={onClose} onQuest={onQuest} />
      </Suspense>
    );
  if (ready && handoff === "boss")
    return (
      <Suspense fallback={null}>
        <BossFight playerId={playerId} actor={ready.actor} encounter={ready.encounter} worldId={worldId} onClose={onClose} />
      </Suspense>
    );
  if (ready && handoff === "challenge" && MonsterChallenge)
    return (
      <Suspense fallback={null}>
        <MonsterChallenge playerId={playerId} draftRealm={worldId} actor={ready.actor} actorId={actor.id} encounter={ready.encounter} format={format} onClose={onClose} onQuest={onQuest} />
      </Suspense>
    );
  return (
    <Dialog presentation="encounter" label={actor.name} onClose={onClose}>
      <section className={`actor-sheet actor-sheet-${actor.kind}`}>
        <div className="actor-stage" ref={stage} aria-hidden="true" />
        <header>
          <p className="actor-role">
            {actorRoleLabel(actor)}
            {actor.element ? ` · ${actor.element}` : ""}
          </p>
          <h2>{actor.name}</h2>
          {actor.title && <p className="actor-title">{actor.title}</p>}
          {actor.phase && (
            <p className="actor-title actor-phase">
              {actor.phase === "night" ? tr("Night creature · out until sunrise") : tr("Day creature · out until sunset")}
            </p>
          )}
        </header>
        {state.kind === "loading" && <p className="actor-status" role="status">{tr("Walking up…")}</p>}
        {state.kind === "error" && (
          <div className="actor-status actor-problem" role="alert">
            <p>{state.message}</p>
            {state.far && onGo ? (
              <button className="primary-button" onClick={() => { onClose(); onGo(); }}>{tr("Go")}</button>
            ) : state.retry && (
              <button className="secondary-button" onClick={() => void meet()}>
                {tr("Try again")}</button>
            )}
          </div>
        )}
        {ready && (
          <>
            {ready.actor.boss && (
              <p className="actor-note">
                {tr("HP {0}/{1} · {2} hunters", { 0: ready.actor.boss.hp, 1: ready.actor.boss.maxHp, 2: ready.actor.boss.participants })}</p>
            )}
            {ready.actor.state === "defeated" && (
              <p className="actor-note">{tr("You already beat this one today.")}</p>
            )}
            {ready.menu.length ? (
              <ul className="actor-offers">
                {ready.menu.map((offer) => {
                  const isBoss = offer.kind === "challenge" && offer.terms.format === "boss-hit";
                  const canChallenge = isBoss || (offer.kind === "challenge" && !!MonsterChallenge);
                  const picked = typeof offer.terms.format === "string" && offer.terms.format in FORMAT_COPY ? (offer.terms.format as ChallengeFormat) : null;
                  return (
                    <li key={offer.id}>
                      <button
                        className="primary-button"
                        disabled={!canChallenge}
                        onClick={() => {
                          if (!canChallenge) return;
                          setFormat(picked);
                          setHandoff(isBoss ? "boss" : "challenge");
                        }}
                      >
                        {offer.label}
                      </button>
                      {picked && <small className="actor-offer-hint">{FORMAT_COPY[picked].hint}</small>}
                      {!canChallenge && <small>{tr("Opens in an upcoming update.")}</small>}
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="actor-note">
                {actor.kind === "npc"
                  ? tr("They nod and go back to their errands. Conversations open in an upcoming update.")
                  : tr("Nothing to do here right now.")}
              </p>
            )}
          </>
        )}
      </section>
    </Dialog>
  );
}
