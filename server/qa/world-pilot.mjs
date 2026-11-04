import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { backup } from "node:sqlite";
import { generateKeyPairSync, sign, verify } from "node:crypto";
import { cellToLatLng, latLngToCell } from "h3-js";
import { openDatabase, createPlayer } from "../database.mjs";
import "../schema-catalog.mjs";
import { hash } from "../domain.mjs";
import { ensureWorld, worldView, expireWorlds, HOME } from "../world.mjs";
import { claimCoin, claimQuest, equip } from "../game.mjs";
import { enqueueCityPlans, runWorldJobs } from "../world-planner.mjs";
import { PLZEN } from "../spatial/city-pack.mjs";
import { localDateBounds } from "../spatial/calendar.mjs";
import {
  changeSystemPlace,
  placeSafetyAudit,
} from "../spatial/place-safety.mjs";
import { NativeRewards } from "../native/rewards.mjs";
import { runRewardWorker } from "../native/reward-worker.mjs";
import { rewardMessage } from "../native/reward-manifest.mjs";

// Integration-test double only. This is not a replacement contract, a sandbox
// contract test, realized yield evidence or an authority to operate testnet.
function chainDouble(contractId, publicKey, key) {
  const bucket = () => ({ available: 10n ** 23n, reserved: 0n, awarded: 0n });
  const state = {
    days: new Map(),
    receipts: new Map(),
    accounts: new Map(),
    sent: [],
    coins: bucket(),
    zones: bucket(),
    owed: 0n,
    pending: 0n,
    withdrawn: 0n,
    funded: 2n * 10n ** 23n,
    loseNextClaim: false,
  };
  const ledger = () => {
    assert.equal(
      state.coins.available +
        state.coins.reserved +
        state.zones.available +
        state.zones.reserved +
        state.owed +
        state.pending +
        state.withdrawn,
      state.funded,
    );
    assert.equal(
      state.coins.awarded + state.zones.awarded,
      state.owed + state.pending + state.withdrawn,
    );
  };
  const view = (method, args) => {
    if (method === "get_config")
      return { attestor: publicKey, publisher: contractId, paused: false };
    if (method === "get_treasury")
      return {
        policy: "50/50-v1",
        funded: String(state.funded),
        owed: String(state.owed),
        pending: "0",
        withdrawn: "0",
        coins: Object.fromEntries(
          Object.entries(state.coins).map(([k, v]) => [k, String(v)]),
        ),
        zones: Object.fromEntries(
          Object.entries(state.zones).map(([k, v]) => [k, String(v)]),
        ),
      };
    if (method === "get_day") return state.days.get(args.day_id)?.view || null;
    if (method === "get_receipt")
      return state.receipts.get(args.receipt_id) || null;
    if (method === "get_account")
      return state.accounts.get(args.account_id) || { credit: "0", xp: 0 };
    throw Error(`Unexpected QA view ${method}`);
  };
  const provider = {
    viewNodeStatus: async () => ({ chain_id: "testnet" }),
    query: async (q) =>
      q.request_type === "view_account"
        ? { code_hash: "qa-reviewed-code" }
        : {
            result: [
              ...Buffer.from(
                JSON.stringify(
                  view(
                    q.method_name,
                    JSON.parse(Buffer.from(q.args_base64, "base64").toString()),
                  ),
                ),
              ),
            ],
          },
  };
  const send = async (method, args) => {
    state.sent.push({ method, args: structuredClone(args) });
    if (method === "publish_day") {
      assert.ok(!state.days.has(args.day_id));
      assert.equal(args.quests.length, 6);
      const coins = BigInt(args.coin_unit) * BigInt(args.coin_count),
        zones = args.quests.reduce((n, q) => n + BigInt(q.reward), 0n);
      assert.ok(
        state.coins.available >= coins && state.zones.available >= zones,
      );
      state.coins.available -= coins;
      state.coins.reserved += coins;
      state.zones.available -= zones;
      state.zones.reserved += zones;
      state.days.set(args.day_id, {
        view: {
          ...structuredClone(args),
          closed: false,
          claims_accepted: 0,
          claims_limit: 256,
          storage_reserved: true,
          winners: Array(6).fill(null),
        },
        remaining: coins,
        claimed: new Set(),
      });
    } else if (method === "claim") {
      const c = args.claim,
        day = state.days.get(c.day_id);
      assert.ok(day && !day.view.closed);
      assert.ok(
        verify(
          null,
          Buffer.from(rewardMessage(contractId, c)),
          key,
          Buffer.from(args.signature, "base64"),
        ),
      );
      assert.ok(!state.receipts.has(c.receipt_id));
      const source = c.kind === "coin" ? state.coins : state.zones;
      let value = 0n;
      if (c.kind === "coin") {
        assert.ok(!day.claimed.has(c.index));
        day.claimed.add(c.index);
        value = BigInt(day.view.coin_unit);
        day.remaining -= value;
      } else if (!day.view.winners[c.index]) {
        day.view.winners[c.index] = c.receiver_id;
        value = BigInt(day.view.quests[c.index].reward);
      }
      const xp = c.kind === "coin" ? 2 : day.view.quests[c.index].xp;
      source.reserved -= value;
      source.awarded += value;
      state.owed += value;
      const account = state.accounts.get(c.receiver_id) || {
        credit: "0",
        xp: 0,
      };
      account.credit = String(BigInt(account.credit) + value);
      account.xp += xp;
      state.accounts.set(c.receiver_id, account);
      state.receipts.set(c.receipt_id, {
        receiver_id: c.receiver_id,
        amount: String(value),
        xp,
        message_hash: hash(rewardMessage(contractId, c)),
      });
      day.view.claims_accepted++;
      if (state.loseNextClaim) {
        state.loseNextClaim = false;
        ledger();
        throw Error("QA lost acknowledgement after commit");
      }
    } else if (method === "close_day") {
      const day = state.days.get(args.day_id);
      assert.ok(day);
      if (!day.view.closed) {
        state.coins.reserved -= day.remaining;
        state.coins.available += day.remaining;
        day.remaining = 0n;
        for (const [i, q] of day.view.quests.entries())
          if (!day.view.winners[i]) {
            state.zones.reserved -= BigInt(q.reward);
            state.zones.available += BigInt(q.reward);
          }
        day.view.closed = true;
      }
    } else throw Error(`Unexpected QA send ${method}`);
    ledger();
    return `qa-transaction-${state.sent.length}`;
  };
  return { state, provider, send, ledger };
}

export async function runWorldPilot() {
  const directory = mkdtempSync(join(tmpdir(), "questlayer-world-pilot-"));
  const dates = ["2026-10-24", "2026-10-25", "2026-10-26"],
    contractId = "qa-rewards.testnet",
    accountId = "mira.qa.testnet";
  const keys = generateKeyPairSync("ed25519"),
    signer = {
      publicKey: keys.publicKey
        .export({ format: "der", type: "spki" })
        .subarray(-32)
        .toString("base64"),
      sign: (m) =>
        sign(null, Buffer.from(m), keys.privateKey).toString("base64"),
    };
  const chain = chainDouble(contractId, signer.publicKey, keys.publicKey),
    events = [];
  let now = localDateBounds(dates[0], PLZEN.timezone).startsAt + 12 * 3600000,
    db,
    native;
  const clock = () => now;
  const attach = () => {
    native = new NativeRewards(
      db,
      chain.provider,
      { contractId, codeHash: "qa-reviewed-code", vaults: [] },
      signer,
      { clock },
    );
  };
  const treasury = () =>
    db.prepare("SELECT * FROM treasury ORDER BY bucket").all();
  try {
    db = openDatabase(join(directory, "pilot.sqlite"));
    const mira = createPlayer(db, "Mira", now),
      tomas = createPlayer(db, "Tomas", now),
      initial = treasury();
    db.prepare("INSERT INTO wallet_links VALUES(?,?,?)").run(
      accountId,
      mira,
      now,
    );
    attach();
    native.enroll(mira, accountId, true);
    const conserve = () => {
      for (const b of treasury()) {
        const before = initial.find((x) => x.bucket === b.bucket);
        assert.equal(
          b.available_u + b.reserved_u + b.paid_u,
          before.available_u + before.reserved_u + before.paid_u,
        );
      }
      chain.ledger();
    };
    // Actual live-map adapter, with a controlled outage instead of network IO.
    const [lat, lng] = cellToLatLng(latLngToCell(50.08, 14.42, 7));
    let offline = true;
    const mapData = {
      fetcher: async () => {
        if (offline) throw Error("QA map outage");
        return new Response(
          JSON.stringify({
            elements: [
              {
                type: "way",
                id: 1,
                tags: { highway: "footway" },
                geometry: [
                  { lat, lon: lng },
                  { lat: lat + 0.002, lon: lng },
                ],
              },
            ],
          }),
        );
      },
    };
    const fallback = await ensureWorld(db, { lat, lng }, false, now, {
      mapData,
    });
    assert.equal(fallback.coverage, "unavailable");
    offline = false;
    now = fallback.pathData.retryAt + 1;
    const recovered = await ensureWorld(db, { lat, lng }, false, now, {
      mapData,
    });
    assert.equal(recovered.id, fallback.id);
    assert.ok(worldView(db, recovered.id).coins.length > 0);
    events.push("map-outage-recovered-with-one-world");
    for (const [dayIndex, day] of dates.entries()) {
      now = Math.max(
        now,
        localDateBounds(day, PLZEN.timezone).startsAt + 12 * 3600000,
      );
      enqueueCityPlans(db, now);
      if (dayIndex === 0) {
        db.prepare(
          "UPDATE world_jobs SET state='running',lease_owner='interrupted-qa-process',lease_until=?",
        ).run(now + 10);
        now += 11;
        events.push("expired-preparation-lease-reclaimed");
      }
      assert.equal(await runWorldJobs(db, { clock }), dayIndex === 0 ? 2 : 1);
      const world = await ensureWorld(db, HOME, true, now),
        map = worldView(db, world.id, mira, { now });
      assert.equal(map.cityZoneCount, 6);
      const page = worldView(db, world.id, mira, { limit: 7, now }),
        next = worldView(db, world.id, mira, {
          limit: 7,
          cursor: page.page.nextCursor,
          now,
        });
      assert.ok(
        next.coins.every((c) => !page.coins.some((p) => p.id === c.id)),
      );
      const coin = map.coins[0];
      const race = await Promise.allSettled(
        [mira, tomas].map((p) =>
          Promise.resolve().then(() => claimCoin(db, p, coin.id, coin, now)),
        ),
      );
      assert.equal(race.filter((r) => r.status === "fulfilled").length, 1);
      assert.equal(
        claimCoin(db, mira, coin.id, coin, now).alreadyClaimed,
        true,
      );
      const chest = map.quests.find((q) => q.kind === "chest" && q.tier === 1),
        result = claimQuest(db, mira, chest.id, chest, now);
      assert.ok(result.item);
      equip(db, mira, result.item.id, true);
      assert.equal(
        claimQuest(db, mira, chest.id, chest, now).result.id,
        result.result.id,
      );
      if (dayIndex === 0) {
        const zone = world.zones.find((z) => z.id === chest.zone_id),
          op = {
            actor: "qa-operator",
            operationId: "pilot-close",
            candidateId: zone.sourceId,
            action: "close",
            reason: "QA temporary access closure",
            expectedVersion: 0,
          };
        const frozen = db
          .prepare("SELECT manifest FROM worlds WHERE id=?")
          .get(world.id).manifest;
        changeSystemPlace(db, PLZEN, op, { isOperator: () => true, clock });
        assert.throws(
          () => claimQuest(db, tomas, chest.id, chest, now),
          (e) => e.code === "PLACE_CLOSED",
        );
        assert.equal(
          claimQuest(db, mira, chest.id, chest, now).result.id,
          result.result.id,
        );
        changeSystemPlace(
          db,
          PLZEN,
          {
            ...op,
            operationId: "pilot-reopen",
            action: "reopen",
            expectedVersion: 1,
          },
          { isOperator: () => true, clock },
        );
        assert.equal(
          db.prepare("SELECT manifest FROM worlds WHERE id=?").get(world.id)
            .manifest,
          frozen,
        );
        events.push("closure-replay-and-reopen-preserved-rights");
      }
      await runRewardWorker(native, chain.send, { clock });
      const m = native.day(`plzen-${day}-v1`),
        fix = (p) => ({ ...p, accuracy: 5, timestamp: now });
      const accepted = await native.submit(mira, {
        accountId,
        dayId: m.id,
        kind: "coin",
        index: 0,
        mode: "gps",
        fix: fix(m.coins[0]),
      });
      const q = m.quests.find((q) => q.tier === 1);
      for (let checkpoint = 0; checkpoint < 3; checkpoint++) {
        now += 1800000;
        await native.submit(mira, {
          accountId,
          dayId: m.id,
          kind: "quest",
          index: q.index,
          checkpoint,
          mode: "gps",
          fix: fix(q.targets[checkpoint]),
        });
      }
      if (dayIndex === 1) {
        chain.state.loseNextClaim = true;
        await assert.rejects(
          runRewardWorker(native, chain.send, { clock }),
          /lost acknowledgement/,
        );
        const snapshot = join(directory, "restored.sqlite");
        await backup(db, snapshot);
        db.close();
        db = openDatabase(snapshot);
        attach();
        now += 6000;
        const sends = chain.state.sent.filter(
          (s) =>
            s.method === "claim" && s.args.claim.receipt_id === accepted.id,
        ).length;
        await runRewardWorker(native, chain.send, { clock });
        assert.equal(
          chain.state.sent.filter(
            (s) =>
              s.method === "claim" && s.args.claim.receipt_id === accepted.id,
          ).length,
          sends,
        );
        events.push("consistent-backup-restart-recovered-lost-chain-reply");
      } else await runRewardWorker(native, chain.send, { clock });
      assert.equal(
        db
          .prepare("SELECT state FROM native_reward_claims WHERE id=?")
          .get(accepted.id).state,
        "confirmed",
      );
      expireWorlds(db, now);
      const settled = treasury();
      expireWorlds(db, now);
      assert.deepEqual(treasury(), settled);
      conserve();
      events.push(`day:${day}:six-zones-one-shared-coin-one-durable-aura`);
    }
    const claims = db
      .prepare(
        "SELECT count(*) n FROM native_reward_claims WHERE state='confirmed'",
      )
      .get().n;
    assert.equal(claims, 6);
    assert.equal(chain.state.receipts.size, 6);
    assert.equal(chain.state.accounts.get(accountId).xp, 246);
    assert.equal(placeSafetyAudit(db).operations.length, 2);
    const report = {
      version: 1,
      status: "passed",
      mode: "isolated-synthetic-integration",
      dates,
      localDayHours: dates.map((d) => {
        const b = localDateBounds(d, PLZEN.timezone);
        return (b.endsAt - b.startsAt) / 3600000;
      }),
      events,
      native: {
        confirmedReceipts: claims,
        claimSends: chain.state.sent.filter((s) => s.method === "claim").length,
        closedDays: [...chain.state.days.values()].filter((d) => d.view.closed)
          .length,
        xp: 246,
        credit: chain.state.accounts.get(accountId).credit,
        conservation: true,
      },
      demo: {
        conservation: true,
        worlds: db.prepare("SELECT count(*) n FROM worlds").get().n,
        closureOperations: 2,
      },
      limits: [
        "fake RPC and in-memory QA keys",
        "no contract or financial audit",
        "no physical GPS/device proof",
        "no deployment",
      ],
    };
    return report;
  } finally {
    db?.close();
    rmSync(directory, { recursive: true, force: true });
  }
}
