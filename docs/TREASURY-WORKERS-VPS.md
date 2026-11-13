# Treasury workers on the VPS

Owner decision, 11 Nov 2026: the daily treasury jobs leave the Mac and run on the testnet VPS, so the game no
longer depends on the owner's computer being awake. This replaces the Mac LaunchAgent
`com.questlayer.stnear-harvest` (`scripts/install-stnear-harvest-mac.sh`). Testnet only.

## What runs

| Timer | When (Europe/Prague) | Steps |
| --- | --- | --- |
| `questlayer-treasury-daily.timer` → `questlayer-treasury@daily.service` | 06:30 every day (`Persistent=true`, a missed run starts at boot) | stNEAR `fund-pending`, `harvest`; treasury DAO `daily` (tally, weekly poll, Explorer sync, today's run); treasury mix `rebalance`, `keep` |
| `questlayer-treasury-retry.timer` → `questlayer-treasury@retry.service` | every hour at :45, 07:45 to 21:45 | treasury mix `rebalance` only |

The retry exists for a day whose DAO run gets its second council approval later (see "Council" below).
`rebalance` runs at most once per UTC day (`state.runs`) and only when today's DAO run is Approved, so the retry is
a no-op on every other hour.

Both services run `scripts/treasury-worker-vps.sh` from the release in `current/` (shipped by
`scripts/deploy-vps.sh`) as the system user `questlayer-treasury` in `/var/lib/questlayer-treasury` (keys and state
in `.data/`, chmod 600). A root `ExecStopPost` step copies the public records (`stnear-treasury-testnet.json`,
`treasury-mix-testnet.json`) into the game server's state directory, where `/api/treasury/stnear`,
`/api/treasury/mix` and `/treasury` read them; no redeploy and no `scp` from the Mac. Logs:
`journalctl -u 'questlayer-treasury@*'`.

The one-off Mac `stagger` process is not moved; it finishes on the Mac.

## Key plan

The operator full-access key (`questlayer-dev-20261101.testnet`, ~70 test NEAR, deploys and upgrades everything)
**never goes to the VPS**. The VPS gets exactly these keys:

| Account | Key on the VPS | Can do | Holds |
| --- | --- | --- | --- |
| `treasury-ops.questlayer-dev-20261101.testnet` (new) | full access, its own key | sign the treasury mix and stNEAR harvest | only the treasury mix (~2 NEAR of stNEAR, wNEAR, test stablecoins) plus 1 NEAR gas |
| `keeper.questlayer-dev-20261101.testnet` | function-call key: receiver the DAO, methods `add_proposal`, `act_proposal`, allowance 0.9 NEAR | file proposals, cast the keeper's poll vote | 1 NEAR gas |
| `council-a.questlayer-dev-20261101.testnet` | function-call key: receiver the DAO, method `act_proposal`, allowance 0.9 NEAR | approve checked proposals | 1 NEAR gas |
| `council-b.questlayer-dev-20261101.testnet` | only if the owner allows both automatic approvals: same as council-a | same | 1 NEAR gas |

Why treasury-ops has a full-access key: the harvest and mix steps attach deposits (`fund_rewards` with the harvested
NEAR, `deposit_and_stake`, `near_deposit`, `storage_deposit`, and 1 yocto on `ft_transfer_call`, vault `withdraw`
and `near_withdraw`). NEAR function-call keys cannot attach any deposit, so they cannot express these calls. The
answer is a dedicated account whose whole balance is the treasury mix: a leaked key exposes those ~3 test NEAR and
nothing else. The 93 NEAR in the keyless staking vault `stake-20261111` and the rewards treasury are out of its
reach (keyless contracts; the rewards contract only accepts `fund_rewards` from it).

The council and keeper full-access keys stay in `.data/treasury-dao-keys.json` on the Mac; the VPS has only new
function-call keys on the same accounts. The DAO's proposal bond is 0, so `add_proposal` needs no deposit (the
setup script checks this).

Not on the VPS: the operator key, the council full-access keys, the rewards/vault keys. Rotating a VPS key: delete it
on chain from the Mac with the account's full-access key, remove the file on the VPS, re-run the setup and install
scripts.

### Stable yield

The yield vault `questlayer-yield-20261102.testnet` was deployed with the operator as its immutable treasury, so
`harvest` on treasury-ops' stable positions still pays the interest to the operator, not to treasury-ops. Testnet
Rhea pays ~0 % on USDC/USDT, so nothing is lost today; the fix belongs to the custody move in
`docs/TREASURY-DAO.md` (a fresh vault with the DAO or treasury-ops as treasury).

## Council

The DAO approves with 2 of [operator (Lubos), council-a, council-b]. Two set-ups:

- **Both council keys on the VPS** (`--council-b`): every checked proposal passes at once, as it did on the Mac,
  where both automatic keys already sat together. The owner's operator seat can still reject or change the policy.
- **council-a only** (default): the VPS files and approves with council-a; the second approval comes from
  `node scripts/treasury-dao-testnet.mjs approve-pending` on the Mac (council-b, re-checks every open keeper
  proposal: today's run against the adopted mix and the move limit, poll results against the tally, Explorer
  updates) or from the operator seat. Until then the day's rebalance waits; the hourly retry runs it once approved.
  Harvest and `keep` do not wait for the DAO.

## Moving it (Mac, by the Deploy thread)

```sh
git pull                                                        # this branch merged
bash scripts/deploy-vps.sh                                      # ships the worker scripts in current/
bash scripts/install-stnear-harvest-mac.sh --remove             # stop the Mac LaunchAgent first
node scripts/treasury-workers-setup-testnet.mjs                 # dry run: accounts, keys, what moves
node scripts/treasury-workers-setup-testnet.mjs --execute       # add --council-b if both council keys may run on the VPS
bash scripts/install-treasury-workers-vps.sh --dry-run          # checks the bundle against the chain, copies nothing
bash scripts/install-treasury-workers-vps.sh --run-now          # install, enable the timers, run today's job once
```

`treasury-workers-setup-testnet.mjs --execute` (idempotent):

1. creates `treasury-ops.<operator>` with 1 NEAR gas (key saved to `.data/treasury-ops.json` before the account
   exists);
2. adds the DAO function-call keys (bundle file `.data/treasury-vps/treasury-dao-keys.json`) and tops the keeper and
   council accounts up to 1 NEAR;
3. moves the mix holdings from the operator: withdraws its yield-vault positions, transfers stNEAR, wNEAR, USDC and
   USDT (registering treasury-ops on each token), and the NEAR held by the testnet stand-in counterparty; refuses
   while the Mac LaunchAgent is installed. `--execute --sweep` moves what arrived later (a queued vault withdrawal);
4. writes `.data/treasury-vps/` (treasury-ops key, DAO function-call keys, `stnear-treasury.json` and
   `treasury-mix.json` rewritten for treasury-ops) and renames the Mac copies to `*.moved-to-vps.json`, so the Mac
   scripts cannot run on stale state.

`install-treasury-workers-vps.sh` copies only that bundle, after checking on chain that treasury-ops' key is its
full-access key, that every DAO key is a function-call key, and that no file contains the operator key. It never
replaces a key file that differs on the VPS (move it aside deliberately), and keeps VPS state that is newer than the
bundle. `--remove` disables the timers.

After the move, one-off owner commands that need the operator seat (`treasury-dao-testnet.mjs adopt`, `setup`,
`qgold-council`) still run on the Mac. The mix scripts on the Mac would now need `NEAR_OPERATOR_KEY_PATH=.data/treasury-ops.json`;
day-to-day they run only on the VPS.

## Verify one run

```sh
ssh root@72.61.188.39 "systemctl list-timers 'questlayer-treasury*'; journalctl -u questlayer-treasury@daily --since today --no-pager | tail -40"
curl -s https://questlayer.promptstudio3000.com/api/treasury/mix | head -c 400     # account: treasury-ops...
curl -s https://questlayer.promptstudio3000.com/api/treasury/dao | head -c 400     # today: Approved
```
