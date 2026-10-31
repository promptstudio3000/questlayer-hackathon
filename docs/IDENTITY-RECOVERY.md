# Identity recovery and game sessions

Status: implemented server slice for W03, 2026-10-31. Native passkey-account creation, wallet-key management, independent physical-device acceptance and complete W03 acceptance remain open. This document describes the server contract; the visible Settings flow has separate UI acceptance evidence.

## What recovery means here

A NEAR testnet wallet can prove ownership again and restore its existing QuestLayer explorer after losing a game cookie. A fresh, purpose-bound wallet signature can then sign out the explorer's other game sessions. The retained browser receives a rotated HttpOnly cookie, invalidating any copied version of its previous cookie too. The same explorer, demo progression, inventory and wallet links remain intact. Recovery does not transfer, merge or convert GOLD, mint items, change NEAR keys or recover a wallet secret.

QuestLayer's existing WebAuthn passkey authenticates a **demo game identity**. It is not a NEAR access key, cannot sign NEAR transactions and is not evidence that a recoverable native passkey account exists. The server stores only its public credential data and counter. It stores no player seed, private NEAR signing key or encrypted seed. Operators' existing service credentials are separate from player custody.

## Supported player paths

| Situation                                         | Supported action                                                 | Boundary                                                                                                                      |
| ------------------------------------------------- | ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| New solo player                                   | Create a guest explorer and play                                 | Losing the only guest cookie before adding a recovery identity can lose access to that explorer.                              |
| Guest with a NEAR wallet                          | Link a wallet using a signed, same-browser challenge             | The explorer remains the same. An account already linked elsewhere is rejected, not merged.                                   |
| Lost game cookie; wallet still accessible         | Sign in again with that wallet and sign the NEP413 message       | Returns the already linked explorer. No second starter balance or asset migration.                                            |
| Other game sessions should end                    | Review sessions, sign the recovery message and keep this browser | All other cookies and copied old current cookies lose authorization. Pending wallet/appearance-link approvals are canceled.   |
| Demo passkey still accessible on another device   | Use the existing demo-passkey sign-in                            | The passkey provider's sync/backup determines availability. QuestLayer does not restore an unavailable passkey.               |
| Wallet recovery phrase, device or wallet key lost | Use the wallet provider's supported recovery process             | QuestLayer cannot recover the underlying wallet and does not request its seed.                                                |
| Device/credential remains compromised             | Manage its wallet keys or passkeys through the relevant provider | Signing out game sessions does not revoke those credentials. A valid wallet key or registered demo passkey can sign in again. |

Existing independent guest explorers are not automatically merged on wallet sign-in. Linking happens while signed into the intended guest explorer; returning-wallet sign-in restores the explorer already attached to that wallet. Guest-to-native progression rules remain a separate implementation boundary.

## API contract

All routes use the existing same-origin API and HttpOnly session cookie. Mutating requests require the configured Origin and JSON content type. No wallet permissions or signing keys are added.

`GET /api/identity/sessions` returns:

```json
{
  "network": "testnet",
  "currentSessionId": "session_public-id",
  "activeSessionCount": 2,
  "hasMoreSessions": false,
  "sessions": [
    {
      "id": "session_public-id",
      "current": true,
      "kind": "near-wallet",
      "accountId": "explorer.testnet",
      "createdAt": 1793440800000,
      "lastSeenAt": 1793440800000,
      "expiresAt": 1796032800000
    }
  ],
  "recovery": {
    "nearAccounts": ["explorer.testnet"],
    "demoPasskeys": 0,
    "canRevokeOtherSessions": true,
    "nativePasskeyAccount": false
  }
}
```

The example omits the second session for brevity. Session kinds are `guest`, `near-wallet`, `demo-passkey` or `legacy`. Public IDs are unrelated to the raw cookie/token hash. The current browser is first; at most 50 rows are returned, while the total and `hasMoreSessions` remain truthful. Creation/last-seen values unavailable for pre-existing sessions are `null`. Last seen is sampled at most once a minute; it is not a live presence signal. No IP, location, raw browser identifier or credential material is returned. Session expiry retains the existing 30-day policy; recovery rotation does not extend the stored expiry.

`POST /api/identity/recovery/challenge` with `{ "accountId": "explorer.testnet" }` requires that account already to belong to this explorer. It returns `challengeId`, base64 `nonce`, exact `message`, `recipient`, `network: "testnet"` and `purpose: "revoke-other-sessions"`. Sign the supplied message/recipient/nonce unchanged with the connected wallet's NEP413 `signMessage` method. Ten pending prompts per initiating browser are allowed; another session cannot exhaust this browser's allowance. Prompts expire after five minutes.

`POST /api/identity/recovery/verify` accepts `{ challengeId, accountId, publicKey, signature }`, using the existing base64 signature transport. Success returns `{ ok: true, revokedSessions, ...sessionView }` and rotates the cookie through `Set-Cookie`. The cookie is never included in JSON. `revokedSessions` counts other unexpired sessions; rotation also invalidates the old current cookie even when that count is zero.

Verification failures preserve existing sessions and do not consume the challenge. A successful recovery consumes its challenge atomically with invalidation and audit recording. If the successful response is lost, the old cookie remains invalid: use a new wallet sign-in to restore access. Replaying a successful request is rejected rather than exposing a replacement cookie.

## Authorization and persistence

Implementation: `server/identity/sessions.mjs`, identity routes in `server/index.mjs`, and the shared verifier in `server/identity/near.mjs`.

The server verifies current on-chain FullAccess ownership on testnet using NEP413. A successful signature for ordinary sign-in cannot authorize recovery or linking. Recovery binds the configured origin/recipient, network, player, initiating session, account, nonce, exact purpose and expiry. The session, challenge expiry and account link are checked again after asynchronous RPC verification, inside the final database transaction. Function-call keys cannot prove wallet ownership through this flow. An unavailable or incorrect-network RPC cannot silently authorize it.

Recovery deletes the explorer's session credentials, creates one replacement for the retained browser and records a durable event in the same SQLite transaction. Failures roll back both deletion and challenge consumption. Invalidation survives reopening the database. Other players' sessions remain unaffected. Pending player-bound link/recovery challenges are consumed. NEAR and optional EVM appearance links also require their initiating browser to remain authorized when verification settles.

Existing WebAuthn prompts now have an explicit demo-authentication purpose; unrelated challenges are rejected before credential processing. Concurrent passkey authentication cannot roll a stored authenticator counter backward. Counter-zero synchronized credentials retain their existing supported behavior.

Tables are additive: `identity_sessions` supplies metadata with a cascading reference to existing sessions; `identity_recovery_events` records player, retained public session ID, proving account, count and time. Expired-session cleanup continues to remove the credential and associated metadata. This slice does not add a retention policy for historical recovery events. Session listing lazily labels pre-existing sessions as legacy without inventing an authentication history.

## Evidence and remaining W03 work

Focused command: `node --test tests/identity-sessions.test.mjs tests/near-auth.test.mjs`.

The focused run passed 11/11 tests on 2026-10-31, including an HTTP sign-in/recovery flow with actual generated Ed25519 signatures and a local mock RPC. Eight dedicated session tests cover ownership isolation, private-data exclusion, bounded listings, legacy rows, current-cookie rotation, stale/expired/revoked sessions, conflicting links during verification, replay/races, provider failure, transaction rollback and reopening the on-disk database. The HTTP test additionally verifies lost-cookie restoration, purpose/browser/origin separation, conflicting wallet links, pending-link cancellation and unchanged demo balances. Shared verifier tests reject mainnet RPC and function-call ownership. Temporary test keys never leave the local fixtures.

These tests do not establish a real wallet's recovery UX or synchronized passkey behavior. Still required:

1. Select and review an actual native passkey-account implementation, its recovery/provider dependencies, supported curves/signatures and deployment constraints. Demonstrate a real authorized NEAR operation, not only WebAuthn authentication.
2. Verify a real testnet wallet sign-in, signature and lost-cookie restoration in the running UI. Repeat on an independent physical device, including rejected signatures and wallet cancellation.
3. Design user-controlled secondary wallet recovery and key/capability revocation through the supported wallet/account implementation. Game-session revocation is not NEAR key revocation.
4. Add deliberate demo-passkey management/removal and secondary credential enrollment if offered; keep credential-removal authorization stronger than cookie possession alone.
5. Finish guest-to-native progression/migration policy and once-only accounting separately. Do not translate demo balances into real claims.
6. Establish expiry/retention policies for recovery audit records and review all long-running authenticated mutations for behavior during session revocation. This slice hardens wallet/appearance-link completion; it does not cancel already broadcast blockchain transactions or every request already executing elsewhere.

## Primary-source review

Reviewed 2026-10-31:

- [NEP413 specification](https://github.com/near/NEPs/blob/master/neps/nep-0413.md): off-chain wallet messages bind a recipient and nonce and use FullAccess ownership; they are not transactions. This supports reauthentication without requesting transaction permissions.
- [NEAR access-key documentation](https://docs.near.org/protocol/accounts-contracts/access-keys): accounts can have multiple keys with distinct permissions. Managing full-access keys belongs to the user's wallet/account control path; a game cookie has none of those powers.
- [NEAR Connect upstream README](https://github.com/azbang/near-connect): supplies wallet connection and signed-message integration. The connector is an integration layer, not evidence that QuestLayer has implemented independent wallet/passkey recovery. The repository currently pins `@hot-labs/near-connect` 0.12.0; upstream examples do not by themselves prove compatibility with this application's pinned version or every wallet.

No new embedded-wallet dependency or native passkey-account contract was adopted in this slice. The native-passkey acceptance gap remains explicit in API, UI requirements and roadmap status.
