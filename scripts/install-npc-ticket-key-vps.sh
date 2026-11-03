#!/usr/bin/env bash
# Installs the npc-games roll ticket key (.data/npc-games-ticket-signer.pem,
# written by scripts/deploy-npc-games-testnet.mjs) in the VPS state directory,
# where the server finds it by default (no runtime.env change). Testnet only.
# It prints only the public key and refuses to replace a different existing
# key silently. Deploy (or restart the service) afterwards so rolls open.
set -Eeuo pipefail
cd "$(dirname "$0")/.."
HOST_TARGET="${DEPLOY_HOST:-root@72.61.188.39}"
KEY=.data/npc-games-ticket-signer.pem
test -f "$KEY"
test "$(stat -f '%Lp' "$KEY" 2>/dev/null || stat -c '%a' "$KEY")" = 600
node -e '
const { createPrivateKey, createPublicKey } = require("node:crypto");
const fs = require("node:fs");
const pub = createPublicKey(createPrivateKey(fs.readFileSync(process.argv[1]))).export({ type: "spki", format: "der" }).subarray(-32).toString("base64");
const m = JSON.parse(fs.readFileSync("public/native-npc-games-testnet.json", "utf8"));
if (m.network !== "testnet" || m.ticketSignerPublicKey !== pub) { console.error("The key does not match public/native-npc-games-testnet.json"); process.exit(1); }
console.log(JSON.stringify({ ticketSignerPublicKey: pub, contractId: m.contractId }));
' "$KEY"
ssh -o BatchMode=yes "$HOST_TARGET" 'install -d -m 700 /opt/ps3000/apps/questlayer-hackathon/npc-key-staging'
scp -q "$KEY" "$HOST_TARGET:/opt/ps3000/apps/questlayer-hackathon/npc-key-staging/npc-games-ticket-signer.pem"
ssh -o BatchMode=yes "$HOST_TARGET" python3 - <<'PY'
import pathlib,os,json
root=pathlib.Path('/opt/ps3000/apps/questlayer-hackathon');state=pathlib.Path('/var/lib/questlayer-hackathon');stage=root/'npc-key-staging'
ref=(state/'award-attestor.pem').stat()
src=stage/'npc-games-ticket-signer.pem';target=state/'npc-games-ticket-signer.pem'
assert not src.is_symlink() and src.stat().st_size<4096 and src.read_bytes().startswith(b'-----BEGIN PRIVATE KEY-----')
if target.exists() and target.read_bytes()!=src.read_bytes():
    raise SystemExit('Existing npc-games-ticket-signer.pem differs; move it aside deliberately before replacing it.')
if not target.exists():
    fd=os.open(target,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
    with os.fdopen(fd,'wb') as f:f.write(src.read_bytes())
os.chmod(target,0o600);os.chown(target,ref.st_uid,ref.st_gid)
src.unlink()
try: stage.rmdir()
except OSError: pass
print(json.dumps({'installed':str(target),'serviceRestarted':False}))
PY
