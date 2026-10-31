import {
  creatorAssert as fail,
  creatorFields,
  creatorText,
} from "./operations.mjs";

export const OBSERVATION_POLICY = Object.freeze({
  version: "creator-observation-v1",
  template: "observation-v1",
  maxAttempts: 3,
  maxEvidenceChars: 1000,
  maxPromptChars: 500,
  terminalRejection: "resolve-without-completion",
  attests:
    "Independent review of private text against the accepted prompt. Does not verify GPS, a physical visit or the path walked.",
});
export function observationRequirement(value) {
  creatorFields(value, ["template", "policyVersion", "prompt"]);
  fail(
    value.template === OBSERVATION_POLICY.template &&
      value.policyVersion === OBSERVATION_POLICY.version,
    "Unsupported observation validation policy.",
    "CREATOR_INPUT",
    400,
  );
  return {
    template: OBSERVATION_POLICY.template,
    policyVersion: OBSERVATION_POLICY.version,
    prompt: creatorText(value.prompt, OBSERVATION_POLICY.maxPromptChars),
  };
}
// No approved award policy exists. A future adapter needs an explicit version and
// reviewed settlement implementation; this adapter cannot mutate economy rows.
export const CREATOR_AWARD_ADAPTER = Object.freeze({
  version: "unconfigured-v1",
  status: "not-configured",
  settleInTransaction: () => ({ xp: 0, gold: 0, item: null }),
});
