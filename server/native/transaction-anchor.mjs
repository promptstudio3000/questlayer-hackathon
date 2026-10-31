import { assert } from "../domain.mjs";
const integer = (value) => Number.isSafeInteger(value) && value > 0;
const hash = (value) =>
  typeof value === "string" && /^[1-9A-HJ-NP-Za-km-z]{32,64}$/.test(value);

// A public pre-sign lower bound, not signing authority or a global spending lock.
export async function readTransactionAnchor(provider, run, clock = Date.now) {
  const [status, block] = await Promise.all([
    run(provider.viewNodeStatus()),
    run(provider.viewBlock({ finality: "final" })),
  ]);
  assert(
    status?.chain_id === "testnet" && !status.sync_info?.syncing,
    "NEAR testnet is unavailable. No wallet request was opened.",
    503,
  );
  const h = block?.header,
    stamp = String(h?.timestamp_nanosec ?? h?.timestamp ?? "");
  assert(
    h && integer(h.height) && hash(h.hash) && /^\d{1,24}$/.test(stamp),
    "The finalized transaction anchor is unavailable.",
    503,
  );
  const at = Number(BigInt(stamp) / 1000000n),
    now = clock();
  assert(
    integer(at) && at >= now - 120000 && at <= now + 10000,
    "The finalized transaction anchor is stale. Retry before opening the wallet.",
    503,
  );
  return h.height;
}
export async function requireTransactionAfter(
  provider,
  outcome,
  afterBlock,
  run,
) {
  if (afterBlock === undefined) return; // Older receipts had no pre-sign anchor.
  assert(integer(afterBlock), "Invalid transaction recovery anchor.", 400);
  const blockHash = outcome?.transaction_outcome?.block_hash;
  assert(
    hash(blockHash),
    "The transaction inclusion block is unavailable. Keep its receipt.",
    503,
  );
  const block = await run(provider.viewBlock({ blockId: blockHash }));
  assert(
    block?.header?.hash === blockHash && integer(block.header.height),
    "The transaction inclusion block could not be verified.",
    503,
  );
  assert(
    block.header.height > afterBlock,
    "This receipt predates the wallet request. Choose the transaction created for this action from your wallet history.",
    409,
    "NATIVE_RECEIPT_BEFORE_REQUEST",
  );
}

export function validReceiptStatus(status) {
  if (
    !status ||
    typeof status !== "object" ||
    Array.isArray(status) ||
    Object.keys(status).length !== 1
  )
    return false;
  if (Object.hasOwn(status, "Failure"))
    return (
      !!status.Failure &&
      typeof status.Failure === "object" &&
      !Array.isArray(status.Failure) &&
      Object.keys(status.Failure).length > 0
    );
  return (
    (Object.hasOwn(status, "SuccessValue") &&
      typeof status.SuccessValue === "string") ||
    (Object.hasOwn(status, "SuccessReceiptId") &&
      typeof status.SuccessReceiptId === "string" &&
      status.SuccessReceiptId.length > 0)
  );
}
