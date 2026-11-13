# MetaLayer: the Quiet Beacon

Updated 13 November 2026. The testnet-only virtual world opens from the world picker
as **MetaLayer**. Its planned local currency is **MetaGold**. This first playable
slice is a nonfinancial integration preview, with its own resource state.

## The playable loop

An explorer enters a shared 96 × 96 central square as an Aavegotchi starter ghost.
Everyone can build or remove blocks on the green parts of the square. The central
altar, crossing and walking floor are protected. A large warm beam marks the
centre. New explorers arrive on separate free spots of the protected crossing,
so arrivals stay clear and player models remain readable. Cyan beams lead to Crystal Hollow and the Basalt Quarry. Both are part of
the same landscape, visible to every explorer.

Keeper Nera stands beside the arrival path at 12.5, -6.5. The first objective points
to her. Tap a visible guide or sign, press Enter when aiming at it, or use the
nearby place action in the compact objective. Her greeting offers the expedition;
if too far away, Face this place turns the explorer toward her. Community also
opens the expedition board. Accept the first expedition, discover
Crystal Hollow, then mine ten natural diamonds. An explorer who found the mine
before accepting can start with the mining step. The backpack displays confirmed
diamonds and basalt. Completion retains the resources and completes the objective;
MetaGold, QuestLayer XP, NFTs and native settlement remain unconfigured.

The **Quiet Beacon** story continues through five chapters. Keeper Nera explains
that the Fold scattered the square’s signals. After the diamond expedition, visit
the quarry and hold six mined basalt blocks. Read and solve the Spore Garden,
Tide Arch and Star Observatory inscriptions in order, at their actual locations.
Build or inspect a shared trail marker (two spore stalk blocks and a lamp) at
18, 18. A ghost outline and an optional nearby template support both manual and
non-drag construction. Return with the diamonds to tune the central beacon. The
shared beam lights for everyone; each explorer retains independent progress.

Resources are kept: these chapter requirements do not spend currency or change
an existing price, reward, fee or XP rule. The completion is a field-journal entry,
not an NFT badge or a token award. The square and mines remain playable afterward.

## Places players can find

Ten authored places now have visible props and nearby actions. Quest boards stand
at the cave, quarry, three signal stations, marker site and central beacon. They
show that location's requirement, current chapter or a clear prerequisite. A later
board never pretends its quest is active. The journal and expanded atlas contain
a requested place directory with coordinates and personal discovery checks.

Nera's **Meet the square** tour is independent of the five-chapter campaign: visit
the treasury, Luma's workshop, Crystal Hollow and Spore Garden. Validated movement
saves each personal visit once in `ml_actions` (`place-found`); rejected teleports
and stale/invalid positions cannot create discoveries. These entries survive a
restart. Visiting all four records one `tour-complete` step, which pays 5 MetaGold
and 10 MetaXP once the MetaLayer contract is live, so the whole story pays 100
MetaGold, the price of one parcel. Everyone still shares one atlas.

The **Land and building** sheet shows the 16 × 16 parcel under the explorer. Open
land has one **Buy land** button: the explorer's own account signs `buy_parcel`
(0.02 NEAR storage deposit, unused part refunded), then `POST
/layer/expedition/parcel` reads the owner from the contract into `ml_parcels`. The
owner may build anywhere on the parcel; parcels touching the square stay public.

The golden vault at -5.5, -5.5 is a visible **inactive MetaGold treasury**. Its status
also opens from the backpack. It contains no funded coin drop and offers no
spendable balance. This makes the missing financial integration discoverable
without presenting a decorative coin as an earned asset.

The local launcher explicitly sets `LAYER_DEMO_ACTORS=1`. Tavi walks near arrival,
Luma visits the authored workshop and Omi explores the cave corridor. Each name
includes **Demo**. These are cosmetic preview actors, not accounts or real online
players; they never publish presence, edit blocks, consume resources or gain an
asset. They do not affect the nearby-player count. Routes avoid occupied blocks;
reduced motion freezes them. Without the explicit switch, the normal host renders
the guide and place props with no demo explorers.

MetaLayer inherits the current QuestLayer shell: `WorldSwitcher`, `Character`,
HUD bubble, the Settings gear, `DemoControls` on the left, `MapActions` on the
right, the existing navigation rail, `ScreenTabs` and native map dialogs. The app
mount only passes the current world configuration and the normal Profile action.
No independent colour palette or navigation appearance is introduced.

The gear opens the same Settings sheet as GotchiGO (`src/layer/LayerSettings.tsx`
reuses its groups and rows). Only the first group differs: world tools (my
location, shared atlas, central square, land and building, minimap switch)
instead of GPS, city overview and globe. Game (language, sound, vibration,
reduced motion), Help (how to play) and Account (opens the platform Settings,
back to GotchiGO) follow. Saved actions and NEAR references live under
**Advanced**; Community shows only Quests and Field journal, and the backpack
and treasury never link to chain details.

On phones, the shared atlas starts folded. Request it from Settings, then tap
the small minimap to expand the atlas. Tool switching and Jump live under Actions.
Build opens the material picker on request; the held tool appears only in Build mode or when an aimed block is mineable. The default objective is a compact shared peek with its title and one short
status line. A nearby place temporarily uses that same line and action, adding no
permanent HUD panel. Story details and the journal stay in requested sheets; NEAR history stays under Settings → Advanced.

The objective shows its target direction and distance in **blocks**. Its board
keeps the current action, chapter progress and replayable journal together. Wrong
clues and failed actions stay inside the active sheet. The backpack links back to
the story and to action receipts.

- **Travel:** the same accessible stick as QuestLayer's city demonstration. Forward
  follows the explorer, sideways turns, back steps backwards. Arrows and WASD do
  the same; Run toggles pace, Shift reverses the pace, Space jumps. One-block steps
  climb automatically. Drag to inspect, pinch/wheel to zoom, My location restores
  the following camera. Forms and modal dialogs own their keys.
- **Actions:** the bottom-right button (same corner as GotchiGO) fans out Talk (T),
  Mine (M), Build (B), Jump (Space) and Land and building (L). The keys work
  without opening it; their hints show only on keyboard devices.
- **Build:** select Build, select a material, then tap a face or use the placement
  button. Desktop right-click places. Only the green square areas above ground
  and below height 40 accept shared edits. No private plot is automatically claimed
  by this entry. The existing plot endpoints remain available for their current
  callers while the parcel-contract slice is reviewed.
- **Mine:** click or tap a mine block (or a block built on the square), press and
  hold it, hold the pickaxe action button, or hold Enter while the canvas is
  focused. A click or tap keeps digging after release: the explorer turns to the
  block and swings the pickaxe until it breaks. A stone block takes 600 ms, diamond
  ore 1,200 ms. Dragging the view, walking more than about a block away, opening a
  dialog or leaving the foreground cancels the local attempt. Tapping hard rock
  outside the mines says where digging works. The server checks duration,
  recent position, reach, exposed line of sight and the exact block again before
  awarding a resource. Natural diamond ore is distinct from the decorative Crystal
  build block. Two explorers targeting one block produce one resource grant.
- **Renewal:** mined diamond veins return after 15 minutes. Dug stone corridors
  stay open. Renewal affects the original ore position only. Mines accept extraction,
  while player construction belongs on the square. The mine floor is protected.
- **Atlas:** each validated presence reveals its 16 × 16 tile for everyone. The
  minimap stays centred on the explorer. The expanded atlas pans in bounded
  windows and offers My location and Central square. A far discovery never changes
  the scale of the default view. No interpolated line is revealed on return.
- **Appearance:** a floating, stepped ghost body uses the existing official starter
  artwork on its face and the equipped local Aura as a halo. Peers use the same
  starter with a reduced server-read look. Full verified original GLBs and modular
  wearable coverage remain a later renderer integration; no original ownership is
  granted by the preview. Source and permissions are in ASSET-CATALOG.md.

## Isolation, persistence and interfaces

`LAYER_ENABLED=1` remains the only enable switch, ignored on mainnet. The normal
QuestLayer session determines the actor. The layer ID `space` remains stable for
existing configuration and API callers. The new entry uses `POST
/api/layer/expedition/enter`, with optional `plaza: true` for an explicit return.

`metalayer-expedition` is an additive, separately registered module. Its tables own
resource counts, accepted/completed expedition state, shared block overrides,
discovered atlas tiles, in-progress mining and immutable action receipts. No money,
XP, core inventory or signing table is written. The browser shows confirmed state
and reloads snapshots after retries. The database participates in normal module
backup inspection. Position reports are checked against the persisted last
position even after the short nearby-presence lease expires.

| Endpoint under `/api/layer/expedition/` | Purpose |
| --- | --- |
| POST `enter` | Enter or return to the protected square spawn |
| GET `state?layer=&x=&z=` | Resource progress, nearby block overrides, bounded shared atlas |
| POST `start` | Accept the two-step expedition once |
| POST `edit` | Shared square edit with request ID and expected previous block |
| POST `mine-start` | Begin one server-timed natural-block extraction |
| POST `mine-finish` | Complete that actor's token once with an immutable request receipt |
| POST `interact` | Read a signal, inspect/place the shared marker, or tune the beacon |
| GET `activity?layer=` | Actor-scoped action evidence and separately verified chain references |
| POST `verify` | Read-only validation of an externally submitted MetaLayer action transaction |

`POST /api/layer/presence` with `expedition: true` renews movement, returns peers
and confirms expedition discovery. Public responses contain no wallet links or
balances. The old home/plot/edit routes retain their own owner-only semantics.

## NEAR platform adaptation

The **Actions and NEAR proofs** panel reuses `ChainLink` for genuine finalized
references and the existing `ChainFeed` for separately labelled account/NFT/city
history. City activity is never labelled as a MetaLayer receipt. A local action has
an evidence hash and the status **Saved in preview**, with no NEAR confirmation icon.

The isolated `metalayer-activity` module stores domain-separated action envelopes
atomically with edits, mining and story interaction receipts. Its read-only verifier
reuses the platform’s receipt-status validator. With reviewed testnet configuration,
it checks network/finality, recorder and receiver, successful complete receipt graphs,
an exact `questlayer_metalayer` event, layer/actor/action/evidence binding, inclusion
blocks and historical/current code fingerprints. It saves the confirmed proof but
never credits tokens, XP, badges or NFT ownership. The default preview has no such
configuration and sends no transaction. See [integration contract and owner handoff](METALAYER-INTEGRATION.md).

## Accepted next integration

The owner chose a clean MetaLayer world, a large editable common square and private
16 × 16 parcels bought with MetaGold. Parcel NFTs are freely transferable and carry
standing blocks to the next owner. Own corners, outline and detail will make
ownership readable. The shared atlas preserves distant discoveries while cropping
its view.

MetaGold will have its own treasury, financed initially by the project and then by
MetaLayer receipts and actually received attributable yield. It will fund terrain
coins and system quests. Player-created universal tasks will use MetaGold escrow,
completion evidence, a second player's acceptance and dispute handling. QGOLD can
convert into MetaGold in one direction. A transferable parcel bought with MetaGold
can subsequently be sold outside the game, which permits an indirect value exit.

The target stores every durable world change, discovery, inventory, quest,
MetaXP, community record and settlement on NEAR in small batches. A fresh indexer
must be able to reconstruct current state from chain data. This preview's SQLite
state is not that chain proof. Contract, treasury, signing and rollout work belongs
to the owner's reviewed integration. The UI states that boundary. Current wearable
clones stay personal cosmetics; supported transferable NFT trading is a separate
Intents integration.

## Local preview

With Node 24+, use `npm ci`, `npm run build`, then
`node scripts/preview-metalayer.mjs`. The localhost-only preview uses disposable
temporary state, no developer runtime configuration and no outbound server fetch.
It prints its state directory; `--state-dir <that directory>` preserves this preview
when restarting it. This launcher does not enable transaction submission or signing.

## Verification

`tests/metalayer-expedition.test.mjs` checks shared discoveries, shared CAS edits,
mining contention, duration, renewal, blocked/far/stale attempts, exact ten-diamond
completion, reopening, authored-place protection, idempotent personal visits and
separation from QuestLayer XP and items.

`npm run e2e:layer` uses the built App with two authenticated explorers and disposable
loopback state. It exercises normal entry, quest acceptance, atlas controls, held
mining, the shared result and reload recovery. Screenshots cover 360/390 portrait,
short landscape, desktop and enlarged guide text. Software browser rendering does
not establish Safari/iOS or Chrome/Android hardware performance. Physical-device
acceptance and chain restoration remain integration gates.

`node scripts/e2e-metalayer-story.mjs` separately exercises the built-App clue
retry, dialog input ownership, three normal HTTP signal actions, marker template,
shared-beacon finale, reload and local-versus-NEAR history. Extraction prerequisites
and checkpoint positions are explicit UI fixtures; the full campaign is separately
verified through the authenticated store. The dormant proof form uses a capability
fixture to check enlarged text, reduced keyboard space and preserved failed input.
No UI fixture is a real NEAR transaction.

`node scripts/e2e-metalayer-places.mjs` uses a fresh explorer with no state fixture.
It walks through Nera, the treasury, workshop and cave using normal keyboard input,
opens physical-place actions and a locked later chapter, then reloads the personal
discoveries. `E2E_LANG=cs` repeats the same journey in Czech. Screenshots include
360/390 portrait, short landscape and desktop. Real phone acceptance remains open.
