import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { developmentEnvironment } from "./dev-environment.mjs";

if (existsSync(".env")) process.loadEnvFile(".env");
const env = developmentEnvironment();
const children = [
  spawn(process.execPath, ["--watch", "server/index.mjs"], { stdio: "inherit", env }),
  spawn(process.execPath, ["node_modules/vite/bin/vite.js", "--host", env.CODESPACES === "true" ? "0.0.0.0" : "127.0.0.1"], { stdio: "inherit", env }),
];
let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill("SIGTERM");
  setTimeout(() => process.exit(code), 200).unref();
}
process.on("SIGINT", () => stop());
process.on("SIGTERM", () => stop());
for (const child of children) {
  child.on("exit", (code) => stop(code || 0));
  child.on("error", (error) => { console.error(error.message); stop(1); });
}
