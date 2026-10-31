import rewardsManifest from "../public/native-rewards-testnet.json" with { type: "json" };
// The factory of the current deployment generation, pinned by the public manifest.
export const NATIVE_VAULT_FACTORY: string = rewardsManifest.factory.contractId;
export type VaultRequest = {
  accountId: string;
  action:
    | "create"
    | "deposit"
    | "exit"
    | "withdraw"
    | "refresh"
    | "advance"
    | "register"
    | "refund";
  poolId?: string;
  contributionBps?: number;
  vaultId?: string;
  amount?: string;
  setupDeposit?: string;
  positionId?: string;
};
export type VaultQuote = {
  network: string;
  signerId: string;
  receiverId: string;
  factoryId: string;
  methodName: string;
  args: Record<string, unknown>;
  deposit: string;
  gas: string;
};
export function parseTestNear(text: string): string {
  if (!/^(0|[1-9]\d{0,3})(\.\d{1,24})?$/.test(text))
    throw Error("Enter a plain test NEAR amount with up to 24 decimal places.");
  const [whole, fraction = ""] = text.split(".");
  const amount = BigInt(whole) * 10n ** 24n + BigInt(fraction.padEnd(24, "0"));
  if (amount < 10n ** 21n || amount > 1000n * 10n ** 24n)
    throw Error("Stake between 0.001 and 1,000 test NEAR.");
  return amount.toString();
}
export function assertVaultQuote(q: VaultQuote, r: VaultRequest) {
  const methods = {
    create: "create_position",
    deposit: "deposit_and_stake",
    exit: "request_exit",
    withdraw: "withdraw_owner",
    refresh: "refresh",
    advance: "advance",
    register: "register_position",
    refund: "withdraw_refund",
  };
  const factory = ["create", "register", "refund"].includes(r.action),
    receiver = factory ? NATIVE_VAULT_FACTORY : r.vaultId;
  const deposit =
    r.action === "create"
      ? r.setupDeposit
      : r.action === "deposit"
        ? r.amount
        : ["exit", "withdraw", "refund"].includes(r.action)
          ? "1"
          : "0";
  const expectedArgs =
    r.action === "create"
      ? { pool_id: r.poolId, contribution_bps: r.contributionBps }
      : r.action === "register"
        ? { id: r.positionId }
        : {};
  if (
    q.network !== "testnet" ||
    q.signerId !== r.accountId ||
    q.factoryId !== NATIVE_VAULT_FACTORY ||
    q.receiverId !== receiver ||
    (!factory && !r.vaultId?.endsWith("." + NATIVE_VAULT_FACTORY)) ||
    q.methodName !== methods[r.action] ||
    q.deposit !== deposit ||
    q.gas !== "280000000000000" ||
    JSON.stringify(q.args) !== JSON.stringify(expectedArgs)
  )
    throw Error(
      "The staking transaction differs from the action you selected. Refresh before signing.",
    );
}
