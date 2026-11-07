// Independent static origin. No service signing keys, player keys or app DB.
import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { resolve, extname } from "node:path";
import { pathToFileURL } from "node:url";
import { validateVaultOrigins } from "../src/signing-vault/policy.ts";
export function createSigningVaultServer({
  config,
  dist = resolve("dist/signing-vault"),
}) {
  validateVaultOrigins(config);
  const serialized = JSON.stringify({
    appOrigin: config.appOrigin, vaultOrigin: config.vaultOrigin, network: config.network, rpcUrl: config.rpcUrl,
    contracts: Object.fromEntries(["qgold", "qgoldEscrow", "collectibles", "npcGames", "social"]
      .filter(name => typeof config.contracts?.[name] === "string").map(name => [name, config.contracts[name]])),
  });
  return createServer((req, res) => {
    let url;
    try { url = new URL(req.url, config.vaultOrigin); }
    catch { res.writeHead(400).end(); return; }
    if (!req.url.startsWith("/") || req.url.startsWith("//") || url.origin !== config.vaultOrigin) {
      res.writeHead(400).end(); return;
    }
    const approval = url.pathname === "/approve";
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader(
      "Permissions-Policy",
      "camera=(), microphone=(), geolocation=()",
    );
    res.setHeader(
      "Content-Security-Policy",
      `default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self' ${config.appOrigin} ${new URL(config.rpcUrl).origin}; img-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors ${approval ? "'none'" : config.appOrigin}`,
    );
    if (approval) res.setHeader("X-Frame-Options", "DENY");
    if (req.method !== "GET") {
      res.writeHead(405).end();
      return;
    }
    if (url.pathname === "/vault-config.json") {
      res.setHeader("Content-Type", "application/json");
      res.end(serialized);
      return;
    }
    const path = ["/", "/approve"].includes(url.pathname)
      ? resolve(dist, "signing-vault.html")
      : /^\/assets\/[a-zA-Z0-9_.-]+\.(?:js|css)$/.test(url.pathname)
        ? resolve(dist, url.pathname.slice(1))
        : null;
    if (!path || !existsSync(path)) {
      res.writeHead(404).end("Not found");
      return;
    }
    res.setHeader(
      "Content-Type",
      extname(path) === ".js"
        ? "text/javascript"
        : extname(path) === ".css"
          ? "text/css"
          : "text/html",
    );
    try { res.end(readFileSync(path)); }
    catch { res.writeHead(404).end(); }
  });
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const config = JSON.parse(process.env.SIGNING_VAULT_PUBLIC_CONFIG ?? "null");
  createSigningVaultServer({ config }).listen(
    Number(process.env.PORT ?? 8790),
    "127.0.0.1",
  );
}
