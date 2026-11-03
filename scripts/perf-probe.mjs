// Live performance probe for the map API (docs/PERFORMANCE-BUDGET.md).
// Creates one guest explorer, loads a world the way a phone does and times
// the reads the game polls. Fails when a p95 or a payload is over budget.
//
// Usage: npm run perf:probe -- [baseUrl] [samples]
//   default https://questlayer.promptstudio3000.com, 20 samples per read.
// Testnet only: it signs up a guest called "PerfProbe".
const BASE = (process.argv[2] || "https://questlayer.promptstudio3000.com").replace(/\/$/, "");
const N = Number(process.argv[3] || 20);
export const BUDGET = {
  p95Ms: Number(process.env.PERF_P95_MS || 400),
  worldKb: Number(process.env.PERF_WORLD_KB || 220),
  actorsKb: Number(process.env.PERF_ACTORS_KB || 40),
};
let cookie = "";
async function call(path, body) {
  const t = performance.now();
  const r = await fetch(BASE + "/api" + path, {
    method: body ? "POST" : "GET",
    headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const set = r.headers.get("set-cookie");
  if (set) cookie = set.split(";")[0];
  const text = await r.text();
  return { ms: performance.now() - t, status: r.status, kb: Buffer.byteLength(text) / 1024, text };
}
const problems = [];
const session = await call("/session", { name: "PerfProbe" });
if (session.status !== 201) throw new Error(`Guest sign-up failed: ${session.status}`);
const rows = [];
for (const arena of [true, false]) {
  // The demo arena is Plzeň (server/world.mjs HOME); the street world is Brno.
  const here = arena ? { lat: 49.74745, lng: 13.3774 } : { lat: 49.1951, lng: 16.6068 };
  const post = await call("/world", { location: here, arena, near: here });
  const world = JSON.parse(post.text);
  const at = world.coinsNear || world.center || here;
  const reads = [
    ["world", `/world?id=${encodeURIComponent(world.id)}&near=${at.lat},${at.lng}`, BUDGET.worldKb],
    ["actors", `/actors?worldId=${encodeURIComponent(world.id)}&lat=${at.lat}&lng=${at.lng}`, BUDGET.actorsKb],
    ["me", "/me"],
    ["presence", `/presence?lat=${at.lat}&lng=${at.lng}`],
  ];
  rows.push([`${arena ? "arena" : "street"} POST /world`, post.status, Math.round(post.ms), "-", post.kb.toFixed(1), world.coins?.length]);
  for (const [name, path, kbBudget] of reads) {
    const times = [];
    let last;
    for (let i = 0; i < N; i++) {
      last = await call(path);
      times.push(last.ms);
    }
    times.sort((a, b) => a - b);
    const q = (x) => Math.round(times[Math.min(times.length - 1, Math.floor(x * times.length))]);
    const coins = name === "world" ? JSON.parse(last.text).coins?.length : "";
    rows.push([`${arena ? "arena" : "street"} ${name}`, last.status, q(0.5), q(0.95), last.kb.toFixed(1), coins]);
    if (last.status >= 400) problems.push(`${name} answered ${last.status}`);
    if (q(0.95) > BUDGET.p95Ms) problems.push(`${name} p95 ${q(0.95)} ms > ${BUDGET.p95Ms} ms`);
    if (kbBudget && last.kb > kbBudget) problems.push(`${name} ${last.kb.toFixed(0)} KB > ${kbBudget} KB`);
  }
}
console.log("read                 status  p50ms  p95ms  KB(raw)  coins");
for (const r of rows) console.log(r.map((x, i) => String(x ?? "").padEnd(i ? 7 : 21)).join(""));
if (problems.length) {
  console.error("\nPerformance budget failed:\n  " + problems.join("\n  "));
  process.exit(1);
}
console.log("\nPerformance budget OK.");
