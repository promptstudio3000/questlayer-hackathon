import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPlayer, history, openDatabase } from "../server/database.mjs";
import {
  hashTesterPassword,
  initializeTesterLogin,
  setTesterLogin,
  testerLogin,
  verifyTesterPassword,
} from "../server/identity/test-login.mjs";

const SCRIPT = new URL("../scripts/tester-account.mjs", import.meta.url).pathname;
const FAUCET_U = 120_000 * 1_000_000;

test("tester sign-in stores only a salted hash and refuses mainnet", () => {
  const db = openDatabase(":memory:");
  initializeTesterLogin(db);
  const owner = createPlayer(db, "Owner");
  const secret = hashTesterPassword("correct horse");
  assert.doesNotMatch(secret, /correct/);
  assert.notEqual(secret, hashTesterPassword("correct horse"), "salted");
  assert.ok(verifyTesterPassword("correct horse", secret));
  assert.throws(() => setTesterLogin(db, { name: "owner", playerId: owner, secret: "correct horse" }));
  setTesterLogin(db, { name: "owner", playerId: owner, secret });
  assert.equal(testerLogin(db, { network: "testnet", name: "OWNER", password: "correct horse" }), owner);
  assert.equal(testerLogin(db, { network: "testnet", name: "owner", password: "wrong pass" }), null);
  assert.equal(testerLogin(db, { network: "testnet", name: "nobody", password: "correct horse" }), null);
  assert.equal(testerLogin(db, { network: "mainnet", name: "owner", password: "correct horse" }), null);
});

test("faucet cleanup removes only the old demo credit and keeps the tester", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "tester-")), file = join(dir, "db.sqlite");
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  let db = openDatabase(file);
  const credit = (name, goldU) => {
    const p = createPlayer(db, name);
    db.prepare("UPDATE history SET gold_u=?, meta=? WHERE player_id=? AND kind='welcome'")
      .run(FAUCET_U, JSON.stringify({ source: "demo-faucet", network: "demo" }), p);
    db.prepare("UPDATE players SET gold_u=? WHERE id=?").run(goldU, p);
    return p;
  };
  const owner = credit("coinmandeer", FAUCET_U),
    earner = credit("Earner", FAUCET_U + 5_000),
    spender = credit("Spender", 1_000),
    fresh = createPlayer(db, "Fresh");
  history(db, earner, "coin", "Coin", 5_000, {});
  db.close();
  const run = (...args) => JSON.parse(execFileSync(process.execPath, [SCRIPT, ...args], { encoding: "utf8" }));
  const dry = run("remove-faucet", "--database", file, "--keep-name", "coinmandeer");
  assert.equal(dry.applied, false);
  assert.equal(dry.changed, 2);
  assert.deepEqual(dry.kept.map((p) => p.id), [owner]);
  const done = run("remove-faucet", "--database", file, "--keep-name", "coinmandeer", "--apply");
  assert.equal(done.removedU, FAUCET_U + 1_000);
  db = openDatabase(file);
  const gold = (p) => db.prepare("SELECT gold_u FROM players WHERE id=?").get(p).gold_u;
  assert.equal(gold(owner), FAUCET_U);
  assert.equal(gold(earner), 5_000);
  assert.equal(gold(spender), 0);
  assert.equal(gold(fresh), 0);
  assert.equal(db.prepare("SELECT gold_u FROM history WHERE player_id=? AND kind='welcome'").get(earner).gold_u, 0);
  db.close();
  assert.equal(run("remove-faucet", "--database", file, "--keep-name", "coinmandeer", "--apply").changed, 0, "runs once");
  const secret = execFileSync(process.execPath, [SCRIPT, "hash"], { input: "owner-pass\n", encoding: "utf8" }).trim();
  assert.equal(run("set-login", "--database", file, "--name", "coinmandeer", "--secret", secret, "--apply").player, owner);
  assert.equal(run("remove-faucet", "--database", file).changed, 0, "the tester login is always kept");
  db = openDatabase(file);
  initializeTesterLogin(db);
  assert.equal(testerLogin(db, { network: "testnet", name: "coinmandeer", password: "owner-pass" }), owner);
});
