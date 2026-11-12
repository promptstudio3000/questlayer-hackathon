// Structured JSON output from chat models: the shared error type and a
// tolerant parser for one JSON object in model text.

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
