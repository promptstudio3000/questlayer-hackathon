import { readGotchis } from "./aavegotchi.mjs";
import { verifyMessage as verifyEvmMessage, isAddress } from "viem";
import { createServer } from "node:http";
import { clientAddress } from "./http-security.mjs";
import {
  readFileSync,
  existsSync,
  createReadStream,
  mkdirSync,
  writeFileSync,
} from "node:fs";
import { resolve, extname, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
import { randomBytes } from "node:crypto";
import sharp from "sharp";
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from "@simplewebauthn/server";
import { verifyMessage } from "near-api-js/nep413";
import { JsonRpcProvider } from "near-api-js";
import {
  openDatabase,
  atomic,
  playerView,
  history,
  createPlayer,
} from "./database.mjs";
import { HOME, ensureWorld, worldView, expireWorlds } from "./world.mjs";
import * as game from "./game.mjs";
import {
  GOLD,
  DAY,
  assert,
  id,
  hash,
  point,
  tierFor,
  positionTier,
} from "./domain.mjs";

if (existsSync(".env")) process.loadEnvFile(".env");
const db = openDatabase();
const port = Number(process.env.PORT || 8787),
  origin = process.env.APP_ORIGIN || "http://localhost:5173",
  rpID = new URL(origin).hostname;
const rpc = process.env.NEAR_RPC_URL || "https://rpc.testnet.near.org";
const provider = new JsonRpcProvider({ url: rpc });
db.exec(
  `CREATE TABLE IF NOT EXISTS passkeys(id TEXT PRIMARY KEY,player_id TEXT NOT NULL REFERENCES players(id),public_key TEXT NOT NULL,counter INTEGER NOT NULL,transports TEXT NOT NULL);`,
);
const listeners = new Set(),
  rates = new Map();
function emit(type, data) {
  const event = `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of listeners) client.write(event);
}
function cookie(token) {
  return `auratrail=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000${origin.startsWith("https:") ? "; Secure" : ""}`;
}
function auth(req) {
  const token = req.headers.cookie?.match(
    /(?:^|; )auratrail=([a-f0-9]{64})(?:;|$)/,
  )?.[1];
  assert(token, "Create an explorer first.", 401);
  const s = db
    .prepare("SELECT * FROM sessions WHERE token_hash=? AND expires_at>?")
    .get(hash(token), Date.now());
  assert(s, "Please sign in again.", 401);
  return s.player_id;
}
function newSession(player) {
  const token = randomBytes(32).toString("hex");
  db.prepare("INSERT INTO sessions VALUES (?,?,?)").run(
    hash(token),
    player,
    Date.now() + 30 * DAY,
  );
  return token;
}
function challenge(prefix, data) {
  const c = id(prefix),
    nonce = randomBytes(32).toString("base64");
  db.prepare("INSERT INTO auth_challenges VALUES (?,?,?,0)").run(
    c,
    JSON.stringify({ nonce, ...data }),
    Date.now() + 300_000,
  );
  return { id: c, nonce };
}
function readChallenge(challengeId) {
  const c = db
    .prepare(
      "SELECT * FROM auth_challenges WHERE id=? AND expires_at>? AND used=0",
    )
    .get(challengeId, Date.now());
  assert(c, "The sign-in challenge has expired.", 401);
  return JSON.parse(c.nonce);
}
async function body(req) {
  let size = 0;
  const chunks = [];
  for await (const c of req) {
    size += c.length;
    assert(size <= 1_500_000, "The file is too large.", 413);
    chunks.push(c);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString() || "{}");
  } catch {
    assert(false, "Invalid request.");
  }
}
function respond(res, data, status = 200, headers = {}) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    ...headers,
  });
  res.end(JSON.stringify(data));
}
function profile(player) {
  const p = playerView(db, player);
  if (p.appearance.originTokenId) {
    const link = db
      .prepare("SELECT * FROM external_links WHERE player_id=? AND address=?")
      .get(player, p.appearance.address);
    if (
      !link ||
      link.verified_at < Date.now() - 300000 ||
      !JSON.parse(link.data).gotchis?.some(
        (g) => g.tokenId === p.appearance.originTokenId,
      )
    )
      p.appearance = {};
  }
  return {
    ...p,
    coinsCollected: db
      .prepare("SELECT COUNT(*) AS n FROM coins WHERE claimant=?")
      .get(player).n,
    level: 1 + Math.floor(Math.sqrt(p.xp / 100)),
    tier: tierFor(p.positions.reduce((s, x) => s + positionTier(x), 0)),
    weighted_u: p.positions.reduce((s, x) => s + positionTier(x), 0),
  };
}
async function imageFile(data) {
  if (!data) return null;
  assert(
    typeof data === "string" &&
      /^data:image\/(jpeg|png|webp);base64,/.test(data),
    "Use a JPG, PNG or WebP image.",
  );
  const buffer = Buffer.from(data.split(",")[1], "base64");
  const clean = await sharp(buffer, { limitInputPixels: 16_000_000 })
    .rotate()
    .resize({
      width: 1024,
      height: 1024,
      fit: "inside",
      withoutEnlargement: true,
    })
    .jpeg({ quality: 78 })
    .toBuffer();
  assert(clean.length < 400_000, "The image is too large.");
  mkdirSync(".data/media", { recursive: true });
  const name = `${id("image")}.jpg`;
  writeFileSync(`.data/media/${name}`, clean);
  return `/api/media/${name}`;
}

async function api(req, res, url) {
  const path = url.pathname,
    method = req.method || "GET";
  if (method !== "GET") {
    const allowed = new Set([
      origin,
      ...(process.env.NODE_ENV === "production"
        ? []
        : [
            "http://localhost:5173",
            "http://127.0.0.1:5173",
            "http://localhost:8787",
            "http://127.0.0.1:8787",
          ]),
    ]);
    assert(
      !req.headers.origin || allowed.has(req.headers.origin),
      "Request origin is not allowed.",
      403,
    );
    assert(
      req.headers["content-type"]?.startsWith("application/json"),
      "JSON is required.",
      415,
    );
    const address = clientAddress(req, process.env.TRUST_PROXY === "loopback"),
      key = `${address}:${Math.floor(Date.now() / 60_000)}`;
    const n = (rates.get(key) || 0) + 1;
    rates.set(key, n);
    assert(n <= 600, "Please try again shortly.", 429);
  }
  if (path === "/api/health")
    return respond(res, {
      status: "ok",
      app: "QuestLayer",
      version: "0.1.0",
      mode: "demo",
      now: Date.now(),
    });
  if (path === "/api/config")
    return respond(res, {
      mode: "demo",
      network: "testnet",
      coinValue: 0.01,
      coinSplit: 50,
      zoneSplit: 50,
      chainReady: false,
      passkeyKind: "demo-identity",
      contracts: {
        game: process.env.NEAR_GAME_CONTRACT || null,
        vault: process.env.NEAR_VAULT_CONTRACT || null,
        collectibles: process.env.NEAR_COLLECTIBLES_CONTRACT || null,
        intents: process.env.NEAR_INTENTS_CONTRACT || null,
      },
      nearAI: !!process.env.NEAR_AI_API_KEY,
    });
  if (path === "/api/session" && method === "POST") {
    const input = await body(req);
    const result = game.session(db, input.name);
    return respond(res, { player: profile(result.player.id) }, 201, {
      "Set-Cookie": cookie(result.token),
    });
  }
  if (path === "/api/logout" && method === "POST") {
    const player = auth(req);
    const token = req.headers.cookie?.match(/auratrail=([a-f0-9]{64})/)?.[1];
    if (token)
      db.prepare("DELETE FROM sessions WHERE token_hash=?").run(hash(token));
    db.prepare("DELETE FROM presence WHERE player_id=?").run(player);
    return respond(res, { ok: true }, 200, {
      "Set-Cookie": "auratrail=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0",
    });
  }
  if (path === "/api/passkey/options" && method === "POST") {
    const input = await body(req);
    if (input.action === "register") {
      assert(
        typeof input.name === "string" &&
          input.name.trim().length >= 2 &&
          input.name.trim().length <= 24,
        "Your name must be 2–24 characters.",
      );
      const options = await generateRegistrationOptions({
        rpName: "QuestLayer",
        rpID,
        userName: input.name,
        userID: randomBytes(32),
        attestationType: "none",
        authenticatorSelection: {
          residentKey: "required",
          userVerification: "required",
        },
      });
      const c = challenge("passkey", {
        action: "register",
        name: input.name,
        challenge: options.challenge,
      });
      return respond(res, { options, challengeId: c.id });
    }
    const options = await generateAuthenticationOptions({
      rpID,
      userVerification: "required",
    });
    const c = challenge("passkey", {
      action: "login",
      challenge: options.challenge,
    });
    return respond(res, { options, challengeId: c.id });
  }
  if (path === "/api/passkey/verify" && method === "POST") {
    const input = await body(req),
      c = readChallenge(input.challengeId);
    let player;
    if (c.action === "register") {
      const v = await verifyRegistrationResponse({
        response: input.response,
        expectedChallenge: c.challenge,
        expectedOrigin: origin,
        expectedRPID: rpID,
        requireUserVerification: true,
      });
      assert(
        v.verified && v.registrationInfo,
        "The passkey could not be verified.",
        401,
      );
      player = atomic(db, () => {
        assert(
          db
            .prepare("UPDATE auth_challenges SET used=1 WHERE id=? AND used=0")
            .run(input.challengeId).changes === 1,
          "This challenge has already been used.",
          401,
        );
        const p = createPlayer(db, c.name);
        const credential = v.registrationInfo.credential;
        db.prepare("INSERT INTO passkeys VALUES (?,?,?,?,?)").run(
          credential.id,
          p,
          Buffer.from(credential.publicKey).toString("base64"),
          credential.counter,
          JSON.stringify(credential.transports || []),
        );
        return p;
      });
    } else {
      const saved = db
        .prepare("SELECT * FROM passkeys WHERE id=?")
        .get(input.response.id);
      assert(saved, "This passkey is not registered.", 401);
      const v = await verifyAuthenticationResponse({
        response: input.response,
        expectedChallenge: c.challenge,
        expectedOrigin: origin,
        expectedRPID: rpID,
        requireUserVerification: true,
        credential: {
          id: saved.id,
          publicKey: new Uint8Array(Buffer.from(saved.public_key, "base64")),
          counter: saved.counter,
          transports: JSON.parse(saved.transports),
        },
      });
      assert(v.verified, "Passkey verification failed.", 401);
      atomic(db, () => {
        assert(
          db
            .prepare("UPDATE auth_challenges SET used=1 WHERE id=? AND used=0")
            .run(input.challengeId).changes === 1,
          "This challenge has already been used.",
          401,
        );
        db.prepare("UPDATE passkeys SET counter=? WHERE id=?").run(
          v.authenticationInfo.newCounter,
          saved.id,
        );
      });
      player = saved.player_id;
    }
    return respond(res, { player: profile(player) }, 200, {
      "Set-Cookie": cookie(newSession(player)),
    });
  }
  if (path === "/api/dashboard") return respond(res, game.dashboard(db));
  if (path === "/api/market")
    return respond(res, {
      listings: db
        .prepare(
          "SELECT l.*,i.name,i.rarity,i.color,i.slot,i.serial,p.name AS seller_name FROM listings l JOIN inventory i ON i.id=l.item_id JOIN players p ON p.id=l.seller WHERE l.state='open' ORDER BY l.created_at DESC LIMIT 100",
        )
        .all(),
    });
  if (path.startsWith("/api/media/") && method === "GET") {
    const name = path.split("/").pop();
    assert(/^image_[a-f0-9-]+\.jpg$/.test(name), "Image not found.", 404);
    const file = resolve(".data/media", name);
    assert(existsSync(file), "Image not found.", 404);
    res.writeHead(200, {
      "Content-Type": "image/jpeg",
      "Cache-Control": "public,max-age=86400",
      "X-Content-Type-Options": "nosniff",
    });
    return createReadStream(file).pipe(res);
  }
  const player = auth(req);
  if (path === "/api/me") return respond(res, { player: profile(player) });
  if (path === "/api/events") {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    res.write(": connected\n\n");
    listeners.add(res);
    const tick = setInterval(() => res.write(": ping\n\n"), 20_000);
    req.on("close", () => {
      clearInterval(tick);
      listeners.delete(res);
    });
    return;
  }
  if (path === "/api/world" && method === "POST") {
    const input = await body(req),
      location = point(input.location || HOME);
    expireWorlds(db);
    const world = await ensureWorld(db, location, input.arena !== false);
    return respond(res, worldView(db, world.id, player));
  }
  if (path === "/api/world" && method === "GET") {
    const w = worldView(db, url.searchParams.get("id"), player);
    assert(w, "World not found.", 404);
    return respond(res, w);
  }
  if (path === "/api/coins/claim" && method === "POST") {
    const input = await body(req),
      result = game.claimCoin(db, player, input.coinId, input.fix);
    if (!result.alreadyClaimed) emit("coin", { id: input.coinId });
    return respond(res, { ...result, player: profile(player) });
  }
  if (path === "/api/quests/checkpoint" && method === "POST") {
    const input = await body(req),
      result = game.advanceRoute(
        db,
        player,
        input.questId,
        input.fix,
        input.checkpoint,
      );
    emit("quest", { id: input.questId });
    return respond(res, { ...result, player: profile(player) });
  }
  if (path === "/api/quests/claim" && method === "POST") {
    const input = await body(req),
      result = game.claimQuest(db, player, input.questId, input.fix);
    emit("quest", { id: input.questId });
    return respond(res, { ...result, player: profile(player) });
  }
  if (path === "/api/stake" && method === "POST") {
    const i = await body(req);
    const result = game.stake(db, player, i.amount, i.contribution, i.pool);
    return respond(res, { ...result, player: profile(player) });
  }
  if (path === "/api/contribution" && method === "POST") {
    const i = await body(req);
    return respond(res, {
      ...game.contribution(db, player, i.positionId, i.contribution),
      player: profile(player),
    });
  }
  if (path === "/api/unstake" && method === "POST") {
    const i = await body(req);
    return respond(res, {
      ...game.unstake(db, player, i.positionId),
      player: profile(player),
    });
  }
  if (path === "/api/withdraw" && method === "POST") {
    const i = await body(req);
    return respond(res, {
      ...game.redeem(db, player, i.withdrawalId),
      player: profile(player),
    });
  }
  if (path === "/api/equip" && method === "POST") {
    const i = await body(req);
    return respond(res, {
      ...game.equip(db, player, i.itemId),
      player: profile(player),
    });
  }
  if (path === "/api/market/list" && method === "POST") {
    const i = await body(req);
    const r = game.listItem(db, player, i.itemId, i.price);
    emit("market", {});
    return respond(res, { ...r, player: profile(player) });
  }
  if (path === "/api/market/buy" && method === "POST") {
    const i = await body(req),
      r = game.buyItem(db, player, i.listingId);
    emit("market", {});
    return respond(res, { ...r, player: profile(player) });
  }
  if (path === "/api/market/cancel" && method === "POST") {
    const i = await body(req),
      r = game.cancelListing(db, player, i.listingId);
    emit("market", {});
    return respond(res, r);
  }
  if (path === "/api/messages" && method === "GET") {
    const lat = Number(url.searchParams.get("lat") || HOME.lat),
      lng = Number(url.searchParams.get("lng") || HOME.lng);
    return respond(res, {
      messages: db
        .prepare(
          "SELECT m.*,p.name AS author FROM messages m JOIN players p ON p.id=m.player_id WHERE m.lat BETWEEN ? AND ? AND m.lng BETWEEN ? AND ? ORDER BY m.created_at DESC LIMIT 50",
        )
        .all(lat - 0.025, lat + 0.025, lng - 0.04, lng + 0.04),
    });
  }
  if (path === "/api/messages" && method === "POST") {
    const i = await body(req);
    point(i);
    assert(
      typeof i.text === "string" &&
        i.text.trim().length > 0 &&
        i.text.length <= 500,
      "A note must contain 1–500 characters.",
    );
    const image = await imageFile(i.image);
    const msg = id("message");
    let fix = null;
    if (i.shareGps) {
      point(i.fix);
      assert(Number.isFinite(i.fix.accuracy), "Location accuracy is missing.");
      fix = JSON.stringify({
        lat: i.fix.lat,
        lng: i.fix.lng,
        accuracy: i.fix.accuracy,
        timestamp: i.fix.timestamp,
      });
    }
    db.prepare("INSERT INTO messages VALUES (?,?,?,?,?,?,?,?)").run(
      msg,
      player,
      i.text.trim(),
      i.lat,
      i.lng,
      image,
      fix,
      Date.now(),
    );
    emit("message", {});
    return respond(res, { id: msg }, 201);
  }
  if (path === "/api/presence" && method === "POST") {
    const i = await body(req);
    if (!i.enabled) {
      db.prepare("DELETE FROM presence WHERE player_id=?").run(player);
      return respond(res, { enabled: false });
    }
    point(i);
    const now = Date.now();
    const old = db
      .prepare("SELECT expires_at FROM presence WHERE player_id=?")
      .get(player);
    if (!i.renew && (!old || old.expires_at <= now)) {
      db.prepare("DELETE FROM presence WHERE player_id=?").run(player);
      return respond(res, { enabled: false });
    }
    const expiry = i.renew ? now + 15 * 60_000 : old.expires_at;
    db.prepare("INSERT OR REPLACE INTO presence VALUES (?,?,?,?,?)").run(
      player,
      i.lat,
      i.lng,
      expiry,
      now,
    );
    return respond(res, { enabled: true, expiresAt: expiry });
  }
  if (path === "/api/presence" && method === "GET") {
    const lat = Number(url.searchParams.get("lat") || HOME.lat),
      lng = Number(url.searchParams.get("lng") || HOME.lng);
    return respond(res, {
      players: db
        .prepare(
          "SELECT p.name,p.id,pr.lat,pr.lng FROM presence pr JOIN players p ON p.id=pr.player_id WHERE pr.player_id!=? AND pr.expires_at>? AND pr.updated_at>? AND pr.lat BETWEEN ? AND ? AND pr.lng BETWEEN ? AND ? LIMIT 30",
        )
        .all(
          player,
          Date.now(),
          Date.now() - 30_000,
          lat - 0.015,
          lat + 0.015,
          lng - 0.02,
          lng + 0.02,
        )
        .map((p) => ({
          ...p,
          color:
            db
              .prepare(
                "SELECT color FROM inventory WHERE player_id=? AND equipped=1 AND kind='aura' LIMIT 1",
              )
              .get(p.id)?.color || "#b6a1df",
        })),
    });
  }
  if (path === "/api/wallet/challenge" && method === "POST") {
    const i = await body(req);
    assert(
      typeof i.accountId === "string" &&
        /^[a-z0-9._-]{2,64}$/.test(i.accountId),
      "Invalid NEAR account.",
    );
    const message = `Linking a NEAR account to explorer ${player}. Network: testnet. No funds will be transferred.`;
    const c = challenge("near", {
      player,
      accountId: i.accountId,
      message,
      recipient: origin,
    });
    return respond(res, {
      challengeId: c.id,
      nonce: c.nonce,
      message,
      recipient: origin,
    });
  }
  if (path === "/api/wallet/verify" && method === "POST") {
    const i = await body(req),
      c = readChallenge(i.challengeId);
    assert(
      c.player === player,
      "The challenge belongs to another explorer.",
      403,
    );
    await verifyMessage({
      signerAccountId: c.accountId,
      signerPublicKey: i.publicKey,
      payload: {
        message: c.message,
        recipient: c.recipient,
        nonce: new Uint8Array(Buffer.from(c.nonce, "base64")),
      },
      signature: new Uint8Array(Buffer.from(i.signature, "base64")),
      provider,
    });
    atomic(db, () => {
      const old = db
        .prepare("SELECT player_id FROM wallet_links WHERE account_id=?")
        .get(c.accountId);
      assert(
        !old || old.player_id === player,
        "This account is linked to another explorer.",
        409,
      );
      assert(
        db
          .prepare("UPDATE auth_challenges SET used=1 WHERE id=? AND used=0")
          .run(i.challengeId).changes === 1,
        "This challenge has already been used.",
        401,
      );
      db.prepare("INSERT OR REPLACE INTO wallet_links VALUES (?,?,?)").run(
        c.accountId,
        player,
        Date.now(),
      );
    });
    return respond(res, { player: profile(player) });
  }
  if (path === "/api/wallet/balance") {
    const linked = db
      .prepare("SELECT account_id FROM wallet_links WHERE player_id=?")
      .get(player);
    assert(linked, "Connect a NEAR account first.");
    const account = await provider.query({
      request_type: "view_account",
      account_id: linked.account_id,
      finality: "final",
    });
    return respond(res, {
      accountId: linked.account_id,
      amount: account.amount,
      network: "testnet",
      realChain: true,
    });
  }

  if (path === "/api/evm/challenge" && method === "POST") {
    const i = await body(req);
    assert(isAddress(i.address), "Invalid EVM address.");
    const message = `QuestLayer: read-only linking of Base address ${i.address.toLowerCase()} to explorer ${player} na ${origin}. Nonce ${randomBytes(16).toString("hex")}. No transaction or NFT transfer approval.`;
    const c = challenge("evm", {
      player,
      address: i.address.toLowerCase(),
      message,
    });
    return respond(res, { challengeId: c.id, message });
  }
  if (path === "/api/evm/verify" && method === "POST") {
    const i = await body(req),
      c = readChallenge(i.challengeId);
    assert(c.player === player, "Wrong explorer.", 403);
    assert(
      await verifyEvmMessage({
        address: c.address,
        message: c.message,
        signature: i.signature,
      }),
      "The signature does not match this address.",
      401,
    );
    atomic(db, () => {
      const old = db
        .prepare("SELECT player_id FROM external_links WHERE address=?")
        .get(c.address);
      assert(
        !old || old.player_id === player,
        "The address is linked to another explorer.",
        409,
      );
      assert(
        db
          .prepare("UPDATE auth_challenges SET used=1 WHERE id=? AND used=0")
          .run(i.challengeId).changes === 1,
        "This challenge has already been used.",
        401,
      );
      db.prepare("INSERT OR IGNORE INTO external_links VALUES (?,?,?,?)").run(
        c.address,
        player,
        "{}",
        0,
      );
    });
    return respond(res, { address: c.address, verified: true });
  }
  if (path === "/api/aavegotchi" && method === "GET") {
    const link = db
      .prepare(
        "SELECT * FROM external_links WHERE player_id=? ORDER BY verified_at DESC LIMIT 1",
      )
      .get(player);
    if (!link)
      return respond(res, { linked: false, gotchis: [], wearables: [] });
    let data = JSON.parse(link.data);
    if (link.verified_at < Date.now() - 300000) {
      try {
        data = await readGotchis(link.address);
        db.prepare(
          "UPDATE external_links SET data=?,verified_at=? WHERE address=?",
        ).run(JSON.stringify(data), data.verifiedAt, link.address);
      } catch {
        return respond(res, {
          linked: true,
          ...data,
          status: "unavailable",
          error:
            "Base RPC is temporarily unavailable. Your previous inventory is preserved; linked appearances are paused until ownership is verified.",
        });
      }
    }
    return respond(res, {
      linked: true,
      ...data,
      gotchis: (data.gotchis || []).map(({ svg, ...g }) => ({
        ...g,
        hasImage: !!svg,
      })),
      status: "verified",
    });
  }
  if (path === "/api/aavegotchi/equip" && method === "POST") {
    const i = await body(req);
    if (i.tokenId === null) {
      db.prepare("UPDATE players SET appearance=? WHERE id=?").run(
        "{}",
        player,
      );
      return respond(res, { player: profile(player) });
    }
    const link = db
      .prepare(
        "SELECT * FROM external_links WHERE player_id=? ORDER BY verified_at DESC LIMIT 1",
      )
      .get(player);
    assert(
      link && link.verified_at > Date.now() - 300000,
      "Refresh original ownership first.",
    );
    const data = JSON.parse(link.data);
    assert(
      data.gotchis?.some((g) => g.tokenId === String(i.tokenId)),
      "This original is not held by your linked address.",
      403,
    );
    db.prepare("UPDATE players SET appearance=? WHERE id=?").run(
      JSON.stringify({
        originTokenId: String(i.tokenId),
        address: link.address,
      }),
      player,
    );
    return respond(res, { player: profile(player) });
  }
  if (path === "/api/aavegotchi/skin" && method === "GET") {
    const token = url.searchParams.get("tokenId");
    assert(token && /^\d{1,12}$/.test(token), "Invalid original.");
    const link = db
      .prepare(
        "SELECT * FROM external_links WHERE player_id=? ORDER BY verified_at DESC LIMIT 1",
      )
      .get(player);
    assert(
      link && link.verified_at > Date.now() - 300000,
      "Ownership needs to be refreshed.",
      403,
    );
    const gotchi = JSON.parse(link.data).gotchis?.find(
      (g) => g.tokenId === token,
    );
    assert(gotchi?.svg, "The appearance is unavailable.", 404);
    res.writeHead(200, {
      "Content-Type": "image/svg+xml",
      "Content-Security-Policy":
        "default-src 'none'; style-src 'unsafe-inline'; sandbox",
      "Cache-Control": "private,max-age=60",
    });
    return res.end(gotchi.svg);
  }
  if (path === "/api/npc" && method === "POST") {
    const i = await body(req);
    assert(
      typeof i.question === "string" && i.question.length <= 300,
      "The question is too long.",
    );
    let answer =
      "Every adventure starts around the corner. Collect shared street coins, visit a garden and open a chest. Half of the game yield funds coins and half funds zones. This world uses demo GOLD.";
    let source = "rules";
    if (process.env.NEAR_AI_API_KEY && process.env.NEAR_AI_MODEL) {
      const r = await fetch("https://cloud-api.near.ai/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.NEAR_AI_API_KEY}`,
        },
        body: JSON.stringify({
          model: process.env.NEAR_AI_MODEL,
          max_tokens: 250,
          messages: [
            {
              role: "system",
              content:
                "You are the English-speaking QuestLayer guide. Give concise exploration advice in English. 1 NEAR=1000 GOLD. This is a demo; never transfer funds. Game yield is split 50% street coins and 50% zones. Never invent locations or rewards, request keys or claim spending authority.",
            },
            { role: "user", content: i.question },
          ],
        }),
        signal: AbortSignal.timeout(20_000),
      });
      if (r.ok) {
        const j = await r.json();
        answer = j.choices?.[0]?.message?.content || answer;
        source = "near-ai";
      }
    }
    return respond(res, { answer, source });
  }
  if (path === "/api/bounties" && method === "GET")
    return respond(res, {
      bounties: db
        .prepare(
          "SELECT b.*,p.name AS creator_name FROM bounties b JOIN players p ON p.id=b.creator ORDER BY b.created_at DESC LIMIT 50",
        )
        .all(),
    });
  if (path === "/api/bounties" && method === "POST") {
    const i = await body(req);
    point(i);
    gameAmount(i.amount);
    assert(
      typeof i.title === "string" &&
        i.title.trim().length >= 5 &&
        i.title.length <= 100,
      "Enter a task title.",
    );
    assert(
      typeof i.description === "string" && i.description.length <= 1000,
      "The description is too long.",
    );
    const b = id("bounty");
    atomic(db, () => {
      const p = db.prepare("SELECT gold_u FROM players WHERE id=?").get(player);
      assert(p.gold_u >= i.amount, "Not enough GOLD.");
      db.prepare("UPDATE players SET gold_u=gold_u-? WHERE id=?").run(
        i.amount,
        player,
      );
      db.prepare(
        "INSERT INTO bounties(id,creator,title,description,amount_u,lat,lng,deadline,created_at) VALUES (?,?,?,?,?,?,?,?,?)",
      ).run(
        b,
        player,
        i.title.trim(),
        i.description,
        i.amount,
        i.lat,
        i.lng,
        Date.now() + 7 * DAY,
        Date.now(),
      );
      history(db, player, "escrow", `Escrow: ${i.title}`, -i.amount);
    });
    return respond(res, { id: b, player: profile(player) }, 201);
  }
  if (path === "/api/bounties/submit" && method === "POST") {
    const i = await body(req);
    assert(
      typeof i.evidence === "string" &&
        i.evidence.trim().length >= 10 &&
        i.evidence.length <= 1000,
      "Describe completion in at least ten characters.",
    );
    const b = db.prepare("SELECT * FROM bounties WHERE id=?").get(i.bountyId);
    assert(
      b && b.state === "open" && b.deadline > Date.now(),
      "The task is already closed.",
    );
    assert(b.creator !== player, "You cannot complete your own task.");
    assert(
      !db
        .prepare(
          "SELECT 1 FROM bounty_submissions WHERE bounty_id=? AND player_id=? AND state='pending'",
        )
        .get(b.id, player),
      "Your evidence is already awaiting review.",
    );
    db.prepare(
      "INSERT INTO bounty_submissions(bounty_id,player_id,evidence,created_at) VALUES (?,?,?,?)",
    ).run(b.id, player, i.evidence.trim(), Date.now());
    return respond(res, { ok: true });
  }
  if (path === "/api/bounties/submissions") {
    const b = db
      .prepare("SELECT * FROM bounties WHERE id=? AND creator=?")
      .get(url.searchParams.get("id"), player);
    assert(b, "You do not own this task.", 403);
    return respond(res, {
      submissions: db
        .prepare(
          "SELECT s.*,p.name FROM bounty_submissions s JOIN players p ON p.id=s.player_id WHERE bounty_id=? ORDER BY s.id",
        )
        .all(b.id),
    });
  }
  if (path === "/api/bounties/approve" && method === "POST") {
    const i = await body(req);
    atomic(db, () => {
      const s = db
        .prepare("SELECT * FROM bounty_submissions WHERE id=?")
        .get(i.submissionId);
      assert(s?.state === "pending", "Submission is unavailable.");
      const b = db
        .prepare("SELECT * FROM bounties WHERE id=?")
        .get(s.bounty_id);
      assert(
        b.creator === player && b.state === "open",
        "The task cannot be approved.",
        403,
      );
      assert(
        !db
          .prepare(
            "SELECT 1 FROM bounty_submissions WHERE bounty_id=? AND id<? AND state='pending'",
          )
          .get(b.id, s.id),
        "Review earlier submissions first.",
      );
      db.prepare("UPDATE bounties SET state='paid',winner=? WHERE id=?").run(
        s.player_id,
        b.id,
      );
      db.prepare(
        "UPDATE bounty_submissions SET state='approved' WHERE id=?",
      ).run(s.id);
      db.prepare("UPDATE players SET gold_u=gold_u+? WHERE id=?").run(
        b.amount_u,
        s.player_id,
      );
      history(db, s.player_id, "bounty", b.title, b.amount_u);
    });
    return respond(res, { ok: true });
  }
  if (path === "/api/bounties/refund" && method === "POST") {
    const i = await body(req);
    atomic(db, () => {
      const b = db
        .prepare(
          "SELECT * FROM bounties WHERE id=? AND creator=? AND state='open'",
        )
        .get(i.bountyId, player);
      assert(
        b && b.deadline < Date.now(),
        "A refund becomes available after the deadline.",
      );
      assert(
        !db
          .prepare(
            "SELECT 1 FROM bounty_submissions WHERE bounty_id=? AND state='pending'",
          )
          .get(b.id),
        "Review pending evidence first.",
      );
      db.prepare("UPDATE bounties SET state='refunded' WHERE id=?").run(b.id);
      db.prepare("UPDATE players SET gold_u=gold_u+? WHERE id=?").run(
        b.amount_u,
        player,
      );
    });
    return respond(res, { player: profile(player) });
  }
  throw Object.assign(new Error("This route does not exist."), { status: 404 });
}
function gameAmount(x) {
  assert(
    Number.isSafeInteger(x) && x > 0 && x <= 1_000_000 * GOLD,
    "Invalid amount.",
  );
}
const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".webmanifest": "application/manifest+json",
  ".woff2": "font/woff2",
  ".glb": "model/gltf-binary",
};
const server = createServer(async (req, res) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader(
    "Permissions-Policy",
    "geolocation=(self), camera=(), microphone=()",
  );
  try {
    const url = new URL(req.url, "http://localhost");
    if (url.pathname.startsWith("/api/")) return await api(req, res, url);
    const root = resolve(APP_ROOT, "dist"),
      file = resolve(root, `.${decodeURIComponent(url.pathname)}`);
    assert(
      file === root || file.startsWith(root + "/"),
      "Path is not allowed.",
      403,
    );
    const target =
      existsSync(file) && extname(file) ? file : resolve(root, "index.html");
    assert(existsSync(target), "Build the application first.", 503);
    res.writeHead(200, {
      "Content-Type": types[extname(target)] || "application/octet-stream",
      "Cache-Control":
        extname(target) === ".html" ? "no-cache" : "public,max-age=3600",
    });
    createReadStream(target).pipe(res);
  } catch (e) {
    if (!res.headersSent)
      respond(
        res,
        {
          error: e.status ? e.message : "The request could not be completed.",
          code: e.code || "SERVER_ERROR",
        },
        e.status || 500,
      );
    else res.end();
    if (!e.status) console.error("Request failed:", e.name, e.code || "");
  }
});
const maintenance = setInterval(() => {
  try {
    expireWorlds(db);
    game.harvestDemo(db);
    db.prepare("DELETE FROM presence WHERE expires_at<? OR updated_at<?").run(
      Date.now(),
      Date.now() - 30_000,
    );
    db.prepare("DELETE FROM auth_challenges WHERE expires_at<?").run(
      Date.now(),
    );
    db.prepare("DELETE FROM sessions WHERE expires_at<?").run(Date.now());
    if (rates.size > 1000) rates.clear();
  } catch (e) {
    console.error("Maintenance failed", e.name);
  }
}, 30_000);
maintenance.unref();
server.listen(port, process.env.HOST || "127.0.0.1", () =>
  console.log(
    `QuestLayer server: http://${process.env.HOST || "127.0.0.1"}:${port} · DEMO realm`,
  ),
);
function close() {
  clearInterval(maintenance);
  for (const r of listeners) r.end();
  server.close(() => {
    db.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 2000).unref();
}
process.on("SIGTERM", close);
process.on("SIGINT", close);
