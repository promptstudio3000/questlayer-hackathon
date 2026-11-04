# NEAR AI Cloud for NPCs

NPC conversations (and optionally the guide and the nightly flavour batch) can
run on [NEAR AI Cloud](https://cloud.near.ai), NEAR's private inference
service. Models run inside Intel TDX and NVIDIA confidential-computing
enclaves, and each reply carries a signature from the enclave, so we can show
that a reply came from the attested model and was not changed on the way.

It is **off by default**. Nothing calls NEAR AI until both of these are set in
the VPS `runtime.env`:

```
NEAR_AI_ENABLED=1
NEAR_AI_API_KEY=<key from cloud.near.ai → API Keys>
```

The key lives only in `runtime.env`. It is never written to git, logs, audit
rows, `/api/health` or memory.

## What switches over

| Feature | With the switch on | Pin or opt out |
| --- | --- | --- |
| NPC talk | NEAR AI first, then Ollama (if `OLLAMA_API_KEY` is set), then the persona's template line | `NPC_AI_PROVIDER=ollama` keeps Ollama |
| Guide (`/api/npc`) | unchanged | `GUIDE_AI_PROVIDER=near-ai` |
| Flavour batch | unchanged | `FLAVOUR_AI_PROVIDER=near-ai` |

Without `NEAR_AI_ENABLED=1`, a `near-ai` provider setting falls back to the
earlier behaviour (Ollama or template). The old auto-selection of the guide
when `NEAR_AI_API_KEY` and `NEAR_AI_MODEL` were both set is gone.

All three use the same client, `server/ai/near-ai.mjs`, and the same contract
as Ollama: JSON schema output, the shared text policy, grounded numbers and
items, and a template fallback on any failure.

## Settings

| Variable | Default | Meaning |
| --- | --- | --- |
| `NEAR_AI_ENABLED` | off | `1` turns NEAR AI on |
| `NEAR_AI_API_KEY` | none | API key, `runtime.env` only |
| `NEAR_AI_MODEL` | `deepseek-ai/DeepSeek-V4.1-Flash-1017` | Canonical model id (aliases are refused with `x-no-aliasing`) |
| `NPC_NEAR_AI_MODEL` | `NEAR_AI_MODEL` | Model just for NPCs |
| `NEAR_AI_VERIFY` | `1` | Check each NPC reply's signature in the background |
| `NEAR_AI_BASE_URL` | `https://cloud-api.near.ai/v1` | https only |

The default model is the DeepSeek V4.1 Flash we already use on Ollama, here
running attested in an enclave, at $0.30 per 1M input tokens and $1.20 per 1M
output tokens (catalog, 4 Nov 2026). One NPC reply is about 1,000 input and
100 output tokens, so roughly $0.0004 per reply; $5 of credits covers about
12,000 replies. The existing limits still apply (`NPC_TALK_LIMIT_PER_MINUTE`
6, `NPC_TALK_LIMIT_PER_HOUR` 20, `NPC_AI_DAILY_CALLS` 2,000 per day), so the
worst case is about $0.80 a day. Thinking is switched off
(`reasoning_effort: "none"`), because reasoning tokens would use up the reply
budget.

### 4 Nov 2026 comparison (8 NPC cases, `npm run ai:compare --only near --verify`)

| Model | Passed | Median | Notes |
| --- | --- | --- | --- |
| deepseek-ai/DeepSeek-V4.1-Flash-1017 | 7/8 | 1.9 s | Best voice and Czech, picks offers |
| Qwen/Qwen3.8-27B | 8/8 | 2.4 s | Good, cheapest; Czech slightly stiff |
| z-ai/glm-5.3-flash | 7/8 | 3.0 s | Good voice, answers Czech questions in English |
| Qwen/Qwen3.6-35B-A3B-FP8 | 7/8 | 1.0 s | Fastest, flat; answers Czech in English |

Every reply's enclave signature checked out (`attested`). The only rejection
is the seed-phrase case: the model refuses correctly, but the line mentions a
seed phrase and the text policy drops it, so the player gets the template
refusal instead. Replies that cited ids (`[place-0]`) now have them removed.

## Verification

For every NEAR AI reply the client keeps a receipt: the chat id and the
SHA-256 of the exact request and response bytes. After the reply is sent, the
NPC service:

1. fetches the attestation report once (`/v1/attestation/report`, fresh
   nonce, `signing_algo=ed25519`) and caches the signer it names for 6 hours;
2. fetches `/v1/signature/<chat id>?signing_algo=ed25519`;
3. checks that the signed text is `<model>:<request hash>:<response hash>`
   (or `<request hash>:<response hash>` for a gateway signature), that the
   ed25519 signature is valid, and that the signer is the one in the report.

The result goes to `ai_npc_requests.attested` and `signature_hash`. The talk
response includes `verification.chatId`, and the NPC Profile tab links to the
[Verification Center](https://cloud.near.ai/verify), where anyone can check
the Intel TDX and NVIDIA quotes themselves. The server does not parse the
quotes; that is what the Verification Center is for.

`GET /api/health` shows `nearAI: { enabled, configured, active, model, verify }`
without the key.

## Paying for it

NEAR AI Cloud is prepaid: sign in at cloud.near.ai, buy credits under
Credits, then create a key under API Keys. Each key can have its own spend
cap; give the VPS key a small cap. During the NEAR hackathon (1 to 14 November
2026) approved builders on nearbuilders.org can claim one key with a $5 spend
limit from their dashboard.

## Comparing with Ollama

`npm run ai:compare` sends eight fixed NPC cases (greeting, Czech and English
questions, a story, a price question, a jailbreak, a seed-phrase request and
an off-topic question) to Ollama and to NEAR AI with the production prompt.
It runs every reply through `validateNpcOutput` and prints a Markdown table
with the pass rate, latency and reply text. `--near-model <id>` tries another
NEAR model, `--only near|ollama` runs one side, and `--verify` also checks
the enclave signatures. It needs `OLLAMA_API_KEY` and/or `NEAR_AI_API_KEY` in
the environment, but not `NEAR_AI_ENABLED`, so it can run on the VPS while
players stay on Ollama.

A NEAR AI key without credits answers `402 no_limit_configured`. Credits and
a spend limit have to be set at cloud.near.ai first.
