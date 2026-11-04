// Geohash cells and the daily Merkle tree of the on-chain ledger
// (contracts/ledger, docs/CHAIN-LEDGER.md).
//
// The tree hashes sorted pairs with sha256 and carries an odd node up
// unchanged, exactly as the contract's verify_proof walks it, so a proof is
// just the list of sibling hashes from the leaf to the root.
import { createHash } from "node:crypto";

const BASE32 = "0123456789bcdefghjkmnpqrstuvwxyz";

/** Geohash of a point. Precision 7 is a cell of about 150 x 150 m. */
export function geohash(lat, lng, precision = 7) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  let latLo = -90,
    latHi = 90,
    lngLo = -180,
    lngHi = 180,
    even = true,
    bit = 0,
    ch = 0,
    out = "";
  while (out.length < precision) {
    if (even) {
      const mid = (lngLo + lngHi) / 2;
      if (lng >= mid) {
        ch = (ch << 1) | 1;
        lngLo = mid;
      } else {
        ch <<= 1;
        lngHi = mid;
      }
    } else {
      const mid = (latLo + latHi) / 2;
      if (lat >= mid) {
        ch = (ch << 1) | 1;
        latLo = mid;
      } else {
        ch <<= 1;
        latHi = mid;
      }
    }
    even = !even;
    if (++bit === 5) {
      out += BASE32[ch];
      bit = 0;
      ch = 0;
    }
  }
  return out;
}

export const sha256Hex = (data) =>
  createHash("sha256").update(data).digest("hex");

/** Canonical leaf of one action: what the day's root commits to. */
export function leafOf(a) {
  return sha256Hex(
    [
      "ql1",
      a.id,
      a.account_id || "-",
      a.kind,
      a.xp,
      a.gold_u,
      a.cell || "-",
      a.at,
      a.evidence,
    ].join("|"),
  );
}

function pair(a, b) {
  const [l, r] = Buffer.compare(a, b) <= 0 ? [a, b] : [b, a];
  return createHash("sha256")
    .update(Buffer.concat([l, r]))
    .digest();
}

/** Root and per-leaf proofs of hex leaves, in their given order. */
export function merkle(leavesHex) {
  if (!leavesHex.length) return { root: null, proofs: [] };
  let level = leavesHex.map((h) => Buffer.from(h, "hex"));
  // position[i] = index of leaf i's ancestor in the current level.
  const position = leavesHex.map((_, i) => i);
  const proofs = leavesHex.map(() => []);
  while (level.length > 1) {
    const next = [];
    for (let i = 0; i < level.length; i += 2)
      next.push(i + 1 < level.length ? pair(level[i], level[i + 1]) : level[i]);
    for (let leaf = 0; leaf < position.length; leaf++) {
      const p = position[leaf],
        sibling = p ^ 1;
      if (sibling < level.length)
        proofs[leaf].push(level[sibling].toString("hex"));
      position[leaf] = p >> 1;
    }
    level = next;
  }
  return { root: level[0].toString("hex"), proofs };
}

/** Same walk as the contract's verify_proof. */
export function verifyProof(leafHex, proof, rootHex) {
  let node = Buffer.from(leafHex, "hex");
  for (const s of proof) node = pair(node, Buffer.from(s, "hex"));
  return node.toString("hex") === rootHex;
}
