// Read-only NEAR confirmation and domain-separated MetaLayer action evidence.
// No signer, transaction submission, XP mint or financial credit exists here.
import { atomic } from "../database.mjs";
import { assert, hash } from "../domain.mjs";
import { NETWORK, DEFAULT_RPC } from "../native/network.mjs";
import { validReceiptStatus } from "../native/transaction-anchor.mjs";
import { ensureModuleVersion, registerModuleSchema } from "../schema-compatibility.mjs";

export const ACTIVITY_SCHEMA = registerModuleSchema({ name: "metalayer-activity", version: 1, sql: `
CREATE TABLE IF NOT EXISTS ml_actions(
 id TEXT PRIMARY KEY,layer TEXT NOT NULL,player_id TEXT NOT NULL REFERENCES players(id),
 kind TEXT NOT NULL,at INTEGER NOT NULL,envelope TEXT NOT NULL,evidence_hash TEXT NOT NULL,
 tx TEXT,verified_at INTEGER,block_hash TEXT
);
CREATE INDEX IF NOT EXISTS ml_actions_actor ON ml_actions(layer,player_id,at);
` });
const TX = /^[1-9A-HJ-NP-Za-km-z]{43,44}$/;
const ACCOUNT = /^(?=.{2,64}$)[a-z0-9]+(?:[-_][a-z0-9]+)*(?:\.[a-z0-9]+(?:[-_][a-z0-9]+)*)*\.testnet$/;

export function metaLayerNearConfiguration(env = process.env) {
  const contract = env.METALAYER_NEAR_CONTRACT, codeHash = env.METALAYER_NEAR_CODE_HASH;
  const recorder = env.METALAYER_NEAR_RECORDER || contract;
  if (NETWORK !== "testnet" || !ACCOUNT.test(contract || "") || !TX.test(codeHash || "") || !ACCOUNT.test(recorder || "")) return null;
  return { contract, codeHash, recorder, rpc: env.NEAR_RPC_URL || DEFAULT_RPC };
}

export function readOnlyRpc(url) {
  return async (method, params) => {
    const response = await fetch(url, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: "metalayer-read", method, params }),
      signal: AbortSignal.timeout(8000),
    });
    assert(response.ok, "NEAR verification is unavailable. Keep the transaction reference and retry.", 503);
    const reader = response.body.getReader(), chunks = [];
    let size = 0;
    try {
      while (true) {
        const next = await reader.read();
        if (next.done) break;
        size += next.value.byteLength;
        assert(size <= 1_048_576, "NEAR verification response is too large.", 503);
        chunks.push(next.value);
      }
    } finally { await reader.cancel().catch(() => {}); }
    let body;
    try { body = JSON.parse(Buffer.concat(chunks).toString()); } catch {
      assert(false, "NEAR verification returned invalid data.", 503);
    }
    assert(!body.error && body.result, "NEAR verification is unavailable. Keep the transaction reference and retry.", 503);
    return body.result;
  };
}

// This adapter expects the owner's reviewed MetaLayer record_batch contract.
// Existing city QXP/QGOLD records cannot satisfy this event domain or evidence.
export async function verifyMetaLayerAction({ config, rpc, action, transactionHash, now = Date.now }) {
  assert(config && ACCOUNT.test(config.contract) && TX.test(config.codeHash) && ACCOUNT.test(config.recorder),
    "MetaLayer's reviewed NEAR contract is not configured.", 503);
  assert(TX.test(transactionHash || ""), "Enter a valid NEAR transaction hash.", 400);
  const [status, final, result] = await Promise.all([
    rpc("status", []), rpc("block", { finality: "final" }),
    rpc("tx", { tx_hash: transactionHash, sender_account_id: config.recorder, wait_until: "FINAL" }),
  ]);
  const h = final?.header, stamp = String(h?.timestamp_nanosec ?? h?.timestamp ?? "");
  assert(status?.chain_id === "testnet" && !status.sync_info?.syncing &&
    Number.isSafeInteger(h?.height) && h.height > 0 && TX.test(h.hash) && /^\d{1,24}$/.test(stamp),
    "A finalized NEAR testnet block is required.", 503);
  const time = Number(BigInt(stamp) / 1_000_000n);
  assert(time >= now() - 120000 && time <= now() + 10000, "NEAR's finalized block is stale.", 503);
  assert(result?.final_execution_status === "FINAL", "The NEAR transaction is still finalizing.", 409);
  const tx = result.transaction, call = tx?.actions?.[0]?.FunctionCall;
  assert(tx?.hash === transactionHash && tx.signer_id === config.recorder && tx.receiver_id === config.contract &&
    tx.actions.length === 1 && ["record_batch", "award"].includes(call?.method_name) && call.deposit === "0",
    "This transaction does not belong to MetaLayer's reviewed recorder.", 409);
  const receipts = result.receipts_outcome;
  assert(Array.isArray(receipts) && receipts.length > 0 && receipts.length <= 100 &&
    [result.status, result.transaction_outcome?.outcome?.status, ...receipts.map(r => r.outcome?.status)]
      .every(s => validReceiptStatus(s) && !Object.hasOwn(s, "Failure")),
    "Every NEAR receipt must succeed before this action is verified.", 409);
  const nodes = new Map(receipts.map(r => [r.id, r]));
  assert(nodes.size === receipts.length && [...nodes.keys()].every(id => typeof id === "string" && id.length > 0), "NEAR receipt identities are invalid.", 409);
  const reached = new Set(), queue = [...(result.transaction_outcome.outcome.receipt_ids || [])];
  assert(queue.length > 0, "NEAR's execution receipt is unavailable.", 409);
  while (queue.length) {
    const id = queue.shift();
    if (reached.has(id)) continue;
    const node = nodes.get(id);
    assert(node && Array.isArray(node.outcome.receipt_ids), "NEAR's receipt execution graph is incomplete.", 409);
    reached.add(id); queue.push(...node.outcome.receipt_ids);
  }
  assert(reached.size === receipts.length && Object.hasOwn(result.status, "SuccessValue"), "NEAR's execution graph is not complete.", 409);
  const matching = receipts.filter(r => r.outcome?.executor_id === config.contract).filter(r =>
    (r.outcome.logs || []).some(line => {
      if (typeof line !== "string" || !line.startsWith("EVENT_JSON:") || line.length > 32768) return false;
      try {
        const e = JSON.parse(line.slice(11));
        return e.standard === "questlayer_metalayer" && e.version === "1.0.0" && e.event === "action_recorded" &&
          Array.isArray(e.data) && e.data.some(d => d.action_id === action.id && d.layer_id === action.layer &&
            d.actor === action.actor && d.evidence_hash === action.evidence_hash);
      } catch { return false; }
    }));
  assert(matching.length === 1, "The transaction has no unique matching MetaLayer action receipt.", 409);
  const receipt = matching[0], inclusionHash = result.transaction_outcome?.block_hash;
  assert(TX.test(inclusionHash || "") && TX.test(receipt.block_hash || ""), "NEAR receipt blocks are unavailable.", 503);
  const [inclusion, execution, oldCode, currentCode] = await Promise.all([
    rpc("block", { block_id: inclusionHash }), rpc("block", { block_id: receipt.block_hash }),
    rpc("query", { request_type: "view_account", account_id: config.contract, block_id: receipt.block_hash }),
    rpc("query", { request_type: "view_account", account_id: config.contract, block_id: h.hash }),
  ]);
  assert(inclusion?.header?.hash === inclusionHash && execution?.header?.hash === receipt.block_hash &&
    [inclusion.header.height, execution.header.height].every(v => Number.isSafeInteger(v) && v > 0 && v <= h.height),
    "The action's block is not finalized on NEAR.", 409);
  assert(oldCode?.code_hash === config.codeHash && currentCode?.code_hash === config.codeHash &&
    oldCode.block_hash === receipt.block_hash && currentCode.block_hash === h.hash,
    "The MetaLayer contract code does not match its reviewed fingerprint.", 409);
  return { status: "confirmed", tx: transactionHash, blockHash: receipt.block_hash, verifiedAt: now(),
    explorer: `https://testnet.nearblocks.io/txns/${transactionHash}`, poll: "none" };
}

export function createLayerActivity(db, { now = Date.now, config = metaLayerNearConfiguration(), rpc, onRecord = null } = {}) {
  ensureModuleVersion(db, ACTIVITY_SCHEMA);
  const query = rpc || (config ? readOnlyRpc(config.rpc) : null);
  function record(actor, layer, reference, kind, data) {
    const actorHash = hash(`metalayer:${layer.id}:${actor.id}`);
    const actionId = `mla_${hash(`${layer.id}:${actorHash}:${kind}:${reference}`).slice(0, 40)}`;
    if (db.prepare("SELECT id FROM ml_actions WHERE id=?").get(actionId)) return actionId;
    const envelope = JSON.stringify({ v: 1, domain: "questlayer:metalayer", id: actionId,
      layer: layer.id, actor: actorHash, kind, at: now(), data });
    db.prepare("INSERT INTO ml_actions(id,layer,player_id,kind,at,envelope,evidence_hash) VALUES(?,?,?,?,?,?,?)")
      .run(actionId, layer.id, actor.id, kind, now(), envelope, hash(envelope));
    onRecord?.({ id: actionId, layer: layer.id, playerId: actor.id, actor: actorHash, kind, evidenceHash: hash(envelope) });
    return actionId;
  }
  function list(actor, layer) {
    return { network: "testnet", contract: config?.contract ?? null,
      verifier: config ? "read-only" : "not-configured", submission: "not-configured",
      actions: db.prepare("SELECT id,kind,at,evidence_hash,tx,verified_at FROM ml_actions WHERE layer=? AND player_id=? ORDER BY at DESC,rowid DESC LIMIT 30")
        .all(layer.id, actor.id).map(r => ({ id: r.id, kind: r.kind, at: r.at, evidenceHash: r.evidence_hash,
          chain: r.tx ? { status: "confirmed", tx: r.tx, poll: "none" } : null })),
    };
  }
  async function verify(actor, layer, input) {
    assert(config, "MetaLayer's reviewed NEAR contract is not configured.", 503);
    const row = db.prepare("SELECT * FROM ml_actions WHERE id=? AND layer=? AND player_id=?")
      .get(input.actionId, layer.id, actor.id);
    assert(row, "This MetaLayer action is not yours or does not exist.", 404);
    if (row.tx === input.transactionHash) return list(actor, layer);
    const proof = await verifyMetaLayerAction({ config, rpc: query, action: { ...row, actor: JSON.parse(row.envelope).actor }, transactionHash: input.transactionHash, now });
    atomic(db, () => {
      const latest = db.prepare("SELECT tx FROM ml_actions WHERE id=?").get(row.id);
      assert(!latest.tx || latest.tx === proof.tx, "This action already has a different verified transaction.", 409);
      db.prepare("UPDATE ml_actions SET tx=?,verified_at=?,block_hash=? WHERE id=?")
        .run(proof.tx, proof.verifiedAt, proof.blockHash, row.id);
    });
    return list(actor, layer);
  }
  return { record, list, verify };
}
