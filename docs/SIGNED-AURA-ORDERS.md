# Signed Aura orders (market version 2) — testnet

Version 2 of the QuestLayer market (`contracts/market`) adds off-chain **signed listings and offers** for Auras. Players sign exact order terms with their NEAR wallet's NEP-413 `signMessage`. Anyone can relay the signed order, and the market contract verifies it and settles through its existing escrow. The version 1 fixed-price listings keep working unchanged.

This is a QuestLayer market, **not a NEAR Intents integration**. The compatibility section below says which parts match Intents and which do not.

## Order format

The wallet signs the following JSON as the NEP-413 `message`. The keys appear in this order, with no extra whitespace:

```json
{"standard":"questlayer_aura_order","version":1,"kind":"sell","network":"testnet",
 "market":"<market>.testnet","nft_contract":"nfts.<operator>.testnet","maker":"alice.testnet",
 "token_id":"aura:polar:1","price":"10000000000000000000000000","deadline_ms":"1793003600000","epoch":0}
```

The signed envelope is `{message, nonce (32 bytes, base64), recipient (= market contract id), callback_url, public_key ("ed25519:…"), signature (base64)}`. The contract computes `sha256(borsh(u32 2147484061) ++ borsh({message, nonce, recipient, callback_url}))`, which is the standard NEP-413 digest, and checks it with `ed25519_verify`.

The cross-language test fixture in `tests/fixtures/signed-aura-order.json` is signed in Node. The Rust test verifies it, and produces **byte-identical** signature bytes from the same seed.

| Field | Meaning |
|---|---|
| `kind` | `sell`: the maker sells an escrowed Aura. `buy`: the maker offers NEAR from deposited market credit. |
| `price` | The exact price in yoctoNEAR, from 0.001 to 1000 test NEAR. There is no rounding and no partial fill. |
| `deadline_ms` | The order expiry. The contract rejects an expired order, and rejects any deadline more than 30 days ahead. |
| `epoch` | Must equal the maker's current epoch. Changing the epoch cancels all of the maker's orders at once. |
| `nonce` | 32 random bytes. The contract records each used or cancelled nonce for each maker. |
| `recipient`, `market`, `network`, `nft_contract` | These bind the order to this exact market, collection and network. |

## Lifecycle

1. **Register a signing key.** Call `add_signing_key(public_key)` with 1 yoctoNEAR. The deposit forces a full-access key, so an app's function-call key cannot register one. Each account can register up to 4 ed25519 keys. A contract cannot read another account's access keys, so it relies on this registry. NEAR Intents uses the same model with `add_public_key`.
2. **Escrow.** Sellers call `nft_transfer_call` with the message `{"deposit":true}`. The Aura stays in market escrow as `deposited`, and only a signed order can move it. Buyers call `deposit_near()` to fund offers. **A signature alone never escrows anything.**
3. **Fill.**
   - `fill_sell_order(order)`: the buyer attaches the exact signed price.
   - `fill_buy_order(order)`: the escrowed Aura's owner accepts an offer, and the buyer's deposited credit pays.
   - In both cases the nonce is consumed **before** the NFT transfer, the Aura becomes `filling`, and the price goes into escrow.
4. **Settle.** The `on_fill` callback runs after the NFT transfer. If the transfer succeeds, the seller is credited. If it fails, the buyer's NEAR becomes withdrawable credit and the Aura returns to `deposited` for its owner. The consumed nonce is never revived.
5. **Cancel.**
   - `cancel_order(order)` consumes one nonce on chain. Only the maker can call it.
   - `cancel_all_orders()` advances the maker's epoch.
   - `remove_signing_key(key)` invalidates every order signed with that key. It also advances the epoch, so re-adding the key cannot revive those orders.
   - These cancel the actual on-chain right, not a database row.
6. **Withdraw.** `cancel(token_id, listing_id)` returns an escrowed Aura. `withdraw()` pays out NEAR credit. If either transfer fails, the escrow or credit is restored and the call can be retried.

The fill-race rule is that the first fill moves the Aura to `filling`, and every other fill, cancellation or legacy `buy` then fails. Pausing the market blocks new fills and deposits, but cancellations and withdrawals stay open.

The conservation invariant `funded = escrow + credits + withdrawing + withdrawn` is unchanged, and the contract asserts it after every state change.

**Storage limits.** The sponsored testnet storage is bounded:

- 128 escrowed listings
- 256 market participants
- 256 signers
- 1024 retained nonces

Anyone can call `prune_nonces(limit)` to remove nonces whose order deadline has passed. An expired order can never verify again, so pruning cannot enable a replay.

## Order relay

`GET /api/native/market/orders` and `POST /api/native/market/orders` (with body `{order}`) run a small off-chain index. The server first verifies the order locally (`server/native/signed-orders.mjs`), then calls the contract's `check_order` view. It keeps only orders the contract accepts, and re-checks them each time they are listed.

The index lives in memory, is bounded, and is lost when the server restarts. It is a convenience: the contract is the authority. The server holds no player key and signs nothing.

## Upgrade (testnet, on the operator's Mac)

```bash
bash scripts/build-contracts.sh
node scripts/upgrade-market-v2-testnet.mjs --dry-run   # snapshot + preconditions
node scripts/upgrade-market-v2-testnet.mjs --prove     # deploy+migrate atomically, then live proof
```

The script works in this order:

1. It snapshots the stats and all listings to `output/qa/W07-signed-orders/pre-upgrade-snapshot.json`.
2. It refuses to upgrade while any purchase, cancellation or withdrawal is still in flight.
3. It deploys the code and calls `migrate` in **one transaction**, so a failed migration leaves version 1 intact.
4. It asserts that balances and listings are unchanged.

With `--prove`, it then runs the following on chain with the two developer accounts (the operator and `explorer.<operator>`):

- a filled sell order
- a rejected replay
- a cancelled order and its rejected fill
- a filled buy offer
- withdrawals

The evidence goes to `public/native-signed-orders-testnet.json`. The developer CLI signs the NEP-413 digest directly, standing in for a browser wallet's `signMessage`.

## NEAR Intents compatibility

Sources: [Verifier introduction](https://docs.near-intents.org/integration/verifier-contract/introduction), [signing intents](https://docs.near-intents.org/integration/verifier-contract/signing-intents), [intent types](https://docs.near-intents.org/integration/verifier-contract/intent-types-and-execution) and [account abstraction](https://docs.near-intents.org/integration/verifier-contract/account-abstraction). These were read on 1 November 2026.

| Aspect | QuestLayer v2 | NEAR Intents Verifier | Compatible? |
|---|---|---|---|
| Signature envelope | NEP-413, ed25519, `recipient` = market | NEP-413 is one of several standards; `recipient` = `intents.near` | **Same standard and same wallet API.** The signature itself is not reusable, because the recipient differs by design. |
| Key model | `add_signing_key` / `remove_signing_key` registry | `add_public_key` / `remove_public_key` registry | Same model. The keys are registered separately on each contract. |
| Message body | `questlayer_aura_order` terms | `{signer_id, deadline (ISO 8601), intents:[…]}` | **No.** The Verifier would not accept a QuestLayer order. `intentsTokenDiffSketch()` shows the equivalent `token_diff` shape, labelled `unverified-sketch`. |
| Nonce | 32 random bytes, kept until the deadline, then prunable | 32 bytes as `[4-byte salt][28 bytes]`, with a rotating contract salt | Same size. The structure differs. |
| Settlement asset | Native NEAR attached or deposited in the market | Balances held inside the Verifier, with wNEAR as an NEP-141 token | **No.** An Intents path needs wNEAR wrapping and Verifier deposits. |
| NFT support | Escrowed NEP-171 Auras | `nft_withdraw` exists. The docs do not show the NEP-171 token-id format or NFTs inside `token_diff`. | **Unproven.** It must be confirmed against the pinned Verifier source. |
| Matching | Taker fills one maker order on chain | A solver bundles opposite `token_diff` intents in `execute_intents` | Different. |
| Deployment | Our testnet contract | The canonical Verifier is mainnet-only (rule I10) | There is **no official testnet Intents endpoint**. |

**Conclusion.** QuestLayer orders use the Intents **signing standard and key model**. They are not executable NEAR Intents, and no Intents verifier, testnet or mainnet, has executed any of them. The canonical NFT/wNEAR exchange through `intents.near` is still the separate W14 mainnet gate (rule I10), and it needs explicit approval. A self-deployed Verifier on testnet would only be an experimental compatibility test.

## Player UI

`src/SignedOrdersPanel.tsx` sits inside the secured market screen. The explorer's device key signs orders silently with NEP-413 (`src/signed-order.ts`), so there is no wallet popup.

A test shows the bytes are identical along the whole path: near-api-js `signNep413Message`, then the Node helper, then the Rust contract.

Who pays follows [RELAYER.md](RELAYER.md):

- **Relayed (free to the player):** registering the key, escrowing an Aura, cancelling one order or all of them, returning an escrowed Aura, and withdrawing.
- **Self-paid (the player pays the price or deposit, plus gas):** buying through a sell order, accepting an offer, and funding an offer.

The order view lists open orders from other explorers, offers on Auras the player holds in escrow, and a make-offer form for Auras that others hold in escrow. It also shows the player's own orders with these states: pending, open, filled, cancelled, expired and rejected. Those states come from `check_order`, and this device keeps the history.

Accounts linked only through an external wallet keep the fixed-price flow. UI evidence is in `output/qa/W07-signed-orders/`.

## Not done yet

- External-wallet `signMessage` for signed orders
- Physical-device testing
- A persistent order index
- Indexing of on-chain events
- Royalties
- A reviewed mainnet storage and key policy
