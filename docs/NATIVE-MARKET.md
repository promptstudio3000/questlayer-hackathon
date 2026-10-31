# Native Aura market — testnet

This is a direct NEAR NFT escrow market for QuestLayer Auras. It is separate from the demo GOLD market and is not the canonical NEAR Intents protocol.

## Trade lifecycle

An owner calls the collectible contract's NEP-171 `nft_transfer_call` with an exact NEAR price in yoctoNEAR. The market accepts only the configured QuestLayer collection, Aura tokens and direct-owner listings. The NFT remains in market escrow until a sale or cancellation succeeds. Each relisting gets a new identifier, so a stale quote cannot purchase a repriced offer.

A buyer attaches exactly the quoted price. The listing locks while the NFT transfer runs. Only a successful NFT transfer credits the seller. Failed delivery reopens the offer and credits the buyer for a refund. Sale proceeds/refunds are pull payments: the wallet owner withdraws their balance; a failed NEAR transfer restores the credit. Cancellation similarly returns the NFT or restores its active listing state. New trades can pause without blocking cancellation or withdrawals.

The financial invariant is:

`buyer deposits = pending purchase escrow + available market credits + pending withdrawals + completed withdrawals`

Project-sponsored code/storage funds are separate from sale liabilities. Storage is bounded to 128 simultaneous listings, 256 retained participants and three simultaneous listings/purchases per account. Zero-liability participant records are removed. This sponsored policy is testnet-specific; a reviewed NEP-145/mainnet funding policy remains future work.

Prices are integer yoctoNEAR strings. The UI accepts 0.001–1,000 test NEAR with up to 24 decimals and rejects exponent notation, locale commas, negative amounts and rounding. Native offers never use demo GOLD.

## Application and wallet boundary

The server reads listings, NFT ownership and market balances. It signs no market transaction and holds no player wallet key. Every listing, purchase, cancellation and withdrawal is approved by the selected linked NEAR wallet. UI completion checks actual escrow/ownership and balance state; a submitted transaction is not displayed as a completed trade without that check.

Public offer availability is cross-checked against the NFT contract's current owner. Pagination is bounded. A failed read leaves a visible retry state. Price validation remains local to the form, preserves the entered value and focuses the price field without disabling unrelated offers.

## Live evidence

The dedicated `questlayer-market-20261031.testnet` account was created once through the official free testnet helper and deployed with the project's local developer key. The server received no account access key.

`public/native-market-testnet.json` records deployment. `public/native-market-trades-testnet.json` records seven real testnet actions with two project-controlled developer accounts: NFT escrow, cancellation/return, relisting under a new ID, buyer receipt for 0.01 test NEAR, seller withdrawal, a visible 0.02 test NEAR sample offer and restoration of the seller's original Aura appearance. The sample is test data, not third-party trading volume.

13 market Rust cases cover conservation, delivery/withdrawal failure, cancellation, stale IDs, exact payment, self-trade rejection, concurrent purchase/cancel exclusion, collection/owner restrictions, sponsored-storage bounds and callback forgery. The combined contract suite has 38 passing cases; the application suite has 49.

## Remaining gates

This is an application-controlled testnet deployment with local developer FullAccess/upgrade authority, not an audited immutable mainnet market. Mainnet escrow/key policy, callback/gas adversarial review, durable event indexing, royalties, signed off-chain offers and canonical NEAR Intents integration remain separate work. Real browser/mobile wallet approval and physical-device behavior remain open, distinct from the live developer CLI proof. No original Aavegotchi NFT is moved or traded by this market.


Browser review inspected the actual on-chain sample offer in the running application. Connected-wallet form layout used a clearly labelled development fixture with inert trade callbacks, while public offer data remained live. Evidence covers 360px, 390px with 20px text, 390×430 limited height, 844×390 landscape and desktop. Exponent input was rejected without clearing its value; focus returned to the price input. Corrected 24-decimal input remained exact and keyboard Tab reached the listing action. Long wallet addresses wrap separately from the native selector; token serials appear before long titles. No real mobile soft keyboard or wallet approval was exercised.
