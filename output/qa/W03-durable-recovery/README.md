# Durable receipt recovery — browser review

31 October 2026. The `/dev/native-pending.html` fixture uses synthetic receipt references, an isolated fixture player and no wallet/network transaction. These screenshots are browser observations, not evidence of a real account balance or a signed transaction.

## Observed

- A receipt survived closing its previous fixture tab and opening a fresh tab.
- Two open tabs showed the same record. Confirming it in the second tab removed it from the first without reloading, through the storage event.
- A missing-hash record exposes manual lookup, reviewed terms, requested date and the legacy checkpoint warning. Confirmation stayed disabled without a hash.
- The compact backup disclosure exposes export/import only when relevant. A wrong-player JSON import was rejected and the original receipt remained (subagent browser observation).
- After confirmation, focus returned to the recovery heading. Enlarged 32px body text reflowed without horizontal overflow at 390px.
- The deployed Wallet loaded in guest mode. Recovery controls were correctly absent for an unlinked guest. No personal wallet was connected.

| Review | Evidence |
| --- | --- |
| Small mobile, DOM 360 × 640 | [Missing receipt](missing-360.jpg), [layout measurements](layout-360.json) |
| Mobile 390 × 844 | [Pending receipt](pending-390.jpg), [backup disclosure](backup-390.jpg) |
| Landscape 844 × 390 | [Missing receipt](missing-landscape.jpg) |
| Desktop 1280 × 720 | [Missing receipt](missing-desktop.jpg) |
| Enlarged text, mobile 390 × 844 | [32px text](enlarged-390.jpg), [measurements](enlarged-layout.json) |

Controls inspected in the standard mobile view have 48px minimum targets, body text 16px and secondary text 14px. Screenshots may show only the current viewport; vertically scrolling content is expected. Browser temporary tabs were closed, viewport overrides reset and synthetic pending state cleared after review.

## Limits

The export click reported “Receipt download started”, but the browser automation download event stalled. The actual saved file and a successful export-to-file/import-from-file roundtrip were **not independently verified**. Unit tests cover serialized export content, bounded input, identity checks and merge behavior. Do not interpret the download notice as filesystem proof.

Physical keyboard, physical Safari/iOS and Chrome/Android, GPS walking, personal wallet return and independent passkey recovery were not tested. The enlarged-text fixture is a CSS text reflow test, not a physical-device accessibility setting. See [browser-summary.json](browser-summary.json) and the [combined implementation report](../W03-W13-durable-recovery/README.md).
