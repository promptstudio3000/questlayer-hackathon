import { NativeContractReader } from "./reader.mjs";
import { assert } from "../domain.mjs";
import { nativeInteger, readStakingPool } from "./staking-pool.mjs";
export const FACTORY_ID = "questlayer-vaults-20261031.testnet";
export const VAULT_POOLS = [
  { id: "aurora.pool.f863973.m0", name: "Aurora validator" },
  { id: "stakely_v2.pool.f863973.m0", name: "Stakely validator" },
  { id: "ts.pool.f863973.m0", name: "TS validator" },
];
export class NativeVaults extends NativeContractReader {
  constructor(db, provider, configuration) {
    super(provider, configuration.factory.contractId);
    assert(this.contractId === FACTORY_ID, "Unexpected factory.");
    this.db = db;
    this.configuration = configuration;
  }
  async validate() {
    const code = await this.provider.query({
      request_type: "view_account",
      account_id: this.contractId,
      finality: "final",
    });
    assert(
      code.code_hash === this.configuration.factory.codeHash,
      "Factory code changed; new operations are paused.",
      503,
    );
    const cfg = await this.view("get_config");
    assert(
      cfg.rewards === this.configuration.contractId &&
        cfg.vault_sha256 === this.configuration.factory.vaultWasmSha256,
      "Factory source configuration changed.",
      503,
    );
    return cfg;
  }
  linked(player, account) {
    assert(
      typeof account === "string" &&
        this.db
          .prepare(
            "SELECT 1 FROM wallet_links WHERE player_id=? AND account_id=?",
          )
          .get(player, account),
      "Link this NEAR wallet first.",
      403,
    );
  }
  async positions(account = null, fresh = false) {
    await this.validate();
    const rows = await this.view(
      "get_positions",
      { beneficiary: account },
      fresh,
    );
    assert(
      Array.isArray(rows) && rows.length <= 32,
      "Invalid factory positions.",
      503,
    );
    return rows;
  }
  async allReady(account = null) {
    return (await this.positions(account))
      .filter((p) => p.state === "ready")
      .map((p) => ({
        accountId: p.account_id,
        beneficiary: p.beneficiary,
        codeHash: this.configuration.factory.vaultCodeHash,
      }));
  }
  async state(position) {
    const [code, keys] = await Promise.all([
      this.provider.query({
        request_type: "view_account",
        account_id: position.account_id,
        finality: "final",
      }),
      this.provider.query({
        request_type: "view_access_key_list",
        account_id: position.account_id,
        finality: "final",
      }),
    ]);
    assert(
      code.code_hash === this.configuration.factory.vaultCodeHash &&
        keys.keys.length === 0,
      "Vault code or keyless ownership changed.",
      503,
    );
    const s = await new NativeContractReader(
      this.provider,
      position.account_id,
    ).view("get_state", {}, true);
    assert(
      s.beneficiary === position.beneficiary &&
        s.pool === position.pool &&
        s.rewards === this.configuration.contractId,
      "Vault owner or strategy mismatch.",
      503,
    );
    return s;
  }
  async snapshot(player, account) {
    if (account) this.linked(player, account);
    const config = await this.validate(),
      positions = account ? await this.positions(account, true) : [];
    return {
      network: "testnet",
      factoryId: this.contractId,
      config,
      pools: VAULT_POOLS,
      positions: await Promise.all(
        positions.map(async (p) => ({
          ...p,
          position: p.state === "ready" ? await this.state(p) : null,
        })),
      ),
      refund: account
        ? await this.view("get_refund", { account_id: account }, true)
        : null,
    };
  }
  async prepare(player, input) {
    const { accountId, action } = input;
    this.linked(player, accountId);
    const cfg = await this.validate();
    let receiverId,
      methodName,
      args = {},
      deposit = "0";
    if (action === "create") {
      assert(
        VAULT_POOLS.some((p) => p.id === input.poolId) &&
          Number.isInteger(input.contributionBps) &&
          input.contributionBps >= 0 &&
          input.contributionBps <= 10000,
        "Choose a supported pool and a 0–100% contribution.",
      );
      assert(
        cfg.created < cfg.capacity,
        "The testnet vault pilot has reached its capacity.",
        409,
      );
      const block = await this.provider.viewBlock({ finality: "final" });
      const pool = await readStakingPool(
        this.provider,
        {
          accountId: input.poolId,
          expectedCodeHash: "J1arLz48fgXcGyCPVckFwLnewNH6j1uw79thsvwqGYTY",
        },
        block,
      );
      assert(
        pool.keyless && pool.fingerprintMatches && !pool.paused,
        "This validator is not ready for a new position.",
        503,
      );
      receiverId = this.contractId;
      methodName = "create_position";
      deposit = cfg.setup_deposit;
      args = { pool_id: input.poolId, contribution_bps: input.contributionBps };
    } else if (action === "refund") {
      receiverId = this.contractId;
      methodName = "withdraw_refund";
      deposit = "1";
    } else {
      const p = (await this.positions(accountId, true)).find(
        (p) => p.account_id === input.vaultId,
      );
      assert(p, "Only your own factory position can be operated.", 403);
      if (action === "register") {
        assert(
          p.state === "created",
          "This position is not waiting for registration.",
          409,
        );
        receiverId = this.contractId;
        methodName = "register_position";
        args = { id: p.id };
      } else {
        assert(
          p.state === "ready",
          "The position has not finished creating.",
          409,
        );
        const s = await this.state(p);
        receiverId = p.account_id;
        const methods = {
          deposit: "deposit_and_stake",
          exit: "request_exit",
          withdraw: "withdraw_owner",
          refresh: "refresh",
          advance: "advance",
        };
        methodName = methods[action];
        assert(methodName, "Unsupported vault action.");
        if (action === "deposit") {
          deposit = nativeInteger(input.amount).toString();
          assert(
            BigInt(deposit) >= 10n ** 21n &&
              BigInt(deposit) <= 1000n * 10n ** 24n,
            "Deposit between 0.001 and 1,000 test NEAR.",
          );
          assert(
            s.stage === "idle" && !s.exit_requested,
            "Wait for the current operation or exit.",
            409,
          );
        }
        if (action === "exit" || action === "withdraw") deposit = "1";
        if (action === "withdraw")
          assert(
            BigInt(s.owner_credit) > 0n && s.owner_pending === "0",
            "No liquid owner balance is ready.",
            409,
          );
      }
    }
    return {
      network: "testnet",
      signerId: accountId,
      receiverId,
      methodName,
      args,
      deposit,
      gas: "280000000000000",
      factoryId: this.contractId,
    };
  }
}
