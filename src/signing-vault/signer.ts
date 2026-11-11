import { deserialize } from "borsh";
import {
  Signer,
  PublicKey,
  SCHEMA,
  encodeTransaction,
  encodeDelegateAction,
  decodeSignedTransaction,
  type KeyPairSigner,
} from "near-api-js";
import { vaultRequest } from "./client.ts";
import type { PlayerKeyRecord } from "../player-key.ts";
import type { VaultAction } from "./policy.ts";
const base64 = (b: Uint8Array) =>
  btoa(Array.from(b, (c) => String.fromCharCode(c)).join(""));
const bytes = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
type Signed = { signed: string; hash: string };
export class IsolatedSigner extends Signer {
  constructor(private readonly record: PlayerKeyRecord) {
    super();
  }
  async getPublicKey() {
    return PublicKey.fromString(this.record.publicKey);
  }
  async signBytes(): Promise<Uint8Array> {
    throw Error("Unreviewed byte signing is disabled.");
  }
  override async signTransaction(
    tx: Parameters<KeyPairSigner["signTransaction"]>[0],
  ) {
    const encoded = encodeTransaction(tx),
      r = await vaultRequest<Signed>("signTransaction", {
        publicKey: this.record.publicKey,
        bytes: base64(encoded),
      });
    const signedTransaction = decodeSignedTransaction(bytes(r.signed));
    if (
      base64(encodeTransaction(signedTransaction.transaction)) !==
      base64(encoded)
    )
      throw Error("The signed transaction changed after review.");
    return { signedTransaction, txHash: bytes(r.hash) };
  }
  override async signDelegateAction(
    da: Parameters<KeyPairSigner["signDelegateAction"]>[0],
  ) {
    const list: VaultAction[] = da.actions.map((a) => {
      if (a.functionCall)
        return {
          kind: "functionCall",
          methodName: a.functionCall.methodName,
          args: JSON.parse(
            new TextDecoder("utf-8", { fatal: true }).decode(
              Uint8Array.from(a.functionCall.args),
            ),
          ),
          gas: String(a.functionCall.gas),
          deposit: String(a.functionCall.deposit),
        };
      if (a.addKey && a.addKey.accessKey.permission.enum === "fullAccess")
        return { kind: "addKey", publicKey: a.addKey.publicKey.toString() };
      if (a.deleteKey)
        return {
          kind: "deleteKey",
          publicKey: a.deleteKey.publicKey.toString(),
        };
      throw Error("This account action is not supported.");
    });
    const r = await vaultRequest<Signed>("signDelegate", {
      publicKey: this.record.publicKey,
      call: {
        accountId: da.senderId,
        receiverId: da.receiverId,
        actions: list,
      },
      nonce: String(da.nonce),
      maxBlockHeight: String(da.maxBlockHeight),
    });
    const signedDelegate = deserialize(
      SCHEMA.SignedDelegate,
      bytes(r.signed),
    ) as Awaited<
      ReturnType<KeyPairSigner["signDelegateAction"]>
    >["signedDelegate"];
    if (
      base64(encodeDelegateAction(signedDelegate.delegateAction)) !==
      base64(encodeDelegateAction(da))
    )
      throw Error("The signed action changed after review.");
    return { signedDelegate, delegateHash: bytes(r.hash) };
  }
  override async signNep413Message(
    accountId: string,
    params: Parameters<KeyPairSigner["signNep413Message"]>[1],
  ) {
    const r = await vaultRequest<{
      accountId: string;
      publicKey: string;
      signature: string;
    }>("signMessage", {
      publicKey: this.record.publicKey,
      accountId,
      ...params,
      nonce: base64(params.nonce),
    });
    if (r.accountId !== accountId || r.publicKey !== this.record.publicKey)
      throw Error("The account authorization changed.");
    return {
      accountId: r.accountId,
      publicKey: PublicKey.fromString(r.publicKey),
      signature: bytes(r.signature),
      state: params.callbackUrl,
    };
  }
}
