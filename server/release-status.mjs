// Public read-only view of the VPS release runner (docs/VPS-RELEASE-RUNNER.md):
// GET /api/release/status and GET /api/release/ops/<id>. The runner writes the
// files with keys and runtime.env values already left out and log lines
// scrubbed; this only serves them. Testnet only.
import { readFileSync } from "node:fs";
import { join } from "node:path";

const OP_ID = /^[a-z0-9][a-z0-9-]{2,63}$/;

export function releaseStatusFile(path, dir = process.env.RELEASE_STATUS_DIR || "/var/lib/questlayer-release-status") {
  if (path === "/api/release/status") return join(dir, "status.json");
  const m = /^\/api\/release\/ops\/([^/]+)$/.exec(path);
  if (m && OP_ID.test(m[1])) return join(dir, "ops", `${m[1]}.json`);
  return null;
}

export function readReleaseStatus(path, { network, dir } = {}) {
  if (network === "mainnet") return { status: 404, body: { error: "Not found." } };
  const file = releaseStatusFile(path, dir);
  if (!file) return { status: 404, body: { error: "Not found." } };
  try {
    return { status: 200, body: JSON.parse(readFileSync(file, "utf8")) };
  } catch {
    return { status: 404, body: { error: "No release runner status yet." } };
  }
}
