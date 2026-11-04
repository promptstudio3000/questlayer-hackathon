import test from "node:test";
import assert from "node:assert/strict";
import { openDatabase, createPlayer } from "../server/database.mjs";
import { ensureWorld, worldView, HOME } from "../server/world.mjs";
import { claimCoin } from "../server/game.mjs";
import {
  chainLedgerSettings,
  createChainLedger,
  recordChainAction,
  enableChainLedger,
  dayOf,
} from "../server/chain-ledger/service.mjs";
import { runLedgerQueue, returnValue } from "../server/chain-ledger/chain.mjs";
import { createChainLedgerRoutes } from "../server/chain-ledger/routes.mjs";
import { EXPLORER_BASE } from "../server/native/network.mjs";
import {
  geohash,
  leafOf,
  merkle,
  verifyProof,
} from "../server/chain-ledger/merkle.mjs";

const T0 = Date.parse("2026-11-04T10:00:00Z");
const PLZEN = { lat: 49.7476, lng: 13.3776 };

function setup({ mode = "each", linked = true } = {}) {
  const db = openDatabase(":memory:");
  let t = T0;
  const now = () => t;
  const alice = createPlayer(db, "Alice", T0);
  const bob = createPlayer(db, "Bob", T0);
  const accounts = new Map([[alice, "alice.testnet"]]);
  if (linked)
    db.prepare("INSERT INTO wallet_links VALUES(?,?,?)").run(
      "alice.testnet",
      alice,
      T0,
    );
  const ledger = createChainLedger(db, {
    settings: chainLedgerSettings({ CHAIN_RECORD_MODE: mode }, "testnet"),
    linkedAccount: (p) => accounts.get(p) ?? null,
    now,
  });
  return { db, ledger, alice, bob, accounts, now, advance: (ms) => (t += ms) };
}

/** In-memory stand-in for the contract: same seq rule as contracts/ledger. */
function fakeChain() {
  const last = new Map(),
    days = new Map(),
    sent = [];
  let n = 0,
    failNext = null;
  return {
    ready: true,
    contractId: "ledger.testnet",
    goldToken: "qgold.testnet",
    sent,
    days,
    failOnce(kind) {
      failNext = kind;
    },
    async view(method, args) {
      if (method === "last_seq") return String(last.get(args.account_id) || 0);
      if (method === "get_day") return days.get(args.day) || null;
      if (method === "profile") return { account_id: args.account_id, xp: "1" };
      return null;
    },
    async recordBatch(actions) {
      if (failNext === "contract") {
        failNext = null;
        throw Object.assign(new Error("Smart contract panicked"), {
          contract: true,
          tx: "txfail",
        });
      }
      const skipped = [];
      for (const a of actions) {
        assert.match(a.ev, /^[0-9a-f]{64}$/);
        assert.ok(!a.cell || /^[0-9b-hjkmnp-z]{1,12}$/.test(a.cell));
        if (Number(a.seq) <= (last.get(a.account_id) || 0))
          skipped.push(a.ref_id);
        else last.set(a.account_id, Number(a.seq));
      }
      sent.push(actions);
      if (failNext === "network") {
        failNext = null;
        throw new Error("fetch failed");
      }
      return {
        tx: `tx${++n}`,
        value: {
          applied: actions.length - skipped.length,
          skipped: skipped.length,
          skipped_refs: skipped,
        },
      };
    },
    async commitDay(d) {
      days.set(d.day, { day: d.day, root: d.root });
      return { tx: `day${d.day}` };
    },
    last,
  };
}

test("geohash-7 matches the reference encoding and hides the exact fix", () => {
  assert.equal(geohash(57.64911, 10.40744, 11), "u4pruydqqvj");
  const cell = geohash(PLZEN.lat, PLZEN.lng);
  assert.equal(cell.length, 7);
  assert.equal(geohash(PLZEN.lat + 0.0001, PLZEN.lng + 0.0001), cell);
});

test("merkle proofs verify for every leaf, odd levels included", () => {
  for (const n of [1, 2, 3, 5, 8, 13]) {
    const leaves = Array.from({ length: n }, (_, i) =>
      leafOf({
        id: `a${i}`,
        kind: "coin",
        xp: i,
        gold_u: 1,
        at: i,
        evidence: "e",
      }),
    );
    const { root, proofs } = merkle(leaves);
    leaves.forEach((l, i) =>
      assert.ok(verifyProof(l, proofs[i], root), `${n}:${i}`),
    );
    if (n > 1) assert.equal(verifyProof(leaves[0], proofs[1], root), false);
  }
});

test("recording is off unless enabled, and off by default on mainnet", () => {
  const db = openDatabase(":memory:");
  const p = createPlayer(db, "Z", T0);
  assert.equal(recordChainAction(db, { player: p, kind: "coin", xp: 3 }), null);
  assert.equal(chainLedgerSettings({}, "mainnet").mode, "off");
  assert.equal(chainLedgerSettings({}, "testnet").mode, "each");
  assert.equal(
    chainLedgerSettings({ CHAIN_RECORD_MODE: "daily" }, "testnet").mode,
    "daily",
  );
  enableChainLedger(db, { mode: "off" });
  assert.equal(recordChainAction(db, { player: p, kind: "coin", xp: 3 }), null);
});

test("a collected coin goes on chain in the next ~2 s batch with a tx hash", async () => {
  const { db, ledger, alice } = setup();
  const w = await ensureWorld(db, HOME, true, T0);
  const coin = worldView(db, w.id).coins[0];
  const r = claimCoin(db, alice, coin.id, coin, T0);
  assert.ok(r.chain?.id.startsWith("ca_"));
  assert.equal(r.chain.status, "queued");
  const row = db
    .prepare("SELECT * FROM chain_actions WHERE id=?")
    .get(r.chain.id);
  assert.equal(row.cell, geohash(coin.lat, coin.lng, 7));
  assert.equal(row.gold_u, coin.value_u);
  assert.ok(!row.evidence_json.includes('"cell"'));
  const chain = fakeChain();
  const done = await runLedgerQueue(ledger, chain);
  assert.equal(done.confirmed, 1);
  const v = ledger.get(r.chain.id, alice);
  assert.equal(v.status, "confirmed");
  assert.equal(v.tx, "tx1");
  assert.equal(v.explorer, `${EXPLORER_BASE}/txns/tx1`);
  const sent = chain.sent[0][0];
  assert.equal(sent.account_id, "alice.testnet");
  assert.equal(sent.seq, "1");
  assert.equal(sent.kind, r.find ? "find" : "coin");
  assert.equal(sent.gold, String(coin.value_u));
  assert.equal(sent.ref_id, r.chain.id);
  // Only the owner can read a record.
  assert.equal(ledger.get(r.chain.id, "someone-else"), null);
});

test("actions are batched: everything since the last pass is one transaction", async () => {
  const { db, ledger, alice } = setup();
  for (let i = 0; i < 30; i++)
    recordChainAction(db, {
      player: alice,
      kind: "coin",
      xp: 3,
      gold: 10,
      at: PLZEN,
      now: T0 + i,
    });
  const chain = fakeChain();
  await runLedgerQueue(ledger, chain);
  assert.equal(chain.sent.length, 1);
  assert.equal(chain.sent[0].length, 25);
  await runLedgerQueue(ledger, chain);
  assert.equal(chain.sent[1].length, 5);
  assert.deepEqual(
    chain.sent.flat().map((a) => Number(a.seq)),
    Array.from({ length: 30 }, (_, i) => i + 1),
  );
});

test("actions before registering wait and go on chain once the account exists", async () => {
  const { db, ledger, bob, accounts } = setup();
  const r = recordChainAction(db, {
    player: bob,
    kind: "monster",
    xp: 40,
    now: T0,
  });
  assert.equal(r.status, "no-account");
  const chain = fakeChain();
  await runLedgerQueue(ledger, chain);
  assert.equal(chain.sent.length, 0);
  assert.equal(ledger.get(r.id, bob).status, "no-account");
  accounts.set(bob, "bob.testnet");
  await runLedgerQueue(ledger, chain);
  assert.equal(ledger.get(r.id, bob).status, "confirmed");
});

test("a contract failure retries; a lost reply is confirmed from the chain's seq", async () => {
  const { db, ledger, alice, advance } = setup();
  const a = recordChainAction(db, {
    player: alice,
    kind: "quest",
    xp: 20,
    gold: 5,
    now: T0,
  });
  const chain = fakeChain();
  chain.failOnce("contract");
  await runLedgerQueue(ledger, chain);
  assert.equal(ledger.get(a.id, alice).status, "sent");
  advance(10_000);
  chain.failOnce("network");
  await runLedgerQueue(ledger, chain);
  // The batch landed although the reply was lost.
  assert.equal(ledger.get(a.id, alice).status, "confirmed");
  advance(10_000);
  await runLedgerQueue(ledger, chain);
  assert.equal(chain.sent.length, 1);
});

test("a stale seq (restored database) is renumbered above the chain's", async () => {
  const { db, ledger, alice } = setup();
  const chain = fakeChain();
  chain.last.set("alice.testnet", 7);
  db.prepare("INSERT INTO chain_seq VALUES(?,?)").run("alice.testnet", 2);
  const a = recordChainAction(db, {
    player: alice,
    kind: "coin",
    xp: 3,
    now: T0,
  });
  await runLedgerQueue(ledger, chain);
  assert.equal(ledger.record(a.id).seq, 8);
  await runLedgerQueue(ledger, chain);
  assert.equal(ledger.get(a.id, alice).status, "confirmed");
  assert.equal(chain.last.get("alice.testnet"), 8);
});

test("each mode also commits a Merkle root per finished day with proofs", async () => {
  const { db, ledger, alice, advance } = setup();
  const ids = [];
  for (let i = 0; i < 5; i++)
    ids.push(
      recordChainAction(db, {
        player: alice,
        kind: "coin",
        xp: 3,
        gold: 1,
        at: PLZEN,
        now: T0 + i,
      }).id,
    );
  const chain = fakeChain();
  await runLedgerQueue(ledger, chain);
  assert.equal(chain.days.size, 0);
  advance(86_400_000);
  await runLedgerQueue(ledger, chain);
  const v = ledger.get(ids[3], alice);
  assert.equal(v.proof.day, dayOf(T0));
  assert.equal(v.dayTx, `day${dayOf(T0)}`);
  assert.equal(v.proof.root, chain.days.get(dayOf(T0)).root);
  assert.ok(verifyProof(v.proof.leaf, v.proof.proof, v.proof.root));
});

test("daily mode records one total per account and kind after the day's root", async () => {
  const { db, ledger, alice, advance } = setup({ mode: "daily" });
  for (let i = 0; i < 4; i++)
    recordChainAction(db, {
      player: alice,
      kind: "coin",
      xp: 3,
      gold: 10,
      at: PLZEN,
      now: T0 + i,
    });
  const m = recordChainAction(db, {
    player: alice,
    kind: "monster",
    xp: 50,
    now: T0 + 9,
  });
  const chain = fakeChain();
  await runLedgerQueue(ledger, chain);
  assert.equal(chain.sent.length, 0);
  assert.equal(ledger.get(m.id, alice).status, "queued");
  advance(86_400_000);
  await runLedgerQueue(ledger, chain);
  const sent = chain.sent.flat();
  assert.equal(sent.length, 2);
  const coin = sent.find((a) => a.kind === "coin");
  assert.deepEqual(
    [coin.xp, coin.gold, coin.count, coin.cell],
    ["12", "40", 4, null],
  );
  assert.equal(coin.ev, chain.days.get(dayOf(T0)).root);
  assert.equal(ledger.get(m.id, alice).status, "confirmed");
  assert.ok(ledger.get(m.id, alice).proof);
});

test("routes: list, one record and the on-chain profile", async () => {
  const { db, ledger, alice } = setup();
  const a = recordChainAction(db, {
    player: alice,
    kind: "find",
    xp: 8,
    gold: 5,
    at: PLZEN,
    now: T0,
  });
  const chain = fakeChain();
  const routes = createChainLedgerRoutes(ledger, {
    chain: () => chain,
    linkedAccount: () => "alice.testnet",
  });
  const call = async (path) => {
    let out;
    const handled = await routes.handle(
      { method: "GET" },
      null,
      new URL(`http://x${path}`),
      {
        player: alice,
        respond: (_res, v) => (out = v),
        assert: (c, m, s) => {
          if (!c) throw Object.assign(new Error(m), { status: s });
        },
      },
    );
    return { handled, out };
  };
  assert.equal((await call("/api/chain/actions")).out.actions[0].id, a.id);
  assert.equal((await call(`/api/chain/actions/${a.id}`)).out.status, "queued");
  assert.equal(
    (await call("/api/chain/profile")).out.profile.account_id,
    "alice.testnet",
  );
  assert.equal((await call("/api/chain/other")).handled, false);
  const off = createChainLedgerRoutes(null);
  let v;
  await off.handle(
    { method: "GET" },
    null,
    new URL("http://x/api/chain/actions"),
    { respond: (_r, x) => (v = x) },
  );
  assert.equal(v.enabled, false);
});

test("returnValue reads the called method's result", () => {
  const value = Buffer.from(JSON.stringify({ applied: 2 })).toString("base64");
  const r = {
    transaction_outcome: { outcome: { receipt_ids: ["r1"] } },
    receipts_outcome: [
      { id: "r1", outcome: { status: { SuccessValue: value } } },
    ],
  };
  assert.deepEqual(returnValue(r), { applied: 2 });
});
