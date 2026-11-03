// Local load test: N simulated walkers across Czech cities against a server
// started here on a throwaway database (docs/PERFORMANCE-BUDGET.md, "Load").
// Each walker behaves like a phone in play: guest sign-up, POST /world for its
// spot, then the client's polls (me + world every 15 s with ETag, presence
// every 8 s, actors every 60 s, daily board every 30 s, presence share every
// 10 s for a third of them, one SSE stream) while it walks at jogging pace to
// the nearest coins and POI quests and claims them with a fresh GPS fix.
//
// Usage:
//   npm run load:test -- [--walkers=500] [--duration=180] [--ramp=60]
//                        [--poi=/var/lib/questlayer-poi/current.sqlite]
//                        [--cities=DIR] [--url=http://127.0.0.1:PORT]
//                        [--out=output/qa/load-test]
// Without --url it starts its own server (TRUST_PROXY=loopback so every walker
// gets its own address, ACTORS_ENABLED=1, clock moved into play hours).
// --url only accepts localhost: never point this at the VPS.
import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { daytimeOffset } from "./lib/e2e-clock.mjs";

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, "").split("=");
    return [k, v ?? "1"];
  }),
);
const WALKERS = Number(args.walkers || 500);
const DURATION_S = Number(args.duration || 180);
const RAMP_S = Number(args.ramp || 60);
const OUT = args.out || "output/qa/load-test/latest";
const SPEED_MPS = 4; // jogging: under the 15 m/s travel guard, finds coins fast
export const LOAD_BUDGET = {
  // Time inside the server (Server-Timing app) at p95 for the polled reads.
  serverP95Ms: Number(process.env.LOAD_SERVER_P95_MS || 100),
  // Round trip measured by the walkers on the same machine.
  p95Ms: Number(process.env.LOAD_P95_MS || 400),
  loopStallMs: Number(process.env.LOAD_LOOP_STALL_MS || 1000),
  errorShare: Number(process.env.LOAD_ERROR_SHARE || 0.01),
};

// Spots: big cities weighted by size, plus towns and villages. Approximate
// centres (public squares), not taken from any dataset.
const SPOTS = [
  ["Praha", 50.0875, 14.4213, 30],
  ["Brno", 49.1951, 16.6068, 14],
  ["Ostrava", 49.8355, 18.2925, 8],
  ["Plzeň arena", 49.74745, 13.3774, 10, true],
  ["Plzeň street", 49.7477, 13.3776, 4],
  ["Liberec", 50.7671, 15.0562, 4],
  ["Olomouc", 49.5938, 17.2509, 4],
  ["České Budějovice", 48.9745, 14.4743, 4],
  ["Hradec Králové", 50.2092, 15.8328, 4],
  ["Ústí nad Labem", 50.6607, 14.0323, 3],
  ["Pardubice", 50.0379, 15.7791, 3],
  ["Zlín", 49.2265, 17.6707, 3],
  ["Jihlava", 49.3961, 15.5912, 2],
  ["Karlovy Vary", 50.2306, 12.8711, 2],
  ["Kutná Hora", 49.9484, 15.2682, 1],
  ["Český Krumlov", 48.8109, 14.3152, 1],
  ["Telč", 49.1842, 15.4528, 1],
  ["Holašovice", 48.9694, 14.2725, 1],
  ["Šumava forest", 48.9757, 13.7958, 1],
];

const toRad = (d) => (d * Math.PI) / 180;
function meters(a, b) {
  const dy = (a.lat - b.lat) * 111_320;
  const dx = (a.lng - b.lng) * 111_320 * Math.cos(toRad(a.lat));
  return Math.hypot(dx, dy);
}
function stepToward(from, to, m) {
  const d = meters(from, to);
  if (d <= m) return { ...to };
  const f = m / d;
  return { lat: from.lat + (to.lat - from.lat) * f, lng: from.lng + (to.lng - from.lng) * f };
}
let seed = 0x5eed;
const rand = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
function pickSpot() {
  const total = SPOTS.reduce((s, x) => s + x[3], 0);
  let r = rand() * total;
  for (const s of SPOTS) if ((r -= s[3]) <= 0) return s;
  return SPOTS[0];
}

async function freePort() {
  return new Promise((ok) => {
    const s = createServer().listen(0, "127.0.0.1", () => {
      const { port } = s.address();
      s.close(() => ok(port));
    });
  });
}

const clockOffset = daytimeOffset("Europe/Prague");
const now = () => Date.now() + clockOffset;

async function startServer() {
  const dir = mkdtempSync(join(tmpdir(), "questlayer-load-"));
  const port = await freePort();
  const url = `http://127.0.0.1:${port}`;
  const env = {
    ...process.env,
    PORT: String(port),
    HOST: "127.0.0.1",
    APP_ORIGIN: url,
    DATABASE_PATH: join(dir, "load.sqlite"),
    DISABLE_RELAYER: "1",
    TRUST_PROXY: "loopback",
    ACTORS_ENABLED: "1",
    ACTORS_ALL_DAY: "1",
    E2E_CLOCK_OFFSET_MS: String(clockOffset),
    SLOW_API_MS: process.env.SLOW_API_MS || "250",
  };
  if (args.poi) env.POI_DB_PATH = args.poi;
  if (args.cities) env.AUTO_CITIES_DIR = args.cities;
  const log = [];
  // LOAD_PROFILE=dir writes a V8 CPU profile of the server there on exit.
  const profile = process.env.LOAD_PROFILE ? ["--cpu-prof", `--cpu-prof-dir=${process.env.LOAD_PROFILE}`] : [];
  const child = spawn(process.execPath, [...profile, "--import", "./scripts/lib/e2e-clock.mjs", "server/index.mjs"], {
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  for (const s of [child.stdout, child.stderr])
    s.on("data", (d) => {
      const text = String(d);
      log.push(text);
      if (process.env.LOAD_VERBOSE) process.stderr.write(text);
    });
  const deadline = Date.now() + 90_000;
  let health;
  for (;;) {
    try {
      health = await (await fetch(`${url}/api/health`)).json();
      if (health.worldPreparation?.days?.some((d) => d.state === "ready")) break;
    } catch {}
    if (child.exitCode !== null) throw Error(`Server exited:\n${log.join("").slice(-3000)}`);
    if (Date.now() > deadline) throw Error("Server did not become ready.");
    await new Promise((r) => setTimeout(r, 500));
  }
  return {
    url,
    pid: child.pid,
    health,
    log,
    stop: () =>
      new Promise((done) => {
        child.once("exit", () => {
          rmSync(dir, { recursive: true, force: true });
          done();
        });
        child.kill("SIGTERM");
      }),
  };
}

// ---- measurements -------------------------------------------------------
const stats = new Map(); // route -> {ms:[], app:[], status:{}}
let worstLoop = 0;
const slowLines = [];
function record(route, ms, status, timing) {
  let s = stats.get(route);
  if (!s) stats.set(route, (s = { ms: [], app: [], status: {} }));
  s.ms.push(ms);
  if (timing.app !== undefined) s.app.push(timing.app);
  s.status[status] = (s.status[status] || 0) + 1;
  if (timing.loop > worstLoop) worstLoop = timing.loop;
  if (timing.app > 250 && slowLines.length < 60)
    slowLines.push(`${route} ${Math.round(timing.app)} ms (${Object.entries(timing).map(([k, v]) => `${k} ${Math.round(v)}`).join(", ")})`);
}
const pct = (list, p) => {
  if (!list.length) return null;
  const s = [...list].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(p * s.length))];
};

// ---- walker -------------------------------------------------------------
class Walker {
  constructor(base, i) {
    this.base = base;
    this.i = i;
    const spot = pickSpot();
    this.spot = spot[0];
    this.arena = !!spot[4];
    // Start within ~400 m of the spot centre.
    this.pos = { lat: spot[1] + (rand() - 0.5) * 0.007, lng: spot[2] + (rand() - 0.5) * 0.011 };
    this.ip = `10.${(i >> 16) & 255}.${(i >> 8) & 255}.${(i & 255) + 1}`;
    this.cookie = "";
    this.etag = "";
    this.claimed = new Set();
    this.sharePresence = i % 3 === 0;
    this.lease = crypto.randomUUID();
    this.coins = 0;
    this.quests = 0;
    this.phase = Math.floor(rand() * 1000);
  }
  fix() {
    return { lat: this.pos.lat, lng: this.pos.lng, accuracy: 8, timestamp: now() - 500 };
  }
  async call(route, path, body, extra = {}) {
    const t = performance.now();
    let r, text = "";
    try {
      r = await fetch(this.base + "/api" + path, {
        method: body ? "POST" : "GET",
        headers: {
          "content-type": "application/json",
          "x-forwarded-for": this.ip,
          ...(this.cookie ? { cookie: this.cookie } : {}),
          ...extra,
        },
        body: body ? JSON.stringify(body) : undefined,
      });
      text = await r.text();
    } catch (error) {
      record(route, performance.now() - t, "net", {});
      return { status: 0, error };
    }
    const timing = Object.fromEntries(
      [...(r.headers.get("server-timing") || "").matchAll(/(\w+);dur=([\d.]+)/g)].map((m) => [m[1], Number(m[2])]),
    );
    record(route, performance.now() - t, r.status, timing);
    const set = r.headers.get("set-cookie");
    if (set) this.cookie = set.split(";")[0];
    let json = null;
    if (text && r.headers.get("content-type")?.includes("json"))
      try {
        json = JSON.parse(text);
      } catch {}
    return { status: r.status, json, headers: r.headers };
  }
  async start() {
    const s = await this.call("POST /session", "/session", { name: `Load ${this.i}` });
    if (s.status !== 201) throw Error(`session ${s.status}`);
    await this.openWorld();
    this.openStream();
  }
  async openWorld() {
    this.worldAt = { ...this.pos };
    const w = await this.call("POST /world", "/world", { location: this.pos, arena: this.arena, near: this.pos });
    if (w.json?.id) this.applyWorld(w.json);
  }
  applyWorld(w) {
    this.world = w;
    this.nearAt = w.coinsNear || this.pos;
  }
  async readWorld() {
    if (!this.world) return;
    const r = await this.call(
      "GET /world",
      `/world?id=${encodeURIComponent(this.world.id)}&near=${this.pos.lat},${this.pos.lng}`,
      undefined,
      this.etag ? { "if-none-match": this.etag } : {},
    );
    if (r.status === 200 && r.json) {
      this.etag = r.headers.get("etag") || "";
      this.applyWorld(r.json);
    }
  }
  openStream() {
    const ctrl = (this.stream = new AbortController());
    fetch(this.base + "/api/events", { headers: { cookie: this.cookie, "x-forwarded-for": this.ip }, signal: ctrl.signal })
      .then(async (r) => {
        for await (const _ of r.body) this.events = (this.events || 0) + 1;
      })
      .catch(() => {});
  }
  target() {
    const w = this.world;
    if (!w) return null;
    const open = [
      ...(w.coins || []).filter((c) => !c.claimant && !this.claimed.has(c.id)).map((c) => ({ ...c, kind: "coin" })),
      ...(w.quests || [])
        .filter((q) => !q.claimant && !this.claimed.has(q.id) && (!q.opensAt || q.opensAt <= now()) && (!q.closesAt || q.closesAt > now()))
        .map((q) => ({ ...q, kind: "quest" })),
    ].filter((x) => Number.isFinite(x.lat) && Number.isFinite(x.lng));
    let best = null, bestD = Infinity;
    for (const x of open) {
      const d = meters(this.pos, x);
      if (d < bestD) (best = x), (bestD = d);
    }
    return best && bestD < 2500 ? best : null;
  }
  async walk(dtS) {
    const t = this.target();
    if (t) this.pos = stepToward(this.pos, t, SPEED_MPS * dtS);
    else this.pos = { lat: this.pos.lat + (rand() - 0.5) * 0.0004, lng: this.pos.lng + (rand() - 0.5) * 0.0006 };
    if (!t) return;
    const radius = (this.world.coinRadius ?? 18) - 1;
    if (meters(this.pos, t) > (t.kind === "coin" ? radius : 15)) return;
    this.claimed.add(t.id);
    if (t.kind === "coin") {
      const r = await this.call("POST /coins/claim", "/coins/claim", { coinId: t.id, fix: this.arena ? { ...this.pos, accuracy: 0, timestamp: now() } : this.fix() });
      if (r.status === 200) this.coins++;
    } else {
      const r = await this.call("POST /quests/claim", "/quests/claim", { questId: t.id, fix: this.fix() });
      if (r.status === 200) this.quests++;
    }
  }
  async tick(sec) {
    const jobs = [];
    // Phones drift: offset each walker's timers by its index.
    const at = (every) => (sec + this.i) % every === 0;
    jobs.push(this.walk(1));
    if (at(15)) jobs.push(this.call("GET /me", "/me"), this.readWorld());
    if (at(8)) jobs.push(this.call("GET /presence", `/presence?lat=${this.pos.lat}&lng=${this.pos.lng}&arena=${this.arena ? 1 : 0}`));
    if (this.sharePresence && at(10))
      jobs.push(this.call("POST /presence", "/presence", { enabled: true, leaseId: this.lease, lat: this.pos.lat, lng: this.pos.lng, accuracy: 8, renew: false }));
    if (this.world && at(60))
      jobs.push(this.call("GET /actors", `/actors?worldId=${encodeURIComponent(this.world.id)}&lat=${this.pos.lat}&lng=${this.pos.lng}`));
    if (this.world && at(30)) jobs.push(this.call("GET /daily-board", `/daily-board?worldId=${encodeURIComponent(this.world.id)}`));
    if (at(30)) jobs.push(this.call("POST /badges/check", "/badges/check", { fix: this.fix() }));
    // The client refetches a third of the radius away from the ring centre,
    // and opens a new world 1 km from where it opened the last one.
    if (this.nearAt && meters(this.pos, this.nearAt) > 500) jobs.push(this.readWorld());
    if (this.worldAt && meters(this.pos, this.worldAt) > 1000) jobs.push(this.openWorld());
    await Promise.all(jobs);
  }
}

// ---- server process sampling -------------------------------------------
function procSample(pid) {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, "utf8").split(") ")[1].split(" ");
    const status = readFileSync(`/proc/${pid}/status`, "utf8");
    return { cpuTicks: Number(stat[11]) + Number(stat[12]), rssMb: Number(status.match(/VmRSS:\s+(\d+)/)[1]) / 1024 };
  } catch {
    return null;
  }
}

// ---- run ----------------------------------------------------------------
async function main() {
  let server;
  let base = args.url;
  if (base) {
    const host = new URL(base).hostname;
    if (!["127.0.0.1", "localhost", "::1"].includes(host)) throw Error("--url must be localhost. Never load-test the VPS.");
  } else {
    server = await startServer();
    base = server.url;
    console.log(`server ${base} pid ${server.pid}, poiWorld ${server.health.poiWorld?.status} ${server.health.poiWorld?.version || ""}`);
  }
  const walkers = Array.from({ length: WALKERS }, (_, i) => new Walker(base, i));
  const started = Date.now();
  const clientCpu0 = process.cpuUsage();
  const cpu0 = server && procSample(server.pid);
  let peakRss = 0, cpuSamples = [];
  let lastCpu = cpu0, lastAt = Date.now();
  const sampler = setInterval(() => {
    if (!server) return;
    const s = procSample(server.pid);
    if (!s) return;
    peakRss = Math.max(peakRss, s.rssMb);
    if (lastCpu) cpuSamples.push((s.cpuTicks - lastCpu.cpuTicks) / 100 / ((Date.now() - lastAt) / 1000));
    lastCpu = s;
    lastAt = Date.now();
  }, 2000);
  const active = [];
  let failedStarts = 0;
  // Ramp: walkers join evenly over RAMP_S.
  const joining = walkers.map((w, i) =>
    new Promise((r) => setTimeout(r, (i / WALKERS) * RAMP_S * 1000))
      .then(() => w.start())
      .then(() => active.push(w))
      .catch(() => failedStarts++),
  );
  let sec = 0, busy = 0;
  const loop = setInterval(() => {
    sec++;
    if (sec % 15 === 0)
      console.log(`t=${sec}s walkers ${active.length}/${WALKERS} in flight ${busy} coins ${walkers.reduce((s, w) => s + w.coins, 0)} quests ${walkers.reduce((s, w) => s + w.quests, 0)} loop stall max ${Math.round(worstLoop)} ms`);
    // Phones are not in step: each walker ticks at its own point in the second.
    for (const w of active)
      setTimeout(() => {
        if (w.ticking) return; // a walker never runs two ticks at once
        w.ticking = true;
        busy++;
        w.tick(sec).finally(() => {
          w.ticking = false;
          busy--;
        });
      }, w.phase);
  }, 1000);
  await Promise.all(joining);
  const remaining = DURATION_S * 1000 - (Date.now() - started);
  if (remaining > 0) await new Promise((r) => setTimeout(r, remaining));
  clearInterval(loop);
  clearInterval(sampler);
  for (const w of walkers) w.stream?.abort();
  await new Promise((r) => setTimeout(r, 1500));

  const rows = [...stats.entries()].sort((a, b) => b[1].ms.length - a[1].ms.length).map(([route, s]) => {
    const total = s.ms.length;
    const errors = Object.entries(s.status).filter(([k]) => k === "net" || Number(k) >= 500).reduce((n, [, v]) => n + v, 0);
    const limited = s.status[429] || 0;
    return {
      route,
      requests: total,
      p50: Math.round(pct(s.ms, 0.5)),
      p95: Math.round(pct(s.ms, 0.95)),
      p99: Math.round(pct(s.ms, 0.99)),
      serverP95: s.app.length ? Math.round(pct(s.app, 0.95) * 10) / 10 : null,
      serverMax: s.app.length ? Math.round(Math.max(...s.app)) : null,
      errors,
      limited,
      status: s.status,
    };
  });
  const totalReq = rows.reduce((s, r) => s + r.requests, 0);
  const totalErr = rows.reduce((s, r) => s + r.errors, 0);
  const report = {
    schema: "questlayer.load-test/1",
    at: new Date().toISOString(),
    walkers: WALKERS,
    started: active.length,
    failedStarts,
    durationS: DURATION_S,
    rampS: RAMP_S,
    poiWorld: server?.health.poiWorld ? { status: server.health.poiWorld.status, version: server.health.poiWorld.version, pois: server.health.poiWorld.pois } : null,
    requests: totalReq,
    rps: Math.round((totalReq / DURATION_S) * 10) / 10,
    errorShare: totalReq ? totalErr / totalReq : 0,
    coins: walkers.reduce((s, w) => s + w.coins, 0),
    quests: walkers.reduce((s, w) => s + w.quests, 0),
    worstLoopStallMs: Math.round(worstLoop),
    serverCpuCoresP95: cpuSamples.length ? Math.round(pct(cpuSamples, 0.95) * 100) / 100 : null,
    serverPeakRssMb: Math.round(peakRss),
    // The walkers share one process: above ~0.8 the client, not the server, adds latency.
    clientCpuCores: (() => {
      const u = process.cpuUsage(clientCpu0);
      return Math.round(((u.user + u.system) / 1e6 / ((Date.now() - started) / 1000)) * 100) / 100;
    })(),
    budget: LOAD_BUDGET,
    routes: rows,
    slow: slowLines,
    slowLog: server ? server.log.join("").split("\n").filter((l) => l.startsWith("Slow API")).slice(-40) : [],
  };
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, "report.json"), JSON.stringify(report, null, 2) + "\n");
  console.log("\nroute                 reqs    p50    p95    p99  srv95  srvMax  5xx  429");
  for (const r of rows)
    console.log(
      [r.route.padEnd(20), r.requests, r.p50, r.p95, r.p99, r.serverP95 ?? "-", r.serverMax ?? "-", r.errors, r.limited]
        .map((x, i) => (i ? String(x).padStart(i === 1 ? 6 : 7) : x))
        .join(""),
    );
  console.log(`\n${report.requests} requests, ${report.rps}/s, errors ${(report.errorShare * 100).toFixed(2)} %, loop stall max ${report.worstLoopStallMs} ms, server CPU p95 ${report.serverCpuCoresP95} cores, RSS peak ${report.serverPeakRssMb} MB, client CPU ${report.clientCpuCores} cores, coins ${report.coins}, quests ${report.quests}`);
  if (slowLines.length) console.log(`slow answers (first ${slowLines.length}):\n  ` + slowLines.slice(0, 15).join("\n  "));
  await server?.stop();
  const polled = new Set(["GET /world", "GET /me", "GET /presence", "GET /actors", "POST /presence"]);
  const problems = [];
  for (const r of rows) {
    if (!polled.has(r.route)) continue;
    if (r.serverP95 !== null && r.serverP95 > LOAD_BUDGET.serverP95Ms) problems.push(`${r.route} server p95 ${r.serverP95} ms > ${LOAD_BUDGET.serverP95Ms}`);
    if (r.p95 > LOAD_BUDGET.p95Ms) problems.push(`${r.route} p95 ${r.p95} ms > ${LOAD_BUDGET.p95Ms}`);
  }
  if (report.errorShare > LOAD_BUDGET.errorShare) problems.push(`error share ${(report.errorShare * 100).toFixed(2)} %`);
  if (report.worstLoopStallMs > LOAD_BUDGET.loopStallMs) problems.push(`loop stall ${report.worstLoopStallMs} ms > ${LOAD_BUDGET.loopStallMs}`);
  if (failedStarts) problems.push(`${failedStarts} walkers could not start`);
  if (problems.length) {
    console.error("\nLoad budget failed:\n  " + problems.join("\n  "));
    process.exit(1);
  }
  console.log("\nLoad budget OK.");
  process.exit(0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
