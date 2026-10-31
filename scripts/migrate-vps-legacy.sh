#!/usr/bin/env bash
# One-time migration of the former installation to the questlayer-hackathon names.
# Usage: DEPLOY_HOST=root@host scripts/migrate-vps-legacy.sh            (migrate)
#        DEPLOY_HOST=root@host scripts/migrate-vps-legacy.sh --rollback <stamp>
set -Eeuo pipefail
cd "$(dirname "$0")/.."
HOST_TARGET="${DEPLOY_HOST:-root@72.61.188.39}"
MODE="${1:-migrate}"
STAMP="${2:-$(date -u +%Y%m%dT%H%M%SZ)}"
scp -o BatchMode=yes -o ConnectTimeout=15 deploy/questlayer-hackathon.service deploy/questlayer-state-backup.service deploy/questlayer-state-backup.timer "${HOST_TARGET}:/tmp/"
ssh -o BatchMode=yes -o ConnectTimeout=15 "$HOST_TARGET" bash -s -- "$MODE" "$STAMP" <<'REMOTE'
set -Eeuo pipefail
MODE="$1"; STAMP="$2"
OLD_APP=/opt/ps3000/apps/auratrail; NEW_APP=/opt/ps3000/apps/questlayer-hackathon
OLD_STATE=/var/lib/auratrail; NEW_STATE=/var/lib/questlayer-hackathon
OLD_UNIT=/etc/systemd/system/auratrail.service; NEW_UNIT=/etc/systemd/system/questlayer-hackathon.service
BACKUP="$NEW_APP/backups/migration-$STAMP"
if [[ "$MODE" == "--rollback" ]]; then
  BACKUP="$NEW_APP/backups/migration-$STAMP"
  [[ -d "$BACKUP" ]] || { echo "No migration backup $BACKUP" >&2; exit 1; }
  systemctl stop questlayer-hackathon questlayer-state-backup.timer 2>/dev/null || true
  [[ -d "$NEW_STATE" && ! -d "$OLD_STATE" ]] && mv "$NEW_STATE" "$OLD_STATE"
  [[ -f "$OLD_STATE/questlayer-hackathon.sqlite" ]] && mv "$OLD_STATE/questlayer-hackathon.sqlite" "$OLD_STATE/auratrail.sqlite"
  for d in releases assets state-backups; do [[ -d "$NEW_APP/$d" && ! -d "$OLD_APP/$d" ]] && mkdir -p "$OLD_APP" && mv "$NEW_APP/$d" "$OLD_APP/$d"; done
  [[ -L "$NEW_APP/current" ]] && mv "$NEW_APP/current" "$OLD_APP/current"
  [[ -f "$BACKUP/runtime.env" ]] && cp -a "$BACKUP/runtime.env" "$OLD_APP/runtime.env"
  [[ -f "$BACKUP/auratrail.service" ]] && cp -a "$BACKUP/auratrail.service" "$OLD_UNIT"
  rm -f "$NEW_UNIT"; systemctl daemon-reload; systemctl enable --now auratrail
  echo "Rolled back to the former installation."; exit 0
fi
[[ -d "$OLD_STATE" || -d "$OLD_APP" || -f "$OLD_UNIT" ]] || { echo "No former installation found; nothing to migrate."; exit 0; }
DBS=( "$OLD_STATE"/*.sqlite ); [[ ${#DBS[@]} -eq 1 && -f "${DBS[0]}" ]] || { echo "Expected exactly one state database in $OLD_STATE" >&2; exit 1; }
OWNER="$(stat -c %U:%G "$OLD_STATE")"
mkdir -p "$BACKUP" "$NEW_APP"; chmod 700 "$NEW_APP/backups" "$BACKUP"
systemctl stop auratrail 2>/dev/null || true
systemctl stop auratrail-state-backup.timer questlayer-state-backup.timer 2>/dev/null || true
python3 - "${DBS[0]}" "$BACKUP/database.sqlite" <<'PY'
import sqlite3,sys
src=sqlite3.connect(f'file:{sys.argv[1]}?mode=ro',uri=True); dst=sqlite3.connect(sys.argv[2]); src.backup(dst); dst.close(); src.close()
PY
[[ -f "$OLD_UNIT" ]] && cp -a "$OLD_UNIT" "$BACKUP/auratrail.service"
[[ -f "$OLD_APP/runtime.env" ]] && cp -a "$OLD_APP/runtime.env" "$BACKUP/runtime.env"
if [[ ! -d "$NEW_STATE" ]]; then mv "$OLD_STATE" "$NEW_STATE"; else echo "$NEW_STATE already exists; refusing to merge" >&2; exit 1; fi
chmod 700 "$NEW_STATE"; chown "$OWNER" "$NEW_STATE"
for f in auratrail.sqlite auratrail.sqlite-wal auratrail.sqlite-shm; do [[ -e "$NEW_STATE/$f" ]] && mv "$NEW_STATE/$f" "$NEW_STATE/${f/auratrail/questlayer-hackathon}"; done
for d in releases assets state-backups; do [[ -d "$OLD_APP/$d" ]] && mv "$OLD_APP/$d" "$NEW_APP/$d"; done
if [[ -L "$OLD_APP/current" ]]; then TARGET="$(readlink "$OLD_APP/current")"; ln -sfn "${TARGET/$OLD_APP/$NEW_APP}" "$NEW_APP/current"; rm -f "$OLD_APP/current"; fi
if [[ -f "$OLD_APP/runtime.env" ]]; then
  sed -e "s#$OLD_STATE#$NEW_STATE#g" -e "s#$OLD_APP#$NEW_APP#g" -e 's#auratrail\.sqlite#questlayer-hackathon.sqlite#g' "$OLD_APP/runtime.env" > "$NEW_APP/runtime.env"
  chmod 600 "$NEW_APP/runtime.env"; rm -f "$OLD_APP/runtime.env"
fi
install -m 644 /tmp/questlayer-hackathon.service "$NEW_UNIT"
install -m 644 /tmp/questlayer-state-backup.service /tmp/questlayer-state-backup.timer /etc/systemd/system/
systemctl disable auratrail 2>/dev/null || true; rm -f "$OLD_UNIT" /etc/systemd/system/auratrail-state-backup.{service,timer}
systemctl daemon-reload; systemctl enable --now questlayer-hackathon; systemctl enable --now questlayer-state-backup.timer
for i in $(seq 1 30); do sleep 1; if curl -fsS http://127.0.0.1:7091/api/health >/dev/null; then echo "Local health OK"; break; fi; [[ $i -eq 30 ]] && { echo "Health check failed; run --rollback $STAMP" >&2; exit 1; }; done
curl -fsS https://questlayer.promptstudio3000.com/api/health | head -c 200; echo
rmdir "$OLD_APP" 2>/dev/null || echo "Note: $OLD_APP not empty; inspect and remove manually."
echo "Migration $STAMP complete. Backup in $BACKUP."
REMOTE
