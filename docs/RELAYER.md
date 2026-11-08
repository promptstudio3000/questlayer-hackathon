# Invisible NEAR accounts and the gas relayer

31 October 2026. Server side only; NEAR testnet only. Source: `server/relayer/*`.

## What it does

A player who signs in without a wallet gets a sponsored sub-account
`<slug>.<PLAYER_FACTORY_ACCOUNT>` whose only full-access key is generated on their
device. The server never holds a player key. Game actions are signed on the device as
NEP-366 meta-transactions (`SignedDelegate`) and submitted to `/api/relay`; the
relayer account pays gas, verifies the final receipt and keeps a durable job record.

| Component                  | Responsibility                                                                                                                                           |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `key-transport.mjs`        | Loads service keys (`0600`, testnet JSON, on-chain full-access check). `relayTransport` signs first, records the hash, then sends.                       |
| `accounts.mjs`             | `ManagedAccounts`: slug rules, one account per player, `createAccount + transfer + addFullAccessKey`, `wallet_links` + `players.native_account`.         |
| `policy.mjs`               | Pure `validateDelegate(decoded, ctx)`: exactly one action, sender/key/nonce/expiry/gas/args bounds, receiver+method+deposit allowlist.                   |
| `relay.mjs`                | `Relayer`: prepare, submit (decode → verify signature → policy → durable job), leased worker, backoff, budget, outcome verification.                     |
| `outcome.mjs`              | Verifies signer = relayer, receiver = sender, delegate contents, receipt success; extracts the minted token id and checks its owner.                     |
| `schema.mjs`               | Module `managed-accounts@1` (`managed_accounts`, `managed_account_keys`, `managed_account_funding`, `relay_jobs`, `relay_budget`, `relay_worker_lease`). |
| `routes.mjs`, `config.mjs` | Route dispatcher for the parent server and the environment contract.                                                                                     |

## Who pays what

In a NEP-366 meta-transaction the relayer's own transaction carries every attached deposit of
the delegated actions; the player's balance is never debited. This was verified on testnet on
1 November 2026 when a relayed `create_position` moved 3.52 NEAR out of the relayer while the
player's account kept its balance (receipt chain in `output/qa/2026-11-testnet/README.md`).
Consequently:

- The relayer accepts only storage-class deposits: 0, 1 yocto or 0.05 NEAR
  (`RELAYED_DEPOSITS` in `policy.mjs`, enforced again after every branch).
- Money actions (`buy`, `buy_access`, `donate`, `create_position`, `deposit_and_stake`) are
  refused with `RELAY_SELF_PAID`. The client sends them as ordinary transactions signed by the
  same device key (`src/self-paid-native-transaction.ts`): the player pays the deposit and the
  gas, still without a wallet popup. Reviewed quotes are unchanged.
- The daily top-up (`RELAY_TOPUP_CAP_YOCTO`) covers only the account's own state storage
  (0.01 NEAR margin after a `LackBalanceForState` failure, one retry), never a deposit.

## What is sponsored

Gas for every relayed action and the storage-class deposit it carries:

- collectibles: `mint_avatar` (0.05 NEAR), `redeem_aura` (0.05 NEAR, `receiver_id` = sender),
  `equip_aura`/`unequip_aura` (0), `nft_transfer_call` (1 yocto, to the market only),
  `nft_transfer` (1 yocto, only to a wallet linked to the same explorer)
- market: `cancel` (1), `withdraw` (1), and for signed orders `add_signing_key`/`remove_signing_key`
  (1, one ed25519 key), `cancel_order` (1), `cancel_all_orders` (1). Purchases and everything else
  that moves money (`buy`, `fill_sell_order`, `fill_buy_order` even at 1 yocto, `deposit_near`) are self-paid
- rewards: `withdraw` (1); SocialDB `v1.social08.testnet` `set` (1 or 0.05 NEAR, own namespace only)
- staking: `register_position` (0), `withdraw_refund` (1), own vault `request_exit`/`withdraw_owner`
  (1), `refresh`/`advance`/`harvest` (0); setup deposit and stake are self-paid
- creators: `withdraw` (1); payments and donations are self-paid
- on the account itself: `addKey` (full access, key previously registered via
  `POST /api/account/keys`) and `deleteKey` (registered removal, never the signing key)

Not sponsored: any other contract or method, transfers, staking, contract deployment,
nested delegates, more than one action per delegate, calls to the player's own account,
gas above `RELAY_MAX_GAS`, JSON arguments above 8 KiB, purchase prices, mainnet.

## Threat model

- The relayer key can only pay gas: the delegated action is signed by the player's key
  and the chain rejects any change to it. A compromised relayer can refuse or delay
  service, not move assets. The factory key can create sub-accounts and transfer funds,
  so it is the asset at risk; keep it on a separate account with a bounded balance.
- Before storing anything the server decodes canonically (re-serialization must match),
  verifies the ed25519 signature over `sha256(u32le(2^30+366) ‖ borsh(DelegateAction))`,
  requires `nonce = chain nonce (or highest pending) + 1` and an expiry within
  `RELAY_BLOCK_TTL` blocks, then applies the allowlist. Idempotency key: the delegate
  hash; a failed job does not pin it, the nonce does.
- The worker runs under `relay_worker_lease`; every durable write renews the lease, so a
  stalled process cannot overwrite a successor. Jobs per account execute oldest first; a
  terminal failure fails later queued actions of that account with `RELAY_BLOCKED`
  because their nonces can no longer execute. Other accounts are unaffected.
- Final receipts are verified against the stored normalized call (signer, receiver,
  method, args, gas, deposit, nonce, expiry, key); mint results must be owned by the
  sender. Errors: `RELAY_NONCE`, `RELAY_EXPIRED`, `RELAY_SIGNATURE`,
  `RELAY_INSUFFICIENT_BALANCE` (one margin-funded retry for state storage), `RELAY_SELF_PAID`, `RELAY_CONTRACT_FAILED`,
  `RELAY_OUTCOME`; network errors retry with `min(300 s, 5 s·2^min(attempts,6))`.
- Daily budgets: `RELAY_MAX_JOBS_PER_DAY` submissions, `RELAY_MAX_DEPOSIT_YOCTO_PER_DAY` of attached storage deposits and `RELAY_TOPUP_CAP_YOCTO` per account. The deposit budget matters because a relayed call that fails refunds its deposit to the player's account, not to the relayer.

## Provisioning

Key files are JSON `{"network":"testnet","accountId":"…","secretKey":"ed25519:…"}` with
mode `0600`; both keys must be full-access keys of their account on testnet.

| Variable                      | Meaning                                                  | Default               |
| ----------------------------- | -------------------------------------------------------- | --------------------- |
| `PLAYER_FACTORY_ACCOUNT`      | Parent of player accounts (`players.questlayer.testnet`) | required              |
| `PLAYER_FACTORY_KEY_PATH`     | Factory full-access key file                             | required for accounts |
| `PLAYER_FACTORY_FUND_YOCTO`   | Initial transfer to a new account                        | `1e23` (0.1 NEAR)     |
| `RELAYER_KEY_PATH`            | Gas payer full-access key file                           | required for relaying |
| `RELAY_TOPUP_CAP_YOCTO`       | Max sponsored top-up per account per day                 | `2e23`                |
| `RELAY_MAX_JOBS_PER_DAY`      | Max submissions per account per day                      | `40`                  |
| `RELAY_MAX_DEPOSIT_YOCTO_PER_DAY` | Max attached deposits the relayer carries per account per UTC day | `0.5 NEAR` |
| `RELAY_MAX_GAS`               | Max gas per delegated action                             | `300000000000000`     |
| `RELAY_BLOCK_TTL`             | Max blocks a delegate may stay valid                     | `120`                 |
| `DISABLE_RELAYER`             | `1` disables accounts and relaying                       | unset                 |

### Creator money publisher (`server/native/creator-money.mjs`)

The creators contract trusts one publisher account for facts the server already verifies off chain. The
server mirrors them through a durable outbox (`creator_money_jobs`, lease, backoff like the relayer) and never
moves money itself: published quests → `register_quest`, accepted completions → `record_support(completion)`,
one like per player and quest → `record_support(like)`, one UTC day → `open_round` then `finalize_round` the
next day. Player payments (`buy_access`, `donate`, `withdraw`) are quoted by `POST /api/native/creators/prepare`
and signed by the player (relayed from the invisible account, never sponsored).

| Variable                      | Meaning                                                       | Default            |
| ----------------------------- | ------------------------------------------------------------- | ------------------ |
| `CREATORS_PUBLISHER_KEY_PATH` | Publisher function-call key of the creators contract account  | unset = read only  |
| `CREATOR_ROUND_BUDGET_YOCTO`  | Daily round budget; capped by policy and the funded pot       | `1e22` (0.01 NEAR) |

The module and its tables load only when this key or `CREATOR_COMMUNITY_ENABLED=1` is set, so hosts without
creator features keep their schema unchanged. `scripts/install-relayer-keys-vps.sh` installs the key next to the
relayer keys when `.data/creators-publisher.json` exists.

### Public records (`server/native/social-records.mjs`)

Notes already public in the app can be written as records under `<account>/questlayer/notes/<id>` on NEAR Social
from the player's own account; the existing `set` allowlist (own namespace, 1 yocto or 0.05 NEAR) covers it.
`IPFS_ADD_URL` / `IPFS_ADD_TOKEN` enable photo pinning through a Kubo-compatible add endpoint with retries; the
record's `ipfs://` address is computed locally either way (CIDv1, raw leaf, sha2-256).

## Wiring in `server/index.mjs`

```js
import { relayerConfiguration } from "./relayer/config.mjs";
import { loadServiceAccount } from "./relayer/key-transport.mjs";
import { ManagedAccounts } from "./relayer/accounts.mjs";
import { Relayer, startRelayWorker } from "./relayer/relay.mjs";
import { createRelayerRoutes } from "./relayer/routes.mjs";

const relayConfig = relayerConfiguration(process.env);
const factoryService = relayConfig.accountsEnabled
  ? await loadServiceAccount(provider, relayConfig.factoryKeyPath, { expectAccountId: relayConfig.factoryAccount })
  : null;
const managedAccounts = relayConfig.factoryAccount
  ? new ManagedAccounts(db, provider, factoryService?.account ?? null, {
      factoryId: relayConfig.factoryAccount, fundYocto: relayConfig.fundYocto, topupCapYocto: relayConfig.topupCapYocto })
  : null;
const relayerService = relayConfig.enabled ? await loadServiceAccount(provider, relayConfig.relayerKeyPath) : null;
const relayer = managedAccounts
  ? new Relayer(db, provider, relayerService, {
      accounts: managedAccounts,
      contracts: { collectibles: nativeCollectibles.contractId, market: marketContractId, rewards: rewardsConfig?.contractId },
      blockTtl: relayConfig.blockTtl, maxJobsPerDay: relayConfig.maxJobsPerDay,
      maxGas: relayConfig.maxGas })
  : null;
const relayerRoutes = createRelayerRoutes({ relayer, accounts: managedAccounts });
// inside api(), after `const player = auth(req);`
if (await relayerRoutes.handle(req, res, url, { player, body, respond, assert })) return;
// next to the other background workers
const relayWorker = !backgroundWorkersDisabled && relayer ? startRelayWorker(relayer, { intervalMs: 15000 }) : null;
```

Routes: `POST /api/account/create {publicKey,name}` → 201 account view (state `creating`);
`GET /api/account`; `POST /api/account/keys {publicKey,label}` or `{publicKey,remove:true}`;
`POST /api/relay/prepare {accountId,receiverId?,methodName?}` → nonce, block height, TTL,
limits; `POST /api/relay {signedDelegateBase64,preview?}` → 202 job (200 when duplicate);
`GET /api/relay/:id`; `GET /api/relay?account=…`. Job states: `queued`, `retrying`, `sent`,
`confirmed` (with `result.tokenId` for mints), `failed` (with `errorCode`).

## Local security candidate: durable submissions and shared budget

The candidate saves the exact signed outer transaction before broadcasting. A
restart queries its status without waiting for an unbroadcast transaction to become
FINAL; an unknown hash replays identical bytes. No timeout or invalid nonce alone
permits a replacement payment. Account creation and native topups have the same
durable journal; balance changes are not proof that another transfer is owed.
Writes and sends are fenced by the worker lease.

A saved transaction can become impossible to include: its send failed transiently,
a later job of the same service key landed with a higher nonce, and access-key
nonces only increase. Such an attempt is re-signed only on proof of non-inclusion:
the RPC does not know its hash, the node rejects the exact bytes with
`InvalidTxError::InvalidNonce`, the key's final nonce on chain is at or past the
saved nonce, and the same evidence recurs at least 30 s after it was first recorded
(`RELAY_NONCE_CHECK` / `FUNDING_PENDING` while observing). Then the attempt is
`rejected`, its unspent reservation released, and the next pass signs a fresh
attempt (`RELAY_RESIGN` / `FUNDING_RESIGN`). An attempt whose hash RPC knows is
acknowledged, never replaced.

A shared SQLite reservation budget covers initial account funding, attached
deposits, gas reserves and topups across all players. Configure
`SUBSIDY_DAILY_YOCTO`, `SUBSIDY_DAILY_OPERATIONS` and
`SUBSIDY_GAS_RESERVE_YOCTO` from the operator's actual reserve/workload; defaults
disable sponsorship. Unknown reservations (signed bytes without a FINAL receipt)
carry across UTC midnight. A reservation whose job ends terminally before any
transaction was signed (`RELAY_BLOCKED` cascade, pre-send `ACCOUNT_TAKEN`, policy
refusal) or whose signed attempt is proved superseded is `released` and returns to
the day's budget; nothing left the treasury. Final refunds are not recycled into
new allowances. A verified retry consumes another reservation.

`POST /api/account/create` is the costliest sponsored action (factory transfer plus
gas) and a guest cookie is free, so it requires proof of play: the explorer must
have earned XP on the map (a GPS-verified find, coin or quest; the test seed kit
grants it too), answered otherwise with `403 ACCOUNT_PLAY_FIRST`. Creations are also
capped at 20 per network address per UTC day (`429 RATE_LIMITED`). The client
treats `ACCOUNT_PLAY_FIRST` as "not yet" and asks again when XP arrives, so a new
explorer plays the first steps solo and finds the account prepared by the time the
first Aura needs it. A retry after a failed creation is not gated again. Observed receipt fees above their reserve trigger a persistent
`SUBSIDY_GAS_OVERRUN` breaker; existing signed submissions can still reconcile.
The estimate is not a protocol gas-price cap: keep a bounded service-account
balance and monitor it. The first overrun/in-flight operations can exceed the
estimate. An operator must reconcile the ledger before clearing the breaker.

`SIGNING_VAULT_ORIGIN` must name the independent signing service before managed
financial services activate. The same-site, separate origin has an immutable public
configuration, fixed RPC/contract allowlist, strict CSP and no game database or
service keys. Free solo play does not require this service or sponsor budget.
The earlier wiring example omits these candidate-specific gates; use current
`server/index.mjs` as the implementation reference.
