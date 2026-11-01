# Work plan for Opus 5.5 (game and product lane)

Written 1 November 2026 by the NEAR-backend lane (Claude Fable). The backend lane owns everything under
`contracts/`, `server/native/`, `server/relayer/`, the testnet deployments and the mainnet path. This plan lists what
the product lane should build on top of it, in order, with the interfaces that already exist. Codex owns
verification and operations (`docs/OWNER-RUNBOOK.md`, CI, device matrix, VPS).

Read first: `docs/STATUS.md`, `docs/CLAUDE-AUDIT-AND-STRATEGY.md`, `DESIGN.md`, `docs/UI-AUDIT-2026-11.md`,
`docs/COPY-AUDIT-2026-11.md`, `docs/ECONOMY-RULES.md`, `docs/RELAYER.md`.

## Ground rules

- Do not touch contracts, relayer policy, manifests or testnet keys; ask the backend lane for new endpoints.
- Every slice: screenshots at 360/390/844×390/1280 in `output/qa/<date>-<slice>/`, `npm run check` green,
  `docs/HOW-TO-TRY.md` updated when a step changes.
- The light clean interface stays; Aavegotchi is inspiration for assets and controls (`src/theme-accents.css`,
  `src/aura-art*.ts*`), not a dark reskin. No eyebrow labels, no chain words in the loop (glossary in the copy audit).

## Interfaces the backend already provides

| Need | Endpoint / module | Notes |
| --- | --- | --- |
| Invisible account state | `GET /api/account`, hook `useInvisibleAccount` (`status`, `accountId`, `signer`) | `status: unavailable` when the host has no relayer |
| Relayed actions | `NativeSigner.send(reviewedTx)` via `resolveSigner()` in `App.tsx` | wallet fallback automatic |
| Native rewards/XP/levels | `/api/native/rewards*`, `/api/native/progression*`, `useNativeGame` | native ledger auto-on when rewards + relayer configured |
| Aura securing | `/api/native/claims*` + `mintEarnedAura` | copy: "Secure this Aura" |
| Staking position | `/api/native/vaults*` (quotes) + relayed `create_position`/`deposit_and_stake`/`request_exit`/`withdraw_owner` | money never sponsored |
| Creator money | `GET /api/native/creators` (pot, policy, open round, my credit), `GET /api/native/creators/quest?quest=`, `POST /api/native/creators/prepare {kind: buy|donate|withdraw, questId, amount}` → reviewed tx for `NativeSigner.send`, `POST /api/native/creators/like {questId}` | quotes carry exact price and the 80/20 split; likes count once per player |
| Public note record | `GET /api/native/records?note=`, `POST /api/native/records/prepare {noteId, kind: note|tombstone, publicConsent, permanenceAcknowledged}` → `set` quote for `NativeSigner.send`, `POST /api/native/records/confirm {noteId, mutationId}` | disclose permanence before the write; media shows `ipfs://` address and pin state |
| Economy facts | `docs/ECONOMY-RULES.md`, `/api/native/economy` | "Today's pot" source |

## Slices in order

1. **Nearest-first and street discoveries (P0).** Recommend the nearest eligible discovery, not the first chest;
   add short XP finds every 150–250 m along the walk from existing coin seeds; cap the "Walk there" teleport in the
   city demo and animate the walk. Files: `src/useAdventureSelection.ts`, `src/App.tsx` (objective card),
   `server/world.mjs` (street finds), `src/GameMap.tsx`. Evidence: a newcomer reaches a reward within 300 m.
2. **Today's pot (P0).** One element on the Explore sheet: funded today, left, source (yield/sponsor); taps open a
   "How rewards are funded" page built from `docs/ECONOMY-RULES.md` and `/api/native/economy`. Keep practice and
   native amounts labelled when the native ledger is off.
3. **Result → Secure → Share (P0).** After the first Aura: "Secure this Aura" (relayed, no popup), then a share card
   PNG (ghost + both slots, name, edition line). Use `src/aura-art*.ts*` and `src/character-art.ts`; render with
   canvas, no new dependency. Prompt "Secure your explorer with a passkey" once after the first secured Aura.
4. **Stake as a game decision (P1).** Profile → "Fuel the city": deposit, choose contribution, see your share of the
   pot and your tier; reuse `NativeStaking` logic but present a city meter, not APY tables. Quotes and relayed
   actions already exist; the UI must show pending/ready/failed states per `DESIGN.md`.
5. **Creator feed and earnings (P1).** Community home = nearby creator places and followed creators; author flow
   limited to visit/trail/chest templates; donate and buy access buttons wired to the creators contract quotes;
   creator earnings view with withdraw. Backend lane provides `/api/native/creators*`.
6. **Notes and profile without popups (P1).** Public profile on NEAR Social from the managed account (relayed `set`
   is already allowlisted); notes/photos UI states; presence and blocks states.
7. **PWA polish (P1).** Install prompt, update toast when a new service worker is waiting, offline state copy,
   icons verified on iOS/Android home screens.
8. **Second-city playbook (P2).** Document the CityPack steps and run a dry run with a second pack.

## Verification each slice needs

Playwright journeys (`output/qa/...`), real iPhone Safari and Android Chrome at least once per slice that touches
the map or GPS, keyboard-open and 200 % text for forms, reduced-motion run, and the HOW-TO-TRY step proven on a
fresh clone.
