// Local operator web console (W11): moderation queue, world/treasury health and
// the same audited actions as scripts/world-operator.mjs and
// server/cli/moderate.mjs. Binds to 127.0.0.1 only; on the VPS reach it with
//   ssh -L 8790:127.0.0.1:8790 user@host
// then open the link this command prints. Stop it with Ctrl+C when done.
//
//   node scripts/operator-console.mjs --database /abs/db.sqlite --operator NAME
//        [--port 8790] [--evidence-dir .data/evidence] [--chain]
import { createServer } from "node:http";
import { existsSync, readFileSync } from "node:fs";
import { isAbsolute } from "node:path";
import { randomBytes } from "node:crypto";
import { openDatabase } from "../server/database.mjs";
import "../server/schema-catalog.mjs";
import { assert } from "../server/domain.mjs";
import { Moderation } from "../server/moderation.mjs";
import { TaskEvidence } from "../server/task-evidence.mjs";
import { creatorConfiguration } from "../server/creators/runtime.mjs";
import { createCreatorServices } from "../server/creators/services.mjs";
import { createOperatorConsole } from "../server/operator/console.mjs";

const args = process.argv.slice(2),
  options = {};
for (let i = 0; i < args.length; i++) {
  const name = args[i];
  assert(
    ["--database", "--operator", "--port", "--evidence-dir", "--chain"].includes(
      name,
    ) && !(name in options),
    `Unknown or repeated option ${name}.`,
  );
  if (name === "--chain") options[name] = true;
  else {
    assert(args[i + 1] && !args[i + 1].startsWith("--"), `Missing ${name}.`);
    options[name] = args[++i];
  }
}
const path = options["--database"],
  operator = options["--operator"],
  port = Number(options["--port"] || 8790);
assert(
  typeof path === "string" && isAbsolute(path) && existsSync(path),
  "An existing absolute --database path is required.",
);
assert(
  typeof operator === "string" && /^[A-Za-z0-9_.@-]{1,80}$/.test(operator),
  "Name the operator with --operator NAME (it is written to every audit entry).",
);
assert(Number.isInteger(port) && port > 1023 && port < 65536, "Use --port 1024-65535.");

async function chainReader() {
  const [{ createNearProvider }, { NativeContractReader }, network] =
    await Promise.all([
      import("../server/near-provider.mjs"),
      import("../server/native/reader.mjs"),
      import("../server/native/network.mjs"),
    ]);
  const manifest = JSON.parse(
    readFileSync(
      new URL(`../public/${network.manifestName("native-rewards")}`, import.meta.url),
      "utf8",
    ),
  );
  return new NativeContractReader(
    createNearProvider(process.env.NEAR_RPC_URL || network.DEFAULT_RPC),
    manifest.contractId,
  );
}

const db = openDatabase(path);
const config = creatorConfiguration();
const creators = config.enabled
  ? createCreatorServices(db, {
      policy: config.policy,
      isModerator: (actor) => config.moderators.includes(actor),
      isCompletionAuthority: (actor) =>
        config.completionAuthorities.includes(actor),
    })
  : null;
const moderation = new Moderation(db, {
  authorizeOperator: (actor) => actor === operator,
  creators,
  evidence: new TaskEvidence(db, {
    directory: options["--evidence-dir"] || ".data/evidence",
  }),
});
const ui = (file) =>
  readFileSync(new URL(`../server/operator/console-ui/${file}`, import.meta.url), "utf8");
const token = randomBytes(24).toString("base64url");
const handle = createOperatorConsole(db, {
  operator,
  token,
  moderation,
  chain: options["--chain"] ? await chainReader() : null,
  assets: {
    "/": { body: ui("index.html"), type: "text/html; charset=utf-8" },
    "/console.js": { body: ui("console.js"), type: "text/javascript; charset=utf-8" },
    "/console.css": { body: ui("console.css"), type: "text/css; charset=utf-8" },
  },
});
const server = createServer(handle);
server.listen(port, "127.0.0.1", () => {
  console.log(`Operator console for ${operator} (local only):`);
  console.log(`  http://127.0.0.1:${port}/#token=${token}`);
  console.log("The link is the credential. Do not share it. Ctrl+C to stop.");
});
const stop = () => server.close(() => (db.close(), process.exit(0)));
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
