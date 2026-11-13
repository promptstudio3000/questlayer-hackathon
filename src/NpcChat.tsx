// Chat mode of an NPC conversation (lazy chunk, loaded only once a player
// writes to an NPC or answers its question). The NPC can open the thread with
// its mission question; an answer goes to the shared memory of the place
// (server/npc/lore.mjs) and a useful one earns XP once per NPC and day.
import { useEffect, useRef, useState } from "react";
import { PaperPlaneRight } from "@phosphor-icons/react";
import { tr } from "./i18n";
import type { NpcMission, NpcMissionResult } from "./npc-client";
import "./npc-chat.css";

type Line = { from: "me" | "npc" | "note"; text: string };

export interface NpcChatProps {
  name: string;
  mission?: NpcMission | null;
  /** "mission": the first message answers the NPC's question. */
  start: { mode: "mission" | "talk"; text?: string };
  onTalk: (text: string) => Promise<{ say: string }>;
  onAnswer: (text: string) => Promise<NpcMissionResult>;
}

export const missionNote = (r: NpcMissionResult) =>
  r.xp > 0
    ? tr("+{0} XP · noted for other explorers", { 0: r.xp })
    : r.outcome === "pending"
      ? tr("Noted; the NPC checks it before telling anyone.")
      : r.outcome === "limited"
        ? tr("No more XP for tips today.")
        : r.note || "";

export default function NpcChat({ name, mission, start, onTalk, onAnswer }: NpcChatProps) {
  const answering = start.mode === "mission" && !!mission && !mission.answered;
  const [lines, setLines] = useState<Line[]>(() => (mission && !mission.answered ? [{ from: "npc", text: mission.ask }] : []));
  const [mode, setMode] = useState<"mission" | "talk">(answering ? "mission" : "talk");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const list = useRef<HTMLOListElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const started = useRef(false);

  const send = async (message: string) => {
    const said = message.trim();
    if (!said || busy) return;
    setLines((all) => [...all, { from: "me", text: said }]);
    setText("");
    setBusy(true);
    try {
      if (mode === "mission") {
        const r = await onAnswer(said);
        const note = missionNote(r);
        setLines((all) => [...all, { from: "npc", text: r.say }, ...(note ? [{ from: "note" as const, text: note }] : [])]);
        // A real answer ends the question; an off-topic one may try again.
        if (r.outcome !== "off_topic" && r.outcome !== "rejected") setMode("talk");
      } else {
        const r = await onTalk(said);
        setLines((all) => [...all, { from: "npc", text: r.say }]);
      }
    } catch (e) {
      setLines((all) => [...all, { from: "note", text: e instanceof Error ? e.message : tr("Something went wrong.") }]);
    } finally {
      setBusy(false);
      input.current?.focus({ preventScroll: true });
    }
  };

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    if (start.text) void send(start.text);
    else input.current?.focus({ preventScroll: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    const el = list.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines, busy]);

  return (
    <section className="npc-thread" aria-label={tr("Chat with {0}", { 0: name })}>
      <ol ref={list} className="npc-thread-lines" aria-live="polite">
        {lines.map((line, i) => (
          <li key={i} className={`npc-line ${line.from}`}>
            {line.from === "npc" && <span className="npc-line-name">{name}</span>}
            {line.text}
          </li>
        ))}
        {busy && <li className="npc-line npc typing" aria-label={tr("{0} is typing", { 0: name })}>…</li>}
      </ol>
      {mode === "mission" && mission && <p className="npc-thread-hint">{tr("Your answer helps other explorers · +{0} XP for a new tip", { 0: mission.xp })}</p>}
      <form
        className="npc-chat"
        onSubmit={(e) => {
          e.preventDefault();
          void send(text);
        }}
      >
        <input
          ref={input}
          value={text}
          maxLength={300}
          onChange={(e) => setText(e.target.value)}
          placeholder={mode === "mission" ? tr("Your answer…") : tr("Say something to {0}…", { 0: name })}
          aria-label={tr("Message to {0}", { 0: name })}
          enterKeyHint="send"
        />
        <button type="submit" disabled={busy || !text.trim()} aria-label={tr("Send")}>
          <PaperPlaneRight weight="fill" />
        </button>
      </form>
    </section>
  );
}
