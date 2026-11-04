import { tr } from "./i18n.ts";
// Recovering the invisible NEAR account on a new device without the server ever
// holding a player key.
//
// A recovery passkey is an ordinary WebAuthn passkey whose PRF output (a secret
// the authenticator computes only after the player unlocks it) is used as the
// seed of one extra ed25519 full-access key on the player's account. The passkey
// provider syncs or backs up the passkey; QuestLayer stores only the derived
// public key. On a new device the passkey re-derives the same key, which
//   1. proves ownership with a NEP-413 message (the existing wallet sign-in), and
//   2. signs a sponsored AddKey for a fresh key generated on the new device.
// The recovery key itself is never written to storage.
import { loadNearApi } from "./near-api.ts";
import {
  DEVICE_KEY,
  signerFor,
  type KeyStore,
  type PlayerKeyRecord,
} from "./player-key.ts";

export const RECOVERY_PRF_SALT = new TextEncoder().encode(
  "questlayer:recovery-key:v1",
);
export const RECOVERY_LABEL = "Recovery passkey";

export type ApiCall = <T>(path: string, data?: unknown) => Promise<T>;
export type CredentialsApi = {
  create(options: CredentialCreationOptions): Promise<Credential | null>;
  get(options: CredentialRequestOptions): Promise<Credential | null>;
};
export type AccountKey = {
  publicKey: string;
  kind: string;
  state: string;
  label?: string | null;
  createdAt?: number;
};
type RelayJobView = {
  id: string;
  state: string;
  errorCode: string | null;
  error: string | null;
};

export class RecoveryError extends Error {
  code: string;
  constructor(message: string, code: string) {
    super(message);
    this.code = code;
  }
}

const ACCOUNT_ID = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/;
const bytes = (value: ArrayBuffer | ArrayBufferView) =>
  value instanceof Uint8Array
    ? value
    : ArrayBuffer.isView(value)
      ? new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
      : new Uint8Array(value);
const toBase64 = (value: Uint8Array) => {
  let binary = "";
  for (const b of value) binary += String.fromCharCode(b);
  return btoa(binary);
};
const fromBase64 = (value: string) =>
  Uint8Array.from(atob(value), (c) => c.charCodeAt(0));
const randomBytes = (n: number) => crypto.getRandomValues(new Uint8Array(n));

// The same PRF output always yields the same key; different passkeys (or a
// different salt) yield unrelated keys.
export async function recoveryKeyFromPrf(
  output: ArrayBuffer | ArrayBufferView,
  accountId: string | null,
  now = Date.now(),
): Promise<PlayerKeyRecord> {
  const seed = bytes(output);
  if (seed.length < 32)
    throw new RecoveryError(
      "This passkey did not return a usable recovery secret.",
      "RECOVERY_PRF",
    );
  const { KeyPairEd25519, baseEncode } = await loadNearApi();
  const key = new KeyPairEd25519(baseEncode(seed.slice(0, 32)));
  return {
    publicKey: key.getPublicKey().toString(),
    secretKey: key.toString(),
    accountId,
    origin: "prf",
    createdAt: now,
  };
}

function prfOutput(credential: Credential | null) {
  const results = (
    credential as PublicKeyCredential | null
  )?.getClientExtensionResults?.() as
    | { prf?: { enabled?: boolean; results?: { first?: BufferSource } } }
    | undefined;
  return {
    enabled: results?.prf?.enabled,
    first: results?.prf?.results?.first as
      ArrayBuffer | ArrayBufferView | undefined,
  };
}
const unsupported = () =>
  new RecoveryError(
    "This browser or passkey provider cannot create a recovery passkey. Try a recent Chrome, Safari or Edge with your password manager.",
    "RECOVERY_UNSUPPORTED",
  );
function cancelled(error: unknown): never {
  const name = (error as { name?: string })?.name;
  if (name === "NotAllowedError" || name === "AbortError")
    throw new RecoveryError("The passkey request was cancelled.", "CANCELLED");
  throw error;
}

// Creates a discoverable passkey for this account. The account ID is the
// passkey's user handle, so a new device knows which account to restore.
export async function createRecoveryPasskey({
  accountId,
  credentials,
  rpId,
}: {
  accountId: string;
  credentials: CredentialsApi;
  rpId: string;
}) {
  const extensions = { prf: { eval: { first: RECOVERY_PRF_SALT } } };
  let created: Credential | null;
  try {
    created = await credentials.create({
      publicKey: {
        rp: { id: rpId, name: "QuestLayer" },
        user: {
          id: new TextEncoder().encode(accountId),
          name: accountId,
          displayName: `QuestLayer recovery · ${accountId.split(".")[0]}`,
        },
        challenge: randomBytes(32),
        pubKeyCredParams: [
          { type: "public-key", alg: -7 },
          { type: "public-key", alg: -257 },
        ],
        authenticatorSelection: {
          residentKey: "required",
          userVerification: "required",
        },
        attestation: "none",
        extensions,
      } as PublicKeyCredentialCreationOptions,
    });
  } catch (error) {
    cancelled(error);
  }
  if (!created) throw unsupported();
  let { enabled, first } = prfOutput(created);
  if (enabled === false) throw unsupported();
  if (!first) {
    // Most providers only evaluate the PRF during an assertion.
    let asserted: Credential | null;
    try {
      asserted = await credentials.get({
        publicKey: {
          rpId,
          challenge: randomBytes(32),
          allowCredentials: [
            {
              type: "public-key",
              id: (created as PublicKeyCredential).rawId,
            },
          ],
          userVerification: "required",
          extensions,
        } as PublicKeyCredentialRequestOptions,
      });
    } catch (error) {
      cancelled(error);
    }
    first = prfOutput(asserted).first;
  }
  if (!first) throw unsupported();
  return { credentialId: (created as PublicKeyCredential).id, prf: first };
}

// Asks the player to pick a recovery passkey and returns the account it
// belongs to with the re-derived recovery key.
export async function readRecoveryPasskey({
  credentials,
  rpId,
  now = Date.now(),
}: {
  credentials: CredentialsApi;
  rpId: string;
  now?: number;
}) {
  let credential: Credential | null;
  try {
    credential = await credentials.get({
      publicKey: {
        rpId,
        challenge: randomBytes(32),
        userVerification: "required",
        extensions: { prf: { eval: { first: RECOVERY_PRF_SALT } } },
      } as PublicKeyCredentialRequestOptions,
    });
  } catch (error) {
    cancelled(error);
  }
  const handle = (credential as PublicKeyCredential | null)?.response as
    AuthenticatorAssertionResponse | undefined;
  let accountId = "";
  try {
    accountId = handle?.userHandle
      ? new TextDecoder("utf-8", { fatal: true }).decode(
          bytes(handle.userHandle),
        )
      : "";
  } catch {
    accountId = "";
  }
  if (
    !accountId ||
    accountId.length < 2 ||
    accountId.length > 64 ||
    !ACCOUNT_ID.test(accountId)
  )
    throw new RecoveryError(
      "That passkey is not a QuestLayer recovery passkey. Choose the one named “QuestLayer recovery”.",
      "RECOVERY_NOT_RECOVERY_PASSKEY",
    );
  const { first } = prfOutput(credential);
  if (!first) throw unsupported();
  return {
    accountId,
    recovery: await recoveryKeyFromPrf(first, accountId, now),
  };
}

// NEP-413 proof in the shape the wallet sign-in and session recovery expect.
export async function nep413Proof(
  record: PlayerKeyRecord,
  accountId: string,
  challenge: { message: string; recipient: string; nonce: string },
) {
  const nonce = fromBase64(challenge.nonce);
  if (nonce.length !== 32)
    throw new RecoveryError(
      "The sign-in request could not be verified. Try again.",
      "RECOVERY_CHALLENGE",
    );
  const signed = await (
    await signerFor(record)
  ).signNep413Message(accountId, {
    message: challenge.message,
    recipient: challenge.recipient,
    nonce,
  });
  return {
    accountId,
    publicKey: signed.publicKey.toString(),
    signature: toBase64(signed.signature),
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
export async function waitForJob(
  api: ApiCall,
  id: string,
  { timeoutMs = 90000, intervalMs = 1000 } = {},
) {
  const started = Date.now();
  let job = await api<RelayJobView>(`/relay/${encodeURIComponent(id)}`);
  while (job.state !== "confirmed" && job.state !== "failed") {
    if (Date.now() - started > timeoutMs)
      throw new RecoveryError(
        "The network is still confirming this change. Check your devices again in a minute.",
        "RELAY_PENDING",
      );
    await sleep(intervalMs);
    job = await api<RelayJobView>(`/relay/${encodeURIComponent(id)}`);
  }
  if (job.state === "failed")
    throw new RecoveryError(
      job.error || "The key change could not be saved.",
      job.errorCode || "RELAY_FAILED",
    );
  return job;
}

// Signs one sponsored AddKey/DeleteKey on the player's own account with
// `signer` and waits for its final receipt. The server must already have the
// change registered through POST /api/account/keys.
export async function relayKeyChange(
  signer: PlayerKeyRecord,
  {
    accountId,
    change,
    publicKey,
  }: { accountId: string; change: "add" | "delete"; publicKey: string },
  { api, intervalMs }: { api: ApiCall; intervalMs?: number },
) {
  const prepared = await api<{ nonce: string; maxBlockHeight: string }>(
    "/relay/prepare",
    { accountId, receiverId: accountId, publicKey: signer.publicKey },
  );
  const {
    KeyPairSigner,
    PublicKey,
    actions,
    buildDelegateAction,
    encodeSignedDelegate,
  } = await loadNearApi();
  const target = PublicKey.from(publicKey);
  const delegateAction = buildDelegateAction({
    senderId: accountId,
    receiverId: accountId,
    actions: [
      change === "add"
        ? actions.addFullAccessKey(target)
        : actions.deleteKey(target),
    ],
    nonce: BigInt(prepared.nonce),
    maxBlockHeight: BigInt(prepared.maxBlockHeight),
    publicKey: PublicKey.from(signer.publicKey),
  });
  const { signedDelegate } = await KeyPairSigner.fromSecretKey(
    signer.secretKey as `ed25519:${string}`,
  ).signDelegateAction(delegateAction);
  const job = await api<RelayJobView>("/relay", {
    signedDelegateBase64: toBase64(encodeSignedDelegate(signedDelegate)),
    preview: { receiverId: accountId },
  });
  return waitForJob(api, job.id, { intervalMs });
}

export function deviceLabel(userAgent = "") {
  const os = /iPhone/.test(userAgent)
    ? "iPhone"
    : /iPad/.test(userAgent)
      ? "iPad"
      : /Android/.test(userAgent)
        ? "Android"
        : /Mac OS X|Macintosh/.test(userAgent)
          ? "Mac"
          : /Windows/.test(userAgent)
            ? "Windows"
            : /Linux|CrOS/.test(userAgent)
              ? "Linux"
              : tr("Device");
  const browser = /Edg\//.test(userAgent)
    ? "Edge"
    : /Firefox\//.test(userAgent)
      ? "Firefox"
      : /Chrome\/|CriOS\//.test(userAgent)
        ? "Chrome"
        : /Safari\//.test(userAgent)
          ? "Safari"
          : "";
  return (browser ? `${os} · ${browser}` : os).slice(0, 40);
}

// Keeps a key this browser held for another explorer instead of overwriting it.
export async function replaceDeviceKey(
  store: KeyStore,
  record: PlayerKeyRecord,
) {
  const previous = await store.get(DEVICE_KEY);
  if (previous && previous.publicKey !== record.publicKey)
    await store.put(`archived:${previous.publicKey}`, previous);
  await store.put(DEVICE_KEY, record);
}

export async function freshDeviceKey(accountId: string, now = Date.now()) {
  const { KeyPairEd25519 } = await loadNearApi();
  const key = KeyPairEd25519.fromRandom();
  return {
    publicKey: key.getPublicKey().toString(),
    secretKey: key.toString(),
    accountId,
    origin: "device",
    createdAt: now,
  } satisfies PlayerKeyRecord;
}

// On a device that already holds an active key: add a recovery passkey.
export async function setupPasskeyRecovery({
  deviceKey,
  accountId,
  credentials,
  rpId,
  api,
  intervalMs,
}: {
  deviceKey: PlayerKeyRecord;
  accountId: string;
  credentials: CredentialsApi;
  rpId: string;
  api: ApiCall;
  intervalMs?: number;
}) {
  const { prf } = await createRecoveryPasskey({ accountId, credentials, rpId });
  const recovery = await recoveryKeyFromPrf(prf, accountId);
  await api("/account/keys", {
    publicKey: recovery.publicKey,
    kind: "recovery",
    label: RECOVERY_LABEL,
  });
  await relayKeyChange(
    deviceKey,
    { accountId, change: "add", publicKey: recovery.publicKey },
    { api, intervalMs },
  );
  return { publicKey: recovery.publicKey };
}

// On a new device: sign in with the recovery passkey, then authorize a fresh
// key generated here. Returns the restored explorer from the sign-in.
export async function restoreWithPasskey<P>({
  store,
  credentials,
  rpId,
  api,
  userAgent = "",
  intervalMs,
}: {
  store: KeyStore;
  credentials: CredentialsApi;
  rpId: string;
  api: ApiCall;
  userAgent?: string;
  intervalMs?: number;
}) {
  const { accountId, recovery } = await readRecoveryPasskey({
    credentials,
    rpId,
  });
  const challenge = await api<{
    challengeId: string;
    nonce: string;
    message: string;
    recipient: string;
  }>("/auth/near/challenge", { accountId, name: "Explorer" });
  const proof = await nep413Proof(recovery, accountId, challenge);
  const signedIn = await api<{ player: P }>("/auth/near/verify", {
    challengeId: challenge.challengeId,
    ...proof,
  });
  const device = await freshDeviceKey(accountId);
  await api("/account/keys", {
    publicKey: device.publicKey,
    kind: "device",
    label: deviceLabel(userAgent),
  });
  await relayKeyChange(
    recovery,
    { accountId, change: "add", publicKey: device.publicKey },
    { api, intervalMs },
  );
  await replaceDeviceKey(store, device);
  return { accountId, player: signedIn.player, publicKey: device.publicKey };
}

// Revokes another device (or the recovery passkey) using this device's key.
export async function revokeAccountKey({
  deviceKey,
  accountId,
  publicKey,
  api,
  intervalMs,
}: {
  deviceKey: PlayerKeyRecord;
  accountId: string;
  publicKey: string;
  api: ApiCall;
  intervalMs?: number;
}) {
  if (publicKey === deviceKey.publicKey)
    throw new RecoveryError(
      "Revoke this device from another device.",
      "RECOVERY_SELF",
    );
  const view = await api<{ account: { keys: AccountKey[] } | null }>(
    "/account/keys",
    { remove: true, publicKey },
  );
  const state = view.account?.keys.find(
    (k) => k.publicKey === publicKey,
  )?.state;
  if (state === "removed") return { removed: true, onChain: false };
  await relayKeyChange(
    deviceKey,
    { accountId, change: "delete", publicKey },
    { api, intervalMs },
  );
  return { removed: true, onChain: true };
}

// Signs out every other game session with a NEP-413 proof from this device's
// key, using the existing session-recovery contract.
export async function signOutOtherSessions({
  deviceKey,
  accountId,
  api,
}: {
  deviceKey: PlayerKeyRecord;
  accountId: string;
  api: ApiCall;
}) {
  const c = await api<{
    challengeId: string;
    nonce: string;
    message: string;
    recipient: string;
    purpose: string;
  }>("/identity/recovery/challenge", { accountId });
  if (c.purpose !== "revoke-other-sessions")
    throw new RecoveryError(
      "This request could not be verified.",
      "RECOVERY_CHALLENGE",
    );
  const proof = await nep413Proof(deviceKey, accountId, c);
  return api<{ ok: boolean; revokedSessions: number }>(
    "/identity/recovery/verify",
    { challengeId: c.challengeId, ...proof },
  );
}

export function hasRecoveryPasskey(keys: AccountKey[]) {
  return keys.some((k) => k.kind === "recovery" && k.state === "active");
}

export type DeviceRow = {
  publicKey: string;
  title: string;
  detail: string;
  kind: "device" | "recovery";
  state: string;
  current: boolean;
  canRevoke: boolean;
};
// What the Profile device list shows: removed keys are hidden, this device is
// first and can never be revoked from itself, and the last usable key stays.
export function deviceRows(
  keys: AccountKey[],
  localPublicKey: string | null,
): DeviceRow[] {
  const visible = keys.filter((k) => k.state !== "removed");
  const usable = visible.filter((k) => k.state === "active").length;
  return visible
    .map((k) => {
      const current = k.publicKey === localPublicKey;
      const recovery = k.kind === "recovery";
      const title = current
        ? tr("This device")
        : recovery
          ? RECOVERY_LABEL
          : k.label && k.label !== "first device"
            ? k.label
            : tr("Another device");
      const state =
        k.state === "pending"
          ? tr("Waiting for confirmation")
          : k.state === "removing"
            ? tr("Being revoked")
            : recovery
              ? tr("Restores your explorer on a new device")
              : current
                ? tr("Signs your game actions here")
                : tr("Can sign your game actions");
      const added = k.createdAt
        ? ` · added ${new Date(k.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}`
        : "";
      return {
        publicKey: k.publicKey,
        title,
        detail: state + added,
        kind: (recovery ? "recovery" : "device") as DeviceRow["kind"],
        state: k.state,
        current,
        canRevoke:
          !current &&
          (k.state === "pending" ||
            k.state === "removing" ||
            (k.state === "active" && usable > 1)),
      };
    })
    .sort((a, b) => Number(b.current) - Number(a.current));
}
