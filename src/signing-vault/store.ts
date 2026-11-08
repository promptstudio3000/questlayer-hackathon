import type { KeyStore, PlayerKeyRecord } from "../player-key.ts";
function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("questlayer-secure-account", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("records");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
export async function vaultRecord<T>(
  key: string,
  value?: T,
  remove = false,
): Promise<T | null> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(
        "records",
        value === undefined && !remove ? "readonly" : "readwrite",
      ),
      store = tx.objectStore("records");
    const request = remove
      ? store.delete(key)
      : value === undefined
        ? store.get(key)
        : store.put(value, key);
    // A request success is not a durable commit. Wait for the transaction.
    tx.oncomplete = () => {
      const result = request.result;
      db.close();
      resolve(result ?? null);
    };
    tx.onabort = tx.onerror = () => {
      db.close();
      reject(tx.error ?? Error("Secure account storage is unavailable."));
    };
  });
}
export function localVaultKeyStore(): KeyStore {
  return {
    get: (key) => vaultRecord<PlayerKeyRecord>(`key:${key}`),
    put: async (key, value) => {
      await vaultRecord(`key:${key}`, value);
    },
    delete: async (key) => {
      await vaultRecord(`key:${key}`, undefined, true);
    },
  };
}
export async function vaultRequests<T>(): Promise<T[]> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("records", "readonly"),
      request = tx
        .objectStore("records")
        .getAll(IDBKeyRange.bound("request:", "request:\uffff"));
    tx.oncomplete = () => {
      db.close();
      resolve(request.result);
    };
    tx.onabort = tx.onerror = () => {
      db.close();
      reject(tx.error);
    };
  });
}
