// Loading schema definitions performs no database, network or credential IO.
// An unavailable feature definition cannot authorize a snapshot containing it.
import { existsSync } from "node:fs";
for (const relative of [
  "./actors/hunt/schema.mjs",
  "./actors/schema.mjs",
  "./adventure-results.mjs",
  "./ai/schema.mjs",
  "./creators/bonus-vote.mjs",
  "./daily-board/schema.mjs",
  "./earned-editions.mjs",
  "./creators/completion.mjs",
  "./moderation.mjs",
  "./native/creator-money.mjs",
  "./native/day-contracts.mjs",
  "./native/order-index.mjs",
  "./native/social-records.mjs",
  "./npc/rolls-schema.mjs",
  "./npc/keeper-vault.mjs",
  "./npc/patron-rank.mjs",
  "./npc/trader-ledger.mjs",
  "./operator/world-controls.mjs",
  "./relayer/schema.mjs",
  "./season/schema.mjs",
  "./spatial/place-safety.mjs",
  "./staker-gates.mjs",
  "./task-evidence.mjs",
]) {
  const url = new URL(relative, import.meta.url);
  if (existsSync(url)) await import(url.href);
}
