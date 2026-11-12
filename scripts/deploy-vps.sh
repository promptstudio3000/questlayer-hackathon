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
case "$TARGET" in
 testnet) APP_NAME=questlayer-hackathon; APP_PORT=7091; APP_DOMAIN=questlayer.promptstudio3000.com ;;
 mainnet) APP_NAME=questlayer-mainnet; APP_PORT=7092; APP_DOMAIN="${MAINNET_DOMAIN:-mainnet.questlayer.promptstudio3000.com}" ;;
 *) echo "DEPLOY_TARGET must be testnet or mainnet." >&2; exit 1 ;;
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
RELEASE_TAG="$(date -u +%Y%m%dT%H%M%SZ)"
ARCHIVE_PATH="/tmp/${APP_NAME}-${RELEASE_TAG}.tgz"
if [[ "${QUESTLAYER_CHECKS_PASSED:-0}" != 1 ]]; then npm run check; fi
# The client fixes its network at build time (src/near-network.ts).
if [[ "$TARGET" == mainnet ]]; then VITE_NEAR_NETWORK=mainnet npm run build; fi
# Record the deployed commit for /api/health; an uncommitted tree stays unrecorded.
if [[ -z "$(git status --porcelain --untracked-files=no)" ]]; then git rev-parse HEAD > build-id.txt
else echo "Working tree has uncommitted changes; health will report development-unrecorded." >&2; : > build-id.txt; fi
COPYFILE_DISABLE=1 tar --no-xattrs -czf "$ARCHIVE_PATH" build-id.txt dist server public/*.json package.json package-lock.json "deploy/${APP_NAME}.service" deploy/retain-static-assets.py scripts/poi
# Leave the testnet bundle in dist/ for the next testnet deploy or local run.
if [[ "$TARGET" == mainnet ]]; then npm run build >/dev/null; fi
scp -o BatchMode=yes -o ConnectTimeout=15 "$ARCHIVE_PATH" "${HOST_TARGET}:/tmp/${APP_NAME}-${RELEASE_TAG}.tgz"
ssh -o BatchMode=yes -o ConnectTimeout=15 "$HOST_TARGET" bash -s -- "$RELEASE_TAG" "$TARGET" "$APP_NAME" "$APP_PORT" "$APP_DOMAIN" < scripts/vps-activate-release.sh
rm -f "$ARCHIVE_PATH"
# The signing vault is its own origin and release (install-signing-vault-vps.sh).
# Reinstall it whenever its sources, installer or contract manifests changed
# since the installed release; SKIP_SIGNING_VAULT=1 leaves it as it is.
if [[ "$TARGET" == testnet && "${SKIP_SIGNING_VAULT:-0}" != 1 ]]; then
 WANT="$(bash scripts/signing-vault-fingerprint.sh)"
 HAVE="$(ssh -o BatchMode=yes -o ConnectTimeout=15 "$HOST_TARGET" 'cat /opt/ps3000/apps/questlayer-signer/current/inputs.sha256 2>/dev/null || true')"
 if [[ "$WANT" != "$HAVE" ]]; then
  echo "Signing vault inputs changed (${HAVE:-none installed} -> $WANT); reinstalling the vault."
  bash scripts/install-signing-vault-vps.sh
 else
  echo "Signing vault unchanged ($WANT)."
 fi
fi
