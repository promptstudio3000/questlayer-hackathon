#!/usr/bin/env bash
# Installs the Test Layer service keys (docs/TEST-LAYER.md) privately into the
# state directory of questlayer-testlayer.service and writes its runtime.env.
# The keys come from the work tree of scripts/deploy-testlayer.mjs
# (.data/testlayer/work/.data). Never touches the QuestLayer World service,
# never replaces a different existing key and does not start anything.
set -Eeuo pipefail
cd "$(dirname "$0")/.."
# DEPLOY_HOST=local runs on the VPS itself, as root (the release runner).
HOST_TARGET="${DEPLOY_HOST:-root@72.61.188.39}"
if [[ "$HOST_TARGET" == local ]]; then
  [[ "$(id -u)" == 0 ]] || { echo "DEPLOY_HOST=local needs root on the VPS." >&2; exit 1; }
  on_host() { bash -c "$1"; }
  copy_to() { install -m 600 "$1" "$2"; }
  py_host() { python3 - "$@"; }
else
  on_host() { ssh -o BatchMode=yes "$HOST_TARGET" "$1"; }
  copy_to() { scp -q "$1" "$HOST_TARGET:$2"; }
  py_host() { ssh -o BatchMode=yes "$HOST_TARGET" python3 - "$@"; }
fi
SRC=.data/testlayer/work/.data
# source name in the work tree -> name the server looks for in its state dir
PAIRS=(
  "award-attestor.pem:award-attestor.pem"
  "player-factory-testnet.json:player-factory.json"
  "relayer-testnet.json:relayer.json"
  "badges-minter-testnet.json:badges-minter.json"
  "npc-games-ticket-signer.pem:npc-games-ticket-signer.pem"
  "reward-attestor.pem:reward-attestor.pem"
  "reward-worker.json:reward-worker.json"
  "ledger-recorder.json:ledger-recorder.json"
  "escrow-publisher.json:escrow-publisher.json"
  "creators-publisher.json:creators-publisher.json"
)
for req in award-attestor.pem player-factory-testnet.json relayer-testnet.json; do
  [[ -f "$SRC/$req" ]] || { echo "$SRC/$req is missing; run node scripts/deploy-testlayer.mjs --execute first." >&2; exit 1; }
done
FACTORY_ACCOUNT="$(python3 -c 'import json,sys;d=json.load(open(sys.argv[1]));assert d["network"]=="testnet";print(d["accountId"])' "$SRC/player-factory-testnet.json")"
STAGE=/opt/ps3000/apps/questlayer-testlayer/key-staging
on_host "install -d -m 700 /opt/ps3000/apps/questlayer-testlayer $STAGE"
NAMES=()
for pair in "${PAIRS[@]}"; do
  from="${pair%%:*}"; to="${pair##*:}"
  [[ -f "$SRC/$from" ]] || continue
  copy_to "$SRC/$from" "$STAGE/$to"
  NAMES+=("$to")
done
py_host "$FACTORY_ACCOUNT" "${NAMES[@]}" <<'PY'
import json, os, pathlib, sys
factory = sys.argv[1]; names = sys.argv[2:]
root = pathlib.Path('/opt/ps3000/apps/questlayer-testlayer'); stage = root / 'key-staging'
# Same layout systemd creates for DynamicUser=yes; it chowns the tree on start.
private = pathlib.Path('/var/lib/private/questlayer-testlayer'); link = pathlib.Path('/var/lib/questlayer-testlayer')
private.parent.mkdir(mode=0o700, exist_ok=True); private.mkdir(mode=0o700, exist_ok=True)
if not link.exists(): link.symlink_to('private/questlayer-testlayer')
assert link.resolve() == private.resolve(), 'Unexpected Test Layer state directory layout'
assert pathlib.Path('/var/lib/questlayer-hackathon').resolve() != private.resolve()
for name in names:
    src = stage / name; target = private / name
    assert not src.is_symlink() and src.stat().st_size < 8192
    if name.endswith('.json'):
        item = json.loads(src.read_text()); assert item.get('network', 'testnet') == 'testnet' and item['accountId'].endswith('.testnet')
    if target.exists():
        assert target.read_bytes() == src.read_bytes(), f'Existing {name} differs; do not replace silently'
    else:
        with open(target, 'xb') as f: f.write(src.read_bytes())
    os.chmod(target, 0o600); src.unlink()
state = '/var/lib/questlayer-testlayer'
updates = {'PLAYER_FACTORY_ACCOUNT': factory, 'PLAYER_FACTORY_KEY_PATH': f'{state}/player-factory.json', 'RELAYER_KEY_PATH': f'{state}/relayer.json'}
if 'reward-attestor.pem' in names: updates['REWARD_ATTESTOR_PATH'] = f'{state}/reward-attestor.pem'
if 'reward-worker.json' in names: updates['REWARD_WORKER_KEY_PATH'] = f'{state}/reward-worker.json'
if 'creators-publisher.json' in names: updates['CREATORS_PUBLISHER_KEY_PATH'] = f'{state}/creators-publisher.json'
env = root / 'runtime.env'
lines = [l for l in (env.read_text().splitlines() if env.exists() else []) if l.split('=', 1)[0] not in updates]
lines += [f'{k}={v}' for k, v in updates.items()]
env.write_text('\n'.join(lines) + '\n'); os.chmod(env, 0o600)
stage.rmdir()
print(json.dumps({'testLayerKeys': 'installed privately', 'keys': names, 'factory': factory, 'serviceStarted': False}))
PY
