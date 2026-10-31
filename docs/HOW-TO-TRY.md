# How to try QuestLayer

Updated 1 November 2026. This is the living "try it from zero" guide; every delivery updates it.
Each step says what to do and what you should see. Nothing here needs real money: the game runs on
NEAR **testnet** and a separate demo ledger.

## 0. Prerequisites

| Need | Value |
| --- | --- |
| Node.js | 24 (`.nvmrc`); `npm ci` warns on 22 but works for the web build |
| Rust | only for contracts: stable toolchain, `wasm32-unknown-unknown` target |
| Browser | Chrome/Android, Safari/iOS 17+, or desktop Chrome/Firefox/Safari |
| Network | the map needs `tiles.openfreemap.org`; native features need `test.rpc.fastnear.com` |

## 1. Run locally in two minutes

```bash
npm ci
npm run dev
```

Open http://127.0.0.1:5173/. You should see the first-run page with the ghost. The API runs on loopback 8787.
Background workers, native attestations and creator content are off unless you configure them (`.env.example`).

What to check:

1. Enter a name and press **Start exploring**. The map of Plzeň appears with your explorer in the centre.
2. Tap a coin near you (in the city demo, tap the map to walk). The coin disappears and the counter ticks.
3. Open the objective card ("Your next quest"), press **Walk there**, then **Open chest** when in range.
4. The result sheet shows the exact XP and item. Press **Try it on**; the same Aura is now on your map character.
5. Reload the page: name, XP, item and equipment are still there.

## 2. Run the cloud/Codespace variant

Open https://codespaces.new/promptstudio3000/questlayer-hackathon, wait for `npm ci`, run `npm run dev`,
open the forwarded port **5173** (keep it private). The container sets `DISABLE_BACKGROUND_WORKERS=1`,
`DISABLE_NATIVE_ATTESTATIONS=1`, `CREATOR_COMMUNITY_ENABLED=0`.

## 3. Isolated QA server (no `.env`, no workers, closed RPC)

```bash
QUESTLAYER_REPO="$(pwd)"
QA="$(mktemp -d "${TMPDIR:-/tmp}/questlayer-qa.XXXXXX")"
npm run build
(
  cd "$QA"
  env DATABASE_PATH="$QA/questlayer-hackathon.sqlite" APP_ORIGIN=http://127.0.0.1:8891 HOST=127.0.0.1 PORT=8891 \
    DISABLE_BACKGROUND_WORKERS=1 DISABLE_NATIVE_ATTESTATIONS=1 DISABLE_RELAYER=1 \
    AWARD_SIGNER_PATH= REWARD_ATTESTOR_PATH= REWARD_WORKER_KEY_PATH= NEAR_RPC_URL=http://127.0.0.1:9 \
    CREATOR_COMMUNITY_ENABLED=0 node "$QUESTLAYER_REPO/server/index.mjs"
)
```

Open http://127.0.0.1:8891/. `GET /api/health` returns `status:ok` with schema versions. Native panels report
"not configured" instead of failing.

## 4. Automated checks

```bash
npm run check                      # build, then 480+ application tests
cargo test --manifest-path contracts/Cargo.toml --workspace
```

Expected: all tests pass; the build prints the hashed `dist/assets/*.js` files. The HTTP integration test needs
`dist/` to exist, which is why `check` builds first.

## 5. Testnet (keys stay on your machine)

These scripts send real testnet transactions and need a testnet operator key in `.data/` (never committed):

| Step | Command | What you should see |
| --- | --- | --- |
| Create operator | `node scripts/bootstrap-testnet.mjs` | `.data/near-operator.json` (mode 600) and an account on testnet |
| Deploy game + collectibles | `node scripts/deploy-testnet.mjs` | updated `public/testnet-deployment.json` with transaction hashes |
| Player factory + relayer accounts | `node scripts/deploy-player-factory-testnet.mjs` (planned in E2) | `.data/player-factory.json`, `.data/relayer.json` |
| Prove invisible account | `node scripts/prove-invisible-account-testnet.mjs` (planned in E2) | `public/native-invisible-account-proof.json` |

Run the server with `PLAYER_FACTORY_KEY_PATH`, `RELAYER_KEY_PATH` and `PLAYER_FACTORY_ACCOUNT` set to enable
invisible accounts; see `docs/RELAYER.md`.

## 6. On a phone

The easiest path is the public alpha at https://questlayer.promptstudio3000.com/ once the next release is
deployed (see `docs/VPS-MIGRATION.md`). For a local build, expose port 5173 over HTTPS (Codespaces port
forwarding or a tunnel), because geolocation and passkeys require a secure origin. Then:

1. Allow location when asked, choose **Use my location**.
2. Walk; coins within reach are collected automatically while the app is in the foreground.
3. Report: device, OS, browser, whether GPS accuracy showed, and anything that felt confusing.

## 7. What is not yet verified

Real iOS/Android field play, the relayer on a public host, a complete staking yield cycle and the App Store
track remain open. See `docs/STATUS.md`.
