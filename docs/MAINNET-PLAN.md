# Minimal mainnet path

Status: plan, 1 November 2026. Nothing in this repository runs on mainnet yet. The hackathon rules allow a
mainnet deployment (Q-010) but do not require one; the judges score the game loop, with a bonus when players
never notice the chain. This plan describes the smallest honest mainnet slice, what blocks it today and the gate
that decides whether it ships before 14 November or stays "documented, flagged off".

## 1. What "minimal" means

| In the slice | Out of the slice (stays testnet or off) |
| --- | --- |
| Collectibles contract (avatar mint, Aura redeem with a server voucher, equip) | Rewards treasury, vault and vault factory (money from strangers needs an external review first) |
| Player factory + relayer: sponsored sub-accounts and gas, capped per day | Market (needs the reviewed collectibles first; add in a second step if time allows) |
| NEAR Social profile and public note records from the player's own account | Creator money (contract review pending; keep on testnet) |
| Read-only explorer links on mainnet (nearblocks) | Sponsored tasks escrow (W10.3) |

Amounts: factory funds each account with 0.02 NEAR; relayer top-ups capped at 0.05 NEAR per account per day;
total sponsor float 10 NEAR with an alert at 3 NEAR. All are env values, not code. The relayer carries only
storage-class deposits (0, 1 yocto, 0.05 NEAR) by policy; money actions are self-paid by the player's key, so the
float is exposed to at most `RELAY_MAX_JOBS_PER_DAY × 0.05 NEAR` per account per day.

## 2. Testnet assumptions that must become configuration

The code currently treats "testnet" as a safety invariant, which is correct until mainnet is a deliberate
decision. Counted on 1 November (`grep -c testnet`):

| Area | Sites | Examples |
| --- | --- | --- |
| Server RPC and identity | `server/identity/near.mjs` 5, `server/identity/sessions.mjs` 5 | `assertTestnetRpc` checks `chain_id === "testnet"`; NEP-413 messages say "on NEAR testnet"; challenges carry `network: "testnet"` |
| Server contract readers | `server/native/reader.mjs` (".testnet" suffix), `transaction-confirmation.mjs` 13, `tasks.mjs` 11, `progression.mjs` 9, `rewards.mjs` 5, `award-vouchers.mjs` 5, `vaults.mjs` 4, `market.mjs` 3, `social-profile.mjs` 3, `creator-money.mjs` 4 | every quote returns `network: "testnet"`; manifests are `public/*-testnet.json`; `v1.social08.testnet` |
| Relayer | `accounts.mjs` 6, `key-transport.mjs` 3, `relay.mjs` 2 | `managed_accounts.network CHECK(network='testnet')`; key files require `network: "testnet"` |
| Server routes | `server/index.mjs` 30 | `/api/config` says `network: "testnet"`; manifest paths; sign-in texts |
| Client validators | `src/confirmed-native-transaction.ts` 10, `src/native-objective.ts` 17, `src/types.ts` 5, `src/App.tsx` 24, `NativeStaking.tsx` 5, `NativeTasks.tsx` 4, quotes 6 | types are `network: "testnet"` literals; `.endsWith(".testnet")` checks; explorer URLs |
| Scripts | `scripts/deploy-*.mjs`, `prove-*.mjs` | `Testnet only.` guards; `https://test.rpc.fastnear.com` |
| Tests | most native and relayer tests | assert `"testnet"` in responses and messages |

## 3. Design: one network value, everywhere

1. `server/native/network.mjs` exports the resolved network from `NEAR_NETWORK` (`testnet` default, `mainnet`
   only when explicitly set), the account suffix (`.testnet` / `.near`), the default RPC, the SocialDB contract
   (`v1.social08.testnet` / `social.near`) and the explorer base URL. Every module imports it; no literal network
   strings remain in server code except in this module and in tests.
2. `assertTestnetRpc` becomes `assertNetworkRpc(provider)`: the node's `chain_id` must equal the configured
   network. Error texts name the configured network.
3. Manifests move to `public/<name>-<network>.json`; the loader picks the configured network and refuses to start
   when a required manifest for that network is missing or carries another network.
4. Key files carry `network`; `loadServiceAccount` requires it to equal the configured network. Managed accounts
   store the network; the `CHECK` constraint becomes `network IN ('testnet','mainnet')` through a schema
   module version bump with a recorded `schema-known.json` entry.
5. `/api/config` and `/api/health` publish `network`. The client reads it once and validates quotes against that
   value instead of the literal; explorer links and "testnet" copy come from the same value. Player copy never
   says "testnet" or "mainnet" in the loop; Advanced shows the network name.
6. Scripts take `--network mainnet` and refuse unless `NEAR_MAINNET_CONFIRM=<account>` matches the operator
   account in the key file. Journals and manifests are written per network.
7. Feature flags: `MAINNET_FEATURES=collectibles,relayer,social` enables slices individually. Anything not listed
   answers "not configured" on mainnet even when a manifest exists.

The refactor is mechanical but wide. Order: server network module and RPC check; readers and quotes; relayer and
key files; routes and manifests; client validators and copy; scripts; tests updated to run the suite twice
(testnet default, mainnet with fake providers). Each step keeps the testnet behaviour byte-for-byte.

Progress, 1 November (evening): `server/native/network.mjs` exists and every server module reads `NETWORK`,
`NETWORK_LABEL`, `DEFAULT_RPC`, `SOCIAL_CONTRACT_ID`, `manifestName` and `onNetwork` from it; quotes, RPC checks,
key-file checks, manifest paths and sign-in texts no longer spell "testnet". Still literal on purpose: the
`managed_accounts.network` CHECK (schema module version bump, step 4), the testnet-only tasks pilot contract id,
player copy that names the pilot ("testnet expedition", "testnet vault pilot"), all client validators and the
scripts. `NEAR_NETWORK=mainnet` therefore starts the server against mainnet RPC and `*-mainnet.json` manifests
but is not yet a supported configuration.

Progress, 1 November (later):

- Step 4 done. `managed-accounts` is schema version 2 with `CHECK(network IN ('testnet','mainnet'))`, recorded in
  `server/schema-known.json` next to version 1. Schema modules can now declare upgrade steps that only rewrite
  CHECK clauses; each step is proven at registration (old recorded shape plus the edits must equal the new shape,
  indexes unchanged) and applied inside the owning transaction by rebuilding the table with ordinary SQL (rows
  copied aside and back unchanged, foreign keys deferred to commit, tables with referential actions refused),
  followed by foreign-key and integrity checks and a ledger update. `writable_schema` is not used because Node 24
  opens SQLite in defensive mode. Version 1 databases and
  backups still pass preflight and upgrade on first start. New accounts store the configured network, and a
  process refuses a database that holds another network's managed accounts (`NETWORK_MISMATCH`): one database
  per network. Tests: `tests/schema-module-upgrade.test.mjs`.
- Step 5 (client) done for validators. `src/near-network.ts` fixes the network at build time
  (`VITE_NEAR_NETWORK`, default testnet) instead of trusting the server, so a misconfigured server cannot move the
  client to another chain; every quote validator, quote type, explorer link, the SocialDB receiver and the wallet
  connector read it, and the self-paid signer still requires `/api/config` to report the same network. Still
  literal: player copy naming the testnet pilot (UI lane), the tasks pilot contract id and the statically
  imported `public/*-testnet.json` manifests in `native-level-claim.ts` and `native-vault-quote.ts` (rewards and
  vaults are outside the mainnet slice).
- Step 6 started. `scripts/lib/network-guard.mjs` selects the network for operator scripts: testnet by default;
  mainnet only when the script opts in, `--network mainnet` and `NEAR_NETWORK=mainnet` are both given, the
  operator key file says `mainnet` with a `.near` account, and `NEAR_MAINNET_CONFIRM` equals that account. It
  also checks the RPC `chain_id`. `scripts/deploy-player-factory-testnet.mjs` uses it; on mainnet it writes
  `.data/player-factory-mainnet.json` / `.data/relayer-mainnet.json` and requires explicit
  `PLAYER_FACTORY_FUND_NEAR` and `RELAYER_FUND_NEAR`. Every other script stays testnet only. A mainnet
  collectibles deploy script does not exist yet (`deploy-testnet.mjs` is a full smoke run and must not be reused).

Progress, 1 November (step 7): `MAINNET_FEATURES` is parsed in `server/native/network.mjs` (`featureEnabled`,
`ENABLED_FEATURES`). Testnet keeps every slice on. On mainnet the server refuses to start without `collectibles`
(the core reader and the minimal slice), `vaults` requires `rewards`, and market, rewards, vaults, relayer, social,
creators and tasks answer "not configured" unless listed; `/api/health` and `/api/config` publish `features`.
`npm run test:mainnet` runs the suite again with `NEAR_NETWORK=mainnet` (63 files, 422 tests); 21 files still use
`.testnet` fixtures and are listed in `scripts/test-mainnet.mjs` until their fixtures read the network module.
`npm run check` runs both passes.

Progress, 1 November (one-command slice): `scripts/deploy-mainnet-slice.mjs` (logic in
`scripts/lib/mainnet-slice.mjs`) deploys the §1 slice idempotently: collectibles created, deployed and initialised in
one transaction with the award signer set, factory and relayer accounts with `*-mainnet.json` key files, the
`social.near` code hash checked, then `public/mainnet-deployment.json` and `public/native-claims-mainnet.json` and a
runtime env file. Without `--execute` it only plans. It requires the reviewed WASM sha256 and explicit amounts on
mainnet. The server now boots on mainnet without market and rewards manifests (transaction confirmation and the
relayer allowlist treat them as absent slices). `tests/mainnet-slice.test.mjs` is the dry run: fake chain, then
the real server on `NEAR_NETWORK=mainnet` from those manifests, plus the `DISABLE_RELAYER` pause drill. Owner steps:
`docs/OWNER-RUNBOOK.md` §7. No mainnet transaction has been sent.

## 4. Owner prerequisites (not Claude's to do)

- A mainnet operator account with a hardware or well-kept key; separate `questlayer.near`-style factory and
  relayer sub-accounts; function-call keys for the services, never full-access keys on the VPS.
- Funding: about 15 NEAR (contract storage, sponsor float, reserve). Keep a written limit.
- Disclosures: the in-app Advanced page states that mainnet Auras are real tokens with no promised value; the
  README states which contracts are mainnet and which are testnet; the X post does not claim mainnet features that
  are flagged off.
- A pause switch: `DISABLE_RELAYER=1` plus removing the service keys stops all sponsored actions within one worker
  interval; document the drill in `docs/OWNER-RUNBOOK.md`.

## 5. Go / no-go gate (decide on 9 November)

Go only if all hold: the testnet slice has one week of clean relayer and reward worker health; the collectibles
contract passed a second read-through by someone who did not write it; the VPS runs the migrated release; the
owner has the mainnet accounts and funding ready; the refactor in section 3 is merged with the suite green on
both networks. Otherwise the submission says "mainnet-ready configuration, deployed on testnet", which is honest
and costs nothing in the games track.
