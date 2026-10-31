# Owner runbook: keys, VPS migration, deployment

Commands the owner runs from the Mac (the cloud session cannot reach port 22). Replace nothing unless noted.
Never paste private keys into chat or commits.

## 1. Save the service keys created in the cloud session

The cloud session created these testnet keys under `.data/` of its working directory (gitignored). Open each file in
the session's file browser and save it to `~/NEAR-HACKATHON/.data/` on the Mac with the same name, then:

```bash
chmod 700 ~/NEAR-HACKATHON/.data && chmod 600 ~/NEAR-HACKATHON/.data/*
```

| File | Purpose |
| --- | --- |
| `near-operator.json` | `questlayer-dev-20261031.testnet`: owner of game/nfts/market/factory/relayer contracts and accounts |
| `player-factory.json` | `play-20261031.questlayer-dev-20261031.testnet`: creates and funds player sub-accounts |
| `relayer.json` | `relay-20261031.questlayer-dev-20261031.testnet`: pays gas for relayed actions |
| `award-attestor.pem` | application award signer registered on `nfts.questlayer-dev-20261031.testnet` (claims manifest v3) |

Testnet only; no monetary value. Back them up privately (a password manager entry is enough).

## 2. One-time VPS migration from the former installation

```bash
cd ~/NEAR-HACKATHON
git fetch origin && git checkout claude/upbeat-gauss-5czir7 && git pull
DEPLOY_HOST=root@72.61.188.39 scripts/migrate-vps-legacy.sh
```

Expected: "Local health OK", the public health JSON, "Migration <stamp> complete". Rollback if needed:

```bash
DEPLOY_HOST=root@72.61.188.39 scripts/migrate-vps-legacy.sh --rollback <stamp>
```

## 3. Install the new service keys on the VPS

```bash
cd ~/NEAR-HACKATHON
DEPLOY_HOST=root@72.61.188.39 scripts/install-relayer-keys-vps.sh
```

Then replace the award signer with the one registered on the new collectibles contract:

```bash
scp -o IdentitiesOnly=yes ~/NEAR-HACKATHON/.data/award-attestor.pem root@72.61.188.39:/var/lib/questlayer-hackathon/award-attestor.pem.new
ssh -o IdentitiesOnly=yes root@72.61.188.39 'cd /var/lib/questlayer-hackathon && cp -a award-attestor.pem award-attestor.pem.old-nfts && mv award-attestor.pem.new award-attestor.pem && chmod 600 award-attestor.pem && chown --reference=questlayer-hackathon.sqlite award-attestor.pem'
```

## 4. Deploy the current branch

```bash
cd ~/NEAR-HACKATHON && npm ci
DEPLOY_HOST=root@72.61.188.39 scripts/deploy-vps.sh
curl -s https://questlayer.promptstudio3000.com/api/health | jq '{status, relayer, nativeRewards, schema}'
```

Expected: `relayer.enabled: true`. Native rewards stay "not-configured" until the reward attestor/worker keys for
`questlayer-rewards-20261031.testnet` are present in `/var/lib/questlayer-hackathon` (they were installed earlier
from the previous operator; `scripts/install-native-worker-vps.sh` reinstalls them from `.data/`).

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
