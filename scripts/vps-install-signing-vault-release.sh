#!/usr/bin/env bash
# Root part of the signing vault install: switch to an unpacked release, write
# the unit and the Caddy site, wait for health, keep three releases. Called over
# ssh by scripts/install-signing-vault-vps.sh (Mac) and locally by the VPS
# release runner (the copy installed from main).
# Args: <root> <release> <vault-host> <port> <service>
set -Eeuo pipefail
ROOT="$1"; RELEASE="$2"; VAULT_HOST="$3"; PORT="$4"; SERVICE="$5"
chmod -R a+rX "$ROOT/releases/$RELEASE"
ln -sfn "$ROOT/releases/$RELEASE" "$ROOT/current"
cat > /etc/systemd/system/$SERVICE.service <<UNIT
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
systemctl enable --now "$SERVICE.service"
systemctl restart "$SERVICE.service"
CADDY=/opt/ps3000/config/caddy/$SERVICE.caddy
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
  curl -fsS --max-time 10 -H "Host: $VAULT_HOST" "http://127.0.0.1:$PORT/vault-config.json" >/dev/null 2>&1 && break
  sleep 1
done
systemctl is-active "$SERVICE.service"
curl -fsS --max-time 10 -H "Host: $VAULT_HOST" "http://127.0.0.1:$PORT/vault-config.json" >/dev/null
# Keep the three newest vault releases.
ls -1dt "$ROOT"/releases/* | tail -n +4 | xargs -r rm -rf
echo "{\"signingVault\": \"https://$VAULT_HOST\", \"release\": \"$RELEASE\"}"
