// Treasury DAO, Mac side (docs/TREASURY-DAO.md). Testnet only; keys stay in .data/.
//
//   node scripts/treasury-dao-testnet.mjs setup [--execute]    # keeper + 2 council keys, the Sputnik DAO, the manifest
//   node scripts/treasury-dao-testnet.mjs status               # roles, this week's vote, adopted mix, today's run
//   node scripts/treasury-dao-testnet.mjs daily [--dry-run]    # tally / open polls, sync Explorers, file + auto-approve today's run
//   node scripts/treasury-dao-testnet.mjs poll "<question>" "<option a>" "<option b>" [...]  # extra vote for this week
//   node scripts/treasury-dao-testnet.mjs qgold-council [--execute]  # QGOLD vault council -> the DAO (SetCouncil)
//
// Accounts (sub-accounts of the operator, keys in .data/treasury-dao-keys.json, chmod 600):
//   keeper.<operator>     Requestor: files proposals, casts the automatic vote for the recommended option
//   council-a / council-b Approver + Admin: the two automatic council keys (2 of 3 approve)
//   <operator>            the third council seat (Lubos), can approve, reject or change the policy in Trezu
//
// The automatic keys approve only what this script checked: a tally that
// matches the chain, a member list from the game's eligibility rule, and a
// daily run whose target is the adopted mix and whose plan stays inside the
// treasury-mix limits. Nothing here can move treasury money: custody stays
// where it is (docs/TREASURY-DAO.md, "Custody").
import { readFileSync, writeFileSync, statSync, existsSync, renameSync } from "node:fs";
import assert from "node:assert/strict";
import { Account, KeyPair, KeyPairSigner } from "near-api-js";
import { createNearProvider, rpcErrorText } from "../server/near-provider.mjs";
import { mixSettings, readMix } from "../server/native/treasury-mix.mjs";
import {
  DAO_FACTORY,
  DAO_NAME,
  MIX_PRESETS,
  RECOMMENDED_MIX,
  EXPLORER_RULE,
  buildPolicy,
  explorersRole,
  describe,
  readDao,
  roleMembers,
  tallyPoll,
  pollIds,
  adoptedMix,
  dailyRun,
  checkDailyRun,
  weekOf,
  utcDate,
} from "../server/native/treasury-dao.mjs";

const [command = "status", ...rest] = process.argv.slice(2);
const flag = (f) => rest.includes(f);
const dryRun = flag("--dry-run");
const execute = flag("--execute");

const operatorPath = process.env.NEAR_OPERATOR_KEY_PATH || ".data/near-operator.json";
const operator = JSON.parse(readFileSync(operatorPath));
assert.equal(operator.network, "testnet", "Testnet only");
assert.equal(statSync(operatorPath).mode & 0o077, 0, "Operator key file must be private (chmod 600)");
const provider = createNearProvider();
assert.equal((await provider.viewNodeStatus()).chain_id, "testnet");

const factory = DAO_FACTORY.testnet;
const daoId = process.env.TREASURY_DAO_ID || `${DAO_NAME}.${factory}`;
const manifestPath = "public/native-treasury-dao-testnet.json";
const keysPath = ".data/treasury-dao-keys.json";
const apiBase = process.env.TREASURY_DAO_API || "https://questlayer.promptstudio3000.com";
const TGAS = 10n ** 12n;
const NEAR = 10n ** 24n;
const txOf = (r) => r.transaction?.hash || r.transaction_outcome?.id;
const failed = (r) => r.status?.Failure || r.receipts_outcome?.some((o) => o.outcome.status?.Failure);
const log = (v) => console.log(JSON.stringify(v, (_, x) => (typeof x === "bigint" ? x.toString() : x)));
const nearStr = (y) => (Number(BigInt(y) / 10n ** 18n) / 1e6).toFixed(4);

const accountsFor = (op) => ({
  keeper: `keeper.${op}`,
  councilA: `council-a.${op}`,
  councilB: `council-b.${op}`,
});
const ids = accountsFor(operator.accountId);
const operatorAccount = new Account(operator.accountId, provider, KeyPairSigner.fromSecretKey(operator.secretKey));

function loadKeys() {
  if (!existsSync(keysPath)) return {};
  assert.equal(statSync(keysPath).mode & 0o077, 0, `${keysPath} must be private (chmod 600)`);
  return JSON.parse(readFileSync(keysPath));
}
function saveKeys(keys) {
  writeFileSync(keysPath + ".tmp", JSON.stringify(keys, null, 2), { mode: 0o600 });
  renameSync(keysPath + ".tmp", keysPath);
}
const keys = loadKeys();
const signerAccount = (id) => {
  if (id === operator.accountId) return operatorAccount;
  const k = Object.values(keys).find((x) => x.accountId === id);
  assert(k, `No key for ${id} in ${keysPath}. Run setup first.`);
  return new Account(id, provider, KeyPairSigner.fromSecretKey(k.secretKey));
};

async function exists(accountId) {
  try {
    await provider.viewAccount({ accountId });
    return true;
  } catch (e) {
    // The failover provider wraps AccountDoesNotExist; rpcErrorText unwraps it.
    if (/does not exist|unknown_account/i.test(rpcErrorText(e))) return false;
    throw e;
  }
}
async function view(accountId, method, args = {}) {
  const r = await provider.query({ request_type: "call_function", account_id: accountId, method_name: method, args_base64: Buffer.from(JSON.stringify(args)).toString("base64"), finality: "final" });
  return JSON.parse(Buffer.from(r.result).toString());
}
async function call(from, receiverId, methodName, args, { gas = 100n, deposit = 0n } = {}) {
  const r = await signerAccount(from).callFunctionRaw({ contractId: receiverId, methodName, args, deposit, gas: gas * TGAS, waitUntil: "FINAL" });
  assert(!failed(r), `${receiverId}.${methodName} from ${from} failed: ${JSON.stringify(r.status).slice(0, 400)}`);
  return r;
}
const returned = (r) => JSON.parse(Buffer.from(r.status.SuccessValue, "base64").toString());

/** Files a proposal as the keeper and returns its id. */
async function propose(description, kind) {
  if (dryRun) {
    log({ dryRun: true, propose: description.split("\n")[0], kind: typeof kind === "string" ? kind : Object.keys(kind)[0] });
    return null;
  }
  const r = await call(ids.keeper, daoId, "add_proposal", { proposal: { description, kind } }, { gas: 50n });
  const id = returned(r);
  log({ proposed: id, title: description.split("\n")[0], transaction: txOf(r) });
  return id;
}
async function act(from, id, action, kind) {
  if (dryRun || id == null) return;
  const r = await call(from, daoId, "act_proposal", { id, action, proposal: kind }, { gas: 150n });
  log({ voted: action, id, by: from, transaction: txOf(r) });
}
/** The two automatic council keys approve a proposal this script checked. */
async function councilApprove(id, kind) {
  await act(ids.councilA, id, "VoteApprove", kind);
  await act(ids.councilB, id, "VoteApprove", kind);
}

function writeManifest(extra = {}) {
  const manifest = {
    network: "testnet",
    contractId: daoId,
    factory,
    keeper: ids.keeper,
    council: [operator.accountId, ids.councilA, ids.councilB].sort(),
    approvals: 2,
    explorerRule: EXPLORER_RULE,
    mixPresets: MIX_PRESETS,
    recommended: RECOMMENDED_MIX,
    trezuUrl: null,
    createdAt: new Date().toISOString(),
    ...extra,
  };
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
  log({ wrote: manifestPath });
}

// ---------------------------------------------------------------- setup
async function setup() {
  const plan = {
    dao: daoId,
    daoExists: await exists(daoId),
    accounts: Object.fromEntries(await Promise.all(Object.entries(ids).map(async ([k, id]) => [k, { id, exists: await exists(id), key: !!keys[k] }]))),
    daoDepositNear: process.env.TREASURY_DAO_DEPOSIT_NEAR || "6",
  };
  log({ plan, execute });
  if (!execute) return log({ note: "Dry run. Re-run with --execute." });
  const fund = { keeper: NEAR / 2n, councilA: (3n * NEAR) / 10n, councilB: (3n * NEAR) / 10n };
  for (const [k, id] of Object.entries(ids)) {
    if (plan.accounts[k].exists) {
      assert(keys[k], `${id} exists but its key is not in ${keysPath}.`);
      continue;
    }
    const pair = KeyPair.fromRandom("ed25519");
    keys[k] = { accountId: id, publicKey: pair.getPublicKey().toString(), secretKey: pair.toString() };
    saveKeys(keys); // before the account exists, so a crash never loses the key
    const r = await operatorAccount.createAccount({ newAccountId: id, publicKey: keys[k].publicKey, nearToTransfer: fund[k] });
    log({ created: id, transaction: txOf(r) });
  }
  if (!plan.daoExists) {
    const policy = buildPolicy({ council: [operator.accountId, ids.councilA, ids.councilB], keeper: ids.keeper });
    const args = {
      config: {
        name: DAO_NAME,
        purpose: "QuestLayer treasury: players vote on the weekly treasury mix, the council approves every run. Testnet.",
        metadata: Buffer.from(JSON.stringify({ app: "questlayer", docs: "docs/TREASURY-DAO.md" })).toString("base64"),
      },
      policy,
    };
    const deposit = BigInt(Math.round(Number(plan.daoDepositNear) * 1e6)) * 10n ** 18n;
    const r = await call(operator.accountId, factory, "create", { name: DAO_NAME, args: Buffer.from(JSON.stringify(args)).toString("base64") }, { gas: 300n, deposit });
    log({ createdDao: daoId, transaction: txOf(r) });
    assert(await exists(daoId), "The factory did not create the DAO (see the transaction).");
  }
  writeManifest();
  // Genesis decision: the council adopts the recommended mix, so the daily run
  // has an adopted target before the first weekly vote closes.
  const dao = await readDao(provider, daoId);
  if (!adoptedMix(dao.proposals)) {
    const preset = MIX_PRESETS.find((p) => p.id === RECOMMENDED_MIX);
    const id = await propose(describe(`Adopt treasury mix: ${preset.label} (start)`, { t: "adopt", kind: "mix", poll: "genesis", option: preset.id, targets: preset.targets, tally: null }), "Vote");
    await councilApprove(id, "Vote");
  }
  await daily();
}

// ---------------------------------------------------------------- daily
async function eligibleAccounts() {
  const r = await fetch(`${apiBase}/api/treasury/dao/explorers`, { signal: AbortSignal.timeout(20000) });
  assert(r.ok, `Explorer list unavailable: HTTP ${r.status}`);
  const body = await r.json();
  assert(Array.isArray(body.accounts) && body.accounts.every((a) => typeof a === "string" && a.endsWith(".testnet")), "Invalid explorer list.");
  return body.accounts;
}

async function daily() {
  let dao = await readDao(provider, daoId);
  assert(dao.exists, `${daoId} does not exist. Run setup --execute first.`);
  assert.equal(dao.keeper, ids.keeper, "The DAO's Requestor is not this keeper.");
  const now = Date.now();
  const week = weekOf(now);
  const p = dao.proposals;
  const adoptedPolls = new Set(p.filter((x) => x.meta?.t === "adopt").map((x) => x.meta.poll));

  // 1. Tally every closed poll that has no result yet; the council adopts the winner.
  for (const poll of pollIds(p)) {
    const t = tallyPoll(p, poll);
    if (adoptedPolls.has(poll) || !t.closesAt || t.closesAt > now) continue;
    const win = t.options.find((o) => o.option === t.winner);
    const tally = Object.fromEntries(t.options.map((o) => [o.option, o.approvals]));
    const meta = { t: "adopt", kind: t.kind, poll, option: win.option, tally, voters: t.voters };
    if (t.kind === "mix") {
      const preset = MIX_PRESETS.find((x) => x.id === win.option);
      assert(preset, `Unknown mix option ${win.option}`);
      meta.targets = preset.targets;
    }
    const title = t.kind === "mix" ? `Adopt treasury mix: ${win.label} (${poll}, ${t.voters} voters)` : `Result: ${t.title}: ${win.label}`;
    const id = await propose(describe(title, meta), "Vote");
    await councilApprove(id, "Vote");
  }

  // 2. This week's mix vote: one proposal per option, the keeper votes for the recommended one.
  const pollId = `mix-${week.id}`;
  if (!tallyPoll(p, pollId)) {
    for (const preset of MIX_PRESETS) {
      const recommended = preset.id === RECOMMENDED_MIX;
      const meta = { t: "poll", kind: "mix", poll: pollId, title: `Treasury mix for ${week.id}`, option: preset.id, label: preset.label, targets: preset.targets, recommended, closes: week.end };
      const id = await propose(describe(`Treasury mix ${week.id}: ${preset.label}${recommended ? " (recommended)" : ""}`, meta), "Vote");
      if (recommended) await act(ids.keeper, id, "VoteApprove", "Vote");
    }
  }

  // 3. Explorers: the game's eligibility rule, synced once a day in one policy proposal.
  try {
    const want = [...new Set([ids.keeper, ...(await eligibleAccounts())])].sort();
    const have = [...roleMembers(dao.policy, "Explorers")].sort();
    const pending = p.some((x) => x.meta?.t === "members" && x.status === "InProgress");
    if (JSON.stringify(want) !== JSON.stringify(have) && !pending) {
      const added = want.filter((a) => !have.includes(a)).length,
        removed = have.filter((a) => !want.includes(a)).length;
      const kind = { ChangePolicyAddOrUpdateRole: { role: explorersRole(want) } };
      const id = await propose(describe(`Explorers ${utcDate(now)}: ${want.length - 1} voters (+${added} / -${removed})`, { t: "members", date: utcDate(now), count: want.length - 1, added, removed }), kind);
      await councilApprove(id, kind);
    } else log({ explorers: have.length - 1, changed: false, pending });
  } catch (e) {
    console.error("note: explorer sync skipped:", String(e.message || e).slice(0, 200));
  }

  // 4. Today's treasury run, checked against the adopted mix and the mix limits.
  dao = await readDao(provider, daoId);
  const adopted = adoptedMix(dao.proposals);
  const date = utcDate(now);
  if (dailyRun(dao.proposals, date)) return log({ daily: date, note: "already filed" });
  const settings = mixSettings({ ...process.env, TREASURY_MIX_ACCOUNT: operator.accountId }, "testnet");
  if (adopted) settings.target = adopted.targets;
  const live = await readMix(provider, settings, { account: operator.accountId, record: existsSync(".data/treasury-mix.json") ? JSON.parse(readFileSync(".data/treasury-mix.json")) : null });
  const moved = live.plan.steps.filter((s) => ["sell-lst", "withdraw-vault", "unwrap", "sell-stable"].includes(s.op)).reduce((a, s) => a + BigInt(s.value), 0n);
  const meta = {
    t: "daily",
    date,
    action: live.plan.action === "rebalance" ? "rebalance" : "hold",
    target: settings.target,
    maxMoveBps: settings.maxMoveBps,
    totalYocto: live.plan.total.toString(),
    movedYocto: moved.toString(),
    steps: live.plan.steps.slice(0, 8).map((s) => `${s.op} ${s.asset} ${nearStr(s.value)}`),
    adoptedFrom: adopted?.proposalId ?? null,
  };
  const problems = checkDailyRun(meta, { adopted, settings });
  if (problems.length) return log({ daily: date, refused: problems });
  const title = `Daily treasury run ${date}: ${meta.action === "rebalance" ? `move ${nearStr(moved)} of ${nearStr(live.plan.total)} NEAR` : "hold"} toward ${settings.target.lst / 100}/${settings.target.stable / 100}/${settings.target.near / 100}`;
  const id = await propose(describe(title, meta), "Vote");
  await councilApprove(id, "Vote");
}

// ---------------------------------------------------------------- extra poll
async function extraPoll() {
  const [question, ...options] = rest.filter((x) => !x.startsWith("--"));
  assert(question && options.length >= 2 && options.length <= 4, 'Usage: poll "<question>" "<option a>" "<option b>" [up to 4]');
  const week = weekOf(Date.now());
  const poll = `extra-${week.id}-${Date.now().toString(36)}`;
  for (const [i, label] of options.entries()) {
    const meta = { t: "poll", kind: "extra", poll, title: question.slice(0, 120), option: `o${i + 1}`, label: label.slice(0, 80), recommended: i === 0, closes: week.end };
    const id = await propose(describe(`${question.slice(0, 120)}: ${label.slice(0, 80)}${i === 0 ? " (recommended)" : ""}`, meta), "Vote");
    if (i === 0) await act(ids.keeper, id, "VoteApprove", "Vote");
  }
}

// ---------------------------------------------------------------- QGOLD council
async function qgoldCouncil() {
  const vault = JSON.parse(readFileSync("public/native-qgold-vault-testnet.json")).vaultContract;
  const config = await view(vault, "get_config");
  const proposals = [];
  for (let id = 1; id < 500; id++) {
    const x = await view(vault, "get_proposal", { id: String(id) });
    if (!x) break;
    proposals.push(x);
  }
  const open = proposals.filter((x) => !x.done);
  const council = config.council || [];
  log({ vault, council, threshold: config.threshold, timelockMs: config.timelock_ms, openProposals: open.map((x) => ({ id: x.id, action: Object.keys(x.action || {})[0], executableAt: x.executable_at })) });
  if (council.length === 1 && council[0] === daoId) return log({ note: "The DAO already is the QGOLD council." });
  assert(council.includes(operator.accountId), "The operator is not on the QGOLD council.");
  const mine = open.find((x) => x.action?.SetCouncil?.members?.[0] === daoId);
  assert(!open.some((x) => x !== mine), "Other QGOLD proposals are still open (e.g. the pending upgrade): finish them first, their approvals belong to the current council.");
  if (!execute) return log({ note: "Dry run. Re-run with --execute." });
  if (!mine) {
    const r = await call(operator.accountId, vault, "propose", { action: { SetCouncil: { members: [daoId], threshold: 1 } } });
    log({ proposed: "SetCouncil -> DAO", id: returned(r), transaction: txOf(r), note: "Run again after the timelock to execute." });
    return;
  }
  if (Date.now() < Number(mine.executable_at)) return log({ waiting: new Date(Number(mine.executable_at)).toISOString() });
  const r = await call(operator.accountId, vault, "execute", { id: String(mine.id) });
  log({ executed: "QGOLD council is now the DAO", transaction: txOf(r) });
  writeManifest({ ...(existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath)) : {}), qgoldCouncil: vault });
}

// ---------------------------------------------------------------- status
async function status() {
  const dao = await readDao(provider, daoId);
  if (!dao.exists) return log({ dao: daoId, exists: false, next: "setup --execute" });
  const week = weekOf(Date.now());
  const t = tallyPoll(dao.proposals, `mix-${week.id}`);
  log({
    dao: daoId,
    council: roleMembers(dao.policy, "Approver"),
    keeper: dao.keeper,
    explorers: roleMembers(dao.policy, "Explorers").length - 1,
    week: week.id,
    closesIn: `${Math.round((week.end - Date.now()) / 3_600_000)} h`,
    weeklyMix: t && t.options.map((o) => `${o.label}: ${o.approvals}${o.recommended ? " (recommended)" : ""}`),
    adopted: adoptedMix(dao.proposals),
    today: dailyRun(dao.proposals, utcDate(Date.now()))?.status || "not filed",
    proposals: dao.proposals.length,
  });
}

if (command === "setup") await setup();
else if (command === "daily") await daily();
else if (command === "poll") await extraPoll();
else if (command === "qgold-council") await qgoldCouncil();
else if (command === "status") await status();
else {
  console.error("Commands: setup [--execute] | status | daily [--dry-run] | poll <question> <a> <b> | qgold-council [--execute]");
  process.exit(2);
}
