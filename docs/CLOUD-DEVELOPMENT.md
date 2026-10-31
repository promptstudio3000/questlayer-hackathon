# questlayer-hackathon: cloud development and source checkpoint

The canonical project and repository name is **questlayer-hackathon**. The player-facing brand is **QuestLayer**. This source checkpoint includes the complete current local implementation, roadmap, tests, artwork provenance, evidence and whole-project handoff. It does not complete the open roadmap milestones.

## Start immediately

1. Open https://codespaces.new/promptstudio3000/questlayer-hackathon and create a Codespace from `main`.
2. Wait for the development container to install Node.js 24 and run `npm ci`.
3. Run `npm run dev` and open the forwarded **5173** port. Keep its visibility private unless you deliberately want to share the preview.
4. Run `npm run check` before delivering changes. Continue from [ROADMAP.md](../ROADMAP.md), [development status](DEVELOPMENT-STATUS.md), [whole-project handoff](PROJECT-REVIEW-AND-HANDOFF.md) and [AGENTS.md](../AGENTS.md).

The browser UI and `/api` requests share the Vite preview origin. The API remains bound to loopback port 8787 and is not separately forwarded. The development launcher derives the exact HTTPS origin from GitHub's `CODESPACE_NAME` and `GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN`; it does not disable origin checks or allow arbitrary preview hosts. An explicitly supplied `APP_ORIGIN` remains authoritative. Do not copy a localhost `.env` into Codespaces without adjusting that origin. Passkeys belong to their origin and are not portable between arbitrary preview URLs.

The container disables native attestations, background financial workers and optional creator content by default. Basic solo demo play needs no wallet, private key or deposit. Native wallet-signed testnet interactions remain explicitly separate capabilities; a preview does not acquire an operator signer. Optional creator development requires deliberately setting `CREATOR_COMMUNITY_ENABLED=1` and restarting the API.

Other cloud coding environments need Node.js 24+, `npm ci`, and `npm run check`. The container is optional. For a remote interactive preview outside Codespaces, set the actual `APP_ORIGIN` and use a deliberately configured private forwarding mechanism. Do not publish SQLite, `.env`, runtime configuration, wallet/operator credentials or `.data`.

GitHub Actions runs application tests and the TypeScript/Vite build on pushes and pull requests. Rust contract verification remains a separate check: `npm run test:contracts` requires Rust and the documented WASM toolchain. The Node development container does not install the full Rust toolchain.

## Naming and compatibility

New package metadata, development environments, database defaults, VPS service templates, release archives and deployment target directories use `questlayer-hackathon`. New Rust build artifact names use `questlayer_game.wasm` and `questlayer_collectibles.wasm`. The browser issues a `questlayer-hackathon` session cookie.

Historical documents/proofs and already deployed NEAR account IDs may still contain the former name. These are historical facts or immutable external identities, not another active project. In particular, existing native account IDs and the already emitted game event protocol are preserved; renaming those strings would break verification or consumers. New integrations must not invent replacement account IDs without deploying and verifying them.

An existing local `.data/auratrail.sqlite` remains authoritative if the new filename does not exist. If both filenames exist, startup refuses ambiguity unless `DATABASE_PATH` is explicit. The award signer resolves beside the selected database. Existing session cookies remain readable; new sessions use the new cookie, and logout expires both names. Backups accept one unambiguous current or legacy state database. These bridges preserve player state rather than silently creating a new world after a naming change.

## VPS boundary and required migration

This is a GitHub source publication and cloud development setup, **not a VPS deployment**. The previous [review snapshot](PROJECT-REVIEW-SNAPSHOT.json) remains dated evidence of the pre-publication working tree and public runtime, not the current GitHub head.

New deployment templates target `questlayer-hackathon.service`, `/opt/ps3000/apps/questlayer-hackathon`, `/var/lib/questlayer-hackathon` and `questlayer-hackathon.sqlite`. The application deploy script refuses a host containing the old application directory, state directory or service unit. Maintenance and native-worker installers must only be used after the same reviewed migration. None of these scripts was executed as part of publication.

Before a future VPS release: stop coordinated writers; capture and verify a private consistent snapshot; migrate the existing database, referenced media, signer files and private configuration with their permissions; migrate service and backup paths; preserve passkey origin, account identities and native obligations; stop/disable the old unit; verify exactly one application and backup owner; rehearse rollback against the same state; then activate the reviewed release and verify health, sessions and durable results. Never launch a second empty database or copy signing keys into this repository. This migration remains an explicit future operations task.

## Verification limits

The local source checks and cloud-origin smoke test are recorded at publication. A real hosted Codespace is not created automatically, and container image provisioning, forwarded-port authentication and physical mobile devices still require checks in that environment. A GitHub repository is a source handoff, not production application hosting.

Sources: [GitHub Codespaces environment variables](https://docs.github.com/en/codespaces/developing-in-a-codespace/default-environment-variables-for-your-codespace), [forwarding ports](https://docs.github.com/en/codespaces/developing-in-a-codespace/forwarding-ports-in-your-codespace), [official development container features](https://containers.dev/features).
