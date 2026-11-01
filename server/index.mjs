import { defaultDatabasePath } from "./state-path.mjs";
import { NativeTransactionConfirmation } from "./native/transaction-confirmation.mjs";
import { createCreatorRuntime } from "./creators/runtime.mjs";
import { createAdventureResults } from "./adventure-results.mjs";
import { recordSchemaVersions, schemaStatus } from "./schema-compatibility.mjs";
import { NoteMedia } from "./note-media.mjs";
import { TaskEvidence, evidenceTaskView } from "./task-evidence.mjs";
import { Moderation } from "./moderation.mjs";
import { SocialContent, isSocialBlocked } from "./social-content.mjs";
import { NativeProgression } from "./native/progression.mjs";
import { NativeTasks, TASK_CONTRACT } from "./native/tasks.mjs";
import { updatePresence, readNearbyPresence } from "./presence.mjs";
import { GotchiModels } from "./gotchi-models.mjs";
import {
  GotchiItemArt,
  linkedItemId,
  originalInventoryView,
} from "./gotchi-items.mjs";
import { publicAppearances, sharedOriginalSvg } from "./appearance.mjs";
import { NativeMarket } from "./native/market.mjs";
import { NativeEconomy } from "./native/economy.mjs";
import { questTemplateCatalog } from "./quest-templates.mjs";
import { NativeRewards } from "./native/rewards.mjs";
import { startRewardWorker } from "./native/reward-worker.mjs";
import { allocationSettings } from "./native/allocation.mjs";
import { relayerConfiguration } from "./relayer/config.mjs";
import { loadServiceAccount } from "./relayer/key-transport.mjs";
import { ManagedAccounts } from "./relayer/accounts.mjs";
import { Relayer, startRelayWorker } from "./relayer/relay.mjs";
import { createRelayerRoutes } from "./relayer/routes.mjs";
import {
  CreatorMoney,
  createCreatorMoneyRoutes,
  loadCreatorsManifest,
  loadCreatorsPublisher,
  startCreatorMoneyWorker,
} from "./native/creator-money.mjs";
import { auditDistribution, auditSummary } from "./native/distribution.mjs";
import {
  NativeSocialRecords,
  createSocialRecordRoutes,
  httpPinAdapter,
  startPinWorker,
} from "./native/social-records.mjs";
import { NativeVaults, FACTORY_ID, VAULT_POOLS } from "./native/vaults.mjs";
import { NativeSocialProfile } from "./native/social-profile.mjs";
import { resolvePublicFile } from "./static-files.mjs";
import { AwardVouchers, loadAwardSigner } from "./native/award-vouchers.mjs";
import { startWorldPlanner, worldPreparationStatus } from "./world-planner.mjs";
import { readGotchis } from "./aavegotchi.mjs";
import { verifyMessage as verifyEvmMessage, isAddress } from "viem";
import { createServer } from "node:http";
import { NativeCollectibles } from "./native/collectibles.mjs";
import { clientAddress } from "./http-security.mjs";
import { readFileSync, existsSync, createReadStream } from "node:fs";
import { resolve, extname, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  NETWORK,
  NETWORK_LABEL,
  ENABLED_FEATURES,
  featureEnabled,
  DEFAULT_RPC,
  manifestName,
} from "./native/network.mjs";
const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
import { randomBytes } from "node:crypto";
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from "@simplewebauthn/server";
import {
  nearAccountId,
  verifyNearIdentity,
  assertTestnetRpc,
} from "./identity/near.mjs";
import { createNearProvider } from "./near-provider.mjs";
import { IdentitySessions } from "./identity/sessions.mjs";
import {
  openDatabase,
  atomic,
  playerView,
  history,
  createPlayer,
} from "./database.mjs";
import {
  HOME,
  ensureWorld,
  worldView,
  expireWorlds,
  retryStreetWorlds,
} from "./world.mjs";
import { worldQuery } from "./spatial/world-query.mjs";
import * as game from "./game.mjs";
import {
  GOLD,
  DAY,
  assert,
  id,
  hash,
  point,
  tierFor,
  positionTier,
} from "./domain.mjs";

if (existsSync(".env")) process.loadEnvFile(".env");
const nativeAttestationsDisabled =
  process.env.DISABLE_NATIVE_ATTESTATIONS === "1";
const backgroundWorkersDisabled =
  process.env.DISABLE_BACKGROUND_WORKERS === "1";
const db = openDatabase();
const adventureResults = createAdventureResults(db);
const socialContent = new SocialContent(db);
const noteMedia = new NoteMedia();
// Private sponsored-task photos and the shared report intake. Operator
// decisions are made only through server/cli/moderate.mjs.
const taskEvidence = new TaskEvidence(db);
const moderation = new Moderation(db, { evidence: taskEvidence });
const port = Number(process.env.PORT || 8787),
  origin = process.env.APP_ORIGIN || "http://localhost:5173",
  rpID = new URL(origin).hostname;
const creatorRuntime = createCreatorRuntime(db, { origin, authenticate: auth });
const rpc = process.env.NEAR_RPC_URL || DEFAULT_RPC;
const provider = createNearProvider(rpc);
const identitySessions = new IdentitySessions(db, { origin, provider });
const deploymentManifestPath = existsSync(
  resolve(APP_ROOT, `public/${NETWORK}-deployment.json`),
)
  ? resolve(APP_ROOT, `public/${NETWORK}-deployment.json`)
  : resolve(APP_ROOT, `dist/${NETWORK}-deployment.json`);
const deploymentManifest = JSON.parse(
  readFileSync(deploymentManifestPath, "utf8"),
);
const nativeCollectibles = new NativeCollectibles(
  provider,
  process.env.NEAR_COLLECTIBLES_CONTRACT ||
    deploymentManifest.collectiblesContract,
);
const nativeSocialProfile = new NativeSocialProfile(
  provider,
  nativeCollectibles,
);
// Public note records on NEAR Social from the player's own account; photo
// pinning runs only when an IPFS add endpoint is configured.
const socialRecords = new NativeSocialRecords(db, provider, {
  media: noteMedia,
  pinAdapter: httpPinAdapter({
    url: process.env.IPFS_ADD_URL || "",
    token: process.env.IPFS_ADD_TOKEN || "",
  }),
});
const socialRecordRoutes = createSocialRecordRoutes(
  featureEnabled("social") ? socialRecords : null,
);
const linkedAccount = (player, accountId) =>
  accountId
    ? (db
        .prepare(
          "SELECT account_id FROM wallet_links WHERE player_id=? AND account_id=?",
        )
        .get(player, accountId)?.account_id ?? null)
    : (db
        .prepare(
          "SELECT account_id FROM wallet_links WHERE player_id=? ORDER BY verified_at LIMIT 1",
        )
        .get(player)?.account_id ?? null);
db.exec(
  `CREATE TABLE IF NOT EXISTS passkeys(id TEXT PRIMARY KEY,player_id TEXT NOT NULL REFERENCES players(id),public_key TEXT NOT NULL,counter INTEGER NOT NULL,transports TEXT NOT NULL);`,
);
const marketManifestPath = [
  resolve(APP_ROOT, `public/${manifestName("native-market")}`),
  resolve(APP_ROOT, `dist/${manifestName("native-market")}`),
].find((path) => existsSync(path));
const marketContractId = !featureEnabled("market")
  ? null
  : process.env.NEAR_MARKET_CONTRACT ||
    (marketManifestPath
      ? JSON.parse(readFileSync(marketManifestPath, "utf8")).marketContract
      : null);
const nativeMarket = marketContractId
  ? new NativeMarket(provider, marketContractId, nativeCollectibles)
  : null;
const awardSigner = nativeAttestationsDisabled
  ? null
  : loadAwardSigner(
      process.env.AWARD_SIGNER_PATH ||
        resolve(dirname(defaultDatabasePath()), "award-attestor.pem"),
    );
const awardVouchers = new AwardVouchers(db, nativeCollectibles, awardSigner);
const rewardsManifestPath = [
  resolve(APP_ROOT, `public/${manifestName("native-rewards")}`),
  resolve(APP_ROOT, `dist/${manifestName("native-rewards")}`),
].find((p) => existsSync(p));
const rewardsConfig =
  rewardsManifestPath && featureEnabled("rewards")
    ? JSON.parse(readFileSync(rewardsManifestPath, "utf8"))
    : null;
const nativeRewards =
  !nativeAttestationsDisabled &&
  rewardsConfig &&
  process.env.REWARD_ATTESTOR_PATH
    ? new NativeRewards(
        db,
        provider,
        rewardsConfig,
        loadAwardSigner(process.env.REWARD_ATTESTOR_PATH),
      )
    : null;
const nativeVaults =
  rewardsConfig?.factory && featureEnabled("vaults")
    ? new NativeVaults(db, provider, rewardsConfig)
    : null;
// Invisible player accounts and sponsored gas. Without the service keys the
// routes answer "disabled" and play continues on the practice ledger.
const relayConfig = relayerConfiguration(
  featureEnabled("relayer") ? process.env : { DISABLE_RELAYER: "1" },
);
const factoryService = relayConfig.accountsEnabled
  ? await loadServiceAccount(provider, relayConfig.factoryKeyPath, {
      expectAccountId: relayConfig.factoryAccount,
    })
  : null;
const managedAccounts = relayConfig.factoryAccount
  ? new ManagedAccounts(db, provider, factoryService?.account ?? null, {
      factoryId: relayConfig.factoryAccount,
      fundYocto: relayConfig.fundYocto,
      topupCapYocto: relayConfig.topupCapYocto,
    })
  : null;
const relayer = managedAccounts
  ? new Relayer(
      db,
      provider,
      relayConfig.enabled
        ? await loadServiceAccount(provider, relayConfig.relayerKeyPath)
        : null,
      {
        accounts: managedAccounts,
        contracts: {
          collectibles: nativeCollectibles.contractId,
          market: marketContractId,
          factory: rewardsConfig?.factory?.contractId || FACTORY_ID,
          creators:
            featureEnabled("creators") &&
            existsSync(
              resolve(APP_ROOT, `public/${manifestName("native-creators")}`),
            )
              ? JSON.parse(
                  readFileSync(
                    resolve(
                      APP_ROOT,
                      `public/${manifestName("native-creators")}`,
                    ),
                    "utf8",
                  ),
                ).contractId
              : undefined,
          rewards: !featureEnabled("rewards")
            ? undefined
            : rewardsConfig?.contractId ||
              JSON.parse(
                readFileSync(
                  resolve(APP_ROOT, `public/${manifestName("native-rewards")}`),
                  "utf8",
                ),
              ).contractId,
        },
        blockTtl: relayConfig.blockTtl,
        maxJobsPerDay: relayConfig.maxJobsPerDay,
        maxGas: relayConfig.maxGas,
        vaults: nativeVaults,
        factorySetupDeposit: rewardsConfig?.factory?.setupDeposit ?? null,
        factoryPools: VAULT_POOLS.map((p) => p.id),
      },
    )
  : null;
const relayerRoutes = createRelayerRoutes({
  relayer,
  accounts: managedAccounts,
});
if (nativeRewards) {
  nativeRewards.vaultRegistry = nativeVaults;
  Object.assign(nativeRewards, allocationSettings(process.env));
}
// Creator money (W09): reads and quotes work from the manifest alone; the
// publisher outbox mirrors published quests, completions, likes and daily
// rounds on chain only when the publisher key is configured.
const creatorsManifestPath = resolve(
  APP_ROOT,
  `public/${manifestName("native-creators")}`,
);
// Hosts with neither the publisher key nor the creator community keep their
// schema free of creator tables; the routes then answer "not configured".
const creatorsManifest =
  featureEnabled("creators") &&
  existsSync(creatorsManifestPath) &&
  (process.env.CREATORS_PUBLISHER_KEY_PATH ||
    process.env.CREATOR_COMMUNITY_ENABLED === "1")
    ? loadCreatorsManifest(creatorsManifestPath)
    : null;
const creatorMoney = creatorsManifest
  ? new CreatorMoney(db, provider, creatorsManifest, {
      transport: process.env.CREATORS_PUBLISHER_KEY_PATH
        ? await loadCreatorsPublisher(
            provider,
            process.env.CREATORS_PUBLISHER_KEY_PATH,
            creatorsManifest.contractId,
          )
        : null,
      roundBudgetYocto:
        process.env.CREATOR_ROUND_BUDGET_YOCTO || "10000000000000000000000",
      maxRoundBudgetYocto: creatorsManifest.policy?.max_round_budget ?? null,
    })
  : null;
const creatorMoneyRoutes = createCreatorMoneyRoutes(creatorMoney);
const nativeEconomy = nativeRewards ? new NativeEconomy(nativeRewards) : null;
const tasksManifestPath = [
  resolve(APP_ROOT, `public/${manifestName("native-tasks")}`),
  resolve(APP_ROOT, `dist/${manifestName("native-tasks")}`),
].find((p) => existsSync(p));
const nativeTasks = new NativeTasks(
  db,
  provider,
  tasksManifestPath && featureEnabled("tasks")
    ? JSON.parse(readFileSync(tasksManifestPath, "utf8"))
    : null,
);
const claimsManifestPath = [
  resolve(APP_ROOT, `public/${manifestName("native-claims")}`),
  resolve(APP_ROOT, `dist/${manifestName("native-claims")}`),
].find((p) => existsSync(p));
const claimsManifest = claimsManifestPath
  ? JSON.parse(readFileSync(claimsManifestPath, "utf8"))
  : null;
const nativeProgression = nativeRewards
  ? new NativeProgression(nativeRewards, nativeCollectibles, awardSigner, {
      collectiblesWasmSha256:
        claimsManifest?.network === NETWORK &&
        claimsManifest?.contractId === nativeCollectibles.contractId
          ? claimsManifest.wasmSha256
          : undefined,
    })
  : null;
const nativeTransactionConfirmation = new NativeTransactionConfirmation(
  db,
  provider,
  {
    rewardsConfig,
    marketManifest: marketManifestPath
      ? JSON.parse(readFileSync(marketManifestPath, "utf8"))
      : null,
    claimsManifest,
    vaults: nativeVaults,
  },
);
const gotchiModels = new GotchiModels();
const gotchiItemArt = new GotchiItemArt();
const originalLookups = new Map();
recordSchemaVersions(db);
async function refreshOriginals(address) {
  if (originalLookups.has(address)) return originalLookups.get(address);
  assert(
    originalLookups.size < 3,
    "Original inventory checks are busy. Please try again shortly.",
    503,
  );
  const task = readGotchis(address);
  originalLookups.set(address, task);
  try {
    return await task;
  } finally {
    originalLookups.delete(address);
  }
}
const listeners = new Set(),
  rates = new Map();
function emit(type, data) {
  const event = `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of listeners) client.write(event);
}
function cookie(token) {
  return `questlayer-hackathon=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000${origin.startsWith("https:") ? "; Secure" : ""}`;
}
function sessionToken(req) {
  return (
    req.headers.cookie?.match(
      /(?:^|; )questlayer-hackathon=([a-f0-9]{64})(?:;|$)/,
    )?.[1] ||
    req.headers.cookie?.match(/(?:^|; )auratrail=([a-f0-9]{64})(?:;|$)/)?.[1]
  );
}
function auth(req) {
  return identitySessions.authenticate(sessionToken(req)).playerId;
}
function newSession(player, kind = "guest", accountId = null) {
  const token = randomBytes(32).toString("hex");
  db.prepare("INSERT INTO sessions VALUES (?,?,?)").run(
    hash(token),
    player,
    Date.now() + 30 * DAY,
  );
  identitySessions.record(token, kind, accountId);
  return token;
}
function challenge(prefix, data) {
  const c = id(prefix),
    nonce = randomBytes(32).toString("base64");
  db.prepare("INSERT INTO auth_challenges VALUES (?,?,?,0)").run(
    c,
    JSON.stringify({ nonce, ...data }),
    Date.now() + 300_000,
  );
  return { id: c, nonce };
}
function readChallenge(challengeId) {
  assert(
    typeof challengeId === "string" && challengeId.length <= 160,
    "Start a new sign-in request.",
    401,
  );
  const c = db
    .prepare(
      "SELECT * FROM auth_challenges WHERE id=? AND expires_at>? AND used=0",
    )
    .get(challengeId, Date.now());
  assert(c, "That sign-in request expired. Try again.", 401);
  return JSON.parse(c.nonce);
}
function consumeChallenge(challengeId) {
  assert(
    db
      .prepare(
        "UPDATE auth_challenges SET used=1 WHERE id=? AND used=0 AND expires_at>?",
      )
      .run(challengeId, Date.now()).changes === 1,
    "This challenge has expired or already been used.",
    401,
  );
}
async function body(req) {
  let size = 0;
  const chunks = [];
  for await (const c of req) {
    size += c.length;
    assert(
      size <= 1_500_000,
      "That file is too large. Choose a smaller one.",
      413,
    );
    chunks.push(c);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString() || "{}");
  } catch {
    assert(false, "Invalid request.");
  }
}
function respond(res, data, status = 200, headers = {}) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    ...headers,
  });
  res.end(JSON.stringify(data));
}
function profile(player) {
  const p = playerView(db, player);
  if (p.appearance.originTokenId) {
    const link = db
      .prepare("SELECT * FROM external_links WHERE player_id=? AND address=?")
      .get(player, p.appearance.address);
    if (
      !link ||
      link.verified_at < Date.now() - 300000 ||
      !JSON.parse(link.data).gotchis?.some(
        (g) => g.tokenId === p.appearance.originTokenId,
      )
    )
      p.appearance = {};
  }
  return {
    ...p,
    nativeOutfit: !!p.native_outfit,
    nativeAccount: p.native_account || p.wallets[0]?.account_id || null,
    coinsCollected: db
      .prepare("SELECT COUNT(*) AS n FROM coins WHERE claimant=?")
      .get(player).n,
    level: p.level,
    tier: tierFor(p.positions.reduce((s, x) => s + positionTier(x), 0)),
    weighted_u: p.positions.reduce((s, x) => s + positionTier(x), 0),
  };
}

async function api(req, res, url) {
  const path = url.pathname,
    method = req.method || "GET";
  if (method !== "GET") {
    const allowed = new Set([
      origin,
      ...(process.env.NODE_ENV === "production"
        ? []
        : [
            "http://localhost:5173",
            "http://127.0.0.1:5173",
            "http://localhost:8787",
            "http://127.0.0.1:8787",
          ]),
    ]);
    assert(
      !req.headers.origin || allowed.has(req.headers.origin),
      "Request origin is not allowed.",
      403,
    );
    assert(
      req.headers["content-type"]?.startsWith("application/json"),
      "JSON is required.",
      415,
    );
    const address = clientAddress(req, process.env.TRUST_PROXY === "loopback"),
      key = `${address}:${Math.floor(Date.now() / 60_000)}`;
    const n = (rates.get(key) || 0) + 1;
    rates.set(key, n);
    assert(n <= 600, "Please try again shortly.", 429);
  }
  if (await creatorRuntime.handle(req, res)) return;
  if (path === "/api/health")
    return respond(res, {
      status: "ok",
      app: "QuestLayer",
      version: "0.1.0",
      network: NETWORK,
      features: ENABLED_FEATURES,
      ...schemaStatus(db, { buildId: process.env.QUESTLAYER_BUILD_ID }),
      mode: "demo",
      worldPreparation: worldPreparationStatus(db),
      nativeRewards: nativeRewards
        ? nativeRewards.workerStatus()
        : { status: "not-configured" },
      distribution: nativeRewards
        ? auditSummary(nativeRewards.lastAudit)
        : { status: "not-configured" },
      yieldBackedDays: nativeRewards?.yieldBackedDays === true,
      relayer: relayer ? relayer.workerStatus() : { status: "not-configured" },
      creatorMoney: creatorMoney
        ? creatorMoney.workerStatus()
        : { status: "not-configured" },
      socialRecords: featureEnabled("social")
        ? socialRecords.workerStatus()
        : { status: "not-configured" },
      now: Date.now(),
    });
  if (path === "/api/quest-templates" && method === "GET")
    return respond(res, questTemplateCatalog());
  if (path === "/api/native/distribution" && method === "GET") {
    assert(nativeRewards, "Native rewards are not configured yet.", 503);
    // Public chain facts only; fresh on request, cached result otherwise.
    const fresh =
      url.searchParams.get("refresh") === "1" || !nativeRewards.lastAudit;
    if (fresh) nativeRewards.lastAudit = await auditDistribution(nativeRewards);
    return respond(res, nativeRewards.lastAudit);
  }
  if (path === "/api/native/economy" && method === "GET") {
    assert(nativeEconomy, "Native economy is not configured yet.", 503);
    return respond(res, await nativeEconomy.snapshot());
  }
  if (path === "/api/config")
    return respond(res, {
      mode: "demo",
      network: NETWORK,
      features: ENABLED_FEATURES,
      rpcUrl: rpc,
      coinValue: 0.01,
      coinSplit: 50,
      zoneSplit: 50,
      chainReady: false,
      passkeyKind: "demo-identity",
      nearWalletSignIn: true,
      contracts: {
        game: process.env.NEAR_GAME_CONTRACT || null,
        vault: process.env.NEAR_VAULT_CONTRACT || null,
        collectibles: nativeCollectibles.contractId,
        intents: process.env.NEAR_INTENTS_CONTRACT || null,
      },
      nearAI: !!process.env.NEAR_AI_API_KEY,
    });
  if (path === "/api/session" && method === "POST") {
    const input = await body(req);
    const result = game.session(db, input.name);
    identitySessions.record(result.token, "guest");
    return respond(res, { player: profile(result.player.id) }, 201, {
      "Set-Cookie": cookie(result.token),
    });
  }
  if (path === "/api/logout" && method === "POST") {
    const player = auth(req);
    const token = sessionToken(req);
    if (token)
      db.prepare("DELETE FROM sessions WHERE token_hash=?").run(hash(token));
    db.prepare("DELETE FROM presence WHERE player_id=?").run(player);
    return respond(res, { ok: true }, 200, {
      "Set-Cookie": [
        cookie("").replace("Max-Age=2592000", "Max-Age=0"),
        "auratrail=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0",
      ],
    });
  }
  if (path === "/api/passkey/options" && method === "POST") {
    const input = await body(req);
    assert(
      input.action === "register" || input.action === "login",
      "Choose passkey sign-in or registration.",
    );
    if (input.action === "register") {
      // "Play first, secure later": a signed-in explorer attaches the passkey
      // to the existing player instead of creating a second one.
      const attachTo = input.attach === true ? auth(req) : null;
      assert(
        input.attach !== true || attachTo,
        "Sign in before securing this explorer.",
        401,
      );
      const name = attachTo
        ? db.prepare("SELECT name FROM players WHERE id=?").get(attachTo).name
        : input.name;
      assert(
        typeof name === "string" &&
          name.trim().length >= 2 &&
          name.trim().length <= 24,
        "Your name must be 2–24 characters.",
      );
      const options = await generateRegistrationOptions({
        rpName: "QuestLayer",
        rpID,
        userName: name,
        userID: randomBytes(32),
        attestationType: "none",
        authenticatorSelection: {
          residentKey: "required",
          userVerification: "required",
        },
      });
      const c = challenge("passkey", {
        purpose: "demo-passkey-auth",
        action: "register",
        name,
        attachTo,
        challenge: options.challenge,
      });
      return respond(res, { options, challengeId: c.id });
    }
    const options = await generateAuthenticationOptions({
      rpID,
      userVerification: "required",
    });
    const c = challenge("passkey", {
      purpose: "demo-passkey-auth",
      action: "login",
      challenge: options.challenge,
    });
    return respond(res, { options, challengeId: c.id });
  }
  if (path === "/api/passkey/verify" && method === "POST") {
    const input = await body(req),
      c = readChallenge(input.challengeId);
    assert(
      c.purpose === "demo-passkey-auth",
      "This challenge cannot sign in with a demo passkey.",
      401,
    );
    assert(
      input.response &&
        typeof input.response.id === "string" &&
        input.response.id.length <= 2048,
      "The passkey response is missing.",
      400,
    );
    let player;
    if (c.action === "register") {
      const v = await verifyRegistrationResponse({
        response: input.response,
        expectedChallenge: c.challenge,
        expectedOrigin: origin,
        expectedRPID: rpID,
        requireUserVerification: true,
      });
      assert(
        v.verified && v.registrationInfo,
        "The passkey could not be verified.",
        401,
      );
      if (c.attachTo)
        assert(
          auth(req) === c.attachTo,
          "Sign in with the same explorer to secure it.",
          401,
        );
      player = atomic(db, () => {
        consumeChallenge(input.challengeId);
        const p = c.attachTo || createPlayer(db, c.name);
        const credential = v.registrationInfo.credential;
        db.prepare("INSERT INTO passkeys VALUES (?,?,?,?,?)").run(
          credential.id,
          p,
          Buffer.from(credential.publicKey).toString("base64"),
          credential.counter,
          JSON.stringify(credential.transports || []),
        );
        return p;
      });
    } else {
      const saved = db
        .prepare("SELECT * FROM passkeys WHERE id=?")
        .get(input.response.id);
      assert(
        saved,
        "This passkey is not known here. Start a new explorer or try another passkey.",
        401,
      );
      const v = await verifyAuthenticationResponse({
        response: input.response,
        expectedChallenge: c.challenge,
        expectedOrigin: origin,
        expectedRPID: rpID,
        requireUserVerification: true,
        credential: {
          id: saved.id,
          publicKey: new Uint8Array(Buffer.from(saved.public_key, "base64")),
          counter: saved.counter,
          transports: JSON.parse(saved.transports),
        },
      });
      assert(v.verified, "The passkey check failed. Try again.", 401);
      atomic(db, () => {
        consumeChallenge(input.challengeId);
        assert(
          db
            .prepare("UPDATE passkeys SET counter=? WHERE id=? AND counter=?")
            .run(v.authenticationInfo.newCounter, saved.id, saved.counter)
            .changes === 1,
          "The passkey changed during verification. Please sign in again.",
          401,
        );
      });
      player = saved.player_id;
    }
    return respond(res, { player: profile(player) }, 200, {
      "Set-Cookie": cookie(newSession(player, "demo-passkey")),
    });
  }
  if (path === "/api/auth/near/challenge" && method === "POST") {
    const input = await body(req),
      accountId = nearAccountId(input.accountId),
      name = String(input.name || "Explorer").trim();
    assert(
      name.length >= 2 && name.length <= 24,
      "Your name must be 2–24 characters.",
    );
    const address = clientAddress(req, process.env.TRUST_PROXY === "loopback"),
      key = `near-auth:${address}:${Math.floor(Date.now() / 60000)}`,
      count = (rates.get(key) || 0) + 1;
    rates.set(key, count);
    assert(
      count <= 30,
      "Please wait before starting another wallet sign-in.",
      429,
    );
    const message = `Sign in to QuestLayer as ${accountId} on ${NETWORK_LABEL}. Authentication only. No transaction or funds transfer.`;
    const c = challenge("near_signin", {
      purpose: "near-sign-in",
      network: NETWORK,
      accountId,
      name,
      message,
      recipient: origin,
    });
    return respond(res, {
      challengeId: c.id,
      nonce: c.nonce,
      message,
      recipient: origin,
      network: NETWORK,
    });
  }
  if (path === "/api/auth/near/verify" && method === "POST") {
    const input = await body(req),
      c = readChallenge(input.challengeId);
    assert(
      c.purpose === "near-sign-in" && c.recipient === origin,
      "This challenge cannot sign in an explorer.",
      401,
    );
    await verifyNearIdentity(c, input, provider);
    const result = atomic(db, () => {
      consumeChallenge(input.challengeId);
      const existing = db
        .prepare("SELECT player_id FROM wallet_links WHERE account_id=?")
        .get(c.accountId);
      const player = existing?.player_id || createPlayer(db, c.name);
      db.prepare(
        "INSERT INTO wallet_links(account_id,player_id,verified_at) VALUES(?,?,?) ON CONFLICT(account_id) DO UPDATE SET verified_at=excluded.verified_at",
      ).run(c.accountId, player, Date.now());
      return {
        player,
        token: newSession(player, "near-wallet", c.accountId),
        returning: !!existing,
      };
    });
    return respond(
      res,
      {
        player: profile(result.player),
        returning: result.returning,
        identity: "near-wallet",
        network: NETWORK,
      },
      200,
      { "Set-Cookie": cookie(result.token) },
    );
  }
  if (path === "/api/identity/sessions" && method === "GET")
    return respond(res, identitySessions.view(sessionToken(req)));
  if (path === "/api/identity/recovery/challenge" && method === "POST") {
    const input = await body(req);
    return respond(
      res,
      identitySessions.challenge(sessionToken(req), input.accountId),
    );
  }
  if (path === "/api/identity/recovery/verify" && method === "POST") {
    const recovered = await identitySessions.recover(
      sessionToken(req),
      await body(req),
    );
    return respond(res, recovered.result, 200, {
      "Set-Cookie": cookie(recovered.token),
    });
  }
  if (path === "/api/dashboard") return respond(res, game.dashboard(db));
  if (path === "/api/market")
    return respond(res, {
      listings: db
        .prepare(
          "SELECT l.*,i.name,i.rarity,i.color,i.slot,i.serial,p.name AS seller_name FROM listings l JOIN inventory i ON i.id=l.item_id JOIN players p ON p.id=l.seller WHERE l.state='open' ORDER BY l.created_at DESC LIMIT 100",
        )
        .all(),
    });
  if (path.startsWith("/api/media/") && method === "GET") {
    const viewer = auth(req);
    const file = noteMedia.file(path);
    assert(
      file && socialContent.mediaAllowed(viewer, path) && existsSync(file),
      "Image not found.",
      404,
    );
    res.writeHead(200, {
      "Content-Type": "image/jpeg",
      "Cache-Control": "private,no-store",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
    });
    return createReadStream(file).pipe(res);
  }
  if (path === "/api/native/market" && method === "GET") {
    if (!nativeMarket)
      return respond(res, { status: "not-configured", network: NETWORK });
    return respond(
      res,
      await nativeMarket.snapshot({
        fresh: url.searchParams.get("refresh") === "1",
        fromIndex: Number(url.searchParams.get("from") || 0),
        verifyTokenId: url.searchParams.get("token"),
      }),
    );
  }
  if (path === "/api/native/market/orders" && method === "GET") {
    assert(nativeMarket, "The secured market is not available yet.", 503);
    return respond(
      res,
      await nativeMarket.signedOrders({
        tokenId: url.searchParams.get("token"),
        fresh: url.searchParams.get("refresh") === "1",
      }),
    );
  }
  if (path === "/api/native/claim-signer" && method === "GET") {
    assert(
      awardSigner,
      "Native attestations are disabled on this host.",
      503,
      "NATIVE_DISABLED",
    );
    return respond(res, awardVouchers.publicInfo());
  }
  if (path === "/api/native/collection" && method === "GET")
    return respond(res, await nativeCollectibles.collection());
  const player = auth(req);
  if (
    await relayerRoutes.handle(req, res, url, { player, body, respond, assert })
  )
    return;
  if (
    await creatorMoneyRoutes.handle(req, res, url, {
      player,
      body,
      respond,
      assert,
      accountFor: (id) => creatorMoney?.accountFor(id) ?? null,
    })
  )
    return;
  if (
    await socialRecordRoutes.handle(req, res, url, {
      player,
      body,
      respond,
      assert,
      linkedAccount,
    })
  )
    return;
  if (path === "/api/adventure-results" && method === "GET") {
    return respond(
      res,
      adventureResults.list(player, {
        realm: url.searchParams.get("realm") || undefined,
        limit: url.searchParams.has("limit")
          ? Number(url.searchParams.get("limit"))
          : 20,
        cursor: url.searchParams.get("cursor") || undefined,
        unviewedOnly: url.searchParams.get("unviewedOnly") === "true",
      }),
    );
  }
  const questResult = /^\/api\/adventure-results\/quest\/([^/]+)$/.exec(path);
  if (questResult && method === "GET") {
    const result = adventureResults.forQuest(
      player,
      decodeURIComponent(questResult[1]),
    );
    assert(result, "Adventure result not found.", 404);
    return respond(res, { result });
  }
  const savedResult = /^\/api\/adventure-results\/([^/]+)(\/viewed)?$/.exec(
    path,
  );
  if (savedResult) {
    const resultId = decodeURIComponent(savedResult[1]);
    if (!savedResult[2] && method === "GET") {
      const result = adventureResults.get(player, resultId);
      assert(result, "Adventure result not found.", 404);
      return respond(res, { result });
    }
    if (savedResult[2] && method === "POST") {
      await body(req);
      return respond(res, {
        result: adventureResults.markViewed(player, resultId),
      });
    }
    assert(false, "Method not allowed.", 405);
  }
  if (
    path.startsWith("/api/native/rewards") ||
    path.startsWith("/api/native/vaults")
  ) {
    const key = `native-api:${player}:${Math.floor(Date.now() / 60000)}`,
      count = (rates.get(key) || 0) + 1;
    rates.set(key, count);
    assert(
      count <= 80,
      "Please wait before checking native operations again.",
      429,
    );
  }
  if (path === "/api/native/vaults" && method === "GET") {
    if (!nativeVaults) return respond(res, { status: "not-configured" });
    return respond(
      res,
      await nativeVaults.snapshot(
        player,
        url.searchParams.get("account") || undefined,
      ),
    );
  }
  if (
    [
      "/api/native/tasks",
      "/api/native/tasks/prepare",
      "/api/native/tasks/confirm",
    ].includes(path)
  ) {
    const key = `native-tasks:${player}:${Math.floor(Date.now() / 60000)}`;
    const count = (rates.get(key) || 0) + 1;
    rates.set(key, count);
    assert(
      count <= 30,
      "Please wait before checking community tasks again.",
      429,
    );
    if (path === "/api/native/tasks" && method === "GET") {
      const rawId = url.searchParams.get("taskId");
      const taskId = rawId === null ? null : Number(rawId);
      assert(
        taskId === null ||
          (/^\d+$/.test(rawId) && Number.isSafeInteger(taskId) && taskId >= 0),
        "Choose a valid task.",
      );
      const result = await nativeTasks.snapshot(
        player,
        url.searchParams.get("accountId") || "",
        url.searchParams.get("refresh") === "1",
        taskId,
      );
      assert(
        auth(req) === player,
        "Sign in again to view community tasks.",
        401,
      );
      return respond(res, result);
    }
    if (path === "/api/native/tasks/prepare" && method === "POST") {
      const quote = await nativeTasks.prepare(player, await body(req));
      assert(
        auth(req) === player,
        "Sign in again before approving this task operation.",
        401,
      );
      return respond(res, quote);
    }
    if (path === "/api/native/tasks/confirm" && method === "POST") {
      const result = await nativeTasks.confirm(player, await body(req));
      assert(
        auth(req) === player,
        "Sign in again to check the task transaction.",
        401,
      );
      return respond(res, result);
    }
  }
  if (path.startsWith("/api/native/tasks/evidence")) {
    const key = `task-evidence:${player}:${Math.floor(Date.now() / 60000)}`;
    const count = (rates.get(key) || 0) + 1;
    rates.set(key, count);
    assert(count <= 60, "Please wait before loading more photo evidence.", 429);
    const evidenceTask = async (rawAccount, rawTaskId, fresh = false) => {
      const accountId = nearAccountId(rawAccount);
      assert(
        linkedAccount(player, accountId),
        "Link this wallet before using photo evidence.",
        403,
      );
      const taskId = Number(rawTaskId);
      assert(
        Number.isSafeInteger(taskId) && taskId >= 1 && taskId <= 128,
        "Choose a valid task.",
      );
      const snapshot = await nativeTasks.snapshot(
        player,
        accountId,
        fresh,
        taskId,
      );
      return {
        accountId,
        task: evidenceTaskView(
          snapshot,
          taskId,
          nativeTasks.configuration().arbiterId,
        ),
      };
    };
    if (path === "/api/native/tasks/evidence" && method === "POST") {
      const input = await body(req);
      const { accountId, task } = await evidenceTask(
        input.accountId,
        input.taskId,
        true,
      );
      const photo = await taskEvidence.upload(
        player,
        accountId,
        task,
        input.image,
      );
      assert(auth(req) === player, "Please sign in again.", 401);
      return respond(res, photo, 201);
    }
    if (path === "/api/native/tasks/evidence" && method === "GET") {
      const { accountId, task } = await evidenceTask(
        url.searchParams.get("accountId"),
        url.searchParams.get("taskId"),
      );
      return respond(res, taskEvidence.list(player, accountId, task));
    }
    const photoAction = path.match(
      /^\/api\/native\/tasks\/evidence\/(evidence_[a-f0-9-]{36})(?:\/(report))?$/,
    );
    assert(photoAction, "Not found", 404);
    const photoId = photoAction[1];
    if (!photoAction[2] && method === "DELETE") {
      await body(req);
      assert(auth(req) === player, "Please sign in again.", 401);
      return respond(res, taskEvidence.remove(player, photoId));
    }
    if (!photoAction[2] && method === "GET") {
      const owned = taskEvidence.row(photoId).player_id === player;
      const context = owned
        ? { accountId: "", task: null }
        : await evidenceTask(
            url.searchParams.get("accountId"),
            url.searchParams.get("taskId"),
          );
      const opened = taskEvidence.open(
        player,
        context.accountId,
        photoId,
        context.task,
      );
      res.writeHead(200, {
        "Content-Type": "image/jpeg",
        "Cache-Control": "private,no-store",
        "X-Content-Type-Options": "nosniff",
        "Referrer-Policy": "no-referrer",
        "Content-Disposition": "inline",
        "Cross-Origin-Resource-Policy": "same-origin",
      });
      return createReadStream(opened.path).pipe(res);
    }
    if (photoAction[2] === "report" && method === "POST") {
      const input = await body(req);
      const { accountId, task } = await evidenceTask(
        input.accountId,
        input.taskId,
      );
      assert(auth(req) === player, "Please sign in again.", 401);
      return respond(
        res,
        moderation.report(
          player,
          {
            kind: "evidence",
            targetId: photoId,
            reason: input.reason,
            detail: input.detail,
          },
          {
            canSee: () => {
              const row = taskEvidence.row(photoId);
              const role = taskEvidence.role(player, accountId, row, task);
              return role === "sponsor" || role === "arbiter";
            },
          },
        ),
      );
    }
    assert(false, "Not found", 404);
  }
  if (path === "/api/moderation/reports" && method === "POST") {
    const input = await body(req);
    assert(auth(req) === player, "Please sign in again.", 401);
    assert(input.kind === "record", "Report notes from the note itself.");
    return respond(
      res,
      moderation.report(player, {
        kind: "record",
        targetId: input.targetId,
        reason: input.reason,
        detail: input.detail,
      }),
    );
  }
  if (
    [
      "/api/native/transactions/confirm",
      "/api/native/transactions/anchor",
    ].includes(path) &&
    method === "POST"
  ) {
    const key = `native-confirm:${player}:${Math.floor(Date.now() / 60000)}`;
    const count = (rates.get(key) || 0) + 1;
    rates.set(key, count);
    assert(count <= 30, "Please wait before checking more transactions.", 429);
    const input = await body(req);
    let result;
    try {
      result = path.endsWith("/anchor")
        ? await nativeTransactionConfirmation.anchor(player, input?.accountId)
        : input?.quote?.receiverId === TASK_CONTRACT
          ? await nativeTasks.confirmTransaction(player, input)
          : await nativeTransactionConfirmation.confirm(player, input);
    } catch (error) {
      // Revoked sessions must not receive a terminal code that clears a journal.
      assert(
        auth(req) === player,
        "Sign in again to check this transaction.",
        401,
      );
      throw error;
    }
    assert(
      auth(req) === player,
      "Sign in again to check this transaction.",
      401,
    );
    return respond(res, result);
  }
  if (path === "/api/native/vaults/prepare" && method === "POST") {
    assert(nativeVaults, "Native staking is not configured yet.", 503);
    return respond(res, await nativeVaults.prepare(player, await body(req)));
  }
  if (path === "/api/native/rewards" && method === "GET") {
    if (!nativeRewards)
      return respond(res, { status: "not-configured", network: NETWORK });
    return respond(
      res,
      await nativeRewards.snapshot(player, {
        accountId: url.searchParams.get("account") || undefined,
        fresh: url.searchParams.get("refresh") === "1",
      }),
    );
  }
  if (path === "/api/native/rewards/nearby" && method === "POST") {
    if (!nativeRewards)
      return respond(res, { status: "not-configured", network: NETWORK });
    const input = await body(req);
    return respond(
      res,
      await nativeRewards.snapshot(player, {
        accountId: input.accountId || undefined,
        location: input.location,
        fresh: input.fresh === true,
      }),
    );
  }
  if (path === "/api/native/rewards/join" && method === "POST") {
    assert(
      nativeRewards,
      "Walks on the test network are not available yet.",
      503,
    );
    const input = await body(req);
    return respond(
      res,
      nativeRewards.enroll(player, input.accountId, input.consent),
    );
  }
  if (path === "/api/native/rewards/visit" && method === "POST") {
    assert(
      nativeRewards,
      "Walks on the test network are not available yet.",
      503,
    );
    const key = `native-visit:${player}:${Math.floor(Date.now() / 60000)}`,
      count = (rates.get(key) || 0) + 1;
    rates.set(key, count);
    assert(
      count <= 30,
      "Please wait before recording another native visit.",
      429,
    );
    return respond(res, await nativeRewards.submit(player, await body(req)));
  }
  if (
    [
      "/api/native/profile",
      "/api/native/profile/prepare",
      "/api/native/profile/confirm",
    ].includes(path)
  ) {
    const key = `profile-api:${player}:${Math.floor(Date.now() / 60000)}`,
      count = (rates.get(key) || 0) + 1;
    rates.set(key, count);
    assert(
      count <= 60,
      "Please wait before checking your public profile again.",
      429,
    );
  }
  if (path === "/api/native/profile" && method === "GET") {
    const accountId = nearAccountId(url.searchParams.get("accountId"));
    assert(
      db
        .prepare(
          "SELECT 1 FROM wallet_links WHERE player_id=? AND account_id=?",
        )
        .get(player, accountId),
      "Link this NEAR wallet before viewing its game profile.",
      403,
    );
    return respond(
      res,
      await nativeSocialProfile.read(
        accountId,
        url.searchParams.get("refresh") === "1",
      ),
    );
  }
  if (path === "/api/native/profile/prepare" && method === "POST") {
    const input = await body(req),
      accountId = nearAccountId(input.accountId);
    assert(
      input.publicConsent === true,
      "Choose whether to publish your alias and avatar reference.",
    );
    assert(
      db
        .prepare(
          "SELECT 1 FROM wallet_links WHERE player_id=? AND account_id=?",
        )
        .get(player, accountId),
      "Link this NEAR wallet before publishing a game profile.",
      403,
    );
    const key = `native-profile:${player}:${Math.floor(Date.now() / 60000)}`,
      count = (rates.get(key) || 0) + 1;
    rates.set(key, count);
    assert(
      count <= 12,
      "Please wait before preparing another public profile.",
      429,
    );
    const quote = await nativeSocialProfile.prepare(
      accountId,
      profile(player).name,
    );
    assert(
      db
        .prepare(
          "SELECT 1 FROM wallet_links WHERE player_id=? AND account_id=?",
        )
        .get(player, accountId),
      "Your linked wallet changed. Try again.",
      409,
    );
    return respond(res, quote);
  }
  if (path === "/api/native/profile/confirm" && method === "POST") {
    const input = await body(req),
      accountId = nearAccountId(input.accountId);
    assert(
      db
        .prepare(
          "SELECT 1 FROM wallet_links WHERE player_id=? AND account_id=?",
        )
        .get(player, accountId),
      "Link this NEAR wallet before confirming its profile.",
      403,
    );
    const result = await nativeSocialProfile.confirm(
      accountId,
      input.mutationId,
    );
    assert(
      db
        .prepare(
          "SELECT 1 FROM wallet_links WHERE player_id=? AND account_id=?",
        )
        .get(player, accountId),
      "Your linked wallet changed. Try again.",
      409,
    );
    if (result.confirmed)
      db.prepare(
        "INSERT OR IGNORE INTO history(id,player_id,kind,title,gold_u,meta,created_at) VALUES(?,?,?,?,0,?,?)",
      ).run(
        `native-profile:${accountId}:${input.mutationId}`,
        player,
        "native_profile",
        "QuestLayer profile published on NEAR",
        JSON.stringify({
          network: NETWORK,
          contractId: result.snapshot.contractId,
          accountId,
          mutationId: input.mutationId,
        }),
        Date.now(),
      );
    return respond(res, { ...result, player: profile(player) });
  }
  if (path === "/api/native/market/orders" && method === "POST") {
    assert(nativeMarket, "The secured market is not available yet.", 503);
    const input = await body(req);
    return respond(res, await nativeMarket.submitOrder(input.order));
  }
  if (path === "/api/native/market/accounts" && method === "GET") {
    assert(nativeMarket, "The secured market is not available yet.", 503);
    const accounts = db
      .prepare(
        "SELECT account_id FROM wallet_links WHERE player_id=? ORDER BY verified_at DESC LIMIT 5",
      )
      .all(player)
      .map((w) => w.account_id);
    return respond(
      res,
      await nativeMarket.balances(
        accounts,
        url.searchParams.get("refresh") === "1",
      ),
    );
  }
  if (
    [
      "/api/native/progression",
      "/api/native/progression/claim",
      "/api/native/progression/confirm",
    ].includes(path) &&
    method === "POST"
  ) {
    assert(
      nativeProgression,
      "Native level rewards are not configured yet.",
      503,
    );
    const key = `native-level:${player}:${Math.floor(Date.now() / 60000)}`,
      count = (rates.get(key) || 0) + 1;
    rates.set(key, count);
    assert(
      count <= 18,
      "Please wait before checking level rewards again.",
      429,
    );
    const input = await body(req);
    const result = path.endsWith("/claim")
      ? await nativeProgression.issue(player, input.accountId, input.level)
      : path.endsWith("/confirm")
        ? await nativeProgression.confirm(player, input.accountId, input.level)
        : await nativeProgression.snapshot(player, input.accountId);
    // A session revoked during the finalized read must not receive a new voucher.
    assert(auth(req) === player, "Please sign in again.", 401);
    return respond(res, result);
  }

  if (path === "/api/native/claims" && method === "POST") {
    assert(
      awardSigner,
      "Native attestations are disabled on this host.",
      503,
      "NATIVE_DISABLED",
    );
    const input = await body(req),
      key = `native-claim:${player}:${Math.floor(Date.now() / 60000)}`,
      count = (rates.get(key) || 0) + 1;
    rates.set(key, count);
    assert(
      count <= 12,
      "Please wait before requesting another native claim.",
      429,
    );
    return respond(
      res,
      await awardVouchers.issue(player, input.itemId, input.accountId),
    );
  }
  if (path === "/api/native/claims/confirm" && method === "POST") {
    const input = await body(req);
    return respond(res, {
      claim: await awardVouchers.confirm(player, input.itemId),
      player: profile(player),
    });
  }
  if (path === "/api/native/claims/restore" && method === "POST") {
    const input = await body(req);
    return respond(res, {
      ...(await awardVouchers.restoreDemo(player, input.itemId)),
      player: profile(player),
    });
  }
  if (path === "/api/native/wardrobe" && method === "GET") {
    const ids = db
        .prepare(
          "SELECT account_id FROM wallet_links WHERE player_id=? ORDER BY verified_at DESC LIMIT 5",
        )
        .all(player)
        .map((w) => w.account_id),
      fresh = url.searchParams.get("refresh") === "1";
    if (fresh) {
      const key = `native-refresh:${player}:${Math.floor(Date.now() / 60000)}`,
        count = (rates.get(key) || 0) + 1;
      rates.set(key, count);
      assert(
        count <= 12,
        "Please wait before refreshing the native inventory again.",
        429,
      );
    }
    const state = await nativeCollectibles.wardrobe(ids, fresh);
    let claimsEnabled = false;
    try {
      claimsEnabled =
        !!awardSigner &&
        (await nativeCollectibles.view("get_award_signer", {}, fresh)) ===
          awardSigner.publicKey;
    } catch {}
    return respond(res, { ...state, claimsEnabled });
  }
  if (path === "/api/native/outfit" && method === "POST") {
    const input = await body(req);
    assert(typeof input.enabled === "boolean", "Choose an outfit source.");
    if (input.enabled) {
      nearAccountId(input.accountId);
      assert(
        db
          .prepare(
            "SELECT 1 FROM wallet_links WHERE player_id=? AND account_id=?",
          )
          .get(player, input.accountId),
        "Link this NEAR wallet before using its outfit.",
        403,
      );
      const state = await nativeCollectibles.wardrobe([input.accountId], true);
      assert(
        state.accounts[0].items.length > 0,
        "This wallet has no QuestLayer NFTs yet.",
      );
    }
    db.prepare(
      "UPDATE players SET native_outfit=?,native_account=COALESCE(?,native_account) WHERE id=?",
    ).run(
      input.enabled ? 1 : 0,
      input.enabled ? input.accountId : null,
      player,
    );
    return respond(res, { player: profile(player) });
  }
  if (path === "/api/me") return respond(res, { player: profile(player) });
  if (path === "/api/events") {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    res.write(": connected\n\n");
    listeners.add(res);
    const tick = setInterval(() => res.write(": ping\n\n"), 20_000);
    req.on("close", () => {
      clearInterval(tick);
      listeners.delete(res);
    });
    return;
  }
  if (path === "/api/world" && method === "POST") {
    const input = await body(req),
      location = point(input.location || HOME),
      query = worldQuery({
        bounds: input.bounds,
        limit: input.limit,
        cursor: input.cursor,
      });
    expireWorlds(db);
    const world = await ensureWorld(db, location, input.arena !== false);
    return respond(res, worldView(db, world.id, player, query));
  }
  if (path === "/api/world" && method === "GET") {
    const w = worldView(
      db,
      url.searchParams.get("id"),
      player,
      worldQuery({
        bounds: url.searchParams.get("bbox") ?? undefined,
        limit: url.searchParams.get("limit") ?? undefined,
        cursor: url.searchParams.get("cursor") ?? undefined,
      }),
    );
    assert(w, "This area could not be found. Refresh the map.", 404);
    return respond(res, w);
  }
  if (path === "/api/coins/claim" && method === "POST") {
    const input = await body(req),
      result = game.claimCoin(db, player, input.coinId, input.fix);
    if (!result.alreadyClaimed) emit("coin", { id: input.coinId });
    return respond(res, { ...result, player: profile(player) });
  }
  if (path === "/api/quests/checkpoint" && method === "POST") {
    const input = await body(req),
      result = game.advanceRoute(
        db,
        player,
        input.questId,
        input.fix,
        input.checkpoint,
      );
    emit("quest", { id: input.questId });
    return respond(res, { ...result, player: profile(player) });
  }
  if (path === "/api/quests/claim" && method === "POST") {
    const input = await body(req),
      result = game.claimQuest(db, player, input.questId, input.fix);
    emit("quest", { id: input.questId });
    return respond(res, { ...result, player: profile(player) });
  }
  if (path === "/api/stake" && method === "POST") {
    const i = await body(req);
    const result = game.stake(db, player, i.amount, i.contribution, i.pool);
    return respond(res, { ...result, player: profile(player) });
  }
  if (path === "/api/contribution" && method === "POST") {
    const i = await body(req);
    return respond(res, {
      ...game.contribution(db, player, i.positionId, i.contribution),
      player: profile(player),
    });
  }
  if (path === "/api/unstake" && method === "POST") {
    const i = await body(req);
    return respond(res, {
      ...game.unstake(db, player, i.positionId),
      player: profile(player),
    });
  }
  if (path === "/api/withdraw" && method === "POST") {
    const i = await body(req);
    return respond(res, {
      ...game.redeem(db, player, i.withdrawalId),
      player: profile(player),
    });
  }
  if (path === "/api/equip" && method === "POST") {
    const i = await body(req);
    return respond(res, {
      ...game.equip(db, player, i.itemId, i.desiredEquipped),
      player: profile(player),
    });
  }
  if (path === "/api/market/list" && method === "POST") {
    const i = await body(req);
    const r = game.listItem(db, player, i.itemId, i.price);
    emit("market", {});
    return respond(res, { ...r, player: profile(player) });
  }
  if (path === "/api/market/buy" && method === "POST") {
    const i = await body(req),
      r = game.buyItem(db, player, i.listingId);
    emit("market", {});
    return respond(res, { ...r, player: profile(player) });
  }
  if (path === "/api/market/cancel" && method === "POST") {
    const i = await body(req),
      r = game.cancelListing(db, player, i.listingId);
    emit("market", {});
    return respond(res, r);
  }
  if (path.startsWith("/api/messages") || path.startsWith("/api/social/")) {
    const key = `social:${player}:${Math.floor(Date.now() / 60000)}`;
    const count = (rates.get(key) || 0) + 1;
    rates.set(key, count);
    assert(
      count <= 90,
      "Please wait before checking community notes again.",
      429,
    );
  }
  if (path === "/api/messages/operation" && method === "GET")
    return respond(
      res,
      socialContent.operation(player, url.searchParams.get("clientId")),
    );
  if (path === "/api/messages/operation/abandon" && method === "POST") {
    const input = await body(req);
    assert(auth(req) === player, "Please sign in again.", 401);
    return respond(res, socialContent.abandonOperation(player, input.clientId));
  }
  if (path === "/api/messages" && method === "GET")
    return respond(
      res,
      socialContent.list(player, {
        lat: Number(url.searchParams.get("lat") ?? HOME.lat),
        lng: Number(url.searchParams.get("lng") ?? HOME.lng),
        arena: url.searchParams.get("arena") !== "0",
      }),
    );
  if (path === "/api/messages" && method === "POST") {
    const input = await body(req);
    const result = await socialContent.create(player, input, {
      storeImage: (data) => noteMedia.store(data),
      removeImage: (url) => noteMedia.remove(url),
      assertSession: () =>
        assert(
          auth(req) === player,
          "Please sign in again before publishing.",
          401,
        ),
    });
    emit("message", {});
    return respond(res, result, result.replayed ? 200 : 201);
  }
  const noteAction = path.match(
    /^\/api\/messages\/(message_[a-f0-9-]{36})(?:\/(report))?$/,
  );
  if (noteAction && method === "DELETE" && !noteAction[2]) {
    await body(req);
    assert(auth(req) === player, "Please sign in again.", 401);
    const result = socialContent.remove(player, noteAction[1]);
    // The deletion transaction removes public access and records media retirement.
    // Physical cleanup waits for its grace period so in-flight backups stay whole.
    emit("message", {});
    return respond(res, { id: result.id, state: result.state });
  }
  if (noteAction?.[2] === "report" && method === "POST") {
    const input = await body(req);
    assert(auth(req) === player, "Please sign in again.", 401);
    return respond(res, socialContent.report(player, noteAction[1], input));
  }
  if (path === "/api/social/blocks" && method === "GET")
    return respond(res, socialContent.blocks(player));
  if (path === "/api/social/blocks" && ["POST", "DELETE"].includes(method)) {
    const input = await body(req);
    assert(auth(req) === player, "Please sign in again.", 401);
    return respond(
      res,
      socialContent.setBlock(player, input.targetPlayerId, method === "POST"),
    );
  }
  if (path === "/api/presence" && method === "POST") {
    const input = await body(req);
    assert(auth(req) === player, "Please sign in again.", 401);
    return respond(res, updatePresence(db, player, input));
  }
  if (path === "/api/presence" && method === "GET") {
    const lat = Number(url.searchParams.get("lat") || HOME.lat),
      lng = Number(url.searchParams.get("lng") || HOME.lng);
    point({ lat, lng });
    return respond(
      res,
      await readNearbyPresence(
        db,
        player,
        { lat, lng },
        url.searchParams.get("arena") !== "0",
        {
          appearanceReader: (players) =>
            publicAppearances(db, players, nativeCollectibles),
          assertSession: () =>
            assert(auth(req) === player, "Please sign in again.", 401),
        },
      ),
    );
  }
  if (path === "/api/wallet/challenge" && method === "POST") {
    const i = await body(req);
    nearAccountId(i.accountId);
    const message = `Linking a NEAR account to explorer ${player}. Network: ${NETWORK}. No funds will be transferred.`;
    const c = challenge("near", {
      purpose: "near-link",
      network: NETWORK,
      player,
      sessionId: identitySessions.authenticate(sessionToken(req)).sessionId,
      accountId: i.accountId,
      message,
      recipient: origin,
    });
    return respond(res, {
      challengeId: c.id,
      nonce: c.nonce,
      message,
      recipient: origin,
    });
  }
  if (path === "/api/wallet/verify" && method === "POST") {
    const i = await body(req),
      c = readChallenge(i.challengeId);
    assert(
      c.player === player,
      "The challenge belongs to another explorer.",
      403,
    );
    assert(
      c.purpose === "near-link" && c.recipient === origin,
      "This challenge cannot link a wallet.",
      401,
    );
    assert(
      c.sessionId ===
        identitySessions.authenticate(sessionToken(req)).sessionId,
      "Finish linking in the browser where it was started.",
      403,
    );
    await verifyNearIdentity(c, i, provider);
    atomic(db, () => {
      assert(auth(req) === player, "Please sign in again.", 401);
      const old = db
        .prepare("SELECT player_id FROM wallet_links WHERE account_id=?")
        .get(c.accountId);
      assert(
        !old || old.player_id === player,
        "This account is linked to another explorer.",
        409,
      );
      consumeChallenge(i.challengeId);
      db.prepare("INSERT OR REPLACE INTO wallet_links VALUES (?,?,?)").run(
        c.accountId,
        player,
        Date.now(),
      );
    });
    return respond(res, { player: profile(player) });
  }
  if (path === "/api/wallet/balance") {
    await assertTestnetRpc(provider);
    const linked = db
      .prepare("SELECT account_id FROM wallet_links WHERE player_id=?")
      .get(player);
    assert(linked, "Link a NEAR account first.");
    const account = await provider.query({
      request_type: "view_account",
      account_id: linked.account_id,
      finality: "final",
    });
    return respond(res, {
      accountId: linked.account_id,
      amount: account.amount,
      network: NETWORK,
      realChain: true,
    });
  }

  if (path === "/api/evm/challenge" && method === "POST") {
    const i = await body(req);
    assert(isAddress(i.address), "Invalid EVM address.");
    const message = `QuestLayer: read-only linking of Base address ${i.address.toLowerCase()} to explorer ${player} at ${origin}. Nonce ${randomBytes(16).toString("hex")}. No transaction or NFT transfer approval.`;
    const c = challenge("evm", {
      purpose: "appearance-link",
      player,
      sessionId: identitySessions.authenticate(sessionToken(req)).sessionId,
      address: i.address.toLowerCase(),
      message,
    });
    return respond(res, { challengeId: c.id, message });
  }
  if (path === "/api/evm/verify" && method === "POST") {
    const i = await body(req),
      c = readChallenge(i.challengeId);
    assert(c.player === player, "This belongs to another explorer.", 403);
    assert(
      c.purpose === "appearance-link",
      "This challenge cannot link an appearance.",
      401,
    );
    assert(
      c.sessionId ===
        identitySessions.authenticate(sessionToken(req)).sessionId,
      "Finish linking in the browser where it was started.",
      403,
    );
    assert(
      await verifyEvmMessage({
        address: c.address,
        message: c.message,
        signature: i.signature,
      }),
      "The signature does not match this address.",
      401,
    );
    atomic(db, () => {
      assert(auth(req) === player, "Please sign in again.", 401);
      const old = db
        .prepare("SELECT player_id FROM external_links WHERE address=?")
        .get(c.address);
      assert(
        !old || old.player_id === player,
        "The address is linked to another explorer.",
        409,
      );
      consumeChallenge(i.challengeId);
      db.prepare("INSERT OR IGNORE INTO external_links VALUES (?,?,?,?)").run(
        c.address,
        player,
        "{}",
        0,
      );
    });
    return respond(res, { address: c.address, verified: true });
  }
  if (path === "/api/aavegotchi" && method === "GET") {
    const link = db
      .prepare(
        "SELECT * FROM external_links WHERE player_id=? ORDER BY verified_at DESC LIMIT 1",
      )
      .get(player);
    if (!link)
      return respond(res, { linked: false, gotchis: [], wearables: [] });
    let data = JSON.parse(link.data);
    const force = url.searchParams.get("refresh") === "1";
    if (force) {
      const key = `original-refresh:${player}:${Math.floor(Date.now() / 60000)}`;
      const count = (rates.get(key) || 0) + 1;
      rates.set(key, count);
      assert(
        count <= 1,
        "Please wait a minute before checking original ownership again.",
        429,
      );
    }
    if (force || link.verified_at < Date.now() - 300000) {
      try {
        data = await refreshOriginals(link.address);
        db.prepare(
          "UPDATE external_links SET data=?,verified_at=? WHERE address=?",
        ).run(JSON.stringify(data), data.verifiedAt, link.address);
      } catch {
        return respond(res, {
          linked: true,
          ...originalInventoryView(data),
          status: "unavailable",
          error:
            "Base RPC is temporarily unavailable. Your previous inventory is preserved; linked appearances are paused until ownership is verified.",
        });
      }
    }
    const appearance = JSON.parse(
      db.prepare("SELECT appearance FROM players WHERE id=?").get(player)
        .appearance,
    );
    const lookUnavailable =
      appearance.address === link.address &&
      appearance.originTokenId &&
      !data.gotchis?.some((g) => g.tokenId === appearance.originTokenId);
    if (lookUnavailable)
      db.prepare("UPDATE players SET appearance=? WHERE id=?").run(
        "{}",
        player,
      );
    return respond(res, {
      linked: true,
      ...originalInventoryView(data),
      appearance: lookUnavailable ? {} : appearance,
      lookUnavailable: !!lookUnavailable,
      status: "verified",
    });
  }
  if (path === "/api/aavegotchi/equip" && method === "POST") {
    const i = await body(req);
    if (i.tokenId === null) {
      db.prepare("UPDATE players SET appearance=? WHERE id=?").run(
        "{}",
        player,
      );
      return respond(res, { player: profile(player) });
    }
    const link = db
      .prepare(
        "SELECT * FROM external_links WHERE player_id=? ORDER BY verified_at DESC LIMIT 1",
      )
      .get(player);
    assert(
      link && link.verified_at > Date.now() - 300000,
      "Refresh original ownership first.",
    );
    const data = JSON.parse(link.data);
    assert(
      data.gotchis?.some((g) => g.tokenId === String(i.tokenId)),
      "This original is not held by your linked address.",
      403,
    );
    db.prepare("UPDATE players SET appearance=? WHERE id=?").run(
      JSON.stringify({
        originTokenId: String(i.tokenId),
        address: link.address,
      }),
      player,
    );
    return respond(res, { player: profile(player) });
  }
  if (path === "/api/character/model" && method === "GET") {
    const key = `model:${player}:${Math.floor(Date.now() / 60000)}`;
    const count = (rates.get(key) || 0) + 1;
    rates.set(key, count);
    assert(count <= 12, "Please wait before reopening the dressing room.", 429);
    const appearance = JSON.parse(
      db.prepare("SELECT appearance FROM players WHERE id=?").get(player)
        .appearance,
    );
    if (appearance.originTokenId) {
      const link = db
        .prepare(
          "SELECT data FROM external_links WHERE player_id=? AND address=? AND verified_at>?",
        )
        .get(player, appearance.address, Date.now() - 300000);
      const gotchi =
        link &&
        JSON.parse(link.data).gotchis?.find(
          (g) => g.tokenId === appearance.originTokenId,
        );
      assert(
        gotchi,
        "Refresh original ownership before opening its 3D look.",
        403,
      );
      return respond(
        res,
        await gotchiModels.describe({
          tokenId: appearance.originTokenId,
          expectedWearables: gotchi.equipped,
        }),
      );
    }
    return respond(res, await gotchiModels.describe());
  }
  if (path.startsWith("/api/character/assets/") && method === "GET") {
    const digest = path.match(
      /^\/api\/character\/assets\/([a-f0-9]{64})\.glb$/,
    )?.[1];
    const asset = digest && gotchiModels.asset(digest);
    assert(
      asset,
      "This 3D look expired. Please reopen the dressing room.",
      404,
    );
    res.writeHead(200, {
      "Content-Type": "model/gltf-binary",
      "Content-Length": asset.bytes.length,
      "Cache-Control": "private,max-age=86400,immutable",
    });
    return res.end(asset.bytes);
  }
  if (path === "/api/presence/skin" && method === "GET") {
    const explorer = url.searchParams.get("playerId");
    assert(
      explorer && /^player_[a-f0-9-]{36}$/.test(explorer),
      "Invalid explorer.",
    );
    assert(
      !isSocialBlocked(db, player, explorer),
      "This shared appearance is no longer available.",
      404,
    );
    const svg = sharedOriginalSvg(db, explorer);
    assert(svg, "This shared appearance is no longer available.", 404);
    res.writeHead(200, {
      "Content-Type": "image/svg+xml",
      "Content-Security-Policy":
        "default-src 'none'; style-src 'unsafe-inline'; sandbox",
      "Cache-Control": "private,no-store",
    });
    return res.end(svg);
  }
  if (path.startsWith("/api/aavegotchi/wearable/") && method === "GET") {
    const id = path.match(
      /^\/api\/aavegotchi\/wearable\/([1-9]\d{0,4})\.svg$/,
    )?.[1];
    const link = db
      .prepare(
        "SELECT * FROM external_links WHERE player_id=? ORDER BY verified_at DESC LIMIT 1",
      )
      .get(player);
    linkedItemId(link, id);
    const key = `item-art:${player}:${Math.floor(Date.now() / 60000)}`;
    const count = (rates.get(key) || 0) + 1;
    rates.set(key, count);
    assert(count <= 60, "Please wait before loading more original items.", 429);
    const svg = await gotchiItemArt.get(id);
    res.writeHead(200, {
      "Content-Type": "image/svg+xml",
      "Content-Length": svg.length,
      "Content-Security-Policy":
        "default-src 'none'; style-src 'unsafe-inline'; sandbox",
      "Cache-Control": "private,max-age=60",
    });
    return res.end(svg);
  }
  if (path === "/api/aavegotchi/skin" && method === "GET") {
    const token = url.searchParams.get("tokenId");
    assert(token && /^\d{1,12}$/.test(token), "Invalid original.");
    const link = db
      .prepare(
        "SELECT * FROM external_links WHERE player_id=? ORDER BY verified_at DESC LIMIT 1",
      )
      .get(player);
    assert(
      link && link.verified_at > Date.now() - 300000,
      "Ownership needs to be refreshed.",
      403,
    );
    const gotchi = JSON.parse(link.data).gotchis?.find(
      (g) => g.tokenId === token,
    );
    assert(gotchi?.svg, "The appearance is unavailable.", 404);
    res.writeHead(200, {
      "Content-Type": "image/svg+xml",
      "Content-Security-Policy":
        "default-src 'none'; style-src 'unsafe-inline'; sandbox",
      "Cache-Control": "private,max-age=60",
    });
    return res.end(gotchi.svg);
  }
  if (path === "/api/npc" && method === "POST") {
    const i = await body(req);
    assert(
      typeof i.question === "string" && i.question.length <= 300,
      "The question is too long.",
    );
    let answer =
      "Every adventure starts around the corner. Pick up street coins, visit a free place and open a chest. Half of the game yield funds coins and half funds places. GOLD here is practice GOLD.";
    let source = "rules";
    if (process.env.NEAR_AI_API_KEY && process.env.NEAR_AI_MODEL) {
      const r = await fetch("https://cloud-api.near.ai/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.NEAR_AI_API_KEY}`,
        },
        body: JSON.stringify({
          model: process.env.NEAR_AI_MODEL,
          max_tokens: 250,
          messages: [
            {
              role: "system",
              content:
                "You are the English-speaking QuestLayer guide. Give concise exploration advice in English. 1 NEAR=1000 GOLD. This is a demo; never transfer funds. Game yield is split 50% street coins and 50% zones. Never invent locations or rewards, request keys or claim spending authority.",
            },
            { role: "user", content: i.question },
          ],
        }),
        signal: AbortSignal.timeout(20_000),
      });
      if (r.ok) {
        const j = await r.json();
        answer = j.choices?.[0]?.message?.content || answer;
        source = "near-ai";
      }
    }
    return respond(res, { answer, source });
  }
  if (path === "/api/bounties" && method === "GET")
    return respond(res, {
      bounties: db
        .prepare(
          "SELECT b.*,p.name AS creator_name FROM bounties b JOIN players p ON p.id=b.creator ORDER BY b.created_at DESC LIMIT 50",
        )
        .all(),
    });
  if (path === "/api/bounties" && method === "POST") {
    const i = await body(req);
    point(i);
    gameAmount(i.amount);
    assert(
      typeof i.title === "string" &&
        i.title.trim().length >= 5 &&
        i.title.length <= 100,
      "Enter a task title.",
    );
    assert(
      typeof i.description === "string" && i.description.length <= 1000,
      "The description is too long.",
    );
    const b = id("bounty");
    atomic(db, () => {
      const p = db.prepare("SELECT gold_u FROM players WHERE id=?").get(player);
      assert(p.gold_u >= i.amount, "Not enough GOLD.");
      db.prepare("UPDATE players SET gold_u=gold_u-? WHERE id=?").run(
        i.amount,
        player,
      );
      db.prepare(
        "INSERT INTO bounties(id,creator,title,description,amount_u,lat,lng,deadline,created_at) VALUES (?,?,?,?,?,?,?,?,?)",
      ).run(
        b,
        player,
        i.title.trim(),
        i.description,
        i.amount,
        i.lat,
        i.lng,
        Date.now() + 7 * DAY,
        Date.now(),
      );
      history(db, player, "escrow", `Escrow: ${i.title}`, -i.amount);
    });
    return respond(res, { id: b, player: profile(player) }, 201);
  }
  if (path === "/api/bounties/submit" && method === "POST") {
    const i = await body(req);
    assert(
      typeof i.evidence === "string" &&
        i.evidence.trim().length >= 10 &&
        i.evidence.length <= 1000,
      "Describe completion in at least ten characters.",
    );
    const b = db.prepare("SELECT * FROM bounties WHERE id=?").get(i.bountyId);
    assert(
      b && b.state === "open" && b.deadline > Date.now(),
      "The task is already closed.",
    );
    assert(b.creator !== player, "You cannot complete your own task.");
    assert(
      !db
        .prepare(
          "SELECT 1 FROM bounty_submissions WHERE bounty_id=? AND player_id=? AND state='pending'",
        )
        .get(b.id, player),
      "Your evidence is already awaiting review.",
    );
    db.prepare(
      "INSERT INTO bounty_submissions(bounty_id,player_id,evidence,created_at) VALUES (?,?,?,?)",
    ).run(b.id, player, i.evidence.trim(), Date.now());
    return respond(res, { ok: true });
  }
  if (path === "/api/bounties/submissions") {
    const b = db
      .prepare("SELECT * FROM bounties WHERE id=? AND creator=?")
      .get(url.searchParams.get("id"), player);
    assert(b, "You do not own this task.", 403);
    return respond(res, {
      submissions: db
        .prepare(
          "SELECT s.*,p.name FROM bounty_submissions s JOIN players p ON p.id=s.player_id WHERE bounty_id=? ORDER BY s.id",
        )
        .all(b.id),
    });
  }
  if (path === "/api/bounties/approve" && method === "POST") {
    const i = await body(req);
    atomic(db, () => {
      const s = db
        .prepare("SELECT * FROM bounty_submissions WHERE id=?")
        .get(i.submissionId);
      assert(s?.state === "pending", "Submission is unavailable.");
      const b = db
        .prepare("SELECT * FROM bounties WHERE id=?")
        .get(s.bounty_id);
      assert(
        b.creator === player && b.state === "open",
        "The task cannot be approved.",
        403,
      );
      assert(
        !db
          .prepare(
            "SELECT 1 FROM bounty_submissions WHERE bounty_id=? AND id<? AND state='pending'",
          )
          .get(b.id, s.id),
        "Review earlier submissions first.",
      );
      db.prepare("UPDATE bounties SET state='paid',winner=? WHERE id=?").run(
        s.player_id,
        b.id,
      );
      db.prepare(
        "UPDATE bounty_submissions SET state='approved' WHERE id=?",
      ).run(s.id);
      db.prepare("UPDATE players SET gold_u=gold_u+? WHERE id=?").run(
        b.amount_u,
        s.player_id,
      );
      history(db, s.player_id, "bounty", b.title, b.amount_u);
    });
    return respond(res, { ok: true });
  }
  if (path === "/api/bounties/refund" && method === "POST") {
    const i = await body(req);
    atomic(db, () => {
      const b = db
        .prepare(
          "SELECT * FROM bounties WHERE id=? AND creator=? AND state='open'",
        )
        .get(i.bountyId, player);
      assert(
        b && b.deadline < Date.now(),
        "A refund becomes available after the deadline.",
      );
      assert(
        !db
          .prepare(
            "SELECT 1 FROM bounty_submissions WHERE bounty_id=? AND state='pending'",
          )
          .get(b.id),
        "Review pending evidence first.",
      );
      db.prepare("UPDATE bounties SET state='refunded' WHERE id=?").run(b.id);
      db.prepare("UPDATE players SET gold_u=gold_u+? WHERE id=?").run(
        b.amount_u,
        player,
      );
    });
    return respond(res, { player: profile(player) });
  }
  throw Object.assign(new Error("This route does not exist."), { status: 404 });
}
function gameAmount(x) {
  assert(
    Number.isSafeInteger(x) && x > 0 && x <= 1_000_000 * GOLD,
    "Invalid amount.",
  );
}
const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".webmanifest": "application/manifest+json",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".glb": "model/gltf-binary",
  ".json": "application/json; charset=utf-8",
};
const server = createServer(async (req, res) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader(
    "Permissions-Policy",
    "geolocation=(self), camera=(), microphone=()",
  );
  try {
    const url = new URL(req.url, "http://localhost");
    if (url.pathname.startsWith("/api/")) return await api(req, res, url);
    const target = resolvePublicFile(
      resolve(APP_ROOT, "dist"),
      url.pathname,
      process.env.STATIC_ASSET_DIR,
    );
    res.writeHead(200, {
      "Content-Type": types[extname(target.file)] || "application/octet-stream",
      "Cache-Control": target.cacheControl,
    });
    if (req.method === "HEAD") return res.end();
    const stream = createReadStream(target.file);
    stream.on("error", () => res.destroy());
    stream.pipe(res);
  } catch (e) {
    if (!res.headersSent)
      respond(
        res,
        {
          error: e.status ? e.message : "The request could not be completed.",
          code: e.code || "SERVER_ERROR",
        },
        e.status || 500,
      );
    else res.end();
    if (!e.status) console.error("Request failed:", e.name, e.code || "");
  }
});
const worldPlanner = backgroundWorkersDisabled
  ? null
  : startWorldPlanner(db, { afterPreparation: () => retryStreetWorlds(db) });
const rewardWorker =
  !backgroundWorkersDisabled &&
  nativeRewards &&
  process.env.REWARD_WORKER_KEY_PATH
    ? startRewardWorker(nativeRewards, {
        keyPath: process.env.REWARD_WORKER_KEY_PATH,
      })
    : null;
const relayWorker =
  !backgroundWorkersDisabled && relayer
    ? startRelayWorker(relayer, { intervalMs: 15000 })
    : null;
const pinWorker =
  !backgroundWorkersDisabled &&
  featureEnabled("social") &&
  socialRecords.pinAdapter
    ? startPinWorker(socialRecords, { intervalMs: 60000 })
    : null;
const creatorMoneyWorker =
  !backgroundWorkersDisabled && creatorMoney?.enabled
    ? startCreatorMoneyWorker(creatorMoney, { intervalMs: 30000 })
    : null;
let nextMediaPrune = 0;
const maintenance = setInterval(() => {
  if (backgroundWorkersDisabled) return;
  try {
    expireWorlds(db);
    game.harvestDemo(db);
    db.prepare("DELETE FROM presence WHERE expires_at<? OR updated_at<?").run(
      Date.now(),
      Date.now() - 30_000,
    );
    db.prepare("DELETE FROM auth_challenges WHERE expires_at<?").run(
      Date.now(),
    );
    db.prepare("DELETE FROM sessions WHERE expires_at<?").run(Date.now());
    if (rates.size > 1000) rates.clear();
    if (Date.now() >= nextMediaPrune) {
      noteMedia.prune(db);
      taskEvidence.prune();
      nextMediaPrune = Date.now() + 3600000;
    }
  } catch (e) {
    console.error("Maintenance failed", e.name);
  }
}, 30_000);
maintenance.unref();
server.listen(port, process.env.HOST || "127.0.0.1", () =>
  console.log(
    `QuestLayer server: http://${process.env.HOST || "127.0.0.1"}:${server.address().port} · DEMO realm`,
  ),
);
async function close() {
  clearInterval(maintenance);
  await worldPlanner?.stop();
  await rewardWorker?.stop();
  await relayWorker?.stop?.();
  await creatorMoneyWorker?.stop?.();
  await pinWorker?.stop?.();
  for (const r of listeners) r.end();
  server.close(() => {
    db.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 2000).unref();
}
process.on("SIGTERM", close);
process.on("SIGINT", close);
