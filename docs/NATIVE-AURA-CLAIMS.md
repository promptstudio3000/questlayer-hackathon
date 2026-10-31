# Earned Aura claims on NEAR testnet

The game can turn an owned demo Aura into a wallet-owned native NFT. The player approves a NEAR transaction. The application holds an award-attestation key, not a registered NEAR account access key and never a player wallet key.

## State and custody

- The player chooses a linked, verified NEAR wallet. The server checks its own attestation public key against the collectible contract before reserving an item.
- A claim binds the collectible contract, testnet domain, opaque claim ID, original receiver, edition and expiry. Ed25519 signs the canonical UTF-8 message. The contract verifies the signature and requires the receiver to be the transaction caller.
- Requesting a claim reserves the demo item for 15 minutes from the latest request. It cannot be listed in the demo market. Repeated requests preserve the same claim identity and receiver.
- `redeem_aura` mints one token under the existing 256-per-edition cap. Metadata/art are fixed by the contract. Duplicate redemption returns the original token, including after a transfer, without another mint.
- The wallet attaches up to 0.05 test NEAR for NFT/claim storage. The standard refund utility returns unused deposit. The actual retained storage cost is not a staking deposit.
- The application confirms a finalized claim, validates its original receiver/edition and token, records one receipt and removes the demo item from the demo inventory view. NFT ownership and equipment are then read directly from NEAR.
- A cancelled wallet prompt leaves a resumable claim. After expiry, restoration requires a finalized post-expiry block proving that no NFT minted. The claim value and its block timestamp are read at the same block hash. A renewed/replaced claim cannot be deleted by a stale restoration request.

The expiration concerns NFT issuance, not reserving an outdoor quest against other players. Gameplay remains solo-friendly; the normal zone window controls activities.

## Authority and privacy

The application attestation secret lives in `award-attestor.pem` beside the configured application database with owner-only permissions. It is excluded from release archives and Git; deployment backups preserve it in the protected backup directory. Startup reuses the same key. Losing or rotating it requires the contract owner to configure the new public key; existing NFTs remain owned by their wallets. Expired unminted claims can still be restored using chain proof.

The attestor can authorize bounded collectible issuance. It cannot transfer existing NFTs, move player NEAR or sign a NEAR account transaction. NFT contract ownership and its legacy oracle remain separate authorities held by the project's local testnet operator. Mainnet use still requires a security review, operational signing policy and abuse controls.

The signed claim and NFT metadata contain no raw GPS, zone ID, route or photo. The opaque claim ID is independent of the activity ID. Account association, edition and transaction timing remain public. The published developer proof uses an explicitly labelled demo arena, not a claim of physical presence.

## Operations

1. Deploy the application first; its reader supports contract versions 2 and 3. Claims remain unavailable until keys match.
2. Build the locked WASM and run `node scripts/upgrade-award-claims-testnet.mjs`. This snapshots the old state/code locally, atomically deploys/migrates V2→V3, checks all existing tokens/equipment and sets only the application's public attestation key.
3. `node scripts/prove-earned-aura-testnet.mjs` exercises a free demo-arena chest, signed claim, player-key NFT redemption, idempotent retry, demo market exclusion, finalized application confirmation and native equipment. It uses only the dedicated local developer testnet account.
4. Rebuild/redeploy public proof JSON after the live proof is generated. Never upload the operator key or attestation secret with the release.

The upgrade/proof scripts are testnet-only. Canonical Intents trading, native realized-yield cash rewards, automatic native XP settlement, full native passkey accounts and original Aavegotchi 3D coverage remain separate milestones.

## Verification boundary

47 application tests and 25 Rust tests pass. Live activation and the complete developer application-to-chain proof also passed: V2→V3 preserved all three original NFTs/equipment, the demo-arena chest yielded `aura:polar:2`, duplicate redemption left supply unchanged and the application confirmed native equipment. Evidence: `public/native-claims-testnet.json` and `public/earned-aura-testnet.json`. Browser layout review uses clearly labelled development fixtures for ready/pending/unavailable claim states at 360/390 widths, 20px text, short landscape and desktop. Keyboard activation and recovery controls were inspected. Fixture clicks submit no chain transactions. Real browser/mobile wallet approval and physical-device behavior remain open checks; the live developer CLI proof is separate protocol evidence.
