// Public records on NEAR Social (W10.1): a player publishes a map note they
// already made public in the app as a record under their own SocialDB
// namespace, from their own account (relayed from the invisible account or a
// wallet). The server quotes the exact `set` call, derives a content address
// for the sanitized photo, pins it through an optional adapter with retries,
// confirms by reading the chain back and writes tombstones for removed notes.
// Permanence is disclosed before every write; hiding a record in the app does
// not erase copies elsewhere.
import { createHash } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { assert, id } from "../domain.mjs";
import { nearAccountId, assertTestnetRpc } from "../identity/near.mjs";
import { NativeContractReader } from "./reader.mjs";
import { SOCIAL_TESTNET, SOCIAL_CODE_HASH } from "./social-profile.mjs";
import {
  registerModuleSchema,
  ensureModuleVersion,
} from "../schema-compatibility.mjs";
import { NETWORK } from "./network.mjs";
import { moderationSuppression } from "../moderation.mjs";

export const SOCIAL_RECORDS_SCHEMA = registerModuleSchema({
  name: "social-records",
  version: 1,
  sql: `
CREATE TABLE IF NOT EXISTS social_record_media(
 image TEXT PRIMARY KEY,
 sha256 TEXT NOT NULL,
 cid TEXT NOT NULL,
 bytes INTEGER NOT NULL CHECK(bytes>0),
 state TEXT NOT NULL CHECK(state IN ('computed','pinning','pinned','mismatch','unavailable')),
 attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts>=0),
 run_after INTEGER NOT NULL DEFAULT 0,
 last_error TEXT,
 pinned_at INTEGER,
 updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS social_record_publications(
 note_id TEXT NOT NULL REFERENCES messages(id),
 mutation_id TEXT NOT NULL,
 account_id TEXT NOT NULL,
 kind TEXT NOT NULL CHECK(kind IN ('note','tombstone')),
 record TEXT NOT NULL CHECK(json_valid(record)),
 state TEXT NOT NULL CHECK(state IN ('prepared','confirmed')),
 prepared_at INTEGER NOT NULL,
 confirmed_at INTEGER,
 PRIMARY KEY(note_id,mutation_id)
);
CREATE INDEX IF NOT EXISTS social_record_publications_note ON social_record_publications(note_id,state,prepared_at)`,
});

const STORAGE_DEPOSIT = 5n * 10n ** 22n;
const NOTE_ID = /^message_[a-f0-9-]{36}$/;
const MUTATION_ID = /^record_[a-f0-9-]{36}$/;
const backoff = (attempts) =>
  Math.min(3600000, 30000 * 2 ** Math.min(attempts, 7));
const RFC4648 = "abcdefghijklmnopqrstuvwxyz234567";

// CIDv1, raw codec (0x55), sha2-256 multihash, base32 lower without padding.
// The same bytes always produce the same `ipfs://b…` address, pinned or not.
export function rawCid(bytes) {
  const digest = createHash("sha256").update(bytes).digest();
  const cid = Buffer.concat([Buffer.from([0x01, 0x55, 0x12, 0x20]), digest]);
  let bits = 0,
    value = 0,
    out = "b";
  for (const byte of cid) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += RFC4648[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += RFC4648[(value << (5 - bits)) & 31];
  return { cid: out, sha256: digest.toString("hex") };
}
export function parsePublicNote(value) {
  if (!value || typeof value !== "object") return null;
  const fields = [
    "schema",
    "note_id",
    "state",
    "text",
    "lat",
    "lng",
    "anchor",
    "author_fix",
    "image",
    "image_sha256",
    "created_at",
    "updated_at",
    "mutation_id",
  ];
  const ok =
    Object.keys(value).sort().join("|") === fields.slice().sort().join("|") &&
    fields.every((f) => typeof value[f] === "string") &&
    value.schema === "1" &&
    NOTE_ID.test(value.note_id) &&
    ["published", "removed"].includes(value.state) &&
    MUTATION_ID.test(value.mutation_id);
  return ok ? value : null;
}

// Kubo-style `add` adapter: one raw leaf so the returned CID equals ours.
export function httpPinAdapter({ url, token = "", fetchImpl = fetch } = {}) {
  if (!url) return null;
  return {
    name: new URL(url).host,
    async pin(bytes, expectedCid) {
      const form = new FormData();
      form.append(
        "file",
        new Blob([bytes], { type: "image/jpeg" }),
        "note.jpg",
      );
      const target = new URL(url);
      for (const [k, v] of Object.entries({
        "cid-version": "1",
        "raw-leaves": "true",
        hash: "sha2-256",
        chunker: "size-1048576",
        pin: "true",
      }))
        target.searchParams.set(k, v);
      const response = await fetchImpl(target, {
        method: "POST",
        body: form,
        headers: token ? { authorization: `Bearer ${token}` } : {},
        signal: AbortSignal.timeout(30000),
      });
      assert(response.ok, `Pinning service answered ${response.status}.`, 503);
      const body = await response.json();
      const returned = body?.Hash || body?.cid || body?.Cid?.["/"];
      return {
        cid: typeof returned === "string" ? returned : "",
        matches: returned === expectedCid,
      };
    },
  };
}

export class NativeSocialRecords {
  constructor(
    db,
    provider,
    {
      media,
      clock = Date.now,
      pinAdapter = null,
      expectedCodeHash = SOCIAL_CODE_HASH,
    } = {},
  ) {
    this.db = db;
    this.provider = provider;
    this.media = media;
    this.clock = clock;
    this.pinAdapter = pinAdapter;
    this.expectedCodeHash = expectedCodeHash;
    this.reader = new NativeContractReader(provider, SOCIAL_TESTNET);
    ensureModuleVersion(db, SOCIAL_RECORDS_SCHEMA);
  }
  get contractId() {
    return SOCIAL_TESTNET;
  }
  note(noteId) {
    assert(NOTE_ID.test(noteId || ""), "Note not found.", 404);
    const row = this.db
      .prepare(
        "SELECT m.*, s.arena, s.state FROM messages m JOIN social_note_meta s ON s.note_id=m.id WHERE m.id=?",
      )
      .get(noteId);
    assert(row, "Note not found.", 404);
    return row;
  }
  // ---- Media addresses -------------------------------------------------------------
  mediaRecord(image) {
    if (!image) return null;
    const existing = this.db
      .prepare("SELECT * FROM social_record_media WHERE image=?")
      .get(image);
    if (existing) return existing;
    const file = this.media?.file(image);
    if (!file || !existsSync(file)) return null;
    const bytes = readFileSync(file);
    const { cid, sha256 } = rawCid(bytes);
    const now = this.clock();
    this.db
      .prepare(
        "INSERT INTO social_record_media(image,sha256,cid,bytes,state,run_after,updated_at) VALUES(?,?,?,?,?,?,?)",
      )
      .run(
        image,
        sha256,
        cid,
        bytes.length,
        this.pinAdapter ? "pinning" : "unavailable",
        now,
        now,
      );
    return this.db
      .prepare("SELECT * FROM social_record_media WHERE image=?")
      .get(image);
  }
  async pinDue({ limit = 4 } = {}) {
    if (!this.pinAdapter) return { pinned: 0, retried: 0, mismatched: 0 };
    const due = this.db
      .prepare(
        "SELECT * FROM social_record_media WHERE state='pinning' AND run_after<=? ORDER BY updated_at LIMIT ?",
      )
      .all(this.clock(), limit);
    let pinned = 0,
      retried = 0,
      mismatched = 0;
    for (const row of due) {
      const file = this.media?.file(row.image);
      if (!file || !existsSync(file)) {
        this.db
          .prepare(
            "UPDATE social_record_media SET state='unavailable',last_error='Source image is gone.',updated_at=? WHERE image=?",
          )
          .run(this.clock(), row.image);
        continue;
      }
      try {
        const result = await this.pinAdapter.pin(readFileSync(file), row.cid);
        if (result.matches) {
          pinned++;
          this.db
            .prepare(
              "UPDATE social_record_media SET state='pinned',pinned_at=?,last_error=NULL,updated_at=? WHERE image=?",
            )
            .run(this.clock(), this.clock(), row.image);
        } else {
          mismatched++;
          this.db
            .prepare(
              "UPDATE social_record_media SET state='mismatch',last_error=?,updated_at=? WHERE image=?",
            )
            .run(
              `Service returned ${result.cid || "no CID"}.`,
              this.clock(),
              row.image,
            );
        }
      } catch (error) {
        retried++;
        const attempts = row.attempts + 1;
        this.db
          .prepare(
            "UPDATE social_record_media SET attempts=?,run_after=?,last_error=?,updated_at=? WHERE image=?",
          )
          .run(
            attempts,
            this.clock() + backoff(attempts),
            String(error?.message || error).slice(0, 300),
            this.clock(),
            row.image,
          );
      }
    }
    return { pinned, retried, mismatched };
  }
  // ---- Reads -----------------------------------------------------------------------
  async storage(accountId, fresh) {
    await assertTestnetRpc(this.provider);
    const [balance, bounds, account] = await Promise.all([
      this.reader.view("storage_balance_of", { account_id: accountId }, fresh),
      this.reader.view("storage_balance_bounds", {}, fresh),
      this.provider.query({
        request_type: "view_account",
        account_id: this.contractId,
        finality: "final",
      }),
    ]);
    const available = balance ? BigInt(balance.available) : 0n;
    return {
      storage: balance
        ? { total: balance.total, available: balance.available }
        : null,
      deposit: available >= 2n * 10n ** 22n ? "1" : STORAGE_DEPOSIT.toString(),
      publishEnabled:
        account.code_hash === this.expectedCodeHash &&
        BigInt(bounds.min) <= STORAGE_DEPOSIT,
    };
  }
  async readRecord(accountId, noteId, fresh = false) {
    const value = await this.reader.view(
      "get",
      { keys: [`${accountId}/questlayer/notes/${noteId}/**`] },
      fresh,
    );
    return parsePublicNote(value?.[accountId]?.questlayer?.notes?.[noteId]);
  }
  async status(player, accountId, noteId) {
    nearAccountId(accountId);
    const note = this.note(noteId);
    assert(
      note.player_id === player,
      "Only the author can view this record.",
      403,
    );
    const [chain, publications] = await Promise.all([
      this.readRecord(accountId, noteId, true),
      Promise.resolve(
        this.db
          .prepare(
            "SELECT mutation_id,kind,state,prepared_at,confirmed_at FROM social_record_publications WHERE note_id=? AND account_id=? ORDER BY prepared_at DESC LIMIT 5",
          )
          .all(noteId, accountId),
      ),
    ]);
    const media = note.image ? this.mediaRecord(note.image) : null;
    return {
      network: NETWORK,
      contractId: this.contractId,
      accountId,
      noteId,
      localState: note.state,
      moderation: moderationSuppression(this.db, "record", noteId),
      chain,
      media: media
        ? {
            cid: `ipfs://${media.cid}`,
            sha256: media.sha256,
            state: media.state,
            pinnedAt: media.pinned_at,
          }
        : null,
      publications: publications.map((p) => ({ ...p })),
      permanence:
        "A published record stays readable on NEAR Social even after you remove the note in the app; removal writes a tombstone, it does not erase copies.",
    };
  }
  // ---- Quotes ----------------------------------------------------------------------
  async prepare(
    player,
    accountId,
    { noteId, kind = "note", publicConsent, permanenceAcknowledged } = {},
  ) {
    nearAccountId(accountId);
    assert(["note", "tombstone"].includes(kind), "Unknown record kind.", 400);
    assert(publicConsent === true, "Confirm that this record will be public.");
    assert(
      permanenceAcknowledged === true,
      "Acknowledge that a public record cannot be fully erased later.",
    );
    const note = this.note(noteId);
    assert(
      note.player_id === player,
      "Only the author can publish this note.",
      403,
    );
    const storage = await this.storage(accountId, true);
    assert(
      storage.publishEnabled,
      "Public records are temporarily unavailable.",
      503,
    );
    const current = await this.readRecord(accountId, noteId, true);
    let record;
    if (kind === "note") {
      assert(
        !moderationSuppression(this.db, "record", noteId),
        "This record was withdrawn by moderation and cannot be republished.",
        409,
      );
      assert(
        note.state === "published",
        "Only a note that is public in the app can be published.",
        409,
      );
      assert(
        !current || current.state === "removed" || current.text !== note.text,
        "This note is already published as a record.",
        409,
      );
      const media = this.mediaRecord(note.image);
      const fix = note.author_fix ? JSON.parse(note.author_fix) : null;
      record = {
        schema: "1",
        note_id: noteId,
        state: "published",
        text: note.text,
        lat: Number(note.lat).toFixed(5),
        lng: Number(note.lng).toFixed(5),
        anchor: note.arena ? "arena" : "map",
        author_fix: fix
          ? `${Number(fix.lat).toFixed(5)},${Number(fix.lng).toFixed(5)},${Math.round(fix.accuracy)}`
          : "",
        image: media ? `ipfs://${media.cid}` : "",
        image_sha256: media ? media.sha256 : "",
        created_at: String(note.created_at),
        updated_at: String(this.clock()),
        mutation_id: id("record"),
      };
    } else {
      assert(current, "There is no public record to remove.", 404);
      assert(
        current.state !== "removed",
        "This record is already marked removed.",
        409,
      );
      record = {
        ...current,
        state: "removed",
        text: "",
        lat: "",
        lng: "",
        author_fix: "",
        image: "",
        image_sha256: "",
        updated_at: String(this.clock()),
        mutation_id: id("record"),
      };
    }
    this.db
      .prepare(
        "INSERT INTO social_record_publications(note_id,mutation_id,account_id,kind,record,state,prepared_at) VALUES(?,?,?,?,?,'prepared',?)",
      )
      .run(
        noteId,
        record.mutation_id,
        accountId,
        kind,
        JSON.stringify(record),
        this.clock(),
      );
    return {
      network: NETWORK,
      receiverId: this.contractId,
      accountId,
      methodName: "set",
      gas: "80000000000000",
      deposit: storage.deposit,
      kind,
      record,
      args: {
        data: { [accountId]: { questlayer: { notes: { [noteId]: record } } } },
      },
      permanence:
        "This writes a public, permanent record under your account on NEAR Social.",
    };
  }
  async confirm(player, accountId, { noteId, mutationId } = {}) {
    nearAccountId(accountId);
    assert(MUTATION_ID.test(mutationId || ""), "Invalid record publication.");
    const note = this.note(noteId);
    assert(
      note.player_id === player,
      "Only the author can confirm this record.",
      403,
    );
    const prepared = this.db
      .prepare(
        "SELECT * FROM social_record_publications WHERE note_id=? AND mutation_id=? AND account_id=?",
      )
      .get(noteId, mutationId, accountId);
    assert(prepared, "This record was not prepared here.", 404);
    const chain = await this.readRecord(accountId, noteId, true);
    const confirmed = !!chain && chain.mutation_id === mutationId;
    if (confirmed && prepared.state !== "confirmed")
      this.db
        .prepare(
          "UPDATE social_record_publications SET state='confirmed',confirmed_at=? WHERE note_id=? AND mutation_id=?",
        )
        .run(this.clock(), noteId, mutationId);
    return { confirmed, chain, kind: prepared.kind };
  }
  workerStatus() {
    const media = Object.fromEntries(
      this.db
        .prepare(
          "SELECT state, COUNT(*) AS n FROM social_record_media GROUP BY state",
        )
        .all()
        .map((r) => [r.state, r.n]),
    );
    const records = Object.fromEntries(
      this.db
        .prepare(
          "SELECT state, COUNT(*) AS n FROM social_record_publications GROUP BY state",
        )
        .all()
        .map((r) => [r.state, r.n]),
    );
    return {
      contractId: this.contractId,
      pinning: this.pinAdapter ? this.pinAdapter.name : "not-configured",
      media,
      records,
    };
  }
}

export function startPinWorker(records, { intervalMs = 60000 } = {}) {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await records.pinDue();
    } catch (error) {
      console.error("Pin worker:", error?.message || error);
    } finally {
      running = false;
    }
  };
  const timer = setInterval(tick, intervalMs);
  return { stop: async () => clearInterval(timer), tick };
}

// Player routes; the parent server authenticates and owns the response helpers.
export function createSocialRecordRoutes(records) {
  return {
    async handle(
      req,
      res,
      url,
      { player, body, respond, assert: check, linkedAccount },
    ) {
      const path = url.pathname,
        method = req.method || "GET";
      if (!path.startsWith("/api/native/records")) return false;
      check(
        records,
        "Public records are not configured on this host.",
        503,
        "RECORDS_DISABLED",
      );
      const account = (requested) => {
        const linked = requested || linkedAccount(player);
        check(
          linked,
          "Your explorer account is still being prepared.",
          409,
          "ACCOUNT_NOT_READY",
        );
        const accountId = nearAccountId(linked);
        check(
          linkedAccount(player, accountId),
          "Link this account before publishing records.",
          403,
        );
        return accountId;
      };
      if (path === "/api/native/records" && method === "GET") {
        respond(
          res,
          await records.status(
            player,
            account(url.searchParams.get("accountId")),
            url.searchParams.get("note") || "",
          ),
        );
        return true;
      }
      if (path === "/api/native/records/prepare" && method === "POST") {
        const input = await body(req);
        respond(
          res,
          await records.prepare(player, account(input.accountId), input),
        );
        return true;
      }
      if (path === "/api/native/records/confirm" && method === "POST") {
        const input = await body(req);
        respond(
          res,
          await records.confirm(player, account(input.accountId), input),
        );
        return true;
      }
      return false;
    },
  };
}
