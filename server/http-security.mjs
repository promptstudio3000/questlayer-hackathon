import { assert } from "./domain.mjs";
import { isIP } from "node:net";

// Only the explicitly trusted loopback proxy may supply a client address.
// Its rightmost hop cannot be replaced by a client-supplied prefix.
export function clientAddress(req, trustLoopback = false) {
  const remote = req.socket.remoteAddress || "unknown";
  const local = ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(remote);
  const forwarded = req.headers["x-forwarded-for"];
  if (!trustLoopback || !local || typeof forwarded !== "string") return remote;
  const last = forwarded.split(",").at(-1).trim();
  return isIP(last) ? last : remote;
}

// Fixed one-minute rate windows are keyed "<scope>:<who>:<minute>". Drop
// windows that ended instead of clearing every counter (a flood of keys must
// not reset everyone's limits); a hard ceiling still bounds memory.
export function pruneRateWindows(rates, now = Date.now()) {
  const minute = Math.floor(now / 60_000);
  for (const key of rates.keys()) {
    const at = Number(key.slice(key.lastIndexOf(":") + 1));
    if (!Number.isFinite(at) || at < minute) rates.delete(key);
  }
  return rates.size;
}

// All callers use fixed-minute keys. Preserve active counters under memory pressure.
export class RateWindows extends Map {
  constructor(ceiling = 200_000, now = Date.now) {
    super();
    this.ceiling = ceiling;
    this.now = now;
  }
  set(key, count) {
    const now = this.now(),
      minute = Math.floor(now / 60_000);
    if (minute !== this.minute) {
      pruneRateWindows(this, now);
      this.minute = minute;
    }
    assert(
      this.has(key) || this.size < this.ceiling,
      "Please try again shortly.",
      429,
      "RATE_LIMITED",
    );
    return super.set(key, count);
  }
}

// Browser-visible transport is configured independently of the server's RPC credentials.
export function publicRpcUrl(value, fallback) {
  const url = new URL(value || fallback);
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !(
      url.protocol === "https:" ||
      (url.protocol === "http:" &&
        ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))
    )
  )
    throw new Error(
      "PUBLIC_NEAR_RPC_URL requires a public HTTPS or loopback endpoint without credentials or query parameters.",
    );
  return url.href;
}
