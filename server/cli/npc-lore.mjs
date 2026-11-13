// Operator view of the shared NPC memory (server/npc/lore.mjs). OS access to
// the database is the authority; there is no HTTP endpoint for this.
//
//   node server/cli/npc-lore.mjs list  --database /abs/db.sqlite --place city:plzen [--state accepted|pending|hidden]
//   node server/cli/npc-lore.mjs set   --database /abs/db.sqlite --id lore_... --state accepted|pending|hidden
// Contributors are never printed (they are stored only as a one-way hash).
import { existsSync } from "node:fs";
import { isAbsolute } from "node:path";
import "../schema-catalog.mjs";
import { openDatabase } from "../database.mjs";
import { createLoreService } from "../npc/lore.mjs";

const [command, ...args] = process.argv.slice(2);
const opt = {};
for (let i = 0; i < args.length; i += 2) {
  if (!["--database", "--place", "--state", "--id"].includes(args[i])) throw Error(`Unknown option ${args[i]}`);
  opt[args[i].slice(2)] = args[i + 1];
}
if (!opt.database || !isAbsolute(opt.database) || !existsSync(opt.database)) throw Error("--database must be an existing absolute path.");
const db = openDatabase(opt.database);
try {
  const lore = createLoreService(db, { seeds: [] });
  if (command === "list") {
    if (!opt.place) throw Error("--place is required (city:<id> or h3:<cell>).");
    for (const r of lore.list(opt.place, opt.state || null))
      console.log(`${r.id}\t${r.state}\t${r.source}\t${r.topic}\t+${r.confirmations}\t${r.text}`);
  } else if (command === "set") {
    if (!opt.id || !opt.state) throw Error("--id and --state are required.");
    console.log(lore.setState(opt.id, opt.state) ? "updated" : "not found");
  } else throw Error("Command must be list or set.");
} finally {
  db.close();
}
