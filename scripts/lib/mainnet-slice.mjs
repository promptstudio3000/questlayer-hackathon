// The minimal mainnet slice (docs/MAINNET-PLAN.md §1) as one idempotent run:
// collectibles contract (deploy + init in one transaction, award signer),
// player factory and relayer service accounts, a pinned check of the NEAR
// Social contract, then the public manifests the server reads on that network.
//
// All chain access goes through a small `chain` adapter so the same code runs
// against near-api-js (scripts/deploy-mainnet-slice.mjs) and against the fake
// chain in tests/mainnet-slice.test.mjs. Without `execute` nothing is signed
// and nothing is written: the run only reads and reports what it would do.
import { createHash } from "node:crypto";

export const NEAR = 10n ** 24n;
export const SOCIAL_CONTRACTS = {
  testnet: "v1.social08.testnet",
  mainnet: "social.near",
};
// Same code on both networks (checked with view_account on 1 November 2026).
export const SOCIAL_CODE_HASH = "B5Yf5EquM36fGu3JNAD2K83fT6L4dpzcx8mYLnkjJJbS";
export const COLLECTIBLES_VERSION = 3;
export const AWARD_SIGNER_DEPOSIT = 1n;
// Runtime limits from docs/MAINNET-PLAN.md §1, written into the env snippet.
export const MAINNET_RUNTIME = {
  PLAYER_FACTORY_FUND_YOCTO: String((2n * NEAR) / 100n), // 0.02 NEAR
  RELAY_TOPUP_CAP_YOCTO: String((5n * NEAR) / 100n), // 0.05 NEAR
  RELAY_MAX_JOBS_PER_DAY: "40",
  MAINNET_FEATURES: "collectibles,relayer,social",
};

export class SliceError extends Error {
  constructor(message) {
    super(message);
    this.code = "MAINNET_SLICE";
  }
}
const refuse = (message) => {
  throw new SliceError(message);
};

const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
export function base58(bytes) {
  let n = BigInt("0x" + (Buffer.from(bytes).toString("hex") || "0"));
  let out = "";
  while (n > 0n) {
    out = ALPHABET[Number(n % 58n)] + out;
    n /= 58n;
  }
  for (const b of bytes) {
    if (b !== 0) break;
    out = "1" + out;
  }
  return out;
}
/** NEAR's code_hash for a WASM: base58 of its sha256. */
export const codeHash = (wasm) =>
  base58(createHash("sha256").update(wasm).digest());
export const sha256Hex = (wasm) =>
  createHash("sha256").update(wasm).digest("hex");

/** "1", "0.5", "12.25" NEAR (at most 4 decimals, at most 9999) to yocto. */
export function nearAmount(name, raw) {
  const text = String(raw ?? "");
  const m = /^(0|[1-9][0-9]{0,3})(?:\.([0-9]{1,4}))?$/.exec(text);
  if (!m)
    refuse(`${name} must be a NEAR amount like 5 or 0.5 (got "${text}").`);
  const yocto =
    BigInt(m[1]) * NEAR + BigInt((m[2] || "").padEnd(4, "0")) * 10n ** 20n;
  if (yocto === 0n) refuse(`${name} must be more than zero.`);
  return yocto;
}
export const formatNear = (yocto) => {
  const whole = yocto / NEAR,
    frac = String(yocto % NEAR)
      .padStart(24, "0")
      .slice(0, 4)
      .replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : String(whole);
};

const TESTNET_FUNDS = {
  COLLECTIBLES_FUND_NEAR: "5",
  PLAYER_FACTORY_FUND_NEAR: "20",
  RELAYER_FUND_NEAR: "5",
};
// NEAR storage staking: 1e19 yocto per byte. The contract account must hold its
// code plus initial state, so its funding has to cover the WASM size and a
// margin, or create+deploy+init fails with LackBalanceForState.
export const STORAGE_YOCTO_PER_BYTE = 10n ** 19n;
export const COLLECTIBLES_STATE_MARGIN = NEAR / 2n;
// Spare balance the operator must keep after the run (gas, later upgrades).
const OPERATOR_RESERVE = NEAR;

/**
 * Pure plan: account names, amounts, expected code. Mainnet requires every
 * amount and the reviewed WASM fingerprint to be written down explicitly.
 */
export function slicePlan({
  network,
  operatorId,
  env = {},
  wasm,
  awardPublicKey,
  stamp,
}) {
  if (!["testnet", "mainnet"].includes(network)) refuse("Unknown network.");
  if (!wasm?.length)
    refuse("The collectibles WASM is missing; run scripts/build-contracts.sh.");
  if (!/^[A-Za-z0-9+/]{43}=$/.test(awardPublicKey || ""))
    refuse("The award signer public key must be 32 bytes of base64.");
  const fund = (name) =>
    env[name] === undefined && network === "testnet"
      ? nearAmount(name, TESTNET_FUNDS[name])
      : nearAmount(name, env[name]);
  const wasmSha256 = sha256Hex(wasm);
  const reviewed = env.COLLECTIBLES_WASM_SHA256;
  if (network === "mainnet" && !reviewed)
    refuse(
      "Mainnet requires COLLECTIBLES_WASM_SHA256 set to the reviewed build's sha256.",
    );
  if (reviewed && reviewed.toLowerCase() !== wasmSha256)
    refuse(
      `The collectibles WASM sha256 is ${wasmSha256}, not the reviewed ${reviewed}.`,
    );
  const minimumFund =
    BigInt(wasm.length) * STORAGE_YOCTO_PER_BYTE + COLLECTIBLES_STATE_MARGIN;
  const collectiblesFund = fund("COLLECTIBLES_FUND_NEAR");
  if (collectiblesFund < minimumFund)
    refuse(
      `COLLECTIBLES_FUND_NEAR must be at least ${formatNear(minimumFund)} NEAR for ${wasm.length} bytes of code plus state.`,
    );
  const suffix = `.${operatorId}`;
  const named = (key, fallback) => {
    const id = env[key] || fallback;
    if (!id.endsWith(suffix) || id.slice(0, -suffix.length).includes("."))
      refuse(`${key} (${id}) must be a direct sub-account of ${operatorId}.`);
    return id;
  };
  const plan = {
    network,
    operator: operatorId,
    collectibles: {
      accountId: named("COLLECTIBLES_ACCOUNT", `nfts${suffix}`),
      fund: collectiblesFund,
      codeHash: codeHash(wasm),
      wasmSha256,
      wasmBytes: wasm.length,
      init: { owner_id: operatorId, oracle_id: operatorId },
      awardPublicKey,
    },
    factory: {
      accountId: named("PLAYER_FACTORY_ACCOUNT", `play-${stamp}${suffix}`),
      fund: fund("PLAYER_FACTORY_FUND_NEAR"),
      keyFile: keyFileName(network, "player-factory"),
      role: "player factory (creates and funds player sub-accounts)",
    },
    relayer: {
      accountId: named("RELAYER_ACCOUNT", `relay-${stamp}${suffix}`),
      fund: fund("RELAYER_FUND_NEAR"),
      keyFile: keyFileName(network, "relayer"),
      role: "relayer (pays gas for allowlisted delegate actions)",
    },
    social: {
      contractId: SOCIAL_CONTRACTS[network],
      codeHash: SOCIAL_CODE_HASH,
    },
  };
  plan.total = plan.collectibles.fund + plan.factory.fund + plan.relayer.fund;
  return plan;
}
// Always network-suffixed, so a testnet rehearsal never touches the live
// testnet service keys (.data/player-factory.json, .data/relayer.json).
export const keyFileName = (network, name) => `.data/${name}-${network}.json`;

/** JSON-friendly copy of a plan (bigints as NEAR strings). */
export function describePlan(plan) {
  return JSON.parse(
    JSON.stringify(plan, (_, v) => (typeof v === "bigint" ? formatNear(v) : v)),
  );
}

/**
 * Runs the slice. `chain` must provide:
 *   chainId(), account(id) -> {amount, code_hash} | null, view(id, method, args),
 *   deployContractAccount({accountId, fund, wasm, initArgs}) -> txHash,
 *   createAccount({accountId, publicKey, fund}) -> txHash,
 *   call(contractId, method, args, deposit) -> txHash.
 * `keys` provides read(file) -> record | null and create(file, record) (exclusive),
 * plus newKeyPair() -> {publicKey, secretKey}.
 */
export async function runSlice({
  plan,
  chain,
  keys,
  execute = false,
  wasm,
  clock = () => new Date(),
}) {
  const steps = [];
  const transactions = [];
  const note = (step, detail = {}) => steps.push({ step, ...detail });
  const send = async (label, fn) => {
    if (!execute) return note(label, { planned: true });
    const transaction = await fn();
    if (typeof transaction !== "string" || !transaction)
      refuse(`${label}: no transaction hash returned.`);
    transactions.push({ step: label, transaction });
    note(label, { transaction });
  };

  const chainId = await chain.chainId();
  if (chainId !== plan.network)
    refuse(`The RPC node serves ${chainId}, not ${plan.network}.`);

  const operator = await chain.account(plan.operator);
  if (!operator)
    refuse(`The operator ${plan.operator} does not exist on ${plan.network}.`);

  // Collectibles: absent -> deploy; present -> must already be this code.
  const c = plan.collectibles;
  const existing = await chain.account(c.accountId);
  const toCreate = [];
  if (existing) {
    if (existing.code_hash !== c.codeHash)
      refuse(
        `${c.accountId} exists with code ${existing.code_hash}, not the reviewed ${c.codeHash}. Upgrades are a separate, reviewed step.`,
      );
    const version = await chain.view(c.accountId, "get_version");
    if (version !== COLLECTIBLES_VERSION)
      refuse(
        `${c.accountId} reports version ${version}, expected ${COLLECTIBLES_VERSION}.`,
      );
    note(`collectibles ${c.accountId} already deployed`, { reused: true });
  } else toCreate.push(c.fund);

  // Service accounts: key files are created once (exclusive), accounts once.
  const services = [];
  for (const s of [plan.factory, plan.relayer]) {
    let record = keys.read(s.keyFile);
    if (record) {
      if (record.network !== plan.network)
        refuse(
          `${s.keyFile} is a ${record.network} key file, not ${plan.network}.`,
        );
      if (record.accountId !== s.accountId)
        refuse(
          `${s.keyFile} belongs to ${record.accountId}; set the matching account env or move the file.`,
        );
    }
    const onChain = await chain.account(s.accountId);
    if (onChain && !record)
      refuse(
        `${s.accountId} exists but ${s.keyFile} is missing; restore the key file first.`,
      );
    if (!onChain) toCreate.push(s.fund);
    services.push({ ...s, record, onChain: !!onChain });
  }

  const needed = toCreate.reduce((a, b) => a + b, 0n);
  const balance = BigInt(operator.amount);
  if (needed > 0n && balance < needed + OPERATOR_RESERVE)
    refuse(
      `The operator holds ${formatNear(balance)} NEAR; this run needs ${formatNear(needed)} NEAR plus a ${formatNear(OPERATOR_RESERVE)} NEAR reserve.`,
    );
  note("operator balance", {
    balance: formatNear(balance),
    needed: formatNear(needed),
  });

  if (!existing)
    await send(`create ${c.accountId}, deploy and init collectibles`, () =>
      chain.deployContractAccount({
        accountId: c.accountId,
        fund: c.fund,
        wasm,
        initArgs: c.init,
      }),
    );
  if (execute && !existing) {
    const after = await chain.account(c.accountId);
    if (after?.code_hash !== c.codeHash)
      refuse(`${c.accountId} did not end up with the reviewed code.`);
    if ((await chain.view(c.accountId, "get_version")) !== COLLECTIBLES_VERSION)
      refuse(
        `${c.accountId} did not initialise as version ${COLLECTIBLES_VERSION}.`,
      );
  }

  const signer =
    existing || execute
      ? await chain.view(c.accountId, "get_award_signer")
      : null;
  if (signer && signer !== c.awardPublicKey)
    refuse(
      `${c.accountId} trusts award signer ${signer}, not ${c.awardPublicKey}.`,
    );
  if (!signer)
    await send("configure the award signer public key", () =>
      chain.call(
        c.accountId,
        "set_award_signer",
        { public_key: c.awardPublicKey },
        AWARD_SIGNER_DEPOSIT,
      ),
    );
  if (
    execute &&
    !signer &&
    (await chain.view(c.accountId, "get_award_signer")) !== c.awardPublicKey
  )
    refuse("The award signer did not take effect.");

  for (const s of services) {
    if (!s.record && execute) {
      const pair = keys.newKeyPair();
      s.record = {
        network: plan.network,
        accountId: s.accountId,
        publicKey: pair.publicKey,
        secretKey: pair.secretKey,
        role: s.role,
      };
      keys.create(s.keyFile, s.record);
      note(`wrote ${s.keyFile}`);
    } else if (!s.record) note(`write ${s.keyFile}`, { planned: true });
    if (!s.onChain)
      await send(`create ${s.accountId} (${formatNear(s.fund)} NEAR)`, () =>
        chain.createAccount({
          accountId: s.accountId,
          publicKey: s.record.publicKey,
          fund: s.fund,
        }),
      );
    else note(`${s.accountId} already exists`, { reused: true });
  }

  const social = await chain.account(plan.social.contractId);
  if (social?.code_hash !== plan.social.codeHash)
    refuse(
      `${plan.social.contractId} code is ${social?.code_hash ?? "missing"}, not the pinned ${plan.social.codeHash}.`,
    );
  note(`${plan.social.contractId} code matches the pinned hash`);

  if (!execute)
    return {
      status: "planned",
      network: plan.network,
      steps,
      manifests: null,
      runtimeEnv: null,
    };

  const at = clock().toISOString();
  const manifests = {
    [`${plan.network}-deployment.json`]: {
      network: plan.network,
      verifiedAt: at,
      gameContract: null,
      collectiblesContract: c.accountId,
      operator: plan.operator,
      slice: MAINNET_RUNTIME.MAINNET_FEATURES.split(","),
      playerFactory: plan.factory.accountId,
      relayer: plan.relayer.accountId,
      socialContract: plan.social.contractId,
      transactions,
    },
    [`native-claims-${plan.network}.json`]: {
      verifiedAt: at,
      network: plan.network,
      contractId: c.accountId,
      version: COLLECTIBLES_VERSION,
      attestationPublicKey: c.awardPublicKey,
      codeHash: c.codeHash,
      wasmSha256: c.wasmSha256,
      transactions: transactions.filter(
        (t) => !/^create (play|relay)-/.test(t.step),
      ),
    },
  };
  const runtimeEnv = {
    NEAR_NETWORK: plan.network,
    VITE_NEAR_NETWORK: plan.network,
    ...(plan.network === "mainnet" ? MAINNET_RUNTIME : {}),
    PLAYER_FACTORY_ACCOUNT: plan.factory.accountId,
    PLAYER_FACTORY_KEY_PATH: plan.factory.keyFile,
    RELAYER_KEY_PATH: plan.relayer.keyFile,
  };
  return {
    status: "deployed",
    network: plan.network,
    steps,
    transactions,
    manifests,
    runtimeEnv,
  };
}

export const runtimeEnvText = (env) =>
  Object.entries(env)
    .map(([k, v]) => `${k}=${v}`)
    .join("\n") + "\n";
