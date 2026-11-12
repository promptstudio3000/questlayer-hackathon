// NEAR AI Cloud client (OpenAI-compatible, private inference in Intel TDX +
// NVIDIA confidential-computing enclaves). Off unless NEAR_AI_ENABLED=1 and
// NEAR_AI_API_KEY is set; the key comes from the environment only and is
// never logged, stored or returned.
//
// Every completion keeps a receipt: the SHA-256 of the exact request and
// response bytes plus the chat id. verifyNearAiReceipt() fetches the
// per-response signature (ed25519), checks it covers exactly those bytes and
// that the signer is the one the enclave attestation report names
// (docs/NEAR-AI-CLOUD.md). The TDX/GPU quotes themselves are checked in the
// NEAR AI Verification Center, not here.
import { createHash, createPublicKey, randomBytes, verify } from "node:crypto";
import { extractJsonObject, ProviderOutputError } from "./json-output.mjs";

export const DEFAULT_NEAR_AI_URL = "https://cloud-api.near.ai/v1";
// Attested, $0.30 in / $1.20 out per
// 1M tokens (Nov 2026). Best Czech and in-character voice in the 4 Nov
// comparison (docs/NEAR-AI-CLOUD.md).
export const DEFAULT_NEAR_AI_MODEL = "deepseek-ai/DeepSeek-V4.1-Flash-1017";
export const NEAR_AI_VERIFY_URL = "https://cloud.near.ai/verify";
const REPORT_TTL_MS = 6 * 60 * 60 * 1000;

const sha256 = (data) => createHash("sha256").update(data).digest("hex");

/**
 * Provider name from an *_AI_PROVIDER setting. Ollama was removed on
 * 11 Nov 2026 (owner: NEAR AI only); a server env that still says "ollama"
 * runs on NEAR AI instead of failing to start.
 */
export function aiProviderName(value) {
  const name = String(value || "").trim();
  return name === "ollama" ? "near-ai" : name;
}

export function nearAiConfiguration(env = process.env) {
  const enabled = (env.NEAR_AI_ENABLED || "").trim() === "1";
  const baseUrl = (env.NEAR_AI_BASE_URL || DEFAULT_NEAR_AI_URL).trim().replace(/\/+$/, "");
  const url = new URL(baseUrl);
  if (url.protocol !== "https:" && !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))
    throw Error("NEAR_AI_BASE_URL must use https (or point at localhost).");
  const verifyFlag = (env.NEAR_AI_VERIFY || "1").trim();
  if (!["0", "1"].includes(verifyFlag)) throw Error("NEAR_AI_VERIFY must be 0 or 1.");
  const apiKey = env.NEAR_AI_API_KEY || "";
  return {
    enabled,
    // Usable only when switched on AND a key exists.
    active: enabled && !!apiKey,
    baseUrl,
    model: (env.NEAR_AI_MODEL || DEFAULT_NEAR_AI_MODEL).trim(),
    apiKey,
    verify: verifyFlag === "1",
  };
}

/** Health view without the key. */
export function nearAiStatus(env = process.env) {
  const c = nearAiConfiguration(env);
  return { enabled: c.enabled, configured: !!c.apiKey, active: c.active, model: c.model, verify: c.verify };
}

const headers = (apiKey) => ({
  "Content-Type": "application/json",
  Accept: "application/json",
  // The signature covers the uncompressed body, so ask for none.
  "Accept-Encoding": "identity",
  // Fail instead of being silently routed to another model id; the model id
  // is part of the signed text.
  "x-no-aliasing": "true",
  Authorization: `Bearer ${apiKey}`,
});

async function complete({ baseUrl, model, apiKey, fetcher, timeoutMs }, body) {
  const requestBody = JSON.stringify({ model, ...body });
  const response = await fetcher(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: headers(apiKey),
    body: requestBody,
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) {
    const error = Error(`provider-unavailable (${response.status})`);
    error.status = response.status;
    throw error;
  }
  const responseBody = await response.text();
  let json;
  try {
    json = JSON.parse(responseBody);
  } catch {
    throw new ProviderOutputError("unparseable-response");
  }
  const choice = json.choices?.[0];
  if (choice?.finish_reason === "length") throw new ProviderOutputError("truncated");
  return {
    content: choice?.message?.content,
    receipt: {
      chatId: typeof json.id === "string" ? json.id : null,
      model,
      requestHash: sha256(requestBody),
      responseHash: sha256(responseBody),
    },
  };
}

// One system + user message, returns { value, receipt }. First try uses the
// JSON schema as response_format (json_object when the model rejects that);
// if the content is not one JSON object, one retry in json_object mode with
// the schema spelled out in the prompt.
export async function nearAiJson(
  { baseUrl = DEFAULT_NEAR_AI_URL, model = DEFAULT_NEAR_AI_MODEL, apiKey, fetcher = fetch, timeoutMs = 20_000 },
  { system, user, schema, maxTokens = 600, temperature = 0.3, name = "reply" },
) {
  const connection = { baseUrl, model, apiKey, fetcher, timeoutMs };
  const messages = [
    { role: "system", content: system },
    { role: "user", content: user },
  ];
  // Thinking off: NPC lines are short and reasoning tokens would eat the
  // max_tokens budget (Qwen3.6 truncates otherwise).
  const common = { max_tokens: maxTokens, temperature, reasoning_effort: "none", messages };
  let first;
  try {
    first = await complete(connection, {
      ...common,
      response_format: { type: "json_schema", json_schema: { name, strict: false, schema } },
    });
  } catch (error) {
    if (error.status !== 400) throw error;
    first = await complete(connection, { ...common, response_format: { type: "json_object" } });
  }
  try {
    return { value: extractJsonObject(first.content), receipt: first.receipt };
  } catch (error) {
    if (!(error instanceof ProviderOutputError)) throw error;
  }
  const retry = await complete(connection, {
    ...common,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: `${system}\n\nReply with one JSON object only, no prose and no code fences, matching this JSON schema:\n${JSON.stringify(schema)}`,
      },
      { role: "user", content: user },
    ],
  });
  return { value: extractJsonObject(retry.content), receipt: retry.receipt };
}

// Raw 32-byte ed25519 public key (hex) as a KeyObject.
function ed25519Key(hex) {
  const raw = Buffer.from(String(hex).replace(/^0x/, ""), "hex");
  if (raw.length !== 32) throw Error("bad-key");
  return createPublicKey({ key: Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), raw]), format: "der", type: "spki" });
}

export function verifyEd25519(text, signatureHex, publicKeyHex) {
  try {
    const signature = Buffer.from(String(signatureHex).replace(/^0x/, ""), "hex");
    if (signature.length !== 64) return false;
    return verify(null, Buffer.from(text, "utf8"), ed25519Key(publicKeyHex), signature);
  } catch {
    return false;
  }
}

const lower = (s) => String(s || "").toLowerCase().replace(/^0x/, "");

/**
 * Attestation-report cache: signer identities the enclave reports name, per
 * model. Fetched with a fresh nonce before the first verified completion and
 * refreshed every few hours.
 */
export function createNearAiVerifier({ baseUrl = DEFAULT_NEAR_AI_URL, apiKey, fetcher = fetch, clock = Date.now, timeoutMs = 8_000 }) {
  const reports = new Map();
  async function getJson(path, params) {
    const url = new URL(`${baseUrl}${path}`);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    const r = await fetcher(url, { headers: headers(apiKey), signal: AbortSignal.timeout(timeoutMs) });
    if (!r.ok) {
      const error = Error(`verify-unavailable (${r.status})`);
      error.status = r.status;
      throw error;
    }
    const j = await r.json();
    if (j && j.error_code) throw Error("verify-unavailable");
    return j;
  }

  async function signers(model) {
    const cached = reports.get(model);
    if (cached && clock() - cached.at < REPORT_TTL_MS) return cached;
    const nonce = randomBytes(32).toString("hex");
    const report = await getJson("/attestation/report", {
      model,
      provider: "near",
      include_tls_fingerprint: "false",
      signing_algo: "ed25519",
      nonce,
    });
    const models = (Array.isArray(report.model_attestations) ? report.model_attestations : [])
      .filter((a) => a && lower(a.request_nonce) === nonce && a.signing_algo === "ed25519" && a.signing_address)
      .map((a) => lower(a.signing_address));
    const gw = report.gateway_attestation;
    const gateway =
      gw && gw.signing_algo === "ed25519" && gw.signing_address && (!gw.request_nonce || lower(gw.request_nonce) === nonce)
        ? lower(gw.signing_address)
        : null;
    const entry = { at: clock(), models, gateway };
    reports.set(model, entry);
    return entry;
  }

  // Returns { attested, kind, signatureHash, reason }. Never throws.
  async function check(receipt) {
    if (!receipt?.chatId) return { attested: false, reason: "no-chat-id" };
    try {
      const known = await signers(receipt.model);
      let sig;
      for (let attempt = 0; attempt < 3 && !sig; attempt++) {
        try {
          sig = await getJson(`/signature/${encodeURIComponent(receipt.chatId)}`, { model: receipt.model, signing_algo: "ed25519" });
        } catch (error) {
          if (error.status !== 404 || attempt === 2) throw error;
          await new Promise((resolve) => setTimeout(resolve, 400 * (attempt + 1)));
        }
      }
      if (sig.signing_algo && sig.signing_algo !== "ed25519") return { attested: false, reason: "signing-algo" };
      const kind = sig.signature_kind === "gateway" ? "gateway" : sig.signature_kind === "provider_tee" ? "provider_tee" : null;
      if (!kind) return { attested: false, reason: "signature-kind" };
      const expected =
        kind === "provider_tee"
          ? `${receipt.model}:${receipt.requestHash}:${receipt.responseHash}`
          : `${receipt.requestHash}:${receipt.responseHash}`;
      const signatureHash = sha256(String(sig.signature || ""));
      if (sig.text !== expected) return { attested: false, kind, signatureHash, reason: "hash-mismatch" };
      if (!verifyEd25519(sig.text, sig.signature, sig.signing_address))
        return { attested: false, kind, signatureHash, reason: "bad-signature" };
      const signer = lower(sig.signing_address);
      // provider_tee: exactly one model report with this signer.
      const matched =
        kind === "provider_tee" ? known.models.filter((s) => s === signer).length === 1 : known.gateway === signer;
      return matched
        ? { attested: true, kind, signatureHash }
        : { attested: false, kind, signatureHash, reason: "signer-not-in-report" };
    } catch (error) {
      return { attested: false, reason: /^verify-unavailable/.test(error.message || "") ? "verify-unavailable" : "verify-failed" };
    }
  }

  return { check };
}
