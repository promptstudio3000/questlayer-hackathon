import test from "node:test";
import assert from "node:assert/strict";
import { awayFromDemo, DEMO_AREA_M, gpsRemembered, locationGranted } from "../src/play-here.ts";

test("Šťáhlavy and Brno are outside the Plzeň demo, the old town is inside", () => {
  assert.equal(DEMO_AREA_M, 12_000);
  assert.equal(awayFromDemo({ lat: 49.7477, lng: 13.3776 }), false);
  assert.equal(awayFromDemo({ lat: 49.6747, lng: 13.5068 }), true);
  assert.equal(awayFromDemo({ lat: 49.1951, lng: 16.6068 }), true);
});

test("without a browser the helpers stay quiet and never prompt", async () => {
  assert.equal(gpsRemembered(), false);
  assert.equal(await locationGranted(), false);
});
