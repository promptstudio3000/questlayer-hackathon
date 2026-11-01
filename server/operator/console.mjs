// Local operator web console (W11). It shows the moderation queue and the
// world/treasury health report and runs the same audited actions as the CLIs.
//
// Authority model, unchanged from the CLIs: whoever can start this process with
// OS access to the protected database is the operator. The console is never
// mounted on the public game server. scripts/operator-console.mjs binds it to
// 127.0.0.1 only (reach it through an SSH tunnel), names the operator at
// start, and prints a one-time random token. Every API call needs that token
// in an Authorization header, which a cross-site page cannot send, and a
// loopback Host header, which stops DNS rebinding.
import { timingSafeEqual, randomUUID } from "node:crypto";
import { assert } from "../domain.mjs";
import { LIVE_CITIES } from "../spatial/city-pack.mjs";
import { MODERATION_KINDS } from "../moderation.mjs";
import {
  changeDayAdjustment,
  changePlace,
  changeWorldPause,
  controlVersions,
  operatorAudit,
  worldHealthReport,
} from "./world-controls.mjs";

const LOOPBACK_HOST = /^(127\.0\.0\.1|localhost|\[::1\])(:\d{1,5})?$/;
const WORLD_ACTIONS = {
  pause: "pause",
  resume: "resume",
  adjust: "set",
  "clear-adjustment": "clear",
  "close-place": "close",
  "reopen-place": "reopen",
};

function send(res, status, body, type = "application/json; charset=utf-8") {
  res.writeHead(status, {
    "content-type": type,
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
    "referrer-policy": "no-referrer",
    "content-security-policy":
      "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  });
  res.end(typeof body === "string" ? body : JSON.stringify(body));
}
async function readJson(req) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    assert(size <= 16384, "Request body is too large.", 413);
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
  } catch {
    assert(false, "Send a JSON body.");
  }
}
function tokenMatches(header, token) {
  const given = Buffer.from(String(header || "").replace(/^Bearer /, ""));
  const want = Buffer.from(token);
  return given.length === want.length && timingSafeEqual(given, want);
}

/**
 * Request handler for the operator console. `moderation` is a Moderation
 * instance authorized for exactly `operator`; `chain` is an optional native
 * rewards reader for the report.
 */
export function createOperatorConsole(
  db,
  {
    operator,
    token,
    moderation = null,
    chain = null,
    cities = LIVE_CITIES,
    clock = Date.now,
    assets = {},
  },
) {
  assert(
    typeof operator === "string" && /^[A-Za-z0-9_.@-]{1,80}$/.test(operator),
    "Name the operator explicitly.",
  );
  assert(
    typeof token === "string" && token.length >= 32,
    "The console needs a random token of at least 32 characters.",
  );
  const authority = {
    isOperator: (actor) => actor === operator,
    clock,
    cities,
  };
  const routes = {
    "GET /api/session": () => ({
      operator,
      moderation: !!moderation,
      cities: cities.map((c) => ({
        id: c.id,
        name: c.name,
        timezone: c.timezone,
        candidates: c.candidates.map((p) => ({
          id: p.id,
          name: p.name,
          sector: p.sector,
        })),
      })),
    }),
    "GET /api/world/versions": (url) =>
      controlVersions(
        db,
        url.searchParams.get("cityId"),
        url.searchParams.get("day"),
      ),
    "GET /api/report": () =>
      worldHealthReport(db, { now: clock(), cities, chain }),
    "GET /api/audit": () => ({
      world: operatorAudit(db, { limit: 100 }),
      moderation: moderation
        ? moderation.audit(operator, { limit: 100 }).entries
        : [],
      moderationChain: moderation
        ? (moderation.operator(operator), moderation.verifyAudit())
        : null,
    }),
    "GET /api/moderation/queue": (url) => {
      assert(moderation, "Moderation is not available on this host.", 503);
      const kinds = url.searchParams.get("kind");
      return moderation.queue(operator, {
        state: url.searchParams.get("state") || "open",
        kinds: kinds ? kinds.split(",") : MODERATION_KINDS,
        limit: 50,
      });
    },
    "POST /api/moderation/decide": async (url, body) => {
      assert(moderation, "Moderation is not available on this host.", 503);
      const { kind, targetId, action, reason } = body;
      return moderation.decide(operator, { kind, targetId, action, reason });
    },
  };
  return async function handle(req, res) {
    try {
      assert(LOOPBACK_HOST.test(req.headers.host || ""), "Forbidden.", 403);
      const url = new URL(req.url, "http://127.0.0.1");
      if (req.method === "GET" && Object.hasOwn(assets, url.pathname)) {
        const asset = assets[url.pathname];
        return send(res, 200, asset.body, asset.type);
      }
      assert(url.pathname.startsWith("/api/"), "Not found.", 404);
      assert(
        tokenMatches(req.headers.authorization, token),
        "Open the console with the link printed at start.",
        401,
      );
      if (req.method === "POST")
        assert(
          String(req.headers["content-type"] || "").startsWith(
            "application/json",
          ),
          "Send application/json.",
          415,
        );
      const body = req.method === "POST" ? await readJson(req) : null;
      const route = routes[`${req.method} ${url.pathname}`];
      let result;
      if (route) result = await route(url, body);
      else {
        const match = /^\/api\/world\/([a-z-]+)$/.exec(url.pathname);
        assert(
          req.method === "POST" && match && WORLD_ACTIONS[match[1]],
          "Not found.",
          404,
        );
        result = await worldAction(match[1], url, body);
      }
      send(res, 200, result);
    } catch (error) {
      const status = Number.isInteger(error.status) ? error.status : 500;
      send(res, status, {
        error: status === 500 ? "Operator console error." : error.message,
        code: error.code || null,
      });
      if (status === 500) console.error("Operator console:", error);
    }
  };

  async function worldAction(name, url, body) {
    assert(body && typeof body === "object", "Send the operation fields.");
    // The console always acts as the operator it was started for, and each
    // click carries its own operation id so a retried request is idempotent.
    const input = {
      ...body,
      actor: operator,
      operationId: body.operationId || `console-${randomUUID()}`,
      action: WORLD_ACTIONS[name],
    };
    if (name === "pause" || name === "resume")
      return changeWorldPause(db, input, authority);
    if (name === "adjust" || name === "clear-adjustment")
      return changeDayAdjustment(db, input, {
        ...authority,
        preview: url.searchParams.get("preview") === "1",
      });
    const city = cities.find((c) => c.id === input.cityId);
    assert(city, "Select a live city.", 404);
    const { cityId, ...place } = input;
    return changePlace(db, city, place, authority);
  }
}
