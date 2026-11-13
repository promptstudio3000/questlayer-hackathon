// The Talk tab of an NPC conversation (lazy chunk). The NPC greets the
// player and asks its mission question as a chat message; an answer goes to
// the shared memory of the place (server/npc/lore.mjs) and a useful one earns
// XP once per NPC and day. Anything else written is ordinary conversation.
import { useEffect, useRef, useState } from "react";
import { PaperPlaneRight } from "@phosphor-icons/react";
import { tr } from "./i18n";
import type { NpcMission, NpcMissionResult } from "./npc-client";
import "./npc-chat.css";

type Line = { from: "me" | "npc" | "note" | "ask"; text: string };

export interface NpcChatProps {
  name: string;
  /** The NPC's greeting, the first line of the thread. */
  greeting: string;
  mission?: NpcMission | null;
  /** The text box keeps an unsent message (useFormDraft in NpcSheet). */
  text: string;
  onText: (text: string) => void;
  onSent?: (text: string) => void;
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

export default function NpcChat({ name, greeting, mission, text, onText, onSent, onTalk, onAnswer }: NpcChatProps) {
  const open = !!mission && !mission.answered && mission.left > 0;
  const [lines, setLines] = useState<Line[]>(() => [{ from: "npc", text: greeting }, ...(open ? [{ from: "ask" as const, text: mission!.ask }] : [])]);
  // Answering is a choice: the question waits in the thread with its button.
  const [mode, setMode] = useState<"mission" | "talk">("talk");
  const [busy, setBusy] = useState(false);
  const list = useRef<HTMLOListElement>(null);
  const input = useRef<HTMLInputElement>(null);

  const send = async (message: string) => {
    const said = message.trim();
    if (!said || busy) return;
    setLines((all) => [...all, { from: "me", text: said }]);
    onText("");
    onSent?.(said);
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
    const el = list.current;
    if (el && lines.length > 2) el.scrollTop = el.scrollHeight;
  }, [lines, busy]);
  const answered = !!mission?.answered;

  return (
    <section className="npc-thread" aria-label={tr("Chat with {0}", { 0: name })}>
      <ol ref={list} className="npc-thread-lines" aria-live="polite">
        {lines.map((line, i) => (
          <li key={i} className={`npc-line ${line.from === "ask" ? "npc ask" : line.from}`}>
            {line.from !== "me" && line.from !== "note" && <span className="npc-line-name">{name}</span>}
            {line.text}
            {line.from === "ask" && mode === "talk" && !answered && mission && (
              <button
                type="button"
                className="npc-ask-answer"
                disabled={busy}
                onClick={() => {
                  setMode("mission");
                  input.current?.focus({ preventScroll: true });
                }}
              >
                {tr("Answer · +{0} XP", { 0: mission.xp })}
              </button>
            )}
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
          onChange={(e) => onText(e.target.value)}
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
