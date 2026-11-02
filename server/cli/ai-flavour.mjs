#!/usr/bin/env node
// npm run ai:flavour -- [--since 7d] [--dry-run] [--max-pois N] [--budget N] [--poi PATH] [--layer ID]
//
// Runs one quest flavour batch by hand (docs/QUEST-FLAVOUR.md) against the
// database in DATABASE_PATH (or .data/). Prints the audit row as JSON. The
// provider and its key come from the environment; the key is never printed.
import { openDatabase } from "../database.mjs";
import { flavourConfiguration, runFlavourBatch } from "../ai/flavour-batch.mjs";

const args = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf(`--${name}`);
  if (i === -1) return undefined;
  const value = args[i + 1];
  if (value === undefined || value.startsWith("--")) throw Error(`--${name} needs a value.`);
  return value;
};
const known = new Set(["--since", "--dry-run", "--max-pois", "--budget", "--poi", "--layer"]);
for (const a of args) if (a.startsWith("--") && !known.has(a)) throw Error(`Unknown option ${a}.`);

const since = opt("since") ?? "7d";
const m = /^(\d{1,3})([dh])$/.exec(since);
if (!m) throw Error("--since takes days or hours, e.g. 7d or 36h.");
const sinceDays = m[2] === "d" ? Number(m[1]) : Number(m[1]) / 24;

const env = { ...process.env };
if (opt("max-pois")) env.FLAVOUR_MAX_POIS = opt("max-pois");
if (opt("budget")) env.FLAVOUR_TOKEN_BUDGET = opt("budget");
if (opt("poi")) env.POI_DB_PATH = opt("poi");
const config = flavourConfiguration(env);

const db = openDatabase();
try {
  const result = await runFlavourBatch(db, {
    env,
    config,
    sinceDays,
    trigger: "manual",
    dryRun: args.includes("--dry-run"),
    layerId: opt("layer") || undefined,
    log: (e) => console.error(JSON.stringify(e)),
  });
  console.log(JSON.stringify(result, null, 2));
  process.exitCode = result.outcome === "failed" ? 1 : 0;
} finally {
  db.close();
}
