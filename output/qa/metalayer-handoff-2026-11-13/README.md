# MetaLayer review candidate — 13 November 2026

Player problem: the previous preview hid its story in a panel. There was no
physical guide or demo explorer, and no visible place explaining the missing gold.
The owner also reported excessive phone chrome and asked to preserve the latest
QuestLayer UI. This candidate adds discoverable world interactions, keeps the
compact shared controls, and prepares a separate branch for Claude's integration.

Review branch: `weekend/m1-metalayer-first-expedition`, based on integration commit
`673e9fc77c56133955e01ae32b962ec2edfff3b6`. Review into
`claude/upbeat-gauss-5czir7`; the owner merges. Do not apply the earlier local patches.
Nothing was deployed and no signing key, production state or funded account was used.

- [Short Claude brief](../../../docs/CLAUDE-METALAYER-BRIEF.md)
- [Detailed integration contract and remaining scope](../../../docs/METALAYER-INTEGRATION.md)
- [Playable rules and local launch](../../../docs/LAYER.md)
- [Visual review](review.html)
- [Verification and source fingerprints](verification.json)

## What players can actually do

Enter solo without a wallet, meet Keeper Nera beside the arrival path, accept the
expedition, mine natural diamonds, visit the quarry, solve three authored clues,
build a shared trail marker and restore the central beacon. The server persists
resources, visits and story state; other authenticated explorers share edits,
ore, the atlas and the finale. One shared ore block grants one resource once.

Nera's independent tour asks the explorer to find the treasury, workshop, cave and
garden. Every valid visit stays in the personal field journal. Boards are physical
world props; their requested sheets show the current action or a prerequisite.
The atlas and journal include a directory. A nearby place reuses the compact
objective, adding no permanent HUD panel.

| Place | World coordinates | What is available |
| --- | --- | --- |
| Keeper Nera | 12.5, -6.5 | Greeting, expedition, independent tour |
| MetaGold treasury | -5.5, -5.5 | Golden vault and explicit inactive status |
| Luma's workshop | -22.5, 32.5 | Authored shelter, building help and free public construction nearby |
| Crystal Hollow board | -2.5, -46.5 | Diamond expedition and mine entrance |
| Basalt Quarry board | 55.5, -17.5 | Quarry chapter and natural basalt |
| Spore Garden | -28, 22 | First signal inscription |
| Tide Arch | 28, 28 | Second signal inscription |
| Star Observatory | 30, -27 | Third signal inscription |
| Trail marker | 18, 18 | Manual build or nearby template |
| Central beacon | 0, 0 | Personal finale and shared beam |

The preview launcher enables Tavi, Luma and Omi with `LAYER_DEMO_ACTORS=1`. Their
names explicitly include Demo. They are cosmetic actors, never real online accounts,
resource consumers or reward recipients, and do not affect the nearby-player count.

## Before / After / Why

“Before” distinguishes source findings from the older captured preview. “After” is
observed in the built-App journeys linked in `verification.json`. None is a usability
score, physical-device test or claim that the full game is finished.

| Before | After | Why / source pointer |
| --- | --- | --- |
| Source: Nera existed only as a text label in the board. | A visible Aavegotchi guide stands near arrival; a direct tap and the nearby action open her greeting. | Make the next action findable. [world-places.ts](../../../src/layer/world-places.ts), [PlacePanel.tsx](../../../src/layer/PlacePanel.tsx). |
| Source/capture: an arrival could face away from its guide, or leave her at the edge. | The initial camera faces the current objective. | Make the first scene intentional. [engine.ts](../../../src/layer/engine.ts), [Layer.tsx](../../../src/layer/Layer.tsx). |
| Source: chapter locations had no readable world boards or requested directory. | Physical boards and the ten-place directory expose the campaign; later chapters explain their prerequisite. | Give spatial quests a spatial entry. [story-world.mjs](../../../server/layer/story-world.mjs), [PlacePanel.tsx](../../../src/layer/PlacePanel.tsx). |
| Source: no visible gold or explanation of its absence. | The central golden vault and backpack link show Treasury inactive and explain the missing funded MetaGold. | Expose the true state without inventing a balance. [PlacePanel.tsx](../../../src/layer/PlacePanel.tsx). |
| Source: no demo explorers. | Tavi, Luma and Omi have labelled cosmetic routes; real presence remains separate. | Show life while keeping the online count honest. [world-places.ts](../../../src/layer/world-places.ts), [layers.mjs](../../../server/layer/layers.mjs). |
| Source: discovery progress only served the ordered campaign/atlas. | Independent valid place visits are personal, idempotent and persistent. | Offer a short exploration loop before completing ten diamonds. [expedition.mjs](../../../server/layer/expedition.mjs). |
| Earlier capture/source: independent panels, tools and map crowded the phone. | Current QuestLayer HUD, left stick, right Actions and native sheets; map and materials stay folded. | Preserve the owner's established UI. [Layer.tsx](../../../src/layer/Layer.tsx), [layer.css](../../../src/layer/layer.css). |
| Observed during verification: the new lazy-screen graph pushed raw welcome JS just over its unchanged limit. | Shared existing icons/navigation restored the 704 KB limit; the newest upstream base further reduces this build to 702 KB raw / 213 KB gzip. | Preserve the first-screen budget; no budget/dependency change. [StoryBoard.tsx](../../../src/layer/StoryBoard.tsx), [App.tsx](../../../src/App.tsx). |

## Implemented, proposed and absent

| Requirement | Candidate status |
| --- | --- |
| Shared Minecraft-like movement, mining/building, discoveries and online peers | Implemented preview; browser interaction and server invariants checked |
| Guide, story seed, five chapters, distributed boards and independent tour | Implemented with durable isolated progress |
| Latest QuestLayer controls and compact phone UI | Shared components/styles reused; substantial UI polish and real-device work remains |
| Aavegotchi identity | Starter ghost and equipped Aura; full verified wardrobe and uploaded avatars remain absent |
| MetaGold world coins and own treasury | Visible inactive vault only; no funded pickup, issuance, spending or reward |
| MetaXP, badge/NFT issuance and real NEAR submissions | Absent; local evidence and a disabled read-only verifier are integration inputs |
| One-way premium QGOLD conversion, P2P/escrow and player-funded tasks | Proposed integration, not functional here |
| Distributed expandable private parcels and transferable buildings | Proposed; the current public square is shared, not privately owned |
| Topics/comments, tradable instances/blueprints, paid likes and combat | Not implemented; do not present them as hidden features |
| Chain-only world reconstruction | Required owner acceptance gate, not achieved by SQLite receipts |

## Verification and limits

`verification.json` records final commands, totals and source hashes. The world-place
journey uses a fresh explorer, direct guide tapping, normal keyboard movement,
actual HTTP presence and no state fixtures. The story UI journey deliberately
prepares extraction prerequisites/checkpoint positions, then exercises real clue,
shared-build and finale actions; its dormant NEAR form is a capability fixture.
The full mining-to-finale lifecycle is separately covered at the authenticated
server boundary. A browser mining journey additionally checks two actual peers,
held extraction, the shared hole and reload inventory.

Screens cover 360/390 portrait, short landscape, desktop, enlarged text and reduced
keyboard space for the existing proof form. Software Chromium is not Safari/iOS or
Chrome/Android hardware evidence. Some early concurrent browser runs failed to
initialize/capture; only completed runs are included as passing evidence.
One Czech startup also showed a [blank world and `Invalid position.`](known-startup-invalid-position.png) before travel;
the next fresh run passed. Its cause remains unresolved and is an explicit Claude
UI/debugging item, not a verified fix or a reason to discard the failed capture.

Still review touch aiming/building, cave camera, crowded names, clearer resource
feedback, richer scene craft, wardrobe coverage and all real economic interactions.
The local preview intentionally leaves chain services unavailable; platform account
calls may log failures while MetaLayer's isolated gameplay works. No genuine
MetaLayer transaction or network-backed reward was produced.
