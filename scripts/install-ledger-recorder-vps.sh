#!/usr/bin/env bash
# Installs the ledger recorder key (.data/ledger-recorder.json, written by
# scripts/deploy-ledger-testnet.mjs) in the VPS state directory, where the
# server finds it by default (no runtime.env change). It is a function-call key
# on the ledger contract account that can only call record_batch, commit_day
# and retry_gold. Testnet only. Refuses to replace a different existing file
# silently. Restart the service afterwards (or deploy) so the ledger worker
# connects.
set -Eeuo pipefail
cd "$(dirname "$0")/.."
HOST_TARGET="${DEPLOY_HOST:-root@72.61.188.39}"
test -f .data/ledger-recorder.json
python3 -c 'import json;d=json.load(open(".data/ledger-recorder.json"));assert d["network"]=="testnet" and d["accountId"].endswith(".testnet"), "testnet recorder only"'
ssh -o BatchMode=yes "$HOST_TARGET" 'install -d -m 700 /opt/ps3000/apps/questlayer-hackathon/ledger-key-staging'
scp -q .data/ledger-recorder.json "$HOST_TARGET:/opt/ps3000/apps/questlayer-hackathon/ledger-key-staging/ledger-recorder.json"
ssh -o BatchMode=yes "$HOST_TARGET" python3 - <<'PY'
import pathlib,os,json
root=pathlib.Path('/opt/ps3000/apps/questlayer-hackathon');state=pathlib.Path('/var/lib/questlayer-hackathon');stage=root/'ledger-key-staging'
ref=(state/'award-attestor.pem').stat()
src=stage/'ledger-recorder.json';target=state/'ledger-recorder.json'
assert not src.is_symlink() and src.stat().st_size<4096
item=json.loads(src.read_text());assert item['network']=='testnet' and item['accountId'].endswith('.testnet')
if target.exists() and target.read_bytes()!=src.read_bytes():
    raise SystemExit('Existing ledger-recorder.json differs; move it aside deliberately before replacing it.')
if not target.exists():
    with open(target,'xb') as f:f.write(src.read_bytes())
os.chmod(target,0o600);os.chown(target,ref.st_uid,ref.st_gid)
src.unlink();stage.rmdir()
print(json.dumps({'ledgerRecorder':item['accountId'],'installed':str(target),'serviceRestarted':False}))
PY
