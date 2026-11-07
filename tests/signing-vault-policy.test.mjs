import test from "node:test";
import assert from "node:assert/strict";
import {
  validateVaultCall,
  validateVaultOrigins,
  needsProtection,
  trustedVaultMessage,
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

test("ordinary task and Secret funding matches an independent intent; peer transfers still require approval", async () => {
  const c = {
    ...config,
    contracts: {
      ...config.contracts,
      qgoldEscrow: "escrow.testnet",
      npcGames: "games.testnet",
      social: "social.testnet",
    },
  };
  const args = {
    receiver_id: "escrow.testnet",
    amount: "1100000",
    memo: null,
    msg: JSON.stringify({ kind: "task", id: "task-1" }),
  };
  const request = call(action("ft_transfer_call", args));
  const intent = {
    signerId: "alice.testnet",
    receiverId: "qgold.testnet",
    methodName: "ft_transfer_call",
    args,
    gas: request.actions[0].gas,
    deposit: "1",
  };
  assert.equal(
    await needsProtection(request, c, undefined, async () => intent),
    false,
  );
  await assert.rejects(
    needsProtection(request, c, undefined, async () => ({
      ...intent,
      args: { ...args, amount: "1200000" },
    })),
    /exact escrow payment/,
  );
  assert.equal(
    await needsProtection(
      call(
        action("ft_transfer_call", {
          ...args,
          msg: JSON.stringify({ kind: "transfer", id: "send-1" }),
        }),
      ),
      c,
      undefined,
      async () => intent,
    ),
    true,
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
