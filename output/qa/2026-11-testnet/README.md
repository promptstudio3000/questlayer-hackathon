# Testnet redeploy and invisible-account proof, 31 October 2026 (UTC evening)

Operator `questlayer-dev-20261031.testnet` was created through the official testnet helper from this cloud session;
its key stays in `.data/` and is not in the repository.

| Step | Account | Evidence |
| --- | --- | --- |
| Game + collectibles redeploy with the standard smoke (15 transactions) | `game.questlayer-dev-20261031.testnet`, `nfts.questlayer-dev-20261031.testnet` | `public/testnet-deployment.json` |
| Award signer registered on the new collectibles contract (claims manifest v3) | same | `claims-upgrade-proof.json`, `public/native-claims-testnet.json` |
| Market redeployed against the new collectibles contract | `questlayer-market-20261101.testnet` | `market-deployment-proof.json`, `public/native-market-testnet.json` |
| Player factory and relayer accounts | `play-20261031.questlayer-dev-20261031.testnet`, `relay-20261031.questlayer-dev-20261031.testnet` | `scripts/deploy-player-factory-testnet.mjs` output |
| Rewards treasury, vault (5 test NEAR staked at Aurora, 50 % contribution) and factory, generation 2026-11-01; two days published (6,000 coins + 6 quests each) | `questlayer-rewards-20261101.testnet`, `questlayer-vault-20261101.testnet`, `questlayer-vaults-20261101.testnet` | `funding-deployment.json`, `public/native-rewards-testnet.json` |
| Creator money: 1 NEAR fund, paid quest 80/20, free repeat, donation, support round (completion 3 / like 1), creator withdrawal, treasury flush to rewards; conservation checked after every step | `questlayer-creators-20261101.testnet` | `native-creators-proof.json`, `public/native-creators-testnet.json` |
| Creator money publisher from the API process: first UTC support round opened by the server outbox (0.01 NEAR budget, `open_round` on 2026-11-01), transaction `3aBKSkm3N4rhoxriFG5vZosSiFeWrqAKo49V5u47HZSc`; finalization runs automatically after midnight UTC | `questlayer-creators-20261101.testnet` | `GET /api/health` → `creatorMoney`, `creator_money_rounds` table |
| Public note record (W10.1): guest → sponsored sub-account → public app note → NEAR Social `set` relayed from the player's own account → confirmed by reading `record-mvx348qu…/questlayer/notes/<id>` back; no photo in this run, so no pin | `record-mvx348qu.play-20261031.questlayer-dev-20261031.testnet`, `v1.social08.testnet` | `public/native-public-record-proof.json` |
| Invisible account: guest → sponsored sub-account → relayed `mint_avatar` without a wallet | `proof-mvx1gsxi.play-20261031.questlayer-dev-20261031.testnet` | `native-invisible-account-proof.json` |

The first proof attempt failed in outcome verification because a delegate transaction's own status is empty and
the contract return value lives in the receiver receipt; fixed in `server/relayer/outcome.mjs` and mirrored in the
test fixture. Historical proofs under `output/qa/W06-claims` and `output/qa/W07-market` are unchanged.
