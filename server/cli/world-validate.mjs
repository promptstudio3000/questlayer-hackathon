#!/usr/bin/env node
// npm run world:validate -- [file ...]
// Validates WorldPacks (docs/WORLDS-PLAN.md B.4) and prints a JSON report with
// one reason per failure. With no file, checks every pack in server/data/worlds/
// and the registry. Exits 1 when any pack fails.
import { readdirSync } from "node:fs";
import { relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { validateWorldPackFile } from "../worlds/validate.mjs";

const root = resolve(fileURLToPath(import.meta.url), "..", "..", "..");
let files = process.argv.slice(2).map((f) => relative(root, resolve(process.cwd(), f)));
if (!files.length)
  files = readdirSync(resolve(root, "server/data/worlds"))
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => `server/data/worlds/${f}`);
const reports = files.map((f) => {
  try {
    return validateWorldPackFile(f);
  } catch (e) {
    return { file: f, ok: false, id: null, failures: [{ rule: "schema", path: "$", reason: e.message }], warnings: [] };
  }
});
let registry = null;
if (!process.argv[2]) {
  try {
    const { WORLD_REGISTRY } = await import("../worlds/registry.mjs");
    registry = { ok: true, default: WORLD_REGISTRY.defaultLayer.id, layers: WORLD_REGISTRY.allLayers.map((l) => ({ id: l.id, status: l.status, hash: l.hash })) };
  } catch (e) {
    registry = { ok: false, reason: e.message };
  }
}
const ok = reports.every((r) => r.ok) && (registry?.ok ?? true);
console.log(JSON.stringify({ ok, reports, ...(registry ? { registry } : {}) }, null, 2));
process.exit(ok ? 0 : 1);
