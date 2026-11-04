// Public note records on NEAR Social: quotes, media addresses, pinning and
// confirmation against a fake chain, with the app-hosted media directory.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase, createPlayer } from "../server/database.mjs";
import { SocialContent } from "../server/social-content.mjs";
import { NoteMedia } from "../server/note-media.mjs";
import {
  NativeSocialRecords,
  rawCid,
  parsePublicNote,
  httpPinAdapter,
  SOCIAL_RECORDS_SCHEMA,
} from "../server/native/social-records.mjs";
import { SOCIAL_CODE_HASH } from "../server/native/social-profile.mjs";
import {
  NETWORK,
  ACCOUNT_SUFFIX as SUFFIX,
  SOCIAL_CONTRACT_ID,
} from "../server/native/network.mjs";

const NOW = 1793500000000;
const ACCOUNT = `alice.players.questlayer${SUFFIX}`;
const PHOTO = Buffer.from("not really a jpeg but stable bytes for the address");

function fakeSocial({ balance = null, codeHash = SOCIAL_CODE_HASH } = {}) {
  const data = {};
  return {
    data,
    provider: {
      async viewNodeStatus() {
        return { chain_id: NETWORK, sync_info: { syncing: false } };
      },
      async query(q) {
        if (q.request_type === "view_account") return { code_hash: codeHash };
        const args = JSON.parse(
          Buffer.from(q.args_base64, "base64").toString(),
        );
        let value;
        if (q.method_name === "storage_balance_of") value = balance;
        else if (q.method_name === "storage_balance_bounds")
          value = { min: "20000000000000000000000", max: null };
        else if (q.method_name === "get") {
          const [key] = args.keys;
          const [account, , , noteId] = key.split("/");
          const record = data[account]?.questlayer?.notes?.[noteId];
          value = record
            ? { [account]: { questlayer: { notes: { [noteId]: record } } } }
            : {};
        } else throw Error("unknown view " + q.method_name);
        return {
          result: [...Buffer.from(JSON.stringify(value))],
          block_height: 1,
          logs: [],
        };
      },
    },
    // What the relayed `set` would leave on chain.
    apply(quote) {
      const [account] = Object.keys(quote.args.data);
      data[account] ??= { questlayer: { notes: {} } };
      Object.assign(
        data[account].questlayer.notes,
        quote.args.data[account].questlayer.notes,
      );
    },
  };
}
function fixture(t, { pinAdapter = null, balance } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "questlayer-records-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const db = openDatabase(":memory:");
  t.after(() => db.isOpen && db.close());
  new SocialContent(db);
  const media = new NoteMedia(join(dir, "media"));
  mkdirSync(media.directory, { recursive: true });
  const alice = createPlayer(db, "Alice", NOW),
    bob = createPlayer(db, "Bob", NOW);
  db.prepare("INSERT INTO wallet_links VALUES(?,?,?)").run(ACCOUNT, alice, NOW);
  const chain = fakeSocial({ balance });
  let now = NOW;
  const records = new NativeSocialRecords(db, chain.provider, {
    media,
    clock: () => now,
    pinAdapter,
  });
  const note = ({
    image = null,
    arena = 0,
    fix = null,
    player = alice,
    text = "Hidden bench with a view of the river.",
  } = {}) => {
    const id = `message_${crypto.randomUUID()}`;
    let url = null;
    if (image) {
      url = `/api/media/image_${crypto.randomUUID()}.jpg`;
      writeFileSync(media.file(url), image);
    }
    db.prepare(
      "INSERT INTO messages(id,player_id,text,lat,lng,image,author_fix,created_at) VALUES(?,?,?,?,?,?,?,?)",
    ).run(
      id,
      player,
      text,
      49.7475123,
      13.3775987,
      url,
      fix ? JSON.stringify(fix) : null,
      NOW - 1000,
    );
    db.prepare("INSERT INTO social_note_meta VALUES(?,?,'published',?)").run(
      id,
      arena,
      NOW - 1000,
    );
    return { id, url };
  };
  return {
    db,
    media,
    alice,
    bob,
    chain,
    records,
    note,
    advance: (ms) => (now += ms),
  };
}

test("content addresses match the IPFS raw-leaf CIDv1 convention", () => {
  assert.equal(
    rawCid(Buffer.from("hello world")).cid,
    "bafkreifzjut3te2nhyekklss27nh3k72ysco7y32koao5eei66wof36n5e",
  );
  assert.deepEqual(Object.keys(SOCIAL_RECORDS_SCHEMA.tables).sort(), [
    "social_record_media",
    "social_record_publications",
  ]);
});

test("a public note becomes a record under the author's namespace only, with the photo's content address and rounded anchors", async (t) => {
  const f = fixture(t);
  const n = f.note({
    image: PHOTO,
    fix: { lat: 49.74751234, lng: 13.37759876, accuracy: 7.4, timestamp: NOW },
  });
  const quote = await f.records.prepare(f.alice, ACCOUNT, {
    noteId: n.id,
    publicConsent: true,
    permanenceAcknowledged: true,
  });
  assert.equal(quote.receiverId, SOCIAL_CONTRACT_ID);
  assert.equal(quote.methodName, "set");
  assert.equal(quote.deposit, "50000000000000000000000");
  assert.deepEqual(Object.keys(quote.args.data), [ACCOUNT]);
  assert.deepEqual(Object.keys(quote.args.data[ACCOUNT].questlayer), ["notes"]);
  const r = quote.record;
  assert.equal(parsePublicNote(r), r);
  assert.equal(r.text, "Hidden bench with a view of the river.");
  assert.equal(r.lat, "49.74751");
  assert.equal(r.lng, "13.37760");
  assert.equal(r.anchor, "map");
  assert.equal(r.author_fix, "49.74751,13.37760,7");
  assert.equal(r.image, `ipfs://${rawCid(PHOTO).cid}`);
  assert.equal(r.image_sha256, rawCid(PHOTO).sha256);
  assert.match(quote.permanence, /permanent/);
  const media = f.db
    .prepare("SELECT state,bytes FROM social_record_media")
    .get();
  assert.equal(media.state, "unavailable");
  assert.equal(media.bytes, PHOTO.length);
  assert.ok(!JSON.stringify(quote).match(/player_id|secretKey|Bob/));
  // Confirmation waits for the chain, then records the publication once.
  let c = await f.records.confirm(f.alice, ACCOUNT, {
    noteId: n.id,
    mutationId: r.mutation_id,
  });
  assert.equal(c.confirmed, false);
  f.chain.apply(quote);
  c = await f.records.confirm(f.alice, ACCOUNT, {
    noteId: n.id,
    mutationId: r.mutation_id,
  });
  assert.equal(c.confirmed, true);
  assert.equal(c.chain.mutation_id, r.mutation_id);
  const status = await f.records.status(f.alice, ACCOUNT, n.id);
  assert.equal(status.chain.state, "published");
  assert.equal(status.publications[0].state, "confirmed");
  assert.equal(status.media.state, "unavailable");
  await assert.rejects(
    f.records.prepare(f.alice, ACCOUNT, {
      noteId: n.id,
      publicConsent: true,
      permanenceAcknowledged: true,
    }),
    /already published/,
  );
});

test("consent, permanence, authorship and app visibility gate every quote", async (t) => {
  const f = fixture(t);
  const n = f.note();
  const ok = {
    noteId: n.id,
    publicConsent: true,
    permanenceAcknowledged: true,
  };
  await assert.rejects(
    f.records.prepare(f.alice, ACCOUNT, { ...ok, publicConsent: false }),
    /public/,
  );
  await assert.rejects(
    f.records.prepare(f.alice, ACCOUNT, {
      ...ok,
      permanenceAcknowledged: undefined,
    }),
    /erased/,
  );
  await assert.rejects(
    f.records.prepare(f.bob, ACCOUNT, ok),
    /Only the author/,
  );
  await assert.rejects(
    f.records.prepare(f.alice, ACCOUNT, { ...ok, noteId: "message_nope" }),
    /Note not found/,
  );
  await assert.rejects(
    f.records.prepare(f.alice, ACCOUNT, { ...ok, kind: "tombstone" }),
    /no public record/,
  );
  f.db
    .prepare("UPDATE social_note_meta SET state='hidden' WHERE note_id=?")
    .run(n.id);
  await assert.rejects(
    f.records.prepare(f.alice, ACCOUNT, ok),
    /public in the app/,
  );
  const arena = f.note({ arena: 1 });
  const quote = await f.records.prepare(f.alice, ACCOUNT, {
    ...ok,
    noteId: arena.id,
  });
  assert.equal(quote.record.anchor, "arena");
  assert.equal(quote.record.author_fix, "");
  assert.equal(quote.record.image, "");
});

test("existing SocialDB storage lowers the deposit to one yocto; a tombstone keeps the id and blanks the content", async (t) => {
  const f = fixture(t, {
    balance: {
      total: "100000000000000000000000",
      available: "30000000000000000000000",
    },
  });
  const n = f.note();
  const ok = {
    noteId: n.id,
    publicConsent: true,
    permanenceAcknowledged: true,
  };
  const quote = await f.records.prepare(f.alice, ACCOUNT, ok);
  assert.equal(quote.deposit, "1");
  f.chain.apply(quote);
  const tomb = await f.records.prepare(f.alice, ACCOUNT, {
    ...ok,
    kind: "tombstone",
  });
  assert.equal(tomb.kind, "tombstone");
  assert.equal(tomb.record.state, "removed");
  assert.equal(tomb.record.text, "");
  assert.equal(tomb.record.note_id, n.id);
  assert.equal(tomb.record.created_at, quote.record.created_at);
  assert.notEqual(tomb.record.mutation_id, quote.record.mutation_id);
  f.chain.apply(tomb);
  await assert.rejects(
    f.records.prepare(f.alice, ACCOUNT, { ...ok, kind: "tombstone" }),
    /already marked removed/,
  );
  // After a tombstone the note may be published again.
  const again = await f.records.prepare(f.alice, ACCOUNT, ok);
  assert.equal(again.record.state, "published");
});

test("pinning retries with backoff, accepts only a matching CID and gives up on a vanished file", async (t) => {
  const calls = [];
  let mode = "fail";
  const adapter = {
    name: "fake-pin",
    async pin(bytes, cid) {
      calls.push(cid);
      if (mode === "fail") throw Error("ECONNRESET");
      return {
        cid: mode === "ok" ? cid : "bafkreiother",
        matches: mode === "ok",
      };
    },
  };
  const f = fixture(t, { pinAdapter: adapter });
  const a = f.note({ image: PHOTO }),
    b = f.note({ image: Buffer.from("second photo") });
  const ok = { publicConsent: true, permanenceAcknowledged: true };
  await f.records.prepare(f.alice, ACCOUNT, { ...ok, noteId: a.id });
  await f.records.prepare(f.alice, ACCOUNT, { ...ok, noteId: b.id });
  assert.deepEqual(await f.records.pinDue(), {
    pinned: 0,
    retried: 2,
    mismatched: 0,
  });
  assert.deepEqual(await f.records.pinDue(), {
    pinned: 0,
    retried: 0,
    mismatched: 0,
  });
  f.advance(61000);
  mode = "ok";
  rmSync(f.media.file(b.url));
  assert.deepEqual(await f.records.pinDue(), {
    pinned: 1,
    retried: 0,
    mismatched: 0,
  });
  const states = Object.fromEntries(
    f.db
      .prepare("SELECT image,state FROM social_record_media")
      .all()
      .map((r) => [r.image, r.state]),
  );
  assert.equal(states[a.url], "pinned");
  assert.equal(states[b.url], "unavailable");
  const c = f.note({ image: Buffer.from("third") });
  mode = "mismatch";
  await f.records.prepare(f.alice, ACCOUNT, { ...ok, noteId: c.id });
  assert.deepEqual(await f.records.pinDue(), {
    pinned: 0,
    retried: 0,
    mismatched: 1,
  });
  assert.equal(f.records.workerStatus().media.mismatch, 1);
  assert.equal(calls.length, 4);
});

test("the HTTP pin adapter posts one raw leaf and compares the returned hash", async () => {
  let seen;
  const adapter = httpPinAdapter({
    url: "https://pin.example.test/api/v0/add",
    token: "secret-token",
    fetchImpl: async (url, init) => {
      seen = {
        url: String(url),
        auth: init.headers.authorization,
        body: init.body,
      };
      return { ok: true, json: async () => ({ Hash: rawCid(PHOTO).cid }) };
    },
  });
  assert.equal(adapter.name, "pin.example.test");
  const r = await adapter.pin(PHOTO, rawCid(PHOTO).cid);
  assert.equal(r.matches, true);
  assert.match(seen.url, /cid-version=1/);
  assert.match(seen.url, /raw-leaves=true/);
  assert.match(seen.url, /chunker=size-1048576/);
  assert.equal(seen.auth, "Bearer secret-token");
  assert.ok(seen.body instanceof FormData);
  assert.equal(httpPinAdapter({ url: "" }), null);
});
