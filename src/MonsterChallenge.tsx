// Monster challenge sheet (NPC-PLAN §13.2). Opened from the actors map layer
// for a monster the player has an encounter token for. Every outcome comes
// from the server; this file only shows cues and records the player's inputs.
// Auras and items are not sent: power is level plus skill.
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Lightning, Shield, Sparkle, Trophy, Timer } from "@phosphor-icons/react";
import { api, ApiError } from "./api";
import { Dialog } from "./Dialog";
import {
  FORMAT_COPY,
  REASON_COPY,
  STANCE_COPY,
  addSample,
  retryLabel,
  unitPoint,
  type Challenge,
  type ChallengeFormat,
  type ChallengeMenu,
  type ChallengeResult,
  type DuelChallenge,
  type DuelRoundLog,
  type DuelRoundResponse,
  type MemoryChallenge,
  type MonsterRef,
  type QuizChallenge,
  type RhythmChallenge,
  type Stance,
  type TraceChallenge,
} from "./monster-challenge";
import "./monster-challenge.css";
import { tr } from "./i18n";

type Props = {
  /** The monster's ActorView from the encounter. */
  actor: MonsterRef;
  /** Encounter token (enc_…) from POST /api/actors/:id/encounter. */
  encounter: string;
  onClose: () => void;
  onResult?: (result: ChallengeResult) => void;
};

const path = (monster: MonsterRef) => `/actors/${encodeURIComponent(monster.id)}/challenge`;

export function MonsterChallenge({ actor: monster, encounter, onClose, onResult }: Props) {
  const [menu, setMenu] = useState<ChallengeMenu | null>(null);
  const [challenge, setChallenge] = useState<Challenge | null>(null);
  const [result, setResult] = useState<ChallengeResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<ChallengeMenu>(`${path(monster)}?encounter=${encodeURIComponent(encounter)}`)
      .then(setMenu)
      .catch((e) => setError(e instanceof ApiError ? e.message : tr("Could not reach the monster.")));
  }, [monster, encounter]);

  async function start(format: ChallengeFormat) {
    setBusy(true);
    setError(null);
    try {
      const out = await api<{ challenge: Challenge }>(path(monster), { encounter, format });
      setChallenge(out.challenge);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : tr("Could not start the challenge."));
    } finally {
      setBusy(false);
    }
  }

  async function submit(input: unknown) {
    if (!challenge) return;
    setBusy(true);
    try {
      done(await api<ChallengeResult>(`${path(monster)}/${challenge.id}/submit`, input));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : tr("Your moves did not reach the monster."));
    } finally {
      setBusy(false);
    }
  }

  function done(out: ChallengeResult) {
    setResult(out);
    onResult?.(out);
  }

  return (
    <Dialog label={tr("Challenge {0}", { 0: monster.name })} onClose={onClose}>
      <div className={`monster-challenge monster-${monster.archetype}`}>
        <header className="monster-head">
          <span className="monster-sigil" aria-hidden="true" />
          <div>
            <h2>{monster.name}</h2>
            <p className="monster-sub">
              {monster.archetype === "guardian"
                ? tr("Guardian")
                : monster.archetype === "lurker"
                  ? tr("Lurker")
                  : monster.archetype === "boss"
                    ? tr("Weekly boss")
                    : tr("Roamer")}
              {menu ? tr(" · you are level {0}", { 0: menu.level }) : ""}
            </p>
          </div>
        </header>
        {error && <p className="monster-error" role="alert">{error}</p>}
        {result ? (
          <ResultView result={result} onClose={onClose} />
        ) : challenge ? (
          <Play challenge={challenge} busy={busy} submit={submit} monster={monster} onDone={done} onError={setError} />
        ) : menu ? (
          <Menu menu={menu} busy={busy} start={start} />
        ) : (
          !error && <p aria-live="polite">{tr("The monster is sizing you up…")}</p>
        )}
        {!result && (
          <button type="button" className="monster-secondary" onClick={onClose}>
            {challenge ? tr("Run away (counts as your try)") : tr("Leave it")}
          </button>
        )}
      </div>
    </Dialog>
  );
}

function Menu({ menu, busy, start }: { menu: ChallengeMenu; busy: boolean; start: (f: ChallengeFormat) => void }) {
  if (menu.status.state === "defeated") return <p>{tr("You already beat this monster today. It will be back tomorrow.")}</p>;
  if (menu.status.state === "cooldown") return <p>{retryLabel(menu.status.retryAt)}</p>;
  return (
    <>
      <p className="monster-fair">
        {tr("Your level and your skill decide this fight. Auras only change how it looks. You get one try per hour, and losing costs nothing.")}</p>
      {menu.tendency && (
        <p className="monster-tell">
          <Sparkle size={18} weight="fill" aria-hidden="true" /> {" "}{tr("Word on the street: it likes to")}{" "}
          <strong>{STANCE_COPY[menu.tendency].label}</strong>.
        </p>
      )}
      <ul className="monster-formats">
        {menu.formats.map((f) => (
          <li key={f}>
            <button type="button" disabled={busy} onClick={() => start(f)}>
              <strong>{FORMAT_COPY[f].label}</strong>
              <span>{FORMAT_COPY[f].hint}</span>
            </button>
          </li>
        ))}
      </ul>
    </>
  );
}

function ResultView({ result, onClose }: { result: ChallengeResult; onClose: () => void }) {
  const won = result.result.outcome === "won";
  const reason = result.detail.reason ? REASON_COPY[result.detail.reason] : null;
  return (
    <div className={`monster-result ${won ? "won" : "lost"}`} role="status">
      {won ? <Trophy size={40} weight="fill" aria-hidden="true" /> : <Shield size={40} aria-hidden="true" />}
      <h3>{won ? tr("You beat it!") : tr("It got away this time")}</h3>
      <p>
        {tr("Score {0} of {1}.", { 0: result.result.score, 1: result.result.max })}{" "}
        {won ? tr("It won't bother this street again today.") : reason || retryLabel(result.retryAt)}
      </p>
      {won && result.rewards && <RewardLine rewards={result.rewards} />}
      {result.detail.reveal && (
        <p className="monster-reveal">
          {tr("Its moves were fixed before you started:")}{" "}{result.detail.reveal.picks.map((s) => STANCE_COPY[s].label).join(", ")}.
        </p>
      )}
      <button type="button" className="monster-primary" onClick={onClose}>
        {tr("Back to the map")}</button>
    </div>
  );
}

function RewardLine({ rewards }: { rewards: NonNullable<ChallengeResult["rewards"]> }) {
  const parts = [
    rewards.xp ? `+${rewards.xp} XP` : null,
    rewards.shards ? `+${rewards.shards.count} ${rewards.shards.element} shard${rewards.shards.count > 1 ? "s" : ""}` : null,
    rewards.rollTicket ? "a roll ticket" : null,
  ].filter(Boolean);
  return (
    <>
      {parts.length > 0 && <p className="monster-rewards">{tr("You earned")}{" "}{parts.join(", ")}.</p>}
      {rewards.unlocks && <p className="monster-rewards">{tr("The zone chest it guarded is open for you now.")}</p>}
      {rewards.edition && (
        <p className="monster-rewards">
          {tr("First win:")}{" "}{rewards.edition.name} ({rewards.edition.rarity}{tr(") is in your wardrobe. Secure it on NEAR from there.")}</p>
      )}
    </>
  );
}

type PlayProps = {
  challenge: Challenge;
  busy: boolean;
  submit: (input: unknown) => void;
  monster: MonsterRef;
  onDone: (r: ChallengeResult) => void;
  onError: (m: string) => void;
};

/** Mini-game player, shared with the weekly boss sheet (BossFight.tsx). */
export function ChallengePlay(props: PlayProps) {
  return <Play {...props} />;
}

function Play(props: PlayProps) {
  const c = props.challenge;
  if (c.format === "quiz") return <Quiz c={c} {...props} />;
  if (c.format === "rhythm") return <Rhythm c={c} {...props} />;
  if (c.format === "trace") return <Trace c={c} {...props} />;
  if (c.format === "memory") return <Memory c={c} {...props} />;
  return <Duel c={c} {...props} />;
}

function useClock() {
  const start = useRef(performance.now());
  return () => performance.now() - start.current;
}

function useTicker(active = true) {
  const [, setT] = useState(0);
  useEffect(() => {
    if (!active) return;
    let id = 0;
    const loop = () => {
      setT(performance.now());
      id = requestAnimationFrame(loop);
    };
    id = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(id);
  }, [active]);
}

function Quiz({ c, busy, submit }: PlayProps & { c: QuizChallenge }) {
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<{ id: string; choice: number }[]>([]);
  const [left, setLeft] = useState(c.secondsPerQuestion);
  const q = c.questions[index];
  useEffect(() => {
    setLeft(c.secondsPerQuestion);
    const id = setInterval(() => setLeft((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(id);
  }, [index, c.secondsPerQuestion]);
  function answer(choice: number) {
    const next = [...answers, { id: q.id, choice }];
    setAnswers(next);
    if (index + 1 < c.questions.length) setIndex(index + 1);
    else submit({ answers: next });
  }
  useEffect(() => {
    if (left === 0 && !busy) answer(-1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [left]);
  if (!q) return <p aria-live="polite">{tr("Checking your answers…")}</p>;
  return (
    <div className="monster-quiz">
      <p className="monster-progress">
        {tr("Question {0} of {1}", { 0: index + 1, 1: c.questions.length })}
        <span>
          <Timer size={16} aria-hidden="true" /> {left} s
        </span>
      </p>
      <h3>{q.prompt}</h3>
      <div className="monster-choices">
        {q.choices.map((choice, i) => (
          <button type="button" key={choice} disabled={busy} onClick={() => answer(i)}>
            {choice}
          </button>
        ))}
      </div>
    </div>
  );
}

function Rhythm({ c, busy, submit }: PlayProps & { c: RhythmChallenge }) {
  const clock = useClock();
  const taps = useRef<number[]>([]);
  const [count, setCount] = useState(0);
  const sent = useRef(false);
  useTicker(!sent.current);
  const now = clock();
  useEffect(() => {
    const id = setTimeout(() => {
      sent.current = true;
      submit({ taps: taps.current });
    }, c.durationMs + 300);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const tap = () => {
    if (sent.current || busy) return;
    taps.current.push(Math.round(clock()));
    setCount(taps.current.length);
  };
  const lead = 1200;
  return (
    <div className="monster-rhythm">
      <p>{now < c.beats[0] - 600 ? tr("Get ready…") : tr("Tap as each beat reaches the ring.")}</p>
      <div className="rhythm-lane" aria-hidden="true">
        <span className="rhythm-ring" />
        {c.beats.map((b) => {
          const d = (b - now) / lead;
          if (d < -0.2 || d > 1) return null;
          return <span key={b} className="rhythm-beat" style={{ left: `${10 + d * 85}%` }} />;
        })}
      </div>
      <button
        type="button"
        className="monster-pad"
        onPointerDown={(e) => {
          e.preventDefault();
          tap();
        }}
        onKeyDown={(e) => {
          if ((e.key === " " || e.key === "Enter") && !e.repeat) {
            e.preventDefault();
            tap();
          }
        }}
      >
        {tr("Tap (")}{count})
      </button>
    </div>
  );
}

function Trace({ c, busy, submit }: PlayProps & { c: TraceChallenge }) {
  const samples = useRef<[number, number, number][]>([]);
  const t0 = useRef(0);
  const [drawn, setDrawn] = useState<[number, number][]>([]);
  const [drawing, setDrawing] = useState(false);
  function point(e: ReactPointerEvent<SVGSVGElement>) {
    const p = unitPoint(e.clientX, e.clientY, e.currentTarget.getBoundingClientRect());
    addSample(samples.current, p, performance.now() - t0.current);
    setDrawn(samples.current.map(([x, y]) => [x, y]));
  }
  return (
    <div className="monster-trace">
      <p>{tr("Start on rune 1 and drag through every rune in order, then let go.")}</p>
      <svg
        viewBox="0 0 1 1"
        className="trace-board"
        role="img"
        aria-label={tr("Rune path with {0} runes", { 0: c.points.length })}
        onPointerDown={(e) => {
          if (busy) return;
          e.currentTarget.setPointerCapture(e.pointerId);
          samples.current = [];
          t0.current = performance.now();
          setDrawing(true);
          point(e);
        }}
        onPointerMove={(e) => drawing && point(e)}
        onPointerUp={() => {
          if (!drawing) return;
          setDrawing(false);
          submit({ samples: samples.current });
        }}
      >
        <polyline className="trace-glow" points={c.points.map((p) => p.join(",")).join(" ")} />
        {c.points.map((p, i) => (
          <g key={i}>
            <circle className="trace-rune" cx={p[0]} cy={p[1]} r={c.radius} />
            <text x={p[0]} y={p[1] + 0.015} className="trace-label">
              {i + 1}
            </text>
          </g>
        ))}
        <polyline className="trace-ink" points={drawn.map((p) => p.join(",")).join(" ")} />
      </svg>
    </div>
  );
}

function Memory({ c, busy, submit }: PlayProps & { c: MemoryChallenge }) {
  const clock = useClock();
  const taps = useRef<{ pad: number; t: number }[]>([]);
  const [count, setCount] = useState(0);
  const showing = clock() < c.showEndsMs;
  useTicker(showing);
  const now = clock();
  const lit = showing && now >= c.showEndsMs - c.sequence.length * c.showMs
    ? c.sequence[Math.floor((now - (c.showEndsMs - c.sequence.length * c.showMs)) / c.showMs)]
    : -1;
  function tap(pad: number) {
    if (showing || busy) return;
    taps.current.push({ pad, t: Math.round(clock()) });
    setCount(taps.current.length);
    if (taps.current.length === c.sequence.length) submit({ taps: taps.current });
  }
  return (
    <div className="monster-memory">
      <p aria-live="polite">
        {showing ? tr("Watch the runes…") : tr("Your turn: {0} of {1}", { 0: count, 1: c.sequence.length })}
      </p>
      <div className="memory-pads">
        {Array.from({ length: c.pads }, (_, i) => (
          <button
            type="button"
            key={i}
            className={`memory-pad pad-${i}${lit === i ? " lit" : ""}`}
            disabled={showing || busy}
            aria-label={tr("Rune {0}", { 0: i + 1 })}
            onClick={() => tap(i)}
          />
        ))}
      </div>
    </div>
  );
}

function Duel({ c, monster, onDone, onError }: PlayProps & { c: DuelChallenge }) {
  const [hp, setHp] = useState({ player: c.playerHp, monster: c.monsterHp });
  const [ring, setRing] = useState(c.ringMs);
  const [round, setRound] = useState(0);
  const [log, setLog] = useState<DuelRoundLog[]>([]);
  const [busy, setBusy] = useState(false);
  const opened = useRef(performance.now());
  useTicker(!busy);
  const elapsed = performance.now() - opened.current;
  const closing = Math.max(0, 1 - elapsed / ring);
  async function pick(stance: Stance) {
    if (busy) return;
    const tapOffsetMs = Math.round(performance.now() - opened.current - ring);
    setBusy(true);
    try {
      const out = await api<DuelRoundResponse>(`${path(monster)}/${c.id}/round`, { stance, tapOffsetMs });
      setHp({ player: out.duel.playerHp, monster: out.duel.monsterHp });
      setLog((l) => [...l, out.duel.last]);
      setRound(out.duel.round);
      if (out.result && out.detail) return onDone(out as Required<DuelRoundResponse>);
      if (out.duel.ringMs) setRing(out.duel.ringMs);
      opened.current = performance.now();
    } catch (e) {
      onError(e instanceof ApiError ? e.message : "Your move did not reach the monster.");
    } finally {
      setBusy(false);
    }
  }
  const last = log.at(-1);
  return (
    <div className="monster-duel">
      <div className="duel-bars">
        <Bar label={tr("You")} value={hp.player} max={c.playerHp} />
        <Bar label={monster.name} value={hp.monster} max={c.monsterHp} />
      </div>
      <p className="monster-progress">
        {tr("Round {0} of {1} · power {2} from level {3}", { 0: Math.min(round + 1, c.rounds), 1: c.rounds, 2: c.power, 3: c.level })}
      </p>
      {last && (
        <p className="duel-last" aria-live="polite">
          {tr("You: {0} · it: {1}.", { 0: STANCE_COPY[last.stance].label, 1: STANCE_COPY[last.monster].label })}{" "}
          {last.outcome === "win" ? tr("you hit for {0}", { 0: last.dealt }) : last.outcome === "lose" ? tr("it hits you for {0}", { 0: last.taken }) : tr("a clash, {0} each way", { 0: last.dealt })}.
        </p>
      )}
      <div className="duel-ring" aria-hidden="true">
        <span className="duel-target" />
        <span className="duel-closing" style={{ transform: `scale(${1 + closing * 1.6})`, opacity: closing > 0 ? 1 : 0.4 }} />
      </div>
      <p className="duel-hint">{tr("Pick your stance as the ring meets the circle. Strike beats Trick, Trick beats Guard, Guard beats Strike.")}</p>
      <div className="duel-stances">
        {(["strike", "guard", "trick"] as Stance[]).map((s) => (
          <button type="button" key={s} disabled={busy} onClick={() => pick(s)}>
            {s === "strike" ? <Lightning size={22} aria-hidden="true" /> : s === "guard" ? <Shield size={22} aria-hidden="true" /> : <Sparkle size={22} aria-hidden="true" />}
            {STANCE_COPY[s].label}
          </button>
        ))}
      </div>
    </div>
  );
}

function Bar({ label, value, max }: { label: string; value: number; max: number }) {
  return (
    <div className="duel-bar">
      <span>
        {label} <strong>{value}</strong>/{max}
      </span>
      <progress value={value} max={max} aria-label={`${label} health`} />
    </div>
  );
}
