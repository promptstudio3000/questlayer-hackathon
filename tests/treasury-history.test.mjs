// Treasury history (/api/treasury/history): one point per UTC day, seeded from the public records.
import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { createTreasuryHistory, seedPoints, bucketValues } from "../server/native/treasury-history.mjs";

const N = (n) => (BigInt(Math.round(n * 1e6)) * 10n ** 18n).toString();
const mixRecord = {
  runs: [
    { at: "2026-11-04T13:59:59Z", before: [{ bucket: "lst", current: N(2) }, { bucket: "stable", current: "0" }, { bucket: "near", current: "0" }], after: [{ bucket: "lst", current: N(1.5) }, { bucket: "stable", current: N(0.5) }, { bucket: "near", current: "0" }] },
    { at: "2026-11-05T05:30:00Z", before: [{ bucket: "lst", current: N(1) }, { bucket: "stable", current: N(0.8) }, { bucket: "near", current: N(0.2) }] },
  ],
};
const stnearRecord = { deposits: [{ at: "2026-11-02T01:26:41Z", near: N(2) }] };

test("seed: the first deposit and every mix run, newest state per day", () => {
  const pts = seedPoints({ mixRecord, stnearRecord });
  assert.deepEqual(pts.map((p) => p.day), ["2026-11-02", "2026-11-04", "2026-11-05"]);
  assert.equal(pts[0].buckets.lst, N(2));
  assert.equal(pts[1].buckets.stable, N(0.5), "a run's after state wins over its before state");
  assert.equal(pts[2].total, N(2));
  assert.deepEqual(Object.keys(bucketValues([])), ["staked", "lst", "stable", "near"]);
});

test("recorder: live days win over records, one row per day, newest view of the day", () => {
  const db = new DatabaseSync(":memory:");
  let now = Date.parse("2026-11-05T08:00:00Z");
  const h = createTreasuryHistory(db, { records: () => ({ mixRecord, stnearRecord }), clock: () => now });
  const view = (staked) => ({ total: (BigInt(N(staked)) + BigInt(N(2))).toString(), buckets: [{ bucket: "staked", current: N(staked) }, { bucket: "lst", current: N(2) }, { bucket: "stable", current: "0" }, { bucket: "near", current: "0" }] });
  assert.equal(h.note(view(10)), true);
  now += 3_600_000;
  h.note(view(93));
  assert.equal(h.note({ total: "-1", buckets: [] }), false, "bad views are ignored");
  now = Date.parse("2026-11-06T08:00:00Z");
  h.note(view(95));
  const { points } = h.read({ days: 90 });
  assert.deepEqual(points.map((p) => [p.day, p.source]), [
    ["2026-11-02", "record"],
    ["2026-11-04", "record"],
    ["2026-11-05", "live"],
    ["2026-11-06", "live"],
  ]);
  assert.equal(points[2].buckets.staked, N(93), "the newest view of the day is kept");
  assert.equal(h.read({ days: 2 }).points.length, 2);
});
