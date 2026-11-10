// The mainnet slice runs as its own systemd service next to the testnet one
// (docs/OWNER-RUNBOOK.md §7). These checks keep the two from sharing state.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const unit = (name) => readFileSync(`deploy/${name}.service`, "utf8");
const settings = (text) =>
  Object.fromEntries(
    text
      .split("\n")
      .filter((l) => l.startsWith("Environment="))
      .map((l) => l.slice(12).split(/=(.*)/s).slice(0, 2)),
  );

test("the mainnet unit shares nothing with the testnet unit", () => {
  const main = unit("questlayer-mainnet"),
    test_ = unit("questlayer-hackathon");
  assert.doesNotMatch(
    main.replace(/^#.*$/gm, ""),
    /questlayer-hackathon/,
  );
  const m = settings(main),
    t = settings(test_);
  assert.equal(m.NEAR_NETWORK, "mainnet");
  assert.equal(t.NEAR_NETWORK, "testnet");
  assert.equal(m.MAINNET_FEATURES, "collectibles,relayer,social");
  for (const key of ["PORT", "APP_ORIGIN", "DATABASE_PATH", "STATIC_ASSET_DIR"])
    assert.notEqual(m[key], t[key], key);
  assert.match(m.DATABASE_PATH, /^\/var\/lib\/questlayer-mainnet\//);
  assert.match(m.AWARD_SIGNER_PATH, /^\/var\/lib\/questlayer-mainnet\//);
  assert.match(main, /^StateDirectory=questlayer-mainnet$/m);
  assert.match(main, /^ReadWritePaths=\/var\/lib\/questlayer-mainnet$/m);
  // docs/MAINNET-PLAN.md §1 limits.
  assert.equal(m.PLAYER_FACTORY_FUND_YOCTO, "20000000000000000000000");
  assert.equal(m.RELAY_TOPUP_CAP_YOCTO, "50000000000000000000000");
  // §7: the 2 NEAR/day sponsorship cap Lubos chose on 10 November.
  assert.equal(m.SUBSIDY_DAILY_YOCTO, "2000000000000000000000000");
  assert.equal(m.SUBSIDY_DAILY_OPERATIONS, "500");
  assert.ok(BigInt(m.SUBSIDY_GAS_RESERVE_YOCTO) > 0n);
});

test("deploy-vps --mainnet refuses without the explicit confirmation", () => {
  const r = spawnSync("bash", ["scripts/deploy-vps.sh", "--mainnet"], {
    env: {
      ...process.env,
      DEPLOY_HOST: "nobody@127.0.0.1",
      QUESTLAYER_MAINNET_DEPLOY_CONFIRM: "",
    },
    encoding: "utf8",
  });
  assert.equal(r.status, 1);
  assert.match(
    r.stderr,
    /QUESTLAYER_MAINNET_DEPLOY_CONFIRM=mainnet\.questlayer\.promptstudio3000\.com/,
  );
  const unknown = spawnSync("bash", ["scripts/deploy-vps.sh"], {
    env: { ...process.env, DEPLOY_TARGET: "devnet" },
    encoding: "utf8",
  });
  assert.equal(unknown.status, 1);
  assert.match(unknown.stderr, /testnet or mainnet/);
});

