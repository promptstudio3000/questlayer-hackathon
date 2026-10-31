import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  rmSync,
  readFileSync,
  readdirSync,
  statSync,
  utimesSync,
  existsSync,
  copyFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { backup, DatabaseSync } from "node:sqlite";
import { SocialContent } from "../server/social-content.mjs";
import { NoteMedia } from "../server/note-media.mjs";
import { openDatabase, createPlayer } from "../server/database.mjs";

function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), "questlayer-note-media-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return { dir, media: new NoteMedia(dir) };
}
test("note photos are bounded, re-encoded and stripped of source metadata", async (t) => {
  const { media } = fixture(t);
  const source = await sharp({
    create: { width: 1400, height: 800, channels: 3, background: "#672eeb" },
  })
    .jpeg()
    .withMetadata({
      orientation: 6,
      exif: { IFD0: { ImageDescription: "Synthetic private metadata" } },
    })
    .toBuffer();
  const url = await media.store(
    `data:image/jpeg;base64,${source.toString("base64")}`,
  );
  const path = media.file(url),
    meta = await sharp(readFileSync(path)).metadata();
  assert.equal(meta.format, "jpeg");
  assert(meta.width <= 1024 && meta.height <= 1024);
  assert(
    meta.height > meta.width,
    "source orientation is applied before metadata removal",
  );
  assert.equal(meta.exif, undefined);
  assert.equal(meta.orientation, undefined);
  assert.equal(statSync(path).mode & 0o077, 0);
  assert.equal(await media.store(null), null);
  media.remove(url);
  assert.equal(media.file("/api/media/../../private.txt"), null);
});
test("invalid, oversized and mislabeled media never creates a file", async (t) => {
  const { dir, media } = fixture(t);
  const png = await sharp({
    create: { width: 2, height: 2, channels: 3, background: "white" },
  })
    .png()
    .toBuffer();
  for (const data of [
    "data:image/svg+xml;base64,PHN2Zz4=",
    "data:image/png;base64,!!!!",
    `data:image/jpeg;base64,${png.toString("base64")}`,
    `data:image/png;base64,${Buffer.alloc(1_000_001).toString("base64")}`,
    "data:image/png;base64,YWJj",
  ]) {
    await assert.rejects(media.store(data));
  }
  assert.deepEqual(readdirSync(dir), []);
  assert.equal(media.active, 0);
});
test("media cleanup cannot address unrelated paths and processing capacity is bounded", async (t) => {
  const { media, dir } = fixture(t);
  const image = await sharp({
    create: { width: 2, height: 2, channels: 3, background: "white" },
  })
    .png()
    .toBuffer();
  media.active = 2;
  await assert.rejects(
    media.store(`data:image/png;base64,${image.toString("base64")}`),
    /busy/,
  );
  media.remove("/etc/passwd");
  media.remove("/api/media/image_../../foo.jpg");
  assert.deepEqual(readdirSync(dir), []);
});
test("orphan cleanup preserves referenced and recent images across bounded passes", async (t) => {
  const { media } = fixture(t);
  const db = openDatabase(":memory:");
  t.after(() => db.close());
  const player = createPlayer(db, "Media test");
  const input = await sharp({
    create: { width: 2, height: 2, channels: 3, background: "white" },
  })
    .png()
    .toBuffer();
  const data = "data:image/png;base64," + input.toString("base64");
  const retained = await media.store(data),
    orphan = await media.store(data),
    recent = await media.store(data);
  const old = new Date(Date.now() - 2 * 86400000);
  utimesSync(media.file(retained), old, old);
  utimesSync(media.file(orphan), old, old);
  db.prepare("INSERT INTO messages VALUES(?,?,?,?,?,?,?,?)").run(
    "retained-photo",
    player,
    "Retained note",
    49,
    13,
    retained,
    null,
    Date.now(),
  );
  let removed = 0;
  for (let i = 0; i < 4; i++) removed += media.prune(db, { limit: 1 }).removed;
  assert.equal(removed, 1);
  assert(readFileSync(media.file(retained)).length);
  assert(readFileSync(media.file(recent)).length);
});

test("deletion revokes access immediately but lets an earlier database snapshot finish copying media", async (t) => {
  const { media, dir } = fixture(t),
    db = openDatabase(":memory:");
  t.after(() => db.close());
  const player = createPlayer(db, "Restore test"),
    viewer = createPlayer(db, "Reader");
  let now = Date.now();
  const social = new SocialContent(db, { clock: () => now });
  const image = await sharp({
    create: { width: 2, height: 2, channels: 3, background: "white" },
  })
    .png()
    .toBuffer();
  const source = "data:image/png;base64," + image.toString("base64");
  const note = await social.create(
    player,
    {
      clientId: "backup-race",
      text: "A public place",
      lat: 49,
      lng: 13,
      arena: true,
      publicConsent: true,
      shareGps: false,
      image: source,
    },
    { storeImage: (data) => media.store(data) },
  );
  const url = db
    .prepare("SELECT image FROM messages WHERE id=?")
    .get(note.id).image;
  const old = new Date(now - 7 * 86400000);
  utimesSync(media.file(url), old, old);
  const snapshot = join(dir, "snapshot.sqlite");
  await backup(db, snapshot);
  social.remove(player, note.id);
  assert.equal(social.mediaAllowed(player, url), false);
  assert.equal(social.mediaAllowed(viewer, url), false);
  assert.equal(media.prune(db, { now }).removed, 0);
  assert.equal(
    db
      .prepare("SELECT retired_at FROM social_media_retirements WHERE image=?")
      .get(url).retired_at,
    now,
  );
  const earlier = new DatabaseSync(snapshot, { readOnly: true });
  assert.equal(
    earlier.prepare("SELECT image FROM messages WHERE id=?").get(note.id).image,
    url,
  );
  copyFileSync(media.file(url), join(dir, "snapshot-photo.jpg"));
  earlier.close();
  now += 86400001;
  social.remove(player, note.id);
  assert.equal(media.prune(db, { now }).removed, 1);
  assert.equal(existsSync(media.file(url)), false);
  assert.equal(
    db.prepare("SELECT COUNT(*) n FROM social_media_retirements").get().n,
    0,
  );
  assert(
    existsSync(join(dir, "snapshot-photo.jpg")),
    "an older private backup has its independent copy",
  );
});

test("media retirement and content removal roll back together", async (t) => {
  const db = openDatabase(":memory:");
  t.after(() => db.close());
  const player = createPlayer(db, "Owner"),
    social = new SocialContent(db);
  const url = "/api/media/image_11111111-1111-4111-8111-111111111111.jpg";
  const note = await social.create(
    player,
    {
      clientId: "rollback",
      text: "Keep on failure",
      lat: 49,
      lng: 13,
      arena: true,
      publicConsent: true,
      shareGps: false,
      image: "data:image/png;base64,YQ==",
    },
    { storeImage: async () => url },
  );
  db.exec(
    "CREATE TRIGGER stop_delete BEFORE UPDATE ON messages BEGIN SELECT RAISE(ABORT,'disk failure'); END;",
  );
  assert.throws(() => social.remove(player, note.id), /disk failure/);
  assert.equal(
    db.prepare("SELECT COUNT(*) n FROM social_media_retirements").get().n,
    0,
  );
  assert.equal(
    db.prepare("SELECT image FROM messages WHERE id=?").get(note.id).image,
    url,
  );
});
