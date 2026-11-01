# Collectibles contract: second read-through for mainnet

Status: 1 November 2026. Scope: `contracts/collectibles/src/lib.rs` (avatar, Aura vouchers, equipment,
NEP-171/177/178/181) as the `docs/MAINNET-PLAN.md` section 5 gate requires. The reviewer did not write the
contract. Nothing was sent to mainnet.

## Result

**Go for the mainnet slice after the fixes in this change**, with two operator conditions (fund the account
with at least 4 NEAR, and treat the operator key as the upgrade key). Before this change the contract could
not serve the slice at all: `redeem_aura` panicked with "Claims are testnet-only" on any non-`.testnet`
account, and the signed message said `Network: testnet` while the server signs `Network: mainnet`.

Reviewed build: `questlayer_collectibles.wasm`, 350,650 bytes,
**sha256 `491183e35cf593a734a11a7c0acdaff139da1cd0578de06cb17ddc8e49667287`**
(recorded in `contracts/collectibles/WASM_SHA256`; this is the `COLLECTIBLES_WASM_SHA256` value for
`scripts/deploy-mainnet-slice.mjs`).

## Findings

| # | Severity | Finding | Resolution |
| --- | --- | --- | --- |
| 1 | Blocker | `redeem_aura` asserted `.testnet`; the voucher text hard-coded `Network: testnet`. On mainnet every earned Aura would fail. | Fixed. The network comes from the contract's own account suffix (`.testnet` → testnet, otherwise mainnet). The testnet message is byte-identical, so the server (`award-vouchers.mjs`, which already signs `Network: ${NETWORK}`) needs no change, and a voucher can never cross networks (test `testnet_voucher_cannot_redeem_on_mainnet`). |
| 2 | Blocker (ops) | Code alone is 350,650 bytes, about 3.51 NEAR of storage at 10^19 yocto/byte. The runbook's `COLLECTIBLES_FUND_NEAR=3` makes the create+deploy+init transaction fail with `LackBalanceForState`. The testnet twin uses 353,716 bytes and holds 4.0 NEAR. | Not code. Use `COLLECTIBLES_FUND_NEAR=4` or more (5 is the testnet default). Reported to the deploy-script thread. |
| 3 | High (reproducibility) | The WASM embedded the builder's absolute paths (`/Users/<name>/.cargo/registry/...` in the deployed testnet code) and the toolchain floated (`stable` in CI), so no two machines produced the same sha256 and the "reviewed hash" could not be checked by anyone else. | Fixed. `rust-toolchain.toml` pins Rust 1.97.0 + the wasm target, `scripts/build-contracts.sh` builds `--locked` with `--remap-path-prefix` for the cargo home, rustup home and checkout, and `scripts/collectibles-wasm-sha256.mjs` fails the build (and CI) if the collectibles WASM differs from the recorded hash. Verified: two clean builds in different directories with different `CARGO_HOME` give the same sha256. |
| 4 | Medium | No way to stop earned claims if the voucher key leaks, short of an upgrade. A leaked key can mint up to 768 Auras (3 × 256) to any wallets the attacker controls. | Fixed. `clear_award_signer()` (owner, 1 yocto) disables new redemptions; already redeemed claims keep their tokens and retries of redeemed claims still return the same token. `set_award_signer` re-enables with a new key. |
| 5 | Low (defence in depth) | `claim_id` was only length-checked. The voucher is a newline-separated text, so a claim id containing `\n` could in principle make two different tuples sign the same text if the server ever signed attacker-shaped ids. It does not today (`earned:` + server id / sha256), so this was not exploitable. | Fixed. Earned claim ids must be printable ASCII without spaces (`is_ascii_graphic`). |
| 6 | Low (copy) | Earned Aura metadata said "Testnet collectible." on every network. | Fixed: kept on `.testnet`, dropped on mainnet. |
| 7 | Info | Upgrade authority is the full-access key on the contract account (the deploy script adds the operator key). There is no in-contract `upgrade`, and `migrate` / `migrate_v3` only accept owner or self and only parse the exact V1/V2 layouts, so they cannot be used on a fresh V3 deployment. Owner and oracle are fixed at `new` and cannot be rotated. | Accepted. On mainnet keep that key offline (hardware or cold); losing it means no signer rotation and no upgrade (the testnet keys were already lost once). Oracle = operator adds no power beyond the upgrade key, so the slice's `owner_id = oracle_id = operator` is fine. |
| 8 | Info | Equipment slots are stored at the contract's expense (`equip_aura` is not payable). | Accepted. Bounded: a token occupies at most one slot and only Aura owners can equip, so at most 768 entries (≈ 0.1 MB, ≈ 1 NEAR worst case, in practice far less). |

## What was checked and holds

- **Access control.** `mint_aura` / `mint_aura_once` are oracle-only; `set_award_signer` / `clear_award_signer`
  are owner-only with 1 yocto (the oracle cannot replace the signer, test `oracle_cannot_replace_award_signer`);
  `nft_resolve_transfer` is `#[private]`; `equip_aura` requires the caller to own the token; `mint_avatar` is
  one per account (`avatar:<account>`), self-paid.
- **Vouchers.** The Ed25519 signature covers contract id, network, claim id, receiver, edition and expiry; the
  receiver must be the caller (with the relayer, NEP-366 keeps the player as predecessor); an unknown edition
  panics; expiry is enforced only for the first redemption, so a retry of an already minted claim after expiry
  returns the same token instead of failing (`retried_redeem_after_expiry_returns_the_same_token`); a retry with
  changed receiver or edition panics ("Claim parameters changed"). Claims survive transfers.
- **Storage.** Every mint measures storage before the first write (counter, claim record, token, metadata,
  enumeration) and `refund_deposit_to_account` requires the full cost and refunds the excess to the
  predecessor in the same call; a mint without deposit panics before any state is kept. The largest token
  (an Aura with a 1 KB data URI) costs well under the relayer's fixed 0.05 NEAR. A replayed claim refunds the
  whole deposit. Storage prefixes (`t m e a c s w w2 q2`) were checked for collisions, including `w` vs `w2`
  (impossible: the borsh length prefix of an account id can never start with `0x32`).
- **Invariants.** 256 per edition, token ids unique (`aura:<edition>:<n>`, `avatar:<account>`), only `aura:`
  tokens can be equipped, transfers clear the sender's slots before moving, a returned `nft_transfer_call`
  clears whatever the receiver equipped meanwhile.
- **Standards.** Core, approval and enumeration come from `near-contract-standards` 5.30.0 unchanged (1 yocto on
  transfers, approval storage paid by the approver). `nft_mint` events are emitted once per mint
  (`internal_mint_with_refund` does not emit its own). Metadata spec `nft-1.0.0`. No NEP-199 payout: fine for the
  slice, needed before the market goes to mainnet.
- **Funds.** The contract holds no user money besides paid storage; no panic path can strand a deposit (all
  asserts run before or within the same receipt as the refund).

## Outside this contract, still needed for mainnet

- `server/native/collectibles` still refuses a non-`.testnet` contract id (`tests/native-collectibles.test.mjs`
  expects "testnet-only"); that belongs to the network refactor in `MAINNET-PLAN.md` section 3.
- Testnet does not need an upgrade: the change keeps state layout and testnet behaviour byte-for-byte; only
  `clear_award_signer` and the claim-id check are new.

## Reproduce the hash

```bash
bash scripts/build-contracts.sh          # prints and checks the collectibles sha256
sha256sum contracts/target/wasm32-unknown-unknown/release/questlayer_collectibles.wasm
```

If the contract changes, it needs a new review, then `node scripts/collectibles-wasm-sha256.mjs --write`.

## Catalog v2 editions (2026-11-01) — awaiting re-review

The contract changed after this review: `AURA_EDITIONS` replaces the hard-coded `polar`/`moon`/`gold` match in `redeem_aura` and `next_aura`, six editions were added (`ember`, `dew`, `bloom`, `storm`, `comet`, `nova`), and a `supported_editions` view was added. There is no state or schema change (still V3, no migration), the voucher message and `network()` handling are unchanged, and the PR #19 fixes (`.near` redeem, `clear_award_signer`) are intact. New build: `questlayer_collectibles.wasm`, 358,413 bytes, **sha256 `b2684b58ce5a3920091f377fc6a364de96ded0dd65af3add744c9105a73c36f7`**, recorded in `contracts/collectibles/WASM_SHA256`; the same toolchain reproduced the earlier `491183e3…` from the previous source. The mainnet gate needs a fresh independent read-through of this diff before deployment. Code storage rises by about 0.08 NEAR; 4 NEAR still covers it.
