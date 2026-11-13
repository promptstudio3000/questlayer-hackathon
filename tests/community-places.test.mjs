import test from "node:test";
import assert from "node:assert/strict";
import { openDatabase, createPlayer } from "../server/database.mjs";
import { SocialContent } from "../server/social-content.mjs";
import { createCommunityPlaces } from "../server/community-places.mjs";

const here = { lat: 49.7475, lng: 13.3776 };
const DAY = 86_400_000;

test("map notes can fade after a day or a week, and the author can edit the text", async () => {
  const db = openDatabase(":memory:");
  let now = Date.parse("2026-11-10T12:00:00Z");
  const author = createPlayer(db, "Author"),
    viewer = createPlayer(db, "Viewer");
  const social = new SocialContent(db, { clock: () => now });
  const note = (clientId, extra) =>
    social.create(author, { clientId, text: "Bench by the lime tree.", ...here, arena: true, publicConsent: true, shareGps: false, ...extra });
  const day = await note("n-day", { days: 1 });
  await note("n-week", { days: 7 });
  await note("n-keep", {});
  await assert.rejects(note("n-bad", { days: 3 }), /how long the note stays/);
  const list = () => social.list(viewer, { ...here, arena: true }).messages;
  assert.equal(list().length, 3);
  assert.equal(list().find((n) => n.id === day.id).expires_at, now + DAY);
  now += DAY + 1;
  assert.equal(list().length, 2, "the one-day note left the map");
  now += 6 * DAY;
  assert.deepEqual(list().map((n) => n.expires_at), [null], "only the kept note stays");
  const kept = list()[0];
  assert.throws(() => social.edit(viewer, kept.id, { text: "Mine now" }), /Only the author/);
  assert.equal(social.edit(author, kept.id, { text: "Bench by the old lime tree." }).text, "Bench by the old lime tree.");
  assert.equal(list()[0].text, "Bench by the old lime tree.");
  // A replay with the same content and no duration keeps its receipt.
  assert.equal((await note("n-keep", {})).replayed, true);
});

test("community places list nearest first, stay free, and only the author edits or removes them", () => {
  const db = openDatabase(":memory:");
  const author = createPlayer(db, "Vera"),
    viewer = createPlayer(db, "Mira"),
    others = [createPlayer(db, "A"), createPlayer(db, "B"), createPlayer(db, "C")];
  const goldBefore = db.prepare("SELECT gold_u FROM players WHERE id=?").get(author).gold_u;
  const places = createCommunityPlaces(db);
  const add = (name, dLat, extra = {}) =>
    places.create(author, { name, note: "Worth a slow look.", kind: "view", lat: here.lat + dLat, lng: here.lng, arena: true, publicConsent: true, ...extra }).place;
  const far = add("Far tower", 0.01);
  const near = add("Near fountain", 0.001);
  assert.throws(() => add("No consent", 0, { publicConsent: false }), /public/);
  assert.throws(() => add("Odd kind", 0, { kind: "casino" }), /kind of place/);
  assert.throws(() => add("Call me", 0, { note: "Call +420 777 123 456" }), /not allowed/);
  assert.throws(() => places.create(author, { name: "Real", note: "Nice", kind: "art", ...here, arena: false, publicConsent: true }), (e) => e.status === 422 || e.status === 400);
  const list = (who = viewer) => places.list(who, { ...here, arena: true }).places;
  assert.deepEqual(list().map((p) => p.name), ["Near fountain", "Far tower"]);
  assert.ok(list()[0].distanceM < list()[1].distanceM);
  assert.equal(places.list(viewer, { ...here, arena: false }).places.length, 0, "demo places stay off the real map");
  assert.throws(() => places.edit(viewer, near.id, { name: "Mine" }), /Only the author/);
  assert.equal(places.edit(author, near.id, { name: "Golden fountain" }).place.name, "Golden fountain");
  places.remove(author, far.id);
  assert.deepEqual(list().map((p) => p.name), ["Golden fountain"]);
  for (const who of others) places.report(who, near.id, { reason: "spam" });
  assert.equal(list().length, 0, "three reports hide a place");
  assert.equal(db.prepare("SELECT gold_u FROM players WHERE id=?").get(author).gold_u, goldBefore, "no GOLD moves");
});
