#!/usr/bin/env node
// npm run poi:classify -- <overpass.json> [--overture places.json] [--db state.sqlite] [--out records.jsonl]
// Classifies one bounded region (an H3 res-5 tile or a small city) offline.
// Prints the report as JSON; writes records as JSON lines when --out is given.
import { readFileSync, writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import {
  classifyPois,
  loadPoiClosures,
  osmToInputs,
  overtureToInputs,
} from "./index.mjs";

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  if (i < 0) return null;
  const [value] = args.splice(i, 2).slice(1);
  return value;
};
const overture = flag("--overture"),
  dbPath = flag("--db"),
  out = flag("--out");
if (args.length !== 1) {
  console.error(
    "Usage: npm run poi:classify -- <overpass.json> [--overture places.json] [--db state.sqlite] [--out records.jsonl]",
  );
  process.exit(2);
}
const read = (p) => JSON.parse(readFileSync(p, "utf8"));
const osm = osmToInputs(read(args[0]).elements || []);
const pois = [
  ...osm.pois,
  ...(overture ? overtureToInputs(read(overture)) : []),
];
let closures = [];
if (dbPath) {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  closures = loadPoiClosures(db);
  db.close();
}
const { records, report } = classifyPois({ ...osm, pois, closures });
if (out)
  writeFileSync(out, records.map((r) => JSON.stringify(r)).join("\n") + "\n");
console.log(
  JSON.stringify(
    {
      ...report,
      paths: osm.paths.length,
      grounds: osm.areas.length,
      closures: closures.length,
    },
    null,
    2,
  ),
);
