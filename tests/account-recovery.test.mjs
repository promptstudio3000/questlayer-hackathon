// Recovering the invisible account on a new device: recovery passkey (WebAuthn
// PRF) -> NEP-413 sign-in -> sponsored AddKey for a fresh device key; device
// list and lost-device revocation. Runs the real client module against the real
// ManagedAccounts/Relayer on the fake chain; no network, no server-held keys.
import test from "node:test";
import assert from "node:assert/strict";
import { createHmac, randomBytes } from "node:crypto";
import { KeyPair, PublicKey } from "near-api-js";
import { fixture, outcomeFor } from "./relayer-fixture.mjs";
import { verifyNearIdentity } from "../server/identity/near.mjs";
import { NETWORK } from "../server/native/network.mjs";
import {
  RECOVERY_PRF_SALT,
  deviceLabel,
  deviceRows,
  nep413Proof,
  readRecoveryPasskey,
  recoveryKeyFromPrf,
  relayKeyChange,
  replaceDeviceKey,
  restoreWithPasskey,
  revokeAccountKey,
  setupPasskeyRecovery,
} from "../src/account-recovery.ts";
import { DEVICE_KEY, memoryKeyStore } from "../src/player-key.ts";

// A synced passkey provider: each credential has its own PRF secret and user
// handle; it never reveals the secret, only HMAC(secret, salt).
function passkeyProvider({ prf = true, prfOnCreate = false } = {}) {
  const credentials = new Map();
  let chosen = null;
  const evaluate = (c, ext) =>
    ext?.prf?.eval?.first
      ? createHmac("sha256", c.secret)
          .update(Buffer.from(ext.prf.eval.first))
          .digest()
      : undefined;
  const api = {
    credentials,
    choose(id) {
      chosen = id;
    },
    async create({ publicKey }) {
      const id = randomBytes(16).toString("base64url");
      const c = {
        id,
        secret: randomBytes(32),
        userHandle: Buffer.from(publicKey.user.id),
        rpId: publicKey.rp.id,
      };
      credentials.set(id, c);
      chosen = id;
      return {
        id,
        rawId: Buffer.from(id),
        getClientExtensionResults: () => ({
          prf: prf
            ? {
                enabled: true,
                ...(prfOnCreate
                  ? { results: { first: evaluate(c, publicKey.extensions) } }
                  : {}),
              }
            : { enabled: false },
        }),
      };
    },
    async get({ publicKey }) {
      const allowed = publicKey.allowCredentials?.map((a) =>
        Buffer.from(a.id).toString(),
      );
      const c = credentials.get(allowed?.[0] ?? chosen);
      if (!c) {
        const e = Error("No passkey");
        e.name = "NotAllowedError";
        throw e;
      }
      return {
        id: c.id,
        rawId: Buffer.from(c.id),
        response: { userHandle: c.userHandle },
        getClientExtensionResults: () =>
          prf
            ? { prf: { results: { first: evaluate(c, publicKey.extensions) } } }
            : {},
      };
    },
  };
  return api;
}

// The game server, in process: account keys, relay, NEP-413 sign-in. The
// sign-in uses the production verifier against the fake chain.
function server(f) {
  f.state.provider.viewNodeStatus = async () => ({
    chain_id: NETWORK,
    sync_info: { syncing: false },
  });
  f.state.provider.viewAccessKey = async ({ accountId, publicKey }) =>
    f.state.provider.query({
      request_type: "view_access_key",
      account_id: accountId,
      public_key: publicKey.toString(),
    });
  // The chain applies key changes carried by relayed delegates.
  f.transport.onSend = ({ hash, signedDelegate }) => {
    const d = signedDelegate.delegateAction,
      account = f.state.accounts.get(d.senderId),
      signing = account.keys.get(PublicKey.from(d.publicKey).toString());
    if (!signing) throw Error("InvalidAccessKeyError");
    signing.nonce = Number(d.nonce);
    const [action] = d.actions;
    if (action.addKey)
      account.keys.set(PublicKey.from(action.addKey.publicKey).toString(), {
        nonce: 0,
        permission: "FullAccess",
      });
    if (action.deleteKey)
      account.keys.delete(
        PublicKey.from(action.deleteKey.publicKey).toString(),
      );
    return outcomeFor(signedDelegate, { hash });
  };
  const challenges = new Map();
  const session = { player: null, signIns: 0 };
  async function api(path, data) {
    const relay = /^\/relay\/([^/]+)$/.exec(path);
    if (path === "/auth/near/challenge") {
      const id = `c${challenges.size + 1}`,
        c = {
          network: NETWORK,
          accountId: data.accountId,
          message: `Sign in to QuestLayer as ${data.accountId}`,
          recipient: "http://localhost:8787",
          nonce: randomBytes(32).toString("base64"),
        };
      challenges.set(id, c);
      return { challengeId: id, ...c };
    }
    if (path === "/auth/near/verify") {
      const c = challenges.get(data.challengeId);
      await verifyNearIdentity(c, data, f.state.provider);
      challenges.delete(data.challengeId);
      const link = f.db
        .prepare("SELECT player_id FROM wallet_links WHERE account_id=?")
        .get(c.accountId);
      session.player = link.player_id;
      session.signIns++;
      return { player: { id: link.player_id } };
    }
    assert.ok(session.player, `signed in before ${path}`);
    if (path === "/account/keys")
      return data.remove
        ? f.accounts.requestKeyRemoval(session.player, data)
        : f.accounts.requestKey(session.player, data);
    if (path === "/relay/prepare")
      return f.relayer.prepare(session.player, data);
    if (path === "/relay") {
      const job = await f.relayer.submit(session.player, data);
      await f.relayer.runRelayJobs();
      return job;
    }
    if (relay) return f.relayer.status(session.player, relay[1]);
    throw Error(`unexpected ${path}`);
  }
  return { api, session };
}
const deviceRecord = (acct) => ({
  publicKey: acct.publicKey,
  secretKey: acct.device.toString(),
  accountId: acct.accountId,
  origin: "device",
  createdAt: 1,
});
const keyState = (f, publicKey) =>
  f.db
    .prepare("SELECT state FROM managed_account_keys WHERE public_key=?")
    .get(publicKey)?.state;

test("the same passkey secret always derives the same recovery key", async () => {
  const prf = randomBytes(32);
  const a = await recoveryKeyFromPrf(prf, "a.players.testnet"),
    b = await recoveryKeyFromPrf(new Uint8Array(prf), "a.players.testnet"),
    other = await recoveryKeyFromPrf(randomBytes(32), "a.players.testnet");
  assert.equal(a.publicKey, b.publicKey);
  assert.equal(a.origin, "prf");
  assert.notEqual(a.publicKey, other.publicKey);
  assert.equal(
    KeyPair.fromString(a.secretKey).getPublicKey().toString(),
    a.publicKey,
  );
  await assert.rejects(recoveryKeyFromPrf(new Uint8Array(16), null), /usable/);
  assert.equal(
    new TextDecoder().decode(RECOVERY_PRF_SALT),
    "questlayer:recovery-key:v1",
  );
});

test("a lost phone: recovery passkey restores the explorer on a new laptop, which revokes the phone", async (t) => {
  const f = fixture();
  t.after(() => f.db.close());
  const phone = f.ready();
  const { api, session } = server(f);
  session.player = f.player;
  const passkeys = passkeyProvider();

  // On the phone: create the recovery passkey and add its key on chain.
  const { publicKey: recoveryKey } = await setupPasskeyRecovery({
    deviceKey: deviceRecord(phone),
    accountId: phone.accountId,
    credentials: passkeys,
    rpId: "localhost",
    api,
    intervalMs: 1,
  });
  assert.equal(keyState(f, recoveryKey), "active");
  assert.ok(f.state.accounts.get(phone.accountId).keys.has(recoveryKey));
  const stored = f.db
    .prepare("SELECT kind,label FROM managed_account_keys WHERE public_key=?")
    .get(recoveryKey);
  assert.deepEqual(
    { ...stored },
    { kind: "recovery", label: "Recovery passkey" },
  );
  // The server keeps public keys only.
  assert.doesNotMatch(
    JSON.stringify(f.rows("managed_account_keys")) +
      JSON.stringify(f.rows("relay_jobs")),
    /ed25519:[1-9A-HJ-NP-Za-km-z]{80,}/,
  );

  // The phone is lost. A new laptop has no cookie and no key.
  session.player = null;
  const laptopStore = memoryKeyStore();
  const restored = await restoreWithPasskey({
    store: laptopStore,
    credentials: passkeys,
    rpId: "localhost",
    api,
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15",
    intervalMs: 1,
  });
  assert.equal(restored.player.id, f.player);
  assert.equal(restored.accountId, phone.accountId);
  assert.equal(session.signIns, 1);
  const laptopKey = await laptopStore.get(DEVICE_KEY);
  assert.equal(laptopKey.publicKey, restored.publicKey);
  assert.equal(laptopKey.accountId, phone.accountId);
  assert.equal(laptopKey.origin, "device");
  assert.equal(keyState(f, laptopKey.publicKey), "active");
  assert.ok(
    f.state.accounts.get(phone.accountId).keys.has(laptopKey.publicKey),
  );
  assert.equal(
    f.db
      .prepare("SELECT label FROM managed_account_keys WHERE public_key=?")
      .get(laptopKey.publicKey).label,
    "Mac · Safari",
  );
  // The recovery key was never persisted on the new device.
  assert.equal(await laptopStore.get(`archived:${recoveryKey}`), null);

  // The device list on the laptop.
  const view = f.accounts.view(f.player).account.keys;
  const rows = deviceRows(view, laptopKey.publicKey);
  assert.equal(rows[0].title, "This device");
  assert.equal(rows[0].canRevoke, false);
  const phoneRow = rows.find((r) => r.publicKey === phone.publicKey);
  assert.equal(phoneRow.title, "Another device");
  assert.equal(phoneRow.canRevoke, true);

  // Revoke the lost phone from the laptop: removed on chain and in the list.
  const revoked = await revokeAccountKey({
    deviceKey: laptopKey,
    accountId: phone.accountId,
    publicKey: phone.publicKey,
    api,
    intervalMs: 1,
  });
  assert.deepEqual(revoked, { removed: true, onChain: true });
  assert.equal(keyState(f, phone.publicKey), "removed");
  assert.equal(
    f.state.accounts.get(phone.accountId).keys.has(phone.publicKey),
    false,
  );
  assert.equal(
    deviceRows(
      f.accounts.view(f.player).account.keys,
      laptopKey.publicKey,
    ).some((r) => r.publicKey === phone.publicKey),
    false,
  );
  // The revoked phone key can no longer get a relay nonce.
  await assert.rejects(
    f.relayer.prepare(f.player, {
      accountId: phone.accountId,
      publicKey: phone.publicKey,
    }),
    (e) => e.code === "RELAY_KEY",
  );
  // This device cannot revoke itself.
  await assert.rejects(
    revokeAccountKey({
      deviceKey: laptopKey,
      accountId: phone.accountId,
      publicKey: laptopKey.publicKey,
      api,
    }),
    (e) => e.code === "RECOVERY_SELF",
  );
});

test("PRF evaluated at creation is used directly; providers without PRF are refused", async (t) => {
  const f = fixture();
  t.after(() => f.db.close());
  const phone = f.ready();
  const { api, session } = server(f);
  session.player = f.player;
  const direct = passkeyProvider({ prfOnCreate: true });
  let gets = 0;
  const get = direct.get;
  direct.get = (o) => (gets++, get(o));
  await setupPasskeyRecovery({
    deviceKey: deviceRecord(phone),
    accountId: phone.accountId,
    credentials: direct,
    rpId: "localhost",
    api,
    intervalMs: 1,
  });
  assert.equal(gets, 0);
  const before = f.rows("managed_account_keys").length;
  await assert.rejects(
    setupPasskeyRecovery({
      deviceKey: deviceRecord(phone),
      accountId: phone.accountId,
      credentials: passkeyProvider({ prf: false }),
      rpId: "localhost",
      api,
    }),
    (e) => e.code === "RECOVERY_UNSUPPORTED",
  );
  assert.equal(f.rows("managed_account_keys").length, before);
});

test("an ordinary passkey or an unregistered recovery key cannot restore anything", async (t) => {
  const f = fixture();
  t.after(() => f.db.close());
  const phone = f.ready();
  const { api, session } = server(f);
  const passkeys = passkeyProvider();
  // A demo sign-in passkey: random user handle.
  await passkeys.create({
    publicKey: {
      rp: { id: "localhost" },
      user: { id: randomBytes(32) },
      extensions: {},
    },
  });
  await assert.rejects(
    readRecoveryPasskey({ credentials: passkeys, rpId: "localhost" }),
    (e) => e.code === "RECOVERY_NOT_RECOVERY_PASSKEY",
  );
  // A passkey naming the account whose key was never added on chain.
  await passkeys.create({
    publicKey: {
      rp: { id: "localhost" },
      user: { id: new TextEncoder().encode(phone.accountId) },
      extensions: {},
    },
  });
  const store = memoryKeyStore();
  await assert.rejects(
    restoreWithPasskey({
      store,
      credentials: passkeys,
      rpId: "localhost",
      api,
    }),
    (e) => e.status === 401,
  );
  assert.equal(session.player, null);
  assert.equal(await store.get(DEVICE_KEY), null);
  // Cancelling the passkey prompt is reported as a cancellation.
  const cancelled = passkeyProvider();
  await assert.rejects(
    readRecoveryPasskey({ credentials: cancelled, rpId: "localhost" }),
    (e) => e.code === "CANCELLED",
  );
});

test("NEP-413 proofs from a device key pass the production verifier", async (t) => {
  const f = fixture();
  t.after(() => f.db.close());
  const phone = f.ready();
  server(f);
  const c = {
    network: NETWORK,
    accountId: phone.accountId,
    message: "m",
    recipient: "http://localhost:8787",
    nonce: randomBytes(32).toString("base64"),
  };
  const proof = await nep413Proof(deviceRecord(phone), phone.accountId, c);
  await verifyNearIdentity(c, proof, f.state.provider);
  await assert.rejects(
    verifyNearIdentity({ ...c, message: "other" }, proof, f.state.provider),
    (e) => e.status === 401,
  );
  await assert.rejects(
    nep413Proof(deviceRecord(phone), phone.accountId, { ...c, nonce: "AAAA" }),
    (e) => e.code === "RECOVERY_CHALLENGE",
  );
});

test("key registrations are typed: an addition cannot be deleted and a removal cannot be re-added", async (t) => {
  const f = fixture();
  t.after(() => f.db.close());
  const phone = f.ready();
  const { api, session } = server(f);
  session.player = f.player;
  const laptop = KeyPair.fromRandom("ed25519").getPublicKey().toString();
  await f.accounts.requestKey(f.player, { publicKey: laptop, label: "laptop" });
  await assert.rejects(
    relayKeyChange(
      deviceRecord(phone),
      {
        accountId: phone.accountId,
        change: "delete",
        publicKey: laptop,
      },
      { api },
    ),
    (e) => e.code === "RELAY_KEY_TARGET",
  );
  await relayKeyChange(
    deviceRecord(phone),
    {
      accountId: phone.accountId,
      change: "add",
      publicKey: laptop,
    },
    { api, intervalMs: 1 },
  );
  assert.equal(keyState(f, laptop), "active");
  f.accounts.requestKeyRemoval(f.player, { publicKey: laptop });
  assert.equal(keyState(f, laptop), "removing");
  // Idempotent while the removal is pending.
  f.accounts.requestKeyRemoval(f.player, { publicKey: laptop });
  await assert.rejects(
    relayKeyChange(
      deviceRecord(phone),
      {
        accountId: phone.accountId,
        change: "add",
        publicKey: laptop,
      },
      { api },
    ),
    (e) => e.code === "RELAY_KEY_TARGET",
  );
  // A pending key that never reached the chain is simply forgotten.
  const tablet = KeyPair.fromRandom("ed25519").getPublicKey().toString();
  await f.accounts.requestKey(f.player, { publicKey: tablet });
  const forgot = await revokeAccountKey({
    deviceKey: deviceRecord(phone),
    accountId: phone.accountId,
    publicKey: tablet,
    api,
  });
  assert.deepEqual(forgot, { removed: true, onChain: false });
  assert.equal(keyState(f, tablet), "removed");
  // The last active key cannot be removed.
  assert.throws(
    () =>
      f.accounts.requestKeyRemoval(f.player, { publicKey: phone.publicKey }),
    (e) => e.code === "ACCOUNT_LAST_KEY",
  );
});

test("at most ten devices per explorer", async (t) => {
  const f = fixture();
  t.after(() => f.db.close());
  f.ready();
  for (let i = 0; i < 9; i++)
    await f.accounts.requestKey(f.player, {
      publicKey: KeyPair.fromRandom("ed25519").getPublicKey().toString(),
    });
  await assert.rejects(
    f.accounts.requestKey(f.player, {
      publicKey: KeyPair.fromRandom("ed25519").getPublicKey().toString(),
    }),
    (e) => e.code === "ACCOUNT_KEY_LIMIT",
  );
});

test("a key this browser held for another explorer is archived, not overwritten", async () => {
  const store = memoryKeyStore();
  const old = {
    publicKey: "ed25519:old",
    secretKey: "x",
    accountId: "a.testnet",
    origin: "device",
    createdAt: 1,
  };
  await store.put(DEVICE_KEY, old);
  const next = { ...old, publicKey: "ed25519:new", accountId: "b.testnet" };
  await replaceDeviceKey(store, next);
  assert.deepEqual(await store.get(DEVICE_KEY), next);
  assert.deepEqual(await store.get("archived:ed25519:old"), old);
});

test("device labels and rows", () => {
  assert.equal(
    deviceLabel(
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1",
    ),
    "iPhone · Safari",
  );
  assert.equal(
    deviceLabel(
      "Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 Chrome/141.0 Mobile Safari/537.36",
    ),
    "Android · Chrome",
  );
  assert.equal(deviceLabel(""), "Device");
  const rows = deviceRows(
    [
      {
        publicKey: "a",
        kind: "device",
        state: "active",
        label: "first device",
      },
      {
        publicKey: "r",
        kind: "recovery",
        state: "active",
        label: "Recovery passkey",
      },
      { publicKey: "b", kind: "device", state: "removed", label: "old" },
      {
        publicKey: "c",
        kind: "device",
        state: "pending",
        label: "Windows · Edge",
      },
    ],
    "a",
  );
  assert.deepEqual(
    rows.map((r) => [r.title, r.canRevoke]),
    [
      ["This device", false],
      ["Recovery passkey", true],
      ["Windows · Edge", true],
    ],
  );
  // Only one usable key: nothing that would strand the account is offered.
  const alone = deviceRows(
    [
      { publicKey: "a", kind: "device", state: "active" },
      { publicKey: "r", kind: "recovery", state: "removing" },
    ],
    null,
  );
  assert.equal(alone.find((r) => r.publicKey === "a").canRevoke, false);
});

test('recovery preserves the new private device key across a lost AddKey reply', async t => {
 const f=fixture(); t.after(()=>f.db.close()); const phone=f.ready();
 const {api,session}=server(f);session.player=f.player;const credentials=passkeyProvider();
 await setupPasskeyRecovery({deviceKey:deviceRecord(phone),accountId:phone.accountId,credentials,rpId:'localhost',api,intervalMs:1});
 const store=memoryKeyStore();let lost=false;
 const dropping=async(path,data)=>{const result=await api(path,data);if(path==='/relay'&&!lost){lost=true;throw Error('lost AddKey acknowledgement');}return result;};
 await assert.rejects(restoreWithPasskey({store,credentials,rpId:'localhost',api:dropping,intervalMs:1}),/lost AddKey/);
 const saved=await store.get(`pending-recovery:${phone.accountId}`);assert.ok(saved?.secretKey);
 assert.ok(f.state.accounts.get(phone.accountId).keys.has(saved.publicKey));
 const recovered=await restoreWithPasskey({store,credentials,rpId:'localhost',api,intervalMs:1});
 assert.equal(recovered.publicKey,saved.publicKey);assert.equal((await store.get(DEVICE_KEY)).secretKey,saved.secretKey);
 assert.equal(await store.get(`pending-recovery:${phone.accountId}`),null);
});

// Wallet words: 12 new words whose key joins the account, so the same account
// opens in Meteor or another NEAR wallet (Settings → Account and devices).
test("wallet words import with the standard NEAR phrase and never reach the server", async (t) => {
  const { parseSeedPhrase } = await import("near-api-js/seed-phrase");
  const { activateWalletWords, newWalletWords } = await import(
    "../src/signing-vault/wallet-export.ts"
  );
  const { hasWalletWords } = await import("../src/account-recovery.ts");
  const f = fixture();
  t.after(() => f.db.close());
  const phone = f.ready();
  const { api, session } = server(f);
  session.player = f.player;

  const made = await newWalletWords(),
    again = await newWalletWords();
  assert.equal(made.words.length, 12);
  assert.notDeepEqual(made.words, again.words);
  // What a wallet derives from the typed words is the key we add.
  assert.equal(
    parseSeedPhrase(made.words.join(" ")).getPublicKey().toString(),
    made.publicKey,
  );

  const calls = [];
  const spy = async (path, data) => {
    calls.push(JSON.stringify([path, data ?? null]));
    return api(path, data);
  };
  await activateWalletWords({
    deviceKey: deviceRecord(phone),
    accountId: phone.accountId,
    publicKey: made.publicKey,
    api: spy,
    intervalMs: 1,
  });
  assert.equal(keyState(f, made.publicKey), "active");
  assert.equal(
    f.state.accounts.get(phone.accountId).keys.get(made.publicKey).permission,
    "FullAccess",
  );
  const keys = f.accounts.view(f.player).account.keys;
  assert.ok(hasWalletWords(keys));
  const row = deviceRows(keys, phone.publicKey).find((r) => r.wallet);
  assert.equal(row.title, "Wallet words");
  assert.equal(row.canRevoke, true);
  // Nothing sent to the game or stored by it contains a word or a secret key.
  const sent =
    calls.join("\n") +
    JSON.stringify(f.rows("managed_account_keys")) +
    JSON.stringify(f.rows("relay_jobs"));
  const secret = parseSeedPhrase(made.words.join(" ")).toString();
  assert.ok(!sent.includes(secret) && !sent.includes(secret.slice(8)));
  // Bip39 words can be ordinary English ("device", "label", "account"), so
  // look for the phrase itself: any three words in their order.
  for (let i = 0; i + 3 <= made.words.length; i++)
    assert.ok(!sent.includes(made.words.slice(i, i + 3).join(" ")));

  // Lost paper: the device revokes the words like any other key.
  await revokeAccountKey({
    deviceKey: deviceRecord(phone),
    accountId: phone.accountId,
    publicKey: made.publicKey,
    api,
    intervalMs: 1,
  });
  assert.equal(keyState(f, made.publicKey), "removed");
  assert.ok(!f.state.accounts.get(phone.accountId).keys.has(made.publicKey));
});

test("the word check asks for two different words with the right one among four", async () => {
  const { wordChecks } = await import("../src/signing-vault/wallet-export.ts");
  const words = "apple bird cat dog egg fish goat hat ink jam kite apple".split(" ");
  for (let run = 0; run < 50; run++) {
    const rounds = wordChecks(words);
    assert.equal(rounds.length, 2);
    assert.notEqual(rounds[0].position, rounds[1].position);
    for (const r of rounds) {
      assert.equal(words[r.position - 1], r.answer);
      assert.equal(r.options.length, 4);
      assert.equal(new Set(r.options).size, 4);
      assert.equal(r.options.filter((o) => o === r.answer).length, 1);
    }
  }
});

test("the passkey unlock for wallet words accepts only this account's live passkey", async (t) => {
  const { confirmWithPasskey } = await import(
    "../src/signing-vault/wallet-export.ts"
  );
  const f = fixture();
  t.after(() => f.db.close());
  const phone = f.ready();
  const { api, session } = server(f);
  session.player = f.player;
  const passkeys = passkeyProvider();
  await setupPasskeyRecovery({
    deviceKey: deviceRecord(phone),
    accountId: phone.accountId,
    credentials: passkeys,
    rpId: "localhost",
    api,
    intervalMs: 1,
  });
  const isFullAccessKey = async (accountId, publicKey) =>
    f.state.accounts.get(accountId)?.keys.get(publicKey)?.permission ===
    "FullAccess";
  await confirmWithPasskey({
    accountId: phone.accountId,
    credentials: passkeys,
    rpId: "localhost",
    isFullAccessKey,
  });
  // A passkey that names this account but was never added to it.
  const stranger = passkeyProvider();
  await stranger.create({
    publicKey: {
      rp: { id: "localhost" },
      user: { id: new TextEncoder().encode(phone.accountId) },
    },
  });
  await assert.rejects(
    confirmWithPasskey({
      accountId: phone.accountId,
      credentials: stranger,
      rpId: "localhost",
      isFullAccessKey,
    }),
    /does not belong/,
  );
  await assert.rejects(
    confirmWithPasskey({
      accountId: "someone-else.testnet",
      credentials: passkeys,
      rpId: "localhost",
      isFullAccessKey,
    }),
    /does not belong/,
  );
});
