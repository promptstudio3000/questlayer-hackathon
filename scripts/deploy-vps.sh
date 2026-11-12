#!/usr/bin/env bash
set -Eeuo pipefail
cd "$(dirname "$0")/.."
HOST_TARGET="${DEPLOY_HOST:-root@72.61.188.39}"
# Default: the testnet service. `--mainnet` (or DEPLOY_TARGET=mainnet) ships the
# separate mainnet slice service instead: its own app directory, state
# directory, database, port, unit and Caddy file. The testnet service is not
# touched in that mode (docs/OWNER-RUNBOOK.md §7).
TARGET="${DEPLOY_TARGET:-testnet}"
if [[ "${1:-}" == "--mainnet" ]]; then TARGET=mainnet; fi
# `--testlayer` ships the Test Layer (docs/TEST-LAYER.md): the same game on its
# own testnet contract set, database, port, unit and Caddy file.
if [[ "${1:-}" == "--testlayer" ]]; then TARGET=testlayer; fi
case "$TARGET" in
 testnet) APP_NAME=questlayer-hackathon; APP_PORT=7091; APP_DOMAIN=questlayer.promptstudio3000.com ;;
 mainnet) APP_NAME=questlayer-mainnet; APP_PORT=7092; APP_DOMAIN="${MAINNET_DOMAIN:-mainnet.questlayer.promptstudio3000.com}" ;;
 testlayer) APP_NAME=questlayer-testlayer; APP_PORT=7093; APP_DOMAIN=questlayer-test.promptstudio3000.com ;;
 *) echo "DEPLOY_TARGET must be testnet, testlayer or mainnet." >&2; exit 1 ;;
esac
if [[ "$TARGET" == mainnet ]]; then
 # Serving the mainnet slice is a go/no-go decision (docs/MAINNET-PLAN.md §5).
 if [[ "${QUESTLAYER_MAINNET_DEPLOY_CONFIRM:-}" != "$APP_DOMAIN" ]]; then
  echo "Mainnet deploy requires QUESTLAYER_MAINNET_DEPLOY_CONFIRM=$APP_DOMAIN." >&2; exit 1
 fi
 for f in public/mainnet-deployment.json public/native-claims-mainnet.json; do
  if [[ ! -f "$f" ]]; then echo "$f is missing; run scripts/deploy-mainnet-slice.mjs --network mainnet --execute first." >&2; exit 1; fi
 done
fi
if [[ "$TARGET" == testlayer ]]; then
 for f in public/testlayer-deployment.json public/native-claims-testlayer.json; do
  if [[ ! -f "$f" ]]; then echo "$f is missing; run node scripts/deploy-testlayer.mjs --execute first." >&2; exit 1; fi
 done
fi
RELEASE_TAG="$(date -u +%Y%m%dT%H%M%SZ)"
ARCHIVE_PATH="/tmp/${APP_NAME}-${RELEASE_TAG}.tgz"
if [[ "${QUESTLAYER_CHECKS_PASSED:-0}" != 1 ]]; then npm run check; fi
# The client fixes its network at build time (src/near-network.ts).
if [[ "$TARGET" == mainnet ]]; then VITE_NEAR_NETWORK=mainnet npm run build; fi
# The Test Layer bundle pins the -testlayer manifests (vite.config.ts).
if [[ "$TARGET" == testlayer ]]; then VITE_QL_LAYER=test npm run build; fi
# Record the deployed commit for /api/health; an uncommitted tree stays unrecorded.
if [[ -z "$(git status --porcelain --untracked-files=no)" ]]; then git rev-parse HEAD > build-id.txt
else echo "Working tree has uncommitted changes; health will report development-unrecorded." >&2; : > build-id.txt; fi
COPYFILE_DISABLE=1 tar --no-xattrs -czf "$ARCHIVE_PATH" build-id.txt dist server public/*.json package.json package-lock.json "deploy/${APP_NAME}.service" deploy/retain-static-assets.py scripts/poi scripts/treasury-worker-vps.sh scripts/stnear-treasury-testnet.mjs scripts/treasury-mix-testnet.mjs scripts/treasury-dao-testnet.mjs
# Leave the testnet bundle in dist/ for the next testnet deploy or local run.
if [[ "$TARGET" == mainnet || "$TARGET" == testlayer ]]; then npm run build >/dev/null; fi
scp -o BatchMode=yes -o ConnectTimeout=15 "$ARCHIVE_PATH" "${HOST_TARGET}:/tmp/${APP_NAME}-${RELEASE_TAG}.tgz"
ssh -o BatchMode=yes -o ConnectTimeout=15 "$HOST_TARGET" bash -s -- "$RELEASE_TAG" "$TARGET" "$APP_NAME" "$APP_PORT" "$APP_DOMAIN" <<'REMOTE'
set -Eeuo pipefail
RELEASE_TAG="$1" TARGET="$2" APP_NAME="$3" APP_PORT="$4" APP_DOMAIN="$5"
APP_DIR="/opt/ps3000/apps/$APP_NAME"
STATE_DIR="/var/lib/$APP_NAME"
UNIT="/etc/systemd/system/$APP_NAME.service"
if [[ -e /opt/ps3000/apps/auratrail || -e /var/lib/auratrail || -e /etc/systemd/system/auratrail.service ]]; then
 echo 'Legacy installation detected. Follow docs/CLOUD-DEVELOPMENT.md before a separately reviewed VPS migration.' >&2
 exit 1
fi
RELEASE_DIR="$APP_DIR/releases/$RELEASE_TAG"
BACKUP_DIR="$APP_DIR/backups/$RELEASE_TAG"
if [[ "$TARGET" == mainnet ]]; then CADDY_FILE=/opt/ps3000/config/caddy/questlayer-mainnet.caddy
elif [[ "$TARGET" == testlayer ]]; then CADDY_FILE=/opt/ps3000/config/caddy/questlayer-testlayer.caddy
else CADDY_FILE=/opt/ps3000/config/caddy/questlayer.caddy; fi
if [[ "$TARGET" == testlayer ]]; then
 # The contracts trust only the keys scripts/deploy-testlayer.mjs created.
 for KEY in award-attestor.pem player-factory.json relayer.json; do
  if [[ ! -f "$STATE_DIR/$KEY" && ! -f "/var/lib/private/$APP_NAME/$KEY" ]]; then
   echo "$STATE_DIR/$KEY is missing; run scripts/install-testlayer-keys-vps.sh first." >&2; exit 1
  fi
 done
fi
if [[ "$TARGET" == mainnet ]]; then
 # The server would create a fresh award key if none existed, and the mainnet
 # contract trusts only the one set by deploy-mainnet-slice.mjs.
 for KEY in award-attestor.pem player-factory-mainnet.json relayer-mainnet.json; do
  if [[ ! -f "$STATE_DIR/$KEY" && ! -f "/var/lib/private/$APP_NAME/$KEY" ]]; then
   echo "$STATE_DIR/$KEY is missing; run scripts/install-mainnet-keys-vps.sh first." >&2; exit 1
  fi
 done
 if [[ ! -f "$APP_DIR/runtime.env" ]] || ! grep -q '^PLAYER_FACTORY_ACCOUNT=' "$APP_DIR/runtime.env"; then
  echo "$APP_DIR/runtime.env must set PLAYER_FACTORY_ACCOUNT (from .data/runtime-mainnet.env)." >&2; exit 1
 fi
fi
mkdir -p "$RELEASE_DIR" "$BACKUP_DIR"
chmod 700 "$APP_DIR/backups" "$BACKUP_DIR"
if [[ -f "$CADDY_FILE" ]]; then cp -a "$CADDY_FILE" "$BACKUP_DIR/domain.caddy"; fi
OLD_TARGET="$(readlink "$APP_DIR/current" || true)"
if [[ -f "$UNIT" ]]; then cp -a "$UNIT" "$BACKUP_DIR/$APP_NAME.service"; fi
if [[ -f "$STATE_DIR/$APP_NAME.sqlite" ]]; then
 python3 - "$BACKUP_DIR/database.sqlite" "$STATE_DIR/$APP_NAME.sqlite" <<'PY'
import sqlite3,sys
source=sqlite3.connect(f'file:{sys.argv[2]}?mode=ro',uri=True)
dest=sqlite3.connect(sys.argv[1]);source.backup(dest);dest.close();source.close()
PY
fi
for SERVICE_KEY in award-attestor.pem reward-attestor.pem reward-worker.json; do
 if [[ -f "$STATE_DIR/$SERVICE_KEY" ]]; then cp -a "$STATE_DIR/$SERVICE_KEY" "$BACKUP_DIR/$SERVICE_KEY"; fi
done
# Gotchiverse-test-app workshops (docs/GOTCHIVERSE.md) are JSON files beside the database.
if [[ -d "$STATE_DIR/gotchiverse" ]]; then cp -a "$STATE_DIR/gotchiverse" "$BACKUP_DIR/gotchiverse"; fi
RELEASE_ACTIVATED=0
rollback(){
 if [[ "$RELEASE_ACTIVATED" == 1 ]]; then
  systemctl stop "$APP_NAME" || true
  # Current migrations are additive. Never rewind accepted native receipts or
  # claims after a chain transaction. Keep the live database on code rollback;
  # the private snapshot is for a deliberate, reconciled disaster restore only.
 fi
 if [[ -f "$BACKUP_DIR/domain.caddy" ]]; then cp -a "$BACKUP_DIR/domain.caddy" "$CADDY_FILE"; else rm -f "$CADDY_FILE"; fi
 if [[ -n "$OLD_TARGET" ]]; then ln -sfn "$OLD_TARGET" "$APP_DIR/current"; fi
 if [[ -f "$BACKUP_DIR/$APP_NAME.service" ]]; then cp -a "$BACKUP_DIR/$APP_NAME.service" "$UNIT"; fi
 systemctl daemon-reload
 if [[ -n "$OLD_TARGET" ]]; then systemctl restart "$APP_NAME"; else systemctl stop "$APP_NAME" || true; fi
 caddy validate --config /etc/caddy/Caddyfile >/dev/null && systemctl reload caddy
}
trap rollback ERR
tar -xzf "/tmp/${APP_NAME}-${RELEASE_TAG}.tgz" -C "$RELEASE_DIR"
cd "$RELEASE_DIR"
npm ci --omit=dev --no-audit --no-fund
python3 deploy/retain-static-assets.py --app-root "$APP_DIR" --release "$RELEASE_DIR"
ln -sfn "$RELEASE_DIR" "$APP_DIR/current"
RELEASE_ACTIVATED=1
install -m 644 "deploy/$APP_NAME.service" "$UNIT"
systemctl daemon-reload
systemctl enable "$APP_NAME" >/dev/null
systemctl restart "$APP_NAME"
for i in {1..25}; do if curl -fsS "http://127.0.0.1:$APP_PORT/api/health" >/dev/null; then break; fi; sleep 1; done
curl -fsS "http://127.0.0.1:$APP_PORT/api/health"
# W5: the World worker builds auto CityPacks after each POI import. When a POI
# release exists but no auto city index yet, start one worker run now (it reuses
# the downloaded inputs) instead of waiting for Sunday's timer.
if [[ "$TARGET" != mainnet && -f /etc/systemd/system/questlayer-poi.service && -e /var/lib/questlayer-poi/current.sqlite && ! -e /var/lib/questlayer-poi/city-packs/index.json ]]; then
 systemctl start --no-block questlayer-poi.service && echo "Started questlayer-poi to build auto cities (journalctl -u questlayer-poi)."
fi
if [[ "$TARGET" == mainnet ]]; then
 curl -fsS "http://127.0.0.1:$APP_PORT/api/health" | python3 -c 'import json,sys; h=json.load(sys.stdin); assert h["network"]=="mainnet", h["network"]; print("network:", h["network"], "features:", h["features"])'
fi
if [[ -f "$STATE_DIR/award-attestor.pem" && ! -f "$BACKUP_DIR/award-attestor.pem" ]]; then cp -a "$STATE_DIR/award-attestor.pem" "$BACKUP_DIR/award-attestor.pem"; fi
if [[ "$TARGET" == mainnet || "$TARGET" == testlayer ]]; then
 # A new site file of its own; the testnet questlayer.caddy is never edited.
 cat > "$CADDY_FILE" <<CADDY
$APP_DOMAIN {
    import ps3000_traffic
    encode zstd gzip
    reverse_proxy 127.0.0.1:$APP_PORT {
        flush_interval -1
    }
    header {
        -Server
        X-Content-Type-Options nosniff
        X-Frame-Options DENY
        Referrer-Policy strict-origin-when-cross-origin
        Strict-Transport-Security "max-age=31536000; includeSubDomains"
    }
}
CADDY
 if ! caddy adapt --config /etc/caddy/Caddyfile 2>/dev/null | grep -qF "\"$APP_DOMAIN\""; then
  echo "/etc/caddy/Caddyfile does not import $CADDY_FILE; add the import and re-run." >&2; false
 fi
else
python3 - "$CADDY_FILE" <<'PY'
import pathlib,re,sys
p=pathlib.Path(sys.argv[1]);source=p.read_text()
pattern=r'questlayer\.promptstudio3000\.com\s*\{[^{}]*(?:\{uri\}[^{}]*)?\}'
replacement='''questlayer.promptstudio3000.com {
    import ps3000_traffic
    encode zstd gzip
    reverse_proxy 127.0.0.1:7091 {
        flush_interval -1
    }
    header {
        -Server
        X-Content-Type-Options nosniff
        X-Frame-Options DENY
        Referrer-Policy strict-origin-when-cross-origin
        Strict-Transport-Security "max-age=31536000; includeSubDomains"
    }
}'''
if 'reverse_proxy 127.0.0.1:7091' in source:
 print('Domain already points to QuestLayer; preserving route.')
else:
 updated,n=re.subn(pattern,replacement,source,count=1)
 if n!=1:raise SystemExit('Expected one existing domain block; refusing to change routing.')
 p.write_text(updated)
PY
fi
caddy validate --config /etc/caddy/Caddyfile >/dev/null
systemctl reload caddy
curl -fsS --retry 3 --retry-delay 1 "https://$APP_DOMAIN/api/health"
trap - ERR
printf '\nDeployed release: %s\nBackup: %s\n' "$RELEASE_DIR" "$BACKUP_DIR"
REMOTE
rm -f "$ARCHIVE_PATH"
# The signing vault is its own origin and release (install-signing-vault-vps.sh).
# Reinstall it whenever its sources, installer or contract manifests changed
# since the installed release; SKIP_SIGNING_VAULT=1 leaves it as it is.
if [[ "$TARGET" != mainnet && "${SKIP_SIGNING_VAULT:-0}" != 1 ]]; then
 if [[ "$TARGET" == testlayer ]]; then VSET=testlayer; VLAYER=test; VROOT=questlayer-test-signer; else VSET=testnet; VLAYER=world; VROOT=questlayer-signer; fi
 WANT="$(bash scripts/signing-vault-fingerprint.sh "$VSET")"
 HAVE="$(ssh -o BatchMode=yes -o ConnectTimeout=15 "$HOST_TARGET" "cat /opt/ps3000/apps/$VROOT/current/inputs.sha256 2>/dev/null || true")"
 if [[ "$WANT" != "$HAVE" ]]; then
  echo "Signing vault inputs changed (${HAVE:-none installed} -> $WANT); reinstalling the vault."
  SIGNING_VAULT_LAYER="$VLAYER" bash scripts/install-signing-vault-vps.sh
 else
  echo "Signing vault unchanged ($WANT)."
 fi
fi
