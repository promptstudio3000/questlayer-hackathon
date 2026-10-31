# Native transaction confirmation

31 October 2026. W03/W05/W07 correctness slice; NEAR testnet only.

## Before / after / why

| Before                                                                                      | After                                                                                                                                                        | Why                                                                                             |
| ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------- |
| Several wallet handlers accepted an optimistic `SuccessValue`.                              | A read-only backend requests `FINAL` and verifies the returned transaction against the pre-wallet reviewed terms.                                            | A wallet response alone is not final execution.                                                 |
| Promise callbacks could return `false` after restoring a credit or leaving an exit waiting. | Callback-aware confirmation rejects `false` as incomplete and leaves the normal balance/position refresh authoritative.                                      | Restored credit is not a successful withdrawal, and an early advance is not received pool cash. |
| An arbitrary receiver/old deployment could look like a matching operation.                  | Known manifests pin current and executed receiver bytecode; factory positions require authoritative membership, beneficiary, ready state and no access keys. | A matching method name is insufficient to establish the reviewed protocol.                      |
| A cancelled or uncertain wallet operation could tempt a retry.                              | The client does not sign again during confirmation and retains the transaction reference in an uncertainty error.                                            | Reconciliation must precede a second potentially chargeable action.                             |

The confirmation endpoint does not create credits, mutate progression, transfer money,
load a key, sign, or authorize an operation. It only compares an existing on-chain
receipt to the reviewed input. Normal feature-specific state refresh, inventory,
claim and profile checks remain necessary after confirmation.

## Server integration

```js
const confirmation = new NativeTransactionConfirmation(db, provider, {
  rewardsConfig,
  marketManifest,
  claimsManifest,
  vaults: nativeVaults,
});
await confirmation.confirm(authenticatedPlayer, {
  accountId,
  transactionHash,
  quote: {
    network: "testnet",
    signerId: accountId,
    receiverId,
    methodName,
    args,
    gas,
    deposit,
  },
});
```

Use `POST /api/native/transactions/confirm`, bounded per-player request rates and
same-origin authenticated sessions. Recheck the session after asynchronous work.
Normalize `accountId` to `signerId` for the SocialDB prepare quote. The task escrow
retains its dedicated verifier and immutable policy.

The result includes `confirmed`, `network`, `accountId`, `transactionHash`,
`contractId`/`receiverId` and `methodName`. Missing/optimistic execution returns an
explicit pending error; failed receipts and false callbacks are never successful.
RPC failure/timeouts preserve uncertainty. All work shares a bounded deadline.

## Supported semantics

| Target                            | Methods                                                                     | Successful final result                                                                                                         |
| --------------------------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Reviewed factory                  | `create_position`, `register_position`, `withdraw_refund`                   | `true`; registration additionally references the linked beneficiary's recorded position                                         |
| Owned ready keyless factory child | `deposit_and_stake`, `request_exit`, `withdraw_owner`, `refresh`, `advance` | `true`; indicates the requested step, not an entire completed exit or harvest                                                   |
| Rewards                           | `withdraw`                                                                  | `true` from the transfer callback                                                                                               |
| Native Aura market                | `buy`, `cancel`, `withdraw`                                                 | `true`; a compensated purchase or failed transfer returns `false`                                                               |
| Collection → market               | `nft_transfer_call`                                                         | Final NEP-171 resolver `true` means the receiver retained the NFT; receiver callback `nft_on_transfer` uses a different meaning |
| Collection                        | `mint_avatar`, `redeem_aura`                                                | Token returned to the reviewed account, matching avatar ID or Aura edition                                                      |
| Collection                        | `equip_aura`, `unequip_aura`                                                | Successful void result; current equipment is separately refreshed                                                               |
| Pinned SocialDB                   | `set` scoped to this account's QuestLayer profile                           | Object containing the publication `block_height`; profile mutation is separately confirmed                                      |

Transaction hash, signer, receiver, the sole FunctionCall, method, parsed arguments,
attached deposit and gas must all match exactly. Comparison contexts allow 1–300
Tgas to support existing project receipt recovery; this does not change the client's
fixed pre-signing gas guards. Deposit/method/argument policies remain bounded per
feature. Expired Aura attestations can be compared to already completed receipts;
this endpoint cannot redeem an expired claim or create another transaction.

The verifier checks the RPC network directly on every request, a fresh finalized
anchor, current known contract hashes and the executed receiver's code at its
receipt anchors. Different historical code is deliberately unsupported by this
version even if the current deployment matches. Operator-managed market/NFT/reward
accounts remain upgrade-trusted testnet deployments; this verification does not
make them immutable. Vault children remain keyless and source-pinned.

## Evidence and boundaries

`tests/native-transaction-confirmation.test.mjs` covers actor/receiver/action
substitution, exact amounts/gas/arguments, finality, failed receipts, callback
compensation, revoked linkage, changed network/current/historical code, bounded RPC,
factory membership and keyless ownership, and distinct financial/token/profile
return types. It does not duplicate an implementation assertion as a simulated
successful payment.

`scripts/verify-native-finality.mjs` reads recorded project transactions without a
signer and reconstructs their original input for independent receipt comparison.
It also reads the existing factory exit and pool availability. The report separates
accepted current-source receipts from unsupported old-source receipts. It performs
no new transaction and does not fast-forward epochs or withdraw funds.

See `output/qa/W03-native-confirmation/read-only-proof.json` for the actual results.
Programmatic read-back is not a mobile wallet approval, a physical walk, independent
contract review or a complete native passkey/recovery journey. The full staking
cycle remains open until real pool cash, owner payout and realized game yield have
actually been observed and reconciled.

## Durable browser recovery

All eight wallet flows use the browser journal described in [Durable native recovery](DURABLE-NATIVE-RECOVERY.md). Updated clients use localStorage and short Web Locks; old session records migrate without silent loss. The Wallet panel supports bounded private receipt export/import. Imports are comparison context, never signing authority or a trusted success/failure status.

Before opening a wallet, `POST /api/native/transactions/anchor` reads a fresh finalized testnet block for the linked account. Its height is persisted as `afterBlock`. Confirmation checks the transaction's actual inclusion block strictly after that boundary before returning any clearable terminal result. Older records without a checkpoint remain explicitly legacy; no historical checkpoint is invented. The anchor is a public comparison bound, not a global spending lock.

Final statuses must have valid structure. Only an explicit boolean false callback becomes a compensated-operation failure; null, unknown or incomplete results retain uncertainty. Historical code checks and linked-wallet/session checks precede terminal response classification. A malformed response or revoked session cannot clear an unresolved receipt. No endpoint signs or transfers funds.

The live read-only anchor proof uses an existing project receipt and a reconstructed earlier boundary; it also proves rejection at the same block and after a freshly observed boundary. It does not claim that a new wallet request was signed or that physical wallet return was tested.

## Sponsored tasks and shared recovery

The eighth wallet flow (sponsored tasks) now uses the same session journal and Wallet recovery panel. The shared confirmation endpoint delegates the immutable task deployment to `NativeTasks.confirmTransaction`, retaining its linked-wallet, exact-transaction, current-code, keyless and policy checks. The adapter supplies the reviewed deployment context, never fresh authorization. Explicit final failure and a false withdrawal callback may be reconciled; malformed, unknown or incomplete final status cannot be cleared as a verified failure. Existing task-specific confirmation remains available. Three additional adapter tests cover exact terms, unknown status, genuine failure and ownership.
