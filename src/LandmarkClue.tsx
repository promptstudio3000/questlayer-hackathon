// Landmark clue (server/landmark-clue.mjs): one multiple-choice question about
// the place. The options and the answer come from Wikidata, never from a model.
// One answer per player: it is sent together with the visit confirmation.
import type { QuestClue } from "./types";
import "./landmark-clue.css";
import { tr } from "./i18n";

export default function LandmarkClue({
  clue,
  choice,
  onChoose,
  disabled,
}: {
  clue: QuestClue;
  choice: string | undefined;
  onChoose: (id: string) => void;
  disabled?: boolean;
}) {
  const result = clue.result;
  return (
    <fieldset className="landmark-clue" disabled={disabled || !!result}>
      <legend>{clue.question}</legend>
      {clue.options.map((o) => {
        const state = result
          ? o.id === result.answer
            ? " right"
            : o.id === result.choice
              ? " wrong"
              : ""
          : "";
        return (
          <label key={o.id} className={`clue-option${state}`}>
            <input
              type="radio"
              name={`clue-${clue.policy}-${clue.question}`}
              value={o.id}
              checked={(result?.choice ?? choice) === o.id}
              onChange={() => onChoose(o.id)}
            />
            <span>{o.text}</span>
          </label>
        );
      })}
      <p className="fine-print">
        {result
          ? result.correct
            ? tr("Right. The answer comes from Wikidata.")
            : tr("Not quite. The highlighted answer is the one Wikidata gives.")
          : tr("One answer: {0} XP if right, {1} XP for the visit. Facts from Wikidata (CC0).", { 0: clue.xp.correct, 1: clue.xp.miss })}
      </p>
    </fieldset>
  );
}
