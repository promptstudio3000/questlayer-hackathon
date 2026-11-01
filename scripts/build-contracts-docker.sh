#!/usr/bin/env bash
# Reference contract build: Docker rust:1.97.0 on linux/amd64, the same build CI
# pins in contracts/wasm-sha256.json. Use this on macOS (aarch64 builds hash
# differently). Extra args go to scripts/check-wasm-hashes.mjs (e.g. --write).
set -Eeuo pipefail
cd "$(dirname "$0")/.."
IMAGE="${RUST_IMAGE:-rust:1.97.0}"
docker run --rm --platform linux/amd64 \
  -v "$PWD:/build" -w /build \
  -e CARGO_TARGET_DIR=/build/contracts/target \
  -e HOST_OWNER="$(id -u):$(id -g)" \
  "$IMAGE" bash -c 'rustup target add wasm32-unknown-unknown >/dev/null &&
    rustc --version && bash scripts/build-contracts.sh --no-check &&
    chown -R "$HOST_OWNER" contracts/target'
node scripts/check-wasm-hashes.mjs "$@"
