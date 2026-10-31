// The player's own signing key for the invisible NEAR account. It is generated
// in the browser and stays on this device; the server only ever sees the public
// key. A passkey-derived recovery key is optional and never a server-stored seed.
import {
  KeyPair,
  KeyPairSigner,
  PublicKey,
  actions,
  buildDelegateAction,
  encodeSignedDelegate,
} from "near-api-js";

export type PlayerKeyRecord = {
  publicKey: string;
  secretKey: string;
  accountId: string | null;
  origin: "device" | "prf";
  createdAt: number;
};
export interface KeyStore {
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
const DB_NAME = "questlayer-keys";
const STORE = "keys";

function openStore(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE))
        request.result.createObjectStore(STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
function transact<T>(
  mode: IDBTransactionMode,
  work: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return openStore().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(STORE, mode);
        const request = work(tx.objectStore(STORE));
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
        tx.oncomplete = () => db.close();
      }),
  );
}
export function indexedDbKeyStore(): KeyStore {
  return {
    get: (key) =>
      transact<PlayerKeyRecord | undefined>("readonly", (s) => s.get(key)).then(
        (v) => v ?? null,
      ),
    put: (key, value) =>
      transact("readwrite", (s) => s.put(value, key)).then(() => undefined),
    delete: (key) =>
      transact("readwrite", (s) => s.delete(key)).then(() => undefined),
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
  const existing = await store.get(DEVICE_KEY);
  if (existing) return existing;
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
export function signerFor(record: PlayerKeyRecord) {
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
    await signerFor(record).signDelegateAction(delegateAction);
  return {
    signedDelegateBase64: base64(encodeSignedDelegate(signedDelegate)),
    delegateHash: Array.from(delegateHash, (b) =>
      b.toString(16).padStart(2, "0"),
    ).join(""),
  };
}
