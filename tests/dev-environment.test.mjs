import test from "node:test";
import assert from "node:assert/strict";
import { developmentEnvironment } from "../scripts/dev-environment.mjs";

test("local preview and API share a known origin", () => {
  assert.equal(developmentEnvironment({}).APP_ORIGIN, "http://127.0.0.1:5173");
});
test("Codespaces uses its exact HTTPS preview origin without exposing the API", () => {
  const env = developmentEnvironment({ CODESPACES: "true", CODESPACE_NAME: "quiet-quest-123", GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN: "app.github.dev" });
  assert.equal(env.APP_ORIGIN, "https://quiet-quest-123-5173.app.github.dev");
  assert.equal(env.HOST, "127.0.0.1");
  assert.equal(env.QUESTLAYER_DEV_ORIGIN, env.APP_ORIGIN);
});
test("explicit origins remain authoritative and missing cloud routing fails clearly", () => {
  assert.equal(developmentEnvironment({ APP_ORIGIN: "https://preview.example.org" }).APP_ORIGIN, "https://preview.example.org");
  assert.throws(() => developmentEnvironment({ CODESPACES: "true" }), /forwarding domain/);
});
