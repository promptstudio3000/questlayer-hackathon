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
# SIGNING_VAULT_LAYER=test installs the Test Layer's own vault (docs/TEST-LAYER.md):
# its own origin, port, service and the -testlayer contract manifests.
if [[ "${SIGNING_VAULT_LAYER:-world}" == test ]]; then
  SET=testlayer; SERVICE=questlayer-test-signer
  APP_ORIGIN="https://questlayer-test.promptstudio3000.com"
  VAULT_HOST="${SIGNING_VAULT_HOST:-questlayer-test-signer.promptstudio3000.com}"
  PORT=7094; export VITE_QL_LAYER=test
else
  SET=testnet; SERVICE=questlayer-signer
  APP_ORIGIN="https://questlayer.promptstudio3000.com"
  VAULT_HOST="${SIGNING_VAULT_HOST:-questlayer-signer.promptstudio3000.com}"
  PORT=7092
fi
VAULT_ORIGIN="https://$VAULT_HOST"
ROOT=/opt/ps3000/apps/$SERVICE

# The public config: origins, RPC and the contract allowlist from the manifests.
CONFIG="$(node --input-type=module -e '
import { readFileSync, existsSync } from "node:fs";
const set = process.argv[3];
const m = (n) => JSON.parse(readFileSync(`public/${n}-${set}.json`, "utf8"));
const optional = (n) => (existsSync(`public/${n}-${set}.json`) ? m(n) : null);
const config = {
  appOrigin: process.argv[1], vaultOrigin: process.argv[2], network: "testnet",
  rpcUrl: "https://test.rpc.fastnear.com",
  contracts: {
    qgold: m("native-qgold-vault").tokenContract,
    qgoldEscrow: m("native-qgold-escrow").contractId,
    collectibles: m("native-claims").contractId,
    npcGames: m("native-npc-games").contractId,
    social: "v1.social08.testnet",
    intents: m("native-intents").verifierContract,
    wnear: m("native-intents").wnear,
    ...(optional("native-treasury-dao") ? { treasuryDao: optional("native-treasury-dao").contractId } : {}),
  },
};
const { validateVaultOrigins } = await import("./src/signing-vault/policy.ts");
validateVaultOrigins(config);
for (const id of Object.values(config.contracts)) if (!id?.endsWith(".testnet")) throw Error("testnet contracts only");
console.log(JSON.stringify(config));
' "$APP_ORIGIN" "$VAULT_ORIGIN" "$SET")"
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
bash scripts/signing-vault-fingerprint.sh "$SET" > "$STAGE/inputs.sha256"

# SIGNING_VAULT_STAGE_DIR=<dir>: only build the release into <dir> (the VPS
# release runner builds as its unprivileged user and installs as root).
if [[ -n "${SIGNING_VAULT_STAGE_DIR:-}" ]]; then
  cp -R "$STAGE"/. "$SIGNING_VAULT_STAGE_DIR"/
  exit 0
fi
RELEASE="$(date -u +%Y%m%dT%H%M%SZ)"
ssh -o BatchMode=yes "$HOST_TARGET" "install -d -m 755 $ROOT/releases/$RELEASE"
tar -C "$STAGE" -czf - . | ssh -o BatchMode=yes "$HOST_TARGET" "tar -C $ROOT/releases/$RELEASE -xzf -"
ssh -o BatchMode=yes "$HOST_TARGET" bash -s -- "$ROOT" "$RELEASE" "$VAULT_HOST" "$PORT" "$SERVICE" < scripts/vps-install-signing-vault-release.sh
