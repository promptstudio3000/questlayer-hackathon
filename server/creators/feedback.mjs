// Ratings and discussion on creator quests (owner request, 12 Nov 2026).
//
// An explorer who started a quest rates it once with 1 to 5 stars and may
// change the rating later. Anyone who can see the quest may write in its
// discussion. The quest list shows the average. A quest's public id is the
// same id the creators contract registers (`register_quest`), so a rating can
// be anchored on chain against that id: the explorer's own account writes the
// stars as a NEAR Social record (`createRatingAnchor` below) and `chain_ref`
// keeps where it landed.
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import {
  creatorAssert as fail,
  creatorKey as key,
  creatorText as text,
  createCreatorOperations,
} from "./operations.mjs";
import { publicLook } from "../public-look.mjs";
import { sanitizeImage } from "../note-media.mjs";
import {
  ensureModuleVersion,
  registerModuleSchema,
} from "../schema-compatibility.mjs";

export const CREATOR_FEEDBACK_SCHEMA = registerModuleSchema({
  name: "creator-feedback",
  version: 1,
  sql: `CREATE TABLE IF NOT EXISTS creator_quest_ratings(quest_id TEXT NOT NULL,player_id TEXT NOT NULL,stars INTEGER NOT NULL CHECK(stars BETWEEN 1 AND 5),created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL,chain_ref TEXT,PRIMARY KEY(quest_id,player_id));
CREATE TABLE IF NOT EXISTS creator_quest_comments(id TEXT PRIMARY KEY,quest_id TEXT NOT NULL,player_id TEXT NOT NULL,body TEXT NOT NULL,created_at INTEGER NOT NULL,removed_at INTEGER);
CREATE INDEX IF NOT EXISTS creator_quest_comments_quest ON creator_quest_comments(quest_id,created_at)`,
});
const ready = new WeakSet();
export function ensureCreatorFeedbackSchema(db) {
  if (ready.has(db)) return;
  ensureModuleVersion(db, CREATOR_FEEDBACK_SCHEMA);
  ready.add(db);
}

export const COMMENT_MAX = 500;
const COMMENTS_PER_DAY = 20;
const DAY_MS = 86_400_000;
export const QUEST_PHOTO = /^\/api\/creator-photos\/(quest_[a-f0-9-]{36}\.jpg)$/;

/** Validates the optional header photo of a quest draft. */
export function creatorPhoto(value) {
  fail(
    typeof value === "string" && QUEST_PHOTO.test(value),
    "Upload the quest photo again.",
    "CREATOR_INPUT",
    400,
  );
  return value;
}

/** What lists show: average to one decimal, how many rated, how many wrote. */
export function questFeedbackSummary(db, questId) {
  try {
    const r = db
      .prepare(
        "SELECT COUNT(*) AS n, COALESCE(SUM(stars),0) AS total FROM creator_quest_ratings WHERE quest_id=?",
      )
      .get(questId);
    const c = db
      .prepare(
        "SELECT COUNT(*) AS n FROM creator_quest_comments WHERE quest_id=? AND removed_at IS NULL",
      )
      .get(questId);
    return {
      average: r.n ? Math.round((r.total / r.n) * 10) / 10 : null,
      count: r.n,
      comments: c.n,
    };
  } catch {
    return { average: null, count: 0, comments: 0 }; // tables not created yet
  }
}

// Header photos creators attach to a quest. Same decoder as public notes:
// re-encoded JPEG without EXIF/GPS. A photo is only shown once the revision
// that names it passed review; an unused upload is just an unlisted file.
export class QuestPhotos {
  constructor(directory = ".data/media") {
    this.directory = resolve(directory);
    this.active = 0;
    this.uploads = new Map();
  }
  file(url) {
    const name = typeof url === "string" && url.match(QUEST_PHOTO)?.[1];
    return name ? resolve(this.directory, name) : null;
  }
  exists(url) {
    const file = this.file(url);
    return !!file && existsSync(file);
  }
  async store(player, data, now = Date.now()) {
    const day = Math.floor(now / DAY_MS);
    const used = this.uploads.get(player);
    const count = used?.day === day ? used.count : 0;
    fail(
      count < 20,
      "You uploaded many photos today. Try again tomorrow.",
      "CREATOR_RATE",
      429,
    );
    const clean = await sanitizeImage(data, this, {
      busy: "Image processing is busy. Please retry shortly.",
    });
    this.uploads.set(player, { day, count: count + 1 });
    mkdirSync(this.directory, { recursive: true, mode: 0o700 });
    const url = `/api/creator-photos/quest_${randomUUID()}.jpg`;
    writeFileSync(this.file(url), clean, { mode: 0o600, flag: "wx" });
    return url;
  }
}

export function createCreatorFeedback(db, { clock = Date.now, community }) {
  ensureCreatorFeedbackSchema(db);
  const operation = createCreatorOperations(db, { clock });
  const blocked = (a, b) =>
    !!db
      .prepare(
        "SELECT 1 FROM social_blocks WHERE (actor_id=? AND target_id=?) OR (actor_id=? AND target_id=?)",
      )
      .get(a, b, b, a);
  const started = (actor, questId) =>
    !!db
      .prepare(
        "SELECT 1 FROM creator_participations WHERE quest_id=? AND participant=?",
      )
      .get(questId, actor);
  const author = (questId) =>
    db.prepare("SELECT author FROM creator_quests WHERE id=?").get(questId)
      ?.author ?? null;
  // A visible quest, or one the explorer already started (rights stay after closure).
  function visible(actor, questId) {
    key(questId);
    if (started(actor, questId)) return;
    community.publicQuest(actor, questId);
  }
  function view(actor, questId) {
    const owner = author(questId);
    const mine = db
      .prepare(
        "SELECT stars,chain_ref FROM creator_quest_ratings WHERE quest_id=? AND player_id=?",
      )
      .get(questId, actor);
    const rows = db
      .prepare(
        `SELECT c.id,c.player_id,c.body,c.created_at,p.name FROM creator_quest_comments c
         JOIN players p ON p.id=c.player_id
         WHERE c.quest_id=? AND c.removed_at IS NULL ORDER BY c.created_at DESC LIMIT 50`,
      )
      .all(questId);
    return {
      questId,
      rating: {
        ...questFeedbackSummary(db, questId),
        mine: mine?.stars ?? null,
        anchored: !!mine?.chain_ref,
        canRate: owner !== actor && started(actor, questId),
      },
      comments: rows
        .filter((row) => !blocked(actor, row.player_id))
        .map((row) => ({
          id: row.id,
          body: row.body,
          at: row.created_at,
          author: {
            id: row.player_id,
            displayName: row.name,
            look: publicLook(db, row.player_id),
            creator: row.player_id === owner,
          },
          canRemove: row.player_id === actor || owner === actor,
        })),
    };
  }
  return {
    read(actor, questId) {
      key(actor);
      visible(actor, questId);
      return { domain: "demo", ...view(actor, questId) };
    },
    rate({ actor, operationId, questId, stars }) {
      key(questId);
      fail(
        Number.isInteger(stars) && stars >= 1 && stars <= 5,
        "Choose 1 to 5 stars.",
        "CREATOR_INPUT",
        400,
      );
      return operation("rateQuest", actor, operationId, { questId, stars }, (now) => {
        fail(
          author(questId) !== actor,
          "You cannot rate your own quest.",
          "CREATOR_INPUT",
          400,
        );
        fail(
          started(actor, questId),
          "Start this quest before rating it.",
          "CREATOR_NOT_STARTED",
          409,
        );
        db.prepare(
          `INSERT INTO creator_quest_ratings(quest_id,player_id,stars,created_at,updated_at) VALUES (?,?,?,?,?)
           ON CONFLICT(quest_id,player_id) DO UPDATE SET stars=excluded.stars,updated_at=excluded.updated_at,chain_ref=NULL`,
        ).run(questId, actor, stars, now, now);
        return { questId, stars, rating: questFeedbackSummary(db, questId) };
      });
    },
    comment({ actor, operationId, questId, body }) {
      const clean = text(body, COMMENT_MAX);
      return operation("commentQuest", actor, operationId, { questId, body: clean }, (now) => {
        visible(actor, questId);
        const recent = db
          .prepare(
            "SELECT COUNT(*) AS n FROM creator_quest_comments WHERE player_id=? AND created_at>?",
          )
          .get(actor, now - DAY_MS).n;
        fail(
          recent < COMMENTS_PER_DAY,
          "You wrote a lot today. Try again tomorrow.",
          "CREATOR_RATE",
          429,
        );
        const id = `qc_${randomUUID()}`;
        db.prepare(
          "INSERT INTO creator_quest_comments(id,quest_id,player_id,body,created_at) VALUES (?,?,?,?,?)",
        ).run(id, questId, actor, clean, now);
        return { questId, commentId: id };
      });
    },
    removeComment({ actor, operationId, questId, commentId }) {
      key(questId);
      key(commentId);
      return operation("removeQuestComment", actor, operationId, { questId, commentId }, (now) => {
        const row = db
          .prepare(
            "SELECT player_id FROM creator_quest_comments WHERE id=? AND quest_id=? AND removed_at IS NULL",
          )
          .get(commentId, questId);
        fail(row, "This comment is already gone.", "CREATOR_NOT_FOUND", 404);
        fail(
          row.player_id === actor || author(questId) === actor,
          "Only the writer or the quest creator can remove a comment.",
          "CREATOR_FORBIDDEN",
          403,
        );
        db.prepare(
          "UPDATE creator_quest_comments SET removed_at=? WHERE id=?",
        ).run(now, commentId);
        return { questId, commentId };
      });
    },
  };
}

// ---- Ratings on chain ---------------------------------------------------------
// The explorer's own account keeps the stars as a public NEAR Social record at
// `<account>/questlayer/ratings/<quest id>`. Same flow as place records
// (server/gold-spend/social.mjs): the server quotes the exact `set` call, the
// account signs it (relayed for the invisible account) and confirm reads the
// chain back. `registry` names the creators contract where the same quest id is
// registered, when the host has one. Only the number is public, never a text.
export const RATING_RECORD_SCHEMA = "questlayer.rating/1";
export const RATING_KEY = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/;
const RATING_MUTATION = /^rating_[a-f0-9-]{36}$/;

export function parseRatingRecord(value, questId) {
  const fields = ["mutation_id", "quest_id", "registry", "schema", "stars", "updated_at"];
  return value &&
    typeof value === "object" &&
    Object.keys(value).sort().join() === fields.join() &&
    fields.every((f) => typeof value[f] === "string") &&
    value.schema === RATING_RECORD_SCHEMA &&
    value.quest_id === questId &&
    /^[1-5]$/.test(value.stars) &&
    RATING_MUTATION.test(value.mutation_id)
    ? value
    : null;
}

export function createRatingAnchor(
  db,
  socialRecords,
  { clock = Date.now, registry = "", network = "testnet" } = {},
) {
  const enabled = !!socialRecords;
  const mine = (player, questId) => {
    key(questId);
    // Lazy: a host with the Community off never gets creator tables.
    ensureCreatorFeedbackSchema(db);
    fail(
      enabled,
      "Public records are not enabled here.",
      "CREATOR_ANCHOR_DISABLED",
      503,
    );
    fail(
      RATING_KEY.test(questId),
      "This quest cannot carry a public rating.",
      "CREATOR_INPUT",
      400,
    );
    const row = db
      .prepare(
        "SELECT stars,chain_ref FROM creator_quest_ratings WHERE quest_id=? AND player_id=?",
      )
      .get(questId, player);
    fail(row, "Rate this quest first.", "CREATOR_NOT_FOUND", 404);
    return row;
  };
  const read = async (accountId, questId) => {
    const value = await socialRecords.reader.view(
      "get",
      { keys: [`${accountId}/questlayer/ratings/${questId}/**`] },
      true,
    );
    return parseRatingRecord(
      value?.[accountId]?.questlayer?.ratings?.[questId],
      questId,
    );
  };
  return {
    enabled,
    async prepare(player, accountId, { questId } = {}) {
      const row = mine(player, questId);
      const storage = await socialRecords.storage(accountId, true);
      fail(
        storage.publishEnabled,
        "Public records are temporarily unavailable.",
        "CREATOR_ANCHOR_DISABLED",
        503,
      );
      const record = {
        schema: RATING_RECORD_SCHEMA,
        quest_id: questId,
        registry,
        stars: String(row.stars),
        updated_at: String(clock()),
        mutation_id: `rating_${randomUUID()}`,
      };
      return {
        network,
        receiverId: socialRecords.contractId,
        accountId,
        methodName: "set",
        gas: "80000000000000",
        deposit: storage.deposit,
        key: questId,
        record,
        args: {
          data: { [accountId]: { questlayer: { ratings: { [questId]: record } } } },
        },
      };
    },
    async confirm(player, accountId, { questId, mutationId } = {}) {
      const row = mine(player, questId);
      fail(
        RATING_MUTATION.test(mutationId || ""),
        "Invalid record publication.",
        "CREATOR_INPUT",
        400,
      );
      const chain = await read(accountId, questId);
      // A changed rating clears chain_ref; only the current stars count.
      const confirmed =
        !!chain &&
        chain.mutation_id === mutationId &&
        chain.stars === String(row.stars);
      if (confirmed)
        db.prepare(
          "UPDATE creator_quest_ratings SET chain_ref=? WHERE quest_id=? AND player_id=? AND stars=?",
        ).run(
          `${accountId}/questlayer/ratings/${questId}#${mutationId}`,
          questId,
          player,
          row.stars,
        );
      return { confirmed, questId };
    },
  };
}
