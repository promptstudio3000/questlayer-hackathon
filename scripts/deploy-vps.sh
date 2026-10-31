#!/usr/bin/env bash
set -Eeuo pipefail
cd "$(dirname "$0")/.."
HOST_TARGET="${DEPLOY_HOST:-root@72.61.188.39}"
RELEASE_TAG="$(date -u +%Y%m%dT%H%M%SZ)"
ARCHIVE_PATH="/tmp/questlayer-hackathon-${RELEASE_TAG}.tgz"
if [[ "${QUESTLAYER_CHECKS_PASSED:-0}" != 1 ]]; then npm run check; fi
COPYFILE_DISABLE=1 tar --no-xattrs -czf "$ARCHIVE_PATH" dist server package.json package-lock.json deploy/questlayer-hackathon.service deploy/retain-static-assets.py
scp -o BatchMode=yes -o ConnectTimeout=15 "$ARCHIVE_PATH" "${HOST_TARGET}:/tmp/questlayer-hackathon-${RELEASE_TAG}.tgz"
ssh -o BatchMode=yes -o ConnectTimeout=15 "$HOST_TARGET" bash -s -- "$RELEASE_TAG" <<'REMOTE'
set -Eeuo pipefail
RELEASE_TAG="$1"
APP_DIR=/opt/ps3000/apps/questlayer-hackathon
if [[ -e /opt/ps3000/apps/auratrail || -e /var/lib/auratrail || -e /etc/systemd/system/auratrail.service ]]; then
 echo 'Legacy installation detected. Follow docs/CLOUD-DEVELOPMENT.md before a separately reviewed VPS migration.' >&2
 exit 1
fi
RELEASE_DIR="$APP_DIR/releases/$RELEASE_TAG"
BACKUP_DIR="$APP_DIR/backups/$RELEASE_TAG"
CADDY_FILE=/opt/ps3000/config/caddy/questlayer.caddy
mkdir -p "$RELEASE_DIR" "$BACKUP_DIR"
chmod 700 "$APP_DIR/backups" "$BACKUP_DIR"
cp -a "$CADDY_FILE" "$BACKUP_DIR/domain.caddy"
OLD_TARGET="$(readlink "$APP_DIR/current" || true)"
if [[ -f /etc/systemd/system/questlayer-hackathon.service ]]; then cp -a /etc/systemd/system/questlayer-hackathon.service "$BACKUP_DIR/questlayer-hackathon.service"; fi
if [[ -f /var/lib/questlayer-hackathon/questlayer-hackathon.sqlite ]]; then
 python3 - "$BACKUP_DIR/database.sqlite" <<'PY'
import sqlite3,sys
source=sqlite3.connect('file:/var/lib/questlayer-hackathon/questlayer-hackathon.sqlite?mode=ro',uri=True)
dest=sqlite3.connect(sys.argv[1]);source.backup(dest);dest.close();source.close()
PY
fi
for SERVICE_KEY in award-attestor.pem reward-attestor.pem reward-worker.json; do
 if [[ -f "/var/lib/questlayer-hackathon/$SERVICE_KEY" ]]; then cp -a "/var/lib/questlayer-hackathon/$SERVICE_KEY" "$BACKUP_DIR/$SERVICE_KEY"; fi
done
RELEASE_ACTIVATED=0
rollback(){
 if [[ "$RELEASE_ACTIVATED" == 1 ]]; then
  systemctl stop questlayer-hackathon || true
  # Current migrations are additive. Never rewind accepted native receipts or
  # claims after a chain transaction. Keep the live database on code rollback;
  # the private snapshot is for a deliberate, reconciled disaster restore only.
 fi
 cp -a "$BACKUP_DIR/domain.caddy" "$CADDY_FILE"
 if [[ -n "$OLD_TARGET" ]]; then ln -sfn "$OLD_TARGET" "$APP_DIR/current"; fi
 if [[ -f "$BACKUP_DIR/questlayer-hackathon.service" ]]; then cp -a "$BACKUP_DIR/questlayer-hackathon.service" /etc/systemd/system/questlayer-hackathon.service; fi
 systemctl daemon-reload
 if [[ -n "$OLD_TARGET" ]]; then systemctl restart questlayer-hackathon; else systemctl stop questlayer-hackathon || true; fi
 caddy validate --config /etc/caddy/Caddyfile >/dev/null && systemctl reload caddy
}
trap rollback ERR
tar -xzf "/tmp/questlayer-hackathon-${RELEASE_TAG}.tgz" -C "$RELEASE_DIR"
cd "$RELEASE_DIR"
npm ci --omit=dev --no-audit --no-fund
python3 deploy/retain-static-assets.py --app-root "$APP_DIR" --release "$RELEASE_DIR"
ln -sfn "$RELEASE_DIR" "$APP_DIR/current"
RELEASE_ACTIVATED=1
install -m 644 deploy/questlayer-hackathon.service /etc/systemd/system/questlayer-hackathon.service
systemctl daemon-reload
systemctl enable questlayer-hackathon >/dev/null
systemctl restart questlayer-hackathon
for i in {1..25}; do if curl -fsS http://127.0.0.1:7091/api/health >/dev/null; then break; fi; sleep 1; done
curl -fsS http://127.0.0.1:7091/api/health
if [[ -f /var/lib/questlayer-hackathon/award-attestor.pem && ! -f "$BACKUP_DIR/award-attestor.pem" ]]; then cp -a /var/lib/questlayer-hackathon/award-attestor.pem "$BACKUP_DIR/award-attestor.pem"; fi
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
caddy validate --config /etc/caddy/Caddyfile >/dev/null
systemctl reload caddy
curl -fsS --retry 3 --retry-delay 1 https://questlayer.promptstudio3000.com/api/health
trap - ERR
printf '\nDeployed release: %s\nBackup: %s\n' "$RELEASE_DIR" "$BACKUP_DIR"
REMOTE
rm -f "$ARCHIVE_PATH"
