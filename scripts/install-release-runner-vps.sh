#!/usr/bin/env bash
# One-time install of the VPS release runner (docs/VPS-RELEASE-RUNNER.md), run
# on the Mac from a clean checkout of main. After this the Mac runs nothing:
# the VPS deploys the deploy branch and runs queued operator jobs itself.
#
#   bash scripts/install-release-runner-vps.sh
#       creates the questlayer-release user, Rust toolchain, runner files and
#       units (deploy off), and prints the GitHub deploy key to add read-only:
#       GitHub -> repository Settings -> Deploy keys -> Add (no write access).
#   bash scripts/install-release-runner-vps.sh --clone --operator-key --enable
#       after the deploy key is added: clones the repo, moves the testnet
#       operator key (.data/near-operator.json) into the runner's key directory
#       and turns the every-minute timer on.
#   --keys a.json,b.json   also copy these other .data/ files (testnet only).
#
# Testnet only: refuses mainnet key files. Keys go over scp straight into a
# mode-700 directory owned by questlayer-release; nothing is printed.
set -Eeuo pipefail
cd "$(dirname "$0")/.."
HOST_TARGET="${DEPLOY_HOST:-root@72.61.188.39}"
REPO_URL="${RELEASE_REPO_URL:-git@github.com:promptstudio3000/questlayer-hackathon.git}"
CLONE=0 OPERATOR=0 ENABLE=0 KEYS=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --clone) CLONE=1 ;;
    --operator-key) OPERATOR=1 ;;
    --enable) ENABLE=1 ;;
    --keys) KEYS="$2"; shift ;;
    *) echo "Unknown option $1" >&2; exit 2 ;;
  esac
  shift
done
SSH=(ssh -o BatchMode=yes -o ConnectTimeout=15 "$HOST_TARGET")

# 1. User, directories, toolchain, runner files and units.
COPYFILE_DISABLE=1 tar --no-xattrs -czf - scripts/release-runner.mjs scripts/lib/release-runner.mjs \
  scripts/vps-activate-release.sh scripts/vps-install-signing-vault-release.sh \
  deploy/release-ops-allowlist.json deploy/questlayer-release.service deploy/questlayer-release.timer \
  | "${SSH[@]}" bash -c "'rm -rf /tmp/questlayer-release-install && mkdir -p /tmp/questlayer-release-install && tar -xzf - -C /tmp/questlayer-release-install'"
"${SSH[@]}" bash -s -- "$REPO_URL" <<'REMOTE'
set -Eeuo pipefail
REPO_URL="$1" U=questlayer-release H=/var/lib/questlayer-release S=/tmp/questlayer-release-install
command -v git >/dev/null || { apt-get update -qq && apt-get install -y -qq git; }
id "$U" >/dev/null 2>&1 || useradd --system --home-dir "$H" --create-home --shell /usr/sbin/nologin "$U"
install -d -m 700 -o "$U" -g "$U" "$H" "$H/keys" "$H/work" "$H/.ssh"
install -d -m 755 /var/lib/questlayer-release-status /var/lib/questlayer-release-status/ops
install -d -m 700 /var/lib/questlayer-release-state
if [[ ! -x "$H/.cargo/bin/rustup" ]]; then
  runuser -u "$U" -- env HOME="$H" bash -c 'curl -fsSL https://sh.rustup.rs | sh -s -- -y --profile minimal --default-toolchain 1.97.0 --target wasm32-unknown-unknown >/dev/null'
fi
if [[ ! -f "$H/.ssh/github_deploy" ]]; then
  runuser -u "$U" -- ssh-keygen -q -t ed25519 -N '' -C "questlayer-release@vps (read-only deploy key)" -f "$H/.ssh/github_deploy"
fi
runuser -u "$U" -- bash -c "ssh-keyscan -t ed25519 github.com 2>/dev/null > '$H/.ssh/known_hosts'"
printf 'Host github.com\n  IdentityFile %s/.ssh/github_deploy\n  IdentitiesOnly yes\n' "$H" > "$H/.ssh/config"
chown "$U:$U" "$H/.ssh/config" "$H/.ssh/known_hosts"; chmod 600 "$H/.ssh/config"
L=/usr/local/lib/questlayer-release
install -d -m 755 "$L/scripts/lib" "$L/deploy"
for f in scripts/release-runner.mjs scripts/lib/release-runner.mjs deploy/release-ops-allowlist.json; do install -m 644 "$S/$f" "$L/$f"; done
for f in scripts/vps-activate-release.sh scripts/vps-install-signing-vault-release.sh; do install -m 755 "$S/$f" "$L/$f"; done
install -m 644 "$S/deploy/questlayer-release.service" "$S/deploy/questlayer-release.timer" /etc/systemd/system/
[[ -f /etc/questlayer-release.env ]] || printf 'RELEASE_DEPLOY_ENABLED=0\n' > /etc/questlayer-release.env
chmod 644 /etc/questlayer-release.env
systemctl daemon-reload
rm -rf "$S"
echo "Deploy key (add read-only in GitHub -> Settings -> Deploy keys):"
cat "$H/.ssh/github_deploy.pub"
REMOTE

# 2. Clone with the deploy key.
if [[ "$CLONE" == 1 ]]; then
  "${SSH[@]}" bash -s -- "$REPO_URL" <<'REMOTE'
set -Eeuo pipefail
REPO_URL="$1" U=questlayer-release H=/var/lib/questlayer-release
if [[ ! -d "$H/repo/.git" ]]; then runuser -u "$U" -- env HOME="$H" git clone --quiet --no-checkout "$REPO_URL" "$H/repo"; fi
runuser -u "$U" -- env HOME="$H" git -C "$H/repo" fetch --quiet origin
echo "Repository cloned: $(runuser -u "$U" -- git -C "$H/repo" rev-parse --short origin/HEAD 2>/dev/null || echo ok)"
REMOTE
fi

# 3. Keys: testnet only, straight into the mode-700 key directory.
FILES=()
if [[ "$OPERATOR" == 1 ]]; then FILES+=(near-operator.json); fi
if [[ -n "$KEYS" ]]; then IFS=, read -r -a MORE <<< "$KEYS"; FILES+=("${MORE[@]}"); fi
for f in "${FILES[@]:-}"; do
  [[ -z "$f" ]] && continue
  [[ "$f" =~ ^[A-Za-z0-9._-]+$ && "$f" != *mainnet* ]] || { echo "Refusing key file $f (plain testnet names only)." >&2; exit 1; }
  test -f ".data/$f"
  if [[ "$f" == *.json ]]; then
    python3 -c 'import json,sys;d=json.load(open(sys.argv[1]));n=d.get("network","testnet");a=d.get("accountId","x.testnet");assert n=="testnet" and a.endswith(".testnet"), "testnet keys only"' ".data/$f"
  fi
done
if [[ ${#FILES[@]} -gt 0 ]]; then
  "${SSH[@]}" 'install -d -m 700 /root/questlayer-release-keys-staging'
  for f in "${FILES[@]}"; do scp -q -o BatchMode=yes ".data/$f" "$HOST_TARGET:/root/questlayer-release-keys-staging/$f"; done
  "${SSH[@]}" bash -s <<'REMOTE'
set -Eeuo pipefail
H=/var/lib/questlayer-release STAGE=/root/questlayer-release-keys-staging
for src in "$STAGE"/*; do
  f="$(basename "$src")" target="$H/keys/$(basename "$src")"
  if [[ -f "$target" ]] && ! cmp -s "$src" "$target"; then echo "$target exists and differs; move it aside deliberately first." >&2; exit 1; fi
  install -m 600 -o questlayer-release -g questlayer-release "$src" "$target"
  echo "Installed key file $f"
done
rm -rf "$STAGE"
REMOTE
fi

# 4. Turn the runner on.
if [[ "$ENABLE" == 1 ]]; then
  "${SSH[@]}" bash -s <<'REMOTE'
set -Eeuo pipefail
test -d /var/lib/questlayer-release/repo/.git || { echo "Clone first (--clone)." >&2; exit 1; }
sed -i 's/^RELEASE_DEPLOY_ENABLED=.*/RELEASE_DEPLOY_ENABLED=1/' /etc/questlayer-release.env
systemctl enable --now questlayer-release.timer
systemctl start questlayer-release.service || true
cat /var/lib/questlayer-release-status/status.json
REMOTE
fi
