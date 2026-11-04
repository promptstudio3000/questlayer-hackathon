# On-chain ledger: every coin and XP on NEAR

4 November 2026. Testnet. Contracts `contracts/ledger` (QXP + records) and
`contracts/soulbound-ft` (QGOLD); server `server/chain-ledger/*`.

## What goes on chain

Every earning action a player makes is recorded on NEAR shortly after it happens:

| Kind      | Source                                                   | Earns      |
| --------- | -------------------------------------------------------- | ---------- |
| `coin`    | street coin (`claimCoin`)                                | XP + GOLD  |
| `find`    | street find (`claimCoin`, street find coin)              | XP + GOLD  |
| `quest`   | discovery / POI / route quest (`settleQuest`)            | XP (+GOLD) |
| `chest`   | zone chest (`settleQuest`)                               | XP (+GOLD) |
| `clue`    | landmark clue (`settleQuest`)                            | XP         |
| `monster` | monster challenge win (`server/actors/hunt/rewards.mjs`) | XP         |
| `boss`    | weekly boss hit share                                    | XP         |
| `errand`  | NPC task turned in (`server/npc/service.mjs`)            | XP         |
| `board`   | daily board bonus                                        | XP         |
| `roll`    | wisp roll consolation XP                                 | XP         |

Each record carries the XP, the GOLD (micro units, 6 decimals), a **geohash-7 cell**
(about 150 x 150 m), the time, and the sha256 of the evidence the server checked
(coin or quest id, exact fix, accuracy, world). The exact GPS fix never goes on
chain: the chain is public forever and would show where a player lives. The evidence
itself stays in `chain_actions.evidence_json`, so the hash can be re-checked.

GOLD spent in the practice market is not burned: QGOLD is the lifetime GOLD a player
collected, QXP is lifetime XP. Trades are recorded by the trade thread (market v2).

## Contracts

`questlayer_ledger` (account `questlayer-ledger-20261104.testnet`):

- Is the **QXP** token: NEP-141 views (`ft_balance_of`, `ft_total_supply`,
  `ft_metadata`, 0 decimals). `ft_transfer` and `ft_transfer_call` always fail.
  NEP-145 storage calls are no-ops that refund deposits (storage is sponsored).
- `record_batch(actions)`, recorder only, at most 25 actions. Each action becomes an
  NEP-141 `ft_mint` event whose memo reads, for example,
  `ql1 coin x1 xp=3 gold=5000000 cell=u2fkb7x t=1793750000000 ev=0123456789abcdef seq=42 ref=ca_...`.
  GOLD goes to QGOLD in the same transaction (`ft_mint_batch`, same memo). A failed
  QGOLD mint is held (`gold_pending`) and sent again with `retry_gold`.
- Idempotent: every account's actions carry a strictly increasing `seq`; an action
  whose seq is not above the account's last is skipped and listed in `skipped_refs`.
- `profile(account_id)`: XP, level (`1 + floor(sqrt(xp / 100))`, max 10, the same
  formula as `levelFor`), next level XP, GOLD, held GOLD, counts of coins, finds,
  monsters, quests and other, first and last action time.
- `commit_day(day, root, count, xp, gold)`: one Merkle root per UTC day, once.
  `verify_proof(day, leaf, proof)` checks one action against it. Tree: sha256 of
  sorted pairs, odd node carried up (`server/chain-ledger/merkle.mjs`).

`questlayer_soulbound_ft` (account `questlayer-qgold-20261104.testnet`): **QGOLD**,
6 decimals, soulbound NEP-141 with `ft_mint_batch` for its minter (the ledger) only.

The recorder is a function-call key on the ledger account (`record_batch`,
`commit_day`, `retry_gold`; 5 NEAR gas allowance). It cannot move NEAR. A leaked key
could inflate a soulbound score but cannot touch money.

## Modes: `CHAIN_RECORD_MODE`

- `each` (default on testnet): the worker runs every `CHAIN_BATCH_MS` (2 s) and sends
  everything collected since the last pass as one transaction (up to 25 actions). The
  tx lands about 1-2 s after the claim response.
- `daily`: nothing per action. After a UTC day ends (plus `CHAIN_DAY_GRACE_MS`, 10 min)
  the day's root is committed, then one record per account and kind carries the day's
  totals (`count` = number of actions, `ev` = the day's root).
- `off`: nothing is recorded. Default on mainnet until the owner says otherwise.

In both on modes the day's Merkle root is committed (`CHAIN_DAY_ROOTS=0` turns this off
in `each` mode), so any single action can be proven on chain.

Recording only starts when the contract id is known: `public/native-ledger-<network>.json`
(written by the deploy script) or `NEAR_LEDGER_CONTRACT`. The recorder key is read from
`<state dir>/ledger-recorder.json` (or `LEDGER_RECORDER_KEY_PATH`).

## Players without a NEAR account

Actions are recorded from the first coin. A player with no wallet link yet has
status `no-account`; once they register (invisible account or wallet link) the worker
binds all their earlier actions and sends them, so nothing collected before is lost.

## API

Every award response (coin and quest claim, monster win, NPC task) gains
`chain: { id, status, mode, tx, explorer }`. Statuses: `queued`, `sent` (retrying),
`confirmed`, `failed`, `no-account`. History rows carry `meta.chain` for the ChainLink
icon (docs/CHAIN-PROOF.md).

- `GET /api/chain/actions?limit=50`: the signed-in player's records, newest first.
- `GET /api/chain/actions/:id`: one record, with `proof` (day, leaf, root, siblings,
  `dayTx`) once its day is committed. Poll until `confirmed` or `failed`.
- `GET /api/chain/profile`: the on-chain profile view and contract ids.
- `/api/health` → `chainLedger`: mode, record counts by status, unbound actions,
  last days, recorder state.

## Cost

Testnet is free. On mainnet one batch costs roughly 0.001-0.003 NEAR of gas plus about
0.002 NEAR of storage per new player profile. At 100 actions per player per day `each`
mode is about 0.1-0.3 NEAR per player per day before batching; `daily` mode costs one
transaction per day plus one record per player and kind.

## Deploy (testnet, owner's Mac)

```
npm run contracts:docker          # or the CI artifact; hashes in contracts/wasm-sha256.json
node scripts/deploy-ledger-testnet.mjs
bash scripts/install-ledger-recorder-vps.sh
git add public/native-ledger-testnet.json && commit, then bash scripts/deploy-vps.sh
```

The deploy script creates both accounts through the testnet helper, deploys and
initialises them, installs the recorder key, records one smoke action for the operator
and checks QXP + QGOLD balances and that `ft_transfer` fails.
