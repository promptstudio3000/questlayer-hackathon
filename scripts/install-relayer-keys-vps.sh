#!/usr/bin/env bash
# Installs the player-factory and relayer service keys privately on the VPS and
# points runtime.env at them. Mirrors install-native-worker-vps.sh; it never
# uploads a player key and does not restart the service.
set -Eeuo pipefail
cd "$(dirname "$0")/.."
HOST_TARGET="${DEPLOY_HOST:-root@72.61.188.39}"
FACTORY_ACCOUNT="$(python3 -c 'import json;print(json.load(open(".data/player-factory.json"))["accountId"])')"
RELAYER_ACCOUNT="$(python3 -c 'import json;print(json.load(open(".data/relayer.json"))["accountId"])')"
# Optional creator money publisher key (function-call key of the creators contract).
PUBLISHER_ACCOUNT=""
PUBLISHER_FILES=()
if [ -f .data/creators-publisher.json ]; then
  PUBLISHER_ACCOUNT="$(python3 -c 'import json;print(json.load(open(".data/creators-publisher.json"))["accountId"])')"
  PUBLISHER_FILES=(.data/creators-publisher.json)
fi
ssh -o BatchMode=yes "$HOST_TARGET" 'install -d -m 700 /opt/ps3000/apps/questlayer-hackathon/native-key-staging'
scp -q .data/player-factory.json .data/relayer.json "${PUBLISHER_FILES[@]}" "$HOST_TARGET:/opt/ps3000/apps/questlayer-hackathon/native-key-staging/"
ssh -o BatchMode=yes "$HOST_TARGET" python3 - "$FACTORY_ACCOUNT" "$RELAYER_ACCOUNT" "$PUBLISHER_ACCOUNT" <<'PY'
import pathlib,os,datetime,json,sys
factory_account,relayer_account,publisher_account=sys.argv[1],sys.argv[2],sys.argv[3]
root=pathlib.Path('/opt/ps3000/apps/questlayer-hackathon');state=pathlib.Path('/var/lib/questlayer-hackathon');stage=root/'native-key-staging'
ref=(state/'award-attestor.pem').stat()
keys=[('player-factory.json',factory_account),('relayer.json',relayer_account)]
if publisher_account: keys.append(('creators-publisher.json',publisher_account))
for name,account in keys:
    src=stage/name;target=state/name
    assert not src.is_symlink() and src.stat().st_size<4096
    item=json.loads(src.read_text());assert item['network']=='testnet' and item['accountId']==account and account.endswith('.testnet')
    if target.exists():
        assert target.read_bytes()==src.read_bytes(), 'Existing service key differs; do not replace silently'
    else:
        with open(target,'xb') as f:f.write(src.read_bytes())
    os.chmod(target,0o600);os.chown(target,ref.st_uid,ref.st_gid)
    src.unlink()
stage.rmdir()
env=root/'runtime.env';original=env.read_text() if env.exists() else ''
backup=root/'backups'/('relayer-config-'+datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ'));backup.mkdir(mode=0o700)
(backup/'runtime.env').write_text(original);os.chmod(backup/'runtime.env',0o600)
updates={'PLAYER_FACTORY_ACCOUNT':factory_account,'PLAYER_FACTORY_KEY_PATH':'/var/lib/questlayer-hackathon/player-factory.json','RELAYER_KEY_PATH':'/var/lib/questlayer-hackathon/relayer.json'}
if publisher_account: updates['CREATORS_PUBLISHER_KEY_PATH']='/var/lib/questlayer-hackathon/creators-publisher.json'
lines=[line for line in original.splitlines() if line.partition('=')[0] not in updates]
lines += [f'{k}={v}' for k,v in updates.items()]
env.write_text('\n'.join(lines)+'\n');os.chmod(env,0o600)
print(json.dumps({'relayerServiceKeys':'installed privately','playerWalletKeysUploaded':False,'factory':factory_account,'relayer':relayer_account,'creatorsPublisher':publisher_account or None,'serviceRestarted':False}))
PY
