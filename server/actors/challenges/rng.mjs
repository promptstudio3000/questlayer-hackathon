// Deterministic randomness for monster challenges. Every challenge is fully
// determined by its secret seed, so the server can replay it when the player
// submits, and the seed can be revealed afterwards to prove the monster's
// moves were fixed before the player acted.
import { createHash, createHmac } from "node:crypto";

export const sha256 = (text) => createHash("sha256").update(text).digest("hex");

export function deriveSeed(secret, ...parts) {
  return createHmac("sha256", secret).update(parts.join("␟")).digest("hex");
}

// Counter-mode SHA-256 stream: random() in [0, 1), int(n) in [0, n).
export function seededRandom(seed) {
  let counter = 0;
  let pool = [];
  const next32 = () => {
    if (!pool.length) {
      const block = createHash("sha256").update(`${seed}:${counter++}`).digest();
      pool = Array.from({ length: 8 }, (_, i) => block.readUInt32BE(i * 4));
    }
    return pool.shift();
  };
  const random = () => next32() / 2 ** 32;
  return {
    random,
    int: (n) => Math.floor(random() * n),
    range: (min, max) => min + random() * (max - min),
    pick: (list) => list[Math.floor(random() * list.length)],
    shuffle(list) {
      const out = [...list];
      for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(random() * (i + 1));
        [out[i], out[j]] = [out[j], out[i]];
      }
      return out;
    },
  };
}
