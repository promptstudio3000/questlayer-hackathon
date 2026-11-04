# Aura ↔ wNEAR through NEAR Intents (experimental, testnet)

4 November 2026. Status: **code merged, verifier not yet deployed.** The game
shows the panel only after `public/native-intents-testnet.json` exists, which
the Mac script below writes.

This is an **experimental compatibility test on our own copy of the NEAR
Intents verifier**, deployed on testnet from the open-source code. It is not
`intents.near` and it is not an official NEAR Intents endpoint (there is none
on testnet). The mainnet proof through `intents.near` is planned below and
needs Lubos's explicit go.

## What was verified against the source

The verifier is `contracts/defuse` from
[near/intents](https://github.com/near/intents), tag `defuse/v0.4.5`, commit
`16d04f6ec4401263f8914638710260da50bb46b0` (pinned in
`server/native/intents.mjs`, `INTENTS_SOURCE`). Reading that source settled
the open questions from [SIGNED-AURA-ORDERS.md](SIGNED-AURA-ORDERS.md):

| Question | Answer from the source |
|---|---|
| Can `token_diff` move NFTs? | **Yes.** Token ids are `nep171:<contract>:<token id>`; `token_diff` has an explicit rule that NFTs (and MTs with \|delta\| ≤ 1) pay **no fee** (`TokenDiff::token_fee`). |
| How do NFTs get in? | `nft_transfer_call` to the verifier; `msg` = receiving account, empty = the sender. |
| Message format | NEP-413 `message` = `{"signer_id","deadline" (RFC 3339),"intents":[…]}`; `recipient` = verifier account. |
| Signed payload | `{"standard":"nep413","payload":{message,nonce (base64),recipient},"public_key":"ed25519:…","signature":"ed25519:<base58>"}` |
| Nonce | Versioned V1: `5628f6c6 ‖ 00 ‖ salt[4] ‖ deadline i64 ns LE ‖ 15 random bytes`. The salt comes from `current_salt()`; the intent deadline may not exceed the nonce deadline. Legacy random nonces still work but are being phased out, so we use V1. |
| Init | `new({config:{wnear_id, fees:{fee, fee_collector}, roles}})`. Our copy: fee **0**, operator holds the admin roles. |
| Settlement | `execute_intents(signed: [...])` is permissionless; `simulate_intents` is a free dry run that reports unmatched deltas. |

`tests/near-intents.test.mjs` pins these byte layouts (server helpers and the
browser builders produce identical bytes).

## How a trade works

```
seller (device key)                     buyer (device key)
  │ add_public_key (relayed, 1 yocto)     │ add_public_key (relayed)
  │ nft_transfer_call → verifier          │ wrap: storage_deposit + near_deposit (self-paid)
  │   (relayed, own account only)         │ ft_transfer_call → verifier (relayed)
  │ signs token_diff {Aura −1, wNEAR +p}  │ signs token_diff {Aura +1, wNEAR −p}
  └──────────────► game order book ◄──────┘
                 solver = relayer account
          simulate_intents → execute_intents([sell, buy])
                 verifier settles both legs atomically
```

- **Primary path:** two opposite `token_diff` intents. A sell order names no
  buyer, so anyone can take it with one signed intent.
- **Fallback path:** two `transfer` intents (seller → buyer Aura, buyer →
  seller wNEAR) in the **same** `execute_intents` call, so it stays atomic.
  It needs both parties known in advance, which fits a direct deal or the
  NPC trader as counterparty. The plan's "two steps if NFTs fail" turned out
  unnecessary because the source supports NFTs in `token_diff`; the transfer
  pair is proven anyway.
- **Withdrawals** are signed `nft_withdraw` / `native_withdraw` intents back to
  the signer's own account, submitted by the solver: the player pays no gas,
  and wNEAR comes back as plain NEAR.

### Who can do what

- The **verifier** checks every signature, registered key, nonce, deadline and
  balance. The server cannot move anything a player did not sign.
- The **solver** is the existing relayer account. It only pays gas for
  `execute_intents` (deposit 0). Before sending it runs `simulate_intents` and
  refuses any batch that does not net to zero.
- The **relayer policy** (`server/relayer/policy.mjs`) sponsors only:
  `add_public_key`/`remove_public_key` (1 yocto) on the verifier,
  `nft_transfer_call` of an Aura to the verifier for the sender's own account,
  and `ft_transfer_call` of wNEAR to the verifier for the sender's own account.
  `near_deposit` (wrapping) and `storage_deposit` are self-paid.
- The **order book** (`server/native/intents-market.mjs`, module
  `intents-market` v1) is the durable copy of open signed intents. Each order
  is checked against the verifier when listed and before it is filled; a
  worker closes orders that expired, were used, lost their salt or are no
  longer funded. Limits: 256 open orders, 12 per maker, deadline ≤ 7 days.

Routes: `GET /api/native/intents`, `GET /api/native/intents/account?account=&publicKey=`,
`POST /api/native/intents/orders {signed}`, `POST /api/native/intents/fill {orderId, signed}`,
`POST /api/native/intents/withdraw {signed}`. Writes need a signed-in player.
`INTENTS_MARKET_ENABLED=0` turns the market off even with a manifest.

### Player UI

NEAR Intents is the **default market** (Lubos, 4 Nov): once the verifier
manifest exists, Market → Offers opens with the **NEAR Intents (test)** panel
and the older signed offers fold into an "Older market" section, so Auras
already escrowed there can still be traded or taken back. Without the manifest
the old market shows as before. The collection's Sell button switches to an
Intents sell in a follow-up from the "Put every trade on chain" thread (PR #161).
It is P2P: both players sign their own side and the verifier settles both legs
in one transaction; the server only pairs orders and pays gas. Turn on → list an Aura for a wNEAR price → others buy
with one tap (the panel wraps and deposits missing wNEAR first) → withdraw
back to the account. Only the invisible explorer's device key can sign intents
for now; a linked external wallet would need one more reviewed flow.

## Deploy and prove on testnet (Mac, one command per step)

```bash
node scripts/intents-verifier-testnet.mjs --build
node scripts/intents-verifier-testnet.mjs
node scripts/intents-verifier-testnet.mjs --deploy
node scripts/intents-verifier-testnet.mjs --prove
```

1. `--build` clones near/intents at the pinned commit into
   `.data/vendor/near-intents` and builds it in the Docker image pinned by the
   verifier's own `Cargo.toml` (`sourcescan/cargo-near:0.22.0-rust-1.97.1@sha256:7467…`,
   `linux/amd64`), so the hash is reproducible. It prints the sha256.
2. No flag: a plan that sends nothing (account, funding, init args, balances).
3. `--deploy` creates `intents.<operator>.testnet`, funds it for code storage
   (1 NEAR per 100 kB + 3 NEAR), deploys and runs `new` in **one
   transaction**, registers the verifier with wNEAR storage, checks fee = 0
   and writes `public/native-intents-testnet.json`.
4. `--prove` uses the operator and `explorer.<operator>` (same pattern as the
   market v2 proof): registers keys, deposits an Aura and 0.01 wNEAR, settles
   Aura → wNEAR with two `token_diff`s, checks that a replay is rejected,
   trades back with the transfer pair, withdraws the Aura and the NEAR, and
   checks the Aura is back with its owner. Evidence goes to the manifest and
   `output/qa/near-intents/proof.json`.

Then deploy the VPS as usual; the server enables the panel from the manifest.
The relayer account needs a little extra gas budget for `execute_intents`
(~0.002 NEAR per trade on testnet).

## Mainnet proof (planned, NOT run, needs Lubos's go)

Checked read-only on mainnet RPC on 4 Nov 2026: `intents.near` has
`fee` = **1 pip** (0.0001 %), `current_salt` = `252812b3`.

Plan for one small trade between two project accounts:

1. Use two project mainnet accounts (operator and a second one). Budget:
   about 0.2 NEAR in total (one cheap mainnet Aura, 0.05 wNEAR price, gas,
   wNEAR storage 0.00125 NEAR). No player funds.
2. Read-only first: `has_public_key`, `current_salt`, and `simulate_intents`
   with the signed pair. Nothing is sent if the simulation reports unmatched
   deltas or rejects NFT deposits.
3. Fee: NFT legs pay nothing; the buyer's wNEAR leg must cover the 1-pip fee,
   so the buyer signs `−ceil(p / (1 − 0.000001))` while the seller receives
   `+p` (the verifier's `closure` rule). `auraTokenDiff` gets a `feePips`
   option before this runs; the simulation confirms the exact amount.
4. Send: `add_public_key` (both), `nft_transfer_call` of the Aura to
   `intents.near`, `near_deposit` + `ft_transfer_call` of wNEAR, then one
   `execute_intents` from the operator, then `nft_withdraw` / `native_withdraw`.
5. Record the transaction hashes in `public/native-intents-mainnet.json` and in
   the judge walkthrough.

What it proves: a game NFT traded for wNEAR through the canonical NEAR
Intents verifier. What it does not: a production market; the mainnet Aura
contract still needs its independent review (see MAINNET-PLAN).

## Deeper Intents ideas

| Idea | How | Status |
|---|---|---|
| **Deposit into the yield vault from any chain (1Click)** | 1Click (`https://1click.chaindefuser.com/v0`) swaps e.g. USDC on Ethereum/Solana/Base (`nep141:eth-0xa0b8…omft.near`, `nep141:sol-…omft.near`) to native NEAR USDC (`nep141:17208628…`). The game asks `/v0/quote` with `recipient` = the player's NEAR account, shows the deposit address, polls `/v0/status`, and when the USDC lands the player does a relayed `ft_transfer_call` into the yield vault (1Click cannot attach a `msg`, so this is two steps). `GET /v0/tokens` answered from the cloud on 4 Nov (215 assets). | Plan only: 1Click is mainnet-only and the yield vault is testnet-only and blocked for mainnet until its review. |
| **NPC trader as solver** | The NPC trader's account signs the opposite `token_diff` for orders inside its price band, so the solver can fill a player's sell or buy immediately. Its keys and budget rules already exist (NPC-TRADERS.md); it only needs `add_public_key` on the verifier and a funded verifier balance. | Next step after the testnet proof. |
| **Pay rewards in any token** | The rewards contract pays wNEAR into the player's verifier account; the player signs a `token_diff` against a market maker (or 1Click on mainnet) to receive USDC or another token. | Idea. |
| **Market v2 orders → intents** | Market v2 already uses the same NEP-413 envelope and key-registry model; a v3 could settle through the verifier instead of its own escrow. | Idea; the experimental panel is the first step. |

## Not done yet

- The testnet verifier is not deployed until the Mac steps run.
- External wallets (signMessage) for intents; device key only for now.
- Buy offers in the UI (the server accepts buy-side orders; the panel lists sell orders).
- The mainnet proof and 1Click deposits (plans above).
