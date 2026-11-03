#!/usr/bin/env bash
# Installs the World worker (weekly POI import, docs/POI-PIPELINE.md) on the
# testnet VPS: osmium-tool, unzip, a pinned DuckDB CLI, a system user and the
# questlayer-poi service/timer, then starts the first import in the
# background. Idempotent. The code itself ships with scripts/deploy-vps.sh.
set -Eeuo pipefail
cd "$(dirname "$0")/.."
HOST_TARGET="${DEPLOY_HOST:-root@72.61.188.39}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
ARCHIVE="/tmp/questlayer-poi-$STAMP.tgz"
COPYFILE_DISABLE=1 tar --no-xattrs -czf "$ARCHIVE" deploy/questlayer-poi.service deploy/questlayer-poi.timer
scp -o BatchMode=yes -o ConnectTimeout=15 "$ARCHIVE" "$HOST_TARGET:/tmp/questlayer-poi-$STAMP.tgz"
ssh -o BatchMode=yes -o ConnectTimeout=15 "$HOST_TARGET" bash -s -- "$STAMP" <<'REMOTE'
set -Eeuo pipefail
STAMP="$1"
APP=/opt/ps3000/apps/questlayer-hackathon
DUCKDB_VERSION=v1.4.1
BACKUP="$APP/backups/poi-$STAMP"
mkdir -p "$BACKUP" "$APP/tools"
chmod 700 "$BACKUP"
tar -xzf "/tmp/questlayer-poi-$STAMP.tgz" -C "$BACKUP"
if [[ ! -f "$APP/current/scripts/poi/run.mjs" ]]; then
 echo "$APP/current has no scripts/poi; deploy the current branch head with scripts/deploy-vps.sh first." >&2; exit 1
fi
AVAIL_KB="$(df --output=avail /var/lib | tail -1)"
if (( AVAIL_KB < 6000000 )); then echo "Need ~6 GB free under /var/lib for the import (have ${AVAIL_KB} KB)." >&2; exit 1; fi
NEED=()
command -v osmium >/dev/null || NEED+=(osmium-tool)
command -v unzip >/dev/null || NEED+=(unzip)
if (( ${#NEED[@]} )); then DEBIAN_FRONTEND=noninteractive apt-get install -y -q "${NEED[@]}"; fi
osmium --version | head -1
if [[ ! -x "$APP/tools/duckdb" ]] || ! "$APP/tools/duckdb" --version | grep -q "${DUCKDB_VERSION}"; then
 case "$(uname -m)" in x86_64) ARCH=amd64 ;; aarch64) ARCH=arm64 ;; *) echo "Unsupported arch" >&2; exit 1 ;; esac
 TMPD="$(mktemp -d)"
 curl -fsSL -o "$TMPD/duckdb.zip" "https://github.com/duckdb/duckdb/releases/download/${DUCKDB_VERSION}/duckdb_cli-linux-${ARCH}.zip"
 sha256sum "$TMPD/duckdb.zip"
 unzip -o -q "$TMPD/duckdb.zip" -d "$TMPD"
 install -m 755 "$TMPD/duckdb" "$APP/tools/duckdb"
 rm -rf "$TMPD"
fi
"$APP/tools/duckdb" --version
if ! id questlayer-poi >/dev/null 2>&1; then
 useradd --system --no-create-home --home-dir /var/lib/questlayer-poi --shell /usr/sbin/nologin questlayer-poi
fi
for unit in questlayer-poi.service questlayer-poi.timer; do
 if [[ -f "/etc/systemd/system/$unit" ]]; then cp -a "/etc/systemd/system/$unit" "$BACKUP/$unit.previous"; fi
 install -m 644 "$BACKUP/deploy/$unit" "/etc/systemd/system/$unit"
done
systemd-analyze verify /etc/systemd/system/questlayer-poi.service /etc/systemd/system/questlayer-poi.timer
systemctl daemon-reload
systemctl enable --now questlayer-poi.timer
# First import runs now in the background (download + extract + build, ~20-60 min).
systemctl start --no-block questlayer-poi.service
systemctl list-timers questlayer-poi.timer --no-pager
echo "Follow with: journalctl -u questlayer-poi -f   Manifest: /var/lib/questlayer-poi/current.manifest.json"
REMOTE
rm -f "$ARCHIVE"
