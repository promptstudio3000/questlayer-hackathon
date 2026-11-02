// Reads questlayer-yield-vault positions (contracts/yield-vault, docs/YIELD-VAULT.md)
// for the Staker step. A deposit there is locked for 24-48 h, so it counts at
// once: no hold window is needed. LST principal is already yoctoNEAR; stable
// principal (token units) is converted through the EUR reference price and a
// conservative USD→EUR rate, and does not count when no price is known.
// Reads only; it never signs or moves funds.
import { assert } from "../domain.mjs";

const YOCTO = 10n ** 24n;
const ACCOUNT = /^(?=.{2,64}$)(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/;

export function yieldVaultSettings(env = process.env, manifest = null) {
  const contract = env.YIELD_VAULT_ACCOUNT || manifest?.contractId || manifest?.contract || null;
  const rate = Number(env.YIELD_STABLE_EUR);
  const decimals = Number(env.YIELD_STABLE_DECIMALS);
  return {
    enabled: env.YIELD_VAULT_ENABLED !== "0" && !!contract && ACCOUNT.test(contract),
    contract,
    // EUR per 1 USD-stable unit; conservative so a stable deposit never over-counts.
    stableEur: rate > 0 && rate <= 1.5 ? rate : 0.85,
    stableDecimals: Number.isInteger(decimals) && decimals >= 0 && decimals <= 24 ? decimals : 6,
    cacheMs: 60_000,
  };
}

const big = (v) => {
  try {
    return BigInt(String(v ?? "0"));
  } catch {
    return 0n;
  }
};

/** Pure: NEAR value (yocto) of one get_position row. Stables need nearEur. */
export function rowNear(row, settings, nearEur) {
  const principal = big(row?.principal);
  if (row?.kind === "lst" && row?.value_unit === "yoctoNEAR") return principal;
  if (row?.kind === "stable" && nearEur > 0) {
    // units / 10^dec × stableEur / nearEur NEAR, done in integers (micro precision).
    const eurMicro = BigInt(Math.round(settings.stableEur * 1e6));
    const nearEurMicro = BigInt(Math.round(nearEur * 1e6));
    if (nearEurMicro <= 0n) return 0n;
    return (principal * eurMicro * YOCTO) / (10n ** BigInt(settings.stableDecimals) * nearEurMicro);
  }
  return 0n;
}

export function createYieldVaultReader({ provider, settings, priceEur = () => null, clock = Date.now }) {
  const cache = new Map();
  async function position(accountId) {
    assert(ACCOUNT.test(accountId), "Invalid NEAR account.");
    const hit = cache.get(accountId);
    if (hit && clock() - hit.at < settings.cacheMs) return hit.value;
    const response = await provider.query({
      request_type: "call_function",
      finality: "final",
      account_id: settings.contract,
      method_name: "get_position",
      args_base64: Buffer.from(JSON.stringify({ account_id: accountId })).toString("base64"),
    });
    const rows = JSON.parse(Buffer.from(response.result).toString());
    assert(Array.isArray(rows) && rows.length <= 32, "Unexpected yield vault view.", 503);
    cache.set(accountId, { at: clock(), value: rows });
    if (cache.size > 2000) cache.delete(cache.keys().next().value);
    return rows;
  }
  return {
    settings,
    position,
    /** Same shape as the liquid-stake reader: locked deposits count at once. */
    async forPlayer(db, player) {
      const accounts = db
        .prepare("SELECT account_id FROM wallet_links WHERE player_id=? ORDER BY verified_at")
        .all(player)
        .map((r) => r.account_id)
        .slice(0, 3);
      const nearEur = priceEur();
      const readings = [];
      let unreadable = 0;
      for (const accountId of accounts) {
        try {
          const rows = await position(accountId);
          const tokens = rows.map((r) => ({
            token: r.token_id,
            kind: r.kind,
            principal: big(r.principal).toString(),
            near: rowNear(r, settings, nearEur).toString(),
            withdrawable: big(r.withdrawable).toString(),
            queued: big(r.queued).toString(),
            tranches: Array.isArray(r.tranches) ? r.tranches.slice(0, 16) : [],
          }));
          const near = tokens.reduce((a, t) => a + BigInt(t.near), 0n).toString();
          readings.push({ accountId, source: "yield-vault", near, matureNear: near, tokens });
        } catch {
          unreadable++;
        }
      }
      const total = readings.reduce((a, r) => a + BigInt(r.near), 0n).toString();
      return { enabled: true, contract: settings.contract, holdHours: 0, linked: accounts.length, unreadable, matureNear: total, readings };
    },
  };
}

/** Sums several Staker readers (wallet-held LSTs, the yield vault) into one. */
export function combineStakeReaders(readers) {
  const list = readers.filter(Boolean);
  if (!list.length) return null;
  return {
    async forPlayer(db, player) {
      const parts = await Promise.all(
        list.map((r) =>
          r.forPlayer(db, player).catch(() => ({ matureNear: "0", readings: [], unreadable: 1, holdHours: null })),
        ),
      );
      return {
        enabled: true,
        holdHours: parts.find((p) => p.holdHours)?.holdHours ?? null,
        unreadable: parts.reduce((a, p) => a + (p.unreadable || 0), 0),
        matureNear: parts.reduce((a, p) => a + big(p.matureNear), 0n).toString(),
        readings: parts.flatMap((p) => p.readings || []),
      };
    },
  };
}
