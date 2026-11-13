// Pure maths for the /treasury dashboard (docs/TREASURY-PAGE.md). Live values
// arrive as yocto strings; charts need plain numbers, so this file converts
// once (NEAR as floats are fine for drawing, never for the ledger) and runs
// the "what if" model behind the simulator.

/** yoctoNEAR string → NEAR as a float, for drawing only. */
export function toNear(yocto: string | null | undefined): number {
  if (!yocto || !/^\d+$/.test(yocto)) return 0;
  const s = yocto.padStart(25, "0");
  return Number(`${s.slice(0, -24)}.${s.slice(-24, -12)}`);
}

/** Token amount with `decimals` → float. */
export function toUnits(raw: string | null | undefined, decimals: number): number {
  if (!raw || !/^\d+$/.test(raw)) return 0;
  return Number(raw) / 10 ** decimals;
}

/** QGOLD backing rate R (the API gives yoctoNEAR per whole QGOLD) as NEAR. */
/**
 * One currency on screen (owner, 12–13 Nov 2026): the game counts QGOLD in its
 * smallest unit, so 1 NEAR ≈ 1B QGOLD (src/gold-units.ts). The vault's rate is
 * NEAR per whole token (10^6 units), so prices read per 1B QGOLD = 1,000 tokens.
 */
export const QGOLD_B_TOKENS = 1000;
/** NEAR behind 1B QGOLD for a 24-decimal rate per whole token. */
export function rateB(rate: string | null | undefined): number {
  return rateNear(rate) * QGOLD_B_TOKENS;
}
/** "1.45B", "967.5M", "1,250" for a count of QGOLD (smallest units). */
export function qgoldCount(units: number | string | bigint | null | undefined): string {
  const n = Number(units ?? NaN);
  if (!Number.isFinite(n)) return "—";
  const cut = (v: number) => v.toLocaleString("en-US", { maximumFractionDigits: 2 });
  const a = Math.abs(n);
  if (a >= 1e9) return `${cut(n / 1e9)}B`;
  if (a >= 1e6) return `${cut(n / 1e6)}M`;
  return Math.round(n).toLocaleString("en-US");
}

export function rateNear(rate: string | null | undefined): number {
  if (!rate || !/^\d+$/.test(rate)) return 0;
  return Number(BigInt(rate)) / 1e24;
}

export type ModelInput = {
  /** Sponsor treasury in NEAR. */
  treasury: number;
  /** Shares of the treasury in basis points; the rest is the NEAR reserve. */
  lstBps: number;
  stableBps: number;
  /** Yearly yields in percent. */
  lstApr: number;
  stableApr: number;
  /** QGOLD side: NEAR backing, supply, and share of supply spent (burned) per day in bps. */
  backing: number;
  supply: number;
  burnBpsPerDay: number;
  /** Fees paid into the treasury per day, in NEAR. */
  feesPerDay: number;
  days: number;
};

export type ModelDay = {
  day: number;
  /** Yield skimmed to the map that day. */
  yieldToMap: number;
  /** Running total of yield sent to the map. */
  cumulativeYield: number;
  /** Treasury principal: yield is skimmed, fees (less 10 % insurance) are kept. */
  treasury: number;
  /** Insurance fund, 10 % of every fee. */
  insurance: number;
  /** Backing rate R in NEAR per QGOLD. */
  rate: number;
  supply: number;
};

const clampBps = (n: number) => Math.max(0, Math.min(10000, Math.round(n)));

/**
 * Daily step model of the approved economy:
 * - the treasury's yield (LST + stables; the NEAR reserve earns nothing) is
 *   skimmed every day into the map budget, so principal never shrinks;
 * - fees go to the treasury, 10 % of them into the insurance fund;
 * - playing mints QGOLD together with the NEAR behind it, so it never moves R;
 *   in-game spending burns QGOLD with the backing left in the vault, so R rises.
 */
export function simulate(input: ModelInput): ModelDay[] {
  const lst = clampBps(input.lstBps);
  const stable = clampBps(Math.min(input.stableBps, 10000 - lst));
  const days = Math.max(1, Math.min(730, Math.round(input.days)));
  const burn = Math.max(0, Math.min(500, input.burnBpsPerDay)) / 10000;
  let treasury = Math.max(0, input.treasury);
  let insurance = 0;
  let supply = Math.max(0, input.supply);
  const backing = Math.max(0, input.backing);
  let cumulative = 0;
  const out: ModelDay[] = [];
  for (let day = 1; day <= days; day++) {
    const daily = (treasury * (lst / 10000) * input.lstApr + treasury * (stable / 10000) * input.stableApr) / 100 / 365;
    const yieldToMap = Math.max(0, daily);
    cumulative += yieldToMap;
    const fees = Math.max(0, input.feesPerDay);
    insurance += fees * 0.1;
    treasury += fees * 0.9;
    supply = supply * (1 - burn);
    out.push({
      day,
      yieldToMap,
      cumulativeYield: cumulative,
      treasury,
      insurance,
      rate: supply > 0 ? backing / supply : 0,
      supply,
    });
  }
  return out;
}

/** Blended yearly yield of a mix, in percent. */
export function blendedApr(lstBps: number, stableBps: number, lstApr: number, stableApr: number): number {
  return (clampBps(lstBps) * lstApr + clampBps(stableBps) * stableApr) / 10000;
}

/** "Nice" axis maximum and ticks for a chart scale. */
export function niceScale(max: number, count = 4): { max: number; ticks: number[] } {
  if (!(max > 0)) return { max: 1, ticks: [0, 0.25, 0.5, 0.75, 1] };
  const raw = max / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? 10 * mag;
  const top = step * Math.ceil(max / step);
  const ticks: number[] = [];
  for (let t = 0; t <= top + step / 2; t += step) ticks.push(Number(t.toPrecision(12)));
  return { max: top, ticks };
}

/** Compact number label: 0.0012, 1.25, 1,250, 1.2 M. */
export function num(n: number, digits = 2): string {
  if (!Number.isFinite(n)) return "—";
  const a = Math.abs(n);
  if (a >= 1e6) return `${(n / 1e6).toFixed(1)} M`;
  if (a >= 1000) return n.toLocaleString("en-GB", { maximumFractionDigits: 0 });
  if (a === 0) return "0";
  if (a < 0.01) return n.toPrecision(2);
  return n.toLocaleString("en-GB", { maximumFractionDigits: digits });
}

/** SVG arc path for a donut segment from fraction a to b (0..1) of a circle. */
export function arc(cx: number, cy: number, r: number, a: number, b: number): string {
  const span = Math.min(b - a, 0.9999);
  const p = (f: number) => {
    const t = f * Math.PI * 2 - Math.PI / 2;
    return `${(cx + r * Math.cos(t)).toFixed(2)} ${(cy + r * Math.sin(t)).toFixed(2)}`;
  };
  return `M ${p(a)} A ${r} ${r} 0 ${span > 0.5 ? 1 : 0} 1 ${p(a + span)}`;
}

/** Tick label with just enough decimals to tell neighbouring ticks apart. */
export function tickLabel(value: number, step: number): string {
  if (!(step > 0)) return num(value);
  const decimals = Math.max(0, Math.min(10, Math.ceil(-Math.log10(step)) + (step / 10 ** Math.floor(Math.log10(step)) === 2.5 ? 1 : 0)));
  if (Math.abs(value) >= 1000) return num(value);
  return value.toFixed(decimals);
}
