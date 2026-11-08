# EU publication continuity — 7 November 2026

PR #215 was owner-approved and merged as `c2ddaf967082588a57a67860251b590958e6790d`.
Its funding-input refresher is installed at a fifteen-minute interval. A manual
apply-mode replay kept the game process unchanged; subsequent scheduled runs
independently reconciled the three finalized funding receipts. Sponsorship and
realized yield remain separate. QGOLD proposal 2 is still timelocked; no monetary
Atlas activation or signing operation was performed in this continuation.

## Publicly loaded next day

November 8 is fully loaded **8/8** by the public testnet: **57 polygon zones and
734 quests**, in supplied regions of France, Luxembourg and Spain. It opens at
00:00 UTC / 01:00 Prague. Eight isolated runtime visits passed distance rejection
and durable replay acceptance; the test treasury was unchanged. These are simulated
GPS checks, not physical-device or field verification. Atlas coins, NPCs, chests
and collectible stock remain absent, and monetary activation remains off.

Manifest SHA: `f17c4708b36f445e259d602c0283d3261b41e3dbea62831602037a4ceeb1d5be`.
Input hash: `1d6826f60a9f5918435a48b8360dd86fc05b28f169a652952fb4bfec9819fa77`.
The November 7 manifest remains unchanged. Public IPv4 HTTPS from the developer
machine and independent VPS HTTPS both confirmed readiness after one local
Python TLS timeout. See [observations](observations.json).

## Continued operation

The collector's `--prepare-only` mode finalizes accepted input without starting
new extraction, planning or export work. Its regression uses an unusable pending
source and proves that a new immutable day still prepares without incrementing
that source's attempts or scheduling turns. Scope/context checks stay in force.

The supervisor prioritizes publication from 23:00 UTC, with a 55-minute bounded
slice. Heavy steps retain their 20-minute limit and require 9 GiB free. Publication
uses the available headroom while retaining the 8 GiB service floor, memory and
process gates. Its initial disk allowance includes 128 MiB for bounded output.

A scoped fifteen-minute retention job starts below 12 GiB free and handles at
most twelve files per pass. It retains completed EU-work GeoJSON sequences as
lossless gzip, verifies original/archive/decoded hashes, fsyncs the copy and
restoration receipt, then releases only redundant plaintext. Existing game index
reads keep their own chunk-hash checks. Raw PBFs, shared indexes, source audits,
normalized selected geometry, published days and MapOS are untouched. Pause
retention during intentional restore/re-extraction, then resume after sealing.

The observation records **137/141 EU acquisitions**, 49 retained sequences,
3.068 GiB reclaimed and 10.092 GiB free. It does not assert complete EU coverage.
A larger work volume remains necessary for broad continued processing; +100 GB
is an initial planning step, not a measured upper bound.

## Verification and presentation

- `npm run check`: 1,527 application tests and 1,345 safety-pass tests; 19 existing skips.
- Focused publication, geometry-index, supervisor, retention and wiki checks pass.
- Retention regressions cover exact recovery, replay, corruption, source changes,
  disk-floor refusal, raw-PBF exclusion and read-only shared-index boundaries.
- Wiki captures at 360/390 px, 844×390 landscape, desktop and 125% CSS zoom show
  no sideways overflow. No form or keyboard-open state changed. Physical iOS and
  Android remain unverified. Screenshots and report are in [wiki](wiki/).

| Before: source finding | After: observed result | Why |
| --- | --- | --- |
| `server/world-preparation/collector.mjs` selected heavy source work before finalizing days. The same low-disk stop could prevent ready data reaching the game. | Publication-only mode produced and publicly loaded the complete eight-owner day while retaining scope and safety checks. | Already verified content can become playable while additional acquisition waits. |
| `src/wiki/chapters.ts` omitted this resource-wait behavior. | Existing paragraph now explains that checked regions can form the next day; five local viewports have no sideways overflow. | Keep the player's understanding of coverage accurate. |

No keys, live database, player histories, CI/dependency changes, money-policy
changes or contract changes are included. Source changes affect the isolated
Agent Zero worker; the public application build remains `f984e6b` and consumes
its validated data through the existing loader.
