#!/usr/bin/env bash
# Installs the private NPC traders file (.data/npc-traders.json, written by
# scripts/npc-trader-testnet.mjs setup --execute) on the VPS state directory,
# where the server finds it by default (no runtime.env change). Testnet only.
# It refuses to replace a different existing file silently. Restart the
# service afterwards (or deploy) so the traders open.
set -Eeuo pipefail
cd "$(dirname "$0")/.."
HOST_TARGET="${DEPLOY_HOST:-root@72.61.188.39}"
test -f .data/npc-traders.json
python3 -c 'import json;d=json.load(open(".data/npc-traders.json"));assert d["network"]=="testnet" and d["traders"] and all(t["accountId"].endswith(".testnet") and t.get("fundedAt") for t in d["traders"]), "run setup --execute first"'
ssh -o BatchMode=yes "$HOST_TARGET" 'install -d -m 700 /opt/ps3000/apps/questlayer-hackathon/npc-key-staging'
scp -q .data/npc-traders.json "$HOST_TARGET:/opt/ps3000/apps/questlayer-hackathon/npc-key-staging/npc-traders.json"
ssh -o BatchMode=yes "$HOST_TARGET" python3 - <<'PY'
import pathlib,os,json
root=pathlib.Path('/opt/ps3000/apps/questlayer-hackathon');state=pathlib.Path('/var/lib/questlayer-hackathon');stage=root/'npc-key-staging'
ref=(state/'award-attestor.pem').stat()
src=stage/'npc-traders.json';target=state/'npc-traders.json'
assert not src.is_symlink() and src.stat().st_size<16384
item=json.loads(src.read_text());assert item['network']=='testnet' and all(t['accountId'].endswith('.testnet') for t in item['traders'])
if target.exists() and target.read_bytes()!=src.read_bytes():
    raise SystemExit('Existing npc-traders.json differs; move it aside deliberately before replacing it.')
if not target.exists():
    with open(target,'xb') as f:f.write(src.read_bytes())
os.chmod(target,0o600);os.chown(target,ref.st_uid,ref.st_gid)
src.unlink();stage.rmdir()
print(json.dumps({'npcTraders':[t['actorId'] for t in item['traders']],'installed':str(target),'serviceRestarted':False}))
PY
