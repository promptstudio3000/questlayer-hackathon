import { defaultDatabasePath } from "./state-path.mjs";
import { publicLevelTable } from "./levels.mjs";
import { NativeTransactionConfirmation } from "./native/transaction-confirmation.mjs";
import { createCreatorRuntime } from "./creators/runtime.mjs";
import { createGuide, guideFacts, guideHint } from "./ai/guide.mjs";
import { nearAiStatus } from "./ai/near-ai.mjs";
import { createAdventureResults } from "./adventure-results.mjs";
import { recordSchemaVersions, schemaStatus } from "./schema-compatibility.mjs";
import { resolveBuildId } from "./build-id.mjs";
import { NoteMedia } from "./note-media.mjs";
import { TaskEvidence, evidenceTaskView } from "./task-evidence.mjs";
import { Moderation } from "./moderation.mjs";
import { SocialContent, isSocialBlocked } from "./social-content.mjs";
import { NativeProgression } from "./native/progression.mjs";
import { NativeTasks, TASK_CONTRACT } from "./native/tasks.mjs";
import { updatePresence, readNearbyPresence } from "./presence.mjs";
import { GotchiModels } from "./gotchi-models.mjs";
import { UpstreamModels } from "./upstream-models.mjs";
import {
  GotchiItemArt,
  linkedItemId,
  originalInventoryView,
} from "./gotchi-items.mjs";
import { publicAppearances, sharedOriginalSvg } from "./appearance.mjs";
import { NativeMarket } from "./native/market.mjs";
import {
  SignedOrderIndex,
  startOrderIndexWorker,
} from "./native/order-index.mjs";
import { IntentsMarket, createIntentsRoutes } from "./native/intents-market.mjs";
import { NativeEconomy } from "./native/economy.mjs";
import { questTemplateCatalog } from "./quest-templates.mjs";
import { NativeRewards } from "./native/rewards.mjs";
import { startRewardWorker } from "./native/reward-worker.mjs";
import { allocationSettings } from "./native/allocation.mjs";
import { AUTO_CITIES, cityStatus } from "./spatial/city-pack.mjs";
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
import {
  CreatorBonusVote,
  bonusVoteSettings,
  createBonusVoteRoutes,
} from "./creators/bonus-vote.mjs";
import { auditDistribution, auditSummary } from "./native/distribution.mjs";
import { createPublicLedger } from "./native/public-ledger.mjs";
import { readYieldBacking } from "./native/day-publication.mjs";
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
import { NativeContractReader } from "./native/reader.mjs";
import {
  NpcRolls,
  createNpcRollRoutes,
  loadTicketSigner,
  startNpcRollWorker,
} from "./npc/rolls.mjs";
import { startWorldPlanner, worldPreparationStatus } from "./world-planner.mjs";
import { startFlavourWorker } from "./ai/flavour-batch.mjs";
import { flavourStatus } from "./ai/flavour.mjs";
import { readGotchis } from "./aavegotchi.mjs";
import { verifyMessage as verifyEvmMessage, isAddress } from "viem";
import { createServer } from "node:http";
import { NativeCollectibles } from "./native/collectibles.mjs";
import { chainFeed, chainItems } from "./native/chain-feed.mjs";
import { clientAddress, pruneRateWindows } from "./http-security.mjs";
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
const BUILD_ID = resolveBuildId();
const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
import { createHash, randomBytes } from "node:crypto";
import { monitorEventLoopDelay, performance } from "node:perf_hooks";
import { ensureMapReadIndexes } from "./map-read-indexes.mjs";
import { ensureHotPathIndexes } from "./hot-path-indexes.mjs";
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
  evmAddress,
  evmChainId,
  signInMessage,
  siweNonce,
  verifyEvmSignature,
  walletLabel,
} from "./identity/evm.mjs";
import {
  openDatabase,
  atomic,
  playerView,
  history,
  createPlayer,
  demoProgression,
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
import { createActorRoutes } from "./actors/routes.mjs";
import { actorsAllDay, actorsEnabled, createActorService } from "./actors/service.mjs";
import { testSeedMode as readTestSeedMode } from "./test-seed/config.mjs";
import { createTestSeed } from "./test-seed/seed.mjs";
import "./npc/menu-builder.mjs";
import { createNpcService } from "./npc/service.mjs";
import { createNpcRoutes } from "./npc/routes.mjs";
import { registerMenuBuilder } from "./actors/menu.mjs";
import { loadTraders, traderKeysPath } from "./npc/trader-keys.mjs";
import { createTraderService } from "./npc/trader.mjs";
import { createTraderRoutes, stakeCard } from "./npc/trader-routes.mjs";
import { createNearPrice } from "./near-price.mjs";
import { createKeeperVault, keeperVaultSettings } from "./npc/keeper-vault.mjs";
import { createLiquidStake, liquidStakeSettings } from "./native/liquid-stake.mjs";
import { createTreasuryView } from "./native/stnear-treasury.mjs";
import { createTreasuryMixView, mixSettings } from "./native/treasury-mix.mjs";
import { createRheaMarkets, rheaSettings } from "./native/rhea-markets.mjs";
import { combineStakeReaders, createYieldVaultReader, yieldVaultSettings } from "./native/yield-vault-reader.mjs";
import { createQgoldVaultReader, qgoldVaultSettings } from "./native/qgold-vault.mjs";
import { createTraderKeeper, startTraderKeeper } from "./npc/trader-keeper.mjs";
import { createMonsterChallenges } from "./actors/challenges/index.mjs";
import { createChallengeRoutes } from "./actors/challenges/routes.mjs";
import { createMonsterHunt } from "./actors/hunt/index.mjs";
import { createHuntRoutes } from "./actors/hunt/routes.mjs";
import { dailyBoardSettings } from "./daily-board/config.mjs";
import { createDailyBoard } from "./daily-board/service.mjs";
import { createDailyBoardRoutes } from "./daily-board/routes.mjs";
import { loadPlaceBadges } from "./badges/place-catalog.mjs";
import { createBadgeService, userBadgeSettings } from "./badges/service.mjs";
import { createBadgeChain, startBadgeWorker } from "./badges/chain.mjs";
import { createBadgeRoutes } from "./badges/routes.mjs";
import { chainLedgerSettings, createChainLedger } from "./chain-ledger/service.mjs";
import { createLedgerChain, startLedgerWorker } from "./chain-ledger/chain.mjs";
import { createChainLedgerRoutes } from "./chain-ledger/routes.mjs";
import { seasonSettings } from "./season/config.mjs";
import { createSeason } from "./season/service.mjs";
import { createSeasonRoutes } from "./season/routes.mjs";
import { ensureFairPlaySchema, guardTravel } from "./fair-play.mjs";
import { DEFAULT_LAYER, WORLD_REGISTRY, layerSummary } from "./worlds/registry.mjs";
import { poiWorldStatus } from "./poi/coverage.mjs";
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
ensureMapReadIndexes(db);
ensureHotPathIndexes(db);
// Testnet test world (docs/TEST-SEED.md); throws on mainnet with TEST_SEED=1.
const testSeedMode = readTestSeedMode(process.env, NETWORK);
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
const creatorRuntime = createCreatorRuntime(db, {
  origin,
  authenticate: auth,
  // Paid quests start only after the player bought access on the creators contract.
  admitStart: (actor, questId, quest) =>
    creatorMoney?.admitStart(actor, questId, quest),
});
const guide = createGuide(db);
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
// Earned wisp rolls on the npc-games contract (docs/NPC-GAMES.md). The ticket
// key is a private file in the state directory (scripts/install-npc-ticket-key-vps.sh);
// without it, or on a network without the manifest, rolls stay off.
const npcGamesManifestPath = [
  resolve(APP_ROOT, `public/${manifestName("native-npc-games")}`),
  resolve(APP_ROOT, `dist/${manifestName("native-npc-games")}`),
].find((p) => existsSync(p));
const npcGamesManifest = npcGamesManifestPath
  ? JSON.parse(readFileSync(npcGamesManifestPath, "utf8"))
  : null;
const npcTicketSigner =
  npcGamesManifest?.network === NETWORK &&
  npcGamesManifest.contractId &&
  !nativeAttestationsDisabled
    ? loadTicketSigner(
        process.env.NPC_TICKET_SIGNER_PATH ||
          resolve(dirname(defaultDatabasePath()), "npc-games-ticket-signer.pem"),
      )
    : null;
// The npc_rolls table exists only on a host that holds the ticket key.
const npcRolls = npcTicketSigner
  ? new NpcRolls(db, {
      contract: new NativeContractReader(provider, npcGamesManifest.contractId),
      finalHeight: async () =>
        Number((await provider.viewBlock({ finality: "final" })).header.height),
      signer: npcTicketSigner,
      manifest: npcGamesManifest,
    })
  : null;
const npcRollRoutes = createNpcRollRoutes(npcRolls);
const awardVouchers = new AwardVouchers(db, nativeCollectibles, awardSigner, {
  claimIdFor: npcRolls ? (itemId) => npcRolls.claimIdFor(itemId) : null,
});
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
// Experimental NEAR Intents market (docs/NEAR-INTENTS-MARKET.md): on only when
// the self-deployed testnet verifier manifest exists. The relayer account is
// the solver: it pays gas for execute_intents and can move nothing itself.
const intentsManifestPath = [
  resolve(APP_ROOT, `public/${manifestName("native-intents")}`),
  resolve(APP_ROOT, `dist/${manifestName("native-intents")}`),
].find((p) => existsSync(p));
const intentsManifest =
  intentsManifestPath && process.env.INTENTS_MARKET_ENABLED !== "0"
    ? JSON.parse(readFileSync(intentsManifestPath, "utf8"))
    : null;
const relayerService =
  managedAccounts && relayConfig.enabled
    ? await loadServiceAccount(provider, relayConfig.relayerKeyPath)
    : null;
const relayer = managedAccounts
  ? new Relayer(
      db,
      provider,
      relayerService,
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
          npcGames: npcRolls?.contractId || undefined,
          intents: intentsManifest?.verifierContract || undefined,
          wnear: intentsManifest?.wnear || undefined,
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
        maxDepositYoctoPerDay: relayConfig.maxDepositYoctoPerDay,
        maxGas: relayConfig.maxGas,
        vaults: nativeVaults,
        factorySetupDeposit: rewardsConfig?.factory?.setupDeposit ?? null,
        factoryPools: VAULT_POOLS.map((p) => p.id),
      },
    )
  : null;
const signedOrderIndex = nativeMarket
  ? new SignedOrderIndex(db, nativeMarket, {
      relaySenderId: relayerService?.accountId ?? null,
    })
  : null;
const intentsMarket =
  intentsManifest?.network === NETWORK &&
  intentsManifest.verifierContract &&
  nativeMarket
    ? new IntentsMarket(db, {
        verifier: new NativeContractReader(provider, intentsManifest.verifierContract),
        nftContract: intentsManifest.nftContract || nativeMarket.nfts.contractId,
        wnear: intentsManifest.wnear,
        solver: relayerService,
        manifest: intentsManifest,
      })
    : null;
const intentsRoutes = createIntentsRoutes(intentsMarket);
const relayerRoutes = createRelayerRoutes({
  relayer,
  accounts: managedAccounts,
});
if (nativeRewards) {
  nativeRewards.vaultRegistry = nativeVaults;
  Object.assign(
    nativeRewards,
    allocationSettings(process.env, {
      isAutoCity: (id) => cityStatus(id) === "auto",
    }),
  );
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
// Community vote on the daily creator bonus: testnet only, on by default
// there (CREATOR_BONUS_VOTE=0 turns it off). It creates its tables on first
// use and answers "not enabled" until the creator community exists.
const creatorBonusVote =
  NETWORK !== "mainnet" &&
  featureEnabled("creators") &&
  process.env.CREATOR_BONUS_VOTE !== "0"
    ? new CreatorBonusVote(db, bonusVoteSettings(process.env))
    : null;
const creatorBonusVoteRoutes = createBonusVoteRoutes(creatorBonusVote);
// Roaming NPCs and monsters (docs/NPC-PLAN.md §14): off unless ACTORS_ENABLED=1.
// The testnet test world turns them on too.
const actorService =
  actorsEnabled() || testSeedMode === "apply"
    ? createActorService(db, {
        allDay: actorsAllDay(process.env, NETWORK),
        travelGuard: (player, fix, now) => {
          ensureFairPlaySchema(db);
          guardTravel(db, player, fix, now);
        },
      })
    : null;
const actorRoutes = createActorRoutes(actorService);
// Today's city plans are built off the request path after a restart, so the
// first /api/actors call does not stall the server (docs/PERFORMANCE-BUDGET.md).
if (actorService && !backgroundWorkersDisabled)
  setTimeout(() => {
    try {
      actorService.warm();
    } catch (e) {
      console.error("Actor plan warm-up failed:", e.name);
    }
  }, 1000).unref();
// A city world opened for the first time today gets its actor plan built
// right after the response, before the client asks for the cast.
function warmActorPlan(world) {
  if (!actorService || !world?.cityId) return;
  setImmediate(() => {
    try {
      actorService.planFor(world);
    } catch {}
  });
}
// NPC talk and quest lines (N1+N2). NPC_AI_PROVIDER unset reuses the guide's
// Ollama setup; the key stays in the runtime environment only.
// NEAR → EUR reference for "Stake 2 NEAR (~5 €)" labels (server/near-price.mjs).
const nearPrice = createNearPrice({ env: process.env });
const npcRoutes = createNpcRoutes(
  actorService ? createNpcService(db, { priceEur: () => nearPrice.eur() }) : null,
  actorService,
  db,
  {
    // Refreshes the staker status through the Keeper's vault reading.
    refreshStaker: (player) =>
      keeperVault && nativeVaults
        ? stakeCard({ db, player, vaults: nativeVaults, keeperVault, level: demoProgression(db, player).level, liquidStake: stakerReaders })
        : null,
  },
);
// NPC traders on market v2 (N3): on when actors run, the market is v2 and the
// private traders file exists (<state dir>/npc-traders.json or
// NPC_TRADERS_PATH). NPC_TRADER_ENABLED=0 turns them off. Testnet only.
let npcTraders = null;
try {
  const traderKeys =
    actorService && nativeMarket && signedOrderIndex && NETWORK === "testnet" && process.env.NPC_TRADER_ENABLED !== "0"
      ? loadTraders(traderKeysPath())
      : null;
  if (traderKeys?.size)
    npcTraders = createTraderService({
      db,
      traders: traderKeys,
      market: nativeMarket,
      nfts: nativeCollectibles,
      orderIndex: signedOrderIndex,
    });
} catch (error) {
  console.error("NPC traders disabled:", error?.message || error);
}
// Every Aura trade happens on NEAR (owner decision 4 Nov 2026): the old
// practice-GOLD market in the game database takes no new listings or
// purchases, and open listings are closed at boot (the Auras never left their
// owners' collections). Players secure an Aura, then sell it on market v2.
// PRACTICE_MARKET=db brings the database market back (local tests only).
const PRACTICE_MARKET_ON_CHAIN = process.env.PRACTICE_MARKET !== "db";
if (PRACTICE_MARKET_ON_CHAIN) {
  const closed = db
    .prepare("UPDATE listings SET state='cancelled' WHERE state='open'")
    .run().changes;
  if (closed) console.log(`Practice market moved on chain: closed ${closed} database listing(s).`);
}
function assertPracticeMarketOpen() {
  assert(
    !PRACTICE_MARKET_ON_CHAIN,
    "Aura trades now happen on NEAR. Secure the Aura, then sell it in Market → Secured.",
    410,
    "MARKET_ON_CHAIN",
  );
}
// Trade-up hand-overs are on-chain nft_transfers to the trader account; the
// relayer sponsors exactly the Auras of the player's issued trade-ups.
if (npcTraders && relayer) {
  const previousContext = relayer.customContext;
  relayer.customContext = async (base, extra) => {
    const ctx = previousContext ? await previousContext(base, extra) : base;
    return {
      ...ctx,
      tradeUpHandovers: npcTraders
        .handoversFor(extra.playerId)
        .filter((h) => h.accountId === ctx.accountId),
    };
  };
}
if (npcTraders)
  registerMenuBuilder("trader", async (context) => {
    try {
      return await npcTraders.menu(context);
    } catch (error) {
      console.error("NPC trader menu:", error?.code || error?.message || error);
      return [];
    }
  });
// Keeper's inner vault (GAME-LOOPS P0-3): stake card, E+2 countdown and
// ceremonies. Read-only; KEEPER_* variables override every default.
const keeperVaultConfig = keeperVaultSettings(process.env);
const keeperVault =
  nativeVaults && keeperVaultConfig.enabled
    ? createKeeperVault(db, {
        settings: keeperVaultConfig,
        priceEur: () => nearPrice.eur(),
        today: () => {
          try {
            return nativeRewards?.todayCoins() ?? null;
          } catch {
            return null;
          }
        },
      })
    : null;
// Liquid staking tokens (docs/LIQUID-STAKE.md): read-only second path to the
// Staker step. Off unless LIQUID_STAKE_ENABLED=1.
// Game treasury held in stNEAR (docs/STNEAR-TREASURY.md): the Mac worker
// writes a public record (no keys) of deposits and daily growth harvests;
// this reads it and adds the live stNEAR balance.
const treasuryRecordPaths = [
  process.env.STNEAR_TREASURY_RECORD,
  resolve(dirname(defaultDatabasePath()), manifestName("stnear-treasury")),
  resolve(APP_ROOT, `public/${manifestName("stnear-treasury")}`),
  resolve(APP_ROOT, `dist/${manifestName("stnear-treasury")}`),
].filter(Boolean);
const stnearTreasury = createTreasuryView({
  provider,
  record: () => {
    const p = treasuryRecordPaths.find((f) => existsSync(f));
    return p ? JSON.parse(readFileSync(p, "utf8")) : null;
  },
});
// Treasury mix 50 % LST / 40 % stablecoins on Rhea Lend / 10 % NEAR
// (docs/TREASURY-MIX.md): live holdings, targets and the next run's plan. The
// Mac worker writes the public record of runs; this never signs.
const treasuryMixRecordPaths = [
  process.env.TREASURY_MIX_RECORD,
  resolve(dirname(defaultDatabasePath()), manifestName("treasury-mix")),
  resolve(APP_ROOT, `public/${manifestName("treasury-mix")}`),
  resolve(APP_ROOT, `dist/${manifestName("treasury-mix")}`),
].filter(Boolean);
const readJsonRecord = (paths) => {
  const p = paths.find((f) => existsSync(f));
  return p ? JSON.parse(readFileSync(p, "utf8")) : null;
};
const treasuryMixConfig = mixSettings(process.env, NETWORK);
const treasuryMix = treasuryMixConfig.enabled
  ? createTreasuryMixView({
      provider,
      settings: treasuryMixConfig,
      record: () => readJsonRecord(treasuryMixRecordPaths),
      account: () => readJsonRecord(treasuryRecordPaths)?.account || null,
    })
  : null;
const liquidStakeConfig = liquidStakeSettings(process.env, NETWORK);
const liquidStake =
  liquidStakeConfig.enabled && liquidStakeConfig.tokens.length
    ? createLiquidStake({ provider, settings: liquidStakeConfig })
    : null;
// Yield vault (docs/YIELD-VAULT.md): locked deposits count toward Staker at once.
// Contract from YIELD_VAULT_ACCOUNT or public/native-yield-vault-<network>.json.
const yieldVaultManifestPath = resolve(APP_ROOT, `public/native-yield-vault-${NETWORK}.json`);
const yieldVaultConfig = yieldVaultSettings(
  process.env,
  existsSync(yieldVaultManifestPath) ? JSON.parse(readFileSync(yieldVaultManifestPath, "utf8")) : null,
);
const yieldVaultReader = yieldVaultConfig.enabled
  ? createYieldVaultReader({ provider, settings: yieldVaultConfig, priceEur: () => nearPrice.eur() })
  : null;
// QGOLD vault (docs/QGOLD-VAULT.md): backing, R, exits and the invariant monitor.
// Contract from QGOLD_VAULT_ACCOUNT or public/native-qgold-vault-<network>.json.
const qgoldManifestPath = resolve(APP_ROOT, `public/native-qgold-vault-${NETWORK}.json`);
const qgoldConfig = qgoldVaultSettings(
  process.env,
  existsSync(qgoldManifestPath) ? JSON.parse(readFileSync(qgoldManifestPath, "utf8")) : null,
);
const qgoldVault = qgoldConfig.enabled
  ? createQgoldVaultReader({ provider, settings: qgoldConfig, log: (event, data) => console.warn(JSON.stringify({ event, ...data })) })
  : null;
if (qgoldVault) {
  void qgoldVault.read().catch(() => {});
  setInterval(() => void qgoldVault.read({ fresh: true }).catch(() => {}), 60_000).unref();
}
// Every Staker source besides the native vault, summed for the Keeper's reading.
const stakerReaders = combineStakeReaders([liquidStake, yieldVaultReader]);
// Rhea Lend markets (docs/YIELD-VAULT-PLAN.md): read-only rates and utilization.
const rheaConfig = rheaSettings(process.env, NETWORK);
const rheaMarkets = rheaConfig.enabled ? createRheaMarkets({ provider, settings: rheaConfig }) : null;
const traderRoutes = createTraderRoutes({
  traders: npcTraders,
  actors: actorService,
  db,
  market: nativeMarket,
  vaults: nativeVaults,
  keeperVault,
  levelOf: (player) => demoProgression(db, player).level,
  priceEur: () => nearPrice.eur(),
  liquidStake: stakerReaders,
});
// Monster quiz, mini-games and stance duel (NPC-PLAN §13.2): power is the
// account level (spendable XP) plus skill, never Auras or items.
// Monster hunt (NPC-PLAN §13, M3+M4): win rewards, guardian-locked chests and
// the weekly co-op boss. Same ACTORS_ENABLED flag; BOSS_HP sizes the pool.
const monsterHunt = createMonsterHunt(db, actorService, {
  levelOf: (player) => demoProgression(db, player).level,
  bossHp: Number(process.env.BOSS_HP) || undefined,
});
const huntRoutes = createHuntRoutes(monsterHunt, actorService, db);
// Daily board of three goals (docs/DAILY-BOARD.md): on by default except on
// mainnet; DAILY_BOARD_* settings change the goals and bonus. No streak.
const dailyBoardConfig = dailyBoardSettings(process.env, NETWORK);
const dailyBoard = dailyBoardConfig.enabled
  ? createDailyBoard(db, dailyBoardConfig, { actorsOn: () => !!actorService })
  : null;
const dailyBoardRoutes = createDailyBoardRoutes(dailyBoard, db);
// Badges (docs/BADGES.md): place badges for notable places reached with GPS
// (game database, cosmetic, never sellable) and POAP-like player badges on
// the soulbound questlayer_badges contract. The contract id comes from
// public/native-badges-<network>.json (or NEAR_BADGES_CONTRACT); the minter
// key from <state dir>/badges-minter.json (or BADGES_MINTER_KEY_PATH).
const badgesManifestPath = [
  resolve(APP_ROOT, `public/${manifestName("native-badges")}`),
  resolve(APP_ROOT, `dist/${manifestName("native-badges")}`),
].find((p) => existsSync(p));
const badgeChain = createBadgeChain({
  provider,
  contractId:
    process.env.NEAR_BADGES_CONTRACT ||
    (badgesManifestPath
      ? JSON.parse(readFileSync(badgesManifestPath, "utf8")).contractId
      : null),
  signer: awardSigner,
  keyPath:
    process.env.BADGES_MINTER_KEY_PATH ||
    resolve(dirname(defaultDatabasePath()), "badges-minter.json"),
});
const badgeService =
  process.env.BADGES_ENABLED === "0"
    ? null
    : createBadgeService(db, {
        catalog: loadPlaceBadges({ extraPath: process.env.PLACE_BADGES_EXTRA_PATH || null }),
        linkedAccount: (player) => linkedAccount(player),
        settings: userBadgeSettings(process.env, NETWORK),
        chain: () => badgeChain,
      });
const badgeRoutes = createBadgeRoutes(badgeService);
// On-chain ledger (docs/CHAIN-LEDGER.md): every coin, XP, street find, quest
// and monster win as a soulbound QXP/QGOLD mint with what it was for. The
// contract id comes from public/native-ledger-<network>.json (or
// NEAR_LEDGER_CONTRACT); the recorder key from <state dir>/ledger-recorder.json
// (or LEDGER_RECORDER_KEY_PATH). CHAIN_RECORD_MODE=each|daily|off.
const ledgerManifestPath = [
  resolve(APP_ROOT, `public/${manifestName("native-ledger")}`),
  resolve(APP_ROOT, `dist/${manifestName("native-ledger")}`),
].find((p) => existsSync(p));
const ledgerContractId =
  process.env.NEAR_LEDGER_CONTRACT ||
  (ledgerManifestPath ? JSON.parse(readFileSync(ledgerManifestPath, "utf8")).contractId : null);
const chainLedgerConfig = chainLedgerSettings(process.env, NETWORK);
const ledgerChain = createLedgerChain({
  provider,
  contractId: ledgerContractId,
  keyPath:
    process.env.LEDGER_RECORDER_KEY_PATH ||
    resolve(dirname(defaultDatabasePath()), "ledger-recorder.json"),
});
const chainLedger =
  ledgerContractId && chainLedgerConfig.mode !== "off"
    ? createChainLedger(db, { settings: chainLedgerConfig, linkedAccount: (player) => linkedAccount(player) })
    : null;
const chainLedgerRoutes = createChainLedgerRoutes(chainLedger, {
  chain: () => ledgerChain,
  linkedAccount: (player) => linkedAccount(player),
});
// Hackathon season (docs/SEASON.md): cosmetic leaderboard of hunts, visits and
// NPC lines, season mark + Aura at the goal, pot meter. Off by default on
// mainnet; SEASON_* settings change the window, goal and points.
const seasonConfig = seasonSettings(process.env, NETWORK);
const season = seasonConfig.enabled ? createSeason(db, seasonConfig) : null;
const seasonRoutes = createSeasonRoutes(season);
const testSeed = createTestSeed(db, {
  creators: creatorRuntime.services
    ? {
        services: creatorRuntime.services,
        moderator: creatorRuntime.config.moderators[0],
        completionAuthority: creatorRuntime.config.completionAuthorities[0],
        policyVersion: creatorRuntime.config.policy.version,
      }
    : null,
  log: (message) => console.log(message),
});
try {
  if (testSeedMode === "apply")
    console.log("Test seed applied:", JSON.stringify(testSeed.apply()));
  else {
    const purged = testSeed.purge();
    if (purged.removed) console.log("Test seed removed:", JSON.stringify(purged));
  }
} catch (error) {
  console.error("Test seed failed:", error?.code || error?.message || error);
}
const testSeedActive = testSeedMode === "apply";
const challengeRoutes = createChallengeRoutes(
  createMonsterChallenges(db, actorService, {
    levelOf: (player) => demoProgression(db, player).level,
    onResult: monsterHunt?.onChallengeResult,
  }),
);
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
      bonusVote: creatorBonusVote,
    })
  : null;
const creatorMoneyRoutes = createCreatorMoneyRoutes(creatorMoney);
const nativeEconomy = nativeRewards ? new NativeEconomy(nativeRewards) : null;
// Public economy ledger for the /economy page (docs/ECONOMY-PAGE.md).
const yieldCycleProofPath = resolve(APP_ROOT, "public/native-yield-cycle-proof.json");
const publicLedger = createPublicLedger({
  native: nativeRewards,
  treasury: stnearTreasury,
  yieldBacking: readYieldBacking,
  cycleProof: () =>
    existsSync(yieldCycleProofPath)
      ? JSON.parse(readFileSync(yieldCycleProofPath, "utf8"))
      : null,
});
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
const upstreamModels = new UpstreamModels();
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
// Per-minute counters: keys end with ":<minute>". `limit` throws 429 past `max`.
function limit(scope, who, max, message) {
  const key = `${scope}:${who}:${Math.floor(Date.now() / 60_000)}`,
    n = (rates.get(key) || 0) + 1;
  rates.set(key, n);
  assert(n <= max, message, 429, "RATE_LIMITED");
}
// The world each explorer last loaded (POST/GET /api/world). Coin and quest
// events only go to streams of explorers on that world: broadcasting every
// pick-up in Czechia to every phone was most of the server's socket writes
// with 500 walkers (npm run load:test). A stream whose explorer has not
// loaded a world yet still gets everything.
const viewing = new Map();
function viewWorld(player, worldId) {
  if (!worldId || viewing.get(player) === worldId) return;
  viewing.delete(player);
  if (viewing.size >= 100_000) viewing.delete(viewing.keys().next().value);
  viewing.set(player, worldId);
}
function emit(type, data, worldId = null) {
  const event = `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of listeners) {
    const at = worldId && viewing.get(client.questlayerPlayer);
    if (!at || at === worldId) client.write(event);
  }
}
const coinWorld = (coinId) => String(coinId).split(":coin:")[0] || null;
const questWorld = (questId) =>
  db.prepare("SELECT world_id FROM quests WHERE id=?").get(String(questId))?.world_id ?? null;
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
// GET reads the client polls (the map refreshes every 15 s): the phone's own
// cache keeps the last body and the server answers 304 when nothing changed.
// Private, so a shared proxy never stores one player's view.
function respondCached(req, res, data) {
  const body = JSON.stringify(data),
    tag = `"${createHash("sha1").update(body).digest("base64url").slice(0, 27)}"`,
    seen = String(req.headers["if-none-match"] || "")
      .split(",")
      .map((t) => t.trim().replace(/^W\//, ""));
  const headers = {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "private, no-cache",
    ETag: tag,
    Vary: "Cookie",
  };
  if (seen.includes(tag)) {
    res.writeHead(304, headers);
    return res.end();
  }
  res.writeHead(200, headers);
  res.end(body);
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
      ...schemaStatus(db, { buildId: BUILD_ID }),
      mode: "demo",
      worldPreparation: worldPreparationStatus(db),
      autoCities: AUTO_CITIES.entries.length
        ? {
            status: "on",
            version: AUTO_CITIES.version,
            cities: AUTO_CITIES.entries.length,
            funded: false,
          }
        : { status: "off" },
      // POI database version, coverage totals and the World worker's last
      // run (docs/WORLD-COVERAGE.md); cached per published file.
      poiWorld: poiWorldStatus(),
      questFlavour: flavourStatus(db),
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
      testSeed: testSeedActive ? testSeed.status() : { status: "off" },
      npcRolls: npcRolls
        ? {
            status: (await npcRolls.readiness()).ok ? "ready" : "off",
            contractId: npcRolls.contractId,
          }
        : { status: "not-configured" },
      dailyBoard: dailyBoard ? dailyBoard.status() : { status: "off" },
      season: season ? season.status() : { status: "off" },
      badges: badgeService ? badgeService.status() : { status: "off" },
      qgoldVault: qgoldVault ? qgoldVault.status() : { status: "not-configured" },
      chainLedger: chainLedger
        ? { ...chainLedger.status(), contract: ledgerChain.contractId, recorder: ledgerChain.ready ? "ready" : ledgerChain.error }
        : { mode: "off" },
      now: Date.now(),
    });
  if (path === "/api/levels" && method === "GET")
    return respond(res, publicLevelTable());
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
  if (path === "/api/treasury/mix" && method === "GET") {
    assert(treasuryMix, "The treasury mix is not configured on this network.", 503, "TREASURY_MIX_DISABLED");
    return respond(res, await treasuryMix(), 200, { "Cache-Control": "public, max-age=60" });
  }
  if (path === "/api/economy/ledger" && method === "GET")
    return respond(res, await publicLedger(), 200, {
      "Cache-Control": "public, max-age=60",
    });
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
      nearAI: nearAiStatus(process.env),
      guide: guide.provider,
      // World layers (docs/WORLDS-PLAN.md): response-only, never hashed.
      layerId: DEFAULT_LAYER.id,
      layers: WORLD_REGISTRY.liveLayers(process.env).map(layerSummary),
    });
  if (path === "/api/session" && method === "POST") {
    // New guest explorers per network address: stops bulk alt accounts.
    limit(
      "new-guest",
      clientAddress(req, process.env.TRUST_PROXY === "loopback"),
      30,
      "Too many new explorers from this network. Please wait a minute.",
    );
    const input = await body(req);
    const result = game.session(db, input.name);
    identitySessions.record(result.token, "guest");
    if (testSeedActive) testSeed.grantKit(result.player.id);
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
  if (path === "/api/auth/evm/challenge" && method === "POST") {
    // Sign-In with Ethereum (MetaMask, Rabby, ...). link=true adds the wallet
    // to the signed-in explorer instead of signing in.
    const input = await body(req),
      address = evmAddress(input.address),
      chainId = evmChainId(input.chainId),
      link = input.link === true,
      name = String(input.name || "Explorer").trim();
    assert(
      name.length >= 2 && name.length <= 24,
      "Your name must be 2–24 characters.",
    );
    const current = link
      ? identitySessions.authenticate(sessionToken(req))
      : null;
    const address_ = clientAddress(req, process.env.TRUST_PROXY === "loopback"),
      key = `evm-auth:${address_}:${Math.floor(Date.now() / 60000)}`,
      count = (rates.get(key) || 0) + 1;
    rates.set(key, count);
    assert(
      count <= 30,
      "Please wait before starting another wallet sign-in.",
      429,
    );
    const issuedAt = Date.now(),
      expiresAt = issuedAt + 300_000,
      nonce = siweNonce(randomBytes(16));
    const message = signInMessage({
      origin,
      address,
      chainId,
      nonce,
      issuedAt,
      expiresAt,
    });
    const c = challenge("evm_signin", {
      purpose: link ? "evm-link" : "evm-sign-in",
      address,
      name,
      wallet: walletLabel(input.wallet),
      message,
      player: current?.playerId ?? null,
      sessionId: current?.sessionId ?? null,
    });
    return respond(res, { challengeId: c.id, message, address, chainId });
  }
  if (path === "/api/auth/evm/verify" && method === "POST") {
    const input = await body(req),
      c = readChallenge(input.challengeId);
    assert(
      c.purpose === "evm-sign-in" || c.purpose === "evm-link",
      "This challenge cannot sign in an explorer.",
      401,
    );
    const link = c.purpose === "evm-link";
    if (link)
      assert(
        identitySessions.authenticate(sessionToken(req)).sessionId ===
          c.sessionId,
        "Finish linking in the browser where it was started.",
        403,
      );
    const key = await verifyEvmSignature({
      message: c.message,
      signature: input.signature,
      address: c.address,
    });
    const result = atomic(db, () => {
      consumeChallenge(input.challengeId);
      const existing = db
        .prepare("SELECT player_id FROM evm_links WHERE address=?")
        .get(key.address);
      if (link)
        assert(
          !existing || existing.player_id === c.player,
          "This wallet is linked to another explorer.",
          409,
        );
      const player = link
        ? c.player
        : existing?.player_id || createPlayer(db, c.name);
      const now = Date.now();
      db.prepare(
        `INSERT INTO evm_links(address,player_id,public_key,wallet,created_at,verified_at) VALUES(?,?,?,?,?,?)
         ON CONFLICT(address) DO UPDATE SET verified_at=excluded.verified_at, wallet=COALESCE(excluded.wallet,evm_links.wallet)`,
      ).run(key.address, player, key.intentsPublicKey, c.wallet, now, now);
      // The same signature proves the address for wearing Aavegotchi
      // originals, unless another explorer already uses it.
      db.prepare(
        "INSERT OR IGNORE INTO external_links VALUES (?,?,?,?)",
      ).run(key.address, player, "{}", 0);
      return {
        player,
        token: link ? null : newSession(player, "evm-wallet", key.address),
        returning: !!existing,
      };
    });
    return respond(
      res,
      {
        player: profile(result.player),
        returning: result.returning,
        identity: "evm-wallet",
        address: key.address,
        intentsPublicKey: key.intentsPublicKey,
        network: NETWORK,
      },
      200,
      result.token ? { "Set-Cookie": cookie(result.token) } : {},
    );
  }
  if (path === "/api/identity/evm" && method === "GET") {
    const current = identitySessions.authenticate(sessionToken(req));
    return respond(res, {
      wallets: db
        .prepare(
          "SELECT address,public_key AS intentsPublicKey,wallet,verified_at AS verifiedAt FROM evm_links WHERE player_id=? ORDER BY verified_at DESC",
        )
        .all(current.playerId),
    });
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
      onChain: PRACTICE_MARKET_ON_CHAIN,
      listings: PRACTICE_MARKET_ON_CHAIN ? [] : db
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
    assert(signedOrderIndex, "Signed orders are not available yet.", 503);
    return respond(res, {
      network: NETWORK,
      marketContract: nativeMarket.contractId,
      index: "durable; every order re-verified by the market contract",
      orders: await signedOrderIndex.list({
        tokenId: url.searchParams.get("token"),
      }),
    });
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
    await challengeRoutes.handle(req, res, url, { player, body, respond, assert })
  )
    return;
  if (await huntRoutes.handle(req, res, url, { player, body, respond, assert }))
    return;
  if (await dailyBoardRoutes.handle(req, res, url, { player, body, respond, assert }))
    return;
  if (await badgeRoutes.handle(req, res, url, { player, body, respond, assert }))
    return;
  if (await chainLedgerRoutes.handle(req, res, url, { player, body, respond, assert }))
    return;
  if (await seasonRoutes.handle(req, res, url, { player, body, respond, assert }))
    return;
  if (
    await npcRollRoutes.handle(req, res, url, { player, body, respond, assert })
  )
    return;
  if (
    await intentsRoutes.handle(req, res, url, { player, body, respond, assert })
  )
    return;
  if (
    await actorRoutes.handle(req, res, url, { player, body, respond, assert })
  )
    return;
  if (await traderRoutes.handle(req, res, url, { player, body, respond, assert }))
    return;
  if (url.pathname === "/api/treasury/stnear" && req.method === "GET")
    return respond(res, await stnearTreasury());
  if (url.pathname === "/api/yield/markets" && req.method === "GET") {
    assert(rheaMarkets, "Rhea Lend markets are not open here.", 503, "RHEA_DISABLED");
    return respond(res, await rheaMarkets.read());
  }
  if (url.pathname === "/api/qgold" && req.method === "GET") {
    assert(qgoldVault, "The QGOLD vault is not open here.", 503, "QGOLD_DISABLED");
    const m = qgoldConfig.manifest || {};
    return respond(res, {
      ...(await qgoldVault.read()),
      token: { contract: m.tokenContract || qgoldConfig.contract, symbol: "QGOLD", decimals: 6 },
      methods: m.methods || null,
      exitPaths: m.exitPaths || ["near_instant", "near_queue"],
    });
  }
  if (url.pathname === "/api/qgold/account" && req.method === "GET") {
    assert(qgoldVault, "The QGOLD vault is not open here.", 503, "QGOLD_DISABLED");
    return respond(res, await qgoldVault.account(url.searchParams.get("account") || ""));
  }
  if (url.pathname === "/api/yield/position" && req.method === "GET") {
    assert(yieldVaultReader, "The yield vault is not open here.", 503, "YIELD_VAULT_DISABLED");
    return respond(res, await yieldVaultReader.forPlayer(db, player));
  }
  if (url.pathname === "/api/staker/liquid" && req.method === "GET") {
    assert(liquidStake, "Liquid staking is not open here.", 503, "LIQUID_STAKE_DISABLED");
    return respond(res, await liquidStake.forPlayer(db, player));
  }
  if (await npcRoutes.handle(req, res, url, { player, body, respond, assert }))
    return;
  if (
    await creatorBonusVoteRoutes.handle(req, res, url, {
      player,
      body,
      respond,
      assert,
    })
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
    // Wallet-signed market calls feed the signed-order index from the same
    // final receipt. The index is advisory, so a failure here never blocks.
    if (
      signedOrderIndex &&
      result?.confirmed &&
      input?.quote?.receiverId === nativeMarket?.contractId
    )
      await signedOrderIndex
        .recordTransaction(input.transactionHash, input.accountId)
        .catch(() => {});
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
  // The "On chain" feed (Settings) and ChainLink polling.
  if (
    (path === "/api/chain/feed" || path === "/api/chain/items") &&
    method === "GET"
  ) {
    const key = `chain-feed:${player}:${Math.floor(Date.now() / 60000)}`,
      count = (rates.get(key) || 0) + 1;
    rates.set(key, count);
    assert(count <= 120, "Please wait a moment before checking again.", 429);
    return respond(
      res,
      path === "/api/chain/feed"
        ? chainFeed(db, player, { limit: url.searchParams.get("limit") })
        : chainItems(
            db,
            player,
            String(url.searchParams.get("ids") || "").split(","),
          ),
    );
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
  if (path === "/api/native/market/signer" && method === "GET") {
    assert(nativeMarket, "The secured market is not available yet.", 503);
    return respond(res, await nativeMarket.signer(url.searchParams.get("account")));
  }
  if (path === "/api/native/market/orders/status" && method === "POST") {
    assert(signedOrderIndex, "Signed orders are not available yet.", 503);
    const input = await body(req);
    return respond(res, {
      statuses: await signedOrderIndex.statuses(input.orders),
    });
  }
  if (path === "/api/native/market/orders" && method === "POST") {
    assert(nativeMarket, "The secured market is not available yet.", 503);
    const input = await body(req);
    assert(signedOrderIndex, "Signed orders are not available yet.", 503);
    return respond(res, await signedOrderIndex.submit(input.order));
  }
  if (path === "/api/native/market/orders/events" && method === "POST") {
    assert(signedOrderIndex, "Signed orders are not available yet.", 503);
    const input = await body(req);
    return respond(
      res,
      await signedOrderIndex.recordTransaction(
        input.transactionHash,
        input.accountId,
      ),
    );
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
  if (path === "/api/me") {
    if (testSeedActive) testSeed.grantKit(player);
    return respond(res, { player: profile(player) });
  }
  if (path === "/api/events") {
    // Each open stream holds a socket: a few per explorer is plenty.
    const open = [...listeners].filter((r) => r.questlayerPlayer === player).length;
    assert(open < 4, "Too many open live connections. Close another tab.", 429, "RATE_LIMITED");
    res.questlayerPlayer = player;
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
    limit("world-open", player, 30, "Please wait before loading another area.");
    const input = await body(req),
      location = point(input.location || HOME),
      query = worldQuery({
        bounds: input.bounds,
        limit: input.limit,
        cursor: input.cursor,
      });
    const spans = (res.timingSpans = {});
    let at = performance.now();
    expireWorlds(db);
    spans.wexpire = performance.now() - at;
    at = performance.now();
    // `explore`: a spot of the same city the player asked to search (map moved).
    const world = await ensureWorld(db, location, input.arena !== false, Date.now(), {
      cellAt: input.explore ? point(input.explore) : null,
    });
    spans.wensure = performance.now() - at;
    viewWorld(player, world.id);
    warmActorPlan(world);
    // layerId is added to the response only, never to the stored manifest.
    return respond(res, {
      ...worldView(db, world.id, player, {
        timing: spans,
        ...query,
        near: input.near,
        lang: input.lang === "cs" ? "cs" : "en",
      }),
      layerId: DEFAULT_LAYER.id,
    });
  }
  if (path === "/api/world" && method === "GET") {
    limit("world-read", player, 240, "Please wait before refreshing the map again.");
    const w = worldView(db, url.searchParams.get("id"), player, {
      timing: (res.timingSpans = {}),
      near: url.searchParams.get("near") ?? undefined,
      ...worldQuery({
        bounds: url.searchParams.get("bbox") ?? undefined,
        limit: url.searchParams.get("limit") ?? undefined,
        cursor: url.searchParams.get("cursor") ?? undefined,
      }),
    });
    assert(w, "This area could not be found. Refresh the map.", 404);
    viewWorld(player, w.id);
    return respondCached(req, res, { ...w, layerId: DEFAULT_LAYER.id });
  }
  if (path === "/api/coins/claim" && method === "POST") {
    limit("coin", player, 240, "Please slow down collecting coins.");
    const input = await body(req),
      result = game.claimCoin(db, player, input.coinId, input.fix);
    if (!result.alreadyClaimed) emit("coin", { id: input.coinId }, coinWorld(input.coinId));
    return respond(res, { ...result, player: profile(player) });
  }
  if (path === "/api/quests/checkpoint" && method === "POST") {
    limit("quest", player, 60, "Please wait before confirming another stop.");
    const input = await body(req),
      result = game.advanceRoute(
        db,
        player,
        input.questId,
        input.fix,
        input.checkpoint,
      );
    emit("quest", { id: input.questId }, questWorld(input.questId));
    return respond(res, { ...result, player: profile(player) });
  }
  if (path === "/api/quests/claim" && method === "POST") {
    limit("quest", player, 60, "Please wait before confirming another discovery.");
    const input = await body(req);
    // A guardian monster on duty locks its zone chest until you beat it.
    monsterHunt?.chests.assertOpen(player, input.questId);
    const result = game.claimQuest(db, player, input.questId, input.fix, undefined, {
      answer: typeof input.answer === "string" ? input.answer.slice(0, 40) : null,
    });
    emit("quest", { id: input.questId }, questWorld(input.questId));
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
    assertPracticeMarketOpen();
    const i = await body(req);
    const r = game.listItem(db, player, i.itemId, i.price);
    emit("market", {});
    return respond(res, { ...r, player: profile(player) });
  }
  if (path === "/api/market/buy" && method === "POST") {
    assertPracticeMarketOpen();
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
    limit("presence", player, 30, "Please wait before sharing your position again.");
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
  if (path.startsWith("/api/upstream-models/") && method === "GET") {
    // Official Gotchiverse models for monsters and stations, fetched from one pinned source and digest-checked
    // (server/upstream-models.mjs). Immutable per key, so browsers cache them.
    const key = path.match(/^\/api\/upstream-models\/([a-z-]{3,32})\.fbx$/)?.[1];
    assert(key && UpstreamModels.has(key), "Unknown model.", 404);
    const rateKey = `upstream-model:${player}:${Math.floor(Date.now() / 60000)}`;
    const count = (rates.get(rateKey) || 0) + 1;
    rates.set(rateKey, count);
    assert(count <= 30, "Please wait before loading more models.", 429);
    let model;
    try {
      model = await upstreamModels.get(key);
    } catch (error) {
      assert(false, error.message, error.status || 502);
    }
    res.writeHead(200, {
      "Content-Type": "application/octet-stream",
      "Content-Length": model.bytes.length,
      "Content-Security-Policy": "default-src 'none'; sandbox",
      "X-Content-Type-Options": "nosniff",
      ETag: `"${model.sha256}"`,
      "Cache-Control": "private,max-age=86400,immutable",
    });
    return res.end(model.bytes);
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
  if (path === "/api/guide/hint" && method === "POST") {
    // First-session coach: one grounded sentence for the player's current
    // step, from the same live world the guide reads. No model, no quota.
    const i = await body(req);
    assert(typeof i.step === "string" && i.step.length <= 20, "Unknown step.");
    const location = i.location ? point(i.location) : null;
    const world =
      typeof i.worldId === "string" && i.worldId.length <= 200
        ? worldView(db, i.worldId, player)
        : null;
    return respond(res, { step: i.step, ...(guideHint(i.step, { world, location }) || { hint: null, factIds: [] }) });
  }
  if (path === "/api/npc" && method === "POST") {
    // Grounded guide: answers only from this player's live world and today's
    // testnet day; a model may rephrase those facts, never add to them.
    const i = await body(req);
    assert(
      typeof i.question === "string" && i.question.length <= 300,
      "The question is too long.",
    );
    const location = i.location ? point(i.location) : null;
    const world =
      typeof i.worldId === "string" && i.worldId.length <= 200
        ? worldView(db, i.worldId, player)
        : null;
    let native = null;
    if (nativeRewards)
      native = await Promise.race([
        nativeRewards
          .snapshot(player, location ? { location } : {})
          .catch(() => null),
        new Promise((done) => setTimeout(() => done(null), 3000)),
      ]);
    return respond(
      res,
      await guide.ask({
        actor: player,
        question: i.question,
        facts: guideFacts({ world, native, location }),
      }),
    );
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
// Server-side timing (docs/PERFORMANCE-BUDGET.md): every API answer carries
// Server-Timing "app" (request start to headers) and "loop" (worst event-loop
// stall in the last few seconds), so a slow phone request can be split into
// network, handler and a blocked loop. Slow ones are logged by route only.
const loopDelay = monitorEventLoopDelay({ resolution: 10 });
loopDelay.enable();
let loopWorstMs = 0;
setInterval(() => {
  loopWorstMs = loopDelay.max / 1e6;
  loopDelay.reset();
}, 5000).unref();
const SLOW_API_MS = Number(process.env.SLOW_API_MS || 250);
function timeApiRequest(req, res, path) {
  const started = performance.now(),
    writeHead = res.writeHead;
  let done = false;
  res.writeHead = function (...args) {
    if (!done) {
      done = true;
      const ms = performance.now() - started,
        loop = Math.max(loopWorstMs, loopDelay.max / 1e6);
      if (!res.headersSent)
        res.setHeader(
          "Server-Timing",
          [
            `app;dur=${ms.toFixed(1)}`,
            `loop;dur=${loop.toFixed(1)}`,
            ...Object.entries(res.timingSpans || {}).map(
              ([name, d]) => `${name};dur=${d.toFixed(1)}`,
            ),
          ].join(", "),
        );
      if (ms >= SLOW_API_MS)
        console.warn(
          `Slow API ${req.method} ${path.replace(/[0-9a-f-]{16,}|\d{4,}/g, ":id")} ${Math.round(ms)} ms (loop stall ${Math.round(loop)} ms)`,
        );
    }
    return writeHead.apply(this, args);
  };
}
const server = createServer(async (req, res) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader(
    "Permissions-Policy",
    "geolocation=(self), camera=(), microphone=()",
  );
  try {
    const url = new URL(req.url, "http://localhost");
    if (url.pathname.startsWith("/api/")) {
      timeApiRequest(req, res, url.pathname);
      return await api(req, res, url);
    }
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
// Nightly quest flavour texts (docs/QUEST-FLAVOUR.md); never on a request path.
const flavourWorker = backgroundWorkersDisabled ? null : startFlavourWorker(db);
const rewardWorker =
  !backgroundWorkersDisabled &&
  nativeRewards &&
  process.env.REWARD_WORKER_KEY_PATH
    ? startRewardWorker(nativeRewards, {
        keyPath: process.env.REWARD_WORKER_KEY_PATH,
      })
    : null;
const chainLedgerWorker =
  !backgroundWorkersDisabled && chainLedger
    ? startLedgerWorker(chainLedger, ledgerChain, { intervalMs: chainLedgerConfig.batchMs })
    : null;
const badgeWorker =
  !backgroundWorkersDisabled && badgeService && (badgeService.settings.enabled || badgeService.settings.placeMints)
    ? startBadgeWorker(badgeService, badgeChain)
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
const npcRollWorker =
  !backgroundWorkersDisabled && npcRolls ? startNpcRollWorker(npcRolls) : null;
const intentsWorker =
  !backgroundWorkersDisabled && intentsMarket
    ? setInterval(() => void intentsMarket.reconcile().catch(() => {}), 60000)
    : null;
if (intentsWorker) {
  intentsWorker.unref?.();
  void intentsMarket.reconcile({ limit: 256 }).catch(() => {});
}
const orderIndexWorker =
  !backgroundWorkersDisabled && signedOrderIndex
    ? startOrderIndexWorker(signedOrderIndex, { intervalMs: 30000 })
    : null;
// Trader keeper: settles orders, mints and escrows stock, sweeps profit above the float
// into rewards fund_rewards("sponsor") and restores the float. It signs only
// when the traders file carries the trader's own account key.
const traderKeeper =
  !backgroundWorkersDisabled && npcTraders && rewardsConfig?.contractId
    ? startTraderKeeper(
        createTraderKeeper({
          service: npcTraders,
          provider,
          rewardsId: rewardsConfig.contractId,
          // Starting stock: award-signed redeem_aura to the trader's own account.
          awardSigner,
          stock: process.env.NPC_TRADER_STOCK !== "0",
          log: (entry) => entry.reports.some((r) => r.actions?.length || r.error) && console.log(JSON.stringify(entry)),
        }),
      )
    : null;
const creatorMoneyWorker =
  !backgroundWorkersDisabled && creatorMoney?.enabled
    ? startCreatorMoneyWorker(creatorMoney, { intervalMs: 30000 })
    : null;
// Test world explorers walk every 10 s (presence counts only if updated in
// the last 30 s); the buyer, reviewers and restocking run every 30 s.
let testSeedTicks = 0;
const testSeedWorker =
  !backgroundWorkersDisabled && testSeedActive
    ? setInterval(() => {
        try {
          testSeed.tickPresence();
          if (testSeedTicks++ % 3 === 0) testSeed.tickEconomy();
        } catch (e) {
          console.error("Test seed tick failed", e?.message || e);
        }
      }, 10_000)
    : null;
testSeedWorker?.unref();
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
    pruneRateWindows(rates);
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
  if (testSeedWorker) clearInterval(testSeedWorker);
  await worldPlanner?.stop();
  await rewardWorker?.stop();
  flavourWorker?.stop();
  await relayWorker?.stop?.();
  await creatorMoneyWorker?.stop?.();
  orderIndexWorker?.stop();
  if (intentsWorker) clearInterval(intentsWorker);
  npcRollWorker?.stop();
  traderKeeper?.stop();
  badgeWorker?.stop();
  chainLedgerWorker?.stop();
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
