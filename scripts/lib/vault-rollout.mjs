// Pure helpers for the 9 November 2026 vault rollout scripts
// (scripts/rollout-vault-factory-v3-testnet.mjs and
// scripts/upgrade-yield-vault-testnet.mjs). No IO: everything takes its input
// explicitly, so tests/vault-rollout.test.mjs covers it.
import { createHash } from "node:crypto";

export const sha256Hex = (bytes) =>
  createHash("sha256").update(bytes).digest("hex");

const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
/** NEAR code hash: base58 of the sha256 of the code (same as check-wasm-hashes). */
export function base58Hex(hex) {
  let n = BigInt("0x" + hex);
  let out = "";
  while (n > 0n) {
    out = B58[Number(n % 58n)] + out;
    n /= 58n;
  }
  for (let i = 0; i < hex.length && hex.slice(i, i + 2) === "00"; i += 2)
    out = "1" + out;
  return out;
}
export const codeHashOf = (bytes) => base58Hex(sha256Hex(bytes));

/**
 * The factory embeds the vault with include_bytes!; the reviewed vault bytes
 * must appear contiguously in the factory WASM data section.
 */
export function wasmEmbeds(outer, inner) {
  return inner.length > 0 && Buffer.from(outer).indexOf(Buffer.from(inner)) >= 0;
}

/** Function export names of a WASM module (the contract's callable methods). */
export function wasmExports(bytes) {
  const b = Buffer.from(bytes);
  if (b.readUInt32LE(0) !== 0x6d736100) throw new Error("Not a WASM module");
  let o = 8;
  const leb = () => {
    let result = 0,
      shift = 0,
      byte;
    do {
      byte = b[o++];
      result |= (byte & 0x7f) << shift;
      shift += 7;
    } while (byte & 0x80);
    return result >>> 0;
  };
  while (o < b.length) {
    const id = b[o++];
    const size = leb();
    const end = o + size;
    if (id === 7) {
      const names = [];
      for (let n = leb(); n > 0; n--) {
        const len = leb();
        const name = b.subarray(o, o + len).toString("utf8");
        o += len;
        const kind = b[o++];
        leb();
        if (kind === 0) names.push(name);
      }
      return names.sort();
    }
    o = end;
  }
  return [];
}

/** Methods the old code exported that the new code drops (should be none). */
export const droppedExports = (oldBytes, newBytes) => {
  const next = new Set(wasmExports(newBytes));
  return wasmExports(oldBytes).filter((n) => !next.has(n));
};

/**
 * contracts/rewards register_factory_vault trusts exactly one factory:
 * questlayer-rewards-<gen> accepts children only from questlayer-vaults-<gen>.
 * There is no owner call that repoints it.
 */
export function pinnedFactoryFor(rewardsId) {
  const m = /^questlayer-rewards-(.+)$/.exec(rewardsId || "");
  if (!m) throw new Error(`${rewardsId} is not a questlayer-rewards-<generation> account`);
  return `questlayer-vaults-${m[1]}`;
}

/** Both rollout scripts are testnet only and say so on the command line. */
export function rolloutOptions(argv) {
  const at = argv.findIndex((a) => a === "--network" || a.startsWith("--network="));
  const network = at < 0 ? undefined : argv[at].includes("=") ? argv[at].split("=")[1] : argv[at + 1];
  if (network !== "testnet")
    throw new Error("Pass --network testnet. These rollout scripts refuse mainnet and every other network.");
  const value = (flag) => {
    const i = argv.findIndex((a) => a === flag || a.startsWith(flag + "="));
    if (i < 0) return undefined;
    return argv[i].includes("=") ? argv[i].slice(flag.length + 1) : argv[i + 1];
  };
  return { network, execute: argv.includes("--execute"), value, has: (f) => argv.includes(f) };
}

/**
 * Deep structural diff of two JSON-like values. Returns [{path, before, after}].
 * `ignore` lists dotted paths (a trailing ".*" ignores a whole subtree);
 * `additive` lists paths that may appear only in `after` (new view fields).
 */
export function diffValues(before, after, { ignore = [], additive = [] } = {}, path = "") {
  const skip = (p) => ignore.some((i) => i === p || (i.endsWith(".*") && p.startsWith(i.slice(0, -1))));
  if (path && skip(path)) return [];
  const isObj = (v) => v !== null && typeof v === "object";
  if (!isObj(before) || !isObj(after) || Array.isArray(before) !== Array.isArray(after))
    return Object.is(before, after) ? [] : [{ path: path || "(root)", before, after }];
  const out = [];
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  for (const k of [...keys].sort()) {
    const p = path ? `${path}.${k}` : k;
    if (!(k in before) && additive.includes(p)) continue;
    if (!(k in before) || !(k in after)) {
      if (!skip(p)) out.push({ path: p, before: before[k], after: after[k] });
      continue;
    }
    out.push(...diffValues(before[k], after[k], { ignore, additive }, p));
  }
  return out;
}

// ----- Borsh decoding of the questlayer-yield-vault state (contracts/yield-vault/src/lib.rs) -----

class Reader {
  constructor(buf) {
    this.b = Buffer.from(buf);
    this.o = 0;
  }
  need(n) {
    if (this.o + n > this.b.length) throw new Error(`Borsh: need ${n} bytes at ${this.o} of ${this.b.length}`);
  }
  u8() {
    this.need(1);
    return this.b[this.o++];
  }
  bool() {
    const v = this.u8();
    if (v > 1) throw new Error(`Borsh: bool ${v} at ${this.o - 1}`);
    return v === 1;
  }
  u16() {
    this.need(2);
    const v = this.b.readUInt16LE(this.o);
    this.o += 2;
    return v;
  }
  u32() {
    this.need(4);
    const v = this.b.readUInt32LE(this.o);
    this.o += 4;
    return v;
  }
  u64() {
    this.need(8);
    const v = this.b.readBigUInt64LE(this.o);
    this.o += 8;
    return v.toString();
  }
  u128() {
    this.need(16);
    const lo = this.b.readBigUInt64LE(this.o),
      hi = this.b.readBigUInt64LE(this.o + 8);
    this.o += 16;
    return ((hi << 64n) | lo).toString();
  }
  bytes() {
    const n = this.u32();
    this.need(n);
    const v = this.b.subarray(this.o, this.o + n);
    this.o += n;
    return v;
  }
  string() {
    return this.bytes().toString("utf8");
  }
  vec(item) {
    const n = this.u32();
    if (n > 10_000) throw new Error(`Borsh: implausible vector length ${n}`);
    return Array.from({ length: n }, () => item(this));
  }
  end(what) {
    if (this.o !== this.b.length)
      throw new Error(`Borsh: ${what} has ${this.b.length - this.o} trailing bytes (layout differs from the source)`);
  }
}

const token = (r) => ({
  id: r.string(),
  lst: r.bool(),
  price_method: r.string(),
  rhea: r.bool(),
  cap: r.u128(),
  account_cap: r.u128(),
  min_deposit: r.u128(),
  buffer_bps: r.u16(),
  max_util_bps: r.u16(),
  safety_bps: r.u16(),
  min_harvest: r.u128(),
  principal: r.u128(),
  pending: r.u128(),
  queued: r.u128(),
  idle: r.u128(),
  outgoing: r.u128(),
  inbound: r.u128(),
  inbound_block: r.u64(),
  inbound_threshold: r.u128(),
  op: r.u8(),
  op_nonce: r.u64(),
  op_ms: r.u64(),
  q_head: r.u64(),
  q_tail: r.u64(),
  harvested: r.u128(),
  deposits: r.u64(),
});

/** Decodes the `STATE` value; throws unless it consumes every byte. */
export function decodeYieldState(buf) {
  const r = new Reader(buf);
  const s = {
    owner: r.string(),
    treasury: r.string(),
    rhea: r.string(),
    lock_ms: r.u64(),
    deposits_paused: r.bool(),
    tokens: r.vec(token),
    positions_prefix: r.bytes().toString("latin1"),
    queue_prefix: r.bytes().toString("latin1"),
    position_count: r.u64(),
  };
  r.end("STATE");
  return s;
}
export function decodeYieldPosition(buf) {
  const r = new Reader(buf);
  const p = {
    free: r.u128(),
    tranches: r.vec((x) => ({ amount: x.u128(), locked_until_ms: x.u64() })),
    queued: r.u128(),
  };
  r.end("Position");
  return p;
}
export function decodeQueueEntry(buf) {
  const r = new Reader(buf);
  const q = { account_id: r.string(), amount: r.u128() };
  r.end("QueueEntry");
  return q;
}
/** LookupMap key: prefix + Borsh(String). */
function mapKey(key, prefix) {
  if (!key.subarray(0, prefix.length).equals(Buffer.from(prefix, "latin1"))) return null;
  const r = new Reader(key.subarray(prefix.length));
  const k = r.string();
  r.end("map key");
  return k;
}

/**
 * Decodes a full `view_state` dump ([{key, value}] base64) of the yield vault:
 * the root state, every position and every queue entry. Unknown keys are an
 * error, so a layout or prefix change cannot pass unnoticed.
 */
export function decodeYieldRaw(values) {
  const entries = values.map((v) => ({ key: Buffer.from(v.key, "base64"), value: Buffer.from(v.value, "base64") }));
  const root = entries.find((e) => e.key.toString("latin1") === "STATE");
  if (!root) throw new Error("No STATE key: not an initialized yield vault");
  const state = decodeYieldState(root.value);
  const positions = {},
    queue = {};
  for (const e of entries) {
    if (e === root) continue;
    let k;
    if ((k = mapKey(e.key, state.positions_prefix)) !== null) positions[k] = decodeYieldPosition(e.value);
    else if ((k = mapKey(e.key, state.queue_prefix)) !== null) queue[k] = decodeQueueEntry(e.value);
    else throw new Error(`Unknown storage key ${e.key.toString("base64")}`);
  }
  if (Object.keys(positions).length !== Number(state.position_count))
    throw new Error(`position_count ${state.position_count} but ${Object.keys(positions).length} position records`);
  return { state, positions, queue };
}

/** sha256 over the sorted raw key/value pairs: equal digests mean byte-identical storage. */
export function rawStateDigest(values) {
  const h = createHash("sha256");
  for (const v of [...values].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)))
    h.update(`${v.key}=${v.value}\n`);
  return h.digest("hex");
}

/** Accounts holding a position, from the decoded `<account>#<token>` keys. */
export function positionAccounts(positions) {
  return [...new Set(Object.keys(positions).map((k) => k.slice(0, k.lastIndexOf("#"))))].sort();
}

/** Reasons the yield vault is not quiet enough for a code switch (empty = go). */
export function yieldBusyReasons(state) {
  const reasons = [];
  for (const t of state.tokens) {
    if (t.op !== 0) reasons.push(`${t.id}: keeper operation ${t.op} (nonce ${t.op_nonce}) in flight`);
    if (t.outgoing !== "0") reasons.push(`${t.id}: outgoing payout ${t.outgoing} in flight`);
    if (t.inbound !== "0") reasons.push(`${t.id}: inbound Rhea withdrawal ${t.inbound} unconfirmed`);
    if (t.pending !== "0") reasons.push(`${t.id}: LST withdrawal price read ${t.pending} pending`);
  }
  return reasons;
}

/** Sum of principal and queued per token, recomputed from the decoded positions. */
export function positionTotals(positions) {
  const out = {};
  for (const [k, p] of Object.entries(positions)) {
    const tokenId = k.slice(k.lastIndexOf("#") + 1);
    const t = (out[tokenId] ||= { principal: 0n, queued: 0n });
    t.principal += BigInt(p.free) + p.tranches.reduce((a, x) => a + BigInt(x.amount), 0n);
    t.queued += BigInt(p.queued);
  }
  return Object.fromEntries(
    Object.entries(out).map(([k, v]) => [k, { principal: v.principal.toString(), queued: v.queued.toString() }]),
  );
}

/**
 * Accounting invariants the upgrade must leave alone: per token, the recorded
 * principal equals the positions' principal plus queued and LST pending value
 * is zero. Returns the mismatches.
 */
export function yieldAccountingMismatches(decoded) {
  const totals = positionTotals(decoded.positions);
  const out = [];
  for (const t of decoded.state.tokens) {
    const p = totals[t.id] || { principal: "0", queued: "0" };
    if (p.principal !== t.principal) out.push(`${t.id}: token principal ${t.principal}, positions ${p.principal}`);
    if (p.queued !== t.queued) out.push(`${t.id}: token queued ${t.queued}, positions ${p.queued}`);
  }
  return out;
}

/**
 * The v3 yield vault refuses deposits unless the account can still pay for two
 * full positions plus one queue entry per position (storage_reserve_ok in
 * contracts/yield-vault/src/lib.rs). Predicts it for the new code size.
 */
export function predictYieldStorageReserve({ balance, storageUsage, oldCodeBytes, newCodeBytes, positionCount, byteCost = 10n ** 19n }) {
  const used = BigInt(storageUsage) - BigInt(oldCodeBytes) + BigInt(newCodeBytes);
  const reserve = 600n * 2n + 180n * (BigInt(positionCount) + 1n);
  const needed = (used + reserve) * byteCost;
  return { ok: BigInt(balance) >= needed, needed: needed.toString(), used: used.toString() };
}

/** The account can pay storage for the code it is about to hold (plus headroom). */
export function deployBalanceOk({ balance, storageUsage, oldCodeBytes, newCodeBytes, headroomBytes = 20_000, byteCost = 10n ** 19n }) {
  const used = BigInt(storageUsage) - BigInt(oldCodeBytes) + BigInt(newCodeBytes) + BigInt(headroomBytes);
  return BigInt(balance) >= used * byteCost;
}

/**
 * Moves a deployment record into a history list and keeps
 * contracts/wasm-sha256.json testnetDeploymentsNotFromThisBuild consistent with
 * scripts/check-wasm-hashes.mjs: entries for paths that now hold this build are
 * dropped, the history copy is listed with its exact old hash.
 *
 *   manifestFile   "public/native-rewards-testnet.json"
 *   currentPath    "factory" (dotted) or "" for the manifest root
 *   historyKey     "factoryHistory"
 *   record         the old record (copied as is, plus `extra`)
 *   hashKeys       { wasmSha256: "questlayer_vault_factory", ... }
 *   newHashes      { wasmSha256: "<hex>", ... } now at currentPath
 *   built          { questlayer_vault_factory: "<hex>", ... } (the pins)
 * Returns { manifest, exceptions } as new objects.
 */
export function recordReplacedDeployment({ manifest, exceptions, manifestFile, currentPath, historyKey, record, extra = {}, hashKeys, newHashes, built }) {
  const m = structuredClone(manifest),
    ex = structuredClone(exceptions || {});
  const history = (m[historyKey] ||= []);
  const index = history.length;
  history.push({ ...structuredClone(record), ...extra });
  const prefix = currentPath ? `${currentPath}.` : "";
  for (const [key, contract] of Object.entries(hashKeys)) {
    const old = record[key];
    const currentId = `${manifestFile}:${prefix}${key}`;
    if (newHashes[key] !== built[contract])
      throw new Error(`${currentId}: new hash ${newHashes[key]} is not the pinned ${contract} build ${built[contract]}`);
    delete ex[currentId];
    if (typeof old === "string" && old !== built[contract])
      ex[`${manifestFile}:${historyKey}.${index}.${key}`] = {
        contract,
        sha256: old,
        note: `Replaced on testnet; kept as history (${extra.replacedAt || "date in record"}).`,
      };
  }
  return { manifest: m, exceptions: ex, index };
}

/** get_config fields the PR #235 yield vault adds (absent in the older code). */
export const YIELD_NEW_CONFIG_FIELDS = ["position_bytes", "queue_entry_bytes", "storage_reserve_ok"];

/**
 * Differences between two yield-vault snapshots (see upgrade-yield-vault-testnet.mjs)
 * that a code-only upgrade must not cause. Empty = identical.
 *   allowPausedFlag      the deposits_paused flag may differ (pause/unpause step);
 *                        the raw digest is then not compared, the decoded state is.
 *   newConfigFields      the three new get_config fields may appear in `b`.
 *   droppedConfigFields  they may disappear (rollback to the older code).
 * get_position is compared on principal, queued and kind: its withdrawable and
 * tranches fold by block time; the raw decoded positions are compared exactly.
 * Rhea supply is compared by shares (its balance accrues interest).
 */
export function compareYieldSnapshots(a, b, { allowPausedFlag = false, newConfigFields = false, droppedConfigFields = false } = {}) {
  const out = [];
  if (!allowPausedFlag && a.raw.digest !== b.raw.digest) out.push({ path: "raw.digest", before: a.raw.digest, after: b.raw.digest });
  out.push(
    ...diffValues(a.decoded, b.decoded, { ignore: allowPausedFlag ? ["state.deposits_paused"] : [] }).map((d) => ({ ...d, path: `decoded.${d.path}` })),
  );
  const pick = (s) => ({
    config: s.views.config,
    tokens: s.views.tokens,
    positions: Object.fromEntries(
      Object.entries(s.views.positions).map(([acct, rows]) => [acct, Object.fromEntries(rows.map((r) => [r.token_id, { principal: r.principal, queued: r.queued, kind: r.kind }]))]),
    ),
    queues: s.views.queues,
    external: s.external,
  });
  const fields = YIELD_NEW_CONFIG_FIELDS.map((f) => `config.${f}`);
  out.push(
    ...diffValues(pick(a), pick(b), {
      ignore: [...(allowPausedFlag ? ["config.deposits_paused"] : []), ...(droppedConfigFields ? fields : [])],
      additive: newConfigFields ? fields : [],
    }).map((d) => ({ ...d, path: `views.${d.path}` })),
  );
  return out;
}
