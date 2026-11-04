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

## Catalog v2 editions (2026-11-01) — re-reviewed

The contract changed after this review: `AURA_EDITIONS` replaces the hard-coded `polar`/`moon`/`gold` match in `redeem_aura` and `next_aura`, six editions were added (`ember`, `dew`, `bloom`, `storm`, `comet`, `nova`), and a `supported_editions` view was added. There is no state or schema change (still V3, no migration), the voucher message and `network()` handling are unchanged, and the PR #19 fixes (`.near` redeem, `clear_award_signer`) are intact. New build: `questlayer_collectibles.wasm`, 358,413 bytes, **sha256 `b2684b58ce5a3920091f377fc6a364de96ded0dd65af3add744c9105a73c36f7`**, recorded in `contracts/collectibles/WASM_SHA256`; the same toolchain reproduced the earlier `491183e3…` from the previous source. Code storage rises by about 0.08 NEAR; 4 NEAR still covers it.

### Independent re-review (2026-11-01)

Reviewer did not write PR #19 or PR #32. Scope: `git diff ebadcd7 177fae7 -- contracts/collectibles` (source, six new asset files, `WASM_SHA256`). Result: **confirmed, no changes needed.** Reviewed sha256 is now **`b2684b58ce5a3920091f377fc6a364de96ded0dd65af3add744c9105a73c36f7`**.

- **Edition gate.** `aura_edition` is an exact string match over a fixed `const` table, used by both `redeem_aura` (title and media) and `next_aura` (the single counter/token-id path for `redeem_aura`, `mint_aura` and `mint_aura_once`). Unknown ids still panic ("Unknown edition", test `unknown_edition_is_still_rejected`). No edition can be added at runtime; the table is code, so it is covered by this hash.
- **Vouchers.** `award_message` is byte-for-byte unchanged and still binds contract, network, claim, receiver, edition and expiry; the signature is checked before the edition lookup, so an edition can't be swapped (`award_signature_cannot_change_edition`). Old vouchers for `polar`/`moon`/`gold` stay valid, and a voucher for a new edition signed against the old code simply panicked and refunded. The server only signs v2 editions after `supported_editions` lists them (`server/native/award-vouchers.mjs`), so no voucher is issued for an edition the deployed code can't mint.
- **Existing tokens and state.** `polar`/`moon`/`gold` keep their titles, media files (unchanged since `ebadcd7`) and `minted` counters; token ids stay `aura:<edition>:<serial>` with the 256 cap per edition. No storage layout or schema change (still V3), so the upgrade needs no migration. Edition ids are distinct, lowercase and colon-free, so token ids can't collide across editions.
- **`supported_editions`.** Pure view, no state read, no caller input.
- **Media.** All six new covers are 1,067-byte `data:image/svg+xml;base64` URIs; decoded, they contain no `<script>`, event handlers, `href`, `foreignObject` or `url(` references, so wallets render them as static art. Each edition's media is distinct (asserted in the new test).
- **Oracle path.** `mint_aura`/`mint_aura_once` now accept the six new ids too; that is oracle-only and the oracle already chooses metadata, so the trust model is unchanged.

Reproduced on Linux x86_64 with `bash scripts/build-contracts.sh --test` (Rust 1.97.0, path remapping): 358,413 bytes, sha256 `b2684b58…36f7`, matching `contracts/collectibles/WASM_SHA256`; all contract tests pass, and `tests/aura-catalog`, `award-vouchers`, `aura-art` pass (18/18). Known issue: builds on macOS aarch64 produce a different hash from the same source, so verify the reviewed hash on Linux x86_64 (as CI does) before a mainnet deploy.

## NPC and monster editions (N5, 2026-11-01) — re-reviewed

The contract changed after the catalog v2 review. Diff: `git diff b3d983b <this PR head> -- contracts/collectibles` (source plus six new asset files and `WASM_SHA256`).

- Six editions added to `AURA_EDITIONS` (`pilgrim`, `chronicle`, `ledger`, `wardbreaker`, `wisp`, `bossbane`); the table grows from 9 to 15 rows. Existing rows, titles and media files are unchanged.
- New `CLAIM_ONLY_EDITIONS` table (edition, required claim id prefix, description). `mint_claim` (shared by `redeem_aura` and the oracle's `mint_aura_once`) asserts the prefix before the replay check, and the claim-less oracle `mint_aura` refuses these editions ("This Aura is only earned from NPCs and monsters"). The prefixes are `earned:npc:` and `earned:monster:`; `redeem_aura` still also requires `earned:`.
- `redeem_aura` uses the edition's own description for claim-only editions ("Earned from a QuestLayer NPC." / "Earned by beating a QuestLayer monster.", plus " Testnet collectible." on testnet). Chest editions keep the old description byte for byte (`testnet_message_and_description_are_unchanged` still passes).
- New view `claim_only_editions` (pure, no state read).
- No state or schema change (still V3, no migration); the voucher message, `network()` and the 256 cap are unchanged.
- New tests: `npc_and_monster_editions_redeem_only_with_their_claim_prefix`, `npc_edition_rejects_a_plain_earned_claim`, `monster_edition_rejects_an_npc_claim`, `oracle_cannot_mint_npc_editions_without_a_claim`, `oracle_claim_mint_needs_the_prefix_too`, `oracle_claim_mint_with_the_prefix_works`.

Build (Linux x86_64, Rust 1.97.0, `bash scripts/build-contracts.sh`, same toolchain that reproduces `b2684b58…`): 367,066 bytes, sha256 `176f1b07…dee9`, recorded in `contracts/collectibles/WASM_SHA256` and `contracts/wasm-sha256.json`. Code storage rises by about 0.09 NEAR.

### Independent re-review (2026-11-01)

Reviewer did not write PR #52. Scope: `git diff b3d983b 5858c82 -- contracts/collectibles` (source, six new asset files, `WASM_SHA256`). Result: **confirmed, no changes needed.**

- **No free mint.** Every Aura still goes through `next_aura`, called from only two places: the oracle-only `mint_aura` and `mint_claim`. `mint_claim` is reached only from `redeem_aura` (Ed25519 award signature over contract, network, claim, receiver, edition, expiry, checked before any minting) and the oracle-only `mint_aura_once`. `mint_avatar` mints the explorer, not an Aura. No new public method can mint.
- **Claim-only gate.** `claim_only` is an exact match over a fixed `const` table, the same ids as the new `AURA_EDITIONS` rows. `mint_aura` refuses all six; `mint_claim` checks the prefix before the replay branch, so neither a fresh claim nor a replayed one can mint a claim-only edition without `earned:npc:` / `earned:monster:`. The monster prefix is not a prefix of the NPC one (or the reverse), so an NPC claim can't mint a monster edition (`monster_edition_rejects_an_npc_claim`). Ordinary editions are not gated, so old claims and their replays behave as before.
- **What the gate does and doesn't prove.** The prefix is part of the signed message, so a player can't change it, but the server chooses it (`awardClaimPrefix` in `server/aura-catalog.mjs`, from the catalog `source`). On-chain it therefore guarantees "the award signer or the oracle labelled this claim as NPC/monster", not that an NPC was actually met; a leaked award key or the oracle can still mint these editions (up to the 256 cap each). That is the same trust model as before, and `clear_award_signer` is still the kill switch. Informational, not a defect.
- **Oracle metadata.** `mint_aura_once` still takes the oracle's own `TokenMetadata`, so an oracle-minted NPC Aura gets whatever title/description the oracle sends rather than the fixed NPC text. Oracle-only, unchanged trust model; informational.
- **Existing tokens, equipment, signer.** No storage layout or schema change (`Collectibles` fields identical, still V3, no migration; `migrate`/`migrate_v3` untouched). `award_message`, `network()`, the 256 cap, the token id format, `set_award_signer`/`clear_award_signer`, equip/unequip and transfer code are unchanged. The nine existing rows, titles and media files are unchanged; chest editions keep their description byte for byte. New edition ids are distinct, lowercase and colon-free, so token ids can't collide.
- **Media.** The six new covers are distinct 1,067-byte `data:image/svg+xml;base64` URIs; decoded, they have no `<script>`, event handlers, `href`, `foreignObject` or `url(` references.
- **`claim_only_editions`.** Pure view over the const table; returns JSON pairs `[edition, prefix]`.

Reproduced on Linux x86_64 with native rustup Rust 1.97.0 and `bash scripts/build-contracts.sh` (path remapping): `questlayer_collectibles.wasm` 367,066 bytes, reviewed sha256 **`176f1b0777c52e0eb592e50f365fe6a0663b3bec29c4c1b7431649bc4428dee9`**, matching `contracts/collectibles/WASM_SHA256` and `contracts/wasm-sha256.json`. All 36 collectibles contract tests pass, and `tests/aura-catalog` and `award-vouchers` pass (14/14).

## Level editions L5–L10 (2026-11-01)

The contract changed after the N5 review. Diff: `git diff 26550b1 <this PR head> -- contracts/collectibles` (source plus six new asset files and `WASM_SHA256`). Owner approval: Lubos approved the level item editions on 1 Nov ("Ano, podle návrhu").

- Six editions added to `AURA_EDITIONS` (`stride`, `kindle`, `compass`, `quill`, `laurel`, `summit`); the table grows from 15 to 21 rows. Existing rows, titles and media files are unchanged.
- The same six are added to `CLAIM_ONLY_EDITIONS` with prefix `earned:level:` and the description "Earned by reaching QuestLayer level N." (5–10). The server already issues level claims as `earned:level:<sha256>` (`nativeLevelClaimId` in `server/native/progression.mjs`); the L2–L4 chest editions stay ungated, so existing level claims and their replays behave as before.
- The claim-only panic text is now "This Aura is only earned from NPCs, monsters or levels" (was "…from NPCs and monsters").
- No state or schema change (still V3, no migration); the voucher message, `network()`, the 256 cap and the token id format are unchanged.
- New and extended tests: the claim-prefix redeem test covers the six level editions, `level_edition_rejects_an_npc_claim`, `oracle_cannot_mint_level_editions_without_a_claim`; `supported_editions` lists 21.

Build (Docker `rust:1.97.0`, linux/amd64, `scripts/build-contracts-docker.sh`; every other contract reproduced its pinned hash byte for byte): `questlayer_collectibles.wasm` 374,130 bytes, sha256 `0edba150…59b9`, recorded in `contracts/collectibles/WASM_SHA256` and `contracts/wasm-sha256.json`. Code storage rises by about 0.07 NEAR. Until the testnet upgrade runs, `public/native-claims-testnet.json` and `public/native-editions-testnet.json` still describe the deployed `176f1b07…` build and are listed under `testnetDeploymentsNotFromThisBuild`; the upgrade script removes them.

### Independent re-review (2026-11-01)

Reviewer did not write this change. Scope: `git diff 26550b1 1d6ac40 -- contracts/collectibles` (source, six new asset files, `WASM_SHA256`). Result: **confirmed, no changes needed.**

- **No free mint.** The diff touches only the two `const` tables, the panic text and tests. Every Aura still goes through `next_aura`, reached only from the oracle-only `mint_aura` and `mint_claim`; `mint_claim` is reached only from `redeem_aura` (Ed25519 award signature over contract, network, claim, receiver, edition, expiry, checked before minting) and the oracle-only `mint_aura_once`. No new public method.
- **Claim-only gate.** `claim_only` is still an exact match over the fixed table; the six new ids match the new `AURA_EDITIONS` rows. `mint_aura` refuses all six, and `mint_claim` checks `earned:level:` before the replay branch, so neither a fresh nor a replayed claim can mint a level edition without it (`level_edition_rejects_an_npc_claim`, `oracle_cannot_mint_level_editions_without_a_claim`). The signature binds the edition, so a signed L2–L4 `earned:level:` claim for `polar`/`moon`/`gold` can't be redeemed as `summit`.
- **Server claim ids can't satisfy `earned:level:` by accident.** Chest vouchers are `earned:` + `aura_<uuid>`, NPC `earned:npc:…`, monster `earned:monster:…`, trader stock `earned:npc-stock:…` (`server/npc/trader-keeper.mjs` `stockClaimId`); none starts with `earned:level:`. Only `nativeLevelClaimId` (`earned:level:` + sha256 over policy, network, source contract, contract, account, level) and `awardClaimPrefix` for catalog `source: "level"` produce it. No server path creates a demo inventory item of a level edition (chests use `source: "chest"` editions only, trader stock and trade-ups use `TRADABLE` chest editions, hunt grants use fixed monster editions), so `award-vouchers.mjs` never signs a level-prefixed voucher in practice. Same trust model as N5: the gate proves the award signer or oracle labelled the claim as a level claim, not that the level was reached; `clear_award_signer` stays the kill switch. Informational.
- **Existing level claims.** `polar`, `moon` and `gold` are not in `CLAIM_ONLY_EDITIONS`, so L2–L4 `earned:level:<sha>` claims and their replays behave as before.
- **Existing tokens, schema, signer.** No storage layout or schema change (`Collectibles` fields identical, still V3; `migrate`/`migrate_v3` untouched). `award_message`, `network()`, the 256 cap, the token id format and the 15 existing rows, titles, descriptions and media files are unchanged. New ids are distinct, lowercase and colon-free.
- **Media.** The six new covers are distinct 1,066-byte `data:image/svg+xml;base64` URIs in the existing halo template (only the accent colour differs); decoded, they contain only `svg`, `path` and `ellipse` with geometry and paint attributes: no `<script>`, event handlers, `href`, `foreignObject` or `url(` references.

Reproduced on Linux x86_64 in Docker `rust:1.97.0` (`linux/amd64`) with `bash scripts/build-contracts.sh --no-check`: `questlayer_collectibles.wasm` 374,130 bytes, matching `contracts/collectibles/WASM_SHA256` and `contracts/wasm-sha256.json`. All 38 collectibles contract tests pass, and `tests/aura-catalog`, `award-vouchers`, `native-progression` and `levels` pass (35/35). Reviewed sha256 **`0edba1506f14de0afde3601bd52f6131c1e7753cbd550767c522460ca8c559b9`**.

## Patron and season editions (2026-11-02)

The contract changed after the L5–L10 review. Diff: `git diff 1f23d9c <this PR head> -- contracts/collectibles` (source plus two new asset files and `WASM_SHA256`). Owner approval: patron edition with the patron quest lines (GAME-LOOPS P1-1) and the hackathon season with a season Aura (P1-3), both settled 1 Nov 2026 (PR #84, no-ask mode for testnet).

- Two editions added to `AURA_EDITIONS`: `patron` ("Patron's Lantern") and `season` ("Hackathon Pennant"); the table grows from 21 to 23 rows. Existing rows, titles and media files are unchanged.
- The same two are added to `CLAIM_ONLY_EDITIONS`: `patron` with `earned:npc:` ("Earned from a QuestLayer NPC.", like the other NPC editions) and `season` with the new prefix `earned:season:` ("Earned in a QuestLayer season."). The server's `awardClaimPrefix` maps catalog `source: "season"` to `earned:season:`.
- The claim-only panic text is now "This Aura is only earned from NPCs, monsters, levels or seasons" (was "…NPCs, monsters or levels").
- No state or schema change (still V3, no migration); the voucher message, `network()`, the 256 cap and the token id format are unchanged.
- Tests: the claim-prefix redeem test covers both, `season_edition_rejects_a_level_claim`, `patron_edition_rejects_a_season_claim`, `oracle_cannot_mint_season_or_patron_editions_without_a_claim`; `supported_editions` lists 23. All 41 collectibles contract tests pass.

Build (Docker `rust:1.97.0`, linux/amd64, the `scripts/build-contracts-docker.sh` command; every other contract reproduced its pinned hash byte for byte): `questlayer_collectibles.wasm` 376,458 bytes, sha256 `e2a41b19…31e9`, recorded in `contracts/collectibles/WASM_SHA256` and `contracts/wasm-sha256.json`. Code storage rises by about 0.03 NEAR. Until the testnet upgrade runs, `public/native-claims-testnet.json` and `public/native-editions-testnet.json` still describe the deployed `0edba150…` build and are listed under `testnetDeploymentsNotFromThisBuild`; the upgrade script removes them.

### Independent re-review (2026-11-02)

Reviewer did not write this change. Scope: `git diff 1f23d9c 9ad3e3d -- contracts/collectibles` (source, two new asset files, `WASM_SHA256`). Result: **confirmed, no changes needed.**

- **No free mint.** The diff touches only the two `const` tables (21→23 and 12→14 rows), the panic text and tests. Every Aura still goes through `next_aura`, reached only from the oracle-only `mint_aura` and `mint_claim`; `mint_claim` is reached only from `redeem_aura` (Ed25519 award signature over contract, network, claim, receiver, edition, expiry, checked before minting) and the oracle-only `mint_aura_once`. No new public method.
- **Claim-only gate.** `claim_only` is still an exact match over the fixed table; `patron` and `season` match the new `AURA_EDITIONS` rows. `mint_aura` refuses both, and `mint_claim` checks the prefix before the replay branch, so neither a fresh nor a replayed claim can mint `patron` without `earned:npc:` or `season` without `earned:season:` (`season_edition_rejects_a_level_claim`, `patron_edition_rejects_a_season_claim`, `oracle_cannot_mint_season_or_patron_editions_without_a_claim`). The signature binds the edition, so a signed claim for another edition can't be redeemed as either.
- **Server claim ids can't satisfy `earned:season:` by accident.** Chest vouchers are `earned:` + `aura_<uuid>` (`id()` in `server/domain.mjs`), NPC rolls `earned:npc-roll:…` / `earned:npc:roll:…` (`rollClaimId`), trader stock `earned:npc-stock:…` (`stockClaimId`), level claims `earned:level:<sha256>` (`nativeLevelClaimId`), NPC and monster editions `earned:npc:` / `earned:monster:` + `aura_<uuid>`; none starts with `earned:season:`. Only `awardClaimPrefix` for catalog `source: "season"` produces it, and the only server path that creates a season-edition item is `awardEditionOnce(…, "season:<id>")` in `server/season/service.mjs` after the goal check, once per player and edition. Trader stock and trade-ups use `TRADABLE` (chest editions only); roll prizes use chest editions plus `wisp`.
- **Patron uses the NPC trust model.** `patron` has catalog `source: "npc"`, so `award-vouchers.mjs` signs `earned:npc:aura_<uuid>` for a Patron's Lantern in the player's inventory, exactly as for `pilgrim`, `chronicle`, `ledger` and `wisp`; `rollClaimId` could also give `earned:npc:roll:…`, but no roll prize contains `patron`. Today no server path awards `patron` at all (no `awardEditionOnce(…, "patron", …)` or `grantEdition` caller for it), so no patron voucher is signed until the patron quest lines ship. As with N5 and L5–L10, the gate proves the award signer or oracle labelled the claim, not the in-game deed; `clear_award_signer` stays the kill switch. Informational.
- **Existing tokens, schema, signer.** No storage layout or schema change (`Collectibles` fields identical, still V3; `migrate`/`migrate_v3` untouched). `award_message`, `network()`, the 256 cap, the token id format and the 21 existing rows, titles, descriptions and media files are unchanged. New ids are distinct, lowercase and colon-free. No server or test code matches on the old panic text.
- **Media.** The two new covers are distinct 1,066-byte `data:image/svg+xml;base64` URIs (1,067 bytes with the trailing newline, trimmed on mint), 779 bytes decoded, in the existing halo template: with hex colours masked they are byte-identical to `summit`, only the accent differs (`#ffd01f` patron, `#4fc3ff` season). Decoded, they contain only `svg`, `path` and `ellipse` with geometry and paint attributes: no `<script>`, event handlers, `href`, `foreignObject`, entities or `url(` references.

Reproduced on Linux x86_64 in Docker `rust:1.97.0` (`linux/amd64`) with `bash scripts/build-contracts.sh --no-check`: `questlayer_collectibles.wasm` 376,458 bytes, matching `contracts/collectibles/WASM_SHA256` and `contracts/wasm-sha256.json`. All 41 collectibles contract tests pass, and `tests/aura-catalog`, `award-vouchers`, `npc-editions` and `season` pass (25/25). Reviewed sha256 **`e2a41b19830c79a25d42634d618e89dd09d6f75305a8e0573070f7a6f8d531e9`**.

## NEP-199 royalties (2026-11-04)

The contract changed after the patron and season review. Diff: `git diff e2be467 <this PR head> -- contracts/collectibles`
(source and `WASM_SHA256`). Owner approval: Lubos approved the QGOLD tokenomics on 4 Nov 2026 12:58, including
Mintbase/Paras integration and 2 % on P2P trades to the treasury (thread "Put every trade on chain"); testnet only.

- New owner-only `set_royalty(royalty: Option<Royalty>)`: 1 yocto, predecessor must be `tokens.owner_id`, `bps` in
  1..=1000 (at most 10 %); `None` removes it. `get_royalty()` reads it.
- The royalty is stored with `env::storage_write` under the raw key `b"royalty"`, outside the Borsh `Collectibles`
  struct, so the state layout and schema 3 are unchanged and the upgrade has no migration. No collection prefix in
  this contract starts with `royalty`.
- New NEP-199 views and calls: `nft_payout(token_id, balance, max_len_payout)` and
  `nft_transfer_payout(receiver_id, token_id, approval_id, memo, balance, max_len_payout)`. The split is computed for
  the current owner before the transfer, then the contract's own `NonFungibleTokenCore::nft_transfer` runs, so every
  existing transfer rule holds (1 yocto, owner or approved account with the matching approval id, equipment cleared,
  events).
- Split: `cut = balance / 10_000 * bps + balance % 10_000 * bps / 10_000` (no overflow for any u128), the owner gets
  `balance - cut`, so the parts always sum to `balance`. No royalty entry when the cut is 0 or when the payee is the
  seller. More receivers than `max_len_payout` panics ("Too many payout receivers"); there are at most 2.
- Tests: `royalty_payout_pays_the_treasury_share_and_the_rest_to_the_owner` (split, rounding, `u128::MAX`, a market
  `nft_transfer_payout` after `nft_approve`, payee selling its own Aura, off again), `royalty_payout_respects_max_len`,
  `only_the_owner_sets_the_royalty`, `royalty_is_capped_at_ten_percent`. All 45 collectibles contract tests pass.

Build (rust 1.97.0 on linux x86_64, `bash scripts/build-contracts.sh --no-check`, the same command the Docker build
runs; every other contract reproduced its pinned hash byte for byte): `questlayer_collectibles.wasm` 398,418 bytes,
sha256 `52edcff46ee1a6d55bb5833838637ae4bcb986b5c0ee2620086665a9f4f96a16`, recorded in `contracts/collectibles/WASM_SHA256` and
`contracts/wasm-sha256.json`. Code storage rises by about 0.22 NEAR (22 KB). Until the testnet upgrade runs,
`public/native-claims-testnet.json` and `public/native-editions-testnet.json` still describe the deployed `e2a41b19…`
build and are listed under `testnetDeploymentsNotFromThisBuild`; the upgrade script removes them.

### Independent re-review (2026-11-04)

Reviewer: a separate review agent that did not write this change, given the diff and the Mintbase facts but not the
author's conclusions. Scope: `git diff e2be467 -- contracts/collectibles/src/lib.rs`. Result: **confirmed, no changes
needed.**

- **Access.** Only `tokens.owner_id` can set or clear the royalty (1 yocto enforced); no other path writes the
  `royalty` key. The 1..=1000 bps cap holds.
- **Exact split.** With `balance = q·10_000 + r`, the cut `q·bps + r·bps/10_000` equals `floor(balance·bps/10_000)`,
  never exceeds `balance` and no product overflows u128 (also with overflow checks on), so the parts sum to `balance`
  exactly. The JSON is the NEP-199 shape `{"payout": {"<account>": "<u128 string>"}}`.
- **Transfer rules.** `nft_transfer_payout` reads the owner, computes the split and calls the contract's own
  `nft_transfer` (equipment cleared, 1 yocto, owner or approved sender with a matching approval id, owner ≠ receiver,
  `NftTransfer` event) in the same receipt, so a payout is never returned without the transfer. There is no
  transfer-time soulbound rule in this contract; claim-only editions limit minting only.
- **Storage.** No collision: the existing prefixes are `t`/`tv`/`tn`, `m`, `e`, `a`, `an`, `c`, `s`, `w`, `w2`, `q2`
  and `STATE`; `migrate`/`migrate_v3` touch only `STATE`. The ~100-byte record costs the contract about 0.001 NEAR.
- **Gas.** Estimated about 4 TGas (a real equipment-clearing `nft_transfer` on this contract plus one storage read
  and the JSON result), well within the 15 TGas Mintbase attaches. Estimate, not measured on the market.
- **Mintbase ban risks.** None found: the payee selling drops the royalty entry (no duplicate keys), a zero cut is
  skipped, at most 2 entries against Mintbase's 50. Informational: the payee account must exist or Mintbase's
  transfer to it bounces; the royalty script creates it before `set_royalty`. Informational: `set_royalty({})`
  without an argument also clears the royalty (serde reads a missing `Option` as `None`); owner-only, so left as is.

Reproduced on Linux x86_64 with rust 1.97.0 (`bash scripts/build-contracts.sh --no-check`, and again from a clean
target directory): `questlayer_collectibles.wasm` 398,418 bytes, matching `contracts/collectibles/WASM_SHA256` and
`contracts/wasm-sha256.json`. All 45 collectibles contract tests pass. Reviewed sha256
**`52edcff46ee1a6d55bb5833838637ae4bcb986b5c0ee2620086665a9f4f96a16`**.

## Reproducible builds in CI

The `reproducible-contracts` CI job builds every contract with `scripts/build-contracts-docker.sh` (Docker `rust:1.97.0`, `linux/amd64`), uploads the WASM files and `SHA256SUMS` as the `contract-wasm-linux-amd64` artifact, and runs `scripts/check-wasm-hashes.mjs`. It fails when any WASM differs from `contracts/wasm-sha256.json`, when the collectibles WASM differs from `contracts/collectibles/WASM_SHA256` or the last reviewed hash above, or when a `wasmSha256` in `public/native-*-testnet.json` is neither a current build nor listed with its exact hash under `testnetDeploymentsNotFromThisBuild` (older testnet deployments built before path remapping). A `codeHash` next to it must be the base58 of the same sha256. On macOS run `npm run contracts:docker`; after an intended contract change, `npm run contracts:docker -- --write` (or copy the hashes from the CI job summary). Deploy only the Docker or CI artifact.
