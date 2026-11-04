# npc-games contract (NPC-PLAN §7, slice N4)

Free item mini-games for NPC sightings and quests. **No betting or wagering** (owner decision, NPC-PLAN §11):
a roll needs a ticket the game server signed for something the player already earned, every player method rejects
attached NEAR, nothing the player owns is staked, and prizes are cosmetic award claims.

Source: `contracts/npc-games/src/lib.rs` (tests in `src/tests.rs`). WASM pin: `questlayer_npc_games` in
`contracts/wasm-sha256.json`.

## Flow
1. Server: pick a fresh random 32-byte secret per roll, `commit = sha256(secret)` (hex), and sign
   `ticket_message(roll_id, account_id, commit, table_id, expires_at_ms)` with the ticket key (Ed25519, raw message).
2. Player: `start_roll(roll_id, table_id, commit, expires_at_ms, signature)`. Only the ticket's account, once, before
   expiry, on an active table, with zero deposit.
3. Worker (or anyone holding the secret): `resolve_roll(roll_id, secret)` from `start_height + 3` until
   `start_height + timeout_blocks`. The draw is
   `sha256("QuestLayer NPC roll v1" ‖ random_seed ‖ secret ‖ roll_id ‖ "\n" ‖ account)`, first 8 bytes big-endian
   mod total weight. Anyone can recompute it from `get_roll` (`random`, `secret`).
4. If nobody reveals in time: `claim_timeout(roll_id)` settles on the table's guaranteed minimum tier.
5. Server signs the award claim `earned:npc-roll:<roll_id>` only for a roll whose status is `Resolved` **or**
   `TimedOut`, using `get_roll(...).prize`.

## Redeeming earned tickets (GAME-LOOPS P0-4)
`server/npc/rolls.mjs` runs the flow for the game, tested in `tests/npc-rolls.test.mjs`. The tickets come from lurker wins and the boss (`monster_rewards`, kind `roll`).
Each roll uses one ticket, and the player gets to it from Inventory, then Secured, then "Roll at the wisp".

- `POST /api/npc-rolls {accountId}` signs a ticket for a fresh secret. An unused ticket is signed again with a new expiry and
  does not use a second ticket. The client relays `start_roll` from the explorer account with no deposit.
- `POST /api/npc-rolls/<id>` reads `get_roll` at `final`. It reveals the secret only when the start is final and at least
  3 blocks old (`next: "resolve"`). It answers `next: "timeout"` once the window has closed, and `next: "done"` once the
  prize is paid.
- Payment reads the recorded prize and pays it once, as a demo Aura. `aura-rare` and `aura-epic` become a chest edition
  of that rarity, chosen from the on-chain `random`. `aura-legendary-wisp` becomes the Will-o'-Wisp Halo.
  `trader-voucher` becomes a common Aura for now, which the altar and the traders take. A sold-out edition pays 25 XP.
- The player secures the Aura through the ordinary `redeem_aura` flow. Its claim id is reserved as
  `earned:npc-roll:<roll_id>`. NPC-only editions (the wisp) use `earned:npc:roll:<roll_id>`, because the
  collectibles contract requires the `earned:npc:` prefix for them.
- A background pass every 30 s pays out rolls that somebody else resolved or timed out.
- The relayer sponsors only `start_roll`, `resolve_roll` and `claim_timeout` on this contract, with no deposit and fixed argument shapes.
- The host needs the ticket key in its state directory: `bash scripts/install-npc-ticket-key-vps.sh` (from the Mac), then
  deploy. If the key is missing, or does not match `get_config().ticket_signer`, rolls stay off.

## Prize tables
`publish_table(table_id, tiers, minimum)` (owner, 1 yocto). Tables are immutable; publish `wisp-v2` to change odds.
`set_table_active` only stops new rolls. A tier may carry `daily_cap` (≥ 1, per UTC day, whole table); a capped draw
falls back to the minimum tier and the roll records `capped: true`. Show players that caps can lower the top odds.

First table `wisp-v1`: trader voucher 60 %, rare Aura 30 %, epic Aura 9 % (cap 20/day), legendary wisp 1 % (cap 2/day).

## Known limits (from the independent review)
- A block producer who is also a player could withhold or reorder the reveal for its own block. Accepted for
  cosmetic prizes (NEAR docs: random_seed is fine for low stakes). Keep prizes cosmetic.
- The contract pays storage (~0.5 KB per roll). Ticket issuance is the rate limit; keep the account funded.
- No state migration yet: adding fields to `Roll`/`PrizeTable` needs a migrate method before mainnet.
- Keep tickets short-lived and never reuse a secret.

## Testnet deploy
On the Mac (operator key in `.data/`), with the Linux WASM from `npm run contracts:docker` or the CI artifact
`contract-wasm-linux-amd64`:

```
node scripts/deploy-npc-games-testnet.mjs
```

It creates `questlayer-npc-games-20261101.testnet`, initializes it with a dedicated ticket key
(`.data/npc-games-ticket-signer.pem`), publishes `wisp-v1`, proves one roll and writes
`public/native-npc-games-testnet.json`. It refuses a WASM that does not match the pin.
