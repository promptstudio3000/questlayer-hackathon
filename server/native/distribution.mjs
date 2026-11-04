// Treasury distribution audit. The rewards contract keeps conserved buckets
// (available / reserved / awarded) but has no list of days, so nothing on
// chain proves by itself that every reserved yoctoNEAR belongs to a published
// city day, or that the contract account actually holds what it owes. This
// audit closes that gap from one consistent set of reads:
//
//   1. ledger conservation (funded = available + reserved + owed + pending + withdrawn)
//   2. coin reservations = sum of open days' unclaimed coin budget
//   3. zone reservations = sum of open days' unwon prizes
//   4. every open chain day matches its durable manifest exactly
//   5. account liquidity: balance minus storage stake covers all liabilities
//   6. local confirmed receipts never exceed the chain's accepted claims
//   7. each date's on-chain total across cities equals what this server
//      published for that date and stays within the contract's daily cap
//   8. days marked as paid from realized yield cost no more than the yield
//      that vaults have paid into this treasury (vault `game_paid`)
//
// The reward worker runs it after settling claims and closing days and before
// publishing new ones; any drift stops new publication (claims and closures
// keep running) and is reported in /api/health and /api/native/distribution.
import {
  nativePublicationMatches,
  publicationArgs,
  storedNativeManifest,
} from "./reward-manifest.mjs";
import { NETWORK } from "./network.mjs";
import { knownNativeClaims } from "./rewards.mjs";
import { readYieldBacking, yieldBackedManifests } from "./day-publication.mjs";

// NEAR protocol storage price: 10^19 yoctoNEAR per byte (1 NEAR per 100 kB).
export const STORAGE_PRICE_PER_BYTE = 10n ** 19n;
const big = (value) => {
  if (typeof value !== "string" || !/^\d{1,40}$/.test(value))
    throw new Error("Invalid amount in chain response.");
  return BigInt(value);
};
const sum = (values) => values.reduce((a, b) => a + b, 0n);

export async function auditDistribution(native, { clock = Date.now } = {}) {
  const checks = [];
  const check = (name, ok, detail) =>
    checks.push({ name, ok: !!ok, ...detail });
  const observedAt = clock();
  let treasury, account;
  try {
    [treasury, account] = await Promise.all([
      native.view("get_treasury", {}, true),
      native.provider.query({
        request_type: "view_account",
        account_id: native.contractId,
        finality: "final",
      }),
    ]);
  } catch (error) {
    return {
      status: "unavailable",
      network: NETWORK,
      contractId: native.contractId,
      observedAt,
      reason: String(error?.message || error).slice(0, 200),
      checks: [],
    };
  }
  try {
    return await compute();
  } catch (error) {
    return {
      status: "unavailable",
      network: NETWORK,
      contractId: native.contractId,
      observedAt,
      reason: String(error?.message || error).slice(0, 200),
      checks: [],
    };
  }
  async function compute() {
    const coins = {
      available: big(treasury.coins.available),
      reserved: big(treasury.coins.reserved),
      awarded: big(treasury.coins.awarded),
    };
    const zones = {
      available: big(treasury.zones.available),
      reserved: big(treasury.zones.reserved),
      awarded: big(treasury.zones.awarded),
    };
    const funded = big(treasury.funded),
      owed = big(treasury.owed),
      pending = big(treasury.pending),
      withdrawn = big(treasury.withdrawn);
    const liabilities =
      coins.available +
      coins.reserved +
      zones.available +
      zones.reserved +
      owed +
      pending;
    check(
      "ledger-conservation",
      funded === liabilities + withdrawn &&
        coins.awarded + zones.awarded === owed + pending + withdrawn,
      {
        funded: funded.toString(),
        accountedFor: (liabilities + withdrawn).toString(),
      },
    );

    // Every local day that may still hold a reservation: prepared rows can have
    // a published chain day whose acknowledgement was lost.
    const rows = native.db
      .prepare(
        "SELECT * FROM native_days WHERE state IN ('prepared','published') ORDER BY day,id",
      )
      .all();
    const days = [];
    let coinOwed = 0n,
      zoneOwed = 0n,
      manifestsOk = true,
      receiptsOk = true;
    // Days whose chain acceptances outnumber local rows (a restore lost them).
    // Not drift: the chain ledger is intact. Such days refuse new claims.
    const reconciling = [];
    for (const row of rows) {
      const chain = await native.view("get_day", { day_id: row.id }, true);
      if (!chain || chain.closed) {
        days.push({
          id: row.id,
          localState: row.state,
          chain: chain ? "closed" : "absent",
        });
        continue;
      }
      const manifest = storedNativeManifest(row);
      const matches = nativePublicationMatches(manifest, chain);
      manifestsOk &&= matches;
      const unclaimedCoins = big(chain.remaining);
      const unwonPrizes = sum(
        chain.quests.map((q, i) =>
          chain.winners[i] ? 0n : big(String(q.reward)),
        ),
      );
      coinOwed += unclaimedCoins;
      zoneOwed += unwonPrizes;
      const localConfirmed = native.db
        .prepare(
          "SELECT COUNT(*) AS n FROM native_reward_claims WHERE day_id=? AND state='confirmed'",
        )
        .get(row.id).n;
      const dayReceiptsOk = localConfirmed <= chain.claims_accepted;
      receiptsOk &&= dayReceiptsOk;
      const unknownChainClaims = Math.max(
        0,
        chain.claims_accepted - knownNativeClaims(native.db, row.id),
      );
      if (unknownChainClaims)
        reconciling.push({ id: row.id, unknownChainClaims });
      days.push({
        id: row.id,
        localState: row.state,
        chain: "open",
        manifestMatches: matches,
        unclaimedCoins: unclaimedCoins.toString(),
        unwonPrizes: unwonPrizes.toString(),
        claimsAccepted: chain.claims_accepted,
        localConfirmed,
      });
    }
    check("coin-reservations-explained", coins.reserved === coinOwed, {
      reserved: coins.reserved.toString(),
      openDaysOwe: coinOwed.toString(),
    });
    check("zone-reservations-explained", zones.reserved === zoneOwed, {
      reserved: zones.reserved.toString(),
      openDaysOwe: zoneOwed.toString(),
    });
    check("open-days-match-manifests", manifestsOk, {});
    check("receipts-within-chain-claims", receiptsOk, {});
    // Per-date totals across cities (rewards contract v1.1). Every publication
    // with a date in view must be ours: unknown commitments are drift.
    const dates = [
      ...new Set(
        days
          .filter((d) => d.chain === "open")
          .map((d) => d.id.match(/(\d{4}-\d{2}-\d{2})-v\d+$/)?.[1])
          .filter(Boolean),
      ),
    ];
    const dateRows = [];
    let datesOk = true;
    for (const date of dates) {
      const chainTotal = await native.view("get_date_totals", { date }, true);
      let coinsOurs = 0n,
        zonesOurs = 0n;
      for (const row of native.db
        .prepare("SELECT * FROM native_days WHERE id LIKE ?")
        .all(`%-${date}-v%`)) {
        if (!(await native.view("get_day", { day_id: row.id }, true))) continue;
        const args = publicationArgs(storedNativeManifest(row));
        coinsOurs += big(args.coin_unit) * BigInt(args.coin_count);
        zonesOurs += sum(args.quests.map((q) => big(String(q.reward))));
      }
      const ok =
        big(chainTotal.coins) === coinsOurs &&
        big(chainTotal.zones) === zonesOurs &&
        big(chainTotal.coins) <= big(chainTotal.cap) &&
        big(chainTotal.zones) <= big(chainTotal.cap);
      datesOk &&= ok;
      dateRows.push({
        date,
        ok,
        chainCoins: chainTotal.coins,
        chainZones: chainTotal.zones,
        ourCoins: coinsOurs.toString(),
        ourZones: zonesOurs.toString(),
        cap: chainTotal.cap,
      });
    }
    check("date-totals-match-publications", datesOk, { dates: dateRows });
    // Only hosts that published yield-backed days run this check.
    if (yieldBackedManifests(native.db, native.contractId).length) {
      const backing = await readYieldBacking(native);
      check("yield-backed-days-covered", backing.covered, {
        paid: backing.paid,
        committed: backing.committed,
        free: backing.free,
      });
    }
    const balance = big(String(account.amount));
    const storageStake =
      BigInt(account.storage_usage ?? 0) * STORAGE_PRICE_PER_BYTE;
    const liquid = balance > storageStake ? balance - storageStake : 0n;
    check("account-covers-liabilities", liquid >= liabilities, {
      liquid: liquid.toString(),
      liabilities: liabilities.toString(),
      headroom: (liquid - liabilities).toString(),
    });
    const failed = checks.filter((c) => !c.ok).map((c) => c.name);
    return {
      status: failed.length ? "drift" : "verified",
      network: NETWORK,
      contractId: native.contractId,
      observedAt,
      failed,
      checks,
      reconciling,
      totals: {
        funded: funded.toString(),
        liabilities: liabilities.toString(),
        awarded: (coins.awarded + zones.awarded).toString(),
        withdrawn: withdrawn.toString(),
      },
      days,
      scope:
        "Reward treasury and published city days. Player principal in staking vaults and creator money are separate contracts with their own invariants.",
    };
  }
}

// Summary for /api/health: no per-day detail.
export function auditSummary(audit) {
  if (!audit) return { status: "not-run" };
  return {
    status: audit.status,
    observedAt: audit.observedAt,
    failed: audit.failed ?? [],
    reconciling: (audit.reconciling ?? []).map((d) => d.id),
    reason: audit.reason,
  };
}
