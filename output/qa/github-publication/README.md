# questlayer-hackathon GitHub source publication

Date: 31 October 2026. Scope: preserve the complete local source, publish the explicitly requested public GitHub repository, establish the canonical name and prepare cloud development. No VPS service, database, key, account or chain state was changed.

- `npm run check`: **488/488 application tests passed**, followed by a successful TypeScript/Vite production build.
- Offline release WASM build of the full Rust workspace passed with the renamed game/collectibles artifacts.
- Rust workspace tests after crate/artifact relabeling: **100 passed**, zero failed. Contract event protocol and existing NEAR account identities were preserved.
- Isolated Vite/API cloud-origin smoke: HTML and API forwarding, HTTPS-origin session, new session-cookie authentication, legacy-session continuity, rejection of a foreign origin, expiry of both cookie names on logout, and rejection of the revoked session all passed. Temporary test state was removed. This was a local forwarding simulation, not an actual hosted Codespace.
- `bash -n`: app deploy, maintenance and native-worker installer syntax passed. No installer/deployment script was executed.
- Common high-confidence credential-pattern scan: **1,020 working files and 1,384 historical Git blobs**, zero matches. This bounded scan is not a guarantee against every possible secret format. Existing private state, credentials and `.env` are excluded from Git; additional database/archive exclusions were added.
- Existing state-path continuity and ambiguous-database rejection are covered by an isolated temporary-state test. Native finance, wallet ownership, XP and reward accounting policies were not changed.

GitHub Actions runs `npm ci` and `npm run check`. The actual hosted container build, Codespaces account access/forwarding and physical mobile-device checks remain unverified. See [cloud development](../../../docs/CLOUD-DEVELOPMENT.md) for setup and the separate VPS migration boundary. Historical review evidence remains dated and is superseded only by explicit newer evidence.
