import test from "node:test";
import assert from "node:assert/strict";
import {
  NativeSocialProfile,
  parsePublicProfile,
  SOCIAL_TESTNET,
  SOCIAL_CODE_HASH,
} from "../server/native/social-profile.mjs";
import { assertProfileQuote } from "../src/native-profile-quote.ts";
const owner = "owner.project.testnet",
  nfts = "nfts.project.testnet",
  nonce = "profile_12345678-1234-1234-1234-123456789abc";
function fixture({
  balance = null,
  profile = null,
  tokenOwner = owner,
  codeHash = SOCIAL_CODE_HASH,
  network = "testnet",
} = {}) {
  const collectibles = {
    contractId: nfts,
    view: async (_m, a) => ({ token_id: a.token_id, owner_id: tokenOwner }),
  };
  const reader = new NativeSocialProfile(
    {
      viewNodeStatus: async () => ({ chain_id: network }),
      query: async () => ({ code_hash: codeHash }),
    },
    collectibles,
    { clock: () => 1700000000000 },
  );
  reader.view = async (method) =>
    method === "get"
      ? { [owner]: { questlayer: { profile } } }
      : method === "storage_balance_of"
        ? balance
        : { min: "20000000000000000000000", max: null };
  return reader;
}
test("profile publication uses only its owner's namespace and a currently owned avatar", async () => {
  const quote = await fixture().prepare(owner, "Solo explorer");
  assert.equal(quote.receiverId, SOCIAL_TESTNET);
  assert.equal(quote.network, "testnet");
  assert.equal(quote.methodName, "set");
  assert.equal(quote.deposit, "50000000000000000000000");
  assert.deepEqual(Object.keys(quote.args.data), [owner]);
  assert.deepEqual(Object.keys(quote.args.data[owner]), ["questlayer"]);
  assert.deepEqual(Object.keys(quote.args.data[owner].questlayer), ["profile"]);
  assert.deepEqual(Object.keys(quote.profile).sort(), [
    "avatar_contract",
    "avatar_token_id",
    "mutation_id",
    "name",
    "schema",
    "updated_at",
  ]);
  assert.equal(quote.profile.avatar_contract, nfts);
  assert.equal(quote.profile.avatar_token_id, `avatar:${owner}`);
  assert.equal(quote.profile.name, "Solo explorer");
  assert.equal(quote.profile.updated_at, "1700000000000");
  assert.ok(
    !JSON.stringify(quote).match(
      /latitude|longitude|private_key|balance|inventory|player_id/,
    ),
  );
});
test("existing SocialDB credit reduces attachment to one yocto; transferred avatars are omitted", async () => {
  const quote = await fixture({
    balance: {
      total: "50000000000000000000000",
      available: "10000000000000000000000",
    },
    tokenOwner: "other.testnet",
  }).prepare(owner, "Solo explorer");
  assert.equal(quote.deposit, "1");
  assert.equal(quote.profile.avatar_contract, "");
  assert.equal(quote.profile.avatar_token_id, "");
  const low = await fixture({
    balance: {
      total: "50000000000000000000000",
      available: "9999999999999999999999",
    },
  }).prepare(owner, "Solo explorer");
  assert.equal(low.deposit, "50000000000000000000000");
});
test("profile writes fail closed on a changed contract, wrong network, or invalid alias", async () => {
  await assert.rejects(
    fixture({ codeHash: "unexpected" }).prepare(owner, "Solo explorer"),
    /temporarily unavailable/,
  );
  await assert.rejects(
    fixture({ network: "mainnet" }).prepare(owner, "Solo explorer"),
    /not connected to NEAR testnet/,
  );
  for (const name of ["x", "x".repeat(25), "Explorer\nGPS"])
    await assert.rejects(fixture().prepare(owner, name), /cannot be published/);
  await assert.rejects(
    fixture({ balance: { total: "1", available: "2" } }).read(owner),
    /Invalid public-profile storage/,
  );
});
test("public leaf parsing and fresh confirmation require the exact publication nonce", async () => {
  const profile = {
    schema: { "": "1" },
    name: { "": "Solo explorer" },
    mutation_id: nonce,
    updated_at: "1700000000000",
    avatar_contract: nfts,
    avatar_token_id: `avatar:${owner}`,
  };
  assert.equal(parsePublicProfile(profile).status, "published");
  assert.equal(parsePublicProfile({}).status, "unpublished");
  assert.equal(
    parsePublicProfile({ ...profile, schema: "2" }).status,
    "unsupported",
  );
  assert.equal(
    parsePublicProfile({ ...profile, avatar_token_id: "x".repeat(129) }).status,
    "unsupported",
  );
  const reader = fixture({ profile });
  assert.equal((await reader.confirm(owner, nonce)).confirmed, true);
  assert.equal(
    (await reader.confirm(owner, nonce.replace("abc", "abd"))).confirmed,
    false,
  );
  assert.equal((await reader.read(owner)).avatarVerified, true);
  assert.equal(
    (await fixture({ profile, tokenOwner: "other.testnet" }).read(owner))
      .avatarVerified,
    false,
  );
  await assert.rejects(
    reader.confirm(owner, "invalid"),
    /Invalid profile publication/,
  );
});
test("wallet profile quotes match the exact reviewed alias, avatar and namespace", async () => {
  const quote = await fixture().prepare(owner, "Solo explorer"),
    expected = {
      accountId: owner,
      name: "Solo explorer",
      avatar: { contractId: nfts, tokenId: `avatar:${owner}` },
    };
  assert.doesNotThrow(() => assertProfileQuote(quote, expected));
  assert.throws(
    () => assertProfileQuote(quote, { ...expected, avatar: null }),
    /details changed/,
  );
  const without = await fixture({ tokenOwner: "other.testnet" }).prepare(
    owner,
    "Solo explorer",
  );
  assert.doesNotThrow(() =>
    assertProfileQuote(without, { ...expected, avatar: null }),
  );
});
test("wallet quotes reject alternate scopes, mismatched payloads, extra data and changed attachments", async () => {
  const quote = await fixture().prepare(owner, "Solo explorer"),
    expected = {
      accountId: owner,
      name: "Solo explorer",
      avatar: { contractId: nfts, tokenId: `avatar:${owner}` },
    };
  const changes = [
    (q) => {
      q.network = "mainnet";
    },
    (q) => {
      q.deposit = "1000000000000000000000000";
    },
    (q) => {
      q.receiverId = "other.testnet";
    },
    (q) => {
      q.args.data["other.testnet"] = { questlayer: { profile: q.profile } };
    },
    (q) => {
      q.args.data[owner].profile = { name: "Unreviewed global profile" };
    },
    (q) => {
      q.profile.name = "Another alias";
      q.args.data[owner].questlayer.profile.name = "Another alias";
    },
    (q) => {
      q.profile.gps = "not approved";
      q.args.data[owner].questlayer.profile.gps = "not approved";
    },
    (q) => {
      q.args.data[owner].questlayer.profile.mutation_id =
        "profile_12345678-1234-1234-1234-123456789abc";
    },
  ];
  for (const change of changes) {
    const candidate = JSON.parse(JSON.stringify(quote));
    change(candidate);
    assert.throws(
      () => assertProfileQuote(candidate, expected),
      /details changed/,
    );
  }
});
