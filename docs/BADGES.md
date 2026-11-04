# Badges

Badges reward exploring the real world. They are decorations only: no GOLD, XP, NEAR or odds, and they can never be sold, listed or moved.

## 1. Place badges (game database)

- One badge per notable place: **peaks, viewpoints, landmarks and bigger cities**. The curated list is `server/data/place-badges.json` (69 places: Czech peaks such as Sněžka and Lysá hora, Prague/Brno/Plzeň landmarks, castles, nearby European capitals and their landmarks, Tatra and Alpine summits, 22 cities).
- More places come from the global POI pipeline (`docs/WORLDS-PLAN.md` C.2): `node scripts/build-place-badges.mjs <pois.json|jsonl> <out.json>` keeps notable (`notability >= 20`), safe (`safety = ok`) POIs of the categories viewpoint, observatory, landmark_tower, castle, ruins, monument, memorial, historic_building, bridge and peak, and drops anything within 150 m of a curated place. Point `PLACE_BADGES_EXTRA_PATH` at the output.
- Earning: with real GPS on, the app sends the fix to `POST /api/badges/check` every 30 s or after ~40 m of movement. A badge is awarded once when the fix is inside the place's radius, at most 15 s old, and accurate to `max(35, min(150, radius / 3))` m (a summit needs ~35 m, a city accepts 150 m). A jump faster than 340 m/s since the previous check earns nothing. The arena (city demo) never earns place badges.
- Stored in `place_badge_awards` (schema module `badges` v1). Not inventory, so the market cannot see them.
- UI: Profile → **Badges** (`src/BadgeBook.tsx`): earned/total per kind, nearest new badges, medal grid by kind and a detail sheet with a map link. A toast appears when a badge is earned.

## 1a. Place badges on NEAR (soulbound NFTs)

Every earned place badge is also minted to the player's NEAR account on the `questlayer_badges` contract, with no click.

- The first time anyone earns a place, the server creates one **sponsored** design for it: id `place-<badge id>` (shortened with a hash past 48 characters), creator = the badge contract itself, kind `Place` with the catalog point and radius, supply 10,000, colour by rarity.
- Each award then queues a claim in `place_badge_mints` (schema module `place-badge-mints` v1). The badge worker (every 15 s) signs it with the award signer and mints it to the account linked at that moment (the invisible explorer account or a wallet). A player without an account waits and is retried every 10 minutes, so badges earned before linking still arrive.
- Badges earned before this existed are backfilled from `place_badge_awards` on start.
- `GET /api/badges` shows `places.onChain` and, per badge, `chain: {state, accountId, tx, tokenId}`; the Badge book links the mint transaction on the explorer. `/api/health` → `badges.placeMints` shows the queue.
- `PLACE_BADGES_ONCHAIN` defaults to on for testnet and off for mainnet (each design and mint is paid by the contract account).

## 2. Player badges (NEAR, POAP-like)

Any explorer with a linked NEAR account (wallet or the invisible game account) can design a badge:

| Kind | How others earn it | Checked by |
| --- | --- | --- |
| Place | Stand within the radius (30–2000 m) of the spot where the creator stood when making it | Game server, GPS fix |
| Event | Enter the creator's event code (optionally also be at the place) | Game server |
| Quest | Finish the creator's own community quest (`creator:<questId>`, accepted completion receipt) | Game server |

Limits (testnet defaults, `USER_BADGES_*`): 5 active designs per player, 3 new per day, supply 1–200. `USER_BADGES_ENABLED` defaults to on for testnet and off for mainnet.

### Contract `questlayer_badges` (`contracts/badges`)

A new soulbound contract, so the collectibles contract (and its review) is untouched.

- `create_badge(badge_id, input, creator_id?)`: a creator attaches `create_cost(max_supply)` = 0.02 NEAR + 0.004 NEAR per badge; the unused part comes back on `close_badge`. The contract's own key (the game's minter) or the owner may create a **sponsored** badge for `creator_id`; the game pays storage on testnet.
- `claim(badge_id, account_id, expires_at_ms, signature)`: anyone may submit; the badge always goes to the signed account. The signature is the game's award signer over
  `QuestLayer badge claim v1\nContract: <id>\nNetwork: <testnet|mainnet>\nBadge: <id>\nAccount: <account>\nExpires: <ms>`.
- `award(badge_id, account_ids)`: the creator hands out up to 50 at a time.
- One badge per account per design, hard supply cap, optional start/end, `set_badge_active` (creator or owner moderation), `close_badge`.
- No transfer, approve or burn methods. NEP-171 views (`nft_token`, `nft_tokens_for_owner`, `nft_supply_for_owner`, `nft_total_supply`, `nft_metadata`) and `nft_mint` events let wallets and explorers show them; token id `<badge_id>:<serial>`.
- WASM pinned in `contracts/wasm-sha256.json` (`questlayer_badges`).

### Server queue

`user_badges` and `user_badge_claims` hold designs and claims. `server/badges/chain.mjs` drains them every 15 s: first `create_badge` (sponsored, `creator_id` = the creator's linked account), then `claim` with a fresh 10-minute signature. A lost response is reconciled from chain state (`get_badge`, `has_badge`). Claims retry 5 times; a sold-out, closed or ended badge fails at once.

The minter is a function-call key on the badge contract account limited to `create_badge` and `claim` (3 NEAR gas allowance). Even a leaked minter key cannot mint to an account the server did not sign for.

## Testnet rollout (Mac)

1. `npm run contracts:docker` (or the CI artifact) so the WASM matches the pin.
2. `node scripts/deploy-badges-testnet.mjs`: creates `questlayer-badges-20261102.testnet` through the testnet helper, deploys, sets the claim signer to the live server's award signer (`/api/native/claim-signer`), installs the minter key (`.data/badges-minter.json`), proves a sponsored design and a creator award, writes `public/native-badges-testnet.json`.
3. `bash scripts/install-badges-minter-vps.sh` (no runtime.env change).
4. Commit `public/native-badges-testnet.json`, deploy. `/api/badges` then shows `contractId` and `minting: true`.

Until step 4, place badges work fully and player badges can be designed and claimed; they wait in the queue and mint as soon as the contract and key are in place.

## Endpoints

- `GET /api/badges?lat=&lng=` overview (places with earned flags and nearest new ones; player badges created, held and nearby)
- `POST /api/badges/check {fix}` place badges for a fix
- `POST /api/badges/user {title, description, icon, color, kind, radiusM, maxSupply, fix, code, questRef, endsAt}`
- `POST /api/badges/user/claim {badgeId, fix?, code?}`
- `GET /api/badges/user/:id`

`BADGES_ENABLED=0` turns the whole feature off.
