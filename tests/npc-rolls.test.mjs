import test from "node:test";
import assert from "node:assert/strict";
import { createHash, createPublicKey, generateKeyPairSync, sign, verify } from "node:crypto";
import { mkdtempSync, writeFileSync, chmodSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { KeyPair, KeyPairSigner, actions, buildDelegateAction, encodeSignedDelegate } from "near-api-js";
import { openDatabase, createPlayer } from "../server/database.mjs";
import { ensureModuleVersion } from "../server/schema-compatibility.mjs";
import { HUNT_SCHEMA } from "../server/actors/hunt/schema.mjs";
import { NpcRolls, ROLL_PRIZES, loadTicketSigner, rollClaimId, ticketMessage, CONSOLATION_XP } from "../server/npc/rolls.mjs";
import { AwardVouchers } from "../server/native/award-vouchers.mjs";
import { decodeSignedDelegate } from "../server/relayer/delegate.mjs";
import { RelayPolicyError, validateDelegate } from "../server/relayer/policy.mjs";

const CONTRACT = "questlayer-npc-games-20261101.testnet";
const ACCOUNT = "alice.players.questlayer.testnet";
const TABLE = {
  tiers: [
    { prize: "trader-voucher", weight: 60, daily_cap: null },
    { prize: "aura-rare", weight: 30, daily_cap: null },
    { prize: "aura-epic", weight: 9, daily_cap: 20 },
    { prize: "aura-legendary-wisp", weight: 1, daily_cap: 2 },
  ],
  minimum: 0,
  total_weight: 100,
  active: true,
};
const sha = (hex) => createHash("sha256").update(Buffer.from(hex, "hex")).digest("hex");

function keyPair() {
  const pair = generateKeyPairSync("ed25519");
  return {
    publicKey: pair.publicKey.export({ type: "spki", format: "der" }).subarray(-32).toString("base64"),
    sign: (m) => sign(null, Buffer.from(m), pair.privateKey).toString("base64"),
    verifyKey: pair.publicKey,
  };
}

// A tiny in-memory npc-games contract: tickets checked with the real message,
// height and status driven by the test.
function setup({ tickets = 2, now = Date.parse("2026-11-02T10:00:00Z") } = {}) {
  const db = openDatabase(":memory:");
  ensureModuleVersion(db, HUNT_SCHEMA);
  const player = createPlayer(db, "Roller", now);
  db.prepare("INSERT INTO wallet_links VALUES(?,?,?)").run(ACCOUNT, player, now);
  for (let i = 0; i < tickets; i++)
    db.prepare("INSERT INTO monster_rewards(player_id,source,kind,amount,day_id,data,created_at) VALUES(?,?,?,?,?,?,?)").run(player, `win:lurker-${i}:d`, "roll", 1, "2026-11-02", "{}", now);
  const signer = keyPair();
  const chain = { height: 1000, rolls: new Map(), signerKey: signer.publicKey, active: true };
  const contract = {
    contractId: CONTRACT,
    async view(method, args) {
      if (method === "get_config") return { ticket_signer: chain.signerKey };
      if (method === "get_table") return { ...TABLE, active: chain.active };
      if (method === "get_roll") return chain.rolls.get(args.roll_id) || null;
      throw Error("unexpected view " + method);
    },
  };
  // What start_roll does on chain, including the signature check.
  chain.start = (call, accountId = ACCOUNT) => {
    const a = call.args;
    const message = ticketMessage(CONTRACT, { rollId: a.roll_id, accountId, commit: a.commit, tableId: a.table_id, expiresAtMs: a.expires_at_ms });
    assert.ok(verify(null, Buffer.from(message), signer.verifyKey, Buffer.from(a.signature, "base64")), "Invalid roll ticket");
    assert.ok(!chain.rolls.has(a.roll_id), "Roll already used");
    chain.rolls.set(a.roll_id, { account_id: accountId, table_id: a.table_id, commit: a.commit, start_height: String(chain.height), status: "Pending", prize: null, capped: false, random: null });
  };
  chain.resolve = (rollId, secret, tier, random = "00000000" + "ab".repeat(28)) => {
    const r = chain.rolls.get(rollId);
    assert.equal(sha(secret), r.commit, "Secret does not match the commitment");
    assert.ok(chain.height >= Number(r.start_height) + 3, "Too early");
    Object.assign(r, { status: "Resolved", tier, prize: TABLE.tiers[tier].prize, secret, random });
  };
  const clock = { now };
  const rolls = new NpcRolls(db, {
    contract,
    finalHeight: async () => chain.height,
    signer,
    manifest: { network: "testnet", contractId: CONTRACT, timeoutBlocks: 600, tables: { "wisp-v1": TABLE } },
    clock: () => clock.now,
  });
  return { db, player, rolls, chain, clock, signer };
}

test("a ticket spends one earned roll, re-signs while unused and verifies like the contract", async () => {
  const { player, rolls, chain } = setup({ tickets: 1 });
  const status = await rolls.status(player);
  assert.equal(status.enabled, true);
  assert.deepEqual(status.tickets, { earned: 1, used: 0, available: 1 });
  assert.equal(status.odds.length, 4);
  assert.equal(status.odds[0].minimum, true);

  const first = await rolls.ticket(player, ACCOUNT);
  assert.equal(first.call.methodName, "start_roll");
  assert.equal(first.call.deposit, "0");
  assert.equal(first.tickets.available, 0);
  assert.match(first.call.args.commit, /^[0-9a-f]{64}$/);
  assert.ok(!JSON.stringify(first).includes('"secret"'), "the secret never leaves before the start");
  // Asking again reuses the same roll (no second ticket spent).
  const again = await rolls.ticket(player, ACCOUNT);
  assert.equal(again.roll.rollId, first.roll.rollId);
  chain.start(again.call);
  // The used ticket is now a started roll; no tickets remain.
  await assert.rejects(rolls.ticket(player, ACCOUNT), (e) => e.code === "NO_ROLL_TICKETS");
  await assert.rejects(rolls.ticket(player, "mallory.testnet"), (e) => e.code === "ROLL_ACCOUNT");
});

test("the secret is revealed only after a final start plus 3 blocks; the recorded prize pays once", async () => {
  const { db, player, rolls, chain } = setup();
  const count = () => db.prepare("SELECT COUNT(*) AS n FROM inventory WHERE player_id=?").get(player).n,
    before = count();
  const t = await rolls.ticket(player, ACCOUNT);
  let step = await rolls.sync(player, t.roll.rollId);
  assert.equal(step.next, "start");
  chain.start(t.call);
  step = await rolls.sync(player, t.roll.rollId);
  assert.equal(step.next, "wait");
  assert.equal(step.call, undefined);
  chain.height += 3;
  step = await rolls.sync(player, t.roll.rollId);
  assert.equal(step.next, "resolve");
  assert.equal(step.call.methodName, "resolve_roll");
  assert.equal(sha(step.call.args.secret), t.call.args.commit);
  chain.resolve(t.roll.rollId, step.call.args.secret, 1);
  const done = await rolls.sync(player, t.roll.rollId);
  assert.equal(done.next, "done");
  assert.equal(done.roll.outcome, "Resolved");
  assert.equal(done.roll.prize, "aura-rare");
  assert.equal(done.roll.reward.kind, "aura");
  assert.equal(done.roll.reward.rarity, "rare");
  assert.ok(ROLL_PRIZES["aura-rare"].editions.includes(done.roll.reward.edition));
  assert.equal(done.roll.claimId, `earned:npc-roll:${t.roll.rollId}`);
  const item = db.prepare("SELECT * FROM inventory WHERE id=?").get(done.roll.itemId);
  assert.equal(item.player_id, player);
  // Settling again changes nothing.
  await rolls.sync(player, t.roll.rollId);
  await rolls.tick();
  assert.equal(count(), before + 1);
  assert.equal(rolls.claimIdFor(item.id), done.roll.claimId);
});

test("the legendary wisp uses the NPC claim prefix; timeouts pay the minimum through the worker", async () => {
  const { db, player, rolls, chain, clock } = setup();
  const a = await rolls.ticket(player, ACCOUNT);
  chain.start(a.call);
  chain.height += 5;
  const reveal = await rolls.sync(player, a.roll.rollId);
  chain.resolve(a.roll.rollId, reveal.call.args.secret, 3);
  const wisp = await rolls.sync(player, a.roll.rollId);
  assert.equal(wisp.roll.reward.edition, "wisp");
  assert.equal(wisp.roll.claimId, `earned:npc:roll:${a.roll.rollId}`);
  assert.equal(rollClaimId("wisp", "x"), "earned:npc:roll:x");
  assert.equal(rollClaimId("polar", "x"), "earned:npc-roll:x");

  const b = await rolls.ticket(player, ACCOUNT);
  chain.start(b.call);
  await rolls.sync(player, b.roll.rollId);
  chain.height += 600;
  const late = await rolls.sync(player, b.roll.rollId);
  assert.equal(late.next, "timeout");
  assert.equal(late.call.methodName, "claim_timeout");
  // Somebody claims the timeout; the background worker settles it.
  Object.assign(chain.rolls.get(b.roll.rollId), { status: "TimedOut", tier: 0, prize: "trader-voucher" });
  clock.now += 60_000;
  assert.equal(await rolls.tick(), 1);
  const row = db.prepare("SELECT * FROM npc_rolls WHERE roll_id=?").get(b.roll.rollId);
  assert.equal(row.state, "settled");
  assert.equal(JSON.parse(row.reward).rarity, "common");
});

test("sold-out prizes pay consolation XP; a foreign key or a closed table keeps rolls off", async () => {
  const { db, player, rolls, chain } = setup();
  db.prepare("INSERT OR REPLACE INTO editions VALUES(?,?,?)").run("Will-o'-Wisp Halo", 256, 256);
  const xpBefore = db.prepare("SELECT xp FROM players WHERE id=?").get(player).xp;
  const t = await rolls.ticket(player, ACCOUNT);
  chain.start(t.call);
  chain.height += 3;
  const reveal = await rolls.sync(player, t.roll.rollId);
  chain.resolve(t.roll.rollId, reveal.call.args.secret, 3);
  const done = await rolls.sync(player, t.roll.rollId);
  assert.deepEqual(done.roll.reward, { kind: "xp", xp: CONSOLATION_XP, reason: "sold-out" });
  assert.equal(db.prepare("SELECT xp FROM players WHERE id=?").get(player).xp, xpBefore + CONSOLATION_XP);

  const other = setup();
  other.chain.signerKey = keyPair().publicKey;
  assert.equal((await other.rolls.status(other.player)).enabled, false);
  await assert.rejects(other.rolls.ticket(other.player, ACCOUNT), (e) => e.code === "ROLLS_DISABLED");
  const closed = setup();
  closed.chain.active = false;
  assert.match((await closed.rolls.status(closed.player)).reason, /resting/);
});

test("the award voucher reuses the roll's reserved claim id", async () => {
  const { db, player, rolls, chain } = setup();
  const t = await rolls.ticket(player, ACCOUNT);
  chain.start(t.call);
  chain.height += 3;
  chain.resolve(t.roll.rollId, (await rolls.sync(player, t.roll.rollId)).call.args.secret, 1);
  const done = await rolls.sync(player, t.roll.rollId);
  const award = keyPair();
  const native = {
    contractId: "nfts.project.testnet",
    view: async (method) =>
      method === "get_award_signer" ? award.publicKey : method === "edition_minted" ? 0 : method === "supported_editions" ? ["polar", "bloom", "wisp"] : null,
  };
  const vouchers = new AwardVouchers(db, native, award, { claimIdFor: (id) => rolls.claimIdFor(id) });
  const claim = await vouchers.issue(player, done.roll.itemId, ACCOUNT);
  assert.equal(claim.claim_id, `earned:npc-roll:${t.roll.rollId}`);
  assert.match(claim.message, new RegExp(`Claim: earned:npc-roll:${t.roll.rollId}`));
});

test("the ticket key loader never creates a key and requires private permissions", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "npc-ticket-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  assert.equal(loadTicketSigner(join(dir, "missing.pem")), null);
  const pair = generateKeyPairSync("ed25519"),
    path = join(dir, "key.pem");
  writeFileSync(path, pair.privateKey.export({ type: "pkcs8", format: "pem" }));
  chmodSync(path, 0o644);
  assert.throws(() => loadTicketSigner(path), /private file permissions/);
  chmodSync(path, 0o600);
  const s = loadTicketSigner(path);
  assert.equal(s.publicKey, createPublicKey(pair.privateKey).export({ type: "spki", format: "der" }).subarray(-32).toString("base64"));
});

test("the relayer sponsors only zero-deposit roll calls on the npc-games contract", async () => {
  const device = KeyPair.fromRandom("ed25519"),
    signer = new KeyPairSigner(device);
  const ctx = {
    accountId: ACCOUNT,
    keys: [device.getPublicKey().toString()],
    nonce: 100n,
    blockHeight: 5000,
    blockTtl: 120,
    contracts: { collectibles: "nfts.project.testnet", npcGames: CONTRACT },
  };
  const delegate = async (method, args, deposit = 0n, receiverId = CONTRACT) => {
    const delegateAction = buildDelegateAction({
      senderId: ACCOUNT,
      receiverId,
      actions: [actions.functionCall(method, args, 50_000_000_000_000n, deposit)],
      nonce: 101n,
      maxBlockHeight: 5100n,
      publicKey: await signer.getPublicKey(),
    });
    const { signedDelegate } = await signer.signDelegateAction(delegateAction);
    return decodeSignedDelegate(Buffer.from(encodeSignedDelegate(signedDelegate)).toString("base64"));
  };
  const start = { roll_id: "roll-" + "a".repeat(24), table_id: "wisp-v1", commit: "b".repeat(64), expires_at_ms: "1793572066662", signature: "A".repeat(86) + "==" };
  assert.ok(validateDelegate(await delegate("start_roll", start), ctx));
  assert.ok(validateDelegate(await delegate("resolve_roll", { roll_id: start.roll_id, secret: "c".repeat(64) }), ctx));
  assert.ok(validateDelegate(await delegate("claim_timeout", { roll_id: start.roll_id }), ctx));
  const rejects = async (input, code, context = ctx) =>
    assert.throws(() => validateDelegate(input, context), (e) => e instanceof RelayPolicyError && e.code === code);
  await rejects(await delegate("start_roll", start, 1n), "RELAY_DEPOSIT");
  await rejects(await delegate("start_roll", { ...start, extra: 1 }), "RELAY_ARGS");
  await rejects(await delegate("publish_table", { table_id: "x", tiers: [], minimum: 0 }), "RELAY_METHOD");
  await rejects(await delegate("start_roll", start), "RELAY_RECEIVER", { ...ctx, contracts: { collectibles: "nfts.project.testnet" } });
});
