#!/usr/bin/env bash
set -Eeuo pipefail
cd "$(dirname "$0")/.."
export PATH="$HOME/.cargo/bin:$PATH"
# The factory embeds these exact vault bytes. Build order is part of the source contract.
cargo build --manifest-path contracts/Cargo.toml -p questlayer-vault --target wasm32-unknown-unknown --release
cargo build --manifest-path contracts/Cargo.toml --workspace --target wasm32-unknown-unknown --release
if [[ "${1:-}" == "--test" ]]; then cargo test --manifest-path contracts/Cargo.toml --workspace; fi
