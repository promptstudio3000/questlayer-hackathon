/* QuestLayer service worker: keeps the app shell and hashed assets available
   offline and refreshes them in the background. API responses, map tiles and
   anything personal are never cached here, so nothing can look collected
   while offline. A new version waits until the player chooses Reload
   (the page posts "SKIP_WAITING"); bump VERSION when this file's caching
   changes. */
const VERSION = "questlayer-shell-v2";
const SHELL = [
  "/manifest.webmanifest",
  "/icon.svg",
  "/icon-192.png",
  "/icon-512.png",
  "/icons/maskable-512.png",
  "/icons/apple-touch-180.png",
];
// The built shell names its hashed entry script and stylesheets; precache
// them too so the very next visit opens offline.
const shellAssets = (html) => [
  ...new Set(
    [...html.matchAll(/(?:src|href)="(\/assets\/[^"]+\.(?:js|css))"/g)].map((m) => m[1]),
  ),
];
const isHtml = (response) =>
  response.ok && (response.headers.get("Content-Type") || "").includes("text/html");

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(VERSION)
      .then(async (cache) => {
        await cache.addAll(SHELL).catch(() => undefined);
        const response = await fetch("/", { cache: "reload" });
        if (!isHtml(response)) return;
        const html = await response.clone().text();
        await cache.put("/", response);
        await cache.addAll(shellAssets(html));
      })
      .catch(() => undefined),
  );
});
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});
self.addEventListener("message", (event) => {
  if (event.data === "SKIP_WAITING") self.skipWaiting();
});

// Shown only when the shell has never been cached and there is no network.
const OFFLINE_PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#1a0335"><title>QuestLayer · Offline</title>
<style>body{margin:0;min-height:100dvh;display:grid;place-items:center;padding:24px;box-sizing:border-box;
background:#fcfaff;color:#1a0335;font:16px/1.5 system-ui,sans-serif}main{max-width:360px;text-align:center}
svg{display:block;margin:0 auto}h1{font-size:24px;line-height:1.3;margin:16px 0 8px}
p{margin:0 0 24px;color:#665577}a{display:inline-flex;align-items:center;justify-content:center;min-height:48px;
padding:0 24px;border:2px solid #1a0335;border-radius:8px;background:#672eeb;color:#fff;font-weight:600;
text-decoration:none;box-shadow:3px 3px 0 #1a0335}a:focus-visible{outline:3px solid #672eeb;outline-offset:2px}</style>
</head><body><main><svg width="72" height="72" viewBox="0 0 64 64" aria-hidden="true" shape-rendering="crispEdges"><rect width="64" height="64" rx="17" fill="#55436f"/><path d="M24 12h16v5h7v24h-5v9h-8v-6h-5v6h-8v-9h-5V23h3v-6h5z" fill="#fff6e8"/><path d="M24 26h6v8h-6zm13 0h6v8h-6z" fill="#76608f"/><path d="M28 39h10v4H28z" fill="#c1a4d7"/></svg><h1>You're offline</h1>
<p>QuestLayer needs a connection to open for the first time. Connect to the internet and try again.</p>
<a href="/">Try again</a></main></body></html>`;

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return;
  if (url.pathname.startsWith("/assets/")) {
    // Hashed, immutable build assets: cache first.
    event.respondWith(
      caches.open(VERSION).then(async (cache) => {
        const hit = await cache.match(request);
        if (hit) return hit;
        const response = await fetch(request);
        if (response.ok) cache.put(request, response.clone());
        return response;
      }),
    );
    return;
  }
  if (SHELL.includes(url.pathname)) {
    // Icons and manifest: cached copy offline, network otherwise.
    event.respondWith(
      fetch(request).catch(async () => (await caches.match(url.pathname)) || Response.error()),
    );
    return;
  }
  if (request.mode === "navigate") {
    // App shell: network first, cached shell when offline.
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (isHtml(response)) {
            const copy = response.clone();
            caches.open(VERSION).then((cache) => cache.put("/", copy));
          }
          return response;
        })
        .catch(async () => {
          const cached = await caches.match("/");
          return (
            cached ||
            new Response(OFFLINE_PAGE, {
              status: 503,
              headers: { "Content-Type": "text/html; charset=utf-8" },
            })
          );
        }),
    );
  }
});
