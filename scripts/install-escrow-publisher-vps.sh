#!/usr/bin/env bash
# Installs the QGOLD market escrow publisher key (.data/escrow-publisher.json,
# written by scripts/deploy-qgold-escrow-testnet.mjs) in the VPS state
# directory, where the server finds it by default (no runtime.env change). It is
# a function-call key of the publisher account that can only call the escrow's
# release/refund methods (approve_task, confirm_visit, cancel_task, ...,
# withdraw_for). Testnet only. Refuses to replace a different existing file
# silently. Restart the service afterwards (or deploy).
set -Eeuo pipefail
cd "$(dirname "$0")/.."
HOST_TARGET="${DEPLOY_HOST:-root@72.61.188.39}"
test -f .data/escrow-publisher.json
python3 -c 'import json;d=json.load(open(".data/escrow-publisher.json"));assert d["network"]=="testnet" and d["accountId"].endswith(".testnet"), "testnet publisher only"'
ssh -o BatchMode=yes "$HOST_TARGET" 'install -d -m 700 /opt/ps3000/apps/questlayer-hackathon/escrow-key-staging'
scp -q .data/escrow-publisher.json "$HOST_TARGET:/opt/ps3000/apps/questlayer-hackathon/escrow-key-staging/escrow-publisher.json"
ssh -o BatchMode=yes "$HOST_TARGET" python3 - <<'PY'
import pathlib,os,json
root=pathlib.Path('/opt/ps3000/apps/questlayer-hackathon');state=pathlib.Path('/var/lib/questlayer-hackathon');stage=root/'escrow-key-staging'
ref=(state/'award-attestor.pem').stat()
src=stage/'escrow-publisher.json';target=state/'escrow-publisher.json'
assert not src.is_symlink() and src.stat().st_size<4096
item=json.loads(src.read_text());assert item['network']=='testnet' and item['accountId'].endswith('.testnet')
if target.exists() and target.read_bytes()!=src.read_bytes():
    raise SystemExit('Existing escrow-publisher.json differs; move it aside deliberately before replacing it.')
if not target.exists():
    with open(target,'xb') as f:f.write(src.read_bytes())
os.chmod(target,0o600);os.chown(target,ref.st_uid,ref.st_gid)
src.unlink();stage.rmdir()
print(json.dumps({'escrowPublisher':item['accountId'],'installed':str(target),'serviceRestarted':False}))
PY
