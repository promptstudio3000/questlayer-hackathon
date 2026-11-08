import { useEffect, useState } from "react";
import { acknowledgeTopic, finishLearningIntro, LEARNING_EVENT, readLearning, setLearningEnabled, type HelpTopic } from "./learning-store";

export function useLearning(playerId: string | undefined) {
  const owner = playerId || "";
  const [snapshot, setSnapshot] = useState(() => ({ owner, state: readLearning(owner) }));
  useEffect(() => {
    const refresh = (event?: Event) => {
      if (!event || (event as CustomEvent<string>).detail === owner) setSnapshot({ owner, state: readLearning(owner) });
    };
    refresh();
    window.addEventListener(LEARNING_EVENT, refresh);
    return () => window.removeEventListener(LEARNING_EVENT, refresh);
  }, [owner]);
  const state = snapshot.owner === owner ? snapshot.state : readLearning(owner);
  return {
    state,
    visible: (topic: HelpTopic) => !!owner && state.enabled && !state.seen[topic],
    acknowledge: (topic: HelpTopic) => acknowledgeTopic(owner, topic),
    finishIntro: (enabled: boolean) => finishLearningIntro(owner, enabled),
    enable: (enabled: boolean) => setLearningEnabled(owner, enabled),
  };
}
