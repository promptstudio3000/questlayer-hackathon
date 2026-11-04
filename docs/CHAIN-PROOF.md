# On-chain proof: ChainLink, the On chain feed, auto SocialDB profile

One icon everywhere a game action is on NEAR (testnet now, explorer from
`EXPLORER_BASE`):

One icon (a cube) for every stage; only its colour and motion change:

| Stage | Look | From | Link |
| --- | --- | --- | --- |
| Sending | grey, pulsing | queued, retrying, issued (no tx yet) | none |
| Received | blue, spinning ring | `sent`, or a tx hash while still pending | the transaction |
| Final | green | confirmed, minted, settled (relayer and reward worker wait for FINAL) | the transaction, else the NFT token page, else the account page |
| Not saved | red | failed | the account page when known |

`no-account` and `off` hide the icon. A pending icon keeps polling until Final.

## Using it

```tsx
import { ChainLink } from "./ChainLink";
<ChainLink chain={{ tx }} />                       // a known transaction
<ChainLink chain={{ id: record.id, status }} />    // polls while pending
<ChainLink label chain={{ token: { contract, id } }} />
```

`ChainRef` (src/chain-proof.ts): `{ id, status, tx, explorer, account, token, poll }`.
While pending, ids starting `relay:`, `aura:<claim>`, `roll:<roll>`, `reward:`,
`badge:<badge>` or `latest:<kind>:<since ms>` poll `GET /api/chain/items?ids=`;
any other id polls the chain-record route `GET /api/chain/actions/:id`. A
record that does not exist falls back to the account link, or hides.

Explorer links are built only from a base58 hash, an account id or an NFT
token, or taken from `explorer` only when it starts with `EXPLORER_BASE`.

## Where it shows

- Reward bursts: `burst({ ..., chain: response.chain })` (coin claim and quest
  claim already pass it); a burst with a proof lives at least 2.6 s.
- History (Profile → wallet panel) and the Inventory History tab
  (`AdventureResult.chain`).
- Inventory: an Aura being secured (`aura:<claim id>`); Secured collection:
  every NFT links its token page.
- Badges: player badge claims (`badge:<id>`), badge designs (`tx`), place
  badges once they carry `chain`.
- Wisp rolls (`roll:<roll id>`), market panels (latest market call / signed
  order tx), staking (latest stake call, vault accounts).

## Server

`server/native/chain-feed.mjs` is read-only:

- `GET /api/chain/feed?limit=50`: the player's relayed explorer-account calls,
  native reward claims, badge mints and history rows with a transaction,
  newest first.
- `GET /api/chain/items?ids=a,b`: current state of up to 20 items.
- `playerView().history[i].chain`: from `meta.chain` (`{ id, status, tx }`,
  written by the chain-record worker), `meta.transaction | transactionHash |
  txHash | tx`, or a relayed job found by `meta.rollId` / `meta.claimId`.

## Settings → On chain

The feed merges `/api/chain/feed` with `/api/chain/actions?limit=50` (coin,
XP, street find, monster and quest records; a 404 is fine) and links the
explorer account page.

## Public profile at registration

`src/auto-social-profile.ts`: once the invisible explorer account is ready
and linked, the client publishes `<account>/questlayer/profile` (alias and
owned avatar reference only) to NEAR Social through the relayer, once per
account per browser. An existing profile is never overwritten. On a fresh
account the relayer sponsors the 0.05 NEAR SocialDB storage deposit (inside
`RELAY_MAX_DEPOSIT_YOCTO_PER_DAY`); budget for it before mainnet.
