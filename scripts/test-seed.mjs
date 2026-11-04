// Testnet test world from the command line (docs/TEST-SEED.md).
//   node scripts/test-seed.mjs status|apply|remove [--db path]
// The server does the same on start: TEST_SEED=1 applies, anything else removes.
// Same schema registrations the server loads, so the start-up check accepts
// a live database.
import "../server/schema-catalog.mjs";
import "../server/actors/hunt/schema.mjs";
import "../server/native/order-index.mjs";
import "../server/npc/trader-ledger.mjs";
import { openDatabase } from "../server/database.mjs";
import { defaultDatabasePath } from "../server/state-path.mjs";
import { NETWORK } from "../server/native/network.mjs";
import { createCreatorRuntime } from "../server/creators/runtime.mjs";
import { createActorService } from "../server/actors/service.mjs";
import { createTestSeed } from "../server/test-seed/seed.mjs";

const args = process.argv.slice(2);
const command = args.find((a) => !a.startsWith("--")) || "status";
const dbFlag = args.indexOf("--db");
const path = dbFlag >= 0 ? args[dbFlag + 1] : defaultDatabasePath();
if (!["status", "apply", "remove"].includes(command)) {
  console.error("Usage: node scripts/test-seed.mjs status|apply|remove [--db path]");
  process.exit(2);
}
if (command === "apply" && NETWORK !== "testnet") {
  console.error("The test seed is testnet only.");
  process.exit(1);
}
const db = openDatabase(path);
try {
  if (command === "apply") createActorService(db); // creates the shard table for starter kits
  const runtime = createCreatorRuntime(db, { origin: "http://localhost", authenticate: () => null, drafts: false });
  const seed = createTestSeed(db, {
    creators: runtime.services
      ? {
          services: runtime.services,
          moderator: runtime.config.moderators[0],
          completionAuthority: runtime.config.completionAuthorities[0],
          policyVersion: runtime.config.policy.version,
        }
      : null,
    log: (m) => console.log(m),
  });
  const result =
    command === "apply" ? seed.apply() : command === "remove" ? seed.purge() : seed.status();
  console.log(JSON.stringify({ database: path, command, ...result }, null, 2));
} finally {
  db.close();
}
