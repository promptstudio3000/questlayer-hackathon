#!/usr/bin/env bash
# Daily stNEAR treasury harvest on the owner's Mac (docs/STNEAR-TREASURY.md).
# Installs a LaunchAgent that runs `harvest` once a day at 06:30 local time
# from this repository folder, with the operator key in .data/. Testnet only.
#   bash scripts/install-stnear-harvest-mac.sh          # install / refresh
#   bash scripts/install-stnear-harvest-mac.sh --remove # uninstall
set -euo pipefail
[ "$(uname)" = "Darwin" ] || { echo "macOS only" >&2; exit 1; }
REPO="$(cd "$(dirname "$0")/.." && pwd)"
LABEL="com.questlayer.stnear-harvest"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
if [ "${1:-}" = "--remove" ]; then
  launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
  rm -f "$PLIST"; echo "removed $LABEL"; exit 0
fi
[ -f "$REPO/.data/near-operator.json" ] || { echo "missing .data/near-operator.json" >&2; exit 1; }
NODE="$(command -v node)"
mkdir -p "$HOME/Library/LaunchAgents" "$REPO/.data/logs"
cat > "$PLIST" <<PL
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>$LABEL</string>
  <key>EnvironmentVariables</key><dict><key>STNEAR_RECORD_PUSH</key><string>1</string></dict>
  <key>WorkingDirectory</key><string>$REPO</string>
  <key>ProgramArguments</key><array>
    <string>/bin/sh</string><string>-c</string>
    <string>"$NODE" scripts/stnear-treasury-testnet.mjs fund-pending; "$NODE" scripts/stnear-treasury-testnet.mjs harvest</string>
  </array>
  <key>StartCalendarInterval</key><dict><key>Hour</key><integer>6</integer><key>Minute</key><integer>30</integer></dict>
  <key>StandardOutPath</key><string>$REPO/.data/logs/stnear-harvest.log</string>
  <key>StandardErrorPath</key><string>$REPO/.data/logs/stnear-harvest.log</string>
</dict></plist>
PL
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"
echo "installed $LABEL (daily 06:30), log .data/logs/stnear-harvest.log"
