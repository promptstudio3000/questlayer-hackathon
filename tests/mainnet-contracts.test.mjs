// Dry run of the contracts after the minimal mainnet slice (docs/MAINNET-PLAN.md
// §6): badges, npc-games, the collectibles Aura editions, the stNEAR treasury,
// and the yield vault, which must stay blocked. Fake chain only: no network,
// no keys, nothing signed.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { KeyPair } from "near-api-js";
import { NEAR, codeHash } from "../scripts/lib/mainnet-slice.mjs";
import {
  selectedContracts,
  readiness,
  contractsPlan,
  runContracts,
  NPC_TIERS,
  YIELD_VAULT_BLOCKERS,
} from "../scripts/lib/mainnet-contracts.mjs";

const OPERATOR = "questlayer.near";
const AWARD = Buffer.alloc(32, 7).toString("base64");
const TICKET = Buffer.alloc(32, 8).toString("base64");
const NFTS = "nfts.questlayer.near";
const sha = (b) => createHash("sha256").update(b).digest("hex");
const wasms = {
  questlayer_badges: Buffer.from("fake badges wasm"),
  questlayer_npc_games: Buffer.from("fake npc games wasm"),
};
const pinned = {
  questlayer_badges: sha(wasms.questlayer_badges),
  questlayer_npc_games: sha(wasms.questlayer_npc_games),
  questlayer_collectibles: "e2".repeat(32),
  questlayer_yield_vault: "fc".repeat(32),
};
const EDITIONS = ["ember", "dew", "patron", "season"];
const env = {
  MAINNET_CONTRACTS: "badges,npc-games,stnear-treasury",
  BADGES_FUND_NEAR: "2",
  BADGES_MINTER_ALLOWANCE_NEAR: "1",
  NPC_GAMES_FUND_NEAR: "2",
  STNEAR_TREASURY_DEPOSIT_NEAR: "1",
};
const plan = (over = {}, network = "mainnet", operatorId = OPERATOR) => {
  const e = { ...env, ...over };
  return contractsPlan({
    network,
    operatorId,
    env: e,
    selected: selectedContracts(network, e.MAINNET_CONTRACTS),
    wasms,
    pinned,
    reviewedCollectibles: pinned.questlayer_collectibles,
    awardPublicKey: AWARD,
    ticketPublicKey: TICKET,
    expectedEditions: EDITIONS,
  });
};

function fakeChain({
  chainId = "mainnet",
  balance = 20n * NEAR,
  nfts = true,
} = {}) {
  const accounts = new Map([
    [
      OPERATOR,
      {
        amount: String(balance),
        code_hash: "11111111111111111111111111111111",
      },
    ],
    ["meta-pool.near", { amount: "0", code_hash: "Pool" }],
  ]);
  if (nfts) accounts.set(NFTS, { amount: "0", code_hash: "Nfts" });
  const state = new Map();
  const keys = new Map();
  const sent = [];
  let n = 0;
  const tx = (what) => (sent.push(what), `tx${++n}`);
  const debit = (fund) => {
    const op = accounts.get(OPERATOR);
    op.amount = String(BigInt(op.amount) - fund);
  };
  return {
    accounts,
    state,
    sent,
    chainId: async () => chainId,
    account: async (id) => accounts.get(id) ?? null,
    async view(id, method, args = {}) {
      if (id === "meta-pool.near" && method === "get_st_near_price")
        return "1230000000000000000000000";
      if (id === NFTS && method === "supported_editions")
        return [...EDITIONS, "extra"];
      const s = state.get(id);
      if (!s) throw new Error(`no contract ${id}`);
      if (method === "get_config") return s.config;
      if (method === "get_table") return s.tables.get(args.table_id) ?? null;
      throw new Error(`MethodNotFound ${method}`);
    },
    async deployContractAccount({ accountId, fund, wasm, initArgs }) {
      assert.ok(!accounts.has(accountId));
      assert.equal(initArgs.owner_id, OPERATOR);
      debit(fund);
      accounts.set(accountId, {
        amount: String(fund),
        code_hash: codeHash(wasm),
      });
      state.set(accountId, {
        config: {
          owner_id: initArgs.owner_id,
          claim_signer: initArgs.claim_signer,
          ticket_signer: initArgs.ticket_signer,
          min_reveal_delay_blocks: 3,
          badge_base_yocto: "20000000000000000000000",
          per_claim_yocto: "4000000000000000000000",
        },
        tables: new Map(),
      });
      keys.set(accountId, []);
      return tx({ deploy: accountId });
    },
    accessKeys: async (id) => keys.get(id) ?? [],
    async addFunctionCallKey({
      accountId,
      publicKey,
      receiverId,
      methods,
      allowance,
    }) {
      assert.equal(receiverId, accountId);
      assert.deepEqual(methods, ["create_badge", "claim"]);
      assert.equal(allowance, NEAR);
      keys.get(accountId).push(publicKey);
      return tx({ key: accountId });
    },
    async call(contractId, method, args, deposit) {
      if (method === "publish_table") {
        assert.equal(deposit, 1n);
        state
          .get(contractId)
          .tables.set(args.table_id, {
            tiers: args.tiers,
            minimum: args.minimum,
          });
      } else {
        assert.equal(contractId, "meta-pool.near");
        assert.equal(method, "deposit_and_stake");
        debit(deposit);
      }
      return tx({ call: method });
    },
  };
}
function fakeKeys() {
  const files = new Map();
  return {
    files,
    read: (f) => files.get(f) ?? null,
    readRecord: (f) => files.get(`record:${f}`) ?? null,
    create(f, record) {
      assert.ok(!files.has(f), `${f} would be overwritten`);
      files.set(f, record);
    },
    newKeyPair() {
      const k = KeyPair.fromRandom("ed25519");
      return {
        publicKey: k.getPublicKey().toString(),
        secretKey: k.toString(),
      };
    },
  };
}

test("selection: mainnet needs an explicit list, the yield vault is refused", () => {
  assert.deepEqual(selectedContracts("mainnet", undefined), ["editions"]);
  assert.deepEqual(selectedContracts("testnet", undefined), [
    "badges",
    "editions",
    "npc-games",
    "stnear-treasury",
  ]);
  assert.throws(
    () => selectedContracts("mainnet", "badges,yield-vault"),
    /testnet/,
  );
  assert.throws(
    () => selectedContracts("mainnet", "casino"),
    /unknown contract/,
  );
  const r = readiness({
    network: "mainnet",
    pinned,
    reviewedCollectibles: pinned.questlayer_collectibles,
  });
  assert.equal(r["yield-vault"].status, "blocked");
  assert.equal(r.editions.status, "check");
  assert.equal(r["stnear-treasury"].contract, "meta-pool.near");
  assert.equal(
    readiness({ network: "mainnet", pinned, reviewedCollectibles: "00" })
      .editions.status,
    "blocked",
  );
});

test("the yield vault blockers still hold in the contract source", () => {
  const src = readFileSync("contracts/yield-vault/src/lib.rs", "utf8");
  // When any of these changes, update YIELD_VAULT_BLOCKERS and MAINNET-PLAN §6.
  assert.match(src, /"Testnet only"/);
  assert.match(src, /const RHEA: &str = "contract\.burrow\.testnet"/);
  assert.doesNotMatch(src, /"meta-pool\.near"|"linear-protocol\.near"/);
  assert.equal(YIELD_VAULT_BLOCKERS.length, 4);
});

test("plan needs the pinned Linux/CI WASM, written amounts and enough for the code", () => {
  const p = plan();
  assert.equal(p.contracts.badges.accountId, "badges.questlayer.near");
  assert.equal(p.contracts["npc-games"].accountId, "npc-games.questlayer.near");
  assert.equal(
    p.contracts.badges.minter.keyFile,
    ".data/badges-minter-mainnet.json",
  );
  assert.deepEqual(p.contracts["npc-games"].table.tiers, NPC_TIERS);
  assert.equal(p.total, 5n * NEAR);
  assert.throws(
    () => plan({ BADGES_FUND_NEAR: undefined }),
    /BADGES_FUND_NEAR/,
  );
  assert.throws(
    () => plan({ BADGES_MINTER_ALLOWANCE_NEAR: undefined }),
    /ALLOWANCE/,
  );
  assert.throws(
    () => plan({ NPC_GAMES_ACCOUNT: "npc.evil.near" }),
    /direct sub-account/,
  );
  assert.throws(
    () =>
      contractsPlan({
        network: "mainnet",
        operatorId: OPERATOR,
        env,
        selected: ["badges"],
        wasms: { questlayer_badges: Buffer.from("a mac build") },
        pinned,
        awardPublicKey: AWARD,
      }),
    /not the pinned Linux\/CI build/,
  );
  const big = Buffer.alloc(300_000, 1);
  assert.throws(
    () =>
      contractsPlan({
        network: "mainnet",
        operatorId: OPERATOR,
        env,
        selected: ["badges"],
        wasms: { questlayer_badges: big },
        pinned: { ...pinned, questlayer_badges: sha(big) },
        awardPublicKey: AWARD,
      }),
    /at least 3\.5 NEAR for 300000 bytes/,
  );
  assert.throws(
    () =>
      contractsPlan({
        network: "mainnet",
        operatorId: OPERATOR,
        env,
        selected: ["npc-games"],
        wasms,
        pinned,
        awardPublicKey: AWARD,
        ticketPublicKey: AWARD,
      }),
    /its own key/,
  );
  assert.throws(
    () =>
      contractsPlan({
        network: "mainnet",
        operatorId: OPERATOR,
        env,
        selected: ["editions"],
        pinned,
        reviewedCollectibles: "ab".repeat(32),
        expectedEditions: EDITIONS,
      }),
    /needs a review first/,
  );
  // Testnet rehearsal keeps defaults.
  const t = plan(
    {
      BADGES_FUND_NEAR: undefined,
      BADGES_MINTER_ALLOWANCE_NEAR: undefined,
      NPC_GAMES_FUND_NEAR: undefined,
      STNEAR_TREASURY_DEPOSIT_NEAR: undefined,
    },
    "testnet",
    "ops.testnet",
  );
  assert.equal(t.total, 8n * NEAR);
});

test("plan mode signs nothing and counts the slice in the balance check", async () => {
  const chain = fakeChain({ nfts: false }),
    keys = fakeKeys();
  const r = await runContracts({
    plan: plan(),
    chain,
    keys,
    collectiblesId: NFTS,
  });
  assert.equal(r.status, "planned");
  assert.equal(chain.sent.length, 0);
  assert.equal(keys.files.size, 0);
  assert.equal(r.needed, 5n * NEAR);
  assert.ok(r.steps.some((s) => s.planned && /Aura editions/.test(s.step)));
  await assert.rejects(
    runContracts({
      plan: plan(),
      chain: fakeChain({ balance: 18n * NEAR }),
      keys,
      collectiblesId: NFTS,
      reserved: 13n * NEAR,
    }),
    /need 18 NEAR plus a 1 NEAR reserve/,
  );
});

test("execute deploys once, writes mainnet manifests, a re-run only verifies", async () => {
  const chain = fakeChain(),
    keys = fakeKeys();
  const r = await runContracts({
    plan: plan(),
    chain,
    keys,
    execute: true,
    collectiblesId: NFTS,
    clock: () => new Date("2026-11-13T12:00:00Z"),
  });
  assert.equal(r.status, "deployed");
  assert.deepEqual(
    chain.sent.map((s) => Object.values(s)[0]),
    [
      "badges.questlayer.near",
      "badges.questlayer.near",
      "npc-games.questlayer.near",
      "publish_table",
      "deposit_and_stake",
    ],
  );
  const minter = keys.files.get(".data/badges-minter-mainnet.json");
  assert.equal(minter.network, "mainnet");
  const badges = r.manifests["native-badges-mainnet.json"];
  assert.equal(badges.contractId, "badges.questlayer.near");
  assert.equal(badges.wasmSha256, pinned.questlayer_badges);
  assert.equal(badges.codeHash, codeHash(wasms.questlayer_badges));
  assert.equal(badges.claimSignerPublicKey, AWARD);
  assert.equal(badges.minterPublicKey, minter.publicKey);
  const npc = r.manifests["native-npc-games-mainnet.json"];
  assert.equal(npc.ticketSignerPublicKey, TICKET);
  assert.equal(npc.wagering, false);
  assert.deepEqual(npc.tables["wisp-v1"].tiers, NPC_TIERS);
  assert.deepEqual(
    r.manifests["native-editions-mainnet.json"].supportedEditions.slice(0, 4),
    EDITIONS,
  );
  const st = r.manifests["stnear-treasury-mainnet.json"];
  assert.equal(st.contract, "meta-pool.near");
  assert.equal(st.principal, String(NEAR));
  assert.equal(st.rewardsContract, null);

  keys.files.set("record:stnear-treasury-mainnet.json", st);
  const again = await runContracts({
    plan: plan(),
    chain,
    keys,
    execute: true,
    collectiblesId: NFTS,
  });
  assert.equal(chain.sent.length, 5, "a re-run sends nothing new");
  assert.equal(again.transactions.length, 0);
});

test("refuses wrong chain, foreign code, another signer and missing editions", async () => {
  await assert.rejects(
    runContracts({
      plan: plan(),
      chain: fakeChain({ chainId: "testnet" }),
      keys: fakeKeys(),
    }),
    /serves testnet/,
  );
  const foreign = fakeChain();
  foreign.accounts.set("badges.questlayer.near", {
    amount: "1",
    code_hash: "Other",
  });
  await assert.rejects(
    runContracts({ plan: plan(), chain: foreign, keys: fakeKeys() }),
    /Upgrades are a separate/,
  );
  const signer = fakeChain(),
    keys = fakeKeys();
  await runContracts({
    plan: plan(),
    chain: signer,
    keys,
    execute: true,
    collectiblesId: NFTS,
  });
  signer.state.get("npc-games.questlayer.near").config.ticket_signer = AWARD;
  await assert.rejects(
    runContracts({ plan: plan(), chain: signer, keys, collectiblesId: NFTS }),
    /trusts ticket signer/,
  );
  const missing = contractsPlan({
    network: "mainnet",
    operatorId: OPERATOR,
    env,
    selected: ["editions"],
    pinned,
    reviewedCollectibles: pinned.questlayer_collectibles,
    expectedEditions: [...EDITIONS, "future"],
  });
  await assert.rejects(
    runContracts({
      plan: missing,
      chain: fakeChain(),
      keys: fakeKeys(),
      collectiblesId: NFTS,
    }),
    /does not list the Aura editions future/,
  );
});

test("the real pins: every new contract has a Linux/CI hash and the editions are reviewed", () => {
  const pinFile = JSON.parse(readFileSync("contracts/wasm-sha256.json", "utf8"));
  const pins = pinFile.contracts;
  for (const key of [
    "questlayer_badges",
    "questlayer_npc_games",
    "questlayer_collectibles",
    "questlayer_yield_vault",
  ])
    assert.match(pins[key], /^[0-9a-f]{64}$/, key);
  const reviewed = readFileSync("contracts/collectibles/WASM_SHA256", "utf8")
    .trim()
    .split(/\s+/)[0];
  assert.equal(reviewed, pins.questlayer_collectibles);
  const editions = JSON.parse(
    readFileSync("public/native-editions-testnet.json", "utf8"),
  );
  // Testnet runs the reviewed build, or an older one listed on purpose until
  // scripts/upgrade-collectibles-editions-testnet.mjs deploys the new build.
  const pending = pinFile.testnetDeploymentsNotFromThisBuild?.["public/native-editions-testnet.json:wasmSha256"];
  if (editions.wasmSha256 !== pins.questlayer_collectibles) {
    assert.equal(pending?.contract, "questlayer_collectibles");
    assert.equal(pending?.sha256, editions.wasmSha256);
  }
  assert.ok(editions.supportedEditions.includes("season"));
});
