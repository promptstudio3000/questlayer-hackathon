// Tester sign-in (testnet only): one named explorer the owner tests with can
// sign in with a name and a password he chose. Only a salted scrypt hash is
// stored (table tester_logins); the password never reaches git, logs or env.
// Mainnet refuses this sign-in. Set it with scripts/tester-account.mjs.
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import {
  registerModuleSchema,
  ensureModuleVersion,
} from "../schema-compatibility.mjs";

export const TESTER_LOGIN_SCHEMA = registerModuleSchema({
  name: "tester-login",
  version: 1,
  sql: `
CREATE TABLE IF NOT EXISTS tester_logins(
 name TEXT PRIMARY KEY COLLATE NOCASE,
 player_id TEXT NOT NULL UNIQUE REFERENCES players(id),
 secret TEXT NOT NULL CHECK(secret GLOB 'scrypt$*'),
 created_at INTEGER NOT NULL
);
`,
});

const N = 16384,
  R = 8,
  P = 1,
  LEN = 32;
const SECRET = /^scrypt\$(\d+)\$([a-f0-9]{32})\$([a-f0-9]{64})$/;

export function initializeTesterLogin(db) {
  ensureModuleVersion(db, TESTER_LOGIN_SCHEMA);
}

/** "scrypt$<N>$<salt hex>$<hash hex>" for a password. */
export function hashTesterPassword(password, salt = randomBytes(16)) {
  if (
    typeof password !== "string" ||
    password.length < 6 ||
    password.length > 128
  )
    throw Error("The tester password needs 6 to 128 characters.");
  const key = scryptSync(password, salt, LEN, { N, r: R, p: P });
  return `scrypt$${N}$${salt.toString("hex")}$${key.toString("hex")}`;
}

export function verifyTesterPassword(password, secret) {
  const m = SECRET.exec(secret || "");
  if (!m || typeof password !== "string" || password.length > 128)
    return false;
  const n = Number(m[1]);
  if (n < N || n > 1 << 20) return false;
  const key = scryptSync(password, Buffer.from(m[2], "hex"), LEN, {
    N: n,
    r: R,
    p: P,
    maxmem: 256 * n * R,
  });
  return timingSafeEqual(key, Buffer.from(m[3], "hex"));
}

export function setTesterLogin(db, { name, playerId, secret, now = Date.now() }) {
  if (!SECRET.test(secret || ""))
    throw Error("Pass the hashed secret (scrypt$...), never the password.");
  if (!db.prepare("SELECT 1 FROM players WHERE id=?").get(playerId))
    throw Error("Unknown explorer.");
  db.prepare("DELETE FROM tester_logins WHERE name=? OR player_id=?").run(
    name,
    playerId,
  );
  db.prepare("INSERT INTO tester_logins VALUES(?,?,?,?)").run(
    name,
    playerId,
    secret,
    now,
  );
}

const DUMMY = `scrypt$${N}$${"0".repeat(32)}$${"0".repeat(64)}`;

/** The explorer id for a correct name + password, else null. */
export function testerLogin(db, { network, name, password }) {
  if (network === "mainnet") return null;
  if (typeof name !== "string" || name.length > 64) return null;
  const row = db
    .prepare("SELECT player_id, secret FROM tester_logins WHERE name=?")
    .get(name.trim());
  // Hash anyway, so a wrong name and a wrong password take the same time.
  const ok = verifyTesterPassword(password, row?.secret || DUMMY);
  return row && ok ? row.player_id : null;
}
