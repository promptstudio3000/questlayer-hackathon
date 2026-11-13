import test from "node:test";
import assert from "node:assert/strict";
import { demoChosen, locationPermission, shouldStartWithGps } from "../src/play-here.ts";

test("the game starts in the world around the player unless location is refused or demo was chosen", () => {
  assert.equal(shouldStartWithGps("granted", false), true);
  assert.equal(shouldStartWithGps("prompt", false), true);
  assert.equal(shouldStartWithGps("denied", false), false);
  assert.equal(shouldStartWithGps("unavailable", false), false);
  assert.equal(shouldStartWithGps("granted", true, true, true), false);
});

test("GotchiGO always starts in GPS, even after the demo was picked there once", () => {
  assert.equal(shouldStartWithGps("granted", true, false, false), true);
  assert.equal(shouldStartWithGps("denied", true, false, false), false);
});

test("the Test Layer opens in the Plzeň demo until the player taps Use GPS there", () => {
  assert.equal(shouldStartWithGps("granted", false, true, false), false);
  assert.equal(shouldStartWithGps("prompt", false, true, false), false);
  assert.equal(shouldStartWithGps("granted", false, true, true), true);
  assert.equal(shouldStartWithGps("denied", false, true, true), false);
  assert.equal(shouldStartWithGps("granted", false, false, false), true);
});

test("without a browser the helpers stay quiet", async () => {
  assert.equal(demoChosen(), false);
  assert.equal(await locationPermission(), "unavailable");
});
