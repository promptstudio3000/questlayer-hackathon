// The contracts added after the minimal slice (docs/MAINNET-PLAN.md §6), run by
// the same one command right after it (scripts/deploy-mainnet-slice.mjs):
//
//   badges           soulbound player badges: create + deploy + init in one
//                    transaction, claim signer = the award signer, a bounded
//                    minter function-call key for the game server
//   npc-games        earned commit-reveal rolls: create + deploy + init in one
//                    transaction with its own ticket signer, then the wisp-v1
//                    prize table (no wagering, earned tickets only)
//   editions         the collectibles Aura editions: no deploy of its own, the
//                    slice deploys the reviewed build; this checks that build is
//                    the pinned one and that the contract lists every edition
//   stnear-treasury  the game treasury in stNEAR: Meta Pool must answer on the
//                    network; an optional deposit stakes the operator's NEAR
//   yield-vault      reported, never deployed: today's code is testnet only
//
// Every WASM must equal the Linux/CI build pinned in contracts/wasm-sha256.json.
// Like the slice, nothing is signed or written without `execute`, and a re-run
// verifies finished steps and skips them. Chain access goes through the same
// `chain` adapter, extended with accessKeys() and addFunctionCallKey().
import {
  NEAR,
  SliceError,
  OPERATOR_RESERVE,
  STORAGE_YOCTO_PER_BYTE,
  codeHash,
  sha256Hex,
  nearAmount,
  formatNear,
  keyFileName,
} from "./mainnet-slice.mjs";

const refuse = (message) => {
  throw new SliceError(message);
};

export const CONTRACT_STATE_MARGIN = NEAR / 2n;
export const NPC_TIMEOUT_BLOCKS = 600;
export const NPC_TABLE_ID = "wisp-v1";
// The same odds as testnet (docs/NPC-PLAN.md §7.2); prizes are cosmetic Auras
// and a trader voucher, mapped to award claims by the server.
export const NPC_TIERS = [
  { prize: "trader-voucher", weight: 60, daily_cap: null },
  { prize: "aura-rare", weight: 30, daily_cap: null },
  { prize: "aura-epic", weight: 9, daily_cap: 20 },
  { prize: "aura-legendary-wisp", weight: 1, daily_cap: 2 },
];
export const BADGE_MINTER_METHODS = ["create_badge", "claim"];
export const STNEAR_CONTRACTS = {
  testnet: "meta-v2.pool.testnet",
  mainnet: "meta-pool.near",
};

// What each name means, for the plan and the docs. `wasm` is the key in
// contracts/wasm-sha256.json.
export const CONTRACTS = {
  badges: { wasm: "questlayer_badges", manifest: "native-badges" },
  "npc-games": { wasm: "questlayer_npc_games", manifest: "native-npc-games" },
  editions: { wasm: "questlayer_collectibles", manifest: "native-editions" },
  "stnear-treasury": { wasm: null, manifest: "stnear-treasury" },
  "yield-vault": { wasm: "questlayer_yield_vault", manifest: null },
};
// Why the yield vault stays off mainnet. tests/mainnet-contracts.test.mjs reads
// the contract source and fails once these stop being true, so this list and
// docs/MAINNET-PLAN.md §6 get updated with the code.
export const YIELD_VAULT_BLOCKERS = [
  "contracts/yield-vault `new` panics unless the contract, owner and treasury are .testnet accounts",
  "its token allowlist (`known`) names only testnet tokens: meta-v2.pool.testnet, linear-protocol.testnet, usdc/usdt.fakes.testnet",
  "Rhea Lend is fixed to contract.burrow.testnet",
  "it holds other players' money: docs/MAINNET-PLAN.md §1 requires an external review first (manifest says audited: false)",
];

const TESTNET_DEFAULTS = {
  BADGES_FUND_NEAR: "5",
  BADGES_MINTER_ALLOWANCE_NEAR: "3",
  NPC_GAMES_FUND_NEAR: "3",
};
const DEFAULT_SELECTION = {
  testnet: "badges,npc-games,editions,stnear-treasury",
  mainnet: "editions",
};

/** The contracts a run covers: MAINNET_CONTRACTS, or the network default. */
export function selectedContracts(network, value) {
  const raw = value === undefined ? DEFAULT_SELECTION[network] : value;
  const names = String(raw)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  for (const name of names)
    if (!CONTRACTS[name])
      refuse(
        `MAINNET_CONTRACTS has an unknown contract "${name}"; known: ${Object.keys(CONTRACTS).join(", ")}.`,
      );
  if (names.includes("yield-vault"))
    refuse(
      `The yield vault cannot be deployed by this script: ${YIELD_VAULT_BLOCKERS.join("; ")}.`,
    );
  // The editions check is free and guards the slice's own contract: always on.
  return [...new Set(["editions", ...names])].sort();
}

/**
 * Readiness of every new contract on `network`, whether selected or not:
 * ready (deployable by this script), check (verification only) or blocked.
 */
export function readiness({ network, pinned, reviewedCollectibles }) {
  const pin = (name) => pinned?.[CONTRACTS[name].wasm] ?? null;
  return {
    badges: { status: "ready", wasmSha256: pin("badges") },
    "npc-games": { status: "ready", wasmSha256: pin("npc-games") },
    editions: {
      status:
        reviewedCollectibles && reviewedCollectibles === pin("editions")
          ? "check"
          : "blocked",
      wasmSha256: pin("editions"),
      note:
        reviewedCollectibles === pin("editions")
          ? "deployed by the slice as the reviewed collectibles build"
          : `the reviewed collectibles hash ${reviewedCollectibles} is not the pinned build; re-review first`,
    },
    "stnear-treasury": {
      status: "ready",
      contract: STNEAR_CONTRACTS[network],
      note: "no contract of ours; stakes operator NEAR with Meta Pool only when a deposit amount is set",
    },
    "yield-vault": {
      status: "blocked",
      wasmSha256: pin("yield-vault"),
      blockers: YIELD_VAULT_BLOCKERS,
    },
  };
}

/**
 * Pure plan for the selected contracts. `wasms` maps the wasm-sha256.json key to
 * the bytes; `pinned` is that file's `contracts` map.
 */
export function contractsPlan({
  network,
  operatorId,
  env = {},
  selected,
  wasms = {},
  pinned = {},
  reviewedCollectibles,
  awardPublicKey,
  ticketPublicKey,
  minterPublicKey,
  expectedEditions,
}) {
  const fund = (name) =>
    env[name] === undefined && network === "testnet"
      ? nearAmount(name, TESTNET_DEFAULTS[name])
      : nearAmount(name, env[name]);
  const suffix = `.${operatorId}`;
  const named = (key, fallback) => {
    const id = env[key] || fallback;
    if (!id.endsWith(suffix) || id.slice(0, -suffix.length).includes("."))
      refuse(`${key} (${id}) must be a direct sub-account of ${operatorId}.`);
    return id;
  };
  const code = (name) => {
    const key = CONTRACTS[name].wasm;
    const wasm = wasms[key];
    if (!wasm?.length)
      refuse(
        `The ${key} WASM is missing; use the Linux/CI build (npm run contracts:docker or the CI artifact).`,
      );
    const sha = sha256Hex(wasm);
    if (!pinned[key]) refuse(`contracts/wasm-sha256.json does not pin ${key}.`);
    if (sha !== pinned[key])
      refuse(
        `${key} WASM sha256 is ${sha}, not the pinned Linux/CI build ${pinned[key]} (macOS builds hash differently).`,
      );
    return {
      wasm,
      wasmSha256: sha,
      codeHash: codeHash(wasm),
      wasmBytes: wasm.length,
    };
  };
  const contractFund = (name, envName, bytes) => {
    const amount = fund(envName);
    const minimum =
      BigInt(bytes) * STORAGE_YOCTO_PER_BYTE + CONTRACT_STATE_MARGIN;
    if (amount < minimum)
      refuse(
        `${envName} must be at least ${formatNear(minimum)} NEAR for ${bytes} bytes of ${name} code plus state.`,
      );
    return amount;
  };
  const key32 = (what, value) => {
    if (!/^[A-Za-z0-9+/]{43}=$/.test(value || ""))
      refuse(`The ${what} public key must be 32 bytes of base64.`);
    return value;
  };

  const plan = { network, operator: operatorId, selected, contracts: {} };
  if (selected.includes("badges")) {
    const c = code("badges");
    plan.contracts.badges = {
      ...c,
      accountId: named("BADGES_ACCOUNT", `badges${suffix}`),
      fund: contractFund("badges", "BADGES_FUND_NEAR", c.wasmBytes),
      init: {
        owner_id: operatorId,
        claim_signer: key32("award signer", awardPublicKey),
      },
      minter: {
        keyFile: keyFileName(network, "badges-minter"),
        publicKey: minterPublicKey ?? null,
        allowance: fund("BADGES_MINTER_ALLOWANCE_NEAR"),
        methods: BADGE_MINTER_METHODS,
      },
    };
  }
  if (selected.includes("npc-games")) {
    const c = code("npc-games");
    plan.contracts["npc-games"] = {
      ...c,
      accountId: named("NPC_GAMES_ACCOUNT", `npc-games${suffix}`),
      fund: contractFund("npc-games", "NPC_GAMES_FUND_NEAR", c.wasmBytes),
      init: {
        owner_id: operatorId,
        ticket_signer: key32("npc ticket signer", ticketPublicKey),
        timeout_blocks: NPC_TIMEOUT_BLOCKS,
      },
      table: { table_id: NPC_TABLE_ID, tiers: NPC_TIERS, minimum: 0 },
    };
    if (ticketPublicKey === awardPublicKey)
      refuse(
        "The npc ticket signer must be its own key, not the award signer.",
      );
  }
  if (selected.includes("editions")) {
    if (
      !reviewedCollectibles ||
      reviewedCollectibles !== pinned.questlayer_collectibles
    )
      refuse(
        `contracts/collectibles/WASM_SHA256 (${reviewedCollectibles}) is not the pinned Linux/CI collectibles build (${pinned.questlayer_collectibles}); the editions code needs a review first.`,
      );
    if (!expectedEditions?.length)
      refuse("The expected Aura edition list is missing.");
    plan.contracts.editions = {
      wasmSha256: reviewedCollectibles,
      expectedEditions: [...expectedEditions],
    };
  }
  if (selected.includes("stnear-treasury")) {
    const deposit =
      env.STNEAR_TREASURY_DEPOSIT_NEAR === undefined ||
      env.STNEAR_TREASURY_DEPOSIT_NEAR === ""
        ? 0n
        : nearAmount(
            "STNEAR_TREASURY_DEPOSIT_NEAR",
            env.STNEAR_TREASURY_DEPOSIT_NEAR,
          );
    plan.contracts["stnear-treasury"] = {
      contract: STNEAR_CONTRACTS[network],
      account: operatorId,
      deposit,
    };
  }
  plan.total = Object.values(plan.contracts).reduce(
    (sum, c) => sum + (c.fund ?? 0n) + (c.deposit ?? 0n),
    0n,
  );
  return plan;
}

/**
 * Runs the plan. `collectiblesId` is the slice's collectibles account (for the
 * editions check); `reserved` is what the slice still has to spend in the same
 * run (its plan-mode `needed`), so one balance check covers both.
 */
export async function runContracts({
  plan,
  chain,
  keys,
  execute = false,
  collectiblesId,
  reserved = 0n,
  clock = () => new Date(),
}) {
  const steps = [];
  const transactions = {};
  const note = (step, detail = {}) => steps.push({ step, ...detail });
  const send = async (group, label, fn) => {
    if (!execute) return note(label, { planned: true });
    const transaction = await fn();
    if (typeof transaction !== "string" || !transaction)
      refuse(`${label}: no transaction hash returned.`);
    (transactions[group] ||= []).push({ step: label, transaction });
    note(label, { transaction });
  };

  const chainId = await chain.chainId();
  if (chainId !== plan.network)
    refuse(`The RPC node serves ${chainId}, not ${plan.network}.`);
  const operator = await chain.account(plan.operator);
  if (!operator)
    refuse(`The operator ${plan.operator} does not exist on ${plan.network}.`);

  // Inspect first, spend later: every check runs before any transaction.
  const deployed = {};
  let needed = 0n;
  for (const name of ["badges", "npc-games"]) {
    const c = plan.contracts[name];
    if (!c) continue;
    const existing = await chain.account(c.accountId);
    if (existing) {
      if (existing.code_hash !== c.codeHash)
        refuse(
          `${c.accountId} exists with code ${existing.code_hash}, not the pinned ${c.codeHash}. Upgrades are a separate, reviewed step.`,
        );
      const config = await chain.view(c.accountId, "get_config");
      if (config?.owner_id !== plan.operator)
        refuse(
          `${c.accountId} is owned by ${config?.owner_id}, not ${plan.operator}.`,
        );
      deployed[name] = config;
      note(`${name} ${c.accountId} already deployed`, { reused: true });
    } else needed += c.fund;
  }
  const minter = plan.contracts.badges?.minter;
  let minterRecord = minter ? keys.read(minter.keyFile) : null;
  if (minterRecord) {
    if (minterRecord.network !== plan.network)
      refuse(
        `${minter.keyFile} is a ${minterRecord.network} key file, not ${plan.network}.`,
      );
    if (minterRecord.accountId !== plan.contracts.badges.accountId)
      refuse(
        `${minter.keyFile} belongs to ${minterRecord.accountId}; move it aside first.`,
      );
  }
  const st = plan.contracts["stnear-treasury"];
  let stRecord = null;
  if (st) {
    const pool = await chain.account(st.contract);
    if (!pool) refuse(`${st.contract} does not exist on ${plan.network}.`);
    const price = BigInt(
      String(await chain.view(st.contract, "get_st_near_price")),
    );
    if (price < NEAR)
      refuse(
        `${st.contract} reports an stNEAR price of ${price}, below 1 NEAR.`,
      );
    st.price = price;
    stRecord =
      keys.readRecord?.(`stnear-treasury-${plan.network}.json`) ?? null;
    if (st.deposit > 0n && !stRecord?.deposits?.length) needed += st.deposit;
    note(`${st.contract} answers, 1 stNEAR = ${formatNear(price)} NEAR`);
  }

  const balance = BigInt(operator.amount);
  const total = needed + reserved;
  if (total > 0n && balance < total + OPERATOR_RESERVE)
    refuse(
      `The operator holds ${formatNear(balance)} NEAR; the slice and the new contracts need ${formatNear(total)} NEAR plus a ${formatNear(OPERATOR_RESERVE)} NEAR reserve.`,
    );
  note("operator balance for the new contracts", {
    balance: formatNear(balance),
    needed: formatNear(needed),
    reservedForSlice: formatNear(reserved),
  });

  const deploy = async (name) => {
    const c = plan.contracts[name];
    if (deployed[name]) return;
    await send(name, `create ${c.accountId}, deploy and init ${name}`, () =>
      chain.deployContractAccount({
        accountId: c.accountId,
        fund: c.fund,
        wasm: c.wasm,
        initArgs: c.init,
      }),
    );
    if (execute) {
      const after = await chain.account(c.accountId);
      if (after?.code_hash !== c.codeHash)
        refuse(`${c.accountId} did not end up with the pinned code.`);
      deployed[name] = await chain.view(c.accountId, "get_config");
    }
  };

  // Badges: claim signer = award signer, plus the bounded minter key.
  const b = plan.contracts.badges;
  if (b) {
    await deploy("badges");
    const config = deployed.badges;
    if (config && config.claim_signer !== b.init.claim_signer)
      refuse(
        `${b.accountId} trusts claim signer ${config.claim_signer}, not ${b.init.claim_signer}.`,
      );
    if (!minterRecord && execute) {
      const pair = keys.newKeyPair();
      minterRecord = {
        network: plan.network,
        accountId: b.accountId,
        publicKey: pair.publicKey,
        secretKey: pair.secretKey,
        role: "badges minter (function-call key: create_badge, claim)",
      };
      keys.create(minter.keyFile, minterRecord);
      note(`wrote ${minter.keyFile}`);
    } else if (!minterRecord)
      note(`write ${minter.keyFile}`, { planned: true });
    const installed =
      deployed.badges && minterRecord
        ? (await chain.accessKeys(b.accountId)).includes(minterRecord.publicKey)
        : false;
    if (!installed)
      await send(
        "badges",
        `install the bounded minter key on ${b.accountId}`,
        () =>
          chain.addFunctionCallKey({
            accountId: b.accountId,
            publicKey: minterRecord.publicKey,
            receiverId: b.accountId,
            methods: minter.methods,
            allowance: minter.allowance,
          }),
      );
    else note("badges minter key already installed", { reused: true });
  }

  // npc-games: own ticket signer, then the prize table (immutable once published).
  const g = plan.contracts["npc-games"];
  if (g) {
    await deploy("npc-games");
    const config = deployed["npc-games"];
    if (config && config.ticket_signer !== g.init.ticket_signer)
      refuse(
        `${g.accountId} trusts ticket signer ${config.ticket_signer}, not ${g.init.ticket_signer}.`,
      );
    const table = config
      ? await chain.view(g.accountId, "get_table", {
          table_id: g.table.table_id,
        })
      : null;
    if (table) {
      const same =
        JSON.stringify(table.tiers) === JSON.stringify(g.table.tiers);
      if (!same)
        refuse(
          `${g.accountId} already has ${g.table.table_id} with other tiers.`,
        );
      note(`prize table ${g.table.table_id} already published`, {
        reused: true,
      });
    } else
      await send("npc-games", `publish prize table ${g.table.table_id}`, () =>
        chain.call(g.accountId, "publish_table", g.table, 1n),
      );
  }

  // Editions: the slice deployed the reviewed collectibles; it must list them all.
  const e = plan.contracts.editions;
  let editions = null;
  if (e) {
    const live = collectiblesId && (await chain.account(collectiblesId));
    if (!live)
      note("check the Aura editions once collectibles is deployed", {
        planned: true,
      });
    else {
      editions = await chain.view(collectiblesId, "supported_editions");
      const missing = e.expectedEditions.filter(
        (id) => !editions?.includes(id),
      );
      if (missing.length)
        refuse(
          `${collectiblesId} does not list the Aura editions ${missing.join(", ")}.`,
        );
      note(
        `${collectiblesId} lists all ${e.expectedEditions.length} Aura editions`,
      );
    }
  }

  // stNEAR treasury: an optional one-time deposit, recorded publicly without keys.
  if (st && st.deposit > 0n) {
    if (stRecord?.deposits?.length)
      note(
        `stNEAR treasury already holds a recorded deposit; deposit more with the treasury script`,
        { reused: true },
      );
    else
      await send(
        "stnear-treasury",
        `stake ${formatNear(st.deposit)} NEAR with ${st.contract}`,
        () => chain.call(st.contract, "deposit_and_stake", {}, st.deposit),
      );
  }

  if (!execute)
    return {
      status: "planned",
      network: plan.network,
      needed,
      steps,
      manifests: null,
    };

  const at = clock().toISOString();
  const manifests = {};
  if (b)
    manifests[`native-badges-${plan.network}.json`] = {
      network: plan.network,
      verifiedAt: at,
      contractId: b.accountId,
      codeHash: b.codeHash,
      wasmSha256: b.wasmSha256,
      claimSignerPublicKey: b.init.claim_signer,
      minterPublicKey: minterRecord.publicKey,
      badgeBaseYocto: deployed.badges?.badge_base_yocto ?? null,
      perClaimYocto: deployed.badges?.per_claim_yocto ?? null,
      transferable: false,
      capabilities: [
        "soulbound",
        "signed-claims",
        "creator-award",
        "sponsored-create",
        "nep171-views",
        "budget-refund",
      ],
      transactions: transactions.badges ?? [],
    };
  if (g)
    manifests[`native-npc-games-${plan.network}.json`] = {
      network: plan.network,
      verifiedAt: at,
      contractId: g.accountId,
      codeHash: g.codeHash,
      wasmSha256: g.wasmSha256,
      ticketSignerPublicKey: g.init.ticket_signer,
      timeoutBlocks: g.init.timeout_blocks,
      minRevealDelayBlocks: deployed["npc-games"]?.min_reveal_delay_blocks ?? 3,
      tables: {
        [g.table.table_id]: { tiers: g.table.tiers, minimum: g.table.minimum },
      },
      wagering: false,
      capabilities: [
        "earned-tickets-only",
        "commit-reveal",
        "random-seed",
        "timeout-minimum",
        "daily-caps",
      ],
      transactions: transactions["npc-games"] ?? [],
    };
  if (e && editions)
    manifests[`native-editions-${plan.network}.json`] = {
      verifiedAt: at,
      network: plan.network,
      contractId: collectiblesId,
      wasmSha256: e.wasmSha256,
      supportedEditions: editions,
      transactions: [],
    };
  if (st?.deposit > 0n && transactions["stnear-treasury"]?.length)
    manifests[`stnear-treasury-${plan.network}.json`] = {
      network: plan.network,
      account: st.account,
      contract: st.contract,
      rewardsContract: null,
      receiptPrefix: "stnear-yield-",
      principal: String(st.deposit),
      deposits: [
        {
          at,
          near: String(st.deposit),
          stnear: String((st.deposit * NEAR) / st.price),
          transaction: transactions["stnear-treasury"][0].transaction,
        },
      ],
      harvests: [],
      withdrawals: [],
      updatedAt: at,
      transactions: transactions["stnear-treasury"],
    };
  return {
    status: "deployed",
    network: plan.network,
    needed,
    steps,
    transactions: Object.values(transactions).flat(),
    manifests,
  };
}
