# Encrypted player inbox

Built 10 November 2026 (testnet). Code: `server/inbox/crypto.mjs` (encryption), `src/signing-vault/inbox.ts`
(keys), `server/inbox/service.mjs` and `server/inbox/routes.mjs` (consent, delivery index, reports),
`src/inbox/Inbox.tsx` and `src/inbox/client.ts` (screens), relayer shapes in `server/relayer/policy.mjs`.
Tests: `tests/player-inbox.test.mjs`, `tests/relayer-policy.test.mjs`.

## What a player gets

| Before | After |
| --- | --- |
| Explorers could only wave six ready phrases. | Explorers can write short private messages (up to 500 characters) to each other. |
| Nothing social was stored on chain except public notes and the profile. | Every message is stored on NEAR Social, under the sender's own account, as ciphertext. |
| — | Nobody but the two explorers can read a message: not other players, not the NEAR network, not the QuestLayer server. |

## Who may write to whom

1. A conversation opens after **both explorers waved at each other within the last hour**, or after one asked
   (**Ask to message**) and the other **accepted**. A declined request stays declined for the one who asked;
   the other explorer can still ask back.
2. **Block** (the existing two-way block) stops requests, sending, the conversation list and delivery.
3. Demo explorers and players without their explorer account cannot write or receive. Demo bots answer in a
   separate demo chat on their card instead (`server/demo-bot-chat.mjs`, nothing stored or sent on chain).
4. Limits: 10 new requests a day and at most 20 unanswered; 30 messages an hour and 150 a day per sender;
   120 received an hour per explorer; one message every 2 seconds per pair. Text is 1–500 characters,
   no control characters except new lines.
5. **Report** on a received message: the device discloses the key of that one message only, the server checks
   that it opens the on-chain record and stores the verified text for moderators. Three different reporters
   within 7 days pause the sender until a moderator (market or creator moderators) clears or keeps the pause.

## Cryptography

- Each NEAR account has an **X25519 inbox key**. It is generated inside the secure signing origin
  (the same separate origin that holds the device's NEAR key) and never leaves it. The public half is published
  at `<account>/questlayer/inbox_key` = `{schema:"questlayer.inbox-key/1", key, created_at, mutation_id}`.
- A message `msg_<uuid>` is written by the sender to `<sender>/questlayer/inbox/msg_<uuid>` =
  `{schema:"questlayer.inbox/1", to, from_key, to_key, nonce, box, created_at}`:
  - `shared = X25519(own secret, peer public)`;
  - `context` = both account ids and both public keys, sorted by account id;
  - `key = HKDF-SHA256(shared, salt "questlayer-inbox/1", info "msg|context|msg id")`, one key per message;
  - `box = XChaCha20-Poly1305(key, random 24-byte nonce, padded text, AAD "schema|sender|msg id|to")`;
  - `to = HKDF(shared, …, "tag|context")`, 16 bytes hex.
- This is the NaCl box construction (X25519 with an extended-nonce AEAD) with a per-message key. The sender
  can read their own sent messages; a disclosed message key opens exactly one message.
- **What is public:** that the sender's account wrote a message at a time, its padded length (text is padded to
  128-byte buckets) and the opaque `to` tag. The recipient's account is not on chain; only the two explorers can
  compute the tag. Copying a record into another namespace does not open, because the sender account is part of
  the key derivation.
- **What the server sees:** who writes to whom (it delivers), the ciphertext and times. Never plaintext, never an
  inbox secret.
- **Server-proof keys:** the signing origin reads the peer's public key and the records it opens from NEAR Social
  itself, never from the game server, so a compromised server can neither swap a key nor forge a message.
  The game origin receives the plaintext it displays, so its own integrity (CSP, no third-party scripts) still
  matters as for every screen.

## Delivery

1. The device seals the message in the signing origin and sends the record to `POST /api/inbox/send`; the server
   checks consent, limits, mute, key match and shape, stores a `pending` index row and quotes the SocialDB `set`.
2. The player's account signs the `set` as a NEP-366 delegate; the relayer sponsors gas and the storage-class
   deposit (1 yocto, or 0.05 NEAR while SocialDB storage is low). The relayer accepts only the exact record shape
   above (`RELAY_SOCIAL_SHAPE`), at most 4 KiB of arguments; the largest message (500 four-byte characters) is about 3.1 KiB.
3. The row becomes `delivered` only after the server reads the exact same record from chain (`/api/inbox/confirm`,
   and a worker every 20 s). Rows not on chain after 15 minutes become `failed`.
4. The recipient's device lists message ids (`/api/inbox/thread`) and opens them from chain in the signing origin.
   An envelope with the count of new messages and requests appears on the map (polled every 30 s).

Storage: a short message takes under 0.01 NEAR of SocialDB storage, the largest about 0.035 NEAR, paid
through the relayer's storage deposit. Messages count against the relayer's per-account daily jobs and the shared
subsidy budget (`SUBSIDY_DAILY_OPERATIONS`), which the operator sizes for the expected message volume.

## Device keys and backup

The inbox key lives in one browser on one device. A new device (or a cleared browser) starts with no inbox key:

- If the account already has a published key from another device, the new device says so and offers **Use this
  device for new messages**, which publishes a new key. Messages sent to the old key stay readable only on the old
  device; the signing origin keeps up to eight own keys, so rotating on the same device loses nothing.
- **Proposed backup (not built):** derive or wrap the inbox secret with the linked wallet, e.g. encrypt the secret
  with a key derived from a NEP-413 signature of a fixed message by the linked NEAR wallet (or the passkey PRF used for
  account recovery) and store the wrapped secret in SocialDB. Restoring on a new device then needs the same wallet or
  passkey. Until then, losing the device loses the old messages' readability, not the account.

## Configuration

`INBOX_ENABLED=0` switches the routes off (`{enabled:false}`). Moderators: `MARKET_MODERATORS` and
`CREATOR_MODERATORS` (player ids or NEAR accounts). The signing origin needs `contracts.social` in its public config
(already set by `scripts/install-signing-vault-vps.sh`). Testnet only.

## Routes

`GET /api/inbox`, `GET /api/inbox/summary`, `GET /api/inbox/thread?playerId=`, `POST /api/inbox/key/prepare`,
`POST /api/inbox/key/sync`, `POST /api/inbox/request`, `POST /api/inbox/answer`, `POST /api/inbox/send`,
`POST /api/inbox/confirm`, `POST /api/inbox/report`, moderators: `GET /api/inbox/reports`,
`POST /api/inbox/reports/resolve`. Tables: module `player-inbox@1` (`inbox_keys`, `inbox_contacts`,
`inbox_messages`, `inbox_reports`, `inbox_mutes`).

## Browser journey

`npm run build && npm run e2e:signing-vault -- --device=all` (scenario 5) plays the inbox the way a player
reaches it on phone-390 Chromium, iPhone 15 WebKit and Pixel 7: share the position, tap the explorer standing
next to you, "Message" on their card, send (sealed in the vault, opened in Node with the peer's
secret), read the peer's reply, then the envelope badge ("Messages: 1 new") → list → conversation, which is then
read. NEAR, the relayer and NEAR Social are stubbed at the network layer; CI runs it on every device row.
