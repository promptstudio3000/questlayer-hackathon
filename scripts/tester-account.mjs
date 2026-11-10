#!/usr/bin/env node
// Owner tester account and the old demo faucet (testnet only).
//
//   node scripts/tester-account.mjs hash            < password on stdin
//     Prints the salted scrypt secret. Run it locally; only the secret is
//     passed on, never the password.
//   node scripts/tester-account.mjs set-login --database DB --name NAME --secret SECRET [--player ID] [--apply]
//     Lets the explorer NAME (or explorer ID) sign in at /?tester.
//   node scripts/tester-account.mjs remove-faucet --database DB [--keep-name NAME]... [--apply]
//     Explorers created before 10 Nov 2026 got a 120,000 GOLD "demo-faucet"
//     credit. Removes only that credit (never below 0) from every explorer
//     except the kept names, and zeroes the welcome history amount, so
//     "QGOLD earned" shows only backed earnings.
// Without --apply both mutating commands only print what they would do.
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { atomic, history, openDatabase } from "../server/database.mjs";
import {
  hashTesterPassword,
  initializeTesterLogin,
  setTesterLogin,
} from "../server/identity/test-login.mjs";

const GOLD = 1_000_000;
const FAUCET_U = 120_000 * GOLD;
const [command, ...args] = process.argv.slice(2);
const options = { keep: [] };
for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (arg === "--apply") options.apply = true;
  else if (arg === "--keep-name") options.keep.push(args[++i]);
  else if (["--database", "--name", "--secret", "--player"].includes(arg))
    options[arg.slice(2)] = args[++i];
  else throw Error(`Unknown option ${arg}.`);
}

if (command === "hash") {
  const password = readFileSync(0, "utf8").replace(/\r?\n$/, "");
  console.log(hashTesterPassword(password));
  process.exit(0);
}
if (!options.database || !existsSync(options.database))
  throw Error("Pass --database with the live database file.");
if ((process.env.NEAR_NETWORK || "testnet") === "mainnet")
  throw Error("The tester account and the faucet cleanup are testnet only.");
const db = openDatabase(resolve(options.database));
initializeTesterLogin(db);

function explorersNamed(name) {
  return db
    .prepare(
      `SELECT p.id, p.name, p.gold_u, p.created_at,
        (SELECT COUNT(*) FROM history h WHERE h.player_id=p.id) events
       FROM players p WHERE p.name=? COLLATE NOCASE ORDER BY events DESC, p.created_at`,
    )
    .all(name);
}

if (command === "set-login") {
  if (!options.name || !options.secret)
    throw Error("Pass --name and --secret (from the hash command).");
  const matches = options.player
    ? db.prepare("SELECT id, name, gold_u FROM players WHERE id=?").all(options.player)
    : explorersNamed(options.name);
  if (matches.length !== 1) {
    console.log(JSON.stringify({ name: options.name, matches }, null, 1));
    throw Error(
      matches.length
        ? "Several explorers have this name: pass --player ID."
        : "No explorer has this name.",
    );
  }
  const [explorer] = matches;
  if (options.apply)
    setTesterLogin(db, {
      name: options.name,
      playerId: explorer.id,
      secret: options.secret,
    });
  console.log(
    JSON.stringify({ applied: !!options.apply, name: options.name, player: explorer.id, goldU: explorer.gold_u }),
  );
} else if (command === "remove-faucet") {
  const kept = new Set(
    options.keep.flatMap((name) => explorersNamed(name).map((p) => p.id)),
  );
  for (const row of db.prepare("SELECT player_id FROM tester_logins").all())
    kept.add(row.player_id);
  const credited = db
    .prepare(
      `SELECT p.id, p.name, p.gold_u, h.id welcome
       FROM history h JOIN players p ON p.id=h.player_id
       WHERE h.kind='welcome' AND h.gold_u=? AND json_extract(h.meta,'$.source')='demo-faucet'
       ORDER BY p.created_at`,
    )
    .all(FAUCET_U);
  const changes = credited
    .filter((p) => !kept.has(p.id))
    .map((p) => ({
      id: p.id,
      name: p.name,
      beforeU: p.gold_u,
      afterU: Math.max(0, p.gold_u - FAUCET_U),
      welcome: p.welcome,
    }));
  if (options.apply)
    atomic(db, () => {
      for (const c of changes) {
        db.prepare("UPDATE players SET gold_u=? WHERE id=?").run(c.afterU, c.id);
        db.prepare("UPDATE history SET gold_u=0 WHERE id=?").run(c.welcome);
        history(db, c.id, "faucet-removed", "Practice GOLD removed: every GOLD is now real QGOLD", c.afterU - c.beforeU, {
          source: "demo-faucet-cleanup",
        });
      }
    });
  console.log(
    JSON.stringify(
      {
        applied: !!options.apply,
        credited: credited.length,
        kept: credited.filter((p) => kept.has(p.id)).map((p) => ({ id: p.id, name: p.name, goldU: p.gold_u })),
        changed: changes.length,
        removedU: changes.reduce((n, c) => n + c.beforeU - c.afterU, 0),
        changes: changes.map(({ welcome, ...c }) => c),
      },
      null,
      1,
    ),
  );
} else {
  throw Error("Use hash, set-login or remove-faucet.");
}
