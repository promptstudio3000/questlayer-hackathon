# VPS release runner

Owner decision (Lubos, 11–12 Nov 2026): the Mac is a development machine only and the VPS executes
everything on testnet: app deploys, contract upgrades and deploys, and one-off operator jobs. The testnet
operator key moves to the VPS (variant A of the plan). Mainnet is excluded; the runner refuses it.

## How it works

`questlayer-release.timer` starts `questlayer-release.service` a minute after each run. The service runs
`/usr/local/lib/questlayer-release/scripts/release-runner.mjs tick` as root:

1. **Fetch** the deploy branch (`claude/project-thread-0rica6`) and main (`claude/upbeat-gauss-5czir7`)
   with a read-only GitHub deploy key. GitHub holds no key to the VPS and nobody needs ssh to deploy.
2. **Self-update**: the runner files listed in `RUNNER_FILES` are taken from **main only**. A deploy
   branch can never change the code that runs as root.
3. **Deploy** when the deploy branch head is new: a worktree as the `questlayer-release` user, `npm ci`,
   `npm run check`, the same archive as `scripts/deploy-vps.sh`, then root runs the installed
   `scripts/vps-activate-release.sh` (database and key backup, switch, health check, automatic rollback,
   12 releases kept). The signing vault is rebuilt as the release user and installed as root when its
   fingerprint changed. A failed head is not retried; push a fix.
4. **Rollback** ("vrať to"): commit `deploy/pin.json` with `{"release": "<tag>"}` (a tag from
   `/api/release/status`). The runner switches to that kept release without building. Remove the pin
   (a new commit) to follow the branch again.
5. **Operations**: every new `deploy/ops/<id>.json` runs once, one at a time, in its own
   `questlayer-op-<id>` systemd unit, so long jobs (the vault stagger) survive restarts and the Mac
   can sleep.

Status is public and secret-free: `GET /api/release/status` and `GET /api/release/ops/<id>` (testnet only).

## Queueing an operation

```json
{
  "id": "collectibles-editions-uncap",
  "script": "scripts/upgrade-collectibles-editions-testnet.mjs",
  "ref": "claude/project-thread-xnwsia",
  "sha": "<full 40-character commit on that branch>",
  "wasm": { "path": "contracts/target/wasm32-unknown-unknown/release/questlayer_collectibles.wasm", "sha256": "<reviewed hash>" },
  "outputs": ["public/native-editions-testnet.json", "public/native-claims-testnet.json", "contracts/wasm-sha256.json"],
  "installKeys": [],
  "note": "Uncap Aura editions (economy thread)"
}
```

- `script` must be in `deploy/release-ops-allowlist.json` (installed from main). Only the env variables
  listed there may be set; arguments are plain strings; anything naming mainnet or `.near` is refused.
- `ref` + `sha` run the job in a checkout of another branch; without them the deploy branch head is used.
- Scripts with an execute flag run once read-only (plan) and then with `--execute`; the runner adds it.
- `contracts: true` scripts build `contracts/target` natively (Rust 1.97.0 from `rust-toolchain.toml`,
  path-remapped, the same hashes as CI). An upgrade (`wasm: true`) must name the WASM and its reviewed
  sha256; a mismatch stops the job before anything is signed.
- `.data/` in the job checkout is the runner's key directory (`/var/lib/questlayer-release/keys`, mode
  700), so scripts find `.data/near-operator.json` as on the Mac and write backups there.
- `outputs`: repository files the script rewrote come back in `/api/release/ops/<id>` so a thread can
  commit them (the deploy key is read-only).
- `installKeys`: `[{"service": "questlayer-testlayer", "file": "testlayer/work/.data/relayer-testnet.json", "to": "relayer.json"}]`
  copies a `.json` or `.pem` key the job wrote under `.data/` into that service's state directory
  (allowlisted in `keyDirs`), as `to` (default: the same name), never replacing a different file.
- `runtimeEnv`: `{"service": "questlayer-testlayer", "set": {"RELAYER_KEY_PATH": "/var/lib/questlayer-testlayer/relayer.json",
  "PLAYER_FACTORY_ACCOUNT": {"fromKey": "testlayer/work/.data/player-factory-testnet.json", "field": "accountId"}}}`
  sets only the keys allowlisted for that service in `runtimeEnv` (paths, account ids, public keys;
  never secrets), keeps every other line and a timestamped copy of the previous file.
  Restart or redeploy the service afterwards.

Operations already in the tree when the runner first starts are recorded as `baseline` and never run.

## One-time install (the last thing the Mac does)

```bash
bash scripts/install-release-runner-vps.sh                      # prints the deploy key
# GitHub -> Settings -> Deploy keys -> Add key, read-only
bash scripts/install-release-runner-vps.sh --clone --operator-key --enable
```

`--keys a.json,b.json` copies further `.data/` files (testnet only). After `--enable` the first tick
deploys the deploy branch head. The Mac copy of `.data/` stays as an encrypted backup only.

## Keys and safety

- The operator key sits only in `/var/lib/questlayer-release/keys` (600, `questlayer-release`). The game
  service runs as a DynamicUser and cannot read it. Keep the operator's balance to a working amount and
  send the rest to the funding account.
- Root runs only files installed from main; repository code (npm, tests, builds, scripts) runs as
  `questlayer-release`. Logs are scrubbed of private keys before they are stored.
- Anyone who can push to the deploy branch can deploy testnet and queue allowlisted jobs: protect the
  branch with a ruleset.
- No mainnet: no mainnet scripts in the allowlist, no mainnet keys, `NEAR_NETWORK=testnet` forced.
