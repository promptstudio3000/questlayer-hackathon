# Global release continuation — 7 November 2026

## Current public release and operations

PR #211 was merged and source `f984e6b212e179aed5ede8fce1d8097be068e944`
is public. The validated two-owner EU day contains ten polygon zones and 277
quests; it is playable with personal XP. Monetary Atlas activation is disabled.
Rewards is upgraded and its bounded worker permission extended, with unchanged
treasury/configuration at the operation boundary. All received funding has been
reconciled against finalized receipts, with sponsorship and realized yield separate.

QGOLD proposal 1 was cancelled after newer owner changes were merged. Proposal 2
preserves those changes and exact world carry; its actual-WASM tests pass. Its
48-hour timelock ends November 9 at 17:21:10.054 UTC. No QGOLD code has yet changed.
The earliest possible new monetary UTC day remains November 10.

See `docs/GLOBAL-REWARD-INTEGRATION-HANDOFF.md`, `runtime-20261107/` and the
public-only operation journal `world-reservations/owner-operations.json` for
current proofs, helpers, exact hashes, rollout gates and remaining limitations.
The signer wrapper refuses artifacts that differ from current canonical pins.
Its WASM inputs are reproducible build artifacts, intentionally not committed:
download `contract-wasm-linux-amd64` from CI run 42388575618; verify the hashes in
`runtime-20261107/current-artifacts.json`; place Rewards at
`world-reservations/questlayer_rewards.wasm` and current QGOLD at
`world-reservations/questlayer_qgold-current.wasm`. Never use the old proposal's
QGOLD binary. Operator keys stay at the owner's existing private location.

The publisher is installed; the funding refresh is prepared and dry-tested,
pending the follow-up protected-path review. The supervisor recovery repair is
installed for subsequent Agent Zero runs; its offline regression covers dead and
changed writers, repeated timeouts, resource pauses and preserved accepted data.

## Historical continuation before public rollout

The isolated EU collector repair is installed. Public application/contract
activation has **not** happened. Current source includes exact UTC financial
reservation and account-bound NEAR carry, independently gated by finalized
contract observations; earlier "unfinished source" notes below are historical.

- EU acquisition advanced to 90/141 selected extracts at 14:45 UTC. Content status
  advanced at 14:49 UTC; four owners were current for their neighborhood context.
  This is incomplete coverage, not all of Europe. Stored older owner outputs and
  all non-EU inputs remain preserved.
- The immutable November 7 day contains two owners, ten actual polygon zones and
  277 quests. Its exported archive SHA-256 is
  `203e0dce9872c64c61fd371246beccfb0deee0a5a81e4c2bef3d7ca0cce4a25b`.
  `eu-browser/report.json` records actual local HTTP/GPS/browser checks against
  those bytes for France and Luxembourg. Its financial state is explicitly off.
- Source-specific geographic context prevents distant downloads from resetting
  every plan. Libosmium uses two threads. Low process headroom persists a resumable
  wait. Missing restricted geometry remains unavailable, never silently omitted.
- Agent Zero's UI leaked 219 `git cat-file` helpers. Only idle helpers belonging
  to that exact UI were stopped; its existing scoped guard subsequently restored
  the UI. Four read-only helpers now close Repo in `finally`. Sixty real reads in
  the correct environment left zero Git helpers and 55 container tasks. The
  hash-checked five-minute lifecycle guard preserves only this reviewed repair;
  future upstream changes require review. MapOS and all collected data are intact.
- 71 Rewards and 30 QGOLD Rust tests pass. `world-reservations/sandbox-report.json`
  records ten passing actual-WASM scenarios, including world reservation and
  exact carry. Artifact hashes, unsigned owner proposal and disabled configuration
  template are in that directory. No real key or public chain write was used.
- Public read-only checks still identify the previous app/Rewards/QGOLD builds.
  QGOLD's finalized config has one council member, threshold one, the existing
  Rewards minter and a 172800000 ms upgrade timelock. Ordinary transaction-history reads
  timed out; archival RPC then confirmed the 0.2 test NEAR sponsor event. The
  adapter now uses cached archival proofs. Complete yield provenance remains a
  positive-activation gate.

The owner-only PR label, green CI/merge, actual contract upgrades, received-funding
reconciliation and a read-only mount of `eu-days` are required before public
release. See `docs/GLOBAL-REWARD-INTEGRATION-HANDOFF.md`. Physical iOS/Android field
tests and target-scale performance remain unverified. Coins and collectible stock
are not implemented by the Atlas runtime.

### Observed interface review

| Before (source) | After (implemented/observed) | Why |
| --- | --- | --- |
| Global activities had only a fixed XP-only notice | Real EU package still shows XP-only notice; separately activated days have fixed-NEAR/QGOLD settlement wording | A prepared map is not proof of funding |
| Quest output did not carry exact NEAR provenance | Server-confirmed receipts retain source, UTC day, exact amount and conversion state | Reconnects and retries must preserve financial rights |
| New arrivals could use existing local generation paths | Configured Atlas regions read one immutable pre-imported day | Arrival cannot create extra zones or budget |

Observed EU screenshots cover 360/390 px, short landscape, desktop and enlarged
text with no reported horizontal overflow. Funding-specific copy is compiled and
covered by server/state tests; its public hardware journey is not verified.

The owner explicitly authorized testnet finance/contract integration and public testnet deployment. Mainnet and reading/disclosing keys remain excluded. No public game or contract deployment has been performed. The public Rewards code hash still matches the vulnerable original callback build (see rewards-code-hash.json).

## Checked in this continuation

- Full npm run check: 1340 application tests passed; 1171 safety tests passed, 19 skipped. The first confined run failed to bind loopback ports; the subsequent approved local-network run passed. Logs: /tmp/ql-global-release-check-approved.log.
- 19 payout recovery/worker tests passed. Repaired source exactly matches the previously audited patch. Rebuilt with the pinned Docker image into /private/tmp/ql-global-rewards-rebuild-20261107; Rewards SHA 3a31a1370a3a3bcff34a46adf84061119e530c4b28a618099dcc9eb415c7a4ad, QGOLD unchanged. Nine actual-WASM sandbox scenarios passed again; report payout-sandbox-20261107.json. Bytecode pin updated; public deployment records truthfully remain old, with the explicit testnet old-build exception. No keys, transaction or live database involved.
- Later launch-scope optimization passed its two focused tests and wiki checks. No dependencies or CI edits. Wiki stamped.
- Full-source real Luxembourg extraction/index completed in 263.6 seconds under the 512 MiB Node heap supervisor. Strict extraction audited/quarantined 7 unusable unrestricted POI area relations and 1 unrestricted exclusion candidate; restricted grounds fail closed. Original PBFs retained. This is not target-scale performance evidence.
- The new geographic collector accepted an actual Mauritius owner with 3 zones and 36 quests after isolated runtime verification. Other owners and border context remain incomplete. The previous pilot 2026-11-07 day (11 zones/60 quests) remains preserved separately.

## Running Agent Zero automation

Host task root: /opt/prompt-studio/data/agent-zero/usr/workdir/questlayer_task.
Container task root: /a0/usr/workdir/questlayer_task.

- global-acquisition-reviewed/state/launch-scope.json now pins the owner selection: full European and US extracts, capitals elsewhere, excluding RU/KP/IR. Policy hash 11571ff2338ebad301a589d0b0c96cf730e0d0bb4a7a63a4b7d80c13aa37babf; 385 source extracts, 238 GeoNames capitals, 11 unmapped capitals explicitly listed. Official source labels are not borders; geometry matching supplies joint extracts including Singapore/Brunei. Older acquired sources outside selection retained, future downloads filtered.
- global-source-candidate/source holds the current world modules plus the separately copied optimized launch-scope.mjs. Per-file candidate-source.json hashes are the authority. The packaged archive was refreshed locally after the copy, so its latest archive hash is not the older remotely transferred archive hash.
- global-source-candidate/config.json uses launch-scope-v3.json and maxStepsPerRun=4. Supervisor keeps its 8 GiB disk floor, 512 MiB heap and exact-child-group interruption. No model polling.
- /etc/cron.d/agent-zero-playable-world-collector now launches the verified full-source collector every two minutes. Its flock prevents overlapping runs. Prior cron content is backed up at playable-collector-reviewed/cron-before-full-source.txt; all prior content/output files preserved. MapOS and unrelated services unchanged.
- Work state/status/coverage and worker/run-status logs are below global-source-candidate/work. The pilot source work directory is intentionally separate from the previous bounded-core collector. Do not mix policies in one work directory.
- A timed-out unoptimized scope build left container PID 784244; it was terminated only after its exact script/output arguments matched. The optimized scope build finished successfully. No broad process kills.

## Remaining required work

Selected scope is incomplete and never reports whole-planet readiness. New data cannot silently expand a published UTC day. The current prepared activity adapter remains zero-money/zero-stock; coins, NPCs and chests are not implemented in that runtime. Whole-day confirmed on-chain reservations, exact earned NEAR dust with source/bucket carry, payout reservation transfer without a second cap charge, existing Plzen obligation reconciliation, current-rate QGOLD conversion and inventory reservations remain unfinished. The local payout repair is necessary but does not supply these missing operations. Do not present this as globally funded public gameplay.

Before public activation: complete/mount a validated intended inventory; resolve border neighbors and unmapped capitals; address dateline contexts and large root/state manifests; measure full target volume and retained daily geometry storage; verify pending/accepted quest rollover; ship the matching repaired Rewards contract through an authorized opaque signing flow; all release/CI checks, owner-only approval label and physical iOS/Android field checks still apply. Never open runtime.env or signing keys.

Storage remains a blocker for broad retained processing: approximately 31 GiB free on the current VPS, 8 GiB reserved. Planning recommendation is 250 GB usable SSD minimum for the selected footprint, 500 GB margin, approximately 1 TB for retained planet processing. These are estimates. An object bucket is useful for archived inputs/published compressed packages but is not a replacement for the local working SSD or the live transactional player/reward database.

## Active scope superseded: EU-first

The owner's latest instruction restricts active collection/preparation to EU member states before expanding elsewhere. The prior 385-source global-launch policy is preserved but inactive. See eu-activation.json and DATA-COLLECTOR-EU-FIRST.md. Active policy hash: fdc306cee56d26eb7fb1cd627f392e28a9ff9acd52283ad06fc99c23cffc0988. It selects 141 official leaf extracts covering all 27 member-country codes and preserves Cyprus despite the Asia grouping. Acquisition and content planning use the same hash. Source coverage is still incomplete; a source list is not readiness.

EU preparation now uses global-source-candidate/eu-work and eu-days. Eligible prior source-index checkpoints were reused without replacing original global work/output files. Existing cron entries continue autonomously using the updated config. The previous exact supervised Node child group was interrupted only after command/group identity checks; partial source files and all earlier outputs were preserved. DATA-COLLECTOR-EU-FIRST.md was delivered into the Agent Zero shared task root. Browser chat was on a login page; no chat acknowledgement is claimed and no additional model loop was started. The operational worker configuration was changed directly through the authorized SSH scope.

Observed first post-switch bulk completion: Belgium, 698760289 bytes; heartbeat reported 3 of 141 selected sources acquired. EU content worker was in Luxembourg region preparation. Both policy hashes matched; 8 GiB free-space floor remains. Acquisition pauses at EU queue completion and never widens automatically. All new EU geographic tests passed (13 Node tests and 8 Python acquisition tests); complete npm run check passed 1341 application tests and 1172 safety tests, with 19 existing skips. No new public game, rewards or Cloudflare deployment was performed in this scope change.

## Final local checks for this candidate

`npm run check` passed: 1349 application tests; 1180 safety-pass tests with 19
existing skips. No test, dependency, budget, CI or owner-label rule was weakened.
The testnet-only reward flows explicitly refuse financial activation in the
mainnet guard pass. `e2e:first-session -- --device=phone-390` passed, all 11
languages passed browser checks, and all 2938 translation keys are covered with
zero unused keys. Financial-specific public/hardware journeys remain unverified.
New world mint receipts used at most 2.782 Tgas in the local fixtures, within the
existing 14 Tgas child allocation; this is not a maximum-volume gas guarantee.

The proposed read-only service mount is `eu-game-mount.proposed.conf`. It would
connect future validated collector days directly to the game loader without a
separate manual upload. It has **not** been installed. Rollback compatibility and
received-funding history remain release gates in the owner handoff.
