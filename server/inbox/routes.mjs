// HTTP routes of the encrypted player inbox (docs/PLAYER-INBOX.md).
//   GET  /api/inbox                       conversations, requests, unread
//   GET  /api/inbox/summary               { unread, requests } for the badge
//   GET  /api/inbox/thread?playerId=      message index (ciphertext ids only), marks read
//   POST /api/inbox/key/prepare {publicKey}   SocialDB set for the public inbox key
//   POST /api/inbox/key/sync              reads the published key from chain
//   POST /api/inbox/request {playerId}    ask to message (opens at once after a mutual wave)
//   POST /api/inbox/answer {playerId,accept}
//   POST /api/inbox/send {playerId,messageId,record}  SocialDB set for one message
//   POST /api/inbox/confirm {messageId}   delivered once the record is on chain
//   POST /api/inbox/report {messageId,reason,messageKey?}
//   GET  /api/inbox/reports, POST /api/inbox/reports/resolve   moderators
const ROUTES = new Set([
  "GET /api/inbox",
  "GET /api/inbox/summary",
  "GET /api/inbox/thread",
  "POST /api/inbox/key/prepare",
  "POST /api/inbox/key/sync",
  "POST /api/inbox/request",
  "POST /api/inbox/answer",
  "POST /api/inbox/send",
  "POST /api/inbox/confirm",
  "POST /api/inbox/report",
  "GET /api/inbox/reports",
  "POST /api/inbox/reports/resolve",
]);
export function createInboxRoutes(inbox, { perMinute = 120 } = {}) {
  const rates = new Map();
  return {
    async handle(req, res, url, { player, body, respond, assert }) {
      const path = url.pathname,
        method = req.method || "GET";
      if (path !== "/api/inbox" && !path.startsWith("/api/inbox/")) return false;
      if (!inbox) {
        respond(res, { enabled: false, unread: 0, requests: 0 });
        return true;
      }
      assert(ROUTES.has(`${method} ${path}`), "Not found.", 404, "NOT_FOUND");
      assert(player, "Sign in to use messages.", 401, "AUTH");
      const minute = Math.floor(Date.now() / 60000),
        key = `${player}:${minute}`,
        count = (rates.get(key) || 0) + 1;
      if (rates.size > 5000) rates.clear();
      rates.set(key, count);
      assert(count <= perMinute, "Please wait a moment before checking messages again.", 429);
      const input = method === "POST" ? await body(req) : null;
      const q = (name) => url.searchParams.get(name);
      let result;
      if (path === "/api/inbox") result = inbox.overview(player);
      else if (path === "/api/inbox/summary") result = inbox.summary(player);
      else if (path === "/api/inbox/thread") result = inbox.thread(player, q("playerId"), { before: q("before") });
      else if (path === "/api/inbox/key/prepare") result = await inbox.keyQuote(player, input?.publicKey);
      else if (path === "/api/inbox/key/sync") result = await inbox.syncKey(player);
      else if (path === "/api/inbox/request") result = inbox.request(player, input?.playerId);
      else if (path === "/api/inbox/answer") result = inbox.answer(player, input?.playerId, input?.accept === true);
      else if (path === "/api/inbox/send") result = await inbox.sendQuote(player, input);
      else if (path === "/api/inbox/confirm") result = await inbox.confirmMessage(player, input?.messageId);
      else if (path === "/api/inbox/report") result = inbox.report(player, input);
      else if (path === "/api/inbox/reports") result = inbox.reports(player);
      else result = inbox.resolve(player, input);
      respond(res, result);
      return true;
    },
  };
}
