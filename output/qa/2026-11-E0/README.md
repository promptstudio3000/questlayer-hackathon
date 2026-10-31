# E0/E1 evidence, 1 November 2026

- `tests-baseline.txt`: first run on the published checkpoint, Node 24: 488 tests, 487 pass, 1 fail. The failure was
  `GET /` → 503 in the HTTP integration test because `dist/` did not exist yet (`npm run check` ran tests before build).
  Fixed by building first in `package.json` `check`; the test passes with `dist/` present.
- `build-baseline.txt`: Vite/TypeScript build passed.
- Rust: `cargo test --workspace` in `contracts/` passed (exit 0; two dead-code warnings in market).
- `tests-after-e1.txt`: 490/490 after the E1 shell changes and new relayer round-trip tests.
- `ui-before/`: screenshots of the checkpoint UI at 390, 360, 844×390 and 1280 widths (Chromium, map tiles blocked
  in the audit environment, so the map shows its slow-loading notice).
- `ui-after/`: the same screens after E1 (name → Start exploring; four tabs; no realm switches, footer, legend or
  guide bubble on the map; human distances; Profile with Advanced disclosure).

Not verified here: real phones, map tiles, GPS, wallets.
