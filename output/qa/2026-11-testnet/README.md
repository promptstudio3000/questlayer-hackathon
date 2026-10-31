# Testnet redeploy and invisible-account proof, 31 October 2026 (UTC evening)

Operator `questlayer-dev-20261031.testnet` was created through the official testnet helper from this cloud session;
its key stays in `.data/` and is not in the repository.

| Step | Account | Evidence |
| --- | --- | --- |
| Game + collectibles redeploy with the standard smoke (15 transactions) | `game.questlayer-dev-20261031.testnet`, `nfts.questlayer-dev-20261031.testnet` | `public/testnet-deployment.json` |
| Award signer registered on the new collectibles contract (claims manifest v3) | same | `claims-upgrade-proof.json`, `public/native-claims-testnet.json` |
| Market redeployed against the new collectibles contract | `questlayer-market-20261101.testnet` | `market-deployment-proof.json`, `public/native-market-testnet.json` |
| Player factory and relayer accounts | `play-20261031.questlayer-dev-20261031.testnet`, `relay-20261031.questlayer-dev-20261031.testnet` | `scripts/deploy-player-factory-testnet.mjs` output |
| Invisible account: guest → sponsored sub-account → relayed `mint_avatar` without a wallet | `proof-mvx1gsxi.play-20261031.questlayer-dev-20261031.testnet` | `native-invisible-account-proof.json` |

The first proof attempt failed in outcome verification because a delegate transaction's own status is empty and
the contract return value lives in the receiver receipt; fixed in `server/relayer/outcome.mjs` and mirrored in the
test fixture. Historical proofs under `output/qa/W06-claims` and `output/qa/W07-market` are unchanged.
