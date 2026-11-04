#!/usr/bin/env bash
# Installs the QGOLD keeper key (.data/qgold-keeper.json, written by
# scripts/qgold-keeper-testnet.mjs) in the VPS state directory, where the
# server finds it by default (no runtime.env change). With the key present the
# keeper trades at its 12 committed times a day; QGOLD_KEEPER_EXECUTE=0 in
# runtime.env turns trading off again. The key belongs to a dedicated testnet
# sub-account that holds only its own few test NEAR. Testnet only. Refuses to
# replace a different existing file silently. Restart the service afterwards
# (or deploy) so the keeper loads the key.
set -Eeuo pipefail
cd "$(dirname "$0")/.."
HOST_TARGET="${DEPLOY_HOST:-root@72.61.188.39}"
test -f .data/qgold-keeper.json
python3 -c 'import json;d=json.load(open(".data/qgold-keeper.json"));assert d["network"]=="testnet" and d["accountId"].startswith("qgold-keeper.") and d["accountId"].endswith(".testnet"), "testnet keeper only"'
ssh -o BatchMode=yes "$HOST_TARGET" 'install -d -m 700 /opt/ps3000/apps/questlayer-hackathon/qgold-keeper-staging'
scp -q .data/qgold-keeper.json "$HOST_TARGET:/opt/ps3000/apps/questlayer-hackathon/qgold-keeper-staging/qgold-keeper.json"
ssh -o BatchMode=yes "$HOST_TARGET" python3 - <<'PY'
import pathlib,os,json
root=pathlib.Path('/opt/ps3000/apps/questlayer-hackathon');state=pathlib.Path('/var/lib/questlayer-hackathon');stage=root/'qgold-keeper-staging'
ref=(state/'award-attestor.pem').stat()
src=stage/'qgold-keeper.json';target=state/'qgold-keeper.json'
assert not src.is_symlink() and src.stat().st_size<4096
item=json.loads(src.read_text());assert item['network']=='testnet' and item['accountId'].startswith('qgold-keeper.')
if target.exists() and target.read_bytes()!=src.read_bytes():
    raise SystemExit('Existing qgold-keeper.json differs; move it aside deliberately before replacing it.')
if not target.exists():
    with open(target,'xb') as f:f.write(src.read_bytes())
os.chmod(target,0o600);os.chown(target,ref.st_uid,ref.st_gid)
src.unlink();stage.rmdir()
print(json.dumps({'qgoldKeeper':item['accountId'],'installed':str(target),'serviceRestarted':False}))
PY
