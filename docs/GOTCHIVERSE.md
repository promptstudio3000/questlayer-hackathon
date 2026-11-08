# Gotchiverse workshops

7 November 2026. Implemented source behavior for the first integrated virtual realm.
This document describes the game build, not a verified public deployment.

## Enter and return

The logo opens the world picker. QuestLayer retains its existing physical/GPS and
labelled arena modes. Gotchiverse opens a virtual workshop using the same signed-in
explorer and current equipment. A first useful visit needs no wallet or deposit.
The virtual renderer loads only after selecting Gotchiverse.

World selection uses the existing actor-scoped navigation history. Returning to
QuestLayer preserves its selected physical quest, world ID and progress. Virtual
movement never writes GPS coordinates or completes a physical objective. Physical
demo coin requests and native auto-collection are inactive in Gotchiverse. Entering
through the picker turns off optional physical presence sharing.

## The first building activity

Each explorer can open one personal, server-saved 16 × 16 workshop. This is free
practice space, separate from the future claimable public landscape. It does not
create a public land lease, outdoor permit, QGOLD payment, XP, item grant or yield.
The screen discloses that distinction. Public paid claims are not active.

Players raise/lower blocks, choose grass, stone, sand or water, and place/remove a
garden lantern from the free prop library. Water is a static material. The first
activity asks for three altered blocks and a lantern. Its server-persisted completion
timestamp survives later edits and repeats; it grants no financial or progression
reward. A block restored to its natural value does not count as altered terrain.

Walk and Build modes give the directional controls an explicit purpose. Keyboard
movement is active only while the virtual landscape owns focus. Precise tapping
has named button alternatives. Workshop position/selection are browser-session
conveniences; the server owns saved terrain and access rights.

The player's appearance reuses the existing Character composition, equipped Auras,
verified original appearance endpoint, and catalogue-checked starter wearable
composition. Original ownership and equipment are not transferred. Other visiting
explorers currently use a starter marker with their name; full verified peer
appearance is not implemented. The garden lantern is a free authored library prop,
not a personal NFT. Personal NFT placement remains a later integration stage.

## Saving and conflicts

Each edit carries an expected workshop revision, actor-bound request ID and an
absolute block value. The server checks authorization, coordinates, material and
height. It takes a per-workshop exclusive file lock, writes a private temporary
snapshot, flushes it, atomically renames it and flushes the directory before returning
success. Readers see a whole old or new snapshot. Separate workers cannot silently
overwrite one another: lock contention fails closed, and stale revisions return a
conflict requiring a fresh view.

Successful request IDs and payload digests are retained in a bounded receipt window.
Retrying the same request returns the current authorized view without repeating the
edit. Reusing its ID for a different payload fails. Outside the retained window,
the old revision still prevents a repeated edit. Unconfirmed client saves retain
their exact request in session storage and block additional edits until retried.
They are not financial transaction journals.

An explicit conflict reloads the latest view before another edit. Offline/errors
retain visible terrain and give a retry action. If the browser cannot retain an
unfinished save, the player is told to keep the page open until Saved appears.
No client preview is treated as a confirmed server result.

## Friends and virtual presence

The owner creates a single-use invitation valid for one day. Creating a new one
replaces the previous unaccepted invitation. The raw invitation appears only in
the returned share link; its nonce is hashed in storage. The link uses a fragment,
survives ordinary onboarding and is removed after acceptance.

A friend can edit terrain and see workshop activity; they cannot invite others or
manage access. The owner can revoke access. Every new edit, read, invitation and
replay checks current permissions. There are at most twelve invited friends.
Ordinary game sessions authorize building; no wallet signature is added.

Virtual presence shares only bounded block coordinates and the explorer name among
authorized participants in that workshop. It does not read or publish physical GPS.
The client renews on an active visible workshop; positions expire after twenty
seconds or disappear on leave/revocation. Presence is ephemeral and does not change
terrain revisions. Updates use bounded authenticated polling, not the game's
existing physical-location presence or reward event stream.

## Storage, limits and operations

Workshop JSON files are stored in a `gotchiverse` directory beside the configured
game database. They are separate from its financial schema. The source creates
private directories/files and reads them only through authorized endpoints. A
workshop snapshot is capped at 250,000 characters; new workshop creation stops at
the configured source ceiling of 4,096 files. The HTTP body cap is 8,192 bytes.
These are nonfinancial resource bounds, not adopted economic tuning.

The terrain API never imports a chain, signing, payout or economic service. New
writes reauthenticate after streaming the bounded body, reject cross-site browser
writes, and use the existing game origin/rate perimeter. The user identity comes
from the authenticated session, never an input actor ID.

If a process is killed during an exclusive write, a lock may remain. Reads retain
the last atomic snapshot and new writes fail closed. An operator must inspect and
remove that stale lock only with all relevant writers stopped; there is no unsafe
automatic timeout takeover. Normal API failures release their lock. Coordinated
backup/restore and multi-host storage adoption remain release gates. The existing
protected backup/deployment scripts were not changed, and this feature has not
been deployed.

## Next stages

The approved outdoor-permit/QGOLD public claims, their expiry/takeover archive,
equipped Aura yield/reach, profile-NFT transfer, treasury/DAO strategies and virtual
reward settlement are not activated by this workshop integration. Their money,
ownership and accounting changes require their own reviewed implementation.
Practically extensible public chunks and funded virtual quests are separate from
the bounded workshop. No roadmap milestone is declared complete by this slice.

Real iOS/Android, OS enlarged text, physical keyboard/clipboard and field GPS remain
device checks. Browser automation and synthetic player accounts are labelled as
such in the integration evidence.

## Feature switch (8 November 2026)

The workshop ships as **Gotchiverse-test-app** behind the server switch
`GOTCHIVERSE_TEST_APP=1`. `/api/config` reports `gotchiverseTestApp`; only then does
the logo become the world picker. With the switch off, `/api/gotchiverse/*` is not
served, no workshop folder is created and the logo keeps its old behavior. Workshop files live in a `gotchiverse`
folder beside the game database and belong in every database backup.
