# Owner runbook: keys, VPS migration, deployment

Commands the owner runs from the Mac (the cloud session cannot reach port 22). The Mac checkout is
`~/WORK/AI-PROJECTS/_FINALS/NEAR-HACKATHON`. Never paste private keys into chat or commits.

## Current state (2026-11-01)

The VPS migration (§2) and deployment (§4) are done. The keys of the earlier `questlayer-dev-20261031.testnet`
operator were lost with a reclaimed cloud container, so the testnet contracts were redeployed from the Mac under a
new operator. Generate service keys only on a machine that keeps them; a cloud container is not one.

| File in `.data/` (Mac, mode 600) | Account / purpose |
| --- | --- |
| `near-operator.json` | `questlayer-dev-20261101.testnet`: owner of game, nfts, market, rewards, vaults, creators |
| `player-factory.json` | `play-20261101.questlayer-dev-20261101.testnet`: creates and funds player sub-accounts |
| `relayer.json` | `relay-20261101.questlayer-dev-20261101.testnet`: pays gas for relayed actions |
| `creators-publisher.json` | publisher key of `questlayer-creators-20261101b.testnet` |
| `reward-worker.json` | worker key of `questlayer-rewards-20261101b.testnet` (vaults `questlayer-vaults-20261101b`, treasury vault `questlayer-vault-20261101b`) |
| `reward-attestor.pem` | reward attestor, unchanged; the VPS holds the same key |

The award signer on `nfts.questlayer-dev-20261101.testnet` is the VPS application's existing
`award-attestor.pem` (public key in `public/native-claims-testnet.json`); it was not replaced. The previous keys are
archived in `.data/archive-20261101-before-rotation/`. Testnet only; back them up privately.

## 1. Keys

`scripts/install-relayer-keys-vps.sh` installs the factory, relayer and creators publisher keys and refuses to
replace an existing different key. `scripts/install-native-worker-vps.sh` is pinned to the 2026-10-31 rewards
contract; the 20261101b worker key was installed by hand with the old one kept as `reward-worker.json.old-20261031`.

## 2. One-time VPS migration from the former installation (done)

```bash
DEPLOY_HOST=root@72.61.188.39 scripts/migrate-vps-legacy.sh
```

Expected: "Local health OK", the public health JSON, "Migration <stamp> complete". Rollback:
`scripts/migrate-vps-legacy.sh --rollback <stamp>`. The script now handles the `DynamicUser=yes` state symlink
(`/var/lib/<name> -> private/<name>`); the first run on 2026-11-01 failed on it and was repaired by hand.

## 3. Moving the reward worker to a new rewards contract

`native_days` is not keyed by contract. Days published on a previous contract make the worker stop with
"Published native day no longer matches its durable manifest." Move such rows aside only when they have no rows in
`native_reward_claims`, keep a copy outside the database (the schema check rejects unknown tables) and let the
worker republish them. On 2026-11-01 the rows for 2026-11-01 and 2026-11-02 were moved this way; the copy is in
`/opt/ps3000/apps/questlayer-hackathon/backups/before-native-day-retire-*/`.

## 4. Deploy the current branch

```bash
npm ci
DEPLOY_HOST=root@72.61.188.39 bash scripts/deploy-vps.sh
curl -s https://questlayer.promptstudio3000.com/api/health | jq '{network, relayer, distribution, creatorMoney, socialRecords, nativeRewards}'
```

Expected: `network: testnet`, `relayer.enabled: true`, `distribution.status: verified`, `creatorMoney.enabled: true`,
`socialRecords.contractId` set and `nativeRewards.last_error: null`. The release archive includes `public/*.json`
because the server reads the network manifests from there.

## 5. Optional: reuse MapOS credentials

The map works without keys (OpenFreeMap). Only if a keyed provider is wanted later, read the MapOS runtime
configuration on the VPS and copy the relevant variables into `/opt/ps3000/apps/questlayer-hackathon/runtime.env`;
never commit them:

```bash
ssh -o IdentitiesOnly=yes root@72.61.188.39 'ls /opt/ps3000/apps/mapos* 2>/dev/null; grep -rl "MAPTILER\|MAPBOX\|TILE" /opt/ps3000/apps/mapos*/*.env 2>/dev/null'
```

## 6. Before the submission

`docs/SUBMISSION.md` has the post draft, video script and payload template. Make the repository public, run a
secret scan over the history, verify the README steps on a fresh clone, then submit once.

## 7. Mainnet slice: one command (needs Lubos's go, see `docs/MAINNET-PLAN.md` §5)

Nothing here has run on mainnet. `scripts/deploy-mainnet-slice.mjs` deploys the minimal slice from
`docs/MAINNET-PLAN.md` §1: the collectibles contract (create, deploy and `new` in one transaction, then
`set_award_signer`), the player factory and relayer accounts with their key files, and a check that `social.near`
still runs the pinned code. Without `--execute` it only reads the chain and prints the plan; it signs nothing and
writes nothing. Re-running is safe: finished steps are verified and skipped, any mismatch (other code on the
contract account, another award signer, a key file missing for an existing account) stops the run.

Owner prerequisites on the Mac, all mode 600, none of them in git or chat:

| File | Content |
| --- | --- |
| `.data/near-operator-mainnet.json` | `{"network":"mainnet","accountId":"<operator>.near","secretKey":"ed25519:…"}` with a full-access key |
| `.data/award-attestor-mainnet.pem` | created by the first `--execute` if absent; never reuse the testnet PEM |
| reviewed WASM | `bash scripts/build-contracts.sh`, then `sha256sum contracts/target/wasm32-unknown-unknown/release/questlayer_collectibles.wasm`; the reviewer confirms this hash |

```bash
export NEAR_NETWORK=mainnet NEAR_MAINNET_CONFIRM=<operator>.near \
  AWARD_SIGNER_PATH=.data/award-attestor-mainnet.pem \
  COLLECTIBLES_WASM_SHA256=<reviewed sha256> \
  COLLECTIBLES_FUND_NEAR=3 PLAYER_FACTORY_FUND_NEAR=5 RELAYER_FUND_NEAR=5
node scripts/deploy-mainnet-slice.mjs --network mainnet            # plan: read-only
node scripts/deploy-mainnet-slice.mjs --network mainnet --execute  # deploys
```

The operator needs the three amounts plus 1 NEAR reserve; the script checks the balance first. Optional overrides:
`COLLECTIBLES_ACCOUNT`, `PLAYER_FACTORY_ACCOUNT`, `RELAYER_ACCOUNT` (direct sub-accounts of the operator only),
`NEAR_RPC_URL`. The collectibles account gets the operator's public key as a full-access key so reviewed upgrades
stay possible; deleting that key later locks the contract for good.

Outputs: `public/mainnet-deployment.json` and `public/native-claims-mainnet.json` (commit both; the server reads
them), `.data/player-factory-mainnet.json`, `.data/relayer-mainnet.json` and `.data/runtime-mainnet.env`. The env
file holds `NEAR_NETWORK=mainnet`, `VITE_NEAR_NETWORK=mainnet` (build time: the client bundle must be built with
it), `MAINNET_FEATURES=collectibles,relayer,social`, 0.02 NEAR per new player account, a 0.05 NEAR daily top-up
cap and the key paths. A mainnet host needs its own database (`NETWORK_MISMATCH` otherwise), so mainnet runs as
a separate service directory on the VPS, never by flipping the testnet one. Copy the two key files and the award
PEM to that host by hand (`install-relayer-keys-vps.sh` is testnet only) and set `AWARD_SIGNER_PATH` there.

Rehearsal on testnet: the same command without `--network`, with `COLLECTIBLES_ACCOUNT=nfts-slice.<operator>.testnet`
so it does not meet the live `nfts.` contract. Testnet key files are `*-testnet.json` and manifests go to
`output/mainnet-slice-testnet/`, so the live testnet keys and `public/*-testnet.json` stay untouched. The offline
dry run (fake chain, then the real server booted on `NEAR_NETWORK=mainnet` from the written manifests) is
`node --test tests/mainnet-slice.test.mjs` and runs in CI.

Check after deploying the mainnet service:

```bash
curl -s https://<mainnet host>/api/health | jq '{network, features, relayer: .relayer.enabled, nativeRewards: .nativeRewards.status}'
# expected: "mainnet", ["collectibles","relayer","social"], true, "not-configured"
```

### Pause drill (`DISABLE_RELAYER`)

Stops every sponsored action: no new player accounts, no relayed gas. Players keep reading and signing self-paid
actions with their own keys.

1. On the mainnet host add `DISABLE_RELAYER=1` to its `runtime.env` and restart the service.
2. Check `/api/health`: `relayer.enabled` is `false` (the dry-run test asserts exactly this).
3. If a key may be compromised, also delete the relayer and factory keys on chain from the Mac
   (`near account delete-keys` for `relay-…` and `play-…`) and move the key files off the host. Keep
   `DISABLE_RELAYER=1` while the keys are gone: with the flag the server does not load them, without it the start
   fails on the missing key.
4. Resume: remove the flag, restore keys if they were rotated (new key files, same account ids), restart, check
   `relayer.enabled: true`.

Run the drill once on testnet before the mainnet go: the testnet service takes the same flag.
