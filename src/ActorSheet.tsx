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

type Location = { lat: number; lng: number; accuracy?: number; timestamp?: number };
type HandoffProps = {
  actor: ActorView;
  actorId: string;
  encounter: string | ActorEncounter;
  onClose: () => void;
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
  OUT_OF_RANGE: "Too far away. Walk closer: you need to be within about 35 m.",
  GPS_ACCURACY: "Your GPS is not precise enough yet. Step into the open and try again.",
  GPS_STALE: "Waiting for a fresh location. Try again in a moment.",
  IMPLAUSIBLE_MOVE: "Your location jumped too fast. Wait for a steady GPS fix.",
  ACTOR_AWAY: "They have left for now. Check the map again later.",
  ACTOR_COOLDOWN: "They need a rest. Come back a little later.",
  ENCOUNTER_LIMIT: "Take a short break before meeting more characters.",
  WORLD_PAUSED: "Operators paused today's world for a moment. Your progress is safe.",
  ACTORS_DISABLED: "Characters are not available on this server.",
};

export function ActorSheet({
  actor,
  worldId,
  location,
  onClose,
}: {
  actor: ActorView;
  worldId: string;
  location: Location | null;
  onClose: () => void;
}) {
  const [state, setState] = useState<
    | { kind: "loading" }
    | { kind: "ready"; encounter: ActorEncounter }
    | { kind: "error"; message: string; retry: boolean }
  >({ kind: "loading" });
  const [handoff, setHandoff] = useState<"npc" | "challenge" | "boss" | null>(null);
  const stage = useRef<HTMLDivElement>(null);
  const attempt = useRef(0);

  async function meet() {
    const mine = ++attempt.current;
    if (!location) {
      setState({ kind: "error", message: "Waiting for your location.", retry: true });
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
        message: PROBLEM[code] || (e instanceof ApiError ? e.message : "Could not reach the game. Try again."),
        retry: code !== "ACTORS_DISABLED",
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
        <NpcSheet actor={ready.actor} actorId={actor.id} encounter={ready} onClose={onClose} />
      </Suspense>
    );
  if (ready && handoff === "boss")
    return (
      <Suspense fallback={null}>
        <BossFight actor={ready.actor} encounter={ready.encounter} worldId={worldId} onClose={onClose} />
      </Suspense>
    );
  if (ready && handoff === "challenge" && MonsterChallenge)
    return (
      <Suspense fallback={null}>
        <MonsterChallenge actor={ready.actor} actorId={actor.id} encounter={ready.encounter} onClose={onClose} />
      </Suspense>
    );
  return (
    <Dialog label={actor.name} onClose={onClose}>
      <section className={`actor-sheet actor-sheet-${actor.kind}`}>
        <button className="icon-button close" onClick={onClose} aria-label="Close">
          ×
        </button>
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
              {actor.phase === "night" ? "Night creature · out until sunrise" : "Day creature · out until sunset"}
            </p>
          )}
        </header>
        {state.kind === "loading" && <p className="actor-status" role="status">Walking up…</p>}
        {state.kind === "error" && (
          <div className="actor-status actor-problem" role="alert">
            <p>{state.message}</p>
            {state.retry && (
              <button className="secondary-button" onClick={() => void meet()}>
                Try again
              </button>
            )}
          </div>
        )}
        {ready && (
          <>
            <p className="actor-status" role="status">
              You are {ready.distanceM} m away. This meeting lasts 5 minutes.
            </p>
            {ready.actor.boss && (
              <p className="actor-note">
                Shared boss health: {ready.actor.boss.hp} / {ready.actor.boss.maxHp} · {ready.actor.boss.participants} hunters this week.
              </p>
            )}
            {ready.actor.state === "defeated" && (
              <p className="actor-note">You already beat this one today.</p>
            )}
            {ready.menu.length ? (
              <ul className="actor-offers">
                {ready.menu.map((offer) => {
                  const isBoss = offer.kind === "challenge" && offer.terms.format === "boss-hit";
                  const canChallenge = isBoss || (offer.kind === "challenge" && !!MonsterChallenge);
                  return (
                    <li key={offer.id}>
                      <button
                        className="primary-button"
                        disabled={!canChallenge}
                        onClick={() => canChallenge && setHandoff(isBoss ? "boss" : "challenge")}
                      >
                        {offer.label}
                      </button>
                      {!canChallenge && <small>Opens in an upcoming update.</small>}
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="actor-note">
                {actor.kind === "npc"
                  ? "They nod and go back to their errands. Conversations open in an upcoming update."
                  : "Nothing to do here right now."}
              </p>
            )}
          </>
        )}
      </section>
    </Dialog>
  );
}
