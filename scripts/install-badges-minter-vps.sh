#!/usr/bin/env bash
# Installs the badge minter key (.data/badges-minter.json, written by
# scripts/deploy-badges-testnet.mjs) in the VPS state directory, where the
# server finds it by default (no runtime.env change). It is a function-call key
# on the badges contract account that can only call create_badge and claim.
# Testnet only. Refuses to replace a different existing file silently. Restart
# the service afterwards (or deploy) so the badge worker connects.
set -Eeuo pipefail
cd "$(dirname "$0")/.."
HOST_TARGET="${DEPLOY_HOST:-root@72.61.188.39}"
test -f .data/badges-minter.json
python3 -c 'import json;d=json.load(open(".data/badges-minter.json"));assert d["network"]=="testnet" and d["accountId"].endswith(".testnet"), "testnet minter only"'
ssh -o BatchMode=yes "$HOST_TARGET" 'install -d -m 700 /opt/ps3000/apps/questlayer-hackathon/badge-key-staging'
scp -q .data/badges-minter.json "$HOST_TARGET:/opt/ps3000/apps/questlayer-hackathon/badge-key-staging/badges-minter.json"
ssh -o BatchMode=yes "$HOST_TARGET" python3 - <<'PY'
import pathlib,os,json
root=pathlib.Path('/opt/ps3000/apps/questlayer-hackathon');state=pathlib.Path('/var/lib/questlayer-hackathon');stage=root/'badge-key-staging'
ref=(state/'award-attestor.pem').stat()
src=stage/'badges-minter.json';target=state/'badges-minter.json'
assert not src.is_symlink() and src.stat().st_size<4096
item=json.loads(src.read_text());assert item['network']=='testnet' and item['accountId'].endswith('.testnet')
if target.exists() and target.read_bytes()!=src.read_bytes():
    raise SystemExit('Existing badges-minter.json differs; move it aside deliberately before replacing it.')
if not target.exists():
    with open(target,'xb') as f:f.write(src.read_bytes())
os.chmod(target,0o600);os.chown(target,ref.st_uid,ref.st_gid)
src.unlink();stage.rmdir()
print(json.dumps({'badgesMinter':item['accountId'],'installed':str(target),'serviceRestarted':False}))
PY
