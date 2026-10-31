// Prepared protocol rehearsal: fixed project-owned testnet pilot and synthetic GPS.
// Never use this as physical-walk, mobile-wallet or anti-spoofing evidence.
import assert from "node:assert/strict";
import { createPublicKey, verify } from "node:crypto";
import {
  readFileSync,
  writeFileSync,
  existsSync,
  statSync,
  mkdirSync,
  renameSync,
} from "node:fs";
import { Account, KeyPairSigner } from "near-api-js";
import { signMessage } from "near-api-js/nep413";
import { createNearProvider } from "../server/near-provider.mjs";
import { distance } from "../server/domain.mjs";
import { awardMessage } from "../server/native/award-vouchers.mjs";
import {
  nativeLevelClaimId,
  NATIVE_LEVEL_POLICY,
} from "../server/native/progression.mjs";

assert(
  process.argv.includes("--synthetic-gps"),
  "Explicit --synthetic-gps is required; this script never establishes physical presence.",
);
const base = process.env.PROGRESSION_API_URL || "http://127.0.0.1:8787";
const origin = process.env.PROGRESSION_ORIGIN || "http://localhost:5173";
assert(
  ["127.0.0.1", "localhost"].includes(new URL(base).hostname),
  "Use a local QA API; no synthetic GPS is sent to the public game server.",
);
assert(["127.0.0.1", "localhost"].includes(new URL(origin).hostname));
const participant = "questlayer-pilot-20261031.testnet";
const keyPath = ".data/near-operator.json";
assert.equal(
  statSync(keyPath).mode & 0o077,
  0,
  "The project pilot key file must be private.",
);
const operator = JSON.parse(readFileSync(keyPath));
assert.equal(operator.network, "testnet");
const rewards = JSON.parse(readFileSync("public/native-rewards-testnet.json"));
const collectibles = JSON.parse(
  readFileSync("public/native-claims-testnet.json"),
);
assert.equal(rewards.network, "testnet");
assert.equal(collectibles.network, "testnet");
assert.equal(collectibles.version, 3);
for (const account of [
  participant,
  rewards.contractId,
  collectibles.contractId,
])
  assert(account.endsWith(".testnet"));
const provider = createNearProvider();
const network = await provider.viewNodeStatus();
assert.equal(network.chain_id, "testnet");
assert.equal(network.sync_info.syncing, false);
const wallet = new Account(
  participant,
  provider,
  KeyPairSigner.fromSecretKey(operator.secretKey),
);
const keys = await provider.query({
  request_type: "view_access_key_list",
  account_id: participant,
  finality: "final",
});
assert(
  keys.keys.some(
    (entry) =>
      entry.public_key === operator.publicKey &&
      entry.access_key.permission === "FullAccess",
  ),
  "The fixed pilot account is not controlled by this project's key.",
);
const view = async (contractId, method, args = {}) => {
  const result = await provider.query({
    request_type: "call_function",
    account_id: contractId,
    method_name: method,
    args_base64: Buffer.from(JSON.stringify(args)).toString("base64"),
    finality: "final",
  });
  return JSON.parse(Buffer.from(result.result).toString());
};
function codeHash(hex) {
  assert(/^[0-9a-f]{64}$/.test(hex));
  const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  let value = BigInt("0x" + hex),
    out = "";
  while (value > 0n) {
    out = alphabet[Number(value % 58n)] + out;
    value /= 58n;
  }
  for (let i = 0; i < hex.length && hex.slice(i, i + 2) === "00"; i += 2)
    out = "1" + out;
  return out;
}
async function verifyDeployment() {
  for (const [accountId, expected] of [
    [rewards.contractId, rewards.codeHash],
    [collectibles.contractId, codeHash(collectibles.wasmSha256)],
  ]) {
    const account = await provider.query({
      request_type: "view_account",
      account_id: accountId,
      finality: "final",
    });
    assert.equal(
      account.code_hash,
      expected,
      "Only the reviewed native deployment may be used.",
    );
  }
  assert.equal(
    await view(collectibles.contractId, "get_award_signer"),
    collectibles.attestationPublicKey,
    "The deployment attestor changed.",
  );
}
await verifyDeployment();

const journalPath = ".data/native-progression-journal.json";
if (existsSync(journalPath))
  assert.equal(statSync(journalPath).mode & 0o077, 0);
const journal = existsSync(journalPath)
  ? JSON.parse(readFileSync(journalPath))
  : {
      version: 1,
      network: "testnet",
      participant,
      source: rewards.contractId,
      collection: collectibles.contractId,
      createdAt: new Date().toISOString(),
      visits: [],
      transactions: [],
      mintAttempted: false,
    };
assert.equal(journal.version, 1);
assert.equal(journal.network, "testnet");
assert.equal(journal.participant, participant);
assert.equal(journal.source, rewards.contractId);
assert.equal(journal.collection, collectibles.contractId);
function save() {
  const temporary = journalPath + ".tmp";
  writeFileSync(temporary, JSON.stringify(journal, null, 2), { mode: 0o600 });
  renameSync(temporary, journalPath);
}
let cookie;
async function api(path, body) {
  const response = await fetch(base + "/api" + path, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      ...(body === undefined
        ? {}
        : { "Content-Type": "application/json", Origin: origin }),
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(45000),
  });
  const result = await response.json();
  assert.equal(
    response.status,
    200,
    `${path}: ${response.status} ${result.error || ""}`,
  );
  cookie = response.headers.get("set-cookie")?.split(";")[0] || cookie;
  return result;
}
const localSigner = await api("/native/claim-signer");
assert.equal(localSigner.network, "testnet");
assert.equal(localSigner.contractId, collectibles.contractId);
assert.equal(
  localSigner.publicKey,
  collectibles.attestationPublicKey,
  "The QA service must use the existing private award-attestor file, not a newly generated signer.",
);
const challenge = await api("/auth/near/challenge", {
  accountId: participant,
  name: "Native progression QA",
});
assert.equal(challenge.network, "testnet");
assert.equal(challenge.recipient, origin);
assert(challenge.message.includes(participant));
const proof = await signMessage({
  signerAccount: wallet,
  payload: {
    message: challenge.message,
    recipient: challenge.recipient,
    nonce: new Uint8Array(Buffer.from(challenge.nonce, "base64")),
  },
});
await api("/auth/near/verify", {
  challengeId: challenge.challengeId,
  accountId: participant,
  publicKey: proof.publicKey.toString(),
  signature: Buffer.from(proof.signature).toString("base64"),
});
// Resume a possibly accepted request before choosing any different shared coin.
if (journal.pendingVisit) {
  const input = {
    ...journal.pendingVisit,
    fix: { ...journal.pendingVisit.fix, timestamp: Date.now() },
  };
  const accepted = await api("/native/rewards/visit", input);
  const retry = await api("/native/rewards/visit", input);
  assert.equal(retry.id, accepted.id);
  if (!journal.visits.some((entry) => entry.id === accepted.id))
    journal.visits.push({
      id: accepted.id,
      confirmed: accepted.state === "confirmed",
      duplicateReceiptPreserved: true,
    });
  journal.location = { lat: input.fix.lat, lng: input.fix.lng };
  delete journal.pendingVisit;
  save();
}
const snapshot = () => api("/native/progression", { accountId: participant });
let progress = await snapshot();
assert.equal(progress.status, "available");
assert.equal(progress.accountId, participant);
assert(
  BigInt(progress.xp) >= 82n,
  "Prerequisite: the existing project pilot must already have at least 82 confirmed XP. This script adds at most 9 coins.",
);
journal.xpBefore ??= progress.xp;
save();
const pause = async (ms) => {
  for (let left = ms; left > 0; left -= 5000)
    await new Promise((resolve) => setTimeout(resolve, Math.min(left, 5000)));
};

if (BigInt(progress.xp) < 100n) {
  await api("/native/rewards/join", { accountId: participant, consent: true });
  let board = await api(
    "/native/rewards?account=" + participant + "&refresh=1",
  );
  assert.equal(board.status, "ready");
  let location = journal.location || board.day.quests[0]?.targets[0];
  assert(location, "No reviewed native day location is available.");
  // Private journal retains only the last synthetic point for safe pacing on resume.
  while (BigInt(progress.xp) < 100n) {
    if (journal.visits.length && !journal.visits.at(-1).confirmed) {
      for (let attempt = 0; attempt < 36; attempt++) {
        board = await api(
          "/native/rewards?account=" + participant + "&refresh=1",
        );
        const receipt = board.receipts.find(
          (entry) => entry.id === journal.visits.at(-1).id,
        );
        if (receipt?.state === "confirmed") {
          journal.visits.at(-1).confirmed = true;
          save();
          break;
        }
        assert(
          !["failed", "rejected"].includes(receipt?.state),
          "The pilot receipt failed; investigate before more claims.",
        );
        await pause(5000);
      }
      assert(
        journal.visits.at(-1).confirmed,
        "Pending receipt did not finalize; rerun to reconcile before adding a coin.",
      );
    }
    progress = await snapshot();
    assert.equal(progress.status, "available");
    if (BigInt(progress.xp) >= 100n) break;
    assert(
      journal.visits.length < 9,
      "The nine-coin synthetic rehearsal bound was reached.",
    );
    board = await api("/native/rewards/nearby", {
      accountId: participant,
      location,
      fresh: true,
    });
    const coin = board.day.coins[0];
    assert(
      coin,
      "No unclaimed native-backed coin is available near this reviewed location.",
    );
    await pause(
      Math.max(4000, Math.ceil((distance(location, coin) / 8) * 1000) + 1200),
    );
    const input = {
      accountId: participant,
      dayId: board.day.id,
      kind: "coin",
      index: coin.index,
      mode: "gps",
      fix: { lat: coin.lat, lng: coin.lng, accuracy: 5, timestamp: Date.now() },
    };
    journal.pendingVisit = input;
    save();
    const accepted = await api("/native/rewards/visit", input);
    const retry = await api("/native/rewards/visit", input);
    assert.equal(retry.id, accepted.id);
    journal.visits.push({
      id: accepted.id,
      confirmed: accepted.state === "confirmed",
      duplicateReceiptPreserved: true,
    });
    location = journal.location = { lat: coin.lat, lng: coin.lng };
    delete journal.pendingVisit;
    save();
    console.log(
      JSON.stringify({
        syntheticGPS: true,
        acceptedReceipt: accepted.id,
        coinsSubmitted: journal.visits.length,
      }),
    );
  }
}
progress = await snapshot();
assert.equal(progress.status, "available");
assert(BigInt(progress.xp) >= 100n);
const claimId = nativeLevelClaimId(
  rewards.contractId,
  collectibles.contractId,
  participant,
  2,
);
const quoted = await api("/native/progression/claim", {
  accountId: participant,
  level: 2,
});
assert.equal(quoted.claim_id, claimId);
assert.equal(quoted.receiver_id, participant);
assert.equal(quoted.contractId, collectibles.contractId);
assert.equal(quoted.sourceContractId, rewards.contractId);
assert.equal(quoted.network, "testnet");
assert.equal(quoted.policy, NATIVE_LEVEL_POLICY);
assert.equal(quoted.level, 2);
assert.equal(quoted.edition, "polar");
if (quoted.state !== "minted") {
  assert(
    quoted.expires_at > Date.now() &&
      quoted.expires_at <= Date.now() + 15 * 60000,
  );
  const publicKey = createPublicKey({
    key: Buffer.concat([
      Buffer.from("302a300506032b6570032100", "hex"),
      Buffer.from(collectibles.attestationPublicKey, "base64"),
    ]),
    format: "der",
    type: "spki",
  });
  assert(
    verify(
      null,
      Buffer.from(awardMessage(collectibles.contractId, quoted)),
      publicKey,
      Buffer.from(quoted.signature, "base64"),
    ),
    "The local service used a different or invalid attestor.",
  );
  journal.voucher = quoted;
  save();
}
const args = (claim) => ({
  claim_id: claim.claim_id,
  receiver_id: claim.receiver_id,
  edition: claim.edition,
  expires_at_ms: claim.expires_at,
  signature: claim.signature,
});
async function call(label, claim, deposit) {
  assert(deposit === 0n || deposit === 5n * 10n ** 22n);
  const result = await wallet.callFunctionRaw({
    contractId: collectibles.contractId,
    methodName: "redeem_aura",
    args: args(claim),
    deposit,
    gas: 80n * 10n ** 12n,
    waitUntil: "FINAL",
  });
  assert(!result.status?.Failure, label + " failed");
  const transaction =
    result.transaction?.hash || result.transaction_outcome?.id;
  assert(transaction);
  journal.transactions.push({
    label,
    transaction,
    attachedYoctoNEAR: deposit.toString(),
  });
  save();
  return result;
}
let receipt = await view(collectibles.contractId, "get_claim", {
  claim_id: claimId,
});
if (!receipt) {
  assert(
    !journal.mintAttempted,
    "A mint attempt is already journaled. Reconcile its chain result; this script will not attach a second 0.05 test NEAR deposit.",
  );
  assert(journal.voucher);
  await verifyDeployment();
  journal.mintAttempted = true;
  journal.maximumMintDeposit = "50000000000000000000000";
  save();
  await call(
    "Redeem confirmed native level 2 Aura",
    journal.voucher,
    5n * 10n ** 22n,
  );
  receipt = await view(collectibles.contractId, "get_claim", {
    claim_id: claimId,
  });
}
assert.equal(receipt?.receiver_id, participant);
assert.equal(receipt?.edition, "polar");
const confirmed = await api("/native/progression/confirm", {
  accountId: participant,
  level: 2,
});
assert.equal(confirmed.state, "minted");
assert.equal(confirmed.token_id, receipt.token_id);
let replayVerified = journal.replayVerified || false;
if (!replayVerified && journal.voucher) {
  const supplyBefore = await view(collectibles.contractId, "nft_total_supply");
  await call(
    "Replay same level entitlement with zero deposit",
    journal.voucher,
    0n,
  );
  const replay = await view(collectibles.contractId, "get_claim", {
    claim_id: claimId,
  });
  assert.deepEqual(replay, receipt);
  assert.equal(
    await view(collectibles.contractId, "nft_total_supply"),
    supplyBefore,
  );
  journal.replayVerified = replayVerified = true;
  save();
}
const final = await snapshot();
assert.equal(final.milestones[0].state, "minted");
assert.equal(final.milestones[0].tokenId, receipt.token_id);
const ownedToken = await view(collectibles.contractId, "nft_token", {
  token_id: receipt.token_id,
});
assert.equal(
  ownedToken.owner_id,
  participant,
  "The earned token must still belong to this fixed pilot.",
);
let equipment = await view(collectibles.contractId, "get_equipment", {
  account_id: participant,
});
let outfitSourceVerified = false;
if (process.argv.includes("--equip")) {
  if (equipment.above !== receipt.token_id) {
    await verifyDeployment();
    const equipped = await wallet.callFunctionRaw({
      contractId: collectibles.contractId,
      methodName: "equip_aura",
      args: { token_id: receipt.token_id, slot: "above" },
      deposit: 0n,
      gas: 50n * 10n ** 12n,
      waitUntil: "FINAL",
    });
    assert(!equipped.status?.Failure, "Equipping the earned Aura failed.");
    journal.transactions.push({
      label: "Equip earned level Aura above pilot",
      transaction:
        equipped.transaction?.hash || equipped.transaction_outcome?.id,
      attachedYoctoNEAR: "0",
    });
    save();
  }
  equipment = await view(collectibles.contractId, "get_equipment", {
    account_id: participant,
  });
  assert.equal(equipment.above, receipt.token_id);
  const wardrobe = await api("/native/wardrobe?refresh=1");
  const own = wardrobe.accounts.find((a) => a.accountId === participant);
  assert(own?.items.some((item) => item.tokenId === receipt.token_id));
  assert.equal(own.equipment.above, receipt.token_id);
  const outfit = await api("/native/outfit", {
    enabled: true,
    accountId: participant,
  });
  assert.equal(outfit.player.nativeOutfit, true);
  assert.equal(outfit.player.nativeAccount, participant);
  outfitSourceVerified = true;
}
let sessionRecoveryProof = null;
if (process.argv.includes("--recover-session")) {
  const before = await api("/identity/sessions");
  const oldCookie = cookie;
  const recovery = await api("/identity/recovery/challenge", {
    accountId: participant,
  });
  assert.equal(recovery.network, "testnet");
  assert.equal(recovery.purpose, "revoke-other-sessions");
  assert.equal(recovery.recipient, origin);
  const signed = await signMessage({
    signerAccount: wallet,
    payload: {
      message: recovery.message,
      recipient: recovery.recipient,
      nonce: new Uint8Array(Buffer.from(recovery.nonce, "base64")),
    },
  });
  const restored = await api("/identity/recovery/verify", {
    challengeId: recovery.challengeId,
    accountId: participant,
    publicKey: signed.publicKey.toString(),
    signature: Buffer.from(signed.signature).toString("base64"),
  });
  assert.equal(restored.ok, true);
  assert.notEqual(cookie, oldCookie);
  assert.equal(restored.activeSessionCount, 1);
  const old = await fetch(base + "/api/session", {
    headers: { Cookie: oldCookie },
    signal: AbortSignal.timeout(15000),
  });
  assert.equal(
    old.status,
    401,
    "A copied previous browser cookie must no longer authenticate.",
  );
  assert.equal((await snapshot()).accountId, participant);
  sessionRecoveryProof = {
    freshWalletProof: true,
    retainedCookieRotated: true,
    oldCookieRejected: true,
    otherSessionsRevoked: restored.revokedSessions,
    sessionsBefore: before.activeSessionCount,
    sessionsAfter: restored.activeSessionCount,
  };
}
const result = {
  verifiedAt: new Date().toISOString(),
  network: "testnet",
  participant,
  participantControl:
    "Project-controlled developer account; no personal wallet used",
  evidenceMode:
    "Synthetic GPS API rehearsal; no physical walk, mobile wallet approval or anti-spoofing claim",
  sourceContractId: rewards.contractId,
  collectiblesContractId: collectibles.contractId,
  policy: NATIVE_LEVEL_POLICY,
  xpBefore: journal.xpBefore,
  xpAfter: final.xp,
  level: final.level,
  nativeLevel: 2,
  currentOwnerVerified: ownedToken.owner_id === participant,
  equippedAbove: equipment.above === receipt.token_id,
  outfitSourceVerified,
  sessionRecoveryProof,
  claimId,
  tokenId: receipt.token_id,
  originalRecipient: receipt.receiver_id,
  pendingXpUsed: false,
  demoXpUsed: false,
  replayMintedNoAdditionalToken: replayVerified,
  maximumMintDeposit: journal.maximumMintDeposit || "0",
  depositUnit: "yoctoNEAR; gas is separate; unused storage deposit refunds",
  receipts: journal.visits.map(
    ({ id, confirmed, duplicateReceiptPreserved }) => ({
      id,
      confirmed,
      duplicateReceiptPreserved,
    }),
  ),
  transactions: journal.transactions,
  physicalWalkVerified: false,
};
mkdirSync("output/qa/W04-W06-progression", { recursive: true });
writeFileSync(
  "output/qa/W04-W06-progression/native-progression-proof.json",
  JSON.stringify(result, null, 2) + "\n",
);
writeFileSync(
  "public/native-progression-proof.json",
  JSON.stringify(result, null, 2) + "\n",
);
console.log(
  JSON.stringify({
    verified: true,
    xp: final.xp,
    tokenId: receipt.token_id,
    replayVerified,
    physicalWalkVerified: false,
  }),
);
