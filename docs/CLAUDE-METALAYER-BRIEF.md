# MetaLayer: Claude continuation brief

Review branch: `weekend/m1-metalayer-first-expedition` → `claude/upbeat-gauss-5czir7`.
Baseline: `18dffa97`. **Do not change production or merge automatically.**

The owner wants QuestLayer's platform adapted to a shared Minecraft-like world,
with the current QuestLayer UI and minimal phone chrome. This branch is a playable,
nonfinancial candidate, not completed onchain integration.

Implemented: shared plaza/building, two mine types, server-timed extraction, ten
natural diamonds, an authored five-chapter story, shared finale/atlas, physical
Keeper Nera and quest boards, an independent place-discovery tour, demo explorers,
durable local receipts and a strict disabled-by-default read-only NEAR verifier.
The visible golden vault explicitly says **Treasury inactive**. No MetaGold,
MetaXP, badge, NFT or genuine MetaLayer transaction is issued.

1. **Play and repair the UI first.** The owner reports many remaining UI problems.
   Test a new player on real iOS/Safari and Android/Chrome. Make Nera, coins,
   distributed quests, mines, aiming and building obvious; retain the current
   shared shell, controls and sheets. Review 3D labels, touch picking, cave camera,
   short landscape, keyboard and enlarged text. Do not add a dashboard over the world.
   Investigate the intermittent blank-world/`Invalid position.` startup observed
   in one Czech browser run; the next fresh run passed, so its cause is unresolved.
2. **Reuse the functional NEAR platform.** Reuse account/signing, review,
   durable outbox, retry and confirmed-receipt patterns with a separate MetaLayer
   contract/asset domain. The city `recordChainAction` cannot currently anchor
   a generic world action without city XP/QGOLD. Agree the proposed `record_batch`
   event before wiring the dormant verifier. Prove one real finalized testnet
   quest transaction and recovery after restart; then reconstruct durable world,
   inventory, quest and discovery state from chain data. Never label local hashes
   or unrelated city transactions as MetaLayer confirmations.
3. **Implement MetaGold and its own treasury.** The requested loop includes funded
   world coins, system exploration/mining/build quests and player-funded tasks.
   Reserve finite budgets/escrow, make claims idempotent and server-validated,
   and keep prices/emission amounts for owner review. Premium QGOLD may convert
   one way into MetaGold; no reverse currency redemption into the main game.
   No unbacked per-block reward or renewable-ore money faucet. Replace client
   `Math.max` resource merging with revisioned snapshots before introducing spending.
4. **Add separate MetaXP, badges and NFTs.** Use distinct once-only eligibility
   and collections; never alter city XP. Add one story badge first, then parcel
   NFTs, visible ownership, expandable distributed land and structures carried
   through transfer. Review indirect external resale as an economic exit.
5. **Continue the world loop.** Add real funded quest/coin pickups before any reward
   celebration, then P2P settlement, player tasks, topics/comments and tradable
   build templates. Combat is an optional later design, not implemented here.

Read [the detailed integration handoff](METALAYER-INTEGRATION.md),
[playable mechanisms](LAYER.md) and [committed QA evidence](../output/qa/metalayer-handoff-2026-11-13/README.md). Preserve QuestLayer
and Test Layer work. Contract/treasury/signing changes require the owner's Claude
workflow; no keys, funds, production configuration or deployment were used here.
