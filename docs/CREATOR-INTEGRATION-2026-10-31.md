# Creator services combined with durable native recovery

31 October 2026. Receiving baseline: `0ff170b3a3ceb0cd6020001efc8e38e16736d76b` (`Harden native receipt recovery, worker leases and backup consistency`). The other chat completed its turn before this integration. Its source changes were brought into the isolated creator worktree with a fast-forward, preserving the creator additions.

## Result

The combined local source contains durable native wallet recovery/worker/media-backup changes from the other chat, plus the creator lifecycle, XP commitments, profiles, free follows, protected read projections and optional player/server adapters from this chat. No wallet, contract or application entry-point edits were made by the creator slice. Shared roadmap/gap notes now distinguish the local source foundation from deployed behavior.

The creator API is **not mounted or enabled**. Ordinary gameplay still has no creator publication locks. The deployed application remains the separately verified `0ff170b` version; this local merge does not deploy the creator services, mint rewards or change the current economy.

## Evidence

- `output/qa/W08-creator-combined/tests.txt`: **343/343 application tests passed**, zero failures/skips.
- `output/qa/W08-creator-combined/build.txt`: combined TypeScript/Vite build passed.
- `output/qa/W08-creator-combined/creator-tests.txt`: **44/44 creator tests passed**, including real local HTTP upload interruption/limits and concurrent SQLite publication/retry/cancellation cases.
- The creator working copy was advanced to the exact completed native-recovery commit before these combined checks. Existing unrelated untracked map research/concepts in the main checkout are excluded from the creator commit and merge.

No contract source changed in this slice; Rust tests were not rerun. No new dependencies, signing keys, production database writes, chain operations or deployment were needed. The existing physical-device, account-recovery, staking/yield, canonical Intents and creator UI/native integration gates remain open.

## Next complete player slice

Use [the Community handoff](CREATOR-COMMUNITY-HANDOFF.md) and [lifecycle details](CREATOR-LIFECYCLE-HANDOFF.md). Select the versioned XP policy, compose the actual host session/roles, wire all relevant level reads to available XP while preserving once-only rewards, build the Community editor/discovery/participation interface and integrate authoritative activity validation/receipts. Rehearse migration/restore and governance before enabling routes. Paid access, sponsored payouts and native XP rights need their own implemented obligations; this adapter does not represent them.

Source integration and the W08 acceptance gate remain separate. W08 stays **building**; screenshots/device playtests and live native creator rights are not established by this merge.
