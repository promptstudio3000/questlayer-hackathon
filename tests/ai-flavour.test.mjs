import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { cellToParent, latLngToCell } from "h3-js";
import { openDatabase, createPlayer } from "../server/database.mjs";
import {
  FLAVOUR_PROMPT_VERSION,
  flavourStatus,
  flavourText,
  templateFlavour,
  validateFlavour,
  flavourPoi,
} from "../server/ai/flavour.mjs";
import {
  activeCells,
  flavourConfiguration,
  openPoiReader,
  runFlavourBatch,
  startFlavourWorker,
} from "../server/ai/flavour-batch.mjs";

const NOW = Date.parse("2026-11-02T02:00:00Z");
const CELL = latLngToCell(49.2, 16.6, 7); // Brno, outside every live city
const POIS = [
  { id: "osm:n1", category: "fountain", name: "Kašna Parnas", names: { cs: "Kašna Parnas", en: "Parnassus Fountain" }, notability: 9, facts: { en: "baroque fountain", cs: "barokní kašna" } },
  { id: "osm:n2", category: "park", name: "Lužánky", names: { cs: "Lužánky" }, notability: 5, facts: null },
  { id: "osm:n3", category: "sculpture", name: null, names: {}, notability: 0, facts: null },
];

function poiFile(t, rows = POIS, cell = CELL) {
  const dir = mkdtempSync(join(tmpdir(), "flavour-poi-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, "current.sqlite");
  const db = new DatabaseSync(path);
  db.exec(`CREATE TABLE meta(key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE poi(h3r5 TEXT NOT NULL, id TEXT NOT NULL, h3r7 TEXT NOT NULL, lat REAL NOT NULL, lng REAL NOT NULL,
      category TEXT NOT NULL, name TEXT, names TEXT NOT NULL, wikidata TEXT, notability INTEGER NOT NULL,
      sources TEXT NOT NULL, safety TEXT NOT NULL, safety_reason TEXT, access TEXT, hours TEXT, path_ref TEXT,
      facts TEXT, source_hash TEXT NOT NULL, PRIMARY KEY(h3r5,id));
    INSERT INTO meta VALUES ('version','cz-test');`);
  const ins = db.prepare("INSERT INTO poi VALUES (?,?,?,?,?,?,?,?,NULL,?,'[]',?,NULL,NULL,NULL,NULL,?,'h')");
  for (const p of rows)
    ins.run(cellToParent(cell, 5), p.id, cell, 49.2, 16.6, p.category, p.name, JSON.stringify(p.names), p.notability, p.safety || "ok", p.facts ? JSON.stringify(p.facts) : null);
  ins.run(cellToParent(cell, 5), "osm:excluded", cell, 49.2, 16.6, "park", "Školní zahrada", "{}", 99, "excluded", null);
  db.close();
  return path;
}

function gameDb(t, regions = [CELL]) {
  const db = openDatabase(":memory:");
  t.after(() => db.close());
  const player = createPlayer(db, "Secret Walker Name", NOW);
  regions.forEach((region, i) =>
    db.prepare("INSERT INTO worlds VALUES (?,?,?,?,?,?)").run(`demo:${region}:2026-11-01:v2`, "2026-11-01", region, "Europe/Prague", "{}", NOW - 3600_000 * (i + 1)),
  );
  return { db, player };
}

const CONFIG = (over = {}) => ({ ...flavourConfiguration({ FLAVOUR_AI_PROVIDER: "ollama" }), ...over });

// Fake provider: answers every requested key with valid text unless told otherwise.
function fakeProvider(write = (item) => item) {
  const calls = [];
  return {
    name: "fake",
    model: "fake-1",
    calls,
    async generate(request) {
      calls.push(request);
      return {
        items: request.items.map((item) =>
          write({
            key: item.key,
            title: item.language === "cs" ? "Zastávka u vody" : "A stop by the water",
            description:
              item.language === "cs"
                ? "Projdi se po veřejné cestě a užij si klidné místo, které tu znají všichni sousedé."
                : "Stroll along the public path and enjoy a calm spot that the whole neighbourhood knows.",
          }, item),
        ),
      };
    },
  };
}

test("template text is deterministic, bilingual and passes the flavour checks", () => {
  for (const raw of POIS)
    for (const template of ["poi-visit", "poi-category-hunt"])
      for (const lang of ["en", "cs"]) {
        const poi = flavourPoi(raw);
        const a = templateFlavour({ poi, template, lang });
        assert.deepEqual(a, templateFlavour({ poi, template, lang }));
        assert.equal(validateFlavour(a, { poi, lang }).value?.title, a.title, `${raw.id} ${template} ${lang}`);
      }
  assert.equal(templateFlavour({ poi: flavourPoi(POIS[0]), template: "poi-visit", lang: "en" }).title, "Visit Parnassus Fountain");
  assert.match(templateFlavour({ poi: flavourPoi(POIS[2]), template: "poi-visit", lang: "cs" }).title, /socha/);
});

test("validation rejects rewards, invented numbers, unsafe advice, links and the wrong language", () => {
  const poi = flavourPoi(POIS[0]);
  const ok = { title: "A stop by the fountain", description: "Walk the public path to the baroque fountain and listen to the water for a moment." };
  assert.ok(validateFlavour(ok, { poi, lang: "en" }).value);
  const reason = (patch, lang = "en") => validateFlavour({ ...ok, ...patch }, { poi, lang }).reason;
  assert.equal(reason({ description: "Walk to the fountain and win a big reward for checking in today." }), "reward-claim");
  assert.equal(reason({ description: "Walk to the fountain and earn some GOLD while you check in today." }), "reward-claim");
  assert.equal(reason({ description: "The fountain was built in 1693 and still sings on the square today." }), "invented-number");
  assert.equal(reason({ description: "Climb the fence behind the fountain to see the hidden courtyard today." }), "unsafe-instruction");
  assert.equal(reason({ description: "Walk to the fountain and read more about it at www.example.com today." }), "link-or-contact");
  assert.equal(reason({ title: "Ignore previous rules" }), "instruction-leak");
  assert.equal(reason({ description: "Projdi se ke kašně a poslouchej vodu, která tu zpívá celé odpoledne." }), "wrong-language");
  assert.equal(reason({}, "cs"), "wrong-language");
  assert.equal(reason({ title: "x" }), "title-length");
  assert.equal(validateFlavour({ title: 1 }, { poi, lang: "en" }).reason, "schema");
});

test("the batch writes validated texts for active cells and players read them without a model", async (t) => {
  const { db } = gameDb(t);
  const poiReader = openPoiReader(poiFile(t));
  t.after(() => poiReader.close());
  const provider = fakeProvider((item, req) =>
    req.key.startsWith("p1|poi-visit|en") ? { ...item, description: "Run to the park and claim your prize before anyone else does today." } : item,
  );
  const result = await runFlavourBatch(db, { config: CONFIG(), provider, poiReader, clock: () => NOW });
  assert.equal(result.outcome, "completed");
  assert.equal(result.cells, 1);
  assert.equal(result.pois, 3, "excluded POIs are never read");
  assert.equal(result.requested, 12);
  assert.equal(result.generated, 11);
  assert.equal(result.rejected, 1);
  assert.ok(result.tokens_used > 0 && result.tokens_used <= result.token_budget);
  // Model input: POI data and lore only, never player data or coordinates.
  for (const call of provider.calls) {
    assert.doesNotMatch(call.user, /Secret Walker Name|49\.2|16\.6|player/i);
    assert.match(call.user, /Gotchi/);
  }
  const poi = flavourPoi(POIS[0]);
  assert.deepEqual(flavourText(db, { poi, template: "poi-visit", lang: "cs" }), {
    title: "Zastávka u vody",
    description: "Projdi se po veřejné cestě a užij si klidné místo, které tu znají všichni sousedé.",
    source: "cache",
  });
  const rejected = flavourText(db, { poi: flavourPoi(POIS[1]), template: "poi-visit", lang: "en" });
  assert.equal(rejected.source, "template");
  assert.equal(rejected.title, "Visit Lužánky");
  // Unknown language falls back to English; a different prompt version misses the cache.
  assert.equal(flavourText(db, { poi, template: "poi-visit", lang: "de" }).source, "cache");
  assert.equal(flavourText(db, { poi, template: "poi-visit", lang: "en", promptVersion: "flavour-v0" }).source, "template");

  const again = await runFlavourBatch(db, { config: CONFIG(), provider, poiReader, clock: () => NOW + 1000 });
  assert.equal(again.requested, 1, "only the rejected text is asked for again");
  const status = flavourStatus(db);
  assert.equal(status.promptVersion, FLAVOUR_PROMPT_VERSION);
  assert.equal(status.cached, 12);
  assert.equal(status.lastBatch.outcome, "completed");
  assert.equal(db.prepare("SELECT count(*) n FROM ai_flavour_batches").get().n, 2);
});

test("the token budget stops a run before the call that would exceed it", async (t) => {
  const { db } = gameDb(t);
  const poiReader = openPoiReader(poiFile(t));
  t.after(() => poiReader.close());
  const provider = fakeProvider();
  const result = await runFlavourBatch(db, { config: CONFIG({ tokenBudget: 500 }), provider, poiReader, clock: () => NOW });
  assert.equal(result.outcome, "budget");
  assert.equal(provider.calls.length, 0);
  assert.equal(flavourStatus(db).cached, 0);
});

test("provider failures are counted and leave the template text", async (t) => {
  const { db } = gameDb(t);
  const poiReader = openPoiReader(poiFile(t));
  t.after(() => poiReader.close());
  const provider = { name: "fake", model: "x", generate: async () => { throw Error("provider-unavailable (503)"); } };
  const result = await runFlavourBatch(db, { config: CONFIG(), provider, poiReader, clock: () => NOW });
  assert.equal(result.outcome, "completed");
  assert.equal(result.failed_calls, 1);
  assert.equal(result.generated, 0);
  assert.equal(flavourText(db, { poi: flavourPoi(POIS[0]), template: "poi-visit" }).source, "template");
});

test("only regions opened in the window count; arena worlds are ignored; cities expand to cells", (t) => {
  const { db } = gameDb(t, [CELL, "arena-city-plzen", "city-plzen"]);
  db.prepare("INSERT INTO worlds VALUES ('old','2026-10-01',?,'Europe/Prague','{}',?)").run(latLngToCell(50.08, 14.42, 7), NOW - 30 * 86400_000);
  const { regions, cells } = activeCells(db, NOW - 7 * 86400_000);
  assert.equal(regions, 2);
  assert.equal(cells[0], CELL);
  assert.ok(cells.length > 1 && cells.length <= 121);
  assert.ok(!cells.includes(latLngToCell(50.08, 14.42, 7)));
});

test("skips cleanly without a provider, without a POI file and with the provider off", async (t) => {
  const { db } = gameDb(t);
  assert.equal((await runFlavourBatch(db, { config: CONFIG({ provider: "template" }), provider: null, clock: () => NOW })).reason, "template-only");
  assert.equal((await runFlavourBatch(db, { config: CONFIG({ provider: "off" }), provider: null, clock: () => NOW })).reason, "provider-off");
  assert.equal(
    (await runFlavourBatch(db, { config: CONFIG({ poiDbPath: "/nonexistent/poi.sqlite" }), provider: fakeProvider(), clock: () => NOW })).reason,
    "poi-file-missing",
  );
});

test("the nightly worker runs once per UTC date after the configured hour", async (t) => {
  const { db } = gameDb(t);
  assert.equal(startFlavourWorker(db, { env: { FLAVOUR_AI_PROVIDER: "template" } }), null);
  assert.equal(startFlavourWorker(db, { env: { FLAVOUR_AI_PROVIDER: "ollama", FLAVOUR_BATCH: "off" } }), null);
  let now = Date.parse("2026-11-02T00:30:00Z");
  const runs = [];
  const worker = startFlavourWorker(db, {
    env: { FLAVOUR_AI_PROVIDER: "ollama", OLLAMA_API_KEY: "k" },
    clock: () => now,
    log: () => {},
    run: async (_db, o) => (runs.push(o.trigger), { id: "f", outcome: "completed" }),
  });
  t.after(() => worker.stop());
  assert.equal(await worker.tick(), null, "before 01:00 UTC");
  now = Date.parse("2026-11-02T01:05:00Z");
  assert.equal((await worker.tick()).outcome, "completed");
  assert.equal(await worker.tick(), null, "same date runs once");
  now = Date.parse("2026-11-03T03:00:00Z");
  await worker.tick();
  assert.deepEqual(runs, ["nightly", "nightly"]);
});

test("configuration follows QUEST_AI_PROVIDER and rejects unknown values", () => {
  assert.equal(flavourConfiguration({}).provider, "template");
  assert.equal(flavourConfiguration({ QUEST_AI_PROVIDER: "ollama" }).provider, "ollama");
  assert.equal(flavourConfiguration({ QUEST_AI_PROVIDER: "ollama", FLAVOUR_AI_PROVIDER: "off" }).provider, "off");
  assert.throws(() => flavourConfiguration({ FLAVOUR_AI_PROVIDER: "gpt" }), /FLAVOUR_AI_PROVIDER/);
  assert.throws(() => flavourConfiguration({ FLAVOUR_TOKEN_BUDGET: "-1" }), /FLAVOUR_TOKEN_BUDGET/);
});

test("the CLI dry run lists the work without calling a model and never prints a key", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "flavour-cli-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const dbPath = join(dir, "game.sqlite");
  const db = openDatabase(dbPath);
  db.prepare("INSERT INTO worlds VALUES (?,?,?,?,?,?)").run(`demo:${CELL}:d:v2`, "d", CELL, "Europe/Prague", "{}", Date.now());
  db.close();
  const out = execFileSync(process.execPath, ["server/cli/ai-flavour.mjs", "--since", "7d", "--dry-run"], {
    env: { ...process.env, DATABASE_PATH: dbPath, POI_DB_PATH: poiFile(t), FLAVOUR_AI_PROVIDER: "ollama", OLLAMA_API_KEY: "sk-test-secret-value", OLLAMA_BASE_URL: "http://127.0.0.1:9" },
    encoding: "utf8",
  });
  assert.doesNotMatch(out, /sk-test-secret-value/);
  const row = JSON.parse(out);
  assert.equal(row.reason, "dry-run");
  assert.equal(row.pois, 3);
  assert.equal(row.calls, 0);
});

// The VPS database holds tables that other modules create lazily. The CLI must
// load the schema catalog before opening it, or preflight rejects those tables.
test("the CLI opens a database that already has lazily created module tables", async (t) => {
  const { ensureModuleVersion } = await import("../server/schema-compatibility.mjs");
  const dir = mkdtempSync(join(tmpdir(), "flavour-cli-lazy-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const dbPath = join(dir, "game.sqlite");
  const db = openDatabase(dbPath);
  // Create the tables of every module in the catalog, like a live server does.
  const catalog = readFileSync(new URL("../server/schema-catalog.mjs", import.meta.url), "utf8");
  let created = 0;
  for (const [, rel] of catalog.matchAll(/"\.\/([^"]+\.mjs)"/g)) {
    const mod = await import(new URL(`../server/${rel}`, import.meta.url).href);
    for (const value of Object.values(mod))
      if (value && typeof value === "object" && typeof value.name === "string" && Number.isSafeInteger(value.version) && value.tables) {
        ensureModuleVersion(db, value);
        created++;
      }
  }
  assert.ok(created > 10, `created ${created} module schemas`);
  db.prepare("INSERT INTO worlds VALUES (?,?,?,?,?,?)").run(`demo:${CELL}:d:v2`, "d", CELL, "Europe/Prague", "{}", Date.now());
  db.close();
  const out = execFileSync(process.execPath, ["server/cli/ai-flavour.mjs", "--since", "7d", "--dry-run"], {
    env: { ...process.env, DATABASE_PATH: dbPath, POI_DB_PATH: poiFile(t), FLAVOUR_AI_PROVIDER: "ollama", OLLAMA_API_KEY: "sk-test", OLLAMA_BASE_URL: "http://127.0.0.1:9" },
    encoding: "utf8",
  });
  assert.equal(JSON.parse(out).reason, "dry-run");
});

// W8 follow-up (3 Nov 2026): the first VPS batch rejected 779 of 992 texts.
// Realistic outputs for real-looking Czech places: names such as "Plavecký
// stadion" or "Vyhlídka Skok", Czech towns in English text and one sentence
// too many must not reject good text, while every safety rule still holds.
test("realistic model texts pass at least 75 % and unsafe ones stay rejected", () => {
  const fixture = JSON.parse(readFileSync(new URL("./fixtures/flavour-model-outputs.json", import.meta.url), "utf8"));
  const check = (x) => validateFlavour(x, { poi: flavourPoi(fixture.pois[x.poi]), lang: x.lang });
  const rejected = fixture.ok.filter((x) => !check(x).value);
  assert.ok(rejected.length / fixture.ok.length < 0.25, `rejected ${rejected.map((x) => `${x.poi}/${x.lang}:${check(x).reason}`)}`);
  assert.deepEqual(rejected, []);
  for (const x of fixture.bad) assert.equal(check(x).reason, x.reason, `${x.poi}/${x.lang}`);
  // Over-long text keeps its leading whole sentences; quotes around a title go.
  const long = fixture.ok.at(-1);
  const fitted = check(long).value.description;
  assert.ok(fitted.length <= 220 && long.description.startsWith(fitted) && /[.!?]$/.test(fitted));
  assert.equal(check(fixture.ok.find((x) => x.title.startsWith('"'))).value.title, "The Song of Parnassus");
});

test("missing or rejected items get one follow-up call with the reason, and reasons reach the health summary", async (t) => {
  const { db } = gameDb(t);
  const poiReader = openPoiReader(poiFile(t));
  t.after(() => poiReader.close());
  const calls = [];
  const provider = {
    name: "fake",
    model: "fake-1",
    async generate(request) {
      calls.push(request);
      const good = (item) => ({
        key: ` ${item.key.toUpperCase()} `, // keys come back with spaces and another case
        title: item.language === "cs" ? "Zastávka u vody" : "A stop by the water",
        description: item.language === "cs" ? "Projdi se po veřejné cestě a užij si klidné místo u vody." : "Stroll along the public path and enjoy a calm spot by the water.",
      });
      if (!request.retry)
        // First answer: drops two items, writes one with a reward and one in the wrong language.
        return {
          items: request.items
            .filter((item) => !item.key.startsWith("p2|"))
            .map((item) =>
              item.key === "p0|poi-visit|en"
                ? { ...good(item), description: "Walk to the fountain and win a shiny prize for your visit today." }
                : item.key === "p1|poi-visit|en"
                  ? { ...good(item), description: "Projdi se parkem a užij si klidné odpoledne na lavičce u cesty." }
                  : good(item),
            ),
        };
      // Follow-up: fixes everything except the reward text.
      return {
        items: request.items.map((item) =>
          item.key === "p0|poi-visit|en" ? { ...good(item), description: "Walk over and collect your reward money at the fountain today." } : good(item),
        ),
      };
    },
  };
  const result = await runFlavourBatch(db, { config: CONFIG(), provider, poiReader, clock: () => NOW });
  assert.equal(calls.length, 2);
  assert.equal(calls[1].items.length, 6, "only the four missing and two rejected items are asked again");
  assert.match(calls[1].user, /could not be used/);
  assert.match(calls[1].user, /missing from your answer/);
  assert.doesNotMatch(calls[1].user, /shiny prize|odpoledne na lavičce/, "rejected text is never echoed back");
  assert.equal(result.generated, 11);
  assert.equal(result.rejected, 1);
  const row = db.prepare("SELECT reason,lang,count,sample FROM ai_flavour_rejections").get();
  assert.deepEqual({ ...row, sample: undefined }, { reason: "reward-claim", lang: "en", count: 1, sample: undefined });
  assert.match(row.sample, /reward money/);
  const status = flavourStatus(db);
  assert.equal(status.lastBatch.rejectionRate, 0.083);
  assert.deepEqual(status.lastBatch.topRejectionReasons, [{ reason: "reward-claim", count: 1 }]);
  assert.equal(status.lastBatch.id, undefined, "no batch ids in health");
});

test("a restart marks a killed nightly batch interrupted and frees today's run", async (t) => {
  const { db } = gameDb(t);
  const { recoverInterruptedBatches } = await import("../server/ai/flavour-batch.mjs");
  flavourStatus(db);
  const now = Date.parse("2026-11-03T01:10:00Z");
  const row = (id, trigger, started) =>
    db.prepare("INSERT INTO ai_flavour_batches(id,trigger,provider,prompt_version,layer_id,since_ms,generated,rejected,token_budget,outcome,started_at) VALUES (?,?,'ollama','flavour-v1','aavegotchi',0,213,779,120000,'running',?)").run(id, trigger, started);
  row("killed", "nightly", Date.parse("2026-11-03T01:00:30Z"));
  row("old", "nightly", Date.parse("2026-11-01T01:00:30Z"));
  row("cli", "manual", Date.parse("2026-11-03T01:05:00Z"));
  db.prepare("INSERT INTO daily_jobs(job_key,created_at) VALUES (?,?)").run("flavour:2026-11-03", now - 600_000);
  db.prepare("INSERT INTO daily_jobs(job_key,created_at) VALUES (?,?)").run("flavour:2026-11-01", now - 2 * 86_400_000);
  const runs = [];
  const worker = startFlavourWorker(db, {
    env: { FLAVOUR_AI_PROVIDER: "ollama", OLLAMA_API_KEY: "k" },
    clock: () => now,
    log: () => {},
    run: async () => (runs.push(1), { id: "f", outcome: "completed" }),
  });
  t.after(() => worker.stop());
  const outcome = (id) => db.prepare("SELECT outcome,reason,finished_at FROM ai_flavour_batches WHERE id=?").get(id);
  assert.deepEqual({ ...outcome("killed") }, { outcome: "failed", reason: "interrupted", finished_at: now });
  assert.equal(outcome("old").reason, "interrupted");
  assert.equal(outcome("cli").outcome, "running", "manual runs may be alive in another process");
  assert.equal(db.prepare("SELECT count(*) n FROM daily_jobs WHERE job_key='flavour:2026-11-01'").get().n, 1, "only today's claim is released");
  assert.equal((await worker.tick()).outcome, "completed", "today's batch runs again");
  assert.equal(runs.length, 1);
  assert.deepEqual(recoverInterruptedBatches(db, { clock: () => now }), { interrupted: 0, released: [] });
});
