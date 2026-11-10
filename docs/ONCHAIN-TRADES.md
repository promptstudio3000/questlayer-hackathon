# Every trade on NEAR (4 Nov 2026)

Owner decision 4 Nov 2026 01:34 UTC: every exchange of anything, NPC trades included, happens on chain.
Testnet only. Part 3 of the "everything on NEAR" plan.

| Trade | Before | Now |
| --- | --- | --- |
| Practice market (Aura for practice GOLD) | game database (`listings`) | **closed.** `POST /api/market/list` and `/api/market/buy` answer `410 MARKET_ON_CHAIN`; open database listings are cancelled at boot (the Auras never left their owners). "Sell" in the collection secures the Aura as an NFT (relayed `redeem_aura`, no fee) and lists it through NEAR Intents, the default market: the device key is added on the verifier, the Aura is deposited there (`nft_transfer_call`, msg `""`) and a sell `token_diff` is signed into the order book (`sellAuraOnIntents` in `src/intents-order.ts`). Until a host has a deployed verifier it lists on the market contract for test NEAR instead. The Market tab shows only Secured and Offers; a stored `practice` view opens Secured. `PRACTICE_MARKET=db` brings the old market back for local tests only. |
| NPC trader buy (`trade_buy`) | trader-signed v2 buy order, filled in Market → Signed offers | **NEAR Intents** since 4 Nov: one tap in the NPC sheet deposits the Aura into the verifier, signs a sell `token_diff`, and the server settles it against the trader's private buy intent in one `execute_intents`; the NEAR goes straight back to the player (`native_withdraw`). |
| NPC trader sale (`trade_sell`) | trader-signed v2 sell order, filled in Market → Signed offers | **NEAR Intents**: the player deposits the price plus the 2 % fee as wNEAR and signs a buy `token_diff`; the trader's stock sits in the verifier and its intent is never published. |
| NPC trade-up (3 → 1) | player had to `nft_transfer` the Auras outside the app | the sheet sends the three `nft_transfer`s to the trader account (the relayer sponsors exactly the Auras of the player's issued trade-up), the server checks ownership on chain, and the paid-out Aura is **secured as an NFT right away** (award claim redeemed by the player's account). |

NPC traders keep their rules (`server/npc/trader-pricing.mjs`): the margin floor, premiums only from profit and the
surplus sweep into the rewards treasury, so every NPC trade still favours the game treasury.

## Trade fee to the treasury

Every P2P Aura trade on NEAR Intents pays 2 % (20,000 pips) on the buyer's wNEAR leg. The seller receives the listed
price exactly; the verifier credits the fee to its collector (the operator), and `scripts/intents-fees-testnet.mjs sweep`
moves what was collected into the prize pool with `fund_rewards` (receipt `intents-fees-<date>`). NPC trader buys and
sales settle on the same verifier and pay the same fee on the buyer's side; trade-ups move no wNEAR and pay none. Details: docs/NEAR-INTENTS-MARKET.md,
"Trade fee to the treasury".

## Aura resales on other marketplaces (NEP-199 royalty)

Auras are NEP-171 tokens, so players can also resell them on NEAR marketplaces outside the game. The collectibles
contract implements NEP-199 (`nft_payout`, `nft_transfer_payout`), so a marketplace that honours royalties pays the
treasury **2 % (200 bps)** of each resale, the same rate as the P2P fee. The royalty goes to a dedicated account,
`royalties.<operator>`, that receives nothing else; `scripts/collectibles-royalty-testnet.mjs sweep` moves what
arrived into the prize pool with `fund_rewards` (receipt `aura-royalties-<date>`), and the /economy page shows the
payee, the swept total and the proof sale. The owner sets the royalty with `set_royalty` (1 yocto, at most 10 %,
`None` turns it off); it is stored under its own storage key, so the upgrade has no state migration. Contract review:
docs/COLLECTIBLES-REVIEW.md, "NEP-199 royalties".

Marketplaces checked on testnet (4 Nov 2026, read from the chain):

| Marketplace | Testnet contract | Can list Auras? |
| --- | --- | --- |
| Mintbase interop market | `market-v2-beta.mintspace2.testnet` (owner `mintspace2.testnet`) | **Yes**, any NEP-171 contract. The seller pays 0.01 NEAR listing storage (`deposit_storage`), then `nft_approve` with msg `{"price": "<yocto>", "ft_contract": null}`; the buyer calls `buy`. Mintbase keeps 1 % without a referrer and asks `nft_transfer_payout` to split the rest (max 50 receivers, 15 TGas). A payout that is unparseable, too long or larger than the balance gets the NFT contract **banned**, so the payout always sums exactly to the balance. |
| Paras marketplace | `paras-marketplace-v2.testnet` | **Not without Paras.** It accepts only allow-listed NFT contracts (`approved_nft_contract_ids` = `paras-token-v2.testnet` only) and takes 5 %. Listing Auras needs the Paras team to add our contract; the royalty would then work the same way. |

Mac steps after the collectibles upgrade (`scripts/upgrade-collectibles-editions-testnet.mjs --execute`):

1. `node scripts/collectibles-royalty-testnet.mjs set`, then `set --execute`: creates `royalties.<operator>` (0.05 NEAR)
   and calls `set_royalty` with 200 bps. Commit `public/native-royalties-testnet.json`.
2. `node scripts/collectibles-royalty-testnet.mjs mintbase-proof`, then `--execute`: mints one fresh `polar` Aura to the
   operator, lists it on Mintbase for 0.1 test NEAR, buys it from a throwaway `mb-buyer.<operator>` account and
   checks that the royalties account received exactly what `nft_payout` promised (0.00198 NEAR). No player's Aura moves.
   The buyer is funded with the price plus 0.4 NEAR, because the signer must cover the prepaid gas (200 TGas) at the
   pessimistic gas price; unused gas stays with it. A rerun buys a proof Aura the operator already listed instead of minting again.
3. `node scripts/collectibles-royalty-testnet.mjs sweep` whenever the royalties account holds at least 0.01 NEAR
   above its 0.05 NEAR reserve (it can run next to the daily fee sweep).

Mainnet needs the same upgrade and `set_royalty` with Lubos's go; nothing here touches mainnet.

## On-chain proof (for the explorer link)

- `NpcTrade` views (accept, complete, `GET /api/npc/trades`) carry `txHash` (the fill, or the last hand-over) and
  `txHashes` (all steps). Trade-ups also carry `handovers` (`tokenId → hash`) and `secureItemId`.
- Fill hashes come from the signed-order index (`signed_market_orders.settlement_tx`, read from final receipts).
  Relayed hand-over hashes come from the relayer's own `relay_jobs`. A wallet-signed step is reported with
  `POST /api/npc/trades/tx {tradeId, transactionHash}`; the server reads the final transaction and checks signer,
  receiver, method and token before it stores anything.
- History rows of kind `npc-trade` carry `meta.txHash`, `meta.txHashes` and `meta.network` ("testnet"), so a
  ChainLink icon can link `https://testnet.nearblocks.io/txns/<hash>`.
- The NPC sheet shows an "On NEAR:" line with explorer links for the trades of the encounter.
- P2P trades sold from the collection (Intents book fills) and Intents withdrawals write History rows of kind
  `intents-trade` / `intents-withdraw` for both explorers with `meta.txHash` (the settlement), so History and
  Settings → On chain link them; Market → Offers lists the explorer's own Intents trades with the same link
  (docs/NEAR-INTENTS-MARKET.md, "Proof of every trade").
- Aavegotchi wearables (wallet originals on Base and their map clones) have no trade path: originals stay in the
  wallet and clones are game rows that are never NFTs (`server/gotchi-wearables.mjs`). Only Auras are traded.

## Pieces

| Piece | File |
| --- | --- |
| Trade proof, `recordTx`, `handoversFor`, `myTrades` | `server/npc/trader.mjs`, `server/npc/trader-ledger.mjs` |
| Routes `GET /api/npc/trades`, `POST /api/npc/trades/tx` | `server/npc/trader-routes.mjs` |
| Sponsored trade-up hand-over (`tradeUpHandovers` policy context) | `server/relayer/policy.mjs`, wiring in `server/index.mjs` |
| Database market closed | `server/index.mjs` (`PRACTICE_MARKET_ON_CHAIN`) |
| Client on-chain steps | `src/chain-trades.ts`, `src/NpcSheet.tsx`, registration in `src/App.tsx` |
| Sell from the collection on NEAR | `src/Inventory.tsx`, `onSell` in `src/App.tsx`, `sellAuraOnIntents` in `src/intents-order.ts` |
| NEP-199 royalty, payout split | `contracts/collectibles/src/lib.rs` (`set_royalty`, `nft_payout`, `nft_transfer_payout`) |
| Royalty payee, sweep, Mintbase proof | `scripts/collectibles-royalty-testnet.mjs`, record `public/native-royalties-testnet.json`, `auraRoyalties` in `server/native/public-ledger.mjs` |

## Not yet on chain

- Altar crafting (shards + Aura → Aura, `server/actors/hunt`) and practice-GOLD tasks stay in the game database
  until the QGOLD/QXP token from part 1 lands.
- NPC traders trade on NEAR Intents since 4 Nov 2026 (docs/NPC-TRADERS.md).
