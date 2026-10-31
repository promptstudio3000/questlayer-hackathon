import { createCreatorServices } from "./services.mjs";
import { createNodeCreatorHandler } from "./node-handler.mjs";
import { creatorAssert as fail, creatorKey } from "./operations.mjs";

export function creatorConfiguration(env = process.env) {
  const flag = env.CREATOR_COMMUNITY_ENABLED;
  fail(
    flag === undefined || ["0", "1", ""].includes(flag),
    "CREATOR_COMMUNITY_ENABLED must be 0 or 1.",
    "CREATOR_CONFIG",
    500,
  );
  if (flag !== "1")
    return {
      enabled: false,
      policy: null,
      moderators: [],
      completionAuthorities: [],
    };
  const amount = env.CREATOR_XP_COMMITMENT;
  fail(
    typeof amount === "string" &&
      /^[1-9][0-9]*$/.test(amount) &&
      Number.isSafeInteger(Number(amount)),
    "Enabling creators requires an explicit positive safe-integer CREATOR_XP_COMMITMENT.",
    "CREATOR_CONFIG",
    500,
  );
  const version = creatorKey(env.CREATOR_POLICY_VERSION);
  const roles = (value, name) => {
    const list = String(value || "")
      .split(",")
      .map((v) => v.trim())
      .filter(Boolean);
    fail(
      list.length > 0 && list.length <= 100,
      `Enabling creators requires explicit ${name}.`,
      "CREATOR_CONFIG",
      500,
    );
    return [...new Set(list.map(creatorKey))];
  };
  return {
    enabled: true,
    policy: { version, xpCommitment: Number(amount) },
    moderators: roles(env.CREATOR_MODERATORS, "CREATOR_MODERATORS"),
    completionAuthorities: roles(
      env.CREATOR_COMPLETION_AUTHORITIES,
      "CREATOR_COMPLETION_AUTHORITIES",
    ),
  };
}

// No operator capability is derived from a player's request/session. The runtime
// mounts only player operations; trusted operator actions use the local CLI.
export function createCreatorRuntime(
  db,
  { env = process.env, origin, authenticate, clock = Date.now },
) {
  const config = creatorConfiguration(env);
  const services = config.enabled
    ? createCreatorServices(db, {
        policy: config.policy,
        clock,
        isModerator: (actor) => config.moderators.includes(actor),
        isCompletionAuthority: (actor) =>
          config.completionAuthorities.includes(actor),
      })
    : null;
  const status = {
    enabled: config.enabled,
    domain: "demo",
    policy: config.policy,
    rewards: "not-configured",
    native: false,
    reviewConfigured: config.moderators.length > 0,
    completionConfigured: config.completionAuthorities.length > 0,
  };
  const playerHandler = createNodeCreatorHandler({
    ...services,
    enabled: config.enabled,
    origin,
    authenticate,
  });
  async function handle(req, res) {
    const url = new URL(req.url, origin);
    if (url.pathname !== "/api/creator-community/status")
      return playerHandler(req, res);
    fail(
      req.method === "GET",
      "Use GET for creator status.",
      "CREATOR_METHOD",
      405,
    );
    fail(
      !url.search,
      "Creator status takes no query parameters.",
      "CREATOR_INPUT",
      400,
    );
    const actor = await authenticate(req);
    fail(
      typeof actor === "string" && actor.length > 0,
      "Sign in to use Community.",
      "CREATOR_AUTH",
      401,
    );
    res.writeHead(200, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    });
    res.end(JSON.stringify(status));
    return true;
  }
  return { config, status, services, handle };
}
