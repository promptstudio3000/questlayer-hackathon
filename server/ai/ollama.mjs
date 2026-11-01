// Ollama (local or Ollama Cloud) chat client for structured JSON output.
// The key comes from the environment only and is never logged or returned.
export const DEFAULT_OLLAMA_URL = "https://ollama.com";
// Fast recent cloud model; the parser below tolerates fenced or chatty JSON.
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

export class ProviderOutputError extends Error {
  constructor(reason, sample) {
    super(reason);
    this.reason = reason;
    if (sample !== undefined) this.sample = String(sample).slice(0, 2000);
  }
}

// Extracts one JSON object from model text: plain JSON, a fenced ```json
// block, or the first balanced {...} inside surrounding prose.
export function extractJsonObject(text) {
  const raw = String(text ?? "").trim();
  if (!raw) throw new ProviderOutputError("empty-content");
  const candidates = [raw];
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) candidates.push(fenced[1].trim());
  const start = raw.indexOf("{");
  if (start !== -1) {
    let depth = 0,
      inString = false,
      escaped = false;
    for (let i = start; i < raw.length; i++) {
      const c = raw[i];
      if (inString) {
        if (escaped) escaped = false;
        else if (c === "\\") escaped = true;
        else if (c === '"') inString = false;
      } else if (c === '"') inString = true;
      else if (c === "{") depth++;
      else if (c === "}" && --depth === 0) {
        candidates.push(raw.slice(start, i + 1));
        break;
      }
    }
  }
  for (const candidate of candidates) {
    try {
      const value = JSON.parse(candidate);
      if (value && typeof value === "object" && !Array.isArray(value)) return value;
    } catch {
      // try the next candidate
    }
  }
  throw new ProviderOutputError("unparseable-json", raw);
}

async function chat({ baseUrl, model, apiKey, fetcher, timeoutMs }, body) {
  const response = await fetcher(`${baseUrl}/api/chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
    },
    body: JSON.stringify({ model, stream: false, ...body }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) {
    const error = Error(`provider-unavailable (${response.status})`);
    error.status = response.status;
    throw error;
  }
  return response.json();
}

// Sends one system + user message and returns the parsed JSON object.
// First try: the JSON schema as Ollama's structured-output format, thinking
// off (repeated without the think flag for models that reject it). If that
// yields no parseable object, one retry in plain JSON mode with the schema
// spelled out in the prompt.
export async function ollamaJson(
  { baseUrl, model, apiKey, fetcher = fetch, timeoutMs = 45_000 },
  { system, user, schema },
) {
  const connection = { baseUrl, model, apiKey, fetcher, timeoutMs };
  const messages = [
    { role: "system", content: system },
    { role: "user", content: user },
  ];
  const options = { temperature: 0.3 };
  const read = (body) => {
    if (body.done_reason === "length") throw new ProviderOutputError("truncated");
    return extractJsonObject(body.message?.content);
  };
  let first;
  try {
    first = await chat(connection, { format: schema, think: false, options, messages });
  } catch (error) {
    if (error.status !== 400) throw error;
    first = await chat(connection, { format: schema, options, messages });
  }
  try {
    return read(first);
  } catch (error) {
    if (!(error instanceof ProviderOutputError)) throw error;
  }
  const retry = await chat(connection, {
    format: "json",
    options,
    messages: [
      {
        role: "system",
        content: `${system}\n\nReply with one JSON object only, no prose and no code fences, matching this JSON schema:\n${JSON.stringify(schema)}`,
      },
      { role: "user", content: user },
    ],
  });
  return read(retry);
}
