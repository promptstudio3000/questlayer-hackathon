import { GameError } from "../domain.mjs";
import {
  creatorAssert as fail,
  creatorFields as fields,
} from "./operations.mjs";

const PREFIX = "/api/creator-community";
const BODY_LIMIT = 16_384;
const commonHeaders = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "private, no-store",
  "X-Content-Type-Options": "nosniff",
};
const response = (status, body) =>
  new Response(JSON.stringify(body), { status, headers: commonHeaders });
async function jsonBody(request) {
  fail(
    /^application\/json(?:\s*;|$)/i.test(
      request.headers.get("content-type") ?? "",
    ),
    "Send creator actions as JSON.",
    "CREATOR_CONTENT_TYPE",
    415,
  );
  const reader = request.body?.getReader();
  fail(reader, "A creator action body is required.", "CREATOR_INPUT", 400);
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > BODY_LIMIT) {
        await reader.cancel();
        fail(
          false,
          "Creator action body is too large.",
          "CREATOR_BODY_LIMIT",
          413,
        );
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  let value;
  try {
    value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    fail(false, "Invalid creator JSON.", "CREATOR_INPUT", 400);
  }
  fail(
    value && typeof value === "object" && !Array.isArray(value),
    "A creator action object is required.",
    "CREATOR_INPUT",
    400,
  );
  return value;
}
function query(url, allowed) {
  for (const name of url.searchParams.keys()) {
    fail(
      allowed.includes(name) && url.searchParams.getAll(name).length === 1,
      "Unsupported or repeated Community query.",
      "CREATOR_INPUT",
      400,
    );
  }
  const result = {};
  if (url.searchParams.has("limit")) {
    const value = url.searchParams.get("limit");
    fail(
      /^[1-9][0-9]?$/.test(value),
      "Invalid Community page size.",
      "CREATOR_INPUT",
      400,
    );
    result.limit = Number(value);
  }
  if (url.searchParams.has("cursor"))
    result.cursor = url.searchParams.get("cursor");
  if (url.searchParams.has("creator"))
    result.creatorId = url.searchParams.get("creator");
  if (url.searchParams.has("following")) {
    const value = url.searchParams.get("following");
    fail(
      ["true", "false"].includes(value),
      "Invalid Following filter.",
      "CREATOR_INPUT",
      400,
    );
    result.followingOnly = value === "true";
  }
  return result;
}

// Web Request/Response adapter for the existing server to mount deliberately.
// authenticate must verify the host's real session; body fields never select actor/roles.
// Moderation and completion authority are intentionally absent from player routes.
export function createCreatorApi({
  lifecycle,
  community,
  authenticate,
  origin,
  enabled = false,
}) {
  const siteOrigin = new URL(origin).origin;
  fail(
    typeof authenticate === "function",
    "Creator routes require session authentication.",
    "CREATOR_CONFIG",
    500,
  );
  return async function handleCreatorRequest(request) {
    const url = new URL(request.url);
    if (!(url.pathname === PREFIX || url.pathname.startsWith(PREFIX + "/")))
      return null;
    if (enabled !== true)
      return response(404, {
        error: "Creator Community is not enabled.",
        code: "CREATOR_DISABLED",
      });
    try {
      fail(
        url.origin === siteOrigin,
        "Creator request origin does not match this application.",
        "CREATOR_ORIGIN",
        403,
      );
      const write = !["GET", "HEAD"].includes(request.method);
      if (write)
        fail(
          request.headers.get("origin") === siteOrigin,
          "Open this creator action from the application.",
          "CREATOR_ORIGIN",
          403,
        );
      const actor = await authenticate(request);
      fail(
        typeof actor === "string" && actor.length > 0,
        "Sign in to use Community.",
        "CREATOR_AUTH",
        401,
      );
      const suffix = url.pathname.slice(PREFIX.length);
      const parts = suffix
        .split("/")
        .filter(Boolean)
        .map((part) => decodeURIComponent(part));
      let result;
      if (request.method === "GET") {
        const options = query(
          url,
          parts.length === 1 && parts[0] === "quests"
            ? ["limit", "cursor", "creator", "following"]
            : (parts.length === 1 && parts[0] === "creators") ||
                suffix === "/me/quests"
              ? ["limit", "cursor"]
              : [],
        );
        if (suffix === "/me")
          result = {
            domain: "demo",
            profile: community.myProfile(actor),
            progression: lifecycle.progression(actor),
          };
        else if (suffix === "/me/quests")
          result = community.myCreations(actor, options);
        else if (suffix === "/creators")
          result = community.listCreators(actor, options);
        else if (suffix === "/quests")
          result = community.listQuests(actor, options);
        else if (parts.length === 2 && parts[0] === "creators")
          result = community.profile(actor, parts[1]);
        else if (parts.length === 2 && parts[0] === "quests")
          result = community.publicQuest(actor, parts[1]);
        else if (
          parts.length === 3 &&
          parts[0] === "quests" &&
          parts[2] === "participation"
        )
          result = community.myParticipation(actor, parts[1]);
        else if (
          parts.length === 3 &&
          parts[0] === "quests" &&
          parts[2] === "publication-quote"
        )
          result = lifecycle.publicationQuote(actor, parts[1]);
        else
          return response(404, {
            error: "Creator route not found.",
            code: "CREATOR_NOT_FOUND",
          });
      } else {
        query(url, []);
        fail(
          ["POST", "PUT"].includes(request.method),
          "Creator method not supported.",
          "CREATOR_METHOD",
          405,
        );
        const body = await jsonBody(request);
        if (request.method === "PUT" && suffix === "/profile") {
          fields(body, [
            "operationId",
            "expectedVersion",
            "profile",
            "publicConsent",
          ]);
          result = community.saveProfile({ actor, ...body });
        } else if (
          request.method === "PUT" &&
          parts.length === 3 &&
          parts[0] === "creators" &&
          parts[2] === "follow"
        ) {
          fields(body, ["operationId", "following"]);
          result = community.setFollowing({
            actor,
            creatorId: parts[1],
            ...body,
          });
        } else if (request.method === "POST" && suffix === "/quests") {
          fields(body, ["operationId", "questId", "draft"]);
          result = lifecycle.createDraft({ actor, ...body });
        } else if (
          request.method === "POST" &&
          parts.length === 3 &&
          parts[0] === "quests"
        ) {
          const actions = {
            revisions: ["revise", ["operationId", "expectedVersion", "draft"]],
            submit: [
              "submit",
              ["operationId", "expectedVersion", "expectedPolicyVersion"],
            ],
            "withdraw-review": [
              "withdrawReview",
              ["operationId", "expectedVersion"],
            ],
            close: ["close", ["operationId", "expectedVersion"]],
            finalize: ["finalize", ["operationId", "expectedVersion"]],
            participation: ["start", ["operationId"]],
          };
          const action = Object.hasOwn(actions, parts[2])
            ? actions[parts[2]]
            : null;
          if (!action)
            return response(404, {
              error: "Creator route not found.",
              code: "CREATOR_NOT_FOUND",
            });
          fields(body, action[1]);
          result = lifecycle[action[0]]({ actor, questId: parts[1], ...body });
        } else
          return response(404, {
            error: "Creator route not found.",
            code: "CREATOR_NOT_FOUND",
          });
      }
      return response(200, result);
    } catch (error) {
      if (error instanceof URIError)
        return response(400, {
          error: "Invalid creator route.",
          code: "CREATOR_INPUT",
        });
      if (error instanceof GameError)
        return response(error.status, {
          error: error.message,
          code: error.code,
        });
      return response(500, {
        error:
          "Creator action could not be confirmed. Retry with the same operation ID.",
        code: "CREATOR_UNAVAILABLE",
      });
    }
  };
}
