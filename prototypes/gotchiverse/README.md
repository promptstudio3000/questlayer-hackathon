# Gotchiverse interaction prototype

An isolated local study prepared with the 7 November Claude handoff. It is not
mounted in QuestLayer. No application API, wallet, funds or GPS are used.

Open the self-contained `preview.html` directly, or serve this folder with a local
static server and open `index.html`. Rebuild the single file with
`python3 build-preview.py` after source changes. First complete
the sample QuestLayer quest, enter Gotchiverse, claim a grid and select a block.
Raise/lower terrain, switch its surface or place the sample display collectible.
Arrow keys select blocks while the canvas is focused; W/A/S/D moves the character.
Named buttons provide an alternative to precise tapping. Neighbor buttons browse
other grid cells.

The lifecycle controls deliberately simulate expiry and another claimant. Expiry
supplies one clearly disclosed sample renewal permit for testing. Renewal preserves
the terrain. Takeover archives the old edits in-session, resets the seed and leaves
the former owner unable to edit. Export before closing to retain archive previews.
Terrain/claims persist in this browser when storage is available; this state has
no authority outside the prototype. No annual term, QGOLD settlement or real NFT
entitlement is implemented. The simple original pixel ghost/altar are local study
art, not imported original Aavegotchi NFTs or a claim of official endorsement.

Run `node --test model.test.mjs`. The delivery also includes Chromium/WebKit reports
and captures at 360/390px, short landscape and desktop. Real phones and hardware
remain unverified. The 200% font fixture is not OS enlarged-text verification.

Integration requirements live in
[`docs/QUESTLAYER-INTEGRATION-PLAN-2026-11-07.md`](../../docs/QUESTLAYER-INTEGRATION-PLAN-2026-11-07.md).
Server authority, concurrent edits, durable archive retention, invitations,
authentic appearances and actual financial claims must be implemented separately.
