// Client types and pure helpers for monster challenges. The server decides
// every outcome (server/actors/challenges); the client only records inputs.
import type { ActorView } from "./actor-types";

export type ChallengeFormat = "quiz" | "rhythm" | "trace" | "memory" | "duel";
export type Stance = "strike" | "guard" | "trick";

/** The monster being challenged: an ActorView from the actors layer. */
export type MonsterRef = Pick<ActorView, "id" | "name" | "archetype"> & Partial<ActorView>;

export type ChallengeMenu = {
  actorId: string;
  status: { state: "active" | "defeated" | "cooldown"; retryAt?: number };
  formats: ChallengeFormat[];
  tendency?: Stance;
  level: number;
};

type Base = { id: string; actorId: string; format: ChallengeFormat; expiresAt: number; seedCommitment: string };
export type QuizChallenge = Base & { format: "quiz"; questions: { id: string; prompt: string; choices: string[] }[]; secondsPerQuestion: number; pass: number };
export type RhythmChallenge = Base & { format: "rhythm"; beatMs: number; beats: number[]; durationMs: number };
export type TraceChallenge = Base & { format: "trace"; points: [number, number][]; radius: number; durationMs: number };
export type MemoryChallenge = Base & { format: "memory"; pads: number; sequence: number[]; showMs: number; showEndsMs: number };
export type DuelChallenge = Base & { format: "duel"; tendency: Stance; monsterHp: number; playerHp: number; power: number; level: number; rounds: number; ringMs: number; commitment: string };
export type Challenge = QuizChallenge | RhythmChallenge | TraceChallenge | MemoryChallenge | DuelChallenge;

export type ChallengeResult = {
  result: { challengeId: string; outcome: "won" | "lost"; score: number; max: number; format: ChallengeFormat };
  detail: { reason?: string; reveal?: { picks: Stance[]; salt: string; commitment: string } };
  retryAt?: number;
  /** Granted by the hunt slice (server/actors/hunt/rewards.mjs) on a win. */
  rewards?: HuntWinRewards | null;
};
export type HuntWinRewards = {
  xp: number;
  shards: { element: string; count: number } | null;
  rollTicket: boolean;
  unlocks: { zoneId: string } | null;
};
export type DuelRoundLog = { stance: Stance; monster: Stance; outcome: "win" | "lose" | "clash"; skill: number; dealt: number; taken: number };
export type DuelRoundResponse = { duel: { round: number; playerHp: number; monsterHp: number; last: DuelRoundLog; ringMs?: number } } & Partial<ChallengeResult>;

export const FORMAT_COPY: Record<ChallengeFormat, { label: string; hint: string }> = {
  quiz: { label: "Answer its riddles", hint: "3 questions about this place and the game. Get 2 right." },
  rhythm: { label: "Match its rhythm", hint: "Tap when each glowing beat reaches the ring." },
  trace: { label: "Trace its rune path", hint: "Drag through the runes in order without leaving the glow." },
  memory: { label: "Repeat its rune song", hint: "Watch the runes light up, then tap them in the same order." },
  duel: { label: "Duel it", hint: "3 rounds. Pick Strike, Guard or Trick as the ring closes." },
};

export const STANCE_COPY: Record<Stance, { label: string; beats: Stance }> = {
  strike: { label: "Strike", beats: "trick" },
  guard: { label: "Guard", beats: "strike" },
  trick: { label: "Trick", beats: "guard" },
};

export const REASON_COPY: Record<string, string> = {
  "too-fast": "That was faster than a person can play, so it didn't count.",
  "too-early": "You tapped before the runes finished.",
  time: "Time ran out.",
  input: "Your moves didn't reach the monster. Try again later.",
};

// Pointer position inside an element, as unit-square coordinates.
export function unitPoint(x: number, y: number, rect: { left: number; top: number; width: number; height: number }): [number, number] {
  const clamp = (v: number) => Math.min(1, Math.max(0, v));
  return [Math.round(clamp((x - rect.left) / rect.width) * 1000) / 1000, Math.round(clamp((y - rect.top) / rect.height) * 1000) / 1000];
}

// Keeps at most one sample per 16 ms and moves of at least 0.004, so a long
// drag stays well under the server's 2000-sample limit.
export function addSample(samples: [number, number, number][], p: [number, number], t: number) {
  const last = samples.at(-1);
  if (last && (t - last[2] < 16 || Math.hypot(p[0] - last[0], p[1] - last[1]) < 0.004)) return samples;
  if (samples.length >= 1900) return samples;
  samples.push([p[0], p[1], Math.round(t)]);
  return samples;
}

export function retryLabel(retryAt: number | undefined, now = Date.now()) {
  if (!retryAt) return "";
  const min = Math.max(1, Math.ceil((retryAt - now) / 60000));
  return `You can try this monster again in ${min} min.`;
}
