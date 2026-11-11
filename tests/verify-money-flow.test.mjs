import test from "node:test";
import assert from "node:assert/strict";
import {
  FAIL,
  PASS,
  WARN,
  base58ToHex,
  classifyCodeHash,
  exitCode,
  mapDayProblems,
  parseArgs,
  payoutDayProblems,
  renderTable,
  resolveAccounts,
} from "../scripts/verify-money-flow-testnet.mjs";

const NEW = "d0fd8cc4e3dc110036b73613b9775d46ba87b7b1d1660367144b94893bbdd95f";
const OLD = "4d65564d6f575fc62858b656fd72f2973ad9a564c508cb20cdf1a2bd397f069e";
const pins = {
  contracts: { questlayer_qgold: NEW },
  testnetDeploymentsNotFromThisBuild: {
    about: "x",
    "public/native-qgold-vault-testnet.json:wasmSha256": { contract: "questlayer_qgold", sha256: OLD },
  },
};

test("NEAR base58 code hashes decode to the WASM sha256 hex", () => {
  // Recorded pairs from public/native-qgold-vault-testnet.json and native-qgold-escrow-testnet.json.
  assert.equal(base58ToHex("6D81v7i3YJKVviJUqDADFpK8oBG9oZbzasyqfazS2hnu"), OLD);
  assert.equal(base58ToHex("9TyapRKoVwC8XAukFocxAGFXGjt2uhebhDeq7C74AE9X"), "7dc6933af802454b1434d3a39ed2a3b85d32468e27f7d7f109e3bc14f24966da");
  assert.equal(base58ToHex("11111111111111111111111111111111"), "0".repeat(64));
  assert.throws(() => base58ToHex("0OIl"), /base58/);
});

test("code hash: pin passes, a recorded older build warns, anything else fails", () => {
  assert.equal(classifyCodeHash(NEW, "questlayer_qgold", pins).status, PASS);
  const pending = classifyCodeHash(OLD.toUpperCase(), "questlayer_qgold", pins);
  assert.equal(pending.status, WARN);
  assert.equal(pending.pending, true);
  assert.match(pending.detail, /not upgraded yet/);
  assert.equal(classifyCodeHash("ab".repeat(32), "questlayer_qgold", pins).status, FAIL);
  // An older build of another contract is not an excuse for this one.
  assert.equal(classifyCodeHash(OLD, "questlayer_qgold_escrow", { ...pins, contracts: { questlayer_qgold_escrow: NEW } }).status, FAIL);
  assert.equal(classifyCodeHash(NEW, "questlayer_missing", pins).status, FAIL);
});

const day = (over = {}) => ({
  root: "a".repeat(64), leaves: 3, published_at: 1, coins_reserved: "60", zones_reserved: "40",
  coins_left: "40", zones_left: "40", paid: "20", paid_leaves: 2, closed: false, ...over,
});
const progress = (over = {}) => ({ root: "a".repeat(64), leaves: 3, closed: false, paid_leaves: 1, pending_leaves: 1, statuses: ["paid", "pending", "unclaimed"], ...over });

test("payout day invariants catch overpayment and double claims", () => {
  assert.deepEqual(payoutDayProblems(day(), progress()), []);
  assert.deepEqual(payoutDayProblems(null, null), ["day missing on chain"]);
  assert.match(payoutDayProblems(day({ paid: "120" }), progress()).join(), /paid 120 > reserved 100/);
  assert.match(payoutDayProblems(day({ coins_left: "50" }), progress()).join(), /≠ reserved/);
  assert.match(payoutDayProblems(day({ paid_leaves: 4 }), progress()).join(), /claimed leaves 4 > leaves 3/);
  assert.match(payoutDayProblems(day(), progress({ statuses: ["paid", "paid", "unclaimed"] })).join(), /2 paid, settlement says 1/);
  assert.match(payoutDayProblems(day(), progress({ pending_leaves: 0 })).join(), /settlement paid 1 \+ pending 0/);
  assert.match(payoutDayProblems(day({ root: "" }), progress({ root: "" })).join(), /root/);
  assert.match(payoutDayProblems(day(), null).join(), /no settlement record/);
  const closed = day({ closed: true, coins_left: "0", zones_left: "0", paid: "90", paid_leaves: 3 });
  assert.deepEqual(payoutDayProblems(closed, progress({ closed: true, paid_leaves: 3, pending_leaves: 0, statuses: ["paid", "paid", "paid"] })), []);
  assert.match(payoutDayProblems({ ...closed, coins_left: "5" }, progress({ closed: true, paid_leaves: 3, pending_leaves: 0, statuses: ["paid", "paid", "paid"] })).join(), /closed day still holds 5/);
});

test("map day arithmetic matches the server's budget and coin value", () => {
  // Shape and numbers of the live /api/map/rewards/day on 2026-11-08.
  const d = {
    coinsU: 19615200, zonesU: 48859983, pioneerU: 19612800,
    summary: {
      cells: 16346, pioneers: 16344, coinValueU: 3, coinsPerCell: 400, unplacedU: { coins: 9632937, zones: 954 },
      budget: { coinsU: 48860937, zonesU: 48860937, coinYocto: "50000000000000000000000", zoneYocto: "50000000000000000000000", rateYocto: "1023312328159995301050" },
    },
  };
  assert.deepEqual(mapDayProblems(d), []);
  assert.match(mapDayProblems({ ...d, summary: { ...d.summary, coinValueU: 4 } }).join(), /coin value 4/);
  assert.match(mapDayProblems({ ...d, summary: { ...d.summary, budget: { ...d.summary.budget, rateYocto: "1000000000000000000000" } } }).join(), /coin budget/);
  assert.match(mapDayProblems({ ...d, coinsU: 1 }).join(), /placed 1/);
  assert.deepEqual(mapDayProblems({}), ["no budget in the map day"]);
});

test("exit code fails only on FAIL and the table summarises", () => {
  const rows = [
    { area: "3 QGOLD", check: "code hash", status: WARN, detail: "not upgraded yet" },
    { area: "4 burns", check: "supply", status: PASS, detail: "ok" },
  ];
  assert.equal(exitCode(rows), 0);
  assert.match(renderTable(rows), /1 PASS, 1 WARN, 0 FAIL → PASS with warnings/);
  rows.push({ area: "5 escrow", check: "token", status: FAIL, detail: "a ≠ b" });
  assert.equal(exitCode(rows), 1);
  const table = renderTable(rows);
  assert.match(table, /^AREA\s+CHECK\s+STATUS\s+DETAIL/);
  assert.match(table, /5 escrow\s+token\s+FAIL\s+a ≠ b/);
  assert.match(table, /→ FAIL$/);
});

test("flags override manifests and only testnet accounts are accepted", () => {
  assert.deepEqual(parseArgs(["--escrow=new-escrow.testnet", "--base-url=http://127.0.0.1:8787", "--json"]), {
    escrow: "new-escrow.testnet", "base-url": "http://127.0.0.1:8787", json: true,
  });
  assert.throws(() => parseArgs(["--escrow=evil.near"]), /\.testnet/);
  assert.throws(() => parseArgs(["--secret=1"]), /Unknown flag/);
  const read = (name) => ({
    "native-qgold-vault-testnet.json": { tokenContract: "q.testnet", rewardsContract: "r0.testnet" },
    "native-rewards-testnet.json": { contractId: "r.testnet" },
    "native-qgold-escrow-testnet.json": { contractId: "e.testnet", tokenId: "q.testnet" },
  })[name] || {};
  const ids = resolveAccounts({}, read);
  assert.equal(ids.qgold, "q.testnet");
  assert.equal(ids.rewards, "r.testnet");
  assert.equal(ids.escrow, "e.testnet");
  assert.equal(resolveAccounts({ escrow: "e2.testnet", qgold: "q2.testnet" }, read).escrow, "e2.testnet");
  assert.equal(resolveAccounts({ escrow: "e2.testnet", qgold: "q2.testnet" }, read).qgold, "q2.testnet");
});

test("the real manifests name the live testnet contracts", () => {
  const ids = resolveAccounts({});
  for (const k of ["qgold", "rewards", "escrow", "yieldVault"]) assert.match(ids[k], /\.testnet$/, k);
});
