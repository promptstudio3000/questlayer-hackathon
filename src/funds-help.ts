// Why a NEAR payment can't go through, and what covers it (owner request,
// 11 Nov 2026). Shared by the Stake page and every Buy button that pays NEAR
// (Shop → Market, More trading tools). Reads only; it never signs.

export const YOCTO = 10n ** 24n;
/** Gas headroom kept on top of a payment (a few function calls plus wrapping). */
export const GAS_HEADROOM = 5n * 10n ** 22n;
export const TEST_NEAR_FAUCET = "https://near-faucet.io/";
export const NEAR_WALLETS = [
  { name: "Meteor Wallet", href: "https://wallet.meteorwallet.app/" },
  { name: "HOT Wallet", href: "https://hot-labs.org/wallet/" },
  { name: "Intear Wallet", href: "https://wallet.intear.tech/" },
];
/** Where a player swaps QGOLD back to NEAR (the vault exchange on /economy). */
export const QGOLD_SWAP_URL = "/economy#qgold";
const QGOLD_ONE = 10n ** 6n;
const BPS = 10000n;

/** QGOLD the player holds and the NEAR it brings at the vault's sell price. */
export type QgoldCover = { units: bigint; worth: bigint };

/** Everything the help dialog needs to explain a NEAR payment. */
export type FundsShortfall = {
  /** Account that pays; "" when the explorer account isn't ready. */
  account: string;
  /** Spendable NEAR (yocto), null when unknown. */
  have: bigint | null;
  /** NEAR (yocto) the action needs, gas included. */
  need: bigint;
  qgold: QgoldCover | null;
};

const big = (v: unknown) => {
  try {
    return BigInt(String(v ?? "0"));
  } catch {
    return 0n;
  }
};

/** Missing NEAR in yocto (0 when covered or unknown). */
export function missingNear(f: Pick<FundsShortfall, "have" | "need">): bigint {
  if (f.have === null) return 0n;
  return f.need > f.have ? f.need - f.have : 0n;
}

/** NEAR yocto a sale of `units` QGOLD brings at R − feeBps (mirrors the vault). */
export function qgoldWorth(units: bigint, rate: bigint, feeBps = 100): bigint {
  if (units <= 0n || rate <= 0n) return 0n;
  const gross = (units * rate) / QGOLD_ONE;
  return gross - (gross * BigInt(feeBps) + BPS - 1n) / BPS;
}

/** Which way out the dialog leads with. */
export type FundsReason = "no-account" | "no-near" | "qgold-covers" | "qgold-short" | "unknown";
export function fundsReason(f: FundsShortfall): FundsReason {
  if (!f.account) return "no-account";
  const missing = missingNear(f);
  if (missing === 0n) return "unknown";
  if (!f.qgold || f.qgold.units === 0n) return "no-near";
  return f.qgold.worth >= missing ? "qgold-covers" : "qgold-short";
}

/** NEAR yocto → "1.02" style text (up to `digits` places, rounded up so it never understates a need). */
export function nearText(yocto: bigint | null, digits = 4): string {
  if (yocto === null) return "?";
  const step = 10n ** BigInt(24 - digits);
  const up = ((yocto + step - 1n) / step) * step;
  const whole = up / YOCTO;
  const frac = (up % YOCTO).toString().padStart(24, "0").slice(0, digits).replace(/0+$/, "");
  return `${whole.toLocaleString("en-US")}${frac ? "." + frac : ""}`;
}
/** QGOLD base units → "1,234.5". */
export function qgoldText(units: bigint, digits = 2): string {
  const whole = units / QGOLD_ONE;
  const frac = (units % QGOLD_ONE).toString().padStart(6, "0").slice(0, digits).replace(/0+$/, "");
  return `${whole.toLocaleString("en-US")}${frac ? "." + frac : ""}`;
}

/** The account's spendable balance in yoctoNEAR, read straight from the chain (null when unknown). */
export async function readNearBalance(accountId: string): Promise<bigint | null> {
  if (!accountId) return null;
  try {
    const config = (await fetch("/api/config", { credentials: "same-origin" }).then((r) => r.json())) as { rpcUrl?: string };
    if (!config?.rpcUrl) return null;
    const r = await fetch(config.rpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "balance",
        method: "query",
        params: { request_type: "view_account", finality: "final", account_id: accountId },
      }),
    });
    const body = (await r.json()) as { result?: { amount?: string }; error?: { cause?: { name?: string } } };
    if (body.error?.cause?.name === "UNKNOWN_ACCOUNT") return 0n;
    return body.result?.amount ? BigInt(body.result.amount) : null;
  } catch {
    return null;
  }
}

/** QGOLD on chain for this account and what it sells for now (null when the vault is closed or unreadable). */
export async function readQgoldCover(accountId: string): Promise<QgoldCover | null> {
  if (!accountId) return null;
  try {
    const [token, account] = await Promise.all([
      fetch("/api/economy/qgold").then((r) => (r.ok ? r.json() : null)),
      fetch(`/api/qgold/account?account=${encodeURIComponent(accountId)}`).then((r) => (r.ok ? r.json() : null)),
    ]);
    const rate = big(token?.vault?.rate);
    if (!token?.vault || token.vault.paused || rate === 0n || !account) return null;
    const units = big(account.balance);
    return { units, worth: qgoldWorth(units, rate, Number(token.rules?.sellFeeBps ?? 100)) };
  } catch {
    return null;
  }
}

/** Reads balance and QGOLD together for a payment of `need` yocto. */
export async function checkFunds(accountId: string, need: bigint): Promise<FundsShortfall> {
  if (!accountId) return { account: "", have: null, need, qgold: null };
  const [have, qgold] = await Promise.all([readNearBalance(accountId), readQgoldCover(accountId)]);
  return { account: accountId, have, need, qgold };
}
