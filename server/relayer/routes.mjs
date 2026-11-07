import { nearAccountId } from "../identity/near.mjs";
import { NETWORK } from "../native/network.mjs";

// Player-facing routes. The parent server authenticates the player, parses the
// body and owns the response helpers; this handler only dispatches.
export function createRelayerRoutes({ relayer = null, accounts = null, authorizeEnrollment } = {}) {
  const checkEnrollment = (req, player) => {
    if (typeof authorizeEnrollment !== "function") throw new Error("Account authorization is unavailable.");
    authorizeEnrollment(req, player);
  };
  async function handle(req, res, url, { player, body, respond, assert }) {
    const path = url.pathname,
      method = req.method || "GET";
    if (!path.startsWith("/api/account") && !path.startsWith("/api/relay"))
      return false;
    const relayId = /^\/api\/relay\/([^/]+)$/.exec(path);
    if (path === "/api/account" && method === "GET") {
      respond(
        res,
        accounts
          ? accounts.view(player)
          : { network: NETWORK, enabled: false, account: null },
      );
      return true;
    }
    if (path === "/api/account/create" && method === "POST") {
      assert(
        accounts?.factory,
        "Managed accounts are disabled on this host.",
        503,
        "ACCOUNT_DISABLED",
      );
      const input = await body(req);
      respond(
        res,
        await accounts.create(player, {
          publicKey: input.publicKey,
          name: input.name,
          authorizeEnrollment: () => checkEnrollment(req, player),
        }),
        201,
      );
      return true;
    }
    if (path === "/api/account/keys" && method === "POST") {
      assert(
        accounts?.factory,
        "Managed accounts are disabled on this host.",
        503,
        "ACCOUNT_DISABLED",
      );
      const input = await body(req);
      checkEnrollment(req, player);
      respond(
        res,
        input.remove
          ? accounts.requestKeyRemoval(player, { publicKey: input.publicKey })
          : await accounts.requestKey(player, {
              publicKey: input.publicKey,
              kind: input.kind,
              label: input.label,
            }),
      );
      return true;
    }
    if (path === "/api/relay/prepare" && method === "POST") {
      assert(
        relayer?.enabled,
        "Sponsored transactions are disabled on this host.",
        503,
        "RELAY_DISABLED",
      );
      const input = await body(req);
      respond(res, await relayer.prepare(player, input));
      return true;
    }
    if (path === "/api/relay" && method === "POST") {
      assert(
        relayer?.enabled,
        "Sponsored transactions are disabled on this host.",
        503,
        "RELAY_DISABLED",
      );
      const input = await body(req);
      const job = await relayer.submit(player, {
        signedDelegateBase64: input.signedDelegateBase64,
        preview: input.preview,
      });
      respond(res, job, job.duplicate ? 200 : 202);
      return true;
    }
    if (path === "/api/relay" && method === "GET") {
      assert(
        relayer,
        "Sponsored transactions are disabled on this host.",
        503,
        "RELAY_DISABLED",
      );
      const account = url.searchParams.get("account");
      respond(
        res,
        relayer.list(player, account ? nearAccountId(account) : undefined),
      );
      return true;
    }
    if (relayId && method === "GET") {
      assert(
        relayer,
        "Sponsored transactions are disabled on this host.",
        503,
        "RELAY_DISABLED",
      );
      respond(res, relayer.status(player, decodeURIComponent(relayId[1])));
      return true;
    }
    return false;
  }
  return { handle };
}
