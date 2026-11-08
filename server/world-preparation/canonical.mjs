import { createHash } from "node:crypto";

// Byte-level identity shared by input snapshots, checkpoints and output bundles.
export function canonical(value) {
  if (value === null || typeof value === "boolean" || typeof value === "string")
    return JSON.stringify(value);
  if (typeof value === "number" && Number.isFinite(value))
    return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && Object.getPrototypeOf(value) === Object.prototype)
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
      .join(",")}}`;
  throw Error("Snapshot values must be finite JSON values.");
}

export const sha256 = (bytes) =>
  createHash("sha256").update(bytes).digest("hex");
export const digest = (value) => sha256(canonical(value));
export const compare = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

export function requireValue(condition, message) {
  if (!condition) throw Error(message);
}

export function exactKeys(value, allowed, label) {
  requireValue(
    value && Object.getPrototypeOf(value) === Object.prototype,
    `${label}: expected an object.`,
  );
  for (const key of Object.keys(value))
    requireValue(allowed.includes(key), `${label}: unknown field ${key}.`);
}
