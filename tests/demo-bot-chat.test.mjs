import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { demoBotReply } from "../server/demo-bot-chat.mjs";

function db() {
  const d = new DatabaseSync(":memory:");
  d.exec("CREATE TABLE players (id TEXT PRIMARY KEY, name TEXT)");
  d.prepare("INSERT INTO players VALUES (?,?)").run("seed-p-vera", "Vera");
  d.prepare("INSERT INTO players VALUES (?,?)").run("player_00000000-0000-0000-0000-000000000001", "Lubos");
  return d;
}
const me = "player_00000000-0000-0000-0000-000000000001";

test("a demo bot greets back by name and stores nothing", () => {
  const d = db();
  const r = demoBotReply(d, me, "seed-p-vera", "Ahoj!", 0);
  assert.equal(r.from, "Vera");
  assert.equal(r.intent, "greet");
  assert.equal(r.stored, false);
  assert.match(r.reply, /Lubos|explorer/);
  assert.doesNotMatch(r.reply, /\{/);
  assert.equal(d.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table'").get().n, 1);
});

test("a demo bot admits being a bot and has a fallback", () => {
  const d = db();
  assert.equal(demoBotReply(d, me, "seed-p-vera", "Are you a real person?").intent, "who");
  const other = demoBotReply(d, me, "seed-p-vera", "Pizza tonight?");
  assert.equal(other.intent, "other");
  assert.ok(other.reply.length > 10);
});

test("only demo bots answer and text is bounded", () => {
  const d = db();
  assert.throws(() => demoBotReply(d, me, me, "hi"), /Only demo bots/);
  assert.throws(() => demoBotReply(d, me, "seed-p-nobody", "hi"), /not available/);
  assert.throws(() => demoBotReply(d, me, "seed-p-vera", "   "), /1–500/);
  assert.throws(() => demoBotReply(d, me, "seed-p-vera", "x".repeat(501)), /1–500/);
});

test("questions win over a greeting in the same line", () => {
  const d = db();
  assert.equal(demoBotReply(d, me, "seed-p-vera", "Ahoj, jsi skutečný hráč?").intent, "who");
  assert.equal(demoBotReply(d, me, "seed-p-vera", "Hi! Where can I find gold?").intent, "gold");
  assert.equal(demoBotReply(d, me, "seed-p-vera", "Hey, how are you?").intent, "greet");
});
