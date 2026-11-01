import { assert, dayKey } from "../domain.mjs";
import { PLZEN, sampleCityPaths } from "../spatial/city-pack.mjs";
import { shiftDate } from "../spatial/calendar.mjs";
import { getOrPrepareCityPlan } from "../world-planner.mjs";
import {
  nativeDayId,
  nativeManifest,
  nativePublicationMatches,
  publicationArgs,
  storedNativeManifest,
} from "./reward-manifest.mjs";

// One explicitly selected CityPack per publisher. This is not permission to
// multiply the treasury budget by discovering cities or activating H3 cells.
export async function publishNativeDays(
  native,
  {
    clock = Date.now,
    city = native.city || PLZEN,
    renew,
    writeOwned,
    sendOwned,
  },
) {
  const today = dayKey(clock(), city.timezone);
  let published = 0;
  for (const day of [today, shiftDate(today)]) {
    renew();
    const dayId = nativeDayId(city.id, day);
    let row = native.db
      .prepare("SELECT * FROM native_days WHERE id=?")
      .get(dayId);
    if (row && !["prepared", "published"].includes(row.state)) continue;
    let confirmed = await native.view("get_day", { day_id: dayId }, true);
    renew();
    // A restored host may have lost the exact funded body. Do not reconstruct
    // its rewards from today's remaining treasury or a changed source pack.
    assert(
      row || !confirmed,
      "Published native day has no durable manifest. Restore its exact publication intent before continuing.",
      503,
    );
    if (!row) {
      const plan = getOrPrepareCityPlan(native.db, city, day, clock());
      const treasury = await native.view("get_treasury", {}, true);
      renew();
      const manifest = nativeManifest(plan, treasury, sampleCityPaths(city));
      if (!manifest) continue;
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
    published++;
  }
  return published;
}
