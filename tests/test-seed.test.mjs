import test from "node:test";
import assert from "node:assert/strict";
import { openDatabase, createPlayer, demoProgression } from "../server/database.mjs";
import { createCreatorRuntime } from "../server/creators/runtime.mjs";
import { createActorService } from "../server/actors/service.mjs";
import { listItem } from "../server/game.mjs";
import { initSocialContent } from "../server/social-content.mjs";
import { updatePresence } from "../server/presence.mjs";
import { testSeedMode } from "../server/test-seed/config.mjs";
import {
  createTestSeed,
  walkerRoutes,
  positionOnRoute,
} from "../server/test-seed/seed.mjs";
import {
  SEED_PLAYERS,
  SEED_CREATOR_QUESTS,
  SEED_BUYER,
  STARTER_KIT,
} from "../server/test-seed/content.mjs";
import { GOLD } from "../server/domain.mjs";

const ENV = {
  CREATOR_COMMUNITY_ENABLED: "1",
  CREATOR_POLICY_VERSION: "qa-seed-v1",
  CREATOR_XP_COMMITMENT: "200",
  CREATOR_MODERATORS: "qa-reviewer",
  CREATOR_COMPLETION_AUTHORITIES: "qa-validator",
};

function world(clock) {
  const db = openDatabase(":memory:");
  createActorService(db);
  initSocialContent(db);
  const runtime = createCreatorRuntime(db, {
    env: ENV,
    origin: "http://localhost",
    authenticate: () => null,
    drafts: false,
  });
  const seed = createTestSeed(db, {
    clock,
    creators: {
      services: runtime.services,
      moderator: "qa-reviewer",
      completionAuthority: "qa-validator",
      policyVersion: ENV.CREATOR_POLICY_VERSION,
    },
  });
  return { db, runtime, seed };
}

test("TEST_SEED is testnet only and anything but 1 means remove", () => {
  assert.equal(testSeedMode({ TEST_SEED: "1" }, "testnet"), "apply");
  assert.equal(testSeedMode({}, "testnet"), "purge");
  assert.equal(testSeedMode({ TEST_SEED: "0" }, "mainnet"), "purge");
  assert.throws(() => testSeedMode({ TEST_SEED: "1" }, "mainnet"), /testnet/);
  assert.throws(() => testSeedMode({ TEST_SEED: "yes" }, "testnet"), /0 or 1/);
});

test("walkers follow real Plzeň paths and keep moving", () => {
  const [route] = walkerRoutes(1);
  assert.ok(route.total >= 200);
  const a = positionOnRoute(route, 0),
    b = positionOnRoute(route, 60_000);
  assert.notDeepEqual(a, b);
  assert.ok(Math.abs(a.lat - 49.747) < 0.02 && Math.abs(a.lng - 13.377) < 0.03);
});

test("apply builds the whole test world idempotently", () => {
  let now = 1_800_000_000_000;
  const { db, runtime, seed } = world(() => now);
  try {
    const first = seed.apply();
    assert.equal(first.players, SEED_PLAYERS.length);
    assert.equal(first.creatorQuests, SEED_CREATOR_QUESTS.length);
    assert.equal(first.openListings, 4);
    assert.equal(first.openBounties, 3);
    assert.equal(first.notes, 24);
    now += 1000;
    assert.deepEqual(
      { ...seed.apply(), creators: null },
      { ...first, creators: null },
    );
    const viewer = createPlayer(db, "Viewer", now);
    const quests = runtime.services.community.listQuests(viewer).items;
    assert.equal(quests.length, SEED_CREATOR_QUESTS.length);
    const walkers = db
      .prepare("SELECT count(*) n FROM presence WHERE substr(player_id,1,5)='seed-'")
      .get().n;
    assert.equal(walkers, SEED_PLAYERS.length);
  } finally {
    db.close();
  }
});

test("starter kit, bots and purge leave no seed trace", () => {
  let now = 1_800_000_000_000;
  const { db, runtime, seed } = world(() => now);
  try {
    seed.apply();
    const me = createPlayer(db, "Lubos", now);
    const goldBefore = db.prepare("SELECT gold_u FROM players WHERE id=?").get(me).gold_u;
    assert.equal(seed.grantKit(me, now), true);
    assert.equal(seed.grantKit(me, now), false);
    const auras = db
      .prepare("SELECT id,name,rarity,slot,equipped FROM inventory WHERE player_id=? AND kind='aura'")
      .all(me);
    assert.deepEqual(auras.map((a) => a.name).sort(), [...STARTER_KIT.auras].sort());
    // A full backpack: every rarity, both slots, a stacked duplicate and a
    // worn Night Sky pair; ids stay unique and seed-prefixed for purge.
    assert.ok(auras.length >= 8);
    assert.equal(new Set(auras.map((a) => a.id)).size, auras.length);
    assert.ok(auras.every((a) => a.id.startsWith("seed-kit-")));
    assert.deepEqual([...new Set(auras.map((a) => a.rarity))].sort(), ["common", "epic", "legendary", "rare"]);
    assert.deepEqual([...new Set(auras.map((a) => a.slot))].sort(), ["above", "below"]);
    assert.deepEqual(
      auras.filter((a) => a.equipped).map((a) => `${a.slot}:${a.name}`).sort(),
      ["above:Northern Lights", "below:Moon Ring"],
    );
    assert.equal(demoProgression(db, me).earnedXp, STARTER_KIT.xp);
    // Mid level 3 (400..900 XP) so the level bar is visibly part filled.
    assert.equal(demoProgression(db, me).level, 3);

    // Selling: list the kit Aura, the seed buyer takes it after the delay.
    const ember = auras.find((a) => a.name === "Ember Wisp" && !a.equipped);
    listItem(db, me, ember.id, 5_000 * GOLD, now);
    assert.equal(seed.tickEconomy(now + 1000).bought, 0);
    now += 60_000;
    assert.equal(seed.tickEconomy(now).bought, 1);
    assert.equal(
      db.prepare("SELECT player_id FROM inventory WHERE id=?").get(ember.id).player_id,
      SEED_BUYER,
    );
    assert.equal(
      db.prepare("SELECT gold_u FROM players WHERE id=?").get(me).gold_u,
      goldBefore + 5_000 * GOLD,
    );

    // Tasks: submit evidence, the seed author approves, the task is reposted.
    const bounty = db
      .prepare("SELECT * FROM bounties WHERE substr(id,1,7)='seed-b-' AND state='open' LIMIT 1")
      .get();
    db.prepare(
      "INSERT INTO bounty_submissions(bounty_id,player_id,evidence,created_at) VALUES (?,?,?,?)",
    ).run(bounty.id, me, "There were five bells.", now);
    now += 31_000;
    const step = seed.tickEconomy(now);
    assert.equal(step.approved, 1);
    assert.equal(step.bounties, 1);
    assert.equal(db.prepare("SELECT state FROM bounties WHERE id=?").get(bounty.id).state, "paid");

    // Creator quest: start, submit, the seed validator accepts.
    const { lifecycle, completion, community } = runtime.services;
    const quest = SEED_CREATOR_QUESTS[0];
    lifecycle.start({ actor: me, operationId: "start", questId: quest.id });
    completion.submit({
      actor: me,
      operationId: "evidence",
      questId: quest.id,
      revision: 1,
      evidence: "A lion sits on the fountain.",
      privateConsent: true,
    });
    now += 31_000;
    assert.equal(seed.tickEconomy(now).completions, 1);
    assert.ok(completion.read(me, quest.id).receipt);
    community.setFollowing({ actor: me, operationId: "follow", creatorId: quest.author, following: true });
    updatePresence(db, me, { enabled: true, renew: true, leaseId: "phone", lat: 50.08, lng: 14.42 }, now);
    seed.tickPresence(now);
    const companion = db
      .prepare("SELECT lat FROM presence WHERE player_id='seed-p-ondra'")
      .get();
    assert.ok(Math.abs(companion.lat - 50.08) < 0.001);

    // Use some kit XP for an own creator quest so purge must respect the lock.
    db.prepare("UPDATE players SET xp=xp+100 WHERE id=?").run(me);
    lifecycle.createDraft({ actor: me, operationId: "mine", questId: "my-quest", draft: { title: "Mine", description: "Own quest" } });
    lifecycle.submit({ actor: me, operationId: "mine-submit", questId: "my-quest", expectedVersion: 1, expectedPolicyVersion: ENV.CREATOR_POLICY_VERSION });
    lifecycle.review({ actor: "qa-reviewer", operationId: "mine-review", questId: "my-quest", expectedVersion: 2, decision: "approve", reason: "ok" });

    const purged = seed.purge();
    assert.ok(purged.removed > 0);
    assert.equal(seed.status().applied, false);
    const leftovers = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
      .all()
      .flatMap(({ name }) => {
        const cols = db.prepare(`PRAGMA table_info("${name}")`).all().map((c) => c.name);
        return cols.flatMap((c) =>
          db.prepare(`SELECT count(*) n FROM "${name}" WHERE substr("${c}",1,5)='seed-'`).get().n
            ? [`${name}.${c}`]
            : [],
        );
      });
    assert.deepEqual(leftovers, []);
    assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
    // The explorer keeps their own progress and quest; the kit XP is gone but
    // never below what their own quest locks.
    const progress = demoProgression(db, me);
    assert.equal(progress.lockedXp, 200);
    assert.equal(progress.earnedXp, 200);
    assert.equal(
      db.prepare("SELECT count(*) n FROM inventory WHERE player_id=? AND kind='aura'").get(me).n,
      0,
    );
    assert.equal(db.prepare("SELECT state FROM creator_quests WHERE id='my-quest'").get().state, "published");
    assert.deepEqual(seed.purge(), { removed: 0 });
  } finally {
    db.close();
  }
});

test("starter kit never replaces an Aura the explorer already wears", () => {
  const now = 1_800_000_000_000;
  const { db, seed } = world(() => now);
  try {
    seed.apply();
    const me = createPlayer(db, "Wearer", now);
    db.prepare("INSERT INTO inventory VALUES (?,?,?,?,?,?,?,?,?,?)").run(
      "own-aura", me, "aura", "Pilgrim's Path", "rare", "below", "#c9a35a", 1, null, now,
    );
    assert.equal(seed.grantKit(me, now), true);
    const worn = db
      .prepare("SELECT id,slot FROM inventory WHERE player_id=? AND kind='aura' AND equipped=1 ORDER BY slot")
      .all(me);
    assert.deepEqual(
      worn.map((a) => `${a.slot}:${a.id}`),
      [`above:seed-kit-${me}-polar`, "below:own-aura"],
    );
    seed.purge();
    assert.deepEqual(
      db.prepare("SELECT id,equipped FROM inventory WHERE player_id=? AND kind='aura'").all(me).map((r) => ({ ...r })),
      [{ id: "own-aura", equipped: 1 }],
    );
  } finally {
    db.close();
  }
});

test("revertKits takes kits back and keeps the rest of the test world", () => {
  const now = 1_800_000_000_000;
  const { db, seed } = world(() => now);
  try {
    seed.apply();
    const me = createPlayer(db, "Kit", now);
    db.prepare("INSERT INTO inventory VALUES (?,?,?,?,?,?,?,?,?,?)").run(
      "own-aura", me, "aura", "Pilgrim's Path", "rare", "below", "#c9a35a", 0, null, now,
    );
    assert.equal(seed.grantKit(me, now), true);
    const bots = db.prepare("SELECT COUNT(*) n FROM players WHERE substr(id,1,5)='seed-'").get().n;
    assert.ok(seed.revertKits().removed > 0);
    assert.deepEqual(
      db.prepare("SELECT id FROM inventory WHERE player_id=? AND kind='aura'").all(me).map((r) => r.id),
      ["own-aura"],
    );
    assert.equal(demoProgression(db, me).earnedXp, 0);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM players WHERE substr(id,1,5)='seed-'").get().n, bots);
    assert.equal(seed.revertKits().removed, 0);
  } finally {
    db.close();
  }
});
