// Primitive mini-games. The server issues a seeded challenge, the client plays
// it and returns its raw inputs, and the server replays them here. Timing
// bounds keep inputs human: anything a bot does faster or more precisely than
// a person scores the same as a very good person, never better.
import { seededRandom } from "./rng.mjs";

export const MINIGAMES = ["rhythm", "trace", "memory"];
export const LEAD_IN_MS = 1500; // countdown before the first cue

const finite = (n) => typeof n === "number" && Number.isFinite(n);
const fail = (reason) => ({ won: false, score: 0, reason });

// ---------- Rhythm: tap on the glowing beats ----------
export const RHYTHM = { beats: 8, pass: 6, goodMs: 160, perfectMs: 70, minGapMs: 90 };

export function createRhythm(seed) {
  const rng = seededRandom(`${seed}:rhythm`);
  const beatMs = Math.round(rng.range(480, 640));
  const beats = [];
  let t = LEAD_IN_MS;
  for (let i = 0; i < RHYTHM.beats; i++) {
    beats.push(Math.round(t));
    t += rng.random() < 0.25 ? beatMs * 1.5 : beatMs; // occasional syncopation
  }
  return { kind: "rhythm", beatMs, beats, durationMs: beats.at(-1) + 600 };
}

export function scoreRhythm(challenge, input) {
  const taps = input?.taps;
  if (!Array.isArray(taps) || taps.length > RHYTHM.beats * 2) return fail("input");
  if (!taps.every(finite)) return fail("input");
  for (let i = 1; i < taps.length; i++)
    if (taps[i] - taps[i - 1] < RHYTHM.minGapMs) return fail("too-fast");
  const used = new Set();
  let hits = 0;
  let perfect = 0;
  for (const beat of challenge.beats) {
    let best = -1;
    for (let i = 0; i < taps.length; i++) {
      if (used.has(i)) continue;
      const off = Math.abs(taps[i] - beat);
      if (off <= RHYTHM.goodMs && (best < 0 || off < Math.abs(taps[best] - beat))) best = i;
    }
    if (best < 0) continue;
    used.add(best);
    hits++;
    if (Math.abs(taps[best] - beat) <= RHYTHM.perfectMs) perfect++; // capped: no bonus below 70 ms
  }
  const extra = taps.length - used.size; // mashing costs hits
  const score = Math.max(0, hits - Math.max(0, extra - 1));
  return { won: score >= RHYTHM.pass, score, max: RHYTHM.beats, perfect };
}

// ---------- Trace: follow the glowing path ----------
export const TRACE = { radius: 0.08, corridor: 0.09, onPath: 0.75, maxSpeed: 4.5, minMs: 1200, maxMs: 20000 };

export function createTrace(seed) {
  const rng = seededRandom(`${seed}:trace`);
  const count = 5 + rng.int(3);
  const points = [];
  let guard = 0;
  while (points.length < count && guard++ < 500) {
    const p = [0.1 + rng.random() * 0.8, 0.1 + rng.random() * 0.8].map((v) => Math.round(v * 1000) / 1000);
    const prev = points.at(-1);
    if (prev) {
      const d = Math.hypot(p[0] - prev[0], p[1] - prev[1]);
      if (d < 0.2 || d > 0.5) continue;
    }
    if (points.some((q) => Math.hypot(p[0] - q[0], p[1] - q[1]) < 0.15)) continue;
    points.push(p);
  }
  return { kind: "trace", points, radius: TRACE.radius, durationMs: TRACE.maxMs };
}

function distanceToSegment(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const len = dx * dx + dy * dy;
  const t = len ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len)) : 0;
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

// input.samples: [[x, y, tMs], ...] in the unit square, t from the first touch.
export function scoreTrace(challenge, input) {
  const s = input?.samples;
  if (!Array.isArray(s) || s.length < 10 || s.length > 2000) return fail("input");
  if (!s.every((p) => Array.isArray(p) && p.length === 3 && p.every(finite))) return fail("input");
  const total = s.at(-1)[2] - s[0][2];
  if (total < TRACE.minMs) return fail("too-fast");
  if (total > TRACE.maxMs) return fail("time");
  for (let i = 1; i < s.length; i++) {
    const dt = s[i][2] - s[i - 1][2];
    if (dt < 0) return fail("input");
    const d = Math.hypot(s[i][0] - s[i - 1][0], s[i][1] - s[i - 1][1]);
    if (d > 0.02 && d / Math.max(dt, 1) * 1000 > TRACE.maxSpeed) return fail("too-fast");
  }
  const pts = challenge.points;
  let next = 0;
  for (const p of s) {
    if (next < pts.length && Math.hypot(p[0] - pts[next][0], p[1] - pts[next][1]) <= TRACE.radius) next++;
  }
  let inside = 0;
  for (const p of s) {
    let d = Infinity;
    for (let i = 1; i < pts.length; i++) d = Math.min(d, distanceToSegment(p, pts[i - 1], pts[i]));
    if (d <= TRACE.corridor) inside++;
  }
  const accuracy = Math.round((inside / s.length) * 100) / 100;
  return {
    won: next === pts.length && accuracy >= TRACE.onPath,
    score: next,
    max: pts.length,
    accuracy,
  };
}

// ---------- Memory: repeat the rune sequence ----------
export const MEMORY = { pads: 4, length: 6, showMs: 650, minGapMs: 140, maxMs: 15000 };

export function createMemory(seed) {
  const rng = seededRandom(`${seed}:memory`);
  const sequence = [];
  while (sequence.length < MEMORY.length) {
    const pad = rng.int(MEMORY.pads);
    if (sequence.at(-1) !== pad) sequence.push(pad);
  }
  const showEndsMs = LEAD_IN_MS + MEMORY.length * MEMORY.showMs;
  return { kind: "memory", pads: MEMORY.pads, sequence, showMs: MEMORY.showMs, showEndsMs, durationMs: showEndsMs + MEMORY.length * MEMORY.minGapMs };
}

// The sequence is shown to the player, so the view includes it: the skill is
// remembering it, and the server checks timing so a script gains nothing.
// input.taps: [{ pad, t }] with t in ms from challenge start (same clock as the show).
export function scoreMemory(challenge, input) {
  const taps = input?.taps;
  if (!Array.isArray(taps) || taps.length > MEMORY.length * 2) return fail("input");
  if (!taps.every((x) => x && Number.isInteger(x.pad) && finite(x.t))) return fail("input");
  if (taps.length && taps[0].t < challenge.showEndsMs) return fail("too-early");
  for (let i = 1; i < taps.length; i++)
    if (taps[i].t - taps[i - 1].t < MEMORY.minGapMs) return fail("too-fast");
  if (taps.length && taps.at(-1).t - challenge.showEndsMs > MEMORY.maxMs) return fail("time");
  let score = 0;
  while (score < challenge.sequence.length && taps[score]?.pad === challenge.sequence[score]) score++;
  return { won: score === challenge.sequence.length && taps.length === score, score, max: challenge.sequence.length };
}

export const createMinigame = (kind, seed) =>
  ({ rhythm: createRhythm, trace: createTrace, memory: createMemory })[kind](seed);

export const scoreMinigame = (challenge, input) =>
  ({ rhythm: scoreRhythm, trace: scoreTrace, memory: scoreMemory })[challenge.kind](challenge, input);

// Earliest server time a submit can honestly arrive, from challenge start.
export function minimumPlayMs(challenge) {
  if (challenge.kind === "rhythm") return challenge.beats[RHYTHM.pass - 1] - RHYTHM.goodMs;
  if (challenge.kind === "memory") return challenge.showEndsMs + (MEMORY.length - 1) * MEMORY.minGapMs;
  if (challenge.kind === "trace") return TRACE.minMs;
  return 0;
}
