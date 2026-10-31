import { existsSync } from "node:fs";
import { join } from "node:path";

export function defaultDatabasePath(directory = ".data") {
  if (process.env.DATABASE_PATH) return process.env.DATABASE_PATH;
  const current = join(directory, "questlayer-hackathon.sqlite");
  const legacy = join(directory, "auratrail.sqlite");
  if (existsSync(current) && existsSync(legacy)) {
    throw new Error("Two state databases exist; set DATABASE_PATH explicitly before startup.");
  }
  // Existing state remains authoritative until an explicit offline migration.
  return existsSync(legacy) ? legacy : current;
}
