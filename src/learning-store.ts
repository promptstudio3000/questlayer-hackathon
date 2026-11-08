export const HELP_TOPICS = ["movement-arena", "movement-gps", "find", "coin", "visit", "trail", "return", "hunt", "clue", "chest", "aura", "npc", "quiz", "rhythm", "trace", "memory", "duel", "boss"] as const;
export type HelpTopic = typeof HELP_TOPICS[number];
export type LearningState = {
  version: 1;
  intro: "new" | "done" | "skipped";
  enabled: boolean;
  seen: Partial<Record<HelpTopic, true>>;
};

const cache = new Map<string, LearningState>();
const quiet = (): LearningState => ({ version: 1, intro: "done", enabled: false, seen: {} });
export const learningKey = (playerId: string) => `questlayer.learning:${encodeURIComponent(playerId)}`;
export const LEARNING_EVENT = "questlayer:learning";

/** Teaching preferences are browser-local and are never evidence of game progress. */
export function readLearning(playerId: string): LearningState {
  if (!playerId) return quiet();
  const remembered = cache.get(playerId);
  if (remembered) return remembered;
  let state = quiet();
  try {
    const value = JSON.parse(globalThis.localStorage?.getItem(learningKey(playerId)) || "null");
    if (value?.version === 1 && ["new", "done", "skipped"].includes(value.intro) && typeof value.enabled === "boolean") {
      const seen = Object.fromEntries(HELP_TOPICS.filter(topic => value.seen?.[topic] === true).map(topic => [topic, true]));
      state = { version: 1, intro: value.intro, enabled: value.enabled, seen };
    }
  } catch { /* Blocked or malformed storage cannot block play. */ }
  cache.set(playerId, state);
  return state;
}

function save(playerId: string, state: LearningState) {
  if (!playerId) return;
  cache.set(playerId, state);
  // Showing the intro is a creation-time event. A reload is a restored session,
  // and only an explicit Continue opts into automatic tips.
  const persisted = state.intro === "new" ? { ...state, intro: "done", enabled: false } : state;
  try { globalThis.localStorage?.setItem(learningKey(playerId), JSON.stringify(persisted)); } catch { /* Keep this session usable. */ }
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(LEARNING_EVENT, { detail: playerId }));
}

/** Called only by an explicit new-explorer flow, never by session recovery. */
export function beginLearning(playerId: string) {
  if (cache.has(playerId)) return;
  try { if (globalThis.localStorage?.getItem(learningKey(playerId))) return; } catch { /* Memory is sufficient for this session. */ }
  save(playerId, { version: 1, intro: "new", enabled: true, seen: {} });
}

export function finishLearningIntro(playerId: string, enabled: boolean) {
  save(playerId, { ...readLearning(playerId), intro: enabled ? "done" : "skipped", enabled });
}

export function setLearningEnabled(playerId: string, enabled: boolean) {
  save(playerId, { ...readLearning(playerId), enabled });
}

export function acknowledgeTopic(playerId: string, topic: HelpTopic) {
  const state = readLearning(playerId);
  if (!state.seen[topic]) save(playerId, { ...state, seen: { ...state.seen, [topic]: true } });
}
