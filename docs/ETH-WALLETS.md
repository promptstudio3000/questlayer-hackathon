# Ethereum wallets (MetaMask, Rabby): sign-in and NEAR Intents signing

4 November 2026. Stream 6 of the QGOLD build plan. Testnet only.

## What a player can do

| Action | How it works | What the wallet signs |
|---|---|---|
| **Sign in** (Welcome → Advanced → "Continue with MetaMask or Rabby") | Creates an explorer, or restores the same explorer for a returning wallet. The explorer then gets its invisible NEAR account as usual (device key + sponsored sub-account). | An EIP-4361 (Sign-In with Ethereum) text, with `personal_sign`. No transaction. |
| **Link** another wallet (Profile → Sign-in & coming back → Ethereum wallets) | Adds the wallet to the signed-in explorer. A wallet that belongs to another explorer is refused. | The same SIWE text. |
| **Sign NEAR Intents trades** (Market → Offers → NEAR Intents, "Sign trades with") | The wallet's secp256k1 key is registered for the explorer's NEAR account at the verifier (`add_public_key`, relayed by the device key, 1 yocto). After that the wallet signs listings, purchases and withdrawals as ERC-191 intents. | The exact intent JSON (`signer_id`, `verifying_contract`, `deadline`, `nonce`, `intents`). |

The wallet never sends an Ethereum transaction, never approves a token and never
sees a NEAR key. Smart-contract wallets (EIP-1271) are not supported, because the
verifier recovers the key with ecrecover.

The same sign-in signature also links the address for wearing Aavegotchi
originals (`external_links`) when no other explorer uses it.

## Verified against the verifier source

Our verifier is near/intents `defuse/v0.4.5`, commit `16d04f6`
(`server/native/intents.mjs`, `INTENTS_SOURCE`). That build supports ERC-191:

- `contracts/defuse/core/src/payload/multi.rs`: `MultiPayload::Erc191`, tag `"standard":"erc191"`.
- `contracts/defuse/core/src/payload/erc191.rs`: `{payload: String, signature}`; the public key is recovered, not sent.
- `contracts/defuse/core/src/payload/mod.rs`: the payload string is a `DefusePayload` JSON:
  `signer_id`, `verifying_contract`, `deadline`, `nonce` (base64), plus the flattened `intents`.
- `crates/signatures/erc191`: prehash = keccak256(`"\x19Ethereum Signed Message:\n" + len + message`).
- `crates/crypto/src/secp256k1.rs`: signature text `secp256k1:<base58 of r‖s‖v>` with v = 0 or 1
  (wallets return 27/28; we subtract 27), public key `secp256k1:<base58 of the 64-byte point>`.
- `contracts/defuse/src/contract/accounts/account/mod.rs`: `has_public_key` accepts a registered
  key, so a wallet key registered for `alice.<factory>.testnet` signs for that account.
  (Every `0x…` implicit account is also signable by its own key, but we keep balances on the
  explorer's NEAR account so the device key and the wallet see the same Auras and wNEAR.)

`tests/evm-wallet.test.mjs` replays the verifier's own ERC-191 test vector against our
prehash, and signs a real intent with a viem account the way MetaMask does.

## Server

- `server/identity/evm.mjs`: SIWE text (viem `createSiweMessage`), signature recovery,
  address and intents key.
- `server/identity/schema.mjs`: module `identity` v2 widens `identity_sessions.kind` with
  `evm-wallet` (in-place CHECK upgrade, no row changes); new module `evm-identity` v1 with
  `evm_links(address, player_id, public_key, wallet, created_at, verified_at)`.
- Routes: `POST /api/auth/evm/challenge {address, chainId, name, wallet, link}`,
  `POST /api/auth/evm/verify {challengeId, signature}`, `GET /api/identity/evm`.
  A challenge lives 5 minutes and is used once; a link must finish in the session that
  started it; 30 starts per minute per client address.
- `server/native/intents.mjs`: `verifyIntentLocally` accepts `erc191` next to `nep413`;
  `erc191Payload`, `signedErc191Intent`, `intentEnvelope`, `intentsOf`.
- `server/relayer/policy.mjs`: the verifier's `add_public_key` / `remove_public_key` accept
  a secp256k1 key as well as ed25519.

## Browser

`src/evm-wallet.ts` (loaded on demand, no wallet SDK): EIP-6963 discovery (MetaMask,
Rabby, other wallets; falls back to `window.ethereum`), `eth_requestAccounts`,
`personal_sign`, SIWE sign-in, ERC-191 intent signing.

## Limits and next steps

- A NEAR transaction cannot be signed by MetaMask, so map play, claims and relayed calls
  stay on the device key. On a new device, a returning wallet signs in to the same
  explorer; the NEAR account still needs the device to be restored (recovery passkey or
  another device). What the explorer holds inside the verifier can be withdrawn with the
  wallet's signature alone.
- Once the QGOLD vault exists (stream 1), QGOLD transfers and escrow payments can use the
  same ERC-191 signing: QGOLD as an NEP-141 inside the verifier, moved by `transfer`
  intents.

## NEAR Intents 1Click (mainnet only, plan, nothing run)

1Click (`https://1click.chaindefuser.com/v0`) swaps assets from other chains into NEAR
through `intents.near`. It has no testnet. Plan for the mainnet launch:

1. `POST /v0/quote` with `originAsset` = Ethereum USDC or ETH (`nep141:eth-0xa0b8…omft.near`,
   `nep141:eth.omft.near`), `destinationAsset` = `nep141:wrap.near`, `recipient` = the
   explorer's NEAR account, `refundTo` = the player's Ethereum address, `dry: true` first.
2. The player sends the deposit from MetaMask/Rabby to the quote's `depositAddress`
   (this is the only real Ethereum transaction in the flow, and the player approves it).
3. The game polls `GET /v0/status?depositAddress=…` and shows the NEAR that arrived;
   with QGOLD live, the next step is "deposit into the QGOLD vault" at R + 1 %.

Needs Lubos's explicit go, a mainnet deployment and a small proof (about 5 USDC).
