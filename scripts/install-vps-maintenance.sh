#!/usr/bin/env bash
set -Eeuo pipefail
cd "$(dirname "$0")/.."
HOST_TARGET="${DEPLOY_HOST:-root@72.61.188.39}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
ARCHIVE="/tmp/questlayer-maintenance-$STAMP.tgz"
COPYFILE_DISABLE=1 tar --no-xattrs -czf "$ARCHIVE" deploy/backup-state.py deploy/questlayer-state-backup.service deploy/questlayer-state-backup.timer
scp -o BatchMode=yes -o ConnectTimeout=15 "$ARCHIVE" "$HOST_TARGET:/tmp/questlayer-maintenance-$STAMP.tgz"
ssh -o BatchMode=yes -o ConnectTimeout=15 "$HOST_TARGET" bash -s -- "$STAMP" <<'REMOTE'
set -Eeuo pipefail
STAMP="$1"
APP=/opt/ps3000/apps/questlayer-hackathon
OPERATIONS="$APP/operations"
BACKUP="$APP/backups/maintenance-$STAMP"
mkdir -p "$OPERATIONS" "$BACKUP" "$APP/state-backups"
chmod 755 "$OPERATIONS"
chmod 700 "$BACKUP" "$APP/state-backups"
for unit in questlayer-state-backup.service questlayer-state-backup.timer; do
 if [[ -f "/etc/systemd/system/$unit" ]]; then
  grep -q 'Description=QuestLayer' "/etc/systemd/system/$unit"
  cp -a "/etc/systemd/system/$unit" "$BACKUP/$unit"
 fi
done
if [[ -f "$OPERATIONS/backup-state.py" ]]; then cp -a "$OPERATIONS/backup-state.py" "$BACKUP/backup-state.py"; fi
tar -xzf "/tmp/questlayer-maintenance-$STAMP.tgz" -C "$BACKUP"
install -m 644 "$BACKUP/deploy/backup-state.py" "$OPERATIONS/backup-state.py"
install -m 644 "$BACKUP/deploy/questlayer-state-backup.service" /etc/systemd/system/questlayer-state-backup.service
install -m 644 "$BACKUP/deploy/questlayer-state-backup.timer" /etc/systemd/system/questlayer-state-backup.timer
systemd-analyze verify /etc/systemd/system/questlayer-state-backup.service /etc/systemd/system/questlayer-state-backup.timer
systemctl daemon-reload
systemctl start questlayer-state-backup.service
systemctl enable --now questlayer-state-backup.timer
systemctl show questlayer-state-backup.service --property=Result --property=ExecMainStatus
systemctl list-timers questlayer-state-backup.timer --no-pager
REMOTE
rm -f "$ARCHIVE"
