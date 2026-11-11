import { assert, dayKey } from "../domain.mjs";
import {
  DEFAULT_CITY,
  LIVE_CITIES,
  sampleCityPaths,
} from "../spatial/city-pack.mjs";
import { shiftDate } from "../spatial/calendar.mjs";
import { getOrPrepareCityPlan } from "../world-planner.mjs";
import {
  assertNativePlaceOpen,
  effectiveCityPack,
  pointClosed,
} from "../spatial/place-safety.mjs";
import {
  nativeDayId,
  nativeDayIds,
  nativeDayRow,
  nativeManifest,
  nativeManifestVersion,
  nativePublicationMatches,
  publicationArgs,
  storedNativeManifest,
} from "./reward-manifest.mjs";
import {
  allocateDailyBudget,
  YIELD_DRIP_DAYS,
  scaledBucketCap,
  demandWeights,
  realizedYieldBacking,
  recentCityPlayers,
} from "./allocation.mjs";
import { NativeContractReader } from "./reader.mjs";
import { onContractSql, recordCurrentDay } from "./day-contracts.mjs";

/** Stored manifests that claim realized-yield funding, oldest first. */
export function yieldBackedManifests(db, contractId = null) {
  // With a contract, days quarantined as another generation's are left out:
  // their yield was promised by that contract's vaults, not this one's.
  const onContract = contractId ? onContractSql(db) : "";
  return db
    .prepare(`SELECT * FROM native_days d WHERE 1=1${onContract} ORDER BY day,id`)
    .all(...(onContract ? [contractId] : []))
    .map((row) => {
      const manifest = storedNativeManifest(row);
      if (manifest.funding !== "realized_yield" || row.state !== "closed")
        return manifest;
      // close_day returned everything unclaimed to the treasury, so a closed
      // day keeps only its confirmed awards against the realized yield.
      let awarded = 0n;
      for (const claim of db
        .prepare(
          "SELECT amount FROM native_reward_claims WHERE day_id=? AND state='confirmed'",
        )
        .all(row.id))
        awarded += /^\d{1,40}$/.test(claim.amount || "") ? BigInt(claim.amount) : 0n;
      return { ...manifest, awarded: awarded.toString() };
    })
    .filter((m) => m.funding === "realized_yield");
}
/** Realized yield paid by this contract's vaults versus yield-backed days. */
export async function readYieldBacking(native) {
  const vaultStates = [];
  for (const v of await native.vaultList()) {
    const state = await new NativeContractReader(
      native.provider,
      v.accountId,
    ).view("get_state", {}, true);
    // Vaults of an older rewards generation pay a different treasury.
    if (state?.rewards === native.contractId)
      vaultStates.push({ ...state, accountId: v.accountId });
  }
  return {
    vaults: vaultStates.map((s) => ({
      accountId: s.accountId,
      gamePaid: s.game_paid,
    })),
    ...realizedYieldBacking({
      vaultStates,
      yieldDays: yieldBackedManifests(native.db, native.contractId),
      rewardsId: native.contractId,
      dripDays: native.yieldDripDays ?? YIELD_DRIP_DAYS,
    }),
  };
}

/** Every live city plus this publisher's own, as allocation entries. */
function mapCities(city) {
  const ids = new Set(LIVE_CITIES.map((c) => c.id));
  ids.add(city.id);
  return [...ids].map((id) => ({ id }));
}

// One explicitly selected CityPack per publisher. This is not permission to
// multiply the treasury budget by discovering cities or activating H3 cells.
export async function publishNativeDays(
  native,
  {
    clock = Date.now,
    city = native.city || DEFAULT_CITY,
    renew,
    writeOwned,
    sendOwned,
  },
) {
  const today = dayKey(clock(), city.timezone);
  let published = 0;
  for (const day of [today, shiftDate(today)]) {
    renew();
    // A date keeps the version it was first prepared as; only a date with no
    // stored manifest takes the configured version for new days.
    let row = nativeDayRow(native.db, city.id, day);
    const dayId = row
      ? row.id
      : nativeDayId(
          city.id,
          day,
          nativeManifestVersion(day, native.manifestV2From),
        );
    if (row && !["prepared", "published"].includes(row.state)) continue;
    let confirmed = await native.view("get_day", { day_id: dayId }, true);
    renew();
    // A restored host may have lost the exact funded body. Do not reconstruct
    // its rewards from today's remaining treasury or a changed source pack,
    // and never publish a second version of a date that is already on chain.
    if (!row)
      for (const other of nativeDayIds(city.id, day)) {
        const chain =
          other === dayId
            ? confirmed
            : await native.view("get_day", { day_id: other }, true);
        renew();
        assert(
          !chain,
          "Published native day has no durable manifest. Restore its exact publication intent before continuing.",
          503,
        );
      }
    if (!row) {
      const plan = getOrPrepareCityPlan(native.db, city, day, clock());
      const treasury = await native.view("get_treasury", {}, true);
      renew();
      const activeCity = effectiveCityPack(native.db, city);
      // This publisher's share of the day across all funded cities. With the
      // default (this city alone, full share) the budget equals v1's.
      let limit = null,
        funding = null;
      if (native.yieldBackedDays) {
        const backing = await readYieldBacking(native);
        renew();
        limit = backing.limit;
        funding = {
          source: "realized_yield",
          evidence: {
            vaults: backing.vaults,
            paid: backing.paid,
            committedBefore: backing.committed,
            dripDays: backing.dripDays,
          },
        };
      }
      // One global treasury and budget; cities only decide where it shows.
      // By default every live city is eligible and the split follows recent
      // players, so money goes where people play (docs/GLOBAL-TREASURY.md).
      const eligible = native.fundedCities || mapCities(city);
      const allocation = allocateDailyBudget({
        available: {
          coins: treasury.coins.available,
          zones: treasury.zones.available,
        },
        cities:
          native.budgetSplit === "weights"
            ? eligible
            : demandWeights(eligible, recentCityPlayers(native.db, day)),
        shareBps: native.dailyShareBps ?? 10000,
        cap: scaledBucketCap(treasury.funded),
        limit,
      });
      const share = allocation.cities.find((c) => c.id === city.id);
      assert(share, "This city is not enabled for funded days.", 503);
      const manifest = nativeManifest(
        plan,
        treasury,
        sampleCityPaths(activeCity).filter(
          (p) => !pointClosed(activeCity.exclusions || [], p),
        ),
        {
          budget: { coins: share.coins, zones: share.zones },
          cap: scaledBucketCap(treasury.funded),
          funding,
          version: dayId.endsWith("-v2") ? 2 : 1,
        },
      );
      if (!manifest) {
        // Nothing to place on the map for this date (in yield-backed mode: no
        // free realized yield). Not an error, but never silent: health shows it.
        native.unfundedDays = {
          ...(native.unfundedDays || {}),
          [day]: funding ? "no-free-yield" : "no-budget",
        };
        continue;
      }
      if (native.unfundedDays?.[day]) {
        const { [day]: _funded, ...rest } = native.unfundedDays;
        native.unfundedDays = rest;
      }
      writeOwned(
        "INSERT OR IGNORE INTO native_days(id,day,body,hash,updated_at) VALUES(?,?,?,?,?)",
        manifest.id,
        manifest.day,
        JSON.stringify(manifest),
        manifest.hash,
        clock(),
      );
      row = native.db
        .prepare("SELECT * FROM native_days WHERE id=?")
        .get(dayId);
    }
    const manifest = storedNativeManifest(row);
    assert(
      manifest.cityId === city.id && manifest.timezone === city.timezone,
      "Native day belongs to a different city pack.",
      503,
    );
    if (row.state === "published") {
      assert(
        nativePublicationMatches(manifest, confirmed),
        "Published native day no longer matches its durable manifest.",
        503,
      );
      continue;
    }
    let tx = row.transaction_hash;
    if (!confirmed && manifest.endsAt <= clock()) {
      assert(
        !native.db
          .prepare("SELECT 1 FROM native_reward_claims WHERE day_id=? LIMIT 1")
          .get(dayId),
        "Expired unpublished day has accepted rights; reconciliation is required.",
        503,
      );
      // Keep the exact intent for recovery. A wall-clock boundary is not proof
      // that an earlier attempt never reached the chain.
      continue;
    }
    if (!confirmed) {
      for (const quest of manifest.quests)
        assertNativePlaceOpen(
          native.db,
          manifest,
          quest.index,
          quest.targets[0],
        );
      tx = await sendOwned("publish_day", publicationArgs(manifest));
      writeOwned(
        "UPDATE native_days SET transaction_hash=? WHERE id=?",
        tx,
        dayId,
      );
      confirmed = await native.view("get_day", { day_id: dayId }, true);
      renew();
    }
    assert(
      nativePublicationMatches(manifest, confirmed),
      "Native day differs from the durable manifest or its receipt storage is not ready.",
      503,
    );
    writeOwned(
      "UPDATE native_days SET state='published',updated_at=?,transaction_hash=? WHERE id=?",
      clock(),
      tx,
      dayId,
    );
    recordCurrentDay(writeOwned, dayId, native.contractId, clock());
    published++;
  }
  return published;
}
