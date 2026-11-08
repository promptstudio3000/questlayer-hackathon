import test from "node:test";
import assert from "node:assert/strict";
import {
  validateVaultCall,
  validateVaultOrigins,
  needsProtection,
  trustedVaultMessage,
  describeReview,
  formatUnits,
} from "../src/signing-vault/policy.ts";
import {
  signingVaultOrigin,
  vaultCors,
} from "../server/signing-vault-cors.mjs";
const config = {
  appOrigin: "https://game.example.com",
  vaultOrigin: "https://account.example.com",
  rpcUrl: "https://rpc.testnet.near.org",
  network: "testnet",
  contracts: { qgold: "qgold.testnet", collectibles: "nft.testnet" },
};
const action = (methodName, args = {}, deposit = "1") => ({
  kind: "functionCall",
  methodName,
  args,
  deposit,
  gas: "30000000000000",
});
const call = (a, receiverId = "qgold.testnet") => ({
  accountId: "alice.testnet",
  receiverId,
  actions: [a],
});
const proof = {
  state: "prepared",
  accountId: "alice.testnet",
  contractId: "qgold.testnet",
  amount: "500000",
  memo: "questlayer:burn:emote:1111111111111111",
};
test("ordinary paid play requires the exact server purchase; withdrawals and asset approvals require protection", async () => {
  const burn = call(
    action("ft_burn", { amount: proof.amount, memo: proof.memo }),
  );
  validateVaultCall(burn, "alice.testnet");
  assert.equal(await needsProtection(burn, config, async () => proof), false);
  for (const changed of [
    { amount: "1" },
    { accountId: "eve.testnet" },
    { contractId: "fake.testnet" },
    { state: "complete" },
    { memo: "other" },
  ])
    await assert.rejects(
      needsProtection(burn, config, async () => ({ ...proof, ...changed })),
      /exact purchase/,
    );
  for (const method of [
    "withdraw",
    "redeem",
    "claim_exit",
    "ft_transfer",
    "ft_transfer_call",
    "nft_transfer",
    "nft_approve",
    "buy",
  ])
    assert.equal(
      await needsProtection(call(action(method)), config, async () => proof),
      true,
      method,
    );
});
test("normal avatar and earned-item actions stay seamless only on the configured contract and owner", async () => {
  assert.equal(
    await needsProtection(call(action("mint_avatar"), "nft.testnet"), config),
    false,
  );
  assert.equal(
    await needsProtection(
      call(
        action("equip_aura", { token_id: "aura:1", slot: "above" }, "0"),
        "nft.testnet",
      ),
      config,
    ),
    false,
  );
  assert.equal(
    await needsProtection(
      call(action("unequip_aura", { slot: "below" }, "0"), "nft.testnet"),
      config,
    ),
    false,
  );
  assert.equal(
    await needsProtection(
      call(
        action("redeem_aura", { receiver_id: "alice.testnet" }),
        "nft.testnet",
      ),
      config,
    ),
    false,
  );
  assert.equal(
    await needsProtection(
      call(
        action("redeem_aura", { receiver_id: "eve.testnet" }),
        "nft.testnet",
      ),
      config,
    ),
    true,
  );
  assert.equal(
    await needsProtection(call(action("mint_avatar"), "fake.testnet"), config),
    true,
  );
  assert.throws(
    () =>
      validateVaultCall(
        { ...call(action("mint_avatar")), accountId: "eve.testnet" },
        "alice.testnet",
      ),
    /account/,
  );
  assert.throws(
    () =>
      validateVaultCall(
        {
          ...call(action("mint_avatar")),
          actions: [action("mint_avatar"), action("ft_transfer")],
        },
        "alice.testnet",
      ),
    /one reviewed/,
  );
});
test("same-origin, insecure, credential-bearing and mainnet signer configurations are refused", () => {
  assert.equal(validateVaultOrigins(config), config);
  for (const change of [
    { vaultOrigin: config.appOrigin },
    { vaultOrigin: "http://account.example.com" },
    { vaultOrigin: "https://user:pass@account.example.com" },
    { network: "mainnet" },
  ])
    assert.throws(() => validateVaultOrigins({ ...config, ...change }));
  assert.throws(() => signingVaultOrigin(config.appOrigin, config.appOrigin));
});
test("message origin and window identity must both match; prefixes and null origins do not pass", () => {
  const source = {},
    data = {
      channel: "questlayer-signing-vault",
      id: "00000000-0000-4000-8000-000000000000",
    };
  assert.equal(
    trustedVaultMessage(
      { origin: config.appOrigin, source, data },
      config.appOrigin,
      source,
    ),
    true,
  );
  for (const origin of [
    "null",
    "https://game.example.com.evil.test",
    config.vaultOrigin,
  ])
    assert.equal(
      trustedVaultMessage({ origin, source, data }, config.appOrigin, source),
      false,
    );
  assert.equal(
    trustedVaultMessage(
      { origin: config.appOrigin, source: {}, data },
      config.appOrigin,
      source,
    ),
    false,
  );
});
test("credentialed CORS is restricted to the isolated origin and necessary recovery/purchase routes", () => {
  const headers = {},
    res = {
      setHeader: (k, v) => {
        headers[k] = v;
      },
    },
    req = { method: "GET", headers: { origin: config.vaultOrigin } };
  assert.equal(
    vaultCors(req, res, "/api/gold/burn/intent", config.vaultOrigin),
    true,
  );
  assert.equal(headers["Access-Control-Allow-Origin"], config.vaultOrigin);
  assert.equal(
    vaultCors(req, res, "/api/operator/withdraw", config.vaultOrigin),
    false,
  );
  assert.equal(
    vaultCors(
      { ...req, headers: { origin: "null" } },
      res,
      "/api/account/keys",
      config.vaultOrigin,
    ),
    false,
  );
  assert.equal(vaultCors(req, res, "/api/account/keys", null), false);
});

test("every escrow payment (task, Secret, send) and every token send needs the approval window; background game calls stay seamless", async () => {
  const c = {
    ...config,
    contracts: {
      ...config.contracts,
      qgoldEscrow: "escrow.testnet",
      npcGames: "games.testnet",
      social: "social.testnet",
    },
  };
  const purchase = async () => {
    throw Error("no purchase lookup for escrow payments");
  };
  // F1: a compromised game script creates a task naming itself as the worker
  // (the server would happily return a matching funding intent for it).
  for (const msg of [
    { kind: "task", id: "task-1", reward: "1000000", assignee: "eve.testnet", deadline_ms: "1893456000000" },
    { kind: "task", id: "task-2", reward: "1000000", deadline_ms: "1893456000000" },
    { kind: "secret", id: "s-1", secret_id: "sec", creator: "eve.testnet", price: "1100000" },
    { kind: "transfer", id: "send-1", to: "eve.testnet", condition: { type: "both_confirm" }, expires_ms: "1893456000000" },
    { kind: "unknown" },
  ])
    assert.equal(
      await needsProtection(
        call(
          action("ft_transfer_call", {
            receiver_id: "escrow.testnet",
            amount: "1100000",
            memo: null,
            msg: JSON.stringify(msg),
          }),
        ),
        c,
        purchase,
      ),
      true,
      msg.kind,
    );
  for (const [method, args] of [
    ["ft_transfer", { receiver_id: "eve.testnet", amount: "1" }],
    ["ft_transfer_call", { receiver_id: "eve.testnet", amount: "1", msg: "" }],
    ["ft_transfer_call", { receiver_id: "alice.testnet", amount: "1", msg: "" }],
  ])
    assert.equal(
      await needsProtection(call(action(method, args)), c, purchase),
      true,
      method,
    );
  for (const method of ["start_roll", "resolve_roll", "claim_timeout"])
    assert.equal(
      await needsProtection(call(action(method, {}, "0"), "games.testnet"), c),
      false,
    );
  assert.equal(
    await needsProtection(
      call(
        action("set", {
          data: { "alice.testnet": { profile: { name: "Alice" } } },
        }),
        "social.testnet",
      ),
      c,
    ),
    false,
  );
  assert.equal(
    await needsProtection(
      call(action("set", { data: { "eve.testnet": {} } }), "social.testnet"),
      c,
    ),
    true,
  );
});

const escrowConfig = {
  ...config,
  contracts: { ...config.contracts, qgoldEscrow: "escrow.testnet" },
};
const shown = (view) =>
  [...view.lines.map(([k, v]) => `${k}: ${v}`), ...view.warnings].join("\n");

test("the approval window names the escrow task's beneficiary, the amount, the contract and the method", () => {
  const view = describeReview(
    call(
      action("ft_transfer_call", {
        receiver_id: "escrow.testnet",
        amount: "9900000",
        memo: null,
        msg: JSON.stringify({
          kind: "task",
          id: "task-1",
          reward: "9000000",
          assignee: "eve.testnet",
          deadline_ms: "1893456000000",
        }),
      }),
    ),
    escrowConfig,
  );
  const t = shown(view);
  assert.match(t, /Contract: qgold\.testnet/);
  assert.match(t, /Method: ft_transfer_call/);
  assert.match(t, /Paid into \(escrow\): escrow\.testnet/);
  assert.match(t, /Amount: 9\.9 QGOLD/);
  assert.match(t, /Task reward: 9 QGOLD/);
  assert.match(t, /Market fee: 0\.9 QGOLD/);
  assert.match(t, /Reward goes to: eve\.testnet \(named worker\)/);
  assert.match(t, /Deadline: 2030-01-01 00:00 UTC/);
  assert.ok(
    view.warnings.some((w) => w.includes("eve.testnet") && w.includes("9 QGOLD")),
  );
});

test("escrow sends, Secrets, plain token sends and unreadable messages are decoded, never blind", () => {
  const send = shown(
    describeReview(
      call(
        action("ft_transfer_call", {
          receiver_id: "escrow.testnet",
          amount: "2500000",
          msg: JSON.stringify({
            kind: "transfer",
            id: "send-1",
            to: "bob.testnet",
            condition: { type: "gps", place_id: "place-1", radius_m: 50 },
            expires_ms: "1893456000000",
          }),
        }),
      ),
      escrowConfig,
    ),
  );
  assert.match(send, /Paid to: bob\.testnet/);
  assert.match(send, /Amount: 2\.5 QGOLD/);
  assert.match(send, /within 50 m of place place-1/);
  assert.match(
    send,
    /2\.5 QGOLD leaves your account and can be released to bob\.testnet/,
  );
  const secret = shown(
    describeReview(
      call(
        action("ft_transfer_call", {
          receiver_id: "escrow.testnet",
          amount: "1000000",
          msg: JSON.stringify({
            kind: "secret",
            id: "s",
            secret_id: "x",
            creator: "carol.testnet",
            price: "1000000",
          }),
        }),
      ),
      escrowConfig,
    ),
  );
  assert.match(secret, /Paid to \(creator\): carol\.testnet/);
  assert.match(secret, /Price: 1 QGOLD/);
  const raw = describeReview(
    call(
      action("ft_transfer_call", {
        receiver_id: "escrow.testnet",
        amount: "1",
        msg: "not json",
      }),
    ),
    escrowConfig,
  );
  assert.match(shown(raw), /Escrow message: not json/);
  assert.ok(raw.warnings.length > 0);
  const plain = describeReview(
    call(
      action("ft_transfer", { receiver_id: "eve.testnet", amount: "123456789" }),
    ),
    escrowConfig,
  );
  assert.match(shown(plain), /Recipient: eve\.testnet/);
  assert.match(shown(plain), /Amount: 123\.456789 QGOLD/);
  assert.ok(plain.warnings.some((w) => w.includes("eve.testnet")));
  const deposit = shown(
    describeReview(
      call(
        action("buy", { item: "x" }, "1500000000000000000000000"),
        "shop.testnet",
      ),
      escrowConfig,
    ),
  );
  assert.match(deposit, /Attached NEAR: 1\.5 NEAR/);
  assert.match(deposit, /Other details: \{"item":"x"\}/);
  assert.equal(formatUnits("0", 6), "0");
  assert.equal(formatUnits("-1500000", 6), "-1.5");
});

test("signed messages show their content; NEAR Intents are decoded with target and amounts", () => {
  const intents = describeReview(
    {
      account: "alice.testnet",
      recipient: "intents.testnet",
      authorization: JSON.stringify({
        signer_id: "alice.testnet",
        deadline: "2030-01-01T00:00:00.000Z",
        intents: [
          {
            intent: "transfer",
            receiver_id: "eve.testnet",
            tokens: {
              "nep141:wrap.testnet": "2000000000000000000000000",
              "nep141:qgold.testnet": "5000000",
            },
          },
          {
            intent: "token_diff",
            diff: {
              "nep171:nft.testnet:aura:1": "-1",
              "nep141:wrap.testnet": "100000000000000000000000",
            },
          },
          {
            intent: "native_withdraw",
            receiver_id: "alice.testnet",
            amount: "1000000000000000000000000",
          },
        ],
      }),
    },
    escrowConfig,
  );
  const t = shown(intents);
  assert.match(t, /Action: Sign NEAR Intents/);
  assert.match(t, /Intent 1: Transfer 2 wNEAR, 5 QGOLD to eve\.testnet/);
  assert.match(
    t,
    /Intent 2: Trade: you give 1 × collectible aura:1 \(nft\.testnet\); you receive 0\.1 wNEAR/,
  );
  assert.match(t, /Intent 3: Withdraw 1 NEAR to alice\.testnet/);
  assert.match(t, /Valid until: 2030-01-01/);
  assert.deepEqual(intents.warnings, ["This intent sends value to eve.testnet."]);
  assert.match(
    shown(
      describeReview(
        {
          account: "alice.testnet",
          recipient: "game.example.com",
          authorization: "Sign in to QuestLayer",
        },
        escrowConfig,
      ),
    ),
    /Message: Sign in to QuestLayer/,
  );
  assert.match(
    shown(
      describeReview(
        {
          operation: "revokeKey",
          account: "alice.testnet",
          keyToRemove: "ed25519:abc",
        },
        escrowConfig,
      ),
    ),
    /Action: Remove device key[\s\S]*Public key to remove: ed25519:abc/,
  );
});
