# How we continue to 14 November

Written 1 November 2026 (morning UTC). One page that merges every lane. Details live in the linked documents;
this file says who does what, in which order, and what "done" means. Update it when a line changes.

## Where we are

| Area | State | Evidence |
| --- | --- | --- |
| Invisible account + relayer | live on testnet; money actions self-paid, only storage-class deposits relayed | `public/native-invisible-account-proof.json`, `public/native-sponsored-stake-proof.json`, `docs/RELAYER.md` |
| Rewards treasury, daily Plzeň days | two days published; whole-treasury audit **verified**; worker refuses to publish on drift | `public/native-distribution-proof.json` |
| Staking vault and yield cycle | first harvest done automatically at epoch 5401; cash unlocks at 5405 (about 3 Nov), then flush to the treasury | `docs/STATUS.md` |
| Creator money | contract proven; publisher opens/finalizes UTC rounds from the API | `public/native-creators-proof.json` |
| Public records (NEAR Social) | note record written and confirmed from an invisible account | `public/native-public-record-proof.json` |
| Zone preparation and map backend (Codex) | durable publication, 0–6 zone shortfalls, pedestrian graph tooling, closures, viewport reads, pilot | `docs/WORLD-WORKER.md`, `docs/MAP-BACKEND-CONTINUATION-2026-11-01.md` |
| Tests | 574 application tests, 111 contract tests; CI contracts job fixed (vault WASM built first) | `.github/workflows/check.yml` |
| Public host | still the pre-rename release; none of the above is live there yet | `https://questlayer.promptstudio3000.com/api/health` |

## Who does what

- **Claude (backend, contracts, chain):** treasury and yield, distribution, mainnet path, contract v2 work, proofs.
- **Opus 5.5 subagents (product slices):** the UI slices of `docs/PLAN-FOR-OPUS.md`, one slice per agent, client
  files only, with screenshots. Done 1 November: slice 2 "Today's pot", slice 7 "PWA polish"; next 3–6.
- **Codex (map backend, operations):** Plzeň topology and entries, field checks, VPS migration and deployment,
  device matrix.
- **Owner:** decisions below, real phones, mainnet payout account, X post and video, submission form.

## Order of work

| When | Claude | Opus subagents | Codex | Owner |
| --- | --- | --- | --- | --- |
| 1–2 Nov | Distribution audit (done), yield-credit proposal (done), observe first harvest | Today's pot, PWA polish | Deploy branch to VPS with relayer + publisher keys | Check the hosted build on a phone |
| 3–4 Nov | Realized-yield proof: harvest → flush → treasury funded by yield; publish a day backed by it | Result → Secure → Share card; Stake as a game decision | Plzeň entries/topology review; health monitoring | Decide multi-city and yield-credit scope |
| 5–6 Nov | Multi-city allocation function + tests (contract per-date cap already live) | Creator feed and earnings (buy/donate self-paid, withdraw relayed) | Second CityPack draft and field check if chosen | Real-device run (iOS Safari, Android Chrome) |
| 7–8 Nov | Mainnet refactor steps 4–7 (schema, client network, scripts, flags) | Notes and public records UI; profile without popups | Backup/restore rehearsal on VPS | Mainnet account and funding if go |
| 9 Nov | **Mainnet go/no-go** (`docs/MAINNET-PLAN.md` §5) | Polish from device findings | Release checklist | Decision |
| 10–12 Nov | Mainnet minimal slice or final testnet proofs; economy page data | Demo-path polish, copy pass | Fresh-clone verification, regression | Record video |
| 13–14 Nov | Freeze, fix, README "do X, see Y" | Fixes only | Final deploy | Submit by 14 Nov 23:59 UTC |

## Zones everywhere, money only where it is verified

- **Practice worlds anywhere.** Codex's map-data module builds H3 street worlds for any place with no real money.
  This is how the game is "global" today and should stay unlimited.
- **Funded days only in reviewed cities.** A city earns native rewards only with a field-reviewed CityPack.
  Plzeň is the only one. The contract still checks one day at a time, with a 0.1 NEAR cap on each publication.
- **Allocation across cities (built 1 November).** `server/native/allocation.mjs`: each day's budget is the smaller
  of the cap and `NATIVE_DAILY_SHARE_BPS` of available funds, split between `NATIVE_FUNDED_CITIES` (`plzen:2,brno:1`,
  equal by default) and rounded down. Defaults reproduce v1 byte-for-byte (same manifest hash). Tests:
  `tests/allocation.test.mjs`.
- **Days paid from realized yield (built 1 November).** With `NATIVE_YIELD_BACKED_DAYS=1` the publisher spends no
  more than the vaults' on-chain `game_paid` minus earlier yield-backed days; the manifest records
  `funding: "realized_yield"` and the vault payouts it relied on, and the audit adds `yield-backed-days-covered`.
  Without realized yield nothing is published. Timeline of the cycle: `node scripts/observe-yield-cycle.mjs --out
  public/native-yield-cycle.json` (read-only).
- **Verifiable on chain (done 1 November).** The rewards contract reads the city and local date from the day id
  (`<city>-YYYY-MM-DD-v<n>`), keeps a per-date total and rejects a publication that would exceed the daily cap
  across all cities. The audit checks that each date's total equals what this server published.
- **Gate to enable a second city:** reviewed CityPack, allocation tests and the audit green for a week.

## Decisions needed from the owner

1. Second funded city before 14 November, or Plzeň only with practice worlds everywhere? Recommendation: Plzeň only.
2. Yield-credit ("pay now with future yield"): proposal only for the submission, build after? Recommendation: yes,
   describe it as the next step (`docs/YIELD-CREDIT-PROPOSAL.md`).
3. Mainnet minimal slice: go/no-go on 9 November (`docs/MAINNET-PLAN.md`).
4. Confirm that Codex deploys this branch to the VPS now. After deploy, `/api/health` must show `network`,
  `relayer.enabled`, `distribution.status: verified`, `creatorMoney` and `socialRecords`.
