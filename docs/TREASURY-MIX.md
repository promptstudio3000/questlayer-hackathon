# Treasury mix: 50 % liquid staking, 40 % stablecoins, 10 % NEAR

Status 4 Nov 2026: testnet only. QGOLD build plan stream 8, approved by Lubos on 4 Nov 2026.
Code: `server/native/treasury-mix.mjs` (planning and read-only views), `scripts/treasury-mix-testnet.mjs`
(Mac, operator key), card "Treasury mix" on `/economy`, API `GET /api/treasury/mix`.

## Why

Until now the sponsor treasury (operator `questlayer-dev-20261101.testnet`) was 100 % stNEAR. All of its yield
came from NEAR staking and its whole value moved with the NEAR price. Lending stablecoins on Rhea Lend adds a second
yield source that does not depend on NEAR, and keeps 40 % of the treasury's value in dollars when NEAR falls.

The QGOLD backing is a different pot and stays in LSTs only (build plan, core model).

## Buckets

| Bucket | Assets (testnet allowlist) | Where they sit | Target |
| --- | --- | --- | --- |
| Liquid staking | stNEAR (`meta-v2.pool.testnet`), LiNEAR (`linear-protocol.testnet`) | wallet or the yield vault | 50 % |
| Stablecoins | USDC, USDT (`usdc/usdt.fakes.testnet`) | the yield vault `questlayer-yield-20261102.testnet`, which supplies them to Rhea Lend (`contract.burrow.testnet`) above a 20 % buffer | 40 % |
| NEAR reserve | wNEAR (`wrap.testnet`) | wallet, separate from the gas NEAR | 10 % |

Everything is valued in NEAR: LSTs at their protocol price, stablecoins through Pyth (`pyth-oracle.testnet`, the
same feeds Rhea Lend lists). The testnet Pyth feeds are months old; testnet accepts them and says so, mainnet
settings refuse a price older than 5 minutes.

## Limits (hard ceilings in code, settings can only tighten them)

- At most 40 % of the treasury with one protocol. Each LST provider is its own protocol, and USDC and USDT together
  count as Rhea Lend.
- Nothing new goes to a Rhea market at 95 % utilization or above, or one that is closed for deposits. A position in a
  market that turns full is withdrawn first (the vault queue waits for liquidity).
- A run moves at most 25 % of the treasury (`TREASURY_MIX_MAX_MOVE_BPS`, ceiling 50 %).
- Nothing happens while every bucket and asset is within 3 points of its target (`TREASURY_MIX_DRIFT_BPS`).
- Moves under 0.1 NEAR are skipped. An LST the treasury does not hold yet waits until its share reaches the
  provider's 1 NEAR minimum stake.
- Caps win over targets: what a cap blocks waits in the NEAR reserve.
- Sinks are funded only from what the same run freed. A run never spends the operator's gas NEAR, and whatever it
  freed and did not place goes to the wNEAR reserve.

With today's treasury of about 2 NEAR that means: stNEAR 40 %, USDC 40 %, NEAR 20 % (LiNEAR's 0.5 NEAR share is
below its minimum stake). It gets there in three daily runs of at most 0.5 NEAR each. From about 4 NEAR the full
50/40/10 with stNEAR and LiNEAR at 25 % each is reachable.

## Yield

- LST growth: the daily stNEAR harvest (`scripts/stnear-treasury-testnet.mjs`) as before. When the mix sells or
  buys stNEAR it moves the stNEAR principal in `.data/stnear-treasury.json` by the same NEAR value, so the harvest
  still sells growth only.
- Stablecoin interest: `keep` calls the vault's `rebalance` (supply to Rhea) and `harvest` (interest above principal
  goes to the treasury account). Once pending interest is worth 0.01 NEAR it funds the rewards contract as sponsor
  receipt `stable-yield-<date>`. Until then it is shown as pending and is not counted as treasury capital.
- Testnet Rhea pays about 0 % on USDC (almost nobody borrows there), so testnet shows the mechanics, not the yield.

## Swaps on testnet

The testnet Ref pools hold made-up prices (one wNEAR/USDC pool prices NEAR at 35 000 USDC), so a real swap would
create or destroy value at random. On testnet the NEAR to stablecoin leg is a recorded stand-in: the operator mints
the test stablecoin at the Pyth price and keeps the NEAR as the counterparty would (`standIn.nearHeld` in the record).
A stand-in sale burns the test stablecoin and returns NEAR only out of that balance. Every stand-in step is marked
`route: "testnet-mint"` in the public record and on `/economy`.

Mainnet needs a real route (Ref Finance with an oracle guard on the price, or NEAR Intents 1Click), a mainnet
allowlist (native USDC, USDt), a higher yield-vault account cap, a review and Lubos's explicit go.

## Running it (Mac, operator key in `.data/near-operator.json`)

```sh
node scripts/treasury-mix-testnet.mjs status              # live mix, targets and the next run's plan
node scripts/treasury-mix-testnet.mjs rebalance --dry-run
node scripts/treasury-mix-testnet.mjs rebalance           # one run (at most 25 % of the treasury)
node scripts/treasury-mix-testnet.mjs keep                # supply stables to Rhea, harvest their interest
```

Daily at 06:30 the Mac LaunchAgent `com.questlayer.stnear-harvest` runs the stNEAR harvest, then `rebalance` and
`keep` (Lubos approved 4 Nov 2026). Reinstall it with `bash scripts/install-stnear-harvest-mac.sh`; log
`.data/logs/stnear-harvest.log`.

`TREASURY_MIX_RECORD_PUSH=1` copies `public/treasury-mix-testnet.json` to the VPS state directory, so `/economy`
shows a run without a redeploy. State: `.data/treasury-mix.json`.

## Later (stream 7)

QGOLD conviction voting will steer the mix within these limits (LST providers from an approved list, at most 50 %
per LST provider in the voting design, never above the 40 % per-protocol ceiling here unless Lubos changes it).
