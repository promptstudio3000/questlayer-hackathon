export type VaultConfig = {
  appOrigin: string;
  vaultOrigin: string;
  rpcUrl: string;
  network: "testnet";
  contracts: {
    qgold?: string;
    qgoldEscrow?: string;
    collectibles?: string;
    npcGames?: string;
    social?: string;
  };
};
export type VaultAction =
  | {
      kind: "functionCall";
      methodName: string;
      args: Record<string, unknown>;
      gas: string;
      deposit: string;
    }
  | { kind: "addKey" | "deleteKey"; publicKey: string };
export type VaultCall = {
  accountId: string;
  receiverId: string;
  actions: VaultAction[];
};
const need = (ok: unknown, message: string) => {
  if (!ok) throw Error(message);
};
export function validateVaultOrigins(config: VaultConfig) {
  const app = new URL(config.appOrigin),
    vault = new URL(config.vaultOrigin),
    rpc = new URL(config.rpcUrl);
  const local = (u: URL) =>
    u.protocol === "http:" && ["127.0.0.1", "localhost"].includes(u.hostname);
  need(
    app.origin === config.appOrigin &&
      vault.origin === config.vaultOrigin &&
      app.origin !== vault.origin,
    "The signer must use a separate, exact origin.",
  );
  need(
    [app, vault, rpc].every((u) => u.protocol === "https:" || local(u)),
    "Signer connections must be secure or loopback-only.",
  );
  need(
    ![app, vault, rpc].some((u) => u.username || u.password),
    "Signer URLs must not contain credentials.",
  );
  need(config.network === "testnet", "This signer candidate is testnet-only.");
  // Cross-site third-party cookies are not a reliable recovery channel.
  // Operators must configure a separate same-site origin and verify devices.
  return config;
}
export function validateVaultCall(call: VaultCall, accountId: string) {
  need(
    call.accountId === accountId &&
      /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/.test(call.receiverId) &&
      call.receiverId.length <= 64,
    "The signing account or receiver changed.",
  );
  need(
    Array.isArray(call.actions) && call.actions.length === 1,
    "Only one reviewed action can be signed.",
  );
  const a = call.actions[0];
  if (a.kind === "functionCall") {
    need(
      /^[a-zA-Z0-9_]{1,64}$/.test(a.methodName) &&
        a.args &&
        typeof a.args === "object" &&
        !Array.isArray(a.args),
      "Invalid contract call.",
    );
    need(
      /^[0-9]{1,39}$/.test(a.deposit) &&
        /^[0-9]{1,15}$/.test(a.gas) &&
        BigInt(a.gas) > 0n &&
        BigInt(a.gas) <= 300000000000000n,
      "Invalid call budget.",
    );
    need(
      JSON.stringify(a.args).length <= 16384,
      "The signing request is too large.",
    );
  } else {
    need(
      ["addKey", "deleteKey"].includes(a.kind) &&
        call.receiverId === accountId &&
        /^ed25519:[1-9A-HJ-NP-Za-km-z]{43,44}$/.test(a.publicKey),
      "Invalid account key change.",
    );
  }
  return call;
}
/** The isolated origin, rather than the game window, makes this decision. */
export async function needsProtection(
  call: VaultCall,
  config: VaultConfig,
  purchase: (
    memo: string,
  ) => Promise<{
    accountId: string;
    contractId: string;
    amount: string;
    memo: string;
    state: string;
  }>,
  funding?: (
    id: string,
  ) => Promise<{
    signerId: string;
    receiverId: string;
    methodName: string;
    args: Record<string, unknown>;
    gas: string;
    deposit: string;
  }>,
) {
  const a = call.actions[0];
  if (a.kind !== "functionCall") return true;
  if (
    call.receiverId === config.contracts.qgold &&
    a.methodName === "ft_burn"
  ) {
    need(
      a.deposit === "1" &&
        a.gas === "30000000000000" &&
        typeof a.args.memo === "string" &&
        typeof a.args.amount === "string" &&
        Object.keys(a.args).length === 2,
      "Invalid purchase payment.",
    );
    const p = await purchase(String(a.args.memo));
    need(
      p.state === "prepared" &&
        p.accountId === call.accountId &&
        p.contractId === call.receiverId &&
        p.amount === a.args.amount &&
        p.memo === a.args.memo,
      "The server has not authorized this exact purchase payment.",
    );
    return false;
  }
  if (
    call.receiverId === config.contracts.qgold &&
    a.methodName === "ft_transfer_call" &&
    config.contracts.qgoldEscrow &&
    a.args.receiver_id === config.contracts.qgoldEscrow &&
    funding
  ) {
    need(typeof a.args.msg === "string", "Invalid escrow funding.");
    const msg = JSON.parse(String(a.args.msg));
    // Peer-to-peer transfers remain protected. A task/Secret payment is silent
    // only when the authenticated server independently returns the exact terms.
    if (["task", "secret"].includes(msg.kind) && typeof msg.id === "string") {
      const p = await funding(msg.id);
      need(
        p.signerId === call.accountId &&
          p.receiverId === call.receiverId &&
          p.methodName === a.methodName &&
          p.gas === a.gas &&
          p.deposit === a.deposit &&
          Object.keys(a.args).length === Object.keys(p.args).length &&
          Object.keys(p.args).every((k) => p.args[k] === a.args[k]),
        "The server has not authorized this exact escrow payment.",
      );
      return false;
    }
  }
  if (
    call.receiverId === config.contracts.collectibles &&
    ["0", "1", "50000000000000000000000"].includes(a.deposit)
  ) {
    if (a.methodName === "mint_avatar" && Object.keys(a.args).length === 0)
      return false;
    const slot =
      a.args.slot === undefined ||
      ["above", "below"].includes(String(a.args.slot));
    if (
      a.methodName === "equip_aura" &&
      a.deposit === "0" &&
      Object.keys(a.args).every((k) => ["token_id", "slot"].includes(k)) &&
      typeof a.args.token_id === "string" &&
      slot
    )
      return false;
    if (
      a.methodName === "unequip_aura" &&
      a.deposit === "0" &&
      Object.keys(a.args).length === 1 &&
      ["above", "below"].includes(String(a.args.slot))
    )
      return false;
    if (a.methodName === "redeem_aura" && a.args.receiver_id === call.accountId)
      return false;
  }
  if (
    call.receiverId === config.contracts.npcGames &&
    a.deposit === "0" &&
    ["start_roll", "resolve_roll", "claim_timeout"].includes(a.methodName)
  )
    return false;
  if (
    call.receiverId === config.contracts.social &&
    a.methodName === "set" &&
    ["1", "50000000000000000000000"].includes(a.deposit)
  ) {
    const data = a.args.data;
    if (
      Object.keys(a.args).length === 1 &&
      data &&
      typeof data === "object" &&
      !Array.isArray(data) &&
      Object.keys(data).length === 1 &&
      Object.keys(data)[0] === call.accountId
    )
      return false;
  }
  return true;
}
export function trustedVaultMessage(
  event: { origin: string; source: unknown; data: unknown },
  origin: string,
  source: unknown,
) {
  if (
    event.origin !== origin ||
    event.source !== source ||
    !event.data ||
    typeof event.data !== "object"
  )
    return false;
  const d = event.data as Record<string, unknown>;
  return (
    d.channel === "questlayer-signing-vault" &&
    typeof d.id === "string" &&
    /^[0-9a-f-]{36}$/.test(d.id)
  );
}
