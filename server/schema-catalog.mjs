// Loading schema definitions performs no database, network or credential IO.
// An unavailable feature definition cannot authorize a snapshot containing it.
import { existsSync } from "node:fs";
for (const relative of [
  "./adventure-results.mjs",
  "./creators/completion.mjs",
  "./relayer/schema.mjs",
]) {
  const url = new URL(relative, import.meta.url);
  if (existsSync(url)) await import(url.href);
}
