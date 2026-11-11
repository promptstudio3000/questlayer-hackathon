# Release-candidate checklist (testnet)

1 November 2026. Roadmap W13. Testnet only: nothing here approves a mainnet
action or real money. Tick each line with evidence (a command output, a file
under `output/qa/`, or a link). A line without evidence is not done.

## 1. Fresh clone gates (cloud or any machine, no keys)

- [ ] `npm ci && npm run check` passes (all tests plus the production build).
- [ ] `npm run pilot:city` prints `"status": "passed"`. It is the three-day
      rehearsal described below; it needs `python3` and nothing else.
- [ ] `node scripts/run-world-pilot.mjs` passes (map outage, DST, closures,
      demo treasury conservation over three days).
- [ ] `bash scripts/build-contracts.sh --test` passes (contract unit tests, in CI).
- [ ] `git status` is clean and the branch head is the commit you deploy.

### What the three-day city pilot proves

`server/qa/city-pilot.mjs` runs the real database, reward worker, distribution
audit, `deploy/backup-state.py` and `restorePreflight` against a stateful
double of `contracts/rewards` (same guards: one claim per coin and personal
zone, idempotent receipts, signed attestations, grace period, per-date caps,
ledger conservation).

| Day   | Step                                                                             | Expected                                                                                                                                                   |
| ----- | -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1     | Worker publishes today and tomorrow; two players collect coins and a free zone   | 3 receipts confirmed, audit `verified`                                                                                                                     |
| Night | Worker publishes day 3 after local midnight, then the backup runs                | snapshot holds every published manifest and the attestor                                                                                                   |
| 2     | Worker A stalls after the chain accepted a claim                                 | lease expires; worker B confirms from the chain receipt with no second transmission; A's late reply is fenced out (`lease expired`) and cannot overwrite B |
| 2     | Live database is lost; the night snapshot is restored into a new state directory | checksum and preflight pass, same attestor public key                                                                                                      |
| 2     | Players retry finds the chain already paid after the snapshot                    | refused with `NATIVE_RECONCILING`; nothing is queued, chain balances unchanged                                                                             |
| 3     | Normal play                                                                      | 3 new receipts confirmed                                                                                                                                   |
| Night | Days 1 and 2 pass their grace period                                             | both closed, reserves released, audit `verified`, `reconciling: []`                                                                                        |

Totals: chain receipts equal claim transmissions (no duplicate send), zero
contract refusals of a server transaction.

### Defect found and fixed by the pilot

After a restore the database lacks claims the chain accepted after the
snapshot. Before this release the restored server accepted those finds again
with a new receipt id; the contract refuses them (`Coin already claimed` /
`Quest already completed`), and because the worker settles oldest first, that
one refused claim blocked every later claim of every player. Now:

- `submit` refuses new native claims on a day where the chain's accepted count
  exceeds the local rows (`503 NATIVE_RECONCILING`). In normal operation this
  can never happen, because every chain claim starts as a local row.
- The distribution audit lists such days under `reconciling` (also in the
  `/api/health` summary). It is not drift: the chain ledger is intact and new
  days still publish.
- The browser auto-collector treats `NATIVE_RECONCILING` like a pause instead
  of retrying.

Known cost: an accepted but never transmitted claim is lost with the host
(the pilot's Bob loses one coin on day 2). The frozen day stays closed to new
native claims until it ends; play continues on the next day.

## 2. VPS release (needs the Mac and Remote Control)

- [ ] Back up the live database first (`questlayer-state-backup.service`), note
      the snapshot id.
- [ ] Deploy with `scripts/deploy-vps.sh`; `/api/health` reports the new build.
- [ ] `/api/health` native audit is `verified` and `reconciling` is empty.
- [ ] Worker lease shows a recent `last_success` and no `last_error`.
- [ ] `node deploy/rehearse-restore.mjs` (and `--native` on a drained queue) on
      the newest snapshot prints `"status": "ok"`.
- [ ] The backup timer runs after local midnight publication (03:20 UTC is
      after 00:00 Europe/Prague). If you move it, keep it after midnight, or a
      restore can miss the manifest of the day published that night and the
      worker stops publishing ("Published native day has no durable manifest").

## 3. Live testnet observations (cannot be simulated)

- [ ] Three consecutive local days published and closed on the rewards
      contract, each closure releasing its reserve (W13.2).
- [ ] At least two real vault exit cycles observed (W13.2).
- [ ] One end-to-end native claim from a real phone with GPS and a wallet
      (device gate, after the whole game is built).
- [ ] Explorer links for one publish, one claim and one close recorded under
      `output/qa/`.

## 4. Before calling it a release candidate

- [ ] Test world removed: delete `Environment=TEST_SEED=1` from
  `deploy/questlayer-hackathon.service`, deploy, and `/api/health` shows
  `testSeed: {"status":"off"}` (see `docs/TEST-SEED.md`). Mainnet never runs it.
- [ ] Demo zones off: delete `Environment=DEMO_ZONES=plzen-compact` from
  `deploy/questlayer-hackathon.service`, deploy, and `/api/health` shows
  `demoZones: "off"` (zones back citywide with their countdown, see
  `docs/DEMO-ZONES.md`).
- [ ] No open release-blocking defect (W13.5).
- [ ] README judge path works on `questlayer.promptstudio3000.com` in a fresh
      browser profile.
- [ ] Account table in README matches the live testnet generation.
- [ ] Mainnet stays a separate, explicit owner decision (docs/MAINNET-PLAN.md).

## Limits of this checklist

The rehearsal uses a chain double, generated keys and synthetic GPS on one
disk. It is not a testnet transaction, a device proof, an offsite backup or a
host replacement. Those stay in sections 2 and 3.
