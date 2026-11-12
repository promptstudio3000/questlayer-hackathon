#!/usr/bin/env bash
# Installs the daily treasury workers on the testnet VPS (docs/TREASURY-WORKERS-VPS.md):
# stNEAR harvest, treasury DAO `daily` and the treasury mix rebalance/keep, run
# by questlayer-treasury-daily.timer at 06:30 Prague time, plus an hourly
# rebalance retry. Replaces the Mac LaunchAgent com.questlayer.stnear-harvest.
#
# Copies ONLY the bundle written by scripts/treasury-workers-setup-testnet.mjs
# (.data/treasury-vps/): the treasury-ops key, the DAO function-call keys and
# the moved state. It refuses the operator key, any DAO key that is not a
# function-call key on chain, and a key file that differs from one already on
# the VPS. The code itself ships with scripts/deploy-vps.sh (deploy first).
#   bash scripts/install-treasury-workers-vps.sh --dry-run   # checks only, copies nothing
#   bash scripts/install-treasury-workers-vps.sh             # install + enable the timers
#   bash scripts/install-treasury-workers-vps.sh --run-now   # ... and run today's job once now
#   bash scripts/install-treasury-workers-vps.sh --remove    # disable the timers (keys stay; see the doc)
set -Eeuo pipefail
cd "$(dirname "$0")/.."
HOST_TARGET="${DEPLOY_HOST:-root@72.61.188.39}"
DRY=0 RUN_NOW=0 REMOVE=0
for a in "$@"; do
  case "$a" in
    --dry-run) DRY=1 ;;
    --run-now) RUN_NOW=1 ;;
    --remove) REMOVE=1 ;;
    *) echo "unknown option $a" >&2; exit 2 ;;
  esac
done
if [[ "$REMOVE" == 1 ]]; then
  ssh -o BatchMode=yes -o ConnectTimeout=15 "$HOST_TARGET" 'systemctl disable --now questlayer-treasury-daily.timer questlayer-treasury-retry.timer 2>/dev/null || true; systemctl list-timers "questlayer-treasury*" --all --no-pager'
  exit 0
fi
BUNDLE=.data/treasury-vps
for f in treasury-ops.json treasury-dao-keys.json; do
  [[ -f "$BUNDLE/$f" ]] || { echo "$BUNDLE/$f is missing; run node scripts/treasury-workers-setup-testnet.mjs --execute first." >&2; exit 1; }
done
if [[ -f "$HOME/Library/LaunchAgents/com.questlayer.stnear-harvest.plist" ]]; then
  echo "The Mac LaunchAgent is still installed; remove it first (bash scripts/install-stnear-harvest-mac.sh --remove), or both would run." >&2; exit 1
fi
# Local checks against the chain: what goes to the VPS and nothing more.
node --input-type=module - "$BUNDLE" <<'JS'
import { readFileSync, statSync, existsSync } from "node:fs";
import assert from "node:assert/strict";
import { createNearProvider } from "./server/near-provider.mjs";
const dir = process.argv[2];
const provider = createNearProvider();
assert.equal((await provider.viewNodeStatus()).chain_id, "testnet", "Testnet only");
const operator = existsSync(".data/near-operator.json") ? JSON.parse(readFileSync(".data/near-operator.json")) : null;
const files = ["treasury-ops.json", "treasury-dao-keys.json", "stnear-treasury.json", "treasury-mix.json"].filter((f) => existsSync(`${dir}/${f}`));
for (const f of files) assert.equal(statSync(`${dir}/${f}`).mode & 0o077, 0, `${dir}/${f} must be chmod 600`);
const raw = files.map((f) => readFileSync(`${dir}/${f}`, "utf8")).join("\n");
if (operator) assert(!raw.includes(operator.secretKey) && !raw.includes(operator.publicKey || "\u0000"), "The operator key must never go to the VPS.");
const ops = JSON.parse(readFileSync(`${dir}/treasury-ops.json`));
const op = operator?.accountId || "questlayer-dev-20261101.testnet";
assert(ops.network === "testnet" && ops.accountId === `treasury-ops.${op}`, "treasury-ops.json is not the treasury-ops account");
const perm = async (account, publicKey) => {
  const r = await provider.query({ request_type: "view_access_key", account_id: account, public_key: publicKey, finality: "final" });
  return r.permission;
};
assert.equal(await perm(ops.accountId, ops.publicKey), "FullAccess", "treasury-ops key not found on chain");
const dao = JSON.parse(readFileSync(`${dir}/treasury-dao-keys.json`));
const out = { treasuryOps: ops.accountId, daoKeys: {} };
for (const [k, v] of Object.entries(dao)) {
  assert(["keeper", "councilA", "councilB"].includes(k), `unexpected key ${k} in treasury-dao-keys.json`);
  assert(v.accountId.endsWith(`.${op}`), `${v.accountId} is not a DAO seat`);
  const p = await perm(v.accountId, v.publicKey);
  assert(p !== "FullAccess" && p.FunctionCall, `${v.accountId}: the VPS key must be a function-call key`);
  out.daoKeys[v.accountId] = { receiver: p.FunctionCall.receiver_id, methods: p.FunctionCall.method_names, allowanceNear: p.FunctionCall.allowance ? (Number(BigInt(p.FunctionCall.allowance) / 10n ** 18n) / 1e6).toFixed(3) : "unlimited" };
}
out.councilOnVps = ["councilA", "councilB"].filter((k) => dao[k]).length === 2 ? "both (automatic 2 of 3)" : "council-a only (second approval from the Mac or the operator seat)";
out.state = files.filter((f) => !f.includes("key") && f !== "treasury-ops.json");
console.log(JSON.stringify(out, null, 2));
JS
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
ARCHIVE="/tmp/questlayer-treasury-$STAMP.tgz"
REMOTE_CHECK='set -e; APP=/opt/ps3000/apps/questlayer-hackathon
for f in treasury-worker-vps.sh stnear-treasury-testnet.mjs treasury-mix-testnet.mjs treasury-dao-testnet.mjs; do
  [[ -f "$APP/current/scripts/$f" ]] || { echo "current/scripts/$f missing: deploy this branch with scripts/deploy-vps.sh first" >&2; exit 1; }
done
grep -q QUESTLAYER_OPERATOR_ACCOUNT "$APP/current/scripts/treasury-dao-testnet.mjs" || { echo "current/ has an old treasury-dao script; deploy first" >&2; exit 1; }
[[ -f "$APP/current/public/native-treasury-dao-testnet.json" ]] || echo "note: no DAO manifest in current/public; the DAO step will be skipped" >&2
systemd-analyze calendar "*-*-* 06:30:00 Europe/Prague" | grep "Next elapse"
id questlayer-treasury 2>/dev/null || echo "user questlayer-treasury will be created"
ls -l /var/lib/questlayer-treasury/.data 2>/dev/null || echo "no /var/lib/questlayer-treasury/.data yet"'
if [[ "$DRY" == 1 ]]; then
  ssh -o BatchMode=yes -o ConnectTimeout=15 "$HOST_TARGET" bash -c "$(printf %q "$REMOTE_CHECK")"
  echo "Dry run: nothing copied."
  exit 0
fi
ssh -o BatchMode=yes -o ConnectTimeout=15 "$HOST_TARGET" bash -c "$(printf %q "$REMOTE_CHECK")"
FILES=(deploy/questlayer-treasury@.service deploy/questlayer-treasury-daily.timer deploy/questlayer-treasury-retry.timer)
for f in treasury-ops.json treasury-dao-keys.json stnear-treasury.json treasury-mix.json; do
  [[ -f "$BUNDLE/$f" ]] && FILES+=("$BUNDLE/$f")
done
COPYFILE_DISABLE=1 tar --no-xattrs -czf "$ARCHIVE" "${FILES[@]}"
scp -q -o BatchMode=yes -o ConnectTimeout=15 "$ARCHIVE" "$HOST_TARGET:/tmp/questlayer-treasury-$STAMP.tgz"
rm -f "$ARCHIVE"
ssh -o BatchMode=yes -o ConnectTimeout=15 "$HOST_TARGET" bash -s -- "$STAMP" "$RUN_NOW" <<'REMOTE'
set -Eeuo pipefail
STAMP="$1" RUN_NOW="$2"
APP=/opt/ps3000/apps/questlayer-hackathon
WORK=/var/lib/questlayer-treasury
STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE" "/tmp/questlayer-treasury-$STAMP.tgz"' EXIT
chmod 700 "$STAGE"
tar -xzf "/tmp/questlayer-treasury-$STAMP.tgz" -C "$STAGE"
if ! id questlayer-treasury >/dev/null 2>&1; then
  useradd --system --no-create-home --home-dir "$WORK" --shell /usr/sbin/nologin questlayer-treasury
fi
install -d -m 700 -o questlayer-treasury -g questlayer-treasury "$WORK" "$WORK/.data" "$WORK/public"
BACKUP="$APP/backups/treasury-$STAMP"; install -d -m 700 "$BACKUP"
for f in treasury-ops.json treasury-dao-keys.json stnear-treasury.json treasury-mix.json; do
  src="$STAGE/.data/treasury-vps/$f"; dst="$WORK/.data/$f"
  [[ -f "$src" ]] || continue
  if [[ -f "$dst" ]]; then
    if cmp -s "$src" "$dst"; then continue; fi
    if [[ "$f" == treasury-ops.json || "$f" == treasury-dao-keys.json ]]; then
      echo "$dst differs from the bundle; move it aside deliberately before replacing a key." >&2; exit 1
    fi
    # Once the worker ran, the VPS state is newer than the Mac's copy: keep it.
    echo "kept $dst (the VPS state is newer than the bundle)"; continue
  fi
  install -m 600 -o questlayer-treasury -g questlayer-treasury "$src" "$dst"
  echo "installed $dst"
done
for unit in 'questlayer-treasury@.service' questlayer-treasury-daily.timer questlayer-treasury-retry.timer; do
  if [[ -f "/etc/systemd/system/$unit" ]]; then cp -a "/etc/systemd/system/$unit" "$BACKUP/$unit.previous"; fi
  install -m 644 "$STAGE/deploy/$unit" "/etc/systemd/system/$unit"
done
systemctl daemon-reload
systemctl enable --now questlayer-treasury-daily.timer questlayer-treasury-retry.timer
if [[ "$RUN_NOW" == 1 ]]; then
  systemctl start questlayer-treasury@daily.service || true
  journalctl -u questlayer-treasury@daily.service --since "-30 min" --no-pager | tail -60
fi
systemctl list-timers 'questlayer-treasury*' --no-pager
echo "Logs: journalctl -u 'questlayer-treasury@*'"
REMOTE
