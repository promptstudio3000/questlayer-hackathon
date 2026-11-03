import { createReadStream, existsSync } from "node:fs";
import { createInterface } from "node:readline";

// Streams one JSON value per line. Tolerates the RS (0x1e) prefix that
// GeoJSON text sequences use and skips blank lines. Memory stays bounded by
// the longest line.
export async function* readJsonLines(path) {
  if (!existsSync(path)) return;
  const lines = createInterface({
    input: createReadStream(path, { encoding: "utf8" }),
    crlfDelay: Infinity,
  });
  let n = 0;
  for await (const raw of lines) {
    n++;
    const line = raw.charCodeAt(0) === 0x1e ? raw.slice(1) : raw;
    if (!line.trim()) continue;
    try {
      yield JSON.parse(line);
    } catch (error) {
      throw new Error(`${path}:${n}: ${error.message}`);
    }
  }
}
