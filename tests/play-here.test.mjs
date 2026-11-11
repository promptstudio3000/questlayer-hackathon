import test from "node:test";
import assert from "node:assert/strict";
import { demoChosen, locationPermission, shouldStartWithGps } from "../src/play-here.ts";

test("the game starts in the world around the player unless location is refused or demo was chosen", () => {
  assert.equal(shouldStartWithGps("granted", false), true);
  assert.equal(shouldStartWithGps("prompt", false), true);
  assert.equal(shouldStartWithGps("denied", false), false);
  assert.equal(shouldStartWithGps("unavailable", false), false);
  assert.equal(shouldStartWithGps("granted", true), false);
});

test("without a browser the helpers stay quiet", async () => {
  assert.equal(demoChosen(), false);
  assert.equal(await locationPermission(), "unavailable");
});
