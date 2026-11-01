// Player feedback preferences: vibration, sound and motion.
//
// Each preference is stored per browser. Motion follows the system setting
// unless the player also asks for less motion here; the resolved value is
// mirrored on <html data-motion> so CSS and MapLibre camera moves agree.
// Sounds are short synthesized tones (no audio files), off by default so a
// phone in a quiet street stays quiet until the player opts in.

export type MotionPreference = "system" | "reduce";
export type FeedbackPreferences = {
  haptics: boolean;
  sound: boolean;
  motion: MotionPreference;
};
export type FeedbackCue = "coin" | "step" | "reward" | "error";

const KEY = "questlayer-feedback-v1";
export const DEFAULT_FEEDBACK: FeedbackPreferences = {
  haptics: true,
  sound: false,
  motion: "system",
};

export function parseFeedbackPreferences(raw: string | null): FeedbackPreferences {
  if (!raw) return { ...DEFAULT_FEEDBACK };
  try {
    const value = JSON.parse(raw) as Partial<FeedbackPreferences>;
    return {
      haptics:
        typeof value.haptics === "boolean" ? value.haptics : DEFAULT_FEEDBACK.haptics,
      sound: typeof value.sound === "boolean" ? value.sound : DEFAULT_FEEDBACK.sound,
      motion:
        value.motion === "reduce" || value.motion === "system"
          ? value.motion
          : DEFAULT_FEEDBACK.motion,
    };
  } catch {
    return { ...DEFAULT_FEEDBACK };
  }
}

let current: FeedbackPreferences = DEFAULT_FEEDBACK;
const listeners = new Set<(p: FeedbackPreferences) => void>();

function systemReducesMotion() {
  try {
    return matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

export function resolveReducedMotion(
  preference: MotionPreference,
  systemReduce: boolean,
): boolean {
  return preference === "reduce" || (preference === "system" && systemReduce);
}

/** True when animations and camera flights should be skipped. */
export function prefersReducedMotion(): boolean {
  return resolveReducedMotion(current.motion, systemReducesMotion());
}

function applyMotion() {
  if (typeof document === "undefined") return;
  document.documentElement.dataset.motion = prefersReducedMotion()
    ? "reduce"
    : "full";
}

export function loadFeedbackPreferences(): FeedbackPreferences {
  try {
    current = parseFeedbackPreferences(localStorage.getItem(KEY));
  } catch {
    current = { ...DEFAULT_FEEDBACK };
  }
  applyMotion();
  try {
    matchMedia("(prefers-reduced-motion: reduce)").addEventListener?.(
      "change",
      applyMotion,
    );
  } catch {}
  return current;
}

export function feedbackPreferences(): FeedbackPreferences {
  return current;
}

export function setFeedbackPreferences(
  next: Partial<FeedbackPreferences>,
): FeedbackPreferences {
  current = { ...current, ...next };
  try {
    localStorage.setItem(KEY, JSON.stringify(current));
  } catch {}
  applyMotion();
  for (const listener of listeners) listener(current);
  return current;
}

export function subscribeFeedback(listener: (p: FeedbackPreferences) => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

// Vibration patterns stay short: a tick for a coin, a double pulse for a
// finished step, a longer flourish for a chest reward.
export const HAPTIC_PATTERNS: Record<FeedbackCue, number | number[]> = {
  coin: 12,
  step: [18, 60, 28],
  reward: [24, 50, 24, 50, 60],
  error: [40, 40, 40],
};
// Tones as [frequency Hz, start s, length s].
const TONES: Record<FeedbackCue, [number, number, number][]> = {
  coin: [[1320, 0, 0.07]],
  step: [
    [660, 0, 0.09],
    [990, 0.09, 0.12],
  ],
  reward: [
    [523, 0, 0.1],
    [659, 0.1, 0.1],
    [784, 0.2, 0.1],
    [1047, 0.3, 0.2],
  ],
  error: [[220, 0, 0.16]],
};

let audio: AudioContext | null = null;
let lastCue = { cue: "", at: 0 };

function playTones(cue: FeedbackCue) {
  const Ctor =
    typeof window !== "undefined"
      ? window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext
      : undefined;
  if (!Ctor) return;
  audio ||= new Ctor();
  if (audio.state === "suspended") void audio.resume();
  const t0 = audio.currentTime + 0.01;
  for (const [frequency, start, length] of TONES[cue]) {
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    osc.type = cue === "error" ? "triangle" : "sine";
    osc.frequency.value = frequency;
    gain.gain.setValueAtTime(0.0001, t0 + start);
    gain.gain.exponentialRampToValueAtTime(0.12, t0 + start + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + start + length);
    osc.connect(gain).connect(audio.destination);
    osc.start(t0 + start);
    osc.stop(t0 + start + length + 0.02);
  }
}

/** Plays the cue with whatever the player enabled. Never throws. */
export function cue(kind: FeedbackCue) {
  const now = Date.now();
  // Coins can arrive in bursts; one tick per 250 ms is enough.
  if (lastCue.cue === kind && now - lastCue.at < 250) return;
  lastCue = { cue: kind, at: now };
  try {
    if (current.haptics && typeof navigator !== "undefined" && navigator.vibrate)
      navigator.vibrate(HAPTIC_PATTERNS[kind]);
  } catch {}
  try {
    if (current.sound) playTones(kind);
  } catch {}
}

/** A tiny confirmation so the player hears what the sound toggle does. */
export function previewSound() {
  try {
    playTones("step");
  } catch {}
}
