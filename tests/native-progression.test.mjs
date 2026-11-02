import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, sign, verify } from "node:crypto";
import { openDatabase, createPlayer } from "../server/database.mjs";
import {
  NativeProgression,
  nativeLevelClaimId,
  nativeLevelProgress,
} from "../server/native/progression.mjs";
import { loadLevelTable, setLevelTable } from "../server/levels.mjs";

const initialTime = Date.parse("2026-10-31T14:00:00Z");
function setup() {
  const db = openDatabase(":memory:"),
    player = createPlayer(db, "Native Explorer", initialTime),
    other = createPlayer(db, "Other Explorer", initialTime);
  db.prepare("INSERT INTO wallet_links VALUES(?,?,?)").run(
    "alice.testnet",
    player,
    initialTime,
  );
  const pair = generateKeyPairSync("ed25519"),
    signer = {
      publicKey: pair.publicKey
        .export({ type: "spki", format: "der" })
        .subarray(-32)
        .toString("base64"),
      sign: (message) =>
        sign(null, Buffer.from(message), pair.privateKey).toString("base64"),
    };
  const sourceContract = "rewards.project.testnet",
    collection = "nfts.project.testnet";
  const state = {
    now: initialTime,
    timestamp: initialTime,
    height: 100,
    hash: "final-block-100",
    xp: 100,
    network: "testnet",
    syncing: false,
    sourceCode: "r".repeat(44),
    nftCode: "n".repeat(44),
    version: 3,
    key: signer.publicKey,
    minted: 0,
    claims: new Map(),
    fail: false,
    failNft: false,
    unpin: false,
    mismatchedHeight: false,
    hook: null,
    hang: false,
    accounts: new Map(),
    supported: ["polar", "moon", "gold"],
  };
  const requests = [];
  const provider = {
    viewNodeStatus: async () => ({
      chain_id: state.network,
      sync_info: { syncing: state.syncing },
    }),
    viewBlock: async ({ finality }) => {
      assert.equal(finality, "final");
      if (state.fail) throw Error("RPC unavailable");
      if (state.hang) return new Promise(() => {});
      return {
        header: {
          hash: state.hash,
          height: state.height,
          timestamp_nanosec: String(BigInt(state.timestamp) * 1000000n),
        },
      };
    },
    query: async (request) => {
      requests.push(request);
      assert.equal(request.block_id, state.hash);
      assert.equal(request.finality, undefined);
      if (state.hook) state.hook(request);
      if (state.failNft && request.account_id === collection)
        throw Error("NFT read unavailable");
      const anchor = {
        block_hash: state.unpin ? "different-block" : state.hash,
        block_height: state.mismatchedHeight ? state.height - 1 : state.height,
      };
      if (request.request_type === "view_account")
        return {
          ...anchor,
          code_hash:
            request.account_id === sourceContract
              ? state.sourceCode
              : state.nftCode,
        };
      const args = JSON.parse(Buffer.from(request.args_base64, "base64")),
        method = request.method_name;
      let data;
      if (method === "get_account")
        data = { xp: state.accounts.get(args.account_id) ?? state.xp };
      else if (method === "get_config")
        data = { version: 1, network: "testnet" };
      else if (method === "get_award_signer") data = state.key;
      else if (method === "get_version") data = state.version;
      else if (method === "edition_minted") data = state.minted;
      else if (method === "supported_editions") data = state.supported;
      else if (method === "get_claim")
        data = state.claims.get(args.claim_id) || null;
      else throw Error("Unexpected view " + method);
      return { ...anchor, result: [...Buffer.from(JSON.stringify(data))] };
    },
  };
  const native = {
    db,
    provider,
    config: { codeHash: "r".repeat(44) },
    contractId: sourceContract,
    linked(playerId, accountId) {
      if (
        !db
          .prepare(
            "SELECT 1 FROM wallet_links WHERE player_id=? AND account_id=?",
          )
          .get(playerId, accountId)
      ) {
        const error = new Error("Link this NEAR wallet first.");
        error.status = 403;
        throw error;
      }
    },
  };
  const options = {
    clock: () => state.now,
    collectiblesCodeHash: "n".repeat(44),
    timeoutMs: 30,
  };
  const service = new NativeProgression(
    native,
    { contractId: collection },
    signer,
    options,
  );
  return {
    db,
    player,
    other,
    signer,
    pair,
    state,
    requests,
    provider,
    native,
    options,
    service,
    collection,
    sourceContract,
    nextBlock(xp = state.xp) {
      state.height += 1;
      state.hash = "final-block-" + state.height;
      state.xp = xp;
      state.now += 1000;
      state.timestamp = state.now;
    },
    mint(level = 2, owner = "alice.testnet") {
      const edition = { 2: "polar", 3: "moon", 4: "gold" }[level];
      const claimId = nativeLevelClaimId(
        sourceContract,
        collection,
        owner,
        level,
      );
      state.claims.set(claimId, {
        token_id: `aura:${edition}:2`,
        receiver_id: owner,
        edition,
      });
      return claimId;
    },
  };
}

test("native level curve uses exact threshold boundaries and never rounds u64 XP", () => {
  for (const [xp, level, next, remaining] of [
    [0, 1, "100", "100"],
    [99, 1, "100", "1"],
    [100, 2, "400", "300"],
    [399, 2, "400", "1"],
    [400, 3, "900", "500"],
    [900, 4, "1600", "700"],
  ]) {
    assert.deepEqual(nativeLevelProgress(xp), {
      xp: String(xp),
      level,
      nextLevelXp: next,
      xpToNextLevel: remaining,
      levelStartXp: String(100 * (level - 1) ** 2),
    });
  }
  const large = nativeLevelProgress("18446744073709551615");
  assert.equal(large.xp, "18446744073709551615");
  assert(BigInt(large.nextLevelXp) > 18446744073709551615n);
  for (const bad of [
    Number.MAX_SAFE_INTEGER + 1,
    -1,
    1.5,
    null,
    "001",
    "1e3",
    "18446744073709551616",
  ])
    assert.throws(() => nativeLevelProgress(bad));
});

test("only finalized account XP drives milestones, isolated from demo and accepted receipts", async () => {
  const s = setup();
  try {
    s.db
      .prepare("UPDATE players SET xp=999999,gold_u=99999999 WHERE id=?")
      .run(s.player);
    // A local pending/confirmed label is not a chain authority and is deliberately unread.
    s.db.exec(
      "CREATE TABLE native_reward_claims(xp INTEGER,state TEXT); INSERT INTO native_reward_claims VALUES(9000,'queued'),(9000,'confirmed')",
    );
    s.state.xp = 82;
    const result = await s.service.snapshot(s.player, "alice.testnet");
    assert.equal(result.status, "available");
    assert.equal(result.xp, "82");
    assert.equal(result.level, 1);
    assert.equal(result.xpToNextLevel, "18");
    assert.equal(result.lockedXp, "0");
    assert.equal(result.milestones[0].state, "locked");
    await assert.rejects(
      s.service.issue(s.player, "alice.testnet", 2),
      /required confirmed NEAR XP/,
    );
    assert.equal(
      s.db.prepare("SELECT count(*) AS n FROM native_level_awards").get().n,
      0,
    );
    assert.equal(
      s.db.prepare("SELECT xp FROM players WHERE id=?").get(s.player).xp,
      999999,
    );
  } finally {
    s.db.close();
  }
});

test("confirmed level claims bind source, network, receiver, edition and deterministic identity", async () => {
  const s = setup();
  try {
    const claim = await s.service.issue(s.player, "alice.testnet", 2);
    assert.equal(claim.state, "issued");
    assert.equal(claim.network, "testnet");
    assert.equal(claim.sourceContractId, s.sourceContract);
    assert.equal(claim.edition, "polar");
    assert.equal(claim.xp, "100");
    assert.equal(
      claim.claim_id,
      nativeLevelClaimId(s.sourceContract, s.collection, "alice.testnet", 2),
    );
    assert.equal(claim.claim_id.length < 160, true);
    assert(
      verify(
        null,
        Buffer.from(claim.message),
        s.pair.publicKey,
        Buffer.from(claim.signature, "base64"),
      ),
    );
    for (const change of [
      claim.message.replace("alice.testnet", "bob.testnet"),
      claim.message.replace("Edition: polar", "Edition: moon"),
      claim.message.replace("Network: testnet", "Network: mainnet"),
    ])
      assert.equal(
        verify(
          null,
          Buffer.from(change),
          s.pair.publicKey,
          Buffer.from(claim.signature, "base64"),
        ),
        false,
      );
    const again = await s.service.issue(s.player, "alice.testnet", 2);
    assert.equal(again.claim_id, claim.claim_id);
    assert.equal(
      s.db.prepare("SELECT count(*) AS n FROM native_level_awards").get().n,
      1,
    );
    assert.notEqual(
      nativeLevelClaimId("other.testnet", s.collection, "alice.testnet", 2),
      claim.claim_id,
    );
    await assert.rejects(
      s.service.issue(s.player, "alice.testnet", 5),
      /supported level/,
    );
  } finally {
    s.db.close();
  }
});

test("relink and lost-cookie account recovery preserve entitlement; other wallets cannot inherit XP", async () => {
  const s = setup();
  try {
    const first = await s.service.issue(s.player, "alice.testnet", 2);
    await assert.rejects(s.service.snapshot(s.other, "alice.testnet"), /Link/);
    await assert.rejects(s.service.snapshot(s.player, undefined), /valid NEAR/);
    s.db
      .prepare("UPDATE wallet_links SET player_id=? WHERE account_id=?")
      .run(s.other, "alice.testnet");
    await assert.rejects(s.service.issue(s.player, "alice.testnet", 2), /Link/);
    const relinked = await s.service.issue(s.other, "alice.testnet", 2);
    assert.equal(relinked.claim_id, first.claim_id);
    s.db
      .prepare("INSERT INTO wallet_links VALUES(?,?,?)")
      .run("bob.testnet", s.other, s.state.now);
    s.state.accounts.set("bob.testnet", 0);
    const bob = await s.service.snapshot(s.other, "bob.testnet");
    assert.equal(bob.xp, "0");
    assert.equal(bob.milestones[0].state, "locked");
    await assert.rejects(
      s.service.issue(s.other, "bob.testnet", 2),
      /required confirmed/,
    );
    assert.equal(
      s.db.prepare("SELECT count(*) AS n FROM native_level_awards").get().n,
      1,
    );
  } finally {
    s.db.close();
  }
});

test("expiry and retry storms renew the same durable right without a second mint identity", async () => {
  const s = setup();
  try {
    const first = await s.service.issue(s.player, "alice.testnet", 2);
    s.state.now = first.expires_at + 1;
    s.state.timestamp = s.state.now;
    s.nextBlock();
    const claims = await Promise.all(
      Array.from({ length: 8 }, () =>
        s.service.issue(s.player, "alice.testnet", 2),
      ),
    );
    assert(
      claims.every(
        (c) => c.claim_id === first.claim_id && c.expires_at > first.expires_at,
      ),
    );
    const restarted = new NativeProgression(
      s.native,
      { contractId: s.collection },
      s.signer,
      s.options,
    );
    assert.equal(
      (await restarted.issue(s.player, "alice.testnet", 2)).claim_id,
      first.claim_id,
    );
    assert.equal(
      s.db.prepare("SELECT count(*) AS n FROM native_level_awards").get().n,
      1,
    );
  } finally {
    s.db.close();
  }
});

test("mint finality is reconciled once, recovered after a missing acknowledgement and preserved after transfer", async () => {
  const s = setup();
  try {
    const original = await s.service.issue(s.player, "alice.testnet", 2);
    s.mint();
    s.nextBlock();
    const confirmed = await s.service.confirm(s.player, "alice.testnet", 2);
    assert.equal(confirmed.state, "minted");
    assert.equal(confirmed.token_id, "aura:polar:2");
    assert.equal(confirmed.signature, "");
    // No current-owner lookup is used: selling a cosmetic never reopens progression.
    const replay = await s.service.issue(s.player, "alice.testnet", 2);
    assert.equal(replay.claim_id, original.claim_id);
    assert.equal(replay.state, "minted");
    const confirmedAt = confirmed.confirmed_at;
    s.nextBlock();
    assert.equal(
      (await s.service.confirm(s.player, "alice.testnet", 2)).confirmed_at,
      confirmedAt,
    );
    // A restored database without a local acknowledgement still finds the same on-chain identity.
    s.db.exec("DELETE FROM native_level_awards");
    const restored = await s.service.issue(s.player, "alice.testnet", 2);
    assert.equal(restored.state, "minted");
    assert.equal(restored.claim_id, original.claim_id);
    assert.equal(
      s.db.prepare("SELECT count(*) AS n FROM native_level_awards").get().n,
      1,
    );
  } finally {
    s.db.close();
  }
});

test("RPC failures are explicit stale/unavailable and cannot issue or confirm awards", async () => {
  const s = setup();
  try {
    s.state.fail = true;
    const unavailable = await s.service.snapshot(s.player, "alice.testnet");
    assert.equal(unavailable.status, "unavailable");
    assert.equal(unavailable.xp, null);
    s.state.fail = false;
    await s.service.snapshot(s.player, "alice.testnet");
    s.state.fail = true;
    const stale = await s.service.snapshot(s.player, "alice.testnet");
    assert.equal(stale.status, "stale");
    assert.equal(stale.xp, "100");
    assert(stale.milestones.every((m) => !m.claimable));
    await assert.rejects(
      s.service.issue(s.player, "alice.testnet", 2),
      /Refresh confirmed/,
    );
    await assert.rejects(
      s.service.confirm(s.player, "alice.testnet", 2),
      /temporarily unavailable/,
    );
    s.state.fail = false;
    s.state.hang = true;
    assert.equal(
      (await s.service.snapshot(s.player, "alice.testnet")).status,
      "stale",
    );
  } finally {
    s.db.close();
  }
});

test("unsafe chain, code, anchor, rounded XP and stale-block observations fail closed", async () => {
  for (const change of [
    (s) => {
      s.state.network = "mainnet";
    },
    (s) => {
      s.state.syncing = true;
    },
    (s) => {
      s.state.sourceCode = "unknown-code";
    },
    (s) => {
      s.state.unpin = true;
    },
    (s) => {
      s.state.mismatchedHeight = true;
    },
    (s) => {
      s.state.xp = Number.MAX_SAFE_INTEGER + 1;
    },
    (s) => {
      s.state.timestamp -= 120001;
    },
    (s) => {
      s.state.timestamp += 15001;
    },
  ]) {
    const s = setup();
    try {
      await s.service.snapshot(s.player, "alice.testnet");
      change(s);
      assert.equal(
        (await s.service.snapshot(s.player, "alice.testnet")).status,
        "stale",
      );
      await assert.rejects(
        s.service.issue(s.player, "alice.testnet", 2),
        /Refresh confirmed/,
      );
    } finally {
      s.db.close();
    }
  }
});

test("backward finality, same-height hash fork and decreasing XP require reconciliation", async () => {
  for (const change of [
    (s) => {
      s.state.height -= 1;
      s.state.hash = "older-final-block";
    },
    (s) => {
      s.state.hash = "conflicting-final-block";
    },
    (s) => {
      s.state.xp = 400;
    },
    (s) => {
      s.nextBlock(0);
    },
  ]) {
    const s = setup();
    try {
      await s.service.snapshot(s.player, "alice.testnet");
      change(s);
      const result = await s.service.snapshot(s.player, "alice.testnet");
      assert.equal(result.status, "stale");
      assert.equal(result.xp, "100");
      await assert.rejects(
        s.service.issue(s.player, "alice.testnet", 2),
        /Refresh confirmed/,
      );
      assert.equal(
        s.db.prepare("SELECT count(*) AS n FROM native_level_awards").get().n,
        0,
      );
    } finally {
      s.db.close();
    }
  }
});

test("edition cap and publisher permissions independently gate native level vouchers", async () => {
  for (const change of [
    (s) => {
      s.state.key = null;
    },
    (s) => {
      s.state.key = "another-attestor";
    },
    (s) => {
      s.state.version = 2;
    },
    (s) => {
      s.state.nftCode = "unexpected-upgrade";
    },
    (s) => {
      s.state.failNft = true;
    },
    (s) => {
      s.service.collectiblesCodeHash = null;
    },
  ]) {
    const s = setup();
    try {
      change(s);
      const result = await s.service.snapshot(s.player, "alice.testnet");
      assert.equal(result.status, "available");
      assert.equal(result.xp, "100");
      assert.equal(result.milestones[0].state, "unavailable");
      await assert.rejects(
        s.service.issue(s.player, "alice.testnet", 2),
        /temporarily unavailable/,
      );
    } finally {
      s.db.close();
    }
  }
  const s = setup();
  try {
    await s.service.issue(s.player, "alice.testnet", 2);
    s.state.minted = 256;
    assert.equal(
      (await s.service.snapshot(s.player, "alice.testnet")).milestones[0].state,
      "sold_out",
    );
    await assert.rejects(
      s.service.issue(s.player, "alice.testnet", 2),
      /fully minted/,
    );
    s.mint();
    assert.equal(
      (await s.service.issue(s.player, "alice.testnet", 2)).state,
      "minted",
    );
  } finally {
    s.db.close();
  }
});

test("tampered and disappeared immutable mint receipts never reopen a confirmed grant", async () => {
  for (const bad of [
    { token_id: "aura:polar:2", receiver_id: "bob.testnet", edition: "polar" },
    { token_id: "aura:gold:2", receiver_id: "alice.testnet", edition: "gold" },
    {
      token_id: "aura:polar:257",
      receiver_id: "alice.testnet",
      edition: "polar",
    },
  ]) {
    const s = setup();
    try {
      const id = s.mint();
      s.state.claims.set(id, bad);
      assert.equal(
        (await s.service.snapshot(s.player, "alice.testnet")).milestones[0]
          .state,
        "unavailable",
      );
      await assert.rejects(
        s.service.issue(s.player, "alice.testnet", 2),
        /temporarily unavailable/,
      );
    } finally {
      s.db.close();
    }
  }
  const s = setup();
  try {
    const id = s.mint();
    await s.service.confirm(s.player, "alice.testnet", 2);
    s.state.claims.delete(id);
    s.nextBlock();
    const lost = await s.service.snapshot(s.player, "alice.testnet");
    assert.equal(lost.milestones[0].state, "unavailable");
    assert.equal(lost.milestones[0].confirmedPreviously, true);
    await assert.rejects(
      s.service.issue(s.player, "alice.testnet", 2),
      /temporarily unavailable/,
    );
    assert.equal(
      s.db.prepare("SELECT state FROM native_level_awards").get().state,
      "minted",
    );
  } finally {
    s.db.close();
  }
});

test("wallet unlink during a remote read cannot produce a signed grant or leak another account", async () => {
  const s = setup();
  try {
    s.state.hook = () => {
      s.state.hook = null;
      s.db
        .prepare("DELETE FROM wallet_links WHERE account_id=?")
        .run("alice.testnet");
    };
    await assert.rejects(s.service.issue(s.player, "alice.testnet", 2), /Link/);
    assert.equal(
      s.db.prepare("SELECT count(*) AS n FROM native_level_awards").get().n,
      0,
    );
  } finally {
    s.db.close();
  }
});

test("reviewed collectible WASM SHA256 converts to NEAR's base58 code fingerprint", () => {
  const s = setup();
  try {
    const service = new NativeProgression(
      s.native,
      { contractId: s.collection },
      s.signer,
      {
        collectiblesWasmSha256:
          "1cb649afccc9ccfb7ef2a99e29bf346e312b94915feb17fdd1c4fdfb8bf07488",
      },
    );
    assert.equal(
      service.collectiblesCodeHash,
      "2w5deTqFeQWJAu8KdUfazywNnoFmWEAMuRfedh2d9tKh",
    );
  } finally {
    s.db.close();
  }
});

test("level-item milestones stay unavailable until the contract lists their edition", async () => {
  const s = setup();
  const previous = setLevelTable(loadLevelTable({ LEVEL_ITEM_EDITIONS: "1" }));
  try {
    s.nextBlock(1600);
    let result = await s.service.snapshot(s.player, "alice.testnet");
    assert.deepEqual(result.milestones.map((m) => m.level), [2, 3, 4, 5, 6, 7, 8, 9, 10]);
    assert.equal(result.milestones.find((m) => m.level === 2).state, "available");
    assert.equal(result.milestones.find((m) => m.level === 5).state, "unavailable");
    await assert.rejects(s.service.issue(s.player, "alice.testnet", 5), /unavailable/);
    s.state.supported = [...s.state.supported, "stride", "kindle", "compass", "quill", "laurel", "summit"];
    s.nextBlock(1600);
    result = await s.service.snapshot(s.player, "alice.testnet");
    assert.equal(result.milestones.find((m) => m.level === 5).state, "available");
    assert.equal(result.milestones.find((m) => m.level === 5).edition, "stride");
    assert.equal(result.milestones.find((m) => m.level === 6).state, "locked");
    const claim = await s.service.issue(s.player, "alice.testnet", 5);
    assert.match(claim.claim_id || claim.claimId, /^earned:level:/);
  } finally {
    setLevelTable(previous);
  }
});
