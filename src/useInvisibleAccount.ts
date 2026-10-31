// Creates and tracks the player's invisible NEAR account: a device key in this
// browser plus a sponsored sub-account created by the server factory.
import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError } from "./api";
import {
  bindAccount,
  createDeviceKey,
  indexedDbKeyStore,
  loadDeviceKey,
  type KeyStore,
  type PlayerKeyRecord,
} from "./player-key";
import { managedSigner, type NativeSigner } from "./native-signer";

export type ManagedAccountView = {
  network: "testnet";
  enabled: boolean;
  factoryId?: string;
  account: {
    accountId: string;
    state: "creating" | "ready" | "failed";
    errorCode: string | null;
    error: string | null;
    keys: { publicKey: string; kind: string; state: string }[];
  } | null;
};
export type InvisibleAccountStatus =
  | "idle"
  | "unavailable"
  | "creating"
  | "ready"
  | "needs-recovery"
  | "error";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function useInvisibleAccount(
  playerId: string | null | undefined,
  store: KeyStore = indexedDbKeyStore(),
) {
  const [status, setStatus] = useState<InvisibleAccountStatus>("idle");
  const [accountId, setAccountId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const keyRef = useRef<PlayerKeyRecord | null>(null);
  const running = useRef<Promise<void> | null>(null);
  const owner = useRef<string | null>(null);

  const ensure = useCallback(async () => {
    if (!playerId) return;
    if (running.current) return running.current;
    const work = (async () => {
      owner.current = playerId;
      try {
        const view = await api<ManagedAccountView>("/account");
        if (!view.enabled) {
          setStatus("unavailable");
          return;
        }
        let key = await loadDeviceKey(store);
        if (view.account) {
          const known = view.account.keys.some((k) => k.publicKey === key?.publicKey && k.state !== "revoked");
          if (key && !known) {
            // This browser holds a key for another explorer, or this explorer was
            // created elsewhere. Do not overwrite silently.
            setStatus("needs-recovery");
            setAccountId(view.account.accountId);
            return;
          }
        }
        if (!key) key = await createDeviceKey(store);
        let account = view.account;
        if (!account) {
          const created = await api<{ account: ManagedAccountView["account"] } | ManagedAccountView["account"]>(
            "/account/create",
            { publicKey: key.publicKey },
          );
          account = (created && "account" in (created as object) ? (created as { account: ManagedAccountView["account"] }).account : (created as ManagedAccountView["account"]));
        }
        if (!account) throw Error("The explorer account could not be prepared.");
        setAccountId(account.accountId);
        setStatus(account.state === "ready" ? "ready" : "creating");
        for (let attempt = 0; account.state === "creating" && attempt < 60; attempt++) {
          await sleep(attempt < 10 ? 1000 : 3000);
          if (owner.current !== playerId) return;
          const next = await api<ManagedAccountView>("/account");
          if (!next.account) break;
          account = next.account;
        }
        if (account.state === "failed") {
          setError(account.error || "The explorer account could not be prepared.");
          setStatus("error");
          return;
        }
        if (account.state !== "ready") {
          setStatus("creating");
          return;
        }
        await bindAccount(store, account.accountId);
        keyRef.current = { ...key, accountId: account.accountId };
        setStatus("ready");
      } catch (e) {
        setError(e instanceof ApiError ? e.message : (e as Error).message);
        setStatus("error");
      } finally {
        running.current = null;
      }
    })();
    running.current = work;
    return work;
  }, [playerId, store]);

  useEffect(() => {
    if (!playerId) {
      setStatus("idle");
      setAccountId(null);
      keyRef.current = null;
      owner.current = null;
    }
  }, [playerId]);

  const signer: NativeSigner | null =
    status === "ready" && keyRef.current && accountId
      ? managedSigner(keyRef.current, accountId)
      : null;
  return { status, accountId, error, ensure, signer, publicKey: keyRef.current?.publicKey ?? null };
}
