// Ollama (local or Ollama Cloud) chat client for structured JSON output.
// The key comes from the environment only and is never logged or returned.
export const DEFAULT_OLLAMA_URL = "https://ollama.com";
// Fast recent cloud model with reliable JSON-schema output and good Czech.
export const DEFAULT_OLLAMA_MODEL = "deepseek-v4.1-flash";

export function ollamaConfiguration(env = process.env) {
  const baseUrl = (env.OLLAMA_BASE_URL || DEFAULT_OLLAMA_URL).trim().replace(/\/+$/, "");
  const url = new URL(baseUrl);
  if (url.protocol !== "https:" && !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))
    throw Error("OLLAMA_BASE_URL must use https (or point at localhost).");
  return {
    baseUrl,
    model: (env.OLLAMA_MODEL || DEFAULT_OLLAMA_MODEL).trim(),
    apiKey: env.OLLAMA_API_KEY || "",
  };
}

// Sends one system + user message and returns the parsed JSON object.
export async function ollamaJson(
  { baseUrl, model, apiKey, fetcher = fetch, timeoutMs = 45_000 },
  { system, user, schema },
) {
  const response = await fetcher(`${baseUrl}/api/chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
    },
    body: JSON.stringify({
      model,
      stream: false,
      format: schema,
      options: { temperature: 0.4 },
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) throw Error(`provider-unavailable (${response.status})`);
  const body = await response.json();
  if (body.done_reason === "length") throw Error("provider-truncated");
  return JSON.parse(String(body.message?.content ?? ""));
}
