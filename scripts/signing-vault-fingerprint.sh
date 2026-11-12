#!/usr/bin/env bash
# Prints one sha256 over every input of the signing vault release: its sources,
# its server, its installer and the testnet manifests its contract allowlist is
# read from. install-signing-vault-vps.sh stores it with the release;
# deploy-vps.sh compares it to decide whether the vault must be reinstalled.
set -Eeuo pipefail
cd "$(dirname "$0")/.."
if command -v sha256sum >/dev/null; then sum() { sha256sum "$@"; }; else sum() { shasum -a 256 "$@"; }; fi
{
  find src/signing-vault -type f
  printf '%s\n' server/signing-vault.mjs scripts/install-signing-vault-vps.sh scripts/vps-install-signing-vault-release.sh \
    public/native-qgold-vault-testnet.json public/native-qgold-escrow-testnet.json \
    public/native-claims-testnet.json public/native-npc-games-testnet.json \
    public/native-intents-testnet.json
  if [ -f public/native-treasury-dao-testnet.json ]; then echo public/native-treasury-dao-testnet.json; fi
} | LC_ALL=C sort | while IFS= read -r f; do sum "$f"; done | sum | cut -d' ' -f1
