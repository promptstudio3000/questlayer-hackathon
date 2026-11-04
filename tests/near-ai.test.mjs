import test from "node:test";
import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import {
  DEFAULT_NEAR_AI_MODEL,
  createNearAiVerifier,
  nearAiConfiguration,
  nearAiJson,
  nearAiStatus,
  verifyEd25519,
} from "../server/ai/near-ai.mjs";
import { npcConfiguration, npcProviderFor, createFallbackNpcProvider } from "../server/npc/talk.mjs";
import { guideConfiguration } from "../server/ai/guide.mjs";
import { flavourConfiguration, flavourProvider } from "../server/ai/flavour-batch.mjs";

const sha = (s) => createHash("sha256").update(s).digest("hex");
const KEY = "test-key-never-real";

function keypair() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const raw = publicKey.export({ format: "der", type: "spki" }).subarray(12).toString("hex");
  return { address: raw, sign: (text) => sign(null, Buffer.from(text), privateKey).toString("hex") };
}

// Minimal NEAR AI Cloud stand-in: records calls, answers completions,
// attestation reports and signatures the way the documented API does.
function fakeCloud({ content = '{"say":"Hello there.","factIds":[],"offer":null,"emote":"wave"}', rejectSchema = false, kind = "provider_tee", signer, reportSigner, status = 200 } = {}) {
  const calls = [];
  const completions = new Map();
  const fetcher = async (url, init = {}) => {
    const u = new URL(url);
    calls.push({ path: u.pathname, init, params: Object.fromEntries(u.searchParams) });
    const json = (body, code = 200) => new Response(JSON.stringify(body), { status: code, headers: { "content-type": "application/json" } });
    if (u.pathname === "/v1/chat/completions") {
      if (status !== 200) return json({ error: "down" }, status);
      const body = JSON.parse(init.body);
      if (rejectSchema && body.response_format?.type === "json_schema") return json({ error: "unsupported" }, 400);
      const id = `chatcmpl-${calls.length}`;
      const text = JSON.stringify({ id, choices: [{ finish_reason: "stop", message: { role: "assistant", content } }] });
      completions.set(id, { request: init.body, response: text, model: body.model });
      return new Response(text, { status: 200 });
    }
    if (u.pathname === "/v1/attestation/report") {
      const nonce = u.searchParams.get("nonce");
      return json({
        gateway_attestation: { signing_address: reportSigner ?? signer.address, signing_algo: "ed25519", request_nonce: nonce },
        model_attestations: [{ signing_address: reportSigner ?? signer.address, signing_algo: "ed25519", request_nonce: nonce, intel_quote: "00" }],
      });
    }
    if (u.pathname.startsWith("/v1/signature/")) {
      const c = completions.get(decodeURIComponent(u.pathname.split("/").pop()));
      if (!c) return json({ detail: "not found" }, 404);
      const text = `${kind === "provider_tee" ? `${c.model}:` : ""}${sha(c.request)}:${sha(c.response)}`;
      return json({ text, signature: signer.sign(text), signing_address: signer.address, signing_algo: "ed25519", signature_kind: kind });
    }
    return json({}, 404);
  };
  return { fetcher, calls };
}

test("NEAR AI stays off unless NEAR_AI_ENABLED=1 and a key exist", () => {
  assert.equal(nearAiConfiguration({}).active, false);
  assert.equal(nearAiConfiguration({ NEAR_AI_API_KEY: KEY }).active, false);
  assert.equal(nearAiConfiguration({ NEAR_AI_ENABLED: "1" }).active, false);
  const on = nearAiConfiguration({ NEAR_AI_ENABLED: "1", NEAR_AI_API_KEY: KEY });
  assert.equal(on.active, true);
  assert.equal(on.model, DEFAULT_NEAR_AI_MODEL);
  assert.throws(() => nearAiConfiguration({ NEAR_AI_BASE_URL: "http://evil.example" }), /https/);
  const status = nearAiStatus({ NEAR_AI_ENABLED: "1", NEAR_AI_API_KEY: KEY });
  assert.ok(!JSON.stringify(status).includes(KEY), "health never shows the key");
});

test("NPCs, guide and flavour pick NEAR AI only behind the switch", () => {
  const ollama = { GUIDE_AI_PROVIDER: "ollama", OLLAMA_API_KEY: "o" };
  // Key present but switch off: unchanged Ollama behaviour, even when asked for.
  assert.equal(npcConfiguration({ ...ollama, NEAR_AI_API_KEY: KEY }).provider, "ollama");
  assert.equal(npcConfiguration({ ...ollama, NEAR_AI_API_KEY: KEY, NPC_AI_PROVIDER: "near-ai" }).provider, "ollama");
  assert.equal(guideConfiguration({ NEAR_AI_API_KEY: KEY, NEAR_AI_MODEL: "x" }).provider, "template");
  assert.equal(guideConfiguration({ GUIDE_AI_PROVIDER: "near-ai", NEAR_AI_API_KEY: KEY }).provider, "template");
  assert.equal(flavourProvider(flavourConfiguration({ FLAVOUR_AI_PROVIDER: "near-ai", NEAR_AI_API_KEY: KEY }), { NEAR_AI_API_KEY: KEY }), null);
  // Switch on: NPCs go to NEAR AI first with Ollama as fallback.
  const env = { ...ollama, NEAR_AI_ENABLED: "1", NEAR_AI_API_KEY: KEY };
  const config = npcConfiguration(env);
  assert.equal(config.provider, "near-ai");
  assert.equal(config.ollama.apiKey, "o");
  const provider = npcProviderFor(config);
  assert.equal(provider.name, "near-ai");
  assert.equal(provider.withMeta, true);
  // NPC_AI_PROVIDER=ollama still pins Ollama.
  assert.equal(npcConfiguration({ ...env, NPC_AI_PROVIDER: "ollama" }).provider, "ollama");
  assert.equal(guideConfiguration({ ...env, GUIDE_AI_PROVIDER: "near-ai" }).provider, "near-ai");
});

test("nearAiJson sends the schema, hashes exact bytes and keeps the chat id", async () => {
  const signer = keypair();
  const cloud = fakeCloud({ signer });
  const { value, receipt } = await nearAiJson(
    { apiKey: KEY, fetcher: cloud.fetcher },
    { system: "s", user: "u", schema: { type: "object" } },
  );
  assert.equal(value.say, "Hello there.");
  const call = cloud.calls[0];
  assert.equal(call.path, "/v1/chat/completions");
  assert.equal(call.init.headers["x-no-aliasing"], "true");
  assert.equal(call.init.headers.Authorization, `Bearer ${KEY}`);
  assert.equal(JSON.parse(call.init.body).response_format.type, "json_schema");
  assert.equal(receipt.requestHash, sha(call.init.body));
  assert.match(receipt.chatId, /^chatcmpl-/);
});

test("nearAiJson falls back to json_object when the schema is rejected, and retries prose", async () => {
  const signer = keypair();
  const cloud = fakeCloud({ signer, rejectSchema: true });
  const { value } = await nearAiJson({ apiKey: KEY, fetcher: cloud.fetcher }, { system: "s", user: "u", schema: {} });
  assert.equal(value.emote, "wave");
  assert.equal(JSON.parse(cloud.calls[1].init.body).response_format.type, "json_object");

  const chatty = fakeCloud({ signer, content: "Sure! I think the answer is nice." });
  await assert.rejects(nearAiJson({ apiKey: KEY, fetcher: chatty.fetcher }, { system: "s", user: "u", schema: {} }), /unparseable-json/);
  assert.equal(chatty.calls.length, 2, "one retry in JSON mode");
});

test("verifier accepts an enclave signature over our exact bytes and rejects the rest", async () => {
  const signer = keypair();
  for (const kind of ["provider_tee", "gateway"]) {
    const cloud = fakeCloud({ signer, kind });
    const { receipt } = await nearAiJson({ apiKey: KEY, fetcher: cloud.fetcher }, { system: "s", user: "u", schema: {} });
    const verifier = createNearAiVerifier({ apiKey: KEY, fetcher: cloud.fetcher });
    const v = await verifier.check(receipt);
    assert.equal(v.attested, true, kind);
    assert.equal(v.kind, kind);
    assert.match(v.signatureHash, /^[0-9a-f]{64}$/);
    const report = cloud.calls.find((c) => c.path === "/v1/attestation/report");
    assert.equal(report.params.signing_algo, "ed25519");
    assert.match(report.params.nonce, /^[0-9a-f]{64}$/);
    // Tampered response hash: no match.
    const bad = await verifier.check({ ...receipt, responseHash: sha("other") });
    assert.deepEqual([bad.attested, bad.reason], [false, "hash-mismatch"]);
  }
  // Signer not named by the attestation report.
  const cloud = fakeCloud({ signer, reportSigner: keypair().address });
  const { receipt } = await nearAiJson({ apiKey: KEY, fetcher: cloud.fetcher }, { system: "s", user: "u", schema: {} });
  const v = await createNearAiVerifier({ apiKey: KEY, fetcher: cloud.fetcher }).check(receipt);
  assert.deepEqual([v.attested, v.reason], [false, "signer-not-in-report"]);
  assert.equal(verifyEd25519("x", "00", signer.address), false);
  assert.equal((await createNearAiVerifier({ apiKey: KEY, fetcher: cloud.fetcher }).check({})).reason, "no-chat-id");
});

test("NPC provider falls back to Ollama when NEAR AI is down", async () => {
  const signer = keypair();
  const down = fakeCloud({ signer, status: 503 });
  const config = npcConfiguration({ NEAR_AI_ENABLED: "1", NEAR_AI_API_KEY: KEY, OLLAMA_API_KEY: "o", GUIDE_AI_PROVIDER: "ollama" });
  const near = npcProviderFor({ ...config, ollama: null });
  const persona = { name: "Ráda", voice: "v", backstory: "b" };
  const args = { persona, facts: [], menu: [], memory: [], message: "hi" };
  const original = globalThis.fetch;
  globalThis.fetch = down.fetcher;
  try {
    await assert.rejects(near.reply(args), /provider-unavailable \(503\)/);
  } finally {
    globalThis.fetch = original;
  }
  const fallback = { name: "ollama", model: "m", reply: async () => ({ say: "Hi.", factIds: [], offer: null, emote: "wave" }) };
  const failing = { name: "near-ai", model: "x", withMeta: true, reply: async () => { throw Error("provider-unavailable (503)"); } };
  const res = await createFallbackNpcProvider(failing, fallback).reply(args);
  assert.equal(res.source, "ollama");
  assert.equal(res.output.say, "Hi.");
  assert.equal(res.primaryReason, "provider-unavailable (503)");
});

test("NPC talk on NEAR AI returns a chat id and records the attestation", async (t) => {
  const { openDatabase, createPlayer } = await import("../server/database.mjs");
  const { ensureWorld, HOME, worldView } = await import("../server/world.mjs");
  const { createNpcService } = await import("../server/npc/service.mjs");
  const NOW = Date.parse("2026-11-02T12:00:00Z");
  const db = openDatabase(":memory:");
  t.after(() => db.close());
  const player = createPlayer(db, "Walker", NOW);
  const world = await ensureWorld(db, HOME, true, NOW);
  const receipt = { chatId: "chatcmpl-1", model: "m", requestHash: "a", responseHash: "b" };
  const provider = {
    name: "near-ai",
    model: "m",
    withMeta: true,
    reply: async () => ({ output: { say: "Welcome, walker.", factIds: [], offer: null, emote: "wave" }, source: "near-ai", model: "m", receipt }),
  };
  let done;
  const settled = new Promise((resolve) => (done = resolve));
  const verifier = { check: async (r) => (assert.equal(r, receipt), setImmediate(done), { attested: true, kind: "provider_tee", signatureHash: "f".repeat(64) }) };
  const service = createNpcService(db, {
    env: {},
    config: { provider: "near-ai", perHour: 20, perMinute: 6, dailyCalls: 2000 },
    provider,
    verifier,
    clock: () => NOW,
  });
  const actor = { id: "bela", kind: "npc", archetype: "storyteller", name: "Kronikářka Běla", persona: "kronikarka-bela" };
  const r = await service.talk({ player, actor, world: worldView(db, world.id, player, { now: NOW }), message: "hello" });
  assert.equal(r.source, "near-ai");
  assert.equal(r.verification.chatId, "chatcmpl-1");
  assert.equal(r.verification.status, "pending");
  await settled;
  const row = db.prepare("SELECT provider,attested,signature_hash FROM ai_npc_requests").get();
  assert.deepEqual({ ...row }, { provider: "near-ai", attested: 1, signature_hash: "f".repeat(64) });
});

test("NPC lines lose bracketed id citations", async () => {
  const { stripIdCitations, validateNpcOutput } = await import("../server/npc/talk.mjs");
  assert.equal(stripIdCitations("Go 140 m north. [place-0]", ["place-0"]), "Go 140 m north.");
  assert.equal(stripIdCitations("Walk (offer-0) or listen (offer 1).", []), "Walk or listen.");
  assert.equal(stripIdCitations("Keep (this) and [that].", ["place-0"]), "Keep (this) and [that].");
  const facts = [{ id: "place-0", text: "The square is 140 m away." }];
  const v = validateNpcOutput({ say: "The square is 140 m away (place-0).", factIds: ["place-0"], offer: null, emote: "wave" }, facts, []);
  assert.equal(v.value.say, "The square is 140 m away.");
});
