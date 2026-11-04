#!/usr/bin/env bash
set -Eeuo pipefail
cd "$(dirname "$0")/.."
export PATH="$HOME/.cargo/bin:$PATH"
# Reproducible WASM: rust-toolchain.toml pins the compiler, Cargo.lock is locked,
# and local paths (cargo registry, rustup, checkout) are remapped so panic
# locations do not depend on who built it or where.
CARGO_HOME_DIR="${CARGO_HOME:-$HOME/.cargo}"
RUSTUP_HOME_DIR="${RUSTUP_HOME:-$HOME/.rustup}"
export RUSTFLAGS="--remap-path-prefix=$CARGO_HOME_DIR=/cargo --remap-path-prefix=$RUSTUP_HOME_DIR=/rustup --remap-path-prefix=$PWD=/build"
# The factory embeds these exact vault bytes. Build order is part of the source contract.
cargo build --locked --manifest-path contracts/Cargo.toml -p questlayer-vault --target wasm32-unknown-unknown --release
cargo build --locked --manifest-path contracts/Cargo.toml --workspace --target wasm32-unknown-unknown --release
# --no-check: build only (the Docker wrapper checks on the host, which has node).
if [[ " $* " != *" --no-check "* ]]; then node scripts/collectibles-wasm-sha256.mjs; fi
if [[ " $* " == *" --test "* ]]; then cargo test --locked --manifest-path contracts/Cargo.toml --workspace; fi
