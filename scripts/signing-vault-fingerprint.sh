#!/usr/bin/env bash
# Prints one sha256 over every input of the signing vault release: its sources,
# its server, its installer and the testnet manifests its contract allowlist is
# read from. install-signing-vault-vps.sh stores it with the release;
# deploy-vps.sh compares it to decide whether the vault must be reinstalled.
set -Eeuo pipefail
cd "$(dirname "$0")/.."
SET="${1:-testnet}" # testlayer for the Test Layer's vault (docs/TEST-LAYER.md)
if command -v sha256sum >/dev/null; then sum() { sha256sum "$@"; }; else sum() { shasum -a 256 "$@"; }; fi
{
  find src/signing-vault -type f
  printf '%s\n' server/signing-vault.mjs scripts/install-signing-vault-vps.sh scripts/vps-install-signing-vault-release.sh \
    "public/native-qgold-vault-$SET.json" "public/native-qgold-escrow-$SET.json" \
    "public/native-claims-$SET.json" "public/native-npc-games-$SET.json" \
    "public/native-intents-$SET.json"
  if [ -f "public/native-treasury-dao-$SET.json" ]; then echo "public/native-treasury-dao-$SET.json"; fi
} | LC_ALL=C sort | while IFS= read -r f; do sum "$f"; done | sum | cut -d' ' -f1
