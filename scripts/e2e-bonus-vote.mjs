// Playwright check of Community → "Tomorrow's creator bonus" on a phone-sized
// viewport. It starts its own server with a throwaway database (or uses
// E2E_BASE_URL), creates an explorer, and checks two things:
// 1. With creator quests off (the default), the panel stays hidden.
// 2. With a ballot served (the API is stubbed in the browser, because an
//    eligible voter needs a linked account and published creator quests),
//    voting and taking a vote back work and the copy has no chain words.
//
// Usage:  npm run build && npm run e2e:bonus-vote
// Screenshots land in output/qa/2026-11-bonus-vote/ (override with E2E_SHOTS).
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { openScreen } from "./lib/e2e-nav.mjs";

const ROOT = resolve(import.meta.dirname, "..");
const SHOTS = resolve(
  process.env.E2E_SHOTS || join(ROOT, "output/qa/2026-11-bonus-vote"),
);
const CHAIN =
  /\b(wallet|testnet|mainnet|transaction|NEAR|yocto|mint(ed)?|NFT|on-chain|contract|blockchain)\b/i;

async function freePort() {
  return new Promise((done, fail) => {
    const s = createServer();
    s.on("error", fail);
    s.listen(0, "127.0.0.1", () => {
      const { port } = s.address();
      s.close(() => done(port));
    });
  });
}

async function startServer() {
  if (process.env.E2E_BASE_URL)
    return { url: process.env.E2E_BASE_URL, stop() {} };
  const port = await freePort();
  const dir = mkdtempSync(join(tmpdir(), "questlayer-e2e-vote-"));
  const url = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ["server/index.mjs"], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(port),
      HOST: "127.0.0.1",
      APP_ORIGIN: url,
      DATABASE_PATH: join(dir, "e2e.sqlite"),
      DISABLE_RELAYER: "1",
    },
    stdio: ["ignore", "inherit", "inherit"],
  });
  const deadline = Date.now() + 60_000;
  for (;;) {
    try {
      const h = await (await fetch(`${url}/api/health`)).json();
      if (h.worldPreparation?.days?.some((d) => d.state === "ready")) break;
    } catch {}
    if (Date.now() > deadline) throw Error("Server did not become ready.");
    await new Promise((r) => setTimeout(r, 500));
  }
  return {
    url,
    stop() {
      child.kill("SIGTERM");
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

// A stateful stand-in for GET/POST /api/creators/bonus-vote.
function stubBallot() {
  const ballot = {
    network: "testnet",
    day: "2026-11-03",
    closesAt: Date.now() + 5 * 3600_000,
    eligible: true,
    reason: null,
    votesLeft: 3,
    policy: { votesPerExplorer: 3, winners: 3, activeDays: 7, minVoters: 1 },
    candidates: [
      {
        questId: "q-castle",
        title: "Castle stairs",
        votes: 4,
        mine: false,
        own: false,
      },
      {
        questId: "q-river",
        title: "River bend",
        votes: 2,
        mine: false,
        own: false,
      },
      {
        questId: "q-mine",
        title: "My brewery walk",
        votes: 1,
        mine: false,
        own: true,
      },
    ],
    today: { day: "2026-11-02", winners: ["q-castle"], gated: true },
  };
  const posts = [];
  return {
    posts,
    async handle(route) {
      const req = route.request();
      if (req.method() === "POST") {
        const input = req.postDataJSON();
        posts.push(input);
        const c = ballot.candidates.find((x) => x.questId === input.questId);
        if (input.action === "unvote" && c.mine) {
          c.mine = false;
          c.votes -= 1;
          ballot.votesLeft += 1;
        } else if (!c.mine) {
          c.mine = true;
          c.votes += 1;
          ballot.votesLeft -= 1;
        }
      }
      await route.fulfill({ json: ballot });
    },
  };
}

async function openCommunity(page) {
  await openScreen(page, "Community");
  // The bonus vote lives on Community → Creators.
  await page.getByRole("tab", { name: /Creators/ }).click();
  await page.getByRole("tabpanel").first().waitFor();
}

async function main() {
  mkdirSync(SHOTS, { recursive: true });
  const server = await startServer();
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 2,
      isMobile: true,
      hasTouch: true,
      reducedMotion: "reduce",
      locale: "en-GB",
    });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));

    console.log("1. New explorer");
    await page.goto(server.url);
    await page.getByPlaceholder("Your explorer name").fill("Vera");
    await page.getByRole("button", { name: "Start exploring" }).click();
    await page.locator("#first-session-title").waitFor({ timeout: 20_000 });
    const skip = page
      .getByRole("button", { name: /Skip|Not now|Later/ })
      .first();
    if (await skip.count()) await skip.click().catch(() => {});

    console.log("2. Vote hidden while creator quests are off");
    const real = page.waitForResponse("**/api/creators/bonus-vote");
    await openCommunity(page);
    const answer = await real;
    assert.equal(answer.status(), 503, "the host answers that the vote is off");
    await page.waitForTimeout(500);
    assert.equal(await page.locator(".bonus-vote").count(), 0);

    console.log("3. Ballot shown and votes saved");
    const stub = stubBallot();
    await page.route("**/api/creators/bonus-vote", (r) => stub.handle(r));
    await openScreen(page, "Explore");
    await openCommunity(page);
    const panel = page.locator(".bonus-vote");
    await panel.waitFor({ timeout: 10_000 });
    await panel.scrollIntoViewIfNeeded();
    // The ballot is a one-line summary until the explorer opens it.
    await panel.locator("summary").click();
    await panel.getByText("Today's bonus quests: Castle stairs").waitFor();
    assert.match(await panel.innerText(), /3 of 3 votes left/);
    assert.match(await panel.innerText(), /Voting closes in \d+ h/);
    // Own quest: no vote button.
    assert.equal(
      await panel.getByRole("button", { name: /My brewery walk/ }).count(),
      0,
    );
    await page.screenshot({ path: join(SHOTS, "01-ballot.png") });

    await panel.getByRole("button", { name: "Vote for River bend" }).click();
    const voted = panel.getByRole("button", {
      name: "Take back vote for River bend",
    });
    await voted.waitFor();
    assert.equal(await voted.getAttribute("aria-pressed"), "true");
    assert.match(await panel.innerText(), /2 of 3 votes left/);
    assert.match(await panel.innerText(), /River bend\s*3 votes/);
    await page.screenshot({ path: join(SHOTS, "02-voted.png") });

    await voted.click();
    await panel.getByRole("button", { name: "Vote for River bend" }).waitFor();
    assert.deepEqual(stub.posts, [
      { questId: "q-river" },
      { questId: "q-river", action: "unvote" },
    ]);

    const copy = await page.locator(".bonus-vote, .toast").allInnerTexts();
    assert.doesNotMatch(copy.join("\n"), CHAIN, "chain word in the vote panel");
    assert.deepEqual(errors, [], "no page errors");
    console.log("Bonus vote check passed.");
  } finally {
    await browser.close();
    server.stop();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
