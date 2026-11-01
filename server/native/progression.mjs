import { createHash } from "node:crypto";
import { assert } from "../domain.mjs";
import { levelItemMilestones } from "../levels.mjs";
import { atomic } from "../database.mjs";
import { nearAccountId } from "../identity/near.mjs";
import { awardMessage } from "./award-vouchers.mjs";
import { NETWORK, NETWORK_LABEL, onNetwork } from "./network.mjs";

export const NATIVE_LEVEL_POLICY = "native-xp-level-v1";
export const NATIVE_LEVEL_MILESTONES = Object.freeze([
  Object.freeze({
    level: 2,
    requiredXp: "100",
    edition: "polar",
    name: "Northern Lights",
  }),
  Object.freeze({
    level: 3,
    requiredXp: "400",
    edition: "moon",
    name: "Moonwake Aura",
  }),
  Object.freeze({
    level: 4,
    requiredXp: "900",
    edition: "gold",
    name: "Sunlit Aura",
  }),
]);
/**
 * Native level milestones: the reviewed L2-L4 Auras plus level-item editions
 * from server/data/level-table.json when LEVEL_ITEM_EDITIONS=1. An item edition
 * must be one the deployed collectibles contract mints and is not claim-only;
 * otherwise its claim stays unavailable (the contract rejects it).
 */
export function nativeLevelMilestones() {
  const extra = levelItemMilestones().filter(
    (m) => !NATIVE_LEVEL_MILESTONES.some((base) => base.level === m.level),
  );
  return extra.length ? Object.freeze([...NATIVE_LEVEL_MILESTONES, ...extra.map((m) => Object.freeze(m))]) : NATIVE_LEVEL_MILESTONES;
}

function exactXp(value) {
  assert(
    (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) ||
      (typeof value === "string" && /^(0|[1-9][0-9]{0,19})$/.test(value)),
    "Confirmed XP is not an exact nonnegative integer.",
    503,
  );
  const xp = BigInt(value);
  assert(
    xp <= 18446744073709551615n,
    "Confirmed XP exceeds its contract bound.",
    503,
  );
  return xp;
}
export function nativeLevelProgress(value) {
  const xp = exactXp(value),
    n = xp / 100n;
  let low = 0n,
    high = n + 1n;
  while (low + 1n < high) {
    const middle = (low + high) / 2n;
    if (middle * middle <= n) low = middle;
    else high = middle;
  }
  const level = low + 1n,
    next = 100n * level * level;
  return {
    xp: xp.toString(),
    level: Number(level),
    levelStartXp: (100n * low * low).toString(),
    nextLevelXp: next.toString(),
    xpToNextLevel: (next - xp).toString(),
  };
}
function fingerprint(hex) {
  if (typeof hex !== "string" || !/^[a-f0-9]{64}$/i.test(hex)) return null;
  const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  let number = BigInt("0x" + hex),
    out = "";
  while (number > 0n) {
    out = alphabet[Number(number % 58n)] + out;
    number /= 58n;
  }
  for (let i = 0; i < hex.length && hex.slice(i, i + 2) === "00"; i += 2)
    out = "1" + out;
  return out;
}
export function nativeLevelClaimId(
  sourceContractId,
  contractId,
  accountId,
  level,
) {
  return (
    "earned:level:" +
    createHash("sha256")
      .update(
        JSON.stringify([
          NATIVE_LEVEL_POLICY,
          NETWORK,
          sourceContractId,
          contractId,
          accountId,
          level,
        ]),
      )
      .digest("hex")
  );
}

// Public chain state is authoritative. This service never reads demo XP, inventory,
// session-local progress or locally queued receipts, and never signs a transaction.
export class NativeProgression {
  constructor(
    nativeRewards,
    nativeCollectibles,
    signer,
    {
      clock = Date.now,
      ttlMs = 15 * 60000,
      timeoutMs = 8000,
      collectiblesCodeHash,
      collectiblesWasmSha256,
    } = {},
  ) {
    this.native = nativeRewards;
    this.db = nativeRewards.db;
    this.provider = nativeRewards.provider;
    this.contractId = nativeCollectibles.contractId;
    this.sourceContractId = nativeRewards.contractId;
    this.signer = signer;
    this.clock = clock;
    this.ttlMs = ttlMs;
    this.timeoutMs = timeoutMs;
    this.collectiblesCodeHash =
      collectiblesCodeHash || fingerprint(collectiblesWasmSha256);
    for (const account of [this.contractId, this.sourceContractId]) {
      nearAccountId(account);
      assert(onNetwork(account), `Native progression is ${NETWORK}-only.`);
    }
    assert(
      Number.isSafeInteger(ttlMs) && ttlMs > 0 && ttlMs <= 15 * 60000,
      "Invalid level claim lifetime.",
    );
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS native_level_observations(
        source_contract TEXT NOT NULL,account_id TEXT NOT NULL,body TEXT NOT NULL,
        PRIMARY KEY(source_contract,account_id));
      CREATE TABLE IF NOT EXISTS native_level_awards(
        claim_id TEXT PRIMARY KEY,network TEXT NOT NULL,source_contract TEXT NOT NULL,
        contract_id TEXT NOT NULL,receiver_id TEXT NOT NULL,level INTEGER NOT NULL,
        policy TEXT NOT NULL,edition TEXT NOT NULL,state TEXT NOT NULL,
        expires_at INTEGER NOT NULL,token_id TEXT,created_at INTEGER NOT NULL,
        confirmed_at INTEGER,xp TEXT NOT NULL,block_hash TEXT NOT NULL,
        UNIQUE(network,source_contract,contract_id,receiver_id,level));
    `);
  }
  linked(player, accountId) {
    nearAccountId(accountId);
    this.native.linked(player, accountId);
  }
  identity(accountId) {
    return {
      network: NETWORK,
      accountId,
      sourceContractId: this.sourceContractId,
      contractId: this.contractId,
      policy: NATIVE_LEVEL_POLICY,
    };
  }
  previous(accountId) {
    const row = this.db
      .prepare(
        "SELECT body FROM native_level_observations WHERE source_contract=? AND account_id=?",
      )
      .get(this.sourceContractId, accountId);
    return row ? JSON.parse(row.body) : null;
  }
  award(accountId, level) {
    return this.db
      .prepare("SELECT * FROM native_level_awards WHERE claim_id=?")
      .get(
        nativeLevelClaimId(
          this.sourceContractId,
          this.contractId,
          accountId,
          level,
        ),
      );
  }
  async bounded(work) {
    let timer;
    try {
      return await Promise.race([
        work,
        new Promise((_, reject) => {
          timer = setTimeout(
            () =>
              reject(new Error("Native progression observation timed out.")),
            this.timeoutMs,
          );
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }
  async query(block, account, request) {
    const result = await this.bounded(
      this.provider.query({
        ...request,
        account_id: account,
        block_id: block.hash,
      }),
    );
    assert(
      result.block_hash === block.hash && result.block_height === block.height,
      "The progression observation anchor changed.",
      503,
    );
    return result;
  }
  async view(block, account, method, args = {}) {
    const response = await this.query(block, account, {
      request_type: "call_function",
      method_name: method,
      args_base64: Buffer.from(JSON.stringify(args)).toString("base64"),
    });
    assert(
      Array.isArray(response.result) && response.result.length < 50000,
      "The progression response exceeds its bound.",
      503,
    );
    return JSON.parse(Buffer.from(response.result).toString());
  }
  async code(block, account, expected) {
    assert(
      typeof expected === "string" && expected.length >= 32,
      "No reviewed contract fingerprint is configured.",
      503,
    );
    const state = await this.query(block, account, {
      request_type: "view_account",
    });
    assert(
      state.code_hash === expected,
      "The native contract fingerprint changed.",
      503,
    );
  }
  async observe(accountId) {
    const network = await this.bounded(this.provider.viewNodeStatus());
    assert(
      network.chain_id === NETWORK && network.sync_info?.syncing === false,
      `A synchronized ${NETWORK_LABEL} observation is required.`,
      503,
    );
    const block = (
      await this.bounded(this.provider.viewBlock({ finality: "final" }))
    ).header;
    const blockTimestampMs = Number(BigInt(block.timestamp_nanosec) / 1000000n);
    assert(
      typeof block.hash === "string" &&
        Number.isSafeInteger(block.height) &&
        block.height >= 0 &&
        Number.isSafeInteger(blockTimestampMs) &&
        blockTimestampMs <= this.clock() + 15000 &&
        blockTimestampMs >= this.clock() - 120000,
      "A fresh finalized block is unavailable.",
      503,
    );
    await this.code(block, this.sourceContractId, this.native.config.codeHash);
    const [config, account] = await Promise.all([
      this.view(block, this.sourceContractId, "get_config"),
      this.view(block, this.sourceContractId, "get_account", {
        account_id: accountId,
      }),
    ]);
    assert(
      config.network === NETWORK && config.version === 1,
      "Unsupported native progression source.",
      503,
    );
    const progress = {
      ...this.identity(accountId),
      ...nativeLevelProgress(account.xp),
      lockedXp: "0",
      observedAt: new Date(this.clock()).toISOString(),
      blockHash: block.hash,
      blockHeight: block.height,
      blockTimestampMs,
    };
    atomic(this.db, () => {
      const previous = this.previous(accountId);
      assert(
        !previous ||
          (block.height >= previous.blockHeight &&
            (block.height !== previous.blockHeight ||
              (block.hash === previous.blockHash &&
                progress.xp === previous.xp)) &&
            BigInt(progress.xp) >= BigInt(previous.xp)),
        "Finalized native progression regressed; reconciliation is required.",
        503,
      );
      this.db
        .prepare(
          "INSERT INTO native_level_observations VALUES(?,?,?) ON CONFLICT(source_contract,account_id) DO UPDATE SET body=excluded.body",
        )
        .run(this.sourceContractId, accountId, JSON.stringify(progress));
    });
    return { progress, block };
  }
  rememberMint(progress, milestone, receipt) {
    const claimId = nativeLevelClaimId(
      this.sourceContractId,
      this.contractId,
      progress.accountId,
      milestone.level,
    );
    assert(
      receipt.receiver_id === progress.accountId &&
        receipt.edition === milestone.edition &&
        new RegExp(`^aura:${milestone.edition}:([1-9][0-9]{0,2})$`).test(
          receipt.token_id,
        ) &&
        Number(receipt.token_id.split(":")[2]) <= 256,
      "The level claim receipt does not match its entitlement.",
      503,
    );
    atomic(this.db, () => {
      const old = this.award(progress.accountId, milestone.level);
      assert(
        !old?.token_id || old.token_id === receipt.token_id,
        "A confirmed level claim changed token.",
        503,
      );
      this.db
        .prepare(
          `INSERT INTO native_level_awards VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT(claim_id) DO UPDATE SET state='minted',token_id=excluded.token_id,confirmed_at=COALESCE(native_level_awards.confirmed_at,excluded.confirmed_at)`,
        )
        .run(
          claimId,
          NETWORK,
          this.sourceContractId,
          this.contractId,
          progress.accountId,
          milestone.level,
          NATIVE_LEVEL_POLICY,
          milestone.edition,
          "minted",
          old?.expires_at || 0,
          receipt.token_id,
          old?.created_at || this.clock(),
          this.clock(),
          progress.xp,
          progress.blockHash,
        );
    });
  }
  unavailableMilestones(accountId) {
    return nativeLevelMilestones().map((milestone) => {
      const old = this.award(accountId, milestone.level);
      return {
        ...milestone,
        claimId: nativeLevelClaimId(
          this.sourceContractId,
          this.contractId,
          accountId,
          milestone.level,
        ),
        state: "unavailable",
        claimable: false,
        tokenId: old?.token_id || null,
        confirmedPreviously: old?.state === "minted",
      };
    });
  }
  async snapshot(player, accountId) {
    this.linked(player, accountId);
    let observation;
    try {
      observation = await this.observe(accountId);
    } catch {
      this.linked(player, accountId);
      const previous = this.previous(accountId);
      return {
        ...(previous || {
          ...this.identity(accountId),
          xp: null,
          level: null,
          nextLevelXp: null,
          xpToNextLevel: null,
          observedAt: null,
        }),
        status: previous ? "stale" : "unavailable",
        reason:
          "Confirmed NEAR XP is unavailable. No level claim can be issued.",
        milestones: this.unavailableMilestones(accountId),
      };
    }
    const { progress, block } = observation;
    let milestones;
    try {
      await this.code(block, this.contractId, this.collectiblesCodeHash);
      const [key, version, values] = await Promise.all([
        this.view(block, this.contractId, "get_award_signer"),
        this.view(block, this.contractId, "get_version"),
        Promise.all(
          nativeLevelMilestones().map(async (milestone) => {
            const claimId = nativeLevelClaimId(
              this.sourceContractId,
              this.contractId,
              accountId,
              milestone.level,
            );
            const [receipt, minted] = await Promise.all([
              this.view(block, this.contractId, "get_claim", {
                claim_id: claimId,
              }),
              this.view(block, this.contractId, "edition_minted", {
                edition: milestone.edition,
              }),
            ]);
            assert(
              Number.isSafeInteger(minted) && minted >= 0 && minted <= 256,
              "Invalid native edition supply.",
              503,
            );
            return { milestone, claimId, receipt, minted };
          }),
        ),
      ]);
      assert(
        version === 3,
        "Native level claims require the reviewed V3 contract.",
        503,
      );
      const enabled = !!this.signer && key === this.signer.publicKey;
      milestones = values.map(({ milestone, claimId, receipt, minted }) => {
        const prior = this.award(accountId, milestone.level);
        assert(
          !(prior?.state === "minted" && !receipt),
          "A finalized level mint disappeared; reconciliation is required.",
          503,
        );
        if (receipt) this.rememberMint(progress, milestone, receipt);
        const earned = BigInt(progress.xp) >= BigInt(milestone.requiredXp);
        const state = receipt
          ? "minted"
          : !earned
            ? "locked"
            : !enabled
              ? "unavailable"
              : minted === 256
                ? "sold_out"
                : prior
                  ? "issued"
                  : "available";
        return {
          ...milestone,
          claimId,
          state,
          claimable: enabled && earned && !receipt && minted < 256,
          tokenId: receipt?.token_id || null,
          remaining: 256 - minted,
          expiresAt: prior?.expires_at || null,
        };
      });
    } catch {
      milestones = this.unavailableMilestones(accountId);
    }
    // An account can be unlinked while awaiting RPC. Recheck before revealing or issuing.
    this.linked(player, accountId);
    return { ...progress, status: "available", milestones };
  }
  asClaim(row) {
    const claim = {
      ...row,
      contractId: this.contractId,
      sourceContractId: this.sourceContractId,
    };
    const message = awardMessage(this.contractId, claim);
    return {
      ...claim,
      message,
      signature: row.state === "minted" ? "" : this.signer.sign(message),
    };
  }
  async issue(player, accountId, level) {
    assert(
      Number.isInteger(level) &&
        nativeLevelMilestones().some((entry) => entry.level === level),
      "Choose a supported level reward.",
    );
    const state = await this.snapshot(player, accountId);
    assert(
      state.status === "available",
      "Refresh confirmed NEAR XP before claiming a level reward.",
      503,
    );
    const milestone = state.milestones.find((entry) => entry.level === level);
    if (milestone.state === "minted")
      return this.asClaim(this.award(accountId, level));
    assert(
      milestone.state !== "locked",
      "Earn the required confirmed NEAR XP first.",
      409,
    );
    assert(
      milestone.state !== "sold_out",
      "This native edition is fully minted. The level remains unlocked.",
      409,
    );
    assert(
      milestone.claimable,
      "Native level claims are temporarily unavailable.",
      503,
    );
    const row = atomic(this.db, () => {
      this.linked(player, accountId);
      const old = this.award(accountId, level),
        expiresAt = Math.max(old?.expires_at || 0, this.clock() + this.ttlMs);
      if (old?.state === "minted") return old;
      this.db
        .prepare(
          `INSERT INTO native_level_awards VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT(claim_id) DO UPDATE SET expires_at=excluded.expires_at,xp=excluded.xp,block_hash=excluded.block_hash`,
        )
        .run(
          milestone.claimId,
          NETWORK,
          this.sourceContractId,
          this.contractId,
          accountId,
          level,
          NATIVE_LEVEL_POLICY,
          milestone.edition,
          "issued",
          expiresAt,
          null,
          old?.created_at || this.clock(),
          null,
          state.xp,
          state.blockHash,
        );
      return this.award(accountId, level);
    });
    return this.asClaim(row);
  }
  async confirm(player, accountId, level) {
    assert(
      Number.isInteger(level) &&
        nativeLevelMilestones().some((entry) => entry.level === level),
      "Choose a supported level reward.",
    );
    const state = await this.snapshot(player, accountId);
    assert(
      state.status === "available",
      "The finalized level claim is temporarily unavailable.",
      503,
    );
    const milestone = state.milestones.find((entry) => entry.level === level);
    assert(
      milestone.state !== "unavailable",
      "The finalized level claim is temporarily unavailable.",
      503,
    );
    const row = this.award(accountId, level);
    assert(row, "No native claim exists for this level.", 404);
    return this.asClaim(row);
  }
}
