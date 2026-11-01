import { atomic } from "../database.mjs";
import { initSocialBlocks } from "../social-content.mjs";
import {
  creatorAssert as fail,
  creatorKey as key,
  creatorInteger as integer,
  creatorText as text,
  creatorFields as fields,
  createCreatorOperations,
} from "./operations.mjs";

// Public projections always select approved fields. Never serialize lifecycle rows.
export function createCreatorCommunity(db, { clock = Date.now } = {}) {
  fail(
    db
      .prepare(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name='creator_operations'",
      )
      .get(),
    "Initialize the creator lifecycle before Community.",
    "CREATOR_STORAGE",
    500,
  );
  initSocialBlocks(db);
  atomic(db, () =>
    db.exec(`
    CREATE TABLE IF NOT EXISTS creator_profiles(
      player_id TEXT PRIMARY KEY REFERENCES players(id), display_name TEXT NOT NULL,
      bio TEXT NOT NULL, public INTEGER NOT NULL CHECK(public IN(0,1)),
      version INTEGER NOT NULL CHECK(version>0), updated_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS creator_follows(
      follower TEXT NOT NULL REFERENCES players(id), creator TEXT NOT NULL REFERENCES players(id),
      created_at INTEGER NOT NULL, PRIMARY KEY(follower,creator), CHECK(follower!=creator));
    CREATE INDEX IF NOT EXISTS creator_follow_targets ON creator_follows(creator,follower);
  `),
  );
  const operation = createCreatorOperations(db, { clock });
  function player(id) {
    key(id);
    fail(
      db.prepare("SELECT 1 FROM players WHERE id=?").get(id),
      "Sign in to use Community.",
      "CREATOR_AUTH",
      401,
    );
  }
  function pagination({ limit = 20, cursor = "" } = {}) {
    integer(limit, 1);
    fail(
      limit <= 50,
      "Use a Community page of at most 50 entries.",
      "CREATOR_INPUT",
      400,
    );
    if (cursor !== "") key(cursor);
    return { limit, cursor };
  }
  function page(rows, limit, project) {
    const hasMore = rows.length > limit;
    const visible = rows.slice(0, limit);
    return {
      domain: "demo",
      items: visible.map(project),
      nextCursor: hasMore ? visible.at(-1).id : null,
    };
  }
  // A bilateral block hides discovery in both directions, independent of who set it.
  const unblocked = (column) => `NOT EXISTS(SELECT 1 FROM social_blocks b WHERE
    (b.actor_id=:viewer AND b.target_id=${column}) OR (b.target_id=:viewer AND b.actor_id=${column}))`;
  const profileView = (row) => ({
    id: row.id,
    displayName: row.display_name,
    bio: row.bio,
  });
  const creationView = (row) => ({
    id: row.id,
    state: row.state,
    version: row.version,
    latestRevision: row.latest_revision,
    latestState: row.latest_state,
    latestReviewReason: row.latest_review_reason ?? null,
    publishedRevision: row.published_revision,
    draft: JSON.parse(row.content),
    lockedXp: row.released_at === null ? (row.commitment_xp ?? 0) : 0,
    openParticipations: row.open_participations,
  });
  const questView = (row) => ({
    id: row.id,
    revision: row.published_revision,
    title: row.title,
    description: row.description,
    ...(row.requirement ? { requirement: JSON.parse(row.requirement) } : {}),
    ...(row.place ? { place: JSON.parse(row.place) } : {}),
    creator: { id: row.author, displayName: row.display_name },
    access: "free",
    rewardStatus: "not-configured",
    domain: "demo",
  });
  const approvedColumns = `q.id,q.author,q.published_revision,p.display_name,
    json_extract(r.content,'$.title') AS title,json_extract(r.content,'$.description') AS description,json_extract(r.content,'$.requirement') AS requirement,json_extract(r.content,'$.place') AS place`;
  const approvedJoins = `FROM creator_quests q
    JOIN creator_profiles p ON p.player_id=q.author AND p.public=1
    JOIN creator_revisions r ON r.quest_id=q.id AND r.revision=q.published_revision AND r.state='approved'`;

  function profile(actor, creatorId) {
    player(actor);
    key(creatorId);
    const row = db
      .prepare(
        `SELECT p.player_id AS id,p.display_name,p.bio FROM creator_profiles p
      WHERE p.player_id=:creator AND p.public=1 AND ${unblocked("p.player_id")}`,
      )
      .get({ viewer: actor, creator: creatorId });
    fail(row, "Creator profile not found.", "CREATOR_NOT_FOUND", 404);
    return {
      domain: "demo",
      ...profileView(row),
      following: !!db
        .prepare("SELECT 1 FROM creator_follows WHERE follower=? AND creator=?")
        .get(actor, creatorId),
    };
  }
  function listQuests(actor, options = {}) {
    player(actor);
    const { limit, cursor } = pagination(options);
    const { creatorId = null, followingOnly = false } = options;
    if (creatorId !== null) key(creatorId);
    fail(
      typeof followingOnly === "boolean",
      "Choose a valid Following filter.",
      "CREATOR_INPUT",
      400,
    );
    const rows = db
      .prepare(
        `SELECT ${approvedColumns} ${approvedJoins}
      WHERE q.state='published' AND q.id>:cursor AND ${unblocked("q.author")}
      AND (:creator IS NULL OR q.author=:creator)
      AND (:following=0 OR EXISTS(SELECT 1 FROM creator_follows f WHERE f.follower=:viewer AND f.creator=q.author))
      ORDER BY q.id LIMIT :take`,
      )
      .all({
        viewer: actor,
        cursor,
        creator: creatorId,
        following: Number(followingOnly),
        take: limit + 1,
      });
    return page(rows, limit, questView);
  }
  return {
    profile,
    listQuests,
    publicQuest(actor, questId) {
      player(actor);
      key(questId);
      const row = db
        .prepare(
          `SELECT ${approvedColumns} ${approvedJoins}
        WHERE q.id=:quest AND q.state='published' AND ${unblocked("q.author")}`,
        )
        .get({ viewer: actor, quest: questId });
      fail(row, "Creator quest not found.", "CREATOR_NOT_FOUND", 404);
      return questView(row);
    },
    listCreators(actor, options = {}) {
      player(actor);
      const { limit, cursor } = pagination(options);
      const rows = db
        .prepare(
          `SELECT p.player_id AS id,p.display_name,p.bio FROM creator_profiles p
        WHERE p.public=1 AND p.player_id>:cursor AND ${unblocked("p.player_id")}
        ORDER BY p.player_id LIMIT :take`,
        )
        .all({ viewer: actor, cursor, take: limit + 1 });
      return page(rows, limit, profileView);
    },
    myCreations(actor, options = {}) {
      player(actor);
      const { limit, cursor } = pagination(options);
      const rows = db
        .prepare(
          `SELECT q.id,q.state,q.version,q.latest_revision,q.published_revision,r.content,r.state AS latest_state,r.reason AS latest_review_reason,
        c.amount AS commitment_xp,c.released_at,
        (SELECT count(*) FROM creator_participations a WHERE a.quest_id=q.id AND a.state='open') AS open_participations
        FROM creator_quests q JOIN creator_revisions r ON r.quest_id=q.id AND r.revision=q.latest_revision
        LEFT JOIN creator_xp_commitments c ON c.quest_id=q.id
        WHERE q.author=:viewer AND q.id>:cursor ORDER BY q.id LIMIT :take`,
        )
        .all({ viewer: actor, cursor, take: limit + 1 });
      return page(rows, limit, creationView);
    },
    myCreation(actor, questId) {
      player(actor);
      key(questId);
      const row = db
        .prepare(
          `SELECT q.id,q.state,q.version,q.latest_revision,q.published_revision,r.content,r.state AS latest_state,r.reason AS latest_review_reason,
        c.amount AS commitment_xp,c.released_at,
        (SELECT count(*) FROM creator_participations a WHERE a.quest_id=q.id AND a.state='open') AS open_participations
        FROM creator_quests q JOIN creator_revisions r ON r.quest_id=q.id AND r.revision=q.latest_revision
        LEFT JOIN creator_xp_commitments c ON c.quest_id=q.id WHERE q.author=? AND q.id=?`,
        )
        .get(actor, questId);
      fail(row, "Your creator quest was not found.", "CREATOR_NOT_FOUND", 404);
      return creationView(row);
    },
    myProfile(actor) {
      player(actor);
      const row = db
        .prepare("SELECT * FROM creator_profiles WHERE player_id=?")
        .get(actor);
      return row
        ? {
            id: actor,
            displayName: row.display_name,
            bio: row.bio,
            public: !!row.public,
            version: row.version,
          }
        : { id: actor, displayName: "", bio: "", public: false, version: 0 };
    },
    myParticipation(actor, questId) {
      player(actor);
      key(questId);
      const row = db
        .prepare(
          `SELECT a.quest_id,a.revision,a.state,q.state AS quest_state,q.author,r.content,
        CASE WHEN p.public=1 AND ${unblocked("q.author")} THEN p.display_name ELSE NULL END AS creator_display_name
        FROM creator_participations a JOIN creator_revisions r ON r.quest_id=a.quest_id AND r.revision=a.revision
        JOIN creator_quests q ON q.id=a.quest_id LEFT JOIN creator_profiles p ON p.player_id=q.author
        WHERE a.quest_id=:quest AND a.participant=:viewer`,
        )
        .get({ quest: questId, viewer: actor });
      fail(
        row,
        "Your quest participation was not found.",
        "CREATOR_NOT_FOUND",
        404,
      );
      // Existing rights remain accessible privately even after closure, profile hiding or a block.
      return {
        domain: "demo",
        questId: row.quest_id,
        creator: { id: row.author, displayName: row.creator_display_name },
        revision: row.revision,
        state: row.state,
        questState: row.quest_state,
        content: JSON.parse(row.content),
        rewardStatus: "not-configured",
      };
    },
    myParticipations(actor, options = {}) {
      player(actor);
      const { limit, cursor } = pagination(options);
      const rows = db
        .prepare(
          `SELECT a.quest_id AS id,a.quest_id,a.revision,a.state,q.state AS quest_state,q.author,r.content,
        CASE WHEN p.public=1 AND ${unblocked("q.author")} THEN p.display_name ELSE NULL END AS creator_display_name
        FROM creator_participations a JOIN creator_revisions r ON r.quest_id=a.quest_id AND r.revision=a.revision
        JOIN creator_quests q ON q.id=a.quest_id LEFT JOIN creator_profiles p ON p.player_id=q.author
        WHERE a.participant=:viewer AND a.quest_id>:cursor ORDER BY a.quest_id LIMIT :take`,
        )
        .all({ viewer: actor, cursor, take: limit + 1 });
      return page(rows, limit, (row) => ({
        id: row.quest_id,
        domain: "demo",
        questId: row.quest_id,
        creator: { id: row.author, displayName: row.creator_display_name },
        revision: row.revision,
        state: row.state,
        questState: row.quest_state,
        content: JSON.parse(row.content),
        rewardStatus: "not-configured",
      }));
    },
    saveProfile({
      actor,
      operationId,
      expectedVersion,
      profile: input,
      publicConsent,
    }) {
      fields(input, ["displayName", "bio", "public"]);
      const validated = {
        displayName: text(input.displayName, 80),
        bio: text(input.bio, 1000, { optional: true }),
        public: input.public,
      };
      fail(
        typeof validated.public === "boolean" &&
          typeof publicConsent === "boolean",
        "Choose profile visibility and consent.",
        "CREATOR_INPUT",
        400,
      );
      fail(
        !validated.public || publicConsent,
        "Confirm public profile publication first.",
        "CREATOR_CONSENT",
        400,
      );
      integer(expectedVersion);
      return operation(
        "saveProfile",
        actor,
        operationId,
        { expectedVersion, profile: validated, publicConsent },
        (now) => {
          player(actor);
          const old = db
            .prepare("SELECT version FROM creator_profiles WHERE player_id=?")
            .get(actor);
          fail(
            (old?.version ?? 0) === expectedVersion,
            "The creator profile changed. Refresh before saving.",
            "CREATOR_STALE",
          );
          db.prepare(
            `INSERT INTO creator_profiles VALUES (?,?,?,?,?,?) ON CONFLICT(player_id)
          DO UPDATE SET display_name=excluded.display_name,bio=excluded.bio,public=excluded.public,version=excluded.version,updated_at=excluded.updated_at`,
          ).run(
            actor,
            validated.displayName,
            validated.bio,
            Number(validated.public),
            integer(expectedVersion + 1, 1),
            now,
          );
          return {
            profile: { id: actor, ...validated, version: expectedVersion + 1 },
          };
        },
      );
    },
    setFollowing({ actor, operationId, creatorId, following }) {
      key(creatorId);
      fail(
        typeof following === "boolean",
        "Choose a Following state.",
        "CREATOR_INPUT",
        400,
      );
      return operation(
        "setFollowing",
        actor,
        operationId,
        { creatorId, following },
        (now) => {
          player(actor);
          fail(
            actor !== creatorId,
            "You cannot follow yourself.",
            "CREATOR_INPUT",
            400,
          );
          if (following) {
            profile(actor, creatorId);
            db.prepare(
              "INSERT OR IGNORE INTO creator_follows VALUES (?,?,?)",
            ).run(actor, creatorId, now);
          } else
            db.prepare(
              "DELETE FROM creator_follows WHERE follower=? AND creator=?",
            ).run(actor, creatorId);
          return { creatorId, following };
        },
      );
    },
  };
}
