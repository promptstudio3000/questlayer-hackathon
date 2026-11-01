# Native public explorer profiles

## Scope

QuestLayer can publish an optional public explorer profile through the canonical NEAR SocialDB testnet contract, `v1.social08.testnet`. This is a real wallet-signed chain operation, separate from the demo GOLD economy. The server never signs it and does not receive a player signing key.

The implementation uses SocialDB's existing `get`, `set`, `storage_balance_of` and `storage_balance_bounds` interfaces. Reference: [official SocialDB documentation](https://github.com/NearSocial/social-db/blob/master/README.md). The testnet deployment is checked against its observed code hash, `B5Yf5EquM36fGu3JNAD2K83fT6L4dpzcx8mYLnkjJJbS`; a different deployment pauses publishing until reviewed. The configured RPC must identify its chain as `testnet`.

## Data and consent

Only the signing account's `<account>/questlayer/profile` namespace is written. Global SocialDB profile fields and other application namespaces are untouched. The string leaves are:

| Field | Meaning |
| --- | --- |
| `schema` | `1` |
| `name` | The current game alias, 2–24 characters |
| `avatar_contract` | QuestLayer's native testnet collectible contract, or an empty string |
| `avatar_token_id` | The currently owned starter NFT reference, or an empty string |
| `updated_at` | Publication preparation timestamp in milliseconds |
| `mutation_id` | A random publication identifier used for confirmation and duplicate-history prevention |

No GPS, game player identifier, balance, inventory listing, passkey, original EVM link or private key is included. The NEAR account address is necessarily public as the namespace and transaction signer. Existing public data and blockchain transaction history remain public; this feature does not promise erasure of historical publications.

The Inventory card shows the alias, selected wallet, exact avatar reference if currently owned, and wallet attachment before the signing request. Consent starts unchecked and resets when the wallet changes. No profile is automatically published during sign-in or minting. Cancelling a wallet request preserves the choice for the same account.

## Storage and transaction flow

The observed testnet minimum registration balance is 0.02 test NEAR. A new or low-credit account attaches 0.05 test NEAR to `set`; this becomes that account's SocialDB storage balance. Unused credit remains there, unlike an NFT mint's automatic deposit refund. With at least 0.01 test NEAR available credit, publication attaches one yoctoNEAR. Network gas is additional. The client verifies the exact reviewed alias and avatar, the six-field allowlist, nested app namespace, account, receiver, network and bounded attachment. A changed avatar between review and preparation requires a refreshed review.

1. Require a currently linked, verified NEAR account and explicit public consent.
2. Read the testnet contract, storage credit and current starter ownership. Preparation has no chain side effect.
3. The selected player's wallet signs `set`, with 80 Tgas and the bounded attachment.
4. Re-read finalized SocialDB state and require the exact publication identifier.
5. Record one zero-GOLD history entry. Repeated confirmation cannot create duplicate history or a reward.

Reads distinguish unpublished, recognized and unsupported schema states. NFT reference verification is refreshed independently of the published record: transferring an NFT does not leave a permanent claim of current ownership. In-flight results for a previous wallet cannot replace the selected wallet's card.

## Explorer account (no popup), 1 November 2026

When the invisible explorer account is ready, the profile card selects it by default and publishes through the
relayer: no wallet popup and no fee for the player (the relayer policy allows `set` on the SocialDB contract with a
1 yocto or 0.05 NEAR storage deposit, only into the signer's own namespace). Any other linked wallet still asks its
wallet app. The same path keeps map notes as public records: the author opens a note's menu, chooses "Public record",
sees its state (not published, pending, published, changed since, marked removed), the photo's `ipfs://` address and
pin state, ticks both the public and the permanence boxes, and publishes or marks the record removed (tombstone).
Client checks live in `src/note-record.ts` (exact namespace, fields, deposit and kind) with tests in
`tests/note-record.test.mjs`; the dialog is `src/NoteRecordDialog.tsx`.

Presence states: the map chip shows "Going visible…" until the server confirms the lease, a failed first lease
turns sharing off with a message, and a server-side stop says so. Blocked players never see each other's position.

## Recorded proof

`scripts/prove-native-profile-testnet.mjs` uses only the project's own locally stored developer testnet key. It signs NEP-413 to the app, prepares the profile through the actual app API, submits a real SocialDB transaction, confirms finalized state through the API, repeats confirmation and checks history and unchanged demo balance. No wallet secret is uploaded.

Initial transaction: `8MxWn5jpnSptfKntufo58F4e7PpHWWQ9P6RU6eQj39wy`. The 0.05 test NEAR attachment left 0.02593 test NEAR available storage credit after publication. The owned native starter reference was verified. Evidence: `output/qa/W03-profiles/local-native-profile.json` and `public/native-profile-testnet.json`.

The deployed application was independently exercised through its public API in release `20261031T065854Z` / `4319622`. Transaction `3hjKzEjkv2HszKBGxH5oovgQGBCE7mf3WcDz6oHU87LT` attached one yoctoNEAR, reused the existing storage credit and confirmed the owned avatar and single history entry. Evidence: `output/qa/W03-profiles/public-native-profile.json`. The public Inventory card was also observed in the browser; that observation did not approve a player-wallet transaction.

The development-only layout fixture has explicit mock accounts, mock storage and a simulated cancellation. It never invokes a wallet or chain transaction and is excluded from release artifacts. It exists to exercise consent, wallet changes, small screens and enlarged text; it is not evidence of a browser-wallet approval.

Application checks: 78 tests passed, including adversarial quote scopes, changed aliases/assets, unknown fields, unlinked access and missing consent. Browser layout checks cover 360×640, 390×640 with 20px text, and 844×390. They confirm default-off consent, preserved choice after simulated cancellation and reset on changing wallets. Essential text and controls were increased where the review found inherited small styles.

## Remaining work

- Hardware/browser-wallet and physical-phone approval flows remain unverified.
- Native passkey account creation, bounded delegation, independent recovery and revocation remain separate W03 requirements. A demo passkey is not a native NEAR account.
- Current-profile removal and optional user-controlled export need a dedicated wallet-signed flow. Historical on-chain publications cannot be erased.
- No GPS, messages, pictures, private identity data or financial state should be added to this public namespace without a separate design and explicit consent.
- No mainnet deployment or mainnet deposit is enabled by this work.
