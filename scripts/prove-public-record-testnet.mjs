// Proves a public note record end to end against a locally running API with
// the relayer configured (testnet only): guest session → device key → sponsored
// sub-account → app note made public → NEAR Social `set` relayed from the
// player's own account → confirmed by reading the chain back. Writes a public
// proof with hashes; no key leaves the process.
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { createDeviceKey, bindAccount, memoryKeyStore, signDelegate } from "../src/player-key.ts";

const args = process.argv.slice(2);
const base = args[args.indexOf("--api") + 1] || process.env.QUESTLAYER_API_URL || "http://127.0.0.1:8787";
const origin = process.env.QUESTLAYER_ORIGIN || "http://localhost:5173";
assert(["127.0.0.1", "localhost"].includes(new URL(base).hostname), "Run this against a local API.");
let cookie = "";
async function api(path, data, method) {
  const r = await fetch(`${base}/api${path}`, {
    method: method || (data === undefined ? "GET" : "POST"),
    headers: { Origin: origin, ...(cookie ? { Cookie: cookie } : {}), ...(data === undefined ? {} : { "Content-Type": "application/json" }) },
    body: data === undefined ? undefined : JSON.stringify(data),
  });
  const set = r.headers.get("set-cookie");
  if (set) cookie = set.split(";")[0];
  const body = await r.json();
  if (!r.ok) throw new Error(`${path}: ${r.status} ${body.code || ""} ${body.error || ""}`);
  return body;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const proof = { network: "testnet", startedAt: new Date().toISOString(), steps: [] };
const step = (label, data) => { proof.steps.push({ label, ...data }); console.log(JSON.stringify({ step: label, ...data })); };

const health = await api("/health");
assert.notEqual(health.relayer?.status, "not-configured", "The API has no relayer configured.");
assert.ok(health.socialRecords?.contractId, "The API has no public records module.");
const session = await api("/session", { name: `Record ${Date.now().toString(36)}` });
step("guest session", { playerId: session.player.id });
const store = memoryKeyStore();
const key = await createDeviceKey(store);
let account = (await api("/account/create", { publicKey: key.publicKey })).account;
for (let i = 0; i < 90 && account.state === "creating"; i++) { await sleep(2000); account = (await api("/account")).account; }
assert.equal(account.state, "ready", `account state ${account.state}: ${account.error || ""}`);
await bindAccount(store, account.accountId);
const bound = { ...key, accountId: account.accountId };
step("account ready", { accountId: account.accountId, transactionHash: account.transactionHash });

const note = await api("/messages", {
  clientId: `proof-${Date.now().toString(36)}`,
  text: "Proof note: the river bench near the bridge has the best view of the old town.",
  lat: 49.7475, lng: 13.3776, arena: true, shareGps: false, publicConsent: true,
});
step("note public in the app", { noteId: note.id, state: note.state });

const quote = await api("/native/records/prepare", { noteId: note.id, publicConsent: true, permanenceAcknowledged: true });
assert.equal(quote.receiverId, health.socialRecords.contractId);
step("record quoted", { receiverId: quote.receiverId, deposit: quote.deposit, mutationId: quote.record.mutation_id, image: quote.record.image });

const prepared = await api("/relay/prepare", { accountId: account.accountId, receiverId: quote.receiverId, methodName: "set", publicKey: key.publicKey });
const call = { methodName: "set", args: quote.args, gas: quote.gas, deposit: quote.deposit };
const signed = await signDelegate(bound, { senderId: account.accountId, receiverId: quote.receiverId, call, nonce: prepared.nonce, maxBlockHeight: prepared.maxBlockHeight });
let job = await api("/relay", { signedDelegateBase64: signed.signedDelegateBase64, preview: { receiverId: quote.receiverId, methodName: "set", gas: quote.gas, deposit: quote.deposit } });
for (let i = 0; i < 60 && !["confirmed", "failed"].includes(job.state); i++) { await sleep(2000); job = await api(`/relay/${encodeURIComponent(job.id)}`); }
assert.equal(job.state, "confirmed", `set: ${job.errorCode || ""} ${job.error || ""}`);
step("record relayed without a wallet", { transactionHash: job.transactionHash });

let confirmed = await api("/native/records/confirm", { noteId: note.id, mutationId: quote.record.mutation_id });
for (let i = 0; i < 10 && !confirmed.confirmed; i++) { await sleep(2000); confirmed = await api("/native/records/confirm", { noteId: note.id, mutationId: quote.record.mutation_id }); }
assert.equal(confirmed.confirmed, true, "The chain record does not match the quote.");
const status = await api(`/native/records?note=${encodeURIComponent(note.id)}`);
step("record confirmed from chain", { state: status.chain.state, mutationId: status.chain.mutation_id, anchor: status.chain.anchor, publications: status.publications.map((p) => p.state) });
proof.finishedAt = new Date().toISOString();
proof.accountId = account.accountId;
proof.noteId = note.id;
proof.socialContract = quote.receiverId;
proof.recordKey = `${account.accountId}/questlayer/notes/${note.id}`;
writeFileSync("public/native-public-record-proof.json", JSON.stringify(proof, null, 2) + "\n");
console.log("Proof written to public/native-public-record-proof.json");
