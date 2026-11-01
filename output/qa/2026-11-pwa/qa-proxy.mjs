// QA-only front server: serves a frozen build, forwards /api to the QA
// server on 18788 and can publish a "next" service worker on request.
import { createServer, request } from "node:http";
import { readFileSync, existsSync, statSync } from "node:fs";
import { join, extname } from "node:path";
const ROOT = process.argv[2];
let release = 1;
const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".webmanifest": "application/manifest+json", ".json": "application/json", ".woff2": "font/woff2", ".glb": "model/gltf-binary", ".webp": "image/webp" };
createServer((req, res) => {
  const url = new URL(req.url, "http://x");
  if (url.pathname === "/__qa/release") { release = Number(url.searchParams.get("n")) || 1; res.end(String(release)); return; }
  if (url.pathname.startsWith("/api/")) {
    const up = request({ host: "127.0.0.1", port: 18788, path: req.url, method: req.method, headers: req.headers }, (r) => { res.writeHead(r.statusCode, r.headers); r.pipe(res); });
    up.on("error", () => { res.writeHead(502); res.end(); });
    req.pipe(up); return;
  }
  let file = join(ROOT, decodeURIComponent(url.pathname));
  if (!existsSync(file) || statSync(file).isDirectory()) file = join(ROOT, "index.html");
  let body = readFileSync(file);
  if (url.pathname === "/sw.js" && release > 1) body = Buffer.concat([body, Buffer.from(`\n// QA release ${release}\n`)]);
  const hashed = url.pathname.startsWith("/assets/");
  res.writeHead(200, { "Content-Type": types[extname(file)] || "application/octet-stream", "Cache-Control": hashed ? "public,max-age=31536000,immutable" : "no-cache" });
  res.end(body);
}).listen(18789, () => console.log("qa proxy on 18789"));
