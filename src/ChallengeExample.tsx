import { useEffect, useRef, useState, type ReactNode } from "react";
import { Lightning, Shield, Sparkle } from "@phosphor-icons/react";
import { tr } from "./i18n";
import { helpText } from "./activity-help";
import { prefersReducedMotion } from "./feedback";
import { FORMAT_COPY, STANCE_COPY, type Challenge, type ChallengeFormat, type Stance } from "./monster-challenge";
import "./game-learning.css";

type ExampleChallenge = Exclude<Challenge, { format: "duel" }>;
type RenderPlay = (challenge: ExampleChallenge, submit: (input: unknown) => void) => ReactNode;

/** Synthetic inputs stay in this component. No encounter, network call or reward. */
function example(format: Exclude<ChallengeFormat, "duel">): ExampleChallenge {
  const base = { id: "local-example", actorId: "local-example", expiresAt: Date.now() + 60000, seedCommitment: "" };
  switch (format) {
    case "quiz": return { ...base, format, questions: [{ id: "look", prompt: tr("Which changes your look?"), choices: [tr("Aura"), "XP"] }], secondsPerQuestion: 20, pass: 1 };
    case "rhythm": return { ...base, format, beatMs: 1000, beats: [1500, 2500, 3500], durationMs: 4200 };
    case "trace": return { ...base, format, points: [[.2,.5],[.5,.3],[.8,.5]], radius: .08, durationMs: 20000 };
    case "memory": return { ...base, format, pads: 4, sequence: [0,2,1], showMs: 700, showEndsMs: 2800 };
  }
}

export function ChallengeExample({ format, renderPlay }: { format: ChallengeFormat; renderPlay: RenderPlay }) {
  const [run, setRun] = useState<{ challenge: ExampleChallenge | null; key: number } | null>(null);
  const [finished, setFinished] = useState(false);
  const title = useRef<HTMLHeadingElement>(null);
  useEffect(() => { const frame = requestAnimationFrame(() => title.current?.focus()); return () => cancelAnimationFrame(frame); }, [format]);
  return <section className="challenge-example" aria-label={tr("Example · no attempt used")}>
    <h3 ref={title} tabIndex={-1}>{FORMAT_COPY[format].label}</h3>
    <p className="example-disclosure">{tr("Example · no attempt used")}</p>
    <p>{helpText(format)}</p>
    {!run || finished ? <>
      {finished && <p role="status">{tr("Example finished. No reward or attempt was used.")}</p>}
      <button className="monster-secondary" onClick={() => { setFinished(false); setRun({ challenge: format === "duel" ? null : example(format), key: (run?.key || 0) + 1 }); }}>{run ? tr("Try again") : tr("Play example")}</button>
    </> : format === "duel" ? <DuelExample key={run.key} onFinish={() => setFinished(true)} />
      : run.challenge && renderPlay(run.challenge, () => setFinished(true))}
  </section>;
}

function DuelExample({ onFinish }: { onFinish: () => void }) {
  const opened = useRef(performance.now());
  const [elapsed, setElapsed] = useState(0);
  const [picked, setPicked] = useState<Stance | null>(null);
  useEffect(() => {
    const timer = window.setInterval(() => setElapsed(performance.now() - opened.current), 50);
    return () => clearInterval(timer);
  }, []);
  const remaining = Math.max(0, 1 - elapsed / 2400);
  return <div className="monster-duel example-duel">
    <p>{tr("You: {0} · it: {1}.", { 0: picked ? STANCE_COPY[picked].label : "…", 1: STANCE_COPY.guard.label })}</p>
    <div className="duel-ring" aria-hidden="true"><span className="duel-target" /><span className="duel-closing" style={prefersReducedMotion() ? { transform: "none", opacity: remaining < .12 ? 1 : .3 } : { transform: `scale(${1 + remaining * 1.6})` }} /></div>
    <div className="duel-stances">{(["strike", "guard", "trick"] as Stance[]).map(stance => <button key={stance} onClick={() => setPicked(stance)} aria-pressed={picked === stance}>
      {stance === "strike" ? <Lightning aria-hidden="true" /> : stance === "guard" ? <Shield aria-hidden="true" /> : <Sparkle aria-hidden="true" />}{STANCE_COPY[stance].label}
    </button>)}</div>
    {picked && <p role="status">{tr("You: {0} · it: {1}.", { 0: STANCE_COPY[picked].label, 1: STANCE_COPY.guard.label })} {helpText("duel")}</p>}
    <button className="monster-secondary" onClick={onFinish}>{tr("Got it")}</button>
  </div>;
}
