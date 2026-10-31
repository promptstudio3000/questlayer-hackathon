import { PassThrough, Readable } from "node:stream";
import { createCreatorApi } from "./api.mjs";
import { creatorAssert } from "./operations.mjs";

// Mount before the host consumes its JSON body. The host retains session, rate-limit
// and deployment controls; actor lookup receives the original IncomingMessage.
export function createNodeCreatorHandler({ authenticate, origin, ...options }) {
  creatorAssert(
    typeof authenticate === "function",
    "Creator routes require session authentication.",
    "CREATOR_CONFIG",
    500,
  );
  const incomingRequests = new WeakMap();
  const handle = createCreatorApi({
    ...options,
    origin,
    authenticate: (request) => authenticate(incomingRequests.get(request)),
  });
  return async function handleNodeCreatorRequest(req, res) {
    const url = new URL(req.url, origin);
    if (!(
      url.pathname === "/api/creator-community" ||
      url.pathname.startsWith("/api/creator-community/")
    ))
      return false;
    const headers = new Headers();
    for (const [name, value] of Object.entries(req.headers)) {
      if (value !== undefined)
        headers.set(name, Array.isArray(value) ? value.join(", ") : value);
    }
    const hasBody = !["GET", "HEAD"].includes(req.method);
    // Cancelling an oversized Web body must not destroy the HTTP socket before
    // the server can return 413. Isolate cancellation on a bounded intermediary.
    const body = hasBody ? new PassThrough() : null;
    if (body) {
      body.on("error", () => {
        req.unpipe(body);
        if (!req.destroyed) req.resume();
      });
      req.once("aborted", () =>
        body.destroy(new Error("Creator request aborted.")),
      );
      req.once("error", (error) => body.destroy(error));
      req.pipe(body);
    }
    const request = new Request(url, {
      method: req.method,
      headers,
      ...(hasBody ? { body: Readable.toWeb(body), duplex: "half" } : {}),
    });
    incomingRequests.set(request, req);
    try {
      const response = await handle(request);
      if (!response) return false;
      if (!req.complete && !req.destroyed) req.resume();
      res.writeHead(response.status, Object.fromEntries(response.headers));
      res.end(Buffer.from(await response.arrayBuffer()));
      return true;
    } finally {
      incomingRequests.delete(request);
      if (body) {
        req.unpipe(body);
        body.destroy();
        if (!req.complete && !req.destroyed) req.resume();
      }
    }
  };
}
