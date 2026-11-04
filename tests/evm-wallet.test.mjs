import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import {
  evmKeyInfo,
  signInMessage,
  verifyEvmSignature,
  EVM_STATEMENT,
} from "../server/identity/evm.mjs";
import {
  auraTokenDiff,
  erc191Payload,
  erc191Prehash,
  intentsOf,
  intentEnvelope,
  signedErc191Intent,
  verifyIntentLocally,
  versionedNonce,
} from "../server/native/intents.mjs";
import { openDatabase, createPlayer } from "../server/database.mjs";
import { recordSchemaVersions, preflightDatabase } from "../server/schema-compatibility.mjs";
import { initializeIdentity } from "../server/identity/schema.mjs";

const verifier = "intents.questlayer-dev-20261101.testnet",
  nftContract = "nfts.questlayer-dev-20261101.testnet",
  wnear = "wrap.testnet",
  now = Date.parse("2026-11-04T13:00:00Z");

test("the verifier's own ERC-191 test vector recovers with our prehash", () => {
  // crates/signatures/erc191/src/lib.rs, near/intents 16d04f6
  const sig = Buffer.from(
    "7800a70d05cde2c49ed546a6ce887ce6027c2c268c0285f6efef0cdfc4366b23643790f67a86468ee8301ed12cfffcb07c6530f90a9327ec057800fabd332e4701",
    "hex",
  );
  const point = secp256k1.Signature.fromBytes(sig.subarray(0, 64), "compact")
    .addRecoveryBit(sig[64])
    .recoverPublicKey(erc191Prehash("Hello world!"));
  assert.equal(
    Buffer.from(point.toBytes(false)).subarray(1).toString("hex"),
    "85a66984273f338ce4ef7b85e5430b008307e8591bb7c1b980852cf6423770b801f41e9438155eb53a5e20f748640093bb42ae3aeca035f7b7fd7a1a21f22f68",
  );
});

test("SIWE sign-in recovers the address and the intents key of a MetaMask-style signature", async () => {
  const account = privateKeyToAccount(generatePrivateKey());
  const message = signInMessage({
    origin: "https://questlayer.promptstudio3000.com",
    address: account.address.toLowerCase(),
    chainId: 1,
    nonce: "a1b2c3d4e5f60718",
    issuedAt: now,
    expiresAt: now + 300_000,
  });
  assert.match(message, /^questlayer\.promptstudio3000\.com wants you to sign in with your Ethereum account:\n0x/);
  assert.ok(message.includes(EVM_STATEMENT));
  assert.ok(message.includes(account.address)); // checksummed, as EIP-4361 requires
  const signature = await account.signMessage({ message });
  const info = await verifyEvmSignature({ message, signature, address: account.address });
  assert.equal(info.address, account.address.toLowerCase());
  assert.deepEqual(info, evmKeyInfo(account.publicKey));
  assert.match(info.intentsPublicKey, /^secp256k1:[1-9A-HJ-NP-Za-km-z]{80,90}$/);
  const other = privateKeyToAccount(generatePrivateKey());
  await assert.rejects(
    verifyEvmSignature({ message, signature: await other.signMessage({ message }), address: account.address }),
    /does not match/,
  );
  await assert.rejects(verifyEvmSignature({ message, signature: "0x12", address: account.address }), /invalid signature/);
});

test("an Ethereum wallet signs an ERC-191 intent the verifier format accepts", async () => {
  const account = privateKeyToAccount(generatePrivateKey());
  const deadlineMs = now + 3600_000;
  const nonce = versionedNonce({ salt: "a1b2c3d4", deadlineMs });
  const intent = auraTokenDiff({ side: "sell", nftContract, tokenId: "aura:polar:1", price: (10n ** 22n).toString(), wnear });
  const payload = erc191Payload({ signerId: "alice.factory.testnet", verifier, deadlineMs, nonce, intents: [intent] });
  assert.equal(
    Object.keys(JSON.parse(payload)).join(","),
    "signer_id,verifying_contract,deadline,nonce,intents",
  );
  const signed = signedErc191Intent({ payload, signature: await account.signMessage({ message: payload }) });
  assert.equal(signed.standard, "erc191");
  assert.match(signed.signature, /^secp256k1:/);
  const body = verifyIntentLocally(signed, { verifier, nowMs: now });
  assert.equal(body.signerId, "alice.factory.testnet");
  assert.equal(body.publicKey, evmKeyInfo(account.publicKey).intentsPublicKey);
  assert.equal(body.salt, "a1b2c3d4");
  assert.deepEqual(intentsOf(signed), [intent]);
  assert.equal(intentEnvelope(signed).nonce, Buffer.from(nonce).toString("base64"));
  // A changed payload recovers some other key, which the verifier has not registered.
  const tampered = { ...signed, payload: payload.replace("10000000000000000000000", "1") };
  assert.notEqual(verifyIntentLocally(tampered, { verifier, nowMs: now }).publicKey, body.publicKey);
  assert.throws(() => verifyIntentLocally(signed, { verifier: "intents.near", nowMs: now }), /another verifier/);
  assert.throws(() => verifyIntentLocally(signed, { verifier, nowMs: deadlineMs + 1 }), /expired/);
  assert.throws(() => verifyIntentLocally({ ...signed, extra: 1 }, { verifier, nowMs: now }), /Unexpected/);
});

test("identity schema v1 upgrades in place so Ethereum sessions can be recorded", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "questlayer-evm-schema-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const known = JSON.parse(readFileSync(new URL("../server/schema-known.json", import.meta.url), "utf8"));
  const v1 = known.optional.find((m) => m.name === "identity" && m.version === 1);
  const path = join(dir, "db.sqlite");
  const db = openDatabase(path);
  db.exec(Object.values(v1.tables).join(";"));
  db.exec(Object.values(v1.indexes).join(";"));
  recordSchemaVersions(db);
  const player = createPlayer(db, "Explorer");
  db.prepare("INSERT INTO sessions(token_hash,player_id,expires_at) VALUES('h',?,?)").run(player, now + 1e9);
  db.prepare("INSERT INTO identity_sessions VALUES('h','s1','guest',NULL,1,1,NULL)").run();
  initializeIdentity(db);
  db.prepare("INSERT INTO sessions(token_hash,player_id,expires_at) VALUES('e',?,?)").run(player, now + 1e9);
  db.prepare("INSERT INTO identity_sessions VALUES('e','s2','evm-wallet','0xabc',1,1,1)").run();
  assert.equal(db.prepare("SELECT COUNT(*) n FROM identity_sessions").get().n, 2);
  db.close();
  const status = preflightDatabase(path);
  assert.ok(status.modules.some((m) => m.name === "identity" && m.version === 2));
  assert.ok(status.modules.some((m) => m.name === "evm-identity" && m.version === 1));
});

