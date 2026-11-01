#!/usr/bin/env bash
# Installs the mainnet slice service keys (player factory, relayer, award
# signer) privately into the state directory of questlayer-mainnet.service and
# writes its runtime.env from .data/runtime-mainnet.env. Never touches the
# testnet service, never replaces a different existing key and does not start
# anything. Run after scripts/deploy-mainnet-slice.mjs --network mainnet --execute.
set -Eeuo pipefail
cd "$(dirname "$0")/.."
HOST_TARGET="${DEPLOY_HOST:-root@72.61.188.39}"
AWARD="${AWARD_SIGNER_PATH:-.data/award-attestor-mainnet.pem}"
for f in .data/player-factory-mainnet.json .data/relayer-mainnet.json "$AWARD" .data/runtime-mainnet.env; do
  [[ -f "$f" ]] || { echo "$f is missing." >&2; exit 1; }
done
FACTORY_ACCOUNT="$(python3 -c 'import json;d=json.load(open(".data/player-factory-mainnet.json"));assert d["network"]=="mainnet";print(d["accountId"])')"
STAGE=/opt/ps3000/apps/questlayer-mainnet/key-staging
ssh -o BatchMode=yes "$HOST_TARGET" "install -d -m 700 /opt/ps3000/apps/questlayer-mainnet $STAGE"
scp -q .data/player-factory-mainnet.json .data/relayer-mainnet.json .data/runtime-mainnet.env "$HOST_TARGET:$STAGE/"
scp -q "$AWARD" "$HOST_TARGET:$STAGE/award-attestor.pem"
ssh -o BatchMode=yes "$HOST_TARGET" python3 - "$FACTORY_ACCOUNT" <<'PY'
import json, os, pathlib, sys
factory = sys.argv[1]
root = pathlib.Path('/opt/ps3000/apps/questlayer-mainnet'); stage = root / 'key-staging'
# Same layout systemd creates for DynamicUser=yes; it chowns the tree on start.
private = pathlib.Path('/var/lib/private/questlayer-mainnet'); link = pathlib.Path('/var/lib/questlayer-mainnet')
private.parent.mkdir(mode=0o700, exist_ok=True); private.mkdir(mode=0o700, exist_ok=True)
if not link.exists(): link.symlink_to('private/questlayer-mainnet')
assert link.resolve() == private.resolve(), 'Unexpected mainnet state directory layout'
assert not pathlib.Path('/var/lib/questlayer-hackathon').resolve() == private.resolve()
for name in ['player-factory-mainnet.json', 'relayer-mainnet.json', 'award-attestor.pem']:
    src = stage / name; target = private / name
    assert not src.is_symlink() and src.stat().st_size < 4096
    if name.endswith('.json'):
        item = json.loads(src.read_text()); assert item['network'] == 'mainnet' and item['accountId'].endswith('.near')
    if target.exists():
        assert target.read_bytes() == src.read_bytes(), f'Existing {name} differs; do not replace silently'
    else:
        with open(target, 'xb') as f: f.write(src.read_bytes())
    os.chmod(target, 0o600); src.unlink()
# runtime.env: only the account; key paths, network and limits are in the unit.
env = root / 'runtime.env'
lines = [l for l in (env.read_text().splitlines() if env.exists() else []) if not l.startswith('PLAYER_FACTORY_ACCOUNT=')]
lines.append(f'PLAYER_FACTORY_ACCOUNT={factory}')
env.write_text('\n'.join(lines) + '\n'); os.chmod(env, 0o600)
(stage / 'runtime-mainnet.env').unlink(); stage.rmdir()
print(json.dumps({'mainnetKeys': 'installed privately', 'factory': factory, 'serviceStarted': False}))
PY
