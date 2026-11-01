import test from "node:test";
import assert from "node:assert/strict";
import { editionLine, shareFileName, shareText } from "../src/share-card.ts";

const polar = { name: "Northern Lights", slot: "above", color: "#9edfc5", serial: 12 };

test("edition line names the edition, serial and slot", () => {
  assert.equal(editionLine(polar), "Limited edition · #12 · worn above");
  assert.equal(
    editionLine({ ...polar, name: "Aurora crown" }),
    "Northern Lights edition · #12 · worn above",
  );
  assert.equal(
    editionLine({ name: "Pebble glow", slot: "below", color: "#123456", serial: null }),
    "Explorer Aura · worn below",
  );
});

test("share text and file name stay plain and safe", () => {
  assert.equal(
    shareText({ explorer: "Ada", item: polar, outfit: [], place: "Plzeň", secured: false }),
    "Ada found Northern Lights on a QuestLayer walk in Plzeň.",
  );
  assert.equal(shareFileName(polar), "questlayer-northern-lights-12.png");
  assert.equal(shareFileName({ name: "!!!", serial: null }), "questlayer-aura.png");
});
