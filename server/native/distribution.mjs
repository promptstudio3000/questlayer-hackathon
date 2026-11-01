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
//
// The reward worker runs it after settling claims and closing days and before
// publishing new ones; any drift stops new publication (claims and closures
// keep running) and is reported in /api/health and /api/native/distribution.
import {
  nativePublicationMatches,
  storedNativeManifest,
} from "./reward-manifest.mjs";
import { NETWORK } from "./network.mjs";

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
    reason: audit.reason,
  };
}
