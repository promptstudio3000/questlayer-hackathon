# Startup and release reliability

## Map loading and failure containment

The React application shell and its wallet/inventory controls now start independently of MapLibre. `DeferredGameMap` loads the actual map module with a readable loading state. A map import or React-rendered map failure is contained in a local error boundary. The user can still use the other panels and explicitly reload the game. No automatic reload discards a draft or interrupts a wallet request.

Short marker updates between 0.4 and 80 metres interpolate for 450 ms. Tiny fixes, long moves and reduced-motion mode snap directly. Animations stop at their exact target, have no idle frame loop, and cancel on replacement or unmount so a delayed frame cannot overwrite a newer location. This affects only the visual marker; server validation continues to use the actual location fix. It does not establish GPS accuracy or fraud resistance.

The optional globe uses a dedicated viewport in the space left by the game panels, with zoom bounded by the available size. Entering it returns to the compact explorer panel. Leaving it resizes the map back to the full game viewport, preserves the library's required root class and restores the character. The toggle exposes its pressed state. Desktop, portrait and short-landscape frames were visually checked; map credit text remains visible.

Final visual review caught a late-loaded library stylesheet overriding a same-specificity map rule and collapsing the map to zero height. The container now has a protected selector. The actual desktop canvas measured 1280×720 and the public browser canvas 512×792 after correction, with visible streets and the character; returning from globe restored the full dimensions. See `map-geometry-review.json` and before/after screenshots in the evidence directory.

The entry JavaScript changed from approximately 1.52 MB / 423 KB gzip to 441 KB / 129 KB gzip, a roughly 71% reduction in uncompressed entry bytes. The first CSS file changed from 129 KB to 58 KB. The complete map still downloads a separate approximately 1.08 MB engine chunk, 71 KB stylesheet and 519 KB worker. The 3D wardrobe remains a separate optional chunk. These are measured build sizes, not claims about physical-device load time, battery use or frame rate.

Evidence is in `output/qa/W12-startup/`, including the actual previous public entry's byte count and digest. A development-only intentional map-failure fixture confirms a readable failure, a reachable keyboard-focused reload button and another working control at 360×640 and 844×390 with enlarged text. It does not simulate an actual hardware GPU or network failure.

## Open tabs across deployments

Lazy wallet, EVM and 3D modules may be requested long after the initial page load. An open page can still refer to a previous release's hashed filename. Deployment therefore retains public build assets under `/opt/ps3000/apps/auratrail/assets` and configures the server's `STATIC_ASSET_DIR` to use this pool as a narrowly scoped fallback.

`deploy/retain-static-assets.py` copies only regular, hash-named public assets from release `dist/assets` directories. It never copies `.data`, account credentials, runtime settings, databases, upload folders or application source. Publication uses atomic replacement for new files; an existing hash with different contents aborts deployment. The pool has a 256 MiB budget and 32 MiB single-file limit. Current and five recent releases are protected; unreferenced files expire after seven days. A failed application activation retains the previous release and its referenced files.

Static resolution checks both lexical and real paths, rejects private dot paths and escaping symlinks, and permits only recognized hashed filenames in the shared fallback. Current/retained hashed files have immutable cache headers. Page HTML must be revalidated. Missing JavaScript, CSS or other file requests return 404 instead of receiving SPA HTML. Content streaming failures cannot become unhandled file-stream exceptions.

This is deployment compatibility for online clients. A service-worker offline map cache, full PWA update workflow, physical-device profiles and native iOS distribution remain W12 work.

## Verification boundary

- 83 application tests passed, including retained-file resolution, traversal and symlink rejection, changed-content refusal, expiration with protected releases, and actual HTTP missing-asset status.
- Native contract tests are unaffected by this increment; the prior 38-test contract suite remains the recorded contract verification.
- Deployment still makes a consistent SQLite backup, preserves the domain/service configuration and attestor backup, and can restore the prior release and database on a failed activation.
- This work does not enable native staking deposits, change demo balances or publish private player information.
