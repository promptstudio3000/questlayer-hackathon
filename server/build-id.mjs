import { readFileSync } from "node:fs";

// The deploy script writes build-id.txt (the deployed commit) next to server/.
// An explicit QUESTLAYER_BUILD_ID still wins; without either, health reports
// development-unrecorded.
export function resolveBuildId({
  env = process.env,
  file = new URL("../build-id.txt", import.meta.url),
} = {}) {
  if (env.QUESTLAYER_BUILD_ID) return env.QUESTLAYER_BUILD_ID;
  try {
    return readFileSync(file, "utf8").trim() || undefined;
  } catch {
    return undefined;
  }
}
