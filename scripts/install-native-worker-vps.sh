#!/usr/bin/env bash
set -Eeuo pipefail
cd "$(dirname "$0")/.."
HOST_TARGET="${DEPLOY_HOST:-root@72.61.188.39}"
ssh -o BatchMode=yes "$HOST_TARGET" 'install -d -m 700 /opt/ps3000/apps/auratrail/native-key-staging'
scp -q .data/reward-attestor.pem .data/reward-worker.json "$HOST_TARGET:/opt/ps3000/apps/auratrail/native-key-staging/"
ssh -o BatchMode=yes "$HOST_TARGET" python3 - <<'PY'
import pathlib,os,shutil,datetime,json,stat
root=pathlib.Path('/opt/ps3000/apps/auratrail');state=pathlib.Path('/var/lib/auratrail');stage=root/'native-key-staging'
ref=(state/'award-attestor.pem').stat()
for name in ('reward-attestor.pem','reward-worker.json'):
    src=stage/name;target=state/name
    assert not src.is_symlink() and src.stat().st_size<4096
    if name.endswith('.json'):
        item=json.loads(src.read_text());assert item['network']=='testnet' and item['accountId']=='questlayer-rewards-20261031.testnet'
    if target.exists():
        assert target.read_bytes()==src.read_bytes(), 'Existing service key differs; do not replace silently'
    else:
        with open(target,'xb') as f:f.write(src.read_bytes())
    os.chmod(target,0o600);os.chown(target,ref.st_uid,ref.st_gid)
    src.unlink()
stage.rmdir()
env=root/'runtime.env';original=env.read_text() if env.exists() else ''
backup=root/'backups'/('native-config-'+datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ'));backup.mkdir(mode=0o700)
(backup/'runtime.env').write_text(original);os.chmod(backup/'runtime.env',0o600)
updates={'REWARD_ATTESTOR_PATH':'/var/lib/auratrail/reward-attestor.pem','REWARD_WORKER_KEY_PATH':'/var/lib/auratrail/reward-worker.json'}
lines=[line for line in original.splitlines() if line.partition('=')[0] not in updates]
lines += [f'{k}={v}' for k,v in updates.items()]
env.write_text('\n'.join(lines)+'\n');os.chmod(env,0o600)
print(json.dumps({'nativeServiceKeys':'installed privately','playerWalletKeysUploaded':False,'workerReceiver':'questlayer-rewards-20261031.testnet','serviceRestarted':False}))
PY
