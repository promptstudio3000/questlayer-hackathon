// Treasury dashboard (/treasury): the model behind its simulator and its copy rules.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { arc, blendedApr, niceScale, rateNear, simulate, toNear, toUnits } from "../src/economy/treasury-model.ts";

const base = { treasury: 100, lstBps: 5000, stableBps: 4000, lstApr: 4, stableApr: 12, backing: 5, supply: 5000, burnBpsPerDay: 0, feesPerDay: 0, days: 365 };

test("yocto and rate conversion", () => {
  assert.equal(toNear("2000000000000000000000000"), 2);
  assert.equal(toNear("1499062500000000000000001"), 1.4990625);
  assert.equal(toNear(null), 0);
  assert.equal(toUnits("4935360882", 6), 4935.360882);
  // R from /api/economy/qgold is yoctoNEAR per whole QGOLD: backing / supply.
  const r = rateNear("1022862598549634116363");
  assert.ok(Math.abs(r - 5.048196 / 4935.360882) < 1e-6);
});

test("only yield is spent: principal stays, a year at 50/40/10 pays the blended rate", () => {
  const days = simulate(base);
  assert.equal(days.length, 365);
  assert.equal(days.at(-1).treasury, 100);
  assert.equal(blendedApr(5000, 4000, 4, 12), 6.8);
  assert.ok(Math.abs(days.at(-1).cumulativeYield - 6.8) < 1e-9);
});

test("fees grow the treasury and fill insurance with 10 %", () => {
  const days = simulate({ ...base, feesPerDay: 1, days: 10 });
  assert.ok(Math.abs(days.at(-1).treasury - 109) < 1e-9);
  assert.ok(Math.abs(days.at(-1).insurance - 1) < 1e-9);
});

test("burning QGOLD can only raise R; without burns R stays", () => {
  const flat = simulate(base);
  assert.equal(flat[0].rate, flat.at(-1).rate);
  const burn = simulate({ ...base, burnBpsPerDay: 20 });
  for (let i = 1; i < burn.length; i++) assert.ok(burn[i].rate >= burn[i - 1].rate);
  assert.ok(burn.at(-1).rate > flat.at(-1).rate);
});

test("mix shares are clamped to 100 %", () => {
  const days = simulate({ ...base, lstBps: 8000, stableBps: 8000, days: 365 });
  assert.ok(Math.abs(days.at(-1).cumulativeYield - (80 * 4 + 20 * 12) / 100) < 1e-9);
});

test("chart helpers", () => {
  assert.deepEqual(niceScale(0.95, 4), { max: 1, ticks: [0, 0.25, 0.5, 0.75, 1] });
  assert.equal(niceScale(0).max, 1);
  assert.match(arc(110, 110, 84, 0, 0.5), /^M 110\.00 26\.00 A 84 84 0 0 1/);
});

test("treasury page reads only public endpoints and keeps copy neutral", () => {
  const page = readFileSync(new URL("../src/economy/TreasuryPage.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(page, /hackathon|judge|demo day|pitch/i);
  assert.doesNotMatch(page, /city pot|city share|guaranteed|profit/i);
  const urls = [...page.matchAll(/useJson<\w+>\("([^"]+)"\)/g)].map((m) => m[1]).sort();
  assert.deepEqual(urls, ["/api/economy/ledger", "/api/economy/qgold", "/api/map/rewards/day", "/api/treasury/dao", "/api/treasury/mix"]);
  const main = readFileSync(new URL("../src/main.tsx", import.meta.url), "utf8");
  assert.match(main, /lazy\(\(\) => import\("\.\/economy\/TreasuryPage"\)\)/);
});
