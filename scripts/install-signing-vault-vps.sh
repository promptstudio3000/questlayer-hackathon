#!/usr/bin/env bash
# Installs the independent signing vault (server/signing-vault.mjs, docs/RELAYER.md)
# on the VPS as its own origin, testnet only:
#   https://questlayer-signer.promptstudio3000.com -> 127.0.0.1:7092
# The vault is a static page plus a public JSON config. It has no game database,
# no service keys and no player keys; it runs as its own DynamicUser service
# with no state directory. The *.promptstudio3000.com wildcard DNS already
# points at the VPS and Caddy obtains the certificate.
#
# Run on the Mac from a clean checkout:  bash scripts/install-signing-vault-vps.sh
# Then set SIGNING_VAULT_ORIGIN (and the SUBSIDY_* budget) in runtime.env and
# restart questlayer-hackathon. Re-run this script whenever a contract in the
# config changes (for example a new escrow account). scripts/deploy-vps.sh runs
# it automatically when the fingerprint of its inputs differs from the installed one.
set -Eeuo pipefail
cd "$(dirname "$0")/.."
HOST_TARGET="${DEPLOY_HOST:-root@72.61.188.39}"
APP_ORIGIN="https://questlayer.promptstudio3000.com"
VAULT_HOST="${SIGNING_VAULT_HOST:-questlayer-signer.promptstudio3000.com}"
VAULT_ORIGIN="https://$VAULT_HOST"
PORT=7092
ROOT=/opt/ps3000/apps/questlayer-signer

# The public config: origins, RPC and the contract allowlist from the manifests.
CONFIG="$(node --input-type=module -e '
import { readFileSync, existsSync } from "node:fs";
const m = (n) => JSON.parse(readFileSync(`public/${n}-testnet.json`, "utf8"));
const optional = (n) => (existsSync(`public/${n}-testnet.json`) ? m(n) : null);
const config = {
  appOrigin: process.argv[1], vaultOrigin: process.argv[2], network: "testnet",
  rpcUrl: "https://test.rpc.fastnear.com",
  contracts: {
    qgold: m("native-qgold-vault").tokenContract,
    qgoldEscrow: m("native-qgold-escrow").contractId,
    collectibles: m("native-claims").contractId,
    npcGames: m("native-npc-games").contractId,
    social: "v1.social08.testnet",
    ...(optional("native-treasury-dao") ? { treasuryDao: optional("native-treasury-dao").contractId } : {}),
  },
};
const { validateVaultOrigins } = await import("./src/signing-vault/policy.ts");
validateVaultOrigins(config);
for (const id of Object.values(config.contracts)) if (!id?.endsWith(".testnet")) throw Error("testnet contracts only");
console.log(JSON.stringify(config));
' "$APP_ORIGIN" "$VAULT_ORIGIN")"
echo "$CONFIG"

npx vite build --mode signing-vault >/dev/null
STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT
mkdir -p "$STAGE/dist/signing-vault" "$STAGE/server" "$STAGE/src/signing-vault"
cp dist/signing-vault/signing-vault.html "$STAGE/dist/signing-vault/"
cp -R dist/signing-vault/assets "$STAGE/dist/signing-vault/"
cp server/signing-vault.mjs "$STAGE/server/"
cp src/signing-vault/policy.ts "$STAGE/src/signing-vault/"
printf 'SIGNING_VAULT_PUBLIC_CONFIG=%s\nPORT=%s\n' "$CONFIG" "$PORT" > "$STAGE/signer.env"
bash scripts/signing-vault-fingerprint.sh > "$STAGE/inputs.sha256"

RELEASE="$(date -u +%Y%m%dT%H%M%SZ)"
ssh -o BatchMode=yes "$HOST_TARGET" "install -d -m 755 $ROOT/releases/$RELEASE"
tar -C "$STAGE" -czf - . | ssh -o BatchMode=yes "$HOST_TARGET" "tar -C $ROOT/releases/$RELEASE -xzf -"
ssh -o BatchMode=yes "$HOST_TARGET" bash -s -- "$ROOT" "$RELEASE" "$VAULT_HOST" "$PORT" <<'REMOTE'
set -Eeuo pipefail
ROOT="$1"; RELEASE="$2"; VAULT_HOST="$3"; PORT="$4"
chmod -R a+rX "$ROOT/releases/$RELEASE"
ln -sfn "$ROOT/releases/$RELEASE" "$ROOT/current"
cat > /etc/systemd/system/questlayer-signer.service <<UNIT
[Unit]
Description=QuestLayer independent signing vault (static, testnet)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
DynamicUser=yes
WorkingDirectory=$ROOT/current
EnvironmentFile=$ROOT/current/signer.env
ExecStart=/usr/local/bin/node server/signing-vault.mjs
Restart=on-failure
RestartSec=3
NoNewPrivileges=yes
ProtectSystem=strict
ProtectHome=yes
PrivateTmp=yes
PrivateDevices=yes
MemoryMax=128M
CPUQuota=25%

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable --now questlayer-signer.service
systemctl restart questlayer-signer.service
CADDY=/opt/ps3000/config/caddy/questlayer-signer.caddy
if [[ ! -f "$CADDY" ]]; then
  cat > "$CADDY" <<SITE
$VAULT_HOST {
    import ps3000_traffic
    encode zstd gzip
    reverse_proxy 127.0.0.1:$PORT
    header {
        -Server
        Strict-Transport-Security "max-age=31536000; includeSubDomains"
    }
}
SITE
  caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null
  systemctl reload caddy
fi
# Node needs a few seconds to start under load; wait up to 30 s for the port.
for _ in $(seq 30); do
  curl -fsS -H "Host: $VAULT_HOST" "http://127.0.0.1:$PORT/vault-config.json" >/dev/null 2>&1 && break
  sleep 1
done
systemctl is-active questlayer-signer.service
curl -fsS -H "Host: $VAULT_HOST" "http://127.0.0.1:$PORT/vault-config.json" >/dev/null
# Keep the three newest vault releases.
ls -1dt "$ROOT"/releases/* | tail -n +4 | xargs -r rm -rf
echo "{\"signingVault\": \"https://$VAULT_HOST\", \"release\": \"$RELEASE\"}"
REMOTE
