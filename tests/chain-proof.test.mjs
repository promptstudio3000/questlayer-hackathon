import test from "node:test";
import assert from "node:assert/strict";
import {
  chainHref,
  chainState,
  fromPoll,
  pollPath,
} from "../src/chain-proof.ts";
import { autoPublishProfile, AUTO_PROFILE_PREFIX } from "../src/auto-social-profile.ts";

const TX = "9xYz1111111111111111111111111111111111111111";
const X = "https://testnet.nearblocks.io";

test("every status word maps to one of the three icon states", () => {
  for (const s of ["queued", "sent", "retrying", "pending", "issued"])
    assert.equal(chainState({ status: s }), "pending", s);
  for (const s of ["confirmed", "minted", "settled"])
    assert.equal(chainState({ status: s }), "confirmed", s);
  assert.equal(chainState({ status: "failed" }), "failed");
  assert.equal(chainState({ status: "no-account" }), "hidden");
  assert.equal(chainState({ status: "off", tx: TX }), "hidden");
  assert.equal(chainState(null), "hidden");
  assert.equal(chainState({}), "hidden");
  assert.equal(chainState({ tx: TX }), "confirmed");
  assert.equal(chainState({ account: "a.testnet" }), "confirmed");
  assert.equal(chainState({ id: "roll:r1" }), "pending");
});

test("links go to the transaction, then the NFT, then the account; never off the explorer", () => {
  assert.equal(chainHref({ tx: TX, account: "a.testnet" }), `${X}/txns/${TX}`);
  assert.equal(chainHref({ explorer: "https://evil.example/txns/x" }), null);
  assert.equal(chainHref({ explorer: `${X}/txns/abc` }), `${X}/txns/abc`);
  assert.equal(
    chainHref({ token: { contract: "nft.testnet", id: "aura:ember:1" } }),
    `${X}/nft-token/nft.testnet/aura%3Aember%3A1`,
  );
  assert.equal(chainHref({ account: "a.qlx.testnet" }), `${X}/address/a.qlx.testnet`);
  assert.equal(chainHref({ account: "../x" }), null);
  assert.equal(chainHref({ tx: "bad" }), null);
});

test("pending proofs poll the feed or the coin/XP record route", () => {
  assert.equal(pollPath({ id: "roll:r1" }), "/chain/items?ids=roll%3Ar1");
  assert.equal(pollPath({ id: "latest:market:5" }), "/chain/items?ids=latest%3Amarket%3A5");
  assert.equal(pollPath({ id: "act_7" }), "/chain/actions/act_7");
  assert.equal(pollPath({ id: "act_7", poll: "feed" }), "/chain/items?ids=act_7");
  assert.equal(pollPath({ id: "act_7", poll: "none" }), null);
  assert.equal(pollPath({ tx: TX }), null);
  const ref = { id: "roll:r1", status: "pending" };
  assert.deepEqual(
    fromPoll(ref, { items: [{ id: "roll:r1", status: "confirmed", tx: TX }] }),
    { id: "roll:r1", status: "confirmed", tx: TX, explorer: undefined, account: undefined },
  );
  assert.equal(fromPoll(ref, { items: [] }), null);
  assert.equal(fromPoll({ id: "act_7" }, { id: "act_7", status: "sent", tx: null }).status, "sent");
});

function memoryStore() {
  const m = new Map();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v), m };
}
const managed = (sent) => ({
  kind: "managed",
  accountId: "alice.qlx.testnet",
  send: async (tx) => {
    sent.push(tx);
    return TX;
  },
});
const quote = (name) => ({
  network: "testnet",
  receiverId: "v1.social08.testnet",
  accountId: "alice.qlx.testnet",
  methodName: "set",
  gas: "80000000000000",
  deposit: "50000000000000000000000",
  profile: {
    schema: "1",
    name,
    avatar_contract: "",
    avatar_token_id: "",
    updated_at: "1793750000000",
    mutation_id: "profile_00000000-0000-0000-0000-000000000000",
  },
  args: {
    data: {
      "alice.qlx.testnet": {
        questlayer: {
          profile: {
            schema: "1",
            name,
            avatar_contract: "",
            avatar_token_id: "",
            updated_at: "1793750000000",
            mutation_id: "profile_00000000-0000-0000-0000-000000000000",
          },
        },
      },
    },
  },
});

test("a new explorer's profile is published once, silently, from the explorer account", async () => {
  const sent = [],
    calls = [],
    storage = memoryStore();
  const call = async (path, data) => {
    calls.push([path, data]);
    if (path.startsWith("/native/profile?"))
      return { status: "unpublished", publishEnabled: true, publishAvatar: null };
    if (path === "/native/profile/prepare") return quote("Alice");
    if (path === "/native/profile/confirm") return { confirmed: true };
  };
  const args = {
    accountId: "alice.qlx.testnet",
    playerId: "p1",
    name: "Alice",
    signer: managed(sent),
    call,
    storage,
    wait: async () => {},
  };
  assert.equal(await autoPublishProfile(args), "published");
  assert.equal(sent.length, 1);
  assert.equal(sent[0].receiverId, "v1.social08.testnet");
  assert.equal(sent[0].actions[0].params.methodName, "set");
  assert.deepEqual(calls[1], [
    "/native/profile/prepare",
    { accountId: "alice.qlx.testnet", publicConsent: true },
  ]);
  assert.ok(storage.m.has(AUTO_PROFILE_PREFIX + "alice.qlx.testnet"));
  assert.equal(await autoPublishProfile(args), "done", "never twice");
  assert.equal(sent.length, 1);
});

test("an existing profile is never overwritten and a wallet signer is refused", async () => {
  const sent = [];
  const call = async () => ({ status: "published", publishEnabled: true });
  const base = {
    accountId: "alice.qlx.testnet",
    playerId: "p1",
    name: "Alice",
    call,
    storage: memoryStore(),
  };
  assert.equal(await autoPublishProfile({ ...base, signer: managed(sent) }), "already");
  assert.equal(sent.length, 0);
  await assert.rejects(
    autoPublishProfile({
      ...base,
      storage: memoryStore(),
      signer: { ...managed(sent), kind: "wallet" },
    }),
  );
  const paused = async () => ({ status: "unpublished", publishEnabled: false });
  const store = memoryStore();
  assert.equal(
    await autoPublishProfile({ ...base, call: paused, storage: store, signer: managed(sent) }),
    "paused",
  );
  assert.equal(store.m.size, 0, "a paused contract is retried on a later visit");
});
