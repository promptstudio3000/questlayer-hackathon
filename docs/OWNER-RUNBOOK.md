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
