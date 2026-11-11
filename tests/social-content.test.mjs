import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase, createPlayer } from "../server/database.mjs";
import {
  SocialContent,
  initSocialContent,
  isSocialBlocked,
} from "../server/social-content.mjs";
import { nearbyPresence, updatePresence } from "../server/presence.mjs";

const start = Date.parse("2026-10-31T16:00:00Z");
const place = { lat: 49.7475, lng: 13.3776 };
const photo = "data:image/png;base64,YQ==";
const image = "/api/media/image_11111111-1111-1111-1111-111111111111.jpg";
function fixture() {
  const db = openDatabase(":memory:");
  let now = start;
  const author = createPlayer(db, "Author"),
    viewer = createPlayer(db, "Viewer"),
    stranger = createPlayer(db, "Stranger");
  const social = new SocialContent(db, {
    clock: () => now,
    authorizeOperator: (who) => who === "local-reviewer",
  });
  const input = (extra = {}) => ({
    clientId: "note-one",
    text: "A quiet public garden.",
    ...place,
    arena: true,
    publicConsent: true,
    shareGps: false,
    ...extra,
  });
  return {
    db,
    author,
    viewer,
    stranger,
    social,
    input,
    time: (value) => {
      now = value;
    },
  };
}
const code = (expected) => (error) => error.code === expected;
function deferred() {
  let resolve;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

test("notes require explicit public consent, keep optional GPS absent and isolate arena from real map", async () => {
  const f = fixture();
  try {
    await assert.rejects(
      f.social.create(f.author, f.input({ publicConsent: false })),
    );
    await assert.rejects(
      f.social.create(f.author, f.input({ arena: undefined })),
    );
    const created = await f.social.create(
      f.author,
      f.input({ fix: { ...place, accuracy: 1, timestamp: start } }),
    );
    const row = f.social.list(f.viewer, { ...place, arena: true }).messages[0];
    assert.equal(row.id, created.id);
    assert.equal(row.author_fix, null);
    assert.equal(row.own, false);
    assert.equal(
      f.social.list(f.author, { ...place, arena: true }).messages[0].own,
      true,
    );
    assert.deepEqual(
      f.social.list(f.viewer, { ...place, arena: false }).messages,
      [],
    );
    assert.equal(
      f.db.prepare("SELECT author_fix FROM messages").get().author_fix,
      null,
    );
    assert(
      !f.db
        .prepare("SELECT request_hash FROM social_note_operations")
        .get()
        .request_hash.includes("49.7475"),
    );
  } finally {
    f.db.close();
  }
});

test("GPS requires a fresh accurate real fix and stores only the expressly selected fields", async () => {
  const f = fixture();
  try {
    const fix = {
      ...place,
      accuracy: 12,
      timestamp: start,
      altitude: 501,
      trail: ["private"],
    };
    for (const changed of [
      { arena: true },
      { fix: { ...fix, accuracy: 36 } },
      { fix: { ...fix, timestamp: start - 15001 } },
      { fix: { ...fix, timestamp: start + 2001 } },
      { fix: { ...fix, lat: Infinity } },
    ])
      await assert.rejects(
        f.social.create(
          f.author,
          f.input({ arena: false, shareGps: true, fix, ...changed }),
        ),
      );
    await f.social.create(
      f.author,
      f.input({ arena: false, shareGps: true, fix }),
    );
    const saved = f.social.list(f.viewer, { ...place, arena: false })
      .messages[0].author_fix;
    assert.deepEqual(saved, { ...place, accuracy: 12, timestamp: start });
  } finally {
    f.db.close();
  }
});

test("exact retries return the original receipt without another image write and changed payloads conflict", async () => {
  const f = fixture();
  try {
    let writes = 0;
    const storeImage = async () => {
      writes++;
      return image;
    };
    const input = f.input({
      image: photo,
      arena: false,
      shareGps: true,
      fix: { ...place, accuracy: 10, timestamp: start },
    });
    const first = await f.social.create(f.author, input, { storeImage });
    f.time(start + 30000);
    assert.deepEqual(await f.social.create(f.author, input, { storeImage }), {
      ...first,
      replayed: true,
    });
    await assert.rejects(
      f.social.create(
        f.author,
        { ...input, text: "Different place" },
        { storeImage },
      ),
    );
    assert.equal(writes, 1);
    assert.equal(f.db.prepare("SELECT count(*) AS n FROM messages").get().n, 1);
    assert.deepEqual(f.social.operation(f.stranger, input.clientId), {
      found: false,
    });
  } finally {
    f.db.close();
  }
});

test("concurrent same-ID image submissions serialize before image work", async () => {
  const f = fixture(),
    imageJob = deferred();
  try {
    let writes = 0;
    const callbacks = {
      storeImage: () => {
        writes++;
        return imageJob.promise;
      },
    };
    const first = f.social.create(
      f.author,
      f.input({ image: photo }),
      callbacks,
    );
    assert.equal(f.social.operation(f.author, "note-one").state, "processing");
    await assert.rejects(
      f.social.create(f.author, f.input({ image: photo }), callbacks),
      code("NOTE_PROCESSING"),
    );
    imageJob.resolve(image);
    await first;
    assert.equal(writes, 1);
    assert.equal(f.social.operation(f.author, "note-one").state, "published");
  } finally {
    f.db.close();
  }
});

test("expired image attempt cannot commit over its replacement and its orphan is cleaned", async () => {
  const f = fixture(),
    oldJob = deferred();
  try {
    const removed = [];
    const first = f.social.create(f.author, f.input({ image: photo }), {
      storeImage: () => oldJob.promise,
      removeImage: (value) => removed.push(value),
    });
    f.time(start + 60001);
    assert.equal(f.social.operation(f.author, "note-one").state, "retryable");
    const replacementImage = image.replaceAll("1", "2");
    const replacement = await f.social.create(
      f.author,
      f.input({ image: photo }),
      { storeImage: async () => replacementImage },
    );
    oldJob.resolve(image);
    await assert.rejects(first, code("NOTE_EXPIRED"));
    assert.deepEqual(removed, [image]);
    assert.equal(f.social.operation(f.author, "note-one").id, replacement.id);
    assert.equal(
      f.db.prepare("SELECT image FROM messages").get().image,
      replacementImage,
    );
  } finally {
    f.db.close();
  }
});

test("revoked browser session during media preparation cannot publish and retry keeps the same content", async () => {
  const f = fixture();
  try {
    let valid = true;
    const removed = [];
    await assert.rejects(
      f.social.create(f.author, f.input({ image: photo }), {
        assertSession: () => {
          if (!valid) throw Error("Revoked session");
        },
        storeImage: async () => {
          valid = false;
          return image;
        },
        removeImage: (value) => removed.push(value),
      }),
      /Revoked/,
    );
    assert.deepEqual(removed, [image]);
    assert.equal(f.social.operation(f.author, "note-one").state, "retryable");
    assert.equal(f.db.prepare("SELECT count(*) AS n FROM messages").get().n, 0);
    valid = true;
    assert.equal(
      (
        await f.social.create(f.author, f.input({ image: photo }), {
          storeImage: async () => image,
        })
      ).state,
      "published",
    );
  } finally {
    f.db.close();
  }
});

test("abandon records an absent ID and prevents a delayed post; completed notes survive abandon", async () => {
  const f = fixture();
  try {
    assert.deepEqual(f.social.abandonOperation(f.author, "delayed"), {
      found: true,
      state: "abandoned",
    });
    await assert.rejects(
      f.social.create(f.author, f.input({ clientId: "delayed" })),
      code("NOTE_ABANDONED"),
    );
    const created = await f.social.create(f.author, f.input());
    assert.deepEqual(f.social.abandonOperation(f.author, "note-one"), {
      found: true,
      id: created.id,
      state: "published",
    });
    assert.equal(
      f.social.list(f.viewer, { ...place, arena: true }).messages.length,
      1,
    );
  } finally {
    f.db.close();
  }
});

test("abandon during image work invalidates the lease and cleans the late image", async () => {
  const f = fixture(),
    job = deferred();
  try {
    const removed = [];
    const pending = f.social.create(f.author, f.input({ image: photo }), {
      storeImage: () => job.promise,
      removeImage: (path) => removed.push(path),
    });
    f.social.abandonOperation(f.author, "note-one");
    job.resolve(image);
    await assert.rejects(pending, code("NOTE_EXPIRED"));
    assert.deepEqual(removed, [image]);
    assert.equal(f.social.operation(f.author, "note-one").state, "abandoned");
    assert.equal(f.db.prepare("SELECT count(*) AS n FROM messages").get().n, 0);
  } finally {
    f.db.close();
  }
});

test("owner removal strips public content and media, preserves an idempotent tombstone and cannot be restored", async () => {
  const f = fixture();
  try {
    const created = await f.social.create(
      f.author,
      f.input({
        image: photo,
        arena: false,
        shareGps: true,
        fix: { ...place, accuracy: 9, timestamp: start },
      }),
      { storeImage: async () => image },
    );
    assert.equal(f.social.mediaAllowed(f.viewer, image), true);
    await assert.rejects(async () => f.social.remove(f.viewer, created.id));
    f.social.report(f.viewer, created.id, {
      reason: "privacy",
      detail: "Please check this photo.",
    });
    assert.equal(f.social.remove(f.author, created.id).removedImage, image);
    assert.equal(f.social.remove(f.author, created.id).removedImage, null);
    const row = f.db.prepare("SELECT * FROM messages").get();
    assert.equal(row.text, "");
    assert.equal(row.image, null);
    assert.equal(row.author_fix, null);
    assert.equal(row.lat, 0);
    assert.equal(row.lng, 0);
    assert.equal(f.social.mediaAllowed(f.viewer, image), false);
    assert.equal(f.social.operation(f.author, "note-one").state, "deleted");
    assert.equal(
      f.db.prepare("SELECT detail FROM social_reports").get().detail,
      "",
    );
    assert.throws(() =>
      f.social.moderate("local-reviewer", {
        noteId: created.id,
        action: "restore",
        reason: "Requested review",
      }),
    );
    assert.equal(
      f.db
        .prepare(
          "SELECT count(*) AS n FROM social_audit WHERE action='note-deleted'",
        )
        .get().n,
      1,
    );
  } finally {
    f.db.close();
  }
});

test("reports are private, deduplicated and never hide content solely by their count", async () => {
  const f = fixture();
  try {
    const created = await f.social.create(f.author, f.input());
    const report = f.social.report(f.viewer, created.id, {
      reason: "unsafe-place",
      detail: "The entrance is closed.",
    });
    assert.deepEqual(
      f.social.report(f.viewer, created.id, { reason: "spam" }),
      { ...report, replayed: true },
    );
    f.social.report(f.stranger, created.id, { reason: "other" });
    assert.equal(
      f.social.list(f.viewer, { ...place, arena: true }).messages.length,
      1,
    );
    assert.throws(() => f.social.reports(f.viewer));
    assert.throws(() =>
      f.social.report(f.author, created.id, { reason: "privacy" }),
    );
    assert.throws(() =>
      f.social.report(f.viewer, created.id, { reason: "arbitrary" }),
    );
    assert.equal(f.social.reports("local-reviewer").reports.length, 2);
    assert(
      !JSON.stringify(
        f.social.list(f.viewer, { ...place, arena: true }),
      ).includes("entrance is closed"),
    );
  } finally {
    f.db.close();
  }
});

test("moderation is default denied, hides images and text, and requires explicit restoration", async () => {
  const f = fixture();
  try {
    const created = await f.social.create(f.author, f.input({ image: photo }), {
      storeImage: async () => image,
    });
    const unprivileged = new SocialContent(f.db);
    assert.throws(() =>
      unprivileged.moderate("local-reviewer", {
        noteId: created.id,
        action: "hide",
        reason: "Review",
      }),
    );
    f.social.report(f.viewer, created.id, { reason: "privacy" });
    f.social.moderate("local-reviewer", {
      noteId: created.id,
      action: "hide",
      reason: "Personal information in photo",
    });
    assert.equal(f.social.mediaAllowed(f.author, image), false);
    assert.equal(
      f.social.list(f.viewer, { ...place, arena: true }).messages.length,
      0,
    );
    assert.equal(
      (await f.social.create(f.author, f.input({ image: photo }))).state,
      "hidden",
    );
    assert.equal(f.social.reports("local-reviewer").reports.length, 0);
    f.social.moderate("local-reviewer", {
      noteId: created.id,
      action: "restore",
      reason: "Reviewed public landscape",
    });
    assert.equal(f.social.mediaAllowed(f.viewer, image), true);
    assert.equal(
      f.social.list(f.viewer, { ...place, arena: true }).messages.length,
      1,
    );
  } finally {
    f.db.close();
  }
});

test("blocks filter both directions from notes, image access and presence, with explicit unblock", async () => {
  const f = fixture();
  try {
    await f.social.create(f.author, f.input({ image: photo }), {
      storeImage: async () => image,
    });
    await f.social.create(f.viewer, f.input({ clientId: "other-note" }));
    for (const who of [f.author, f.viewer])
      updatePresence(
        f.db,
        who,
        { ...place, enabled: true, renew: true, leaseId: "walk", arena: true },
        start,
      );
    assert.equal(nearbyPresence(f.db, f.viewer, place, true, start).length, 1);
    f.social.setBlock(f.viewer, f.author, true);
    assert.equal(isSocialBlocked(f.db, f.author, f.viewer), true);
    assert.equal(
      f.social.list(f.viewer, { ...place, arena: true }).messages.length,
      1,
    );
    assert.equal(
      f.social.list(f.author, { ...place, arena: true }).messages.length,
      1,
    );
    assert.equal(f.social.mediaAllowed(f.viewer, image), false);
    assert.equal(f.social.mediaAllowed(f.stranger, image), true);
    assert.equal(nearbyPresence(f.db, f.viewer, place, true, start).length, 0);
    assert.equal(nearbyPresence(f.db, f.author, place, true, start).length, 0);
    assert.equal(f.social.blocks(f.viewer).blocks[0].playerId, f.author);
    assert.deepEqual(f.social.blocks(f.author).blocks, []);
    f.social.setBlock(f.author, f.viewer, true);
    f.social.setBlock(f.viewer, f.author, false);
    assert.equal(f.social.mediaAllowed(f.viewer, image), false);
    f.social.setBlock(f.author, f.viewer, false);
    assert.equal(f.social.mediaAllowed(f.viewer, image), true);
    assert.throws(() => f.social.setBlock(f.author, f.author, true));
  } finally {
    f.db.close();
  }
});

test("legacy notes migrate once into arena without changing the messages table and orphan media fails closed", () => {
  const db = openDatabase(":memory:");
  try {
    const author = createPlayer(db, "Legacy author"),
      viewer = createPlayer(db, "Viewer");
    db.prepare("INSERT INTO messages VALUES(?,?,?,?,?,?,?,?)").run(
      "legacy-note",
      author,
      "Legacy public note",
      place.lat,
      place.lng,
      image,
      null,
      start,
    );
    const columns = db
      .prepare("PRAGMA table_info(messages)")
      .all()
      .map((x) => x.name);
    const social = new SocialContent(db);
    initSocialContent(db);
    assert.deepEqual(
      db
        .prepare("PRAGMA table_info(messages)")
        .all()
        .map((x) => x.name),
      columns,
    );
    assert.equal(
      social.list(viewer, { ...place, arena: true }).messages.length,
      1,
    );
    assert.equal(
      social.list(viewer, { ...place, arena: false }).messages.length,
      0,
    );
    assert.equal(social.mediaAllowed(viewer, image), true);
    assert.equal(
      social.mediaAllowed(viewer, image.replaceAll("1", "9")),
      false,
    );
    assert.equal(social.mediaAllowed(viewer, "/api/media/../../secret"), false);
    assert.throws(() => social.mediaAllowed("unknown-player", image));
  } finally {
    db.close();
  }
});

test("bounded publication rates reject new IDs but preserve receipt lookup and exact retries", async () => {
  const f = fixture();
  try {
    for (let i = 0; i < 10; i++)
      await f.social.create(f.author, f.input({ clientId: `note-${i}` }));
    await assert.rejects(
      f.social.create(f.author, f.input({ clientId: "eleventh" })),
      (e) => e.status === 429,
    );
    assert.equal(
      (await f.social.create(f.author, f.input({ clientId: "note-0" })))
        .replayed,
      true,
    );
    assert.equal(f.social.operation(f.author, "note-0").state, "published");
    assert.throws(() =>
      f.social.list(f.viewer, { ...place, lat: Infinity, arena: true }),
    );
    assert.throws(() => f.social.operation(f.author, "bad/id"));
  } finally {
    f.db.close();
  }
});

test("a fresh process retains hidden receipts, permanent abandonment and bilateral blocks", async () => {
  const directory = mkdtempSync(join(tmpdir(), "questlayer-social-"));
  let db;
  try {
    db = openDatabase(join(directory, "social.sqlite"));
    const author = createPlayer(db, "Returning author"),
      viewer = createPlayer(db, "Returning viewer");
    let social = new SocialContent(db, {
      clock: () => start,
      authorizeOperator: (actor) => actor === "operator",
    });
    const input = {
      clientId: "persistent-note",
      text: "Public park entrance",
      ...place,
      arena: true,
      publicConsent: true,
      shareGps: false,
    };
    const receipt = await social.create(author, input);
    social.moderate("operator", {
      noteId: receipt.id,
      action: "hide",
      reason: "Review public access",
    });
    social.abandonOperation(author, "never-publish");
    social.setBlock(viewer, author, true);
    db.close();
    db = openDatabase(join(directory, "social.sqlite"));
    social = new SocialContent(db, { clock: () => start + 10000 });
    assert.equal(social.operation(author, input.clientId).state, "hidden");
    assert.deepEqual(await social.create(author, input), {
      ...receipt,
      state: "hidden",
      replayed: true,
    });
    await assert.rejects(
      social.create(author, { ...input, clientId: "never-publish" }),
      code("NOTE_ABANDONED"),
    );
    assert.equal(isSocialBlocked(db, author, viewer), true);
    assert.equal(db.prepare("SELECT count(*) AS n FROM messages").get().n, 1);
  } finally {
    db?.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("Local chat reads notes within the chosen radius and reports their distance", async () => {
  const f = fixture();
  await f.social.create(f.author, f.input());
  // ~16 km east (Rokycany) and ~85 km north-east (Prague).
  await f.social.create(f.author, f.input({ clientId: "note-two", text: "Rokycany square.", lng: place.lng + 0.217 }));
  await f.social.create(f.author, f.input({ clientId: "note-three", text: "Prague crew.", lat: place.lat + 0.328, lng: place.lng + 1.06 }));
  const read = (radiusKm) =>
    f.social.list(f.viewer, { ...place, arena: true, ...(radiusKm ? { radiusKm } : {}) }).messages.map((m) => m.text).sort();
  assert.deepEqual(read(), ["A quiet public garden."], "without a radius only the small box around the player");
  assert.deepEqual(read(1), ["A quiet public garden."]);
  assert.deepEqual(read(25), ["A quiet public garden.", "Rokycany square."]);
  assert.deepEqual(read(100), ["A quiet public garden.", "Prague crew.", "Rokycany square."]);
  const far = f.social.list(f.viewer, { ...place, arena: true, radiusKm: 25 }).messages.find((m) => m.text === "Rokycany square.");
  assert.ok(far.distance_m > 15_000 && far.distance_m < 17_000, String(far.distance_m));
  assert.throws(() => f.social.list(f.viewer, { ...place, arena: true, radiusKm: 7 }), /Pick a radius/);
  assert.throws(() => f.social.list(f.viewer, { ...place, arena: true, radiusKm: 500 }), /Pick a radius/);
});
