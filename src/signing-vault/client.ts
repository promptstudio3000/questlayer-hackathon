import { api } from "../api.ts";
import { trustedVaultMessage } from "./policy.ts";
type Reply = {
  channel: string;
  id: string;
  result?: unknown;
  error?: string;
  approval?: boolean;
};
let connection: Promise<{ frame: HTMLIFrameElement; origin: string }> | null =
  null;
function connect() {
  connection ??= api<{ signingVaultOrigin?: string | null }>("/config")
    .then(async (config) => {
      if (!config.signingVaultOrigin)
        throw Error(
          "The secure account service is not configured. Free play remains available.",
        );
      const url = new URL(config.signingVaultOrigin);
      if (
        url.origin !== config.signingVaultOrigin ||
        url.origin === location.origin ||
        (url.protocol !== "https:" &&
          !(
            url.protocol === "http:" &&
            ["localhost", "127.0.0.1"].includes(url.hostname)
          ))
      )
        throw Error("The secure account needs a separate trusted origin.");
      const frame = document.createElement("iframe");
      frame.hidden = true;
      frame.title = "QuestLayer secure signing service";
      frame.src = url.origin;
      const ready = new Promise<void>((resolve, reject) => {
        const cleanup = () => {
          clearTimeout(timeout);
          window.removeEventListener("message", receive);
        };
        const receive = (event: MessageEvent) => {
          if (
            event.origin === url.origin &&
            event.source === frame.contentWindow &&
            event.data?.channel === "questlayer-signing-vault" &&
            event.data.ready === true
          ) {
            cleanup();
            resolve();
          }
        };
        const timeout = setTimeout(() => {
          cleanup();
          frame.remove();
          reject(Error("Secure account service did not load."));
        }, 15000);
        window.addEventListener("message", receive);
        frame.onerror = () => {
          cleanup();
          frame.remove();
          reject(Error("Secure account service is unavailable."));
        };
      });
      document.body.append(frame);
      await ready;
      return { frame, origin: url.origin };
    })
    .catch((error) => {
      connection = null;
      throw error;
    });
  return connection;
}
export async function vaultRequest<T>(
  method: string,
  input: unknown = {},
): Promise<T> {
  const { frame, origin } = await connect(),
    id = crypto.randomUUID();
  return new Promise<T>((resolve, reject) => {
    let popup: Window | null = null;
    const finish = (error?: Error, result?: unknown) => {
      clearTimeout(timeout);
      window.removeEventListener("message", receive);
      if (popup && !popup.closed) popup.close();
      error ? reject(error) : resolve(result as T);
    };
    const receive = (event: MessageEvent) => {
      if (
        !trustedVaultMessage(event, origin, frame.contentWindow) ||
        event.data.id !== id
      )
        return;
      const reply = event.data as Reply;
      if (reply.approval) {
        if (popup && !popup.closed) {
          popup.focus();
          return;
        }
        popup = window.open(
          `${origin}/approve?id=${encodeURIComponent(id)}`,
          "_blank",
          "popup,width=480,height=720",
        );
        if (!popup)
          finish(
            Error(
              "Allow the secure account window, then retry this account action. No signature was released.",
            ),
          );
      } else finish(reply.error ? Error(reply.error) : undefined, reply.result);
    };
    const timeout = setTimeout(
      () =>
        finish(
          Error(
            "The secure account did not finish. Saved payments remain recoverable.",
          ),
        ),
      180000,
    );
    window.addEventListener("message", receive);
    frame.contentWindow!.postMessage(
      { channel: "questlayer-signing-vault", id, method, input },
      origin,
    );
  });
}
