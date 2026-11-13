#!/usr/bin/env bash
# Treasury worker on the testnet VPS (docs/TREASURY-WORKERS-VPS.md). Started by
# questlayer-treasury@<mode>.service from the release in current/; replaces the
# Mac LaunchAgent com.questlayer.stnear-harvest. Signs as treasury-ops.<operator>
# and with the DAO function-call keys in /var/lib/questlayer-treasury/.data/;
# the operator key is never on this host.
#   daily   06:30 Prague: stNEAR fund-pending + harvest, DAO daily, mix rebalance + keep
#   retry   hourly: mix rebalance again (runs only once a day, and only when the
#           DAO approved today's run, e.g. after a later second council approval)
#   publish (root, ExecStopPost) copy the public records to the game server's state dir
set -uo pipefail
MODE="${1:-daily}"
APP=/opt/ps3000/apps/questlayer-hackathon
SCRIPTS="$APP/current/scripts"
NODE=/usr/local/bin/node
WORK=/var/lib/questlayer-treasury
if [[ "$MODE" == publish ]]; then
  SERVER_STATE=/var/lib/questlayer-hackathon
  REF="$SERVER_STATE/award-attestor.pem"
  [[ -e "$REF" ]] || { echo "no $REF; records not published" >&2; exit 0; }
  OWNER="$(stat -L -c %u "$REF")"; GROUP="$(stat -L -c %g "$REF")"
  for f in stnear-treasury-testnet.json treasury-mix-testnet.json; do
    src="$WORK/public/$f"
    [[ -f "$src" && ! -L "$src" ]] || continue
    if ! cmp -s "$src" "$SERVER_STATE/$f"; then
      install -m 644 -o "$OWNER" -g "$GROUP" "$src" "$SERVER_STATE/$f" && echo "published $f"
    fi
  done
  exit 0
fi
cd "$WORK"
mkdir -p public
exec 9>"$WORK/.lock"
flock -w 900 9 || { echo "another treasury run holds the lock" >&2; exit 1; }
FAIL=0
step() {
  echo "== $*"
  "$NODE" "$SCRIPTS/$1" "${@:2}" || { echo "!! $* failed (exit $?)"; FAIL=1; }
}
case "$MODE" in
  daily)
    step stnear-treasury-testnet.mjs fund-pending
    step stnear-treasury-testnet.mjs harvest
    if [[ -f "${TREASURY_DAO_MANIFEST:-}" ]]; then step treasury-dao-testnet.mjs daily; else echo "no DAO manifest; DAO step skipped"; fi
    step treasury-mix-testnet.mjs rebalance
    step treasury-mix-testnet.mjs keep
    ;;
  retry)
    step treasury-mix-testnet.mjs rebalance
    ;;
  *) echo "usage: $0 daily|retry|publish" >&2; exit 2 ;;
esac
exit "$FAIL"
