// Production device keys live on the separate secure signing origin. The game
// receives public metadata and reviewed signatures, never a private key. Local
// in-memory stores are used only inside that origin and by synthetic tests.
import { loadNearApi } from "./near-api.ts";

export type PlayerKeyRecord = {
  publicKey: string;
  secretKey: string;
  accountId: string | null;
  origin: "device" | "prf";
  createdAt: number;
  vaultId?: string;
};
export interface KeyStore {
  vault?: true;
  create?: () => Promise<PlayerKeyRecord>;
  get(key: string): Promise<PlayerKeyRecord | null>;
  put(key: string, value: PlayerKeyRecord): Promise<void>;
  delete(key: string): Promise<void>;
}
export type DelegateCall = {
  methodName: string;
  args: Record<string, unknown>;
  gas: string;
  deposit: string;
};
export const DEVICE_KEY = "device";
export function indexedDbKeyStore(): KeyStore {
  const request = async <T>(method: string, input?: unknown) => (await import("./signing-vault/client.ts")).vaultRequest<T>(method, input);
  return {
    vault: true,
    create: () => request<PlayerKeyRecord>("create"),
    get: key => key === DEVICE_KEY ? request<PlayerKeyRecord | null>("read") : Promise.resolve(null),
    put: async (key, value) => {
      if (key !== DEVICE_KEY || value.secretKey || !value.vaultId) throw Error("Private keys cannot be written from the game origin.");
      await request("bind", { publicKey: value.publicKey, accountId: value.accountId });
    },
    delete: async () => { throw Error("Manage device keys in the secure account window."); },
  };
}
export function memoryKeyStore(): KeyStore {
  const map = new Map<string, PlayerKeyRecord>();
  return {
    get: async (key) => map.get(key) ?? null,
    put: async (key, value) => {
      map.set(key, value);
    },
    delete: async (key) => {
      map.delete(key);
    },
  };
}
export async function loadDeviceKey(store: KeyStore) {
  return store.get(DEVICE_KEY);
}
export async function createDeviceKey(
  store: KeyStore,
  now = Date.now(),
): Promise<PlayerKeyRecord> {
  if (store.create) return store.create();
  const existing = await store.get(DEVICE_KEY);
  if (existing) return existing;
  const { KeyPair } = await loadNearApi();
  const key = KeyPair.fromRandom("ed25519");
  const record: PlayerKeyRecord = {
    publicKey: key.getPublicKey().toString(),
    secretKey: key.toString(),
    accountId: null,
    origin: "device",
    createdAt: now,
  };
  await store.put(DEVICE_KEY, record);
  return record;
}
export async function bindAccount(store: KeyStore, accountId: string) {
  const record = await store.get(DEVICE_KEY);
  if (!record) throw Error("No device key to bind.");
  if (record.accountId && record.accountId !== accountId)
    throw Error("This device key already belongs to another explorer.");
  await store.put(DEVICE_KEY, { ...record, accountId });
}
export async function signerFor(record: PlayerKeyRecord) {
  if (record.vaultId) {
    const { IsolatedSigner } = await import("./signing-vault/signer.ts");
    return new IsolatedSigner(record);
  }
  const { KeyPairSigner } = await loadNearApi();
  return KeyPairSigner.fromSecretKey(record.secretKey as `ed25519:${string}`);
}
function base64(bytes: Uint8Array) {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}
// Builds, signs and encodes one NEP-366 delegate action exactly as the relayer
// decodes it: base64 of borsh(SignedDelegate). No RPC is touched here.
export async function signDelegate(
  record: PlayerKeyRecord,
  input: {
    senderId: string;
    receiverId: string;
    call: DelegateCall;
    nonce: string;
    maxBlockHeight: string;
  },
) {
  const { PublicKey, actions, buildDelegateAction, encodeSignedDelegate } =
    await loadNearApi();
  const publicKey = PublicKey.from(record.publicKey);
  const delegateAction = buildDelegateAction({
    senderId: input.senderId,
    receiverId: input.receiverId,
    actions: [
      actions.functionCall(
        input.call.methodName,
        input.call.args,
        BigInt(input.call.gas),
        BigInt(input.call.deposit),
      ),
    ],
    nonce: BigInt(input.nonce),
    maxBlockHeight: BigInt(input.maxBlockHeight),
    publicKey,
  });
  const { signedDelegate, delegateHash } =
    await (await signerFor(record)).signDelegateAction(delegateAction);
  return {
    signedDelegateBase64: base64(encodeSignedDelegate(signedDelegate)),
    delegateHash: Array.from(delegateHash, (b) =>
      b.toString(16).padStart(2, "0"),
    ).join(""),
  };
}
