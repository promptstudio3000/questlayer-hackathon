import type { actions } from "near-api-js";
import type { VaultAction } from "./policy.ts";
// What the approval window reviews, decoded from the exact transaction bytes.
export function actionView(a: ReturnType<typeof actions.functionCall>): VaultAction {
  if (a.functionCall)
    return {
      kind: "functionCall",
      methodName: a.functionCall.methodName,
      args: JSON.parse(
        // Borsh decodes Vec<u8> as a plain number array, not a Uint8Array.
        new TextDecoder("utf-8", { fatal: true }).decode(
          Uint8Array.from(a.functionCall.args),
        ),
      ),
      gas: String(a.functionCall.gas),
      deposit: String(a.functionCall.deposit),
    };
  if (a.addKey) {
    if (a.addKey.accessKey.permission.enum !== "fullAccess")
      throw Error("Unsupported key permission.");
    return { kind: "addKey", publicKey: a.addKey.publicKey.toString() };
  }
  if (a.deleteKey)
    return { kind: "deleteKey", publicKey: a.deleteKey.publicKey.toString() };
  throw Error("This action is not supported by the secure account.");
}
