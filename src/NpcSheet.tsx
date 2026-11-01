// Encounter sheet for a roaming NPC: 3D portrait, speech bubble, the offer
// buttons the server computed (they always work without AI), a short chat
// box and the player's open tasks from this character, with turn-in.
import { useEffect, useRef, useState } from "react";
import { Dialog } from "./Dialog";
import type { ActorEncounter, ActorOffer } from "./actor-types";
import { npcAccept, npcGreet, npcTalk, npcTurnIn, type NpcActiveLine, type NpcReply } from "./npc-client";
import "./npc-sheet.css";

const EMOTE: Record<string, string> = { wave: "👋", think: "🤔", laugh: "😄", shrug: "🤷", none: "" };

function Portrait({ model, label }: { model: string; label: string }) {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let dispose: (() => void) | undefined, cancelled = false;
    import("./actor-models").then(({ createActorScene }) => {
      if (!cancelled && host.current) dispose = createActorScene(host.current, model, { label }).dispose;
    });
    return () => {
      cancelled = true;
      dispose?.();
    };
  }, [model, label]);
  return <div className="npc-portrait" ref={host} />;
}

export default function NpcSheet({ actorId, encounter, onClose }: { actorId: string; encounter: ActorEncounter; onClose: () => void }) {
  const [reply, setReply] = useState<NpcReply | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const token = encounter.encounter;
  const run = async (task: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await task();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    run(async () => setReply(await npcGreet(actorId, token)));
  }, [actorId, token]);
  const refresh = async () => setReply(await npcGreet(actorId, token));
  const accept = (offer: ActorOffer) =>
    run(async () => {
      await npcAccept(actorId, token, offer.id);
      setNotice(`Task accepted: ${offer.label}`);
      await refresh();
    });
  const turnIn = (line: NpcActiveLine) =>
    run(async () => {
      const r = await npcTurnIn(actorId, token, line.offerId);
      setNotice(
        r.replay
          ? "Already turned in."
          : `+${r.xp} XP${r.aura ? ` and ${r.aura.name} (${r.aura.rarity}). Secure it on NEAR from your wardrobe.` : "."}${r.note ? ` ${r.note}` : ""}`,
      );
      await refresh();
    });
  const send = (event: React.FormEvent) => {
    event.preventDefault();
    const text = message.trim();
    if (!text) return;
    run(async () => {
      const r = await npcTalk(actorId, token, text);
      setReply((old) => ({ ...r, npc: r.npc ?? old?.npc }));
      setMessage("");
    });
  };
  const name = reply?.npc?.name || encounter.actor.name;
  const suggested = reply?.offer?.id;
  return (
    <Dialog label={`Talk to ${name}`} onClose={onClose}>
      <div className="npc-sheet">
        <header className="npc-head">
          <Portrait model={encounter.actor.model} label={name} />
          <div>
            <h2>{name}</h2>
            {(reply?.npc?.title || encounter.actor.title) && <p className="npc-title">{reply?.npc?.title || encounter.actor.title}</p>}
            <p className="npc-source">{reply?.source && reply.source !== "template" ? "AI voice · answers from game data only" : "Standard replies"}</p>
          </div>
          <button type="button" className="npc-close" onClick={onClose} aria-label="Close">×</button>
        </header>
        <p className="npc-bubble" aria-live="polite">
          {reply ? `${EMOTE[reply.emote] || ""} ${reply.say}`.trim() : "…"}
        </p>
        {reply?.note && <p className="npc-note">{reply.note}</p>}
        {!!reply?.active.length && (
          <section aria-label="Your tasks">
            <h3>Your tasks</h3>
            {reply.active.map((line) => {
              const ready = line.steps.every((s) => s.done);
              return (
                <div className="npc-task" key={line.offerId}>
                  <p>{line.label}</p>
                  <ul>
                    {line.steps.map((s) => (
                      <li key={s.questId} className={s.done ? "done" : ""}>
                        {s.done ? "✓" : "○"} {s.title}
                        {s.zone ? ` · ${s.zone}` : ""}
                      </li>
                    ))}
                  </ul>
                  <button type="button" disabled={busy || !ready} onClick={() => turnIn(line)}>
                    {ready ? `Turn in for ${line.xp} XP${line.aura ? " + Aura" : ""}` : "Finish the stops, then come back"}
                  </button>
                </div>
              );
            })}
          </section>
        )}
        {!!reply?.menu.length && (
          <section aria-label="Offers">
            <h3>Offers</h3>
            {reply.menu.map((offer) => (
              <button
                type="button"
                key={offer.id}
                className={`npc-offer${offer.id === suggested ? " suggested" : ""}`}
                disabled={busy}
                onClick={() => accept(offer)}
              >
                <span>{offer.label}</span>
                <small>
                  {String((offer.terms as { xp?: number }).xp ?? "")} XP
                  {(offer.terms as { aura?: boolean }).aura ? " + Aura" : ""}
                </small>
              </button>
            ))}
          </section>
        )}
        <form className="npc-chat" onSubmit={send}>
          <input
            value={message}
            maxLength={300}
            onChange={(e) => setMessage(e.target.value)}
            placeholder={`Say something to ${name}`}
            aria-label={`Message to ${name}`}
          />
          <button type="submit" disabled={busy || !message.trim()}>Send</button>
        </form>
        {notice && <p className="npc-notice" role="status">{notice}</p>}
        {error && <p className="npc-error" role="alert">{error}</p>}
      </div>
    </Dialog>
  );
}
