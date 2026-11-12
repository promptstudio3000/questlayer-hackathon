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
    /** The NEAR Intents verifier and wNEAR: deposits into the player's own verifier account. */
    intents?: string;
    wnear?: string;
    treasuryDao?: string;
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
  /** The vault's own device key for this account (never one the game names). */
  devicePublicKey?: string,
) {
  const a = call.actions[0];
  if (a.kind !== "functionCall") return true;
  if (selfCustody(call, a, config, devicePublicKey)) return false;
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
  // Anything that moves QGOLD, NEAR or a collectible to a counterparty
  // (ft_transfer, ft_transfer_call into the escrow for a task, Secret or send,
  // nft_transfer, ...) falls through to the approval window. A server-side
  // "funding intent" is no substitute: a compromised game script holds the
  // player's session and can create that intent with itself as beneficiary.
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
  // A vote for a treasury DAO poll option (docs/TREASURY-DAO.md): no money moves.
  if (
    call.receiverId === config.contracts.treasuryDao &&
    a.deposit === "0" &&
    a.methodName === "act_proposal" &&
    Object.keys(a.args).sort().join() === "action,id,proposal" &&
    Number.isSafeInteger(a.args.id) &&
    a.args.action === "VoteApprove" &&
    a.args.proposal === "Vote"
  )
    return false;
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
/**
 * Setup steps that keep everything under the player's own control, so they
 * sign silently: turning this device's key on at the Intents verifier and
 * moving the player's own Aura or NEAR into the player's own verifier account.
 * Nothing here can reach another account: the verifier credits the sender
 * when `msg` is empty or names the sender, and only a key the vault holds can
 * later sign an intent that moves it (that intent is still confirmed).
 */
function selfCustody(
  call: VaultCall,
  a: Extract<VaultAction, { kind: "functionCall" }>,
  config: VaultConfig,
  devicePublicKey?: string,
) {
  const { intents, wnear, collectibles } = config.contracts,
    args = a.args,
    keys = (...k: string[]) =>
      Object.keys(args).length === k.length &&
      Object.keys(args).every((x) => k.includes(x)),
    toOwnVerifierAccount = (msg: unknown) =>
      msg === "" || msg === call.accountId;
  if (!intents) return false;
  if (call.receiverId === intents)
    return (
      ["add_public_key", "remove_public_key"].includes(a.methodName) &&
      a.deposit === "1" &&
      keys("public_key") &&
      // Only the device key the vault itself holds is turned on silently; a key
      // named by the game (another device, a linked wallet) is confirmed.
      (a.methodName === "remove_public_key" ||
        (!!devicePublicKey && args.public_key === devicePublicKey))
    );
  if (
    call.receiverId === collectibles &&
    a.methodName === "nft_transfer_call" &&
    a.deposit === "1" &&
    keys("receiver_id", "token_id", "approval_id", "memo", "msg") &&
    args.receiver_id === intents &&
    typeof args.token_id === "string" &&
    args.approval_id === null &&
    args.memo === null
  )
    return toOwnVerifierAccount(args.msg);
  if (wnear && call.receiverId === wnear) {
    if (a.methodName === "near_deposit") return keys();
    if (a.methodName === "storage_deposit")
      return (
        keys("account_id", "registration_only") &&
        args.account_id === call.accountId &&
        args.registration_only === true &&
        BigInt(a.deposit) <= 1250000000000000000000n
      );
    if (a.methodName === "ft_transfer_call")
      return (
        a.deposit === "1" &&
        keys("receiver_id", "amount", "msg") &&
        args.receiver_id === intents &&
        typeof args.amount === "string" &&
        /^[1-9][0-9]{0,38}$/.test(args.amount) &&
        toOwnVerifierAccount(args.msg)
      );
  }
  return false;
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

// ---- What the approval window shows (F3): plain words, decoded from the
// exact request that will be signed, never from text the game supplies.
export type ReviewLine = [label: string, value: string];
export type ReviewView = { lines: ReviewLine[]; warnings: string[] };
export type MessageReview = {
  account?: string;
  recipient?: string;
  authorization?: string;
  operation?: string;
  keyToRemove?: string;
};
const QGOLD_DECIMALS = 6,
  NEAR_DECIMALS = 24,
  WNEAR = ["wrap.testnet", "wrap.near"];
/** "1100000", 6 -> "1.1"; keeps a leading minus; non-numbers are returned as is. */
export function formatUnits(value: string, decimals: number) {
  const m = /^(-?)([0-9]{1,40})$/.exec(String(value));
  if (!m) return String(value);
  const digits = m[2].replace(/^0+(?=\d)/, "").padStart(decimals + 1, "0"),
    whole = digits.slice(0, -decimals),
    fraction = digits.slice(-decimals).replace(/0+$/, "");
  return `${m[1]}${whole}${fraction ? `.${fraction}` : ""}`;
}
const text = (v: unknown) =>
  typeof v === "string" ? v : (JSON.stringify(v) ?? String(v));
const when = (ms: unknown) => {
  const n = typeof ms === "string" || typeof ms === "number" ? Number(ms) : NaN;
  if (!Number.isFinite(n) || n <= 0 || n > 8.64e15) return text(ms);
  return `${new Date(n).toISOString().slice(0, 16).replace("T", " ")} UTC`;
};
const plain = (v: unknown) =>
  v !== null && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
/** A NEP-141 amount of `contract`, named when the vault knows the token. */
function tokenAmount(contract: string, amount: unknown, config: VaultConfig) {
  const a = text(amount);
  if (contract && contract === config.contracts.qgold)
    return `${formatUnits(a, QGOLD_DECIMALS)} QGOLD`;
  if (WNEAR.includes(contract))
    return `${formatUnits(a, NEAR_DECIMALS)} wNEAR`;
  return `${a} base units of ${contract}`;
}
/** An Intents token id (nep141:..., nep171:...:id) with its amount. */
function intentToken(id: string, amount: unknown, config: VaultConfig) {
  const [standard, contract, ...rest] = id.split(":");
  if (standard === "nep141" && contract)
    return tokenAmount(contract, amount, config);
  if (standard === "nep171" && contract)
    return `${text(amount)} × collectible ${rest.join(":")} (${contract})`;
  return `${text(amount)} units of ${id}`;
}
const METHOD_LABELS: Record<string, string> = {
  ft_transfer: "Send tokens",
  ft_transfer_call: "Send tokens to a contract",
  ft_burn: "Spend (burn) QGOLD",
  redeem: "Withdraw QGOLD",
  withdraw: "Withdraw funds",
  claim_exit: "Collect queued withdrawal",
  nft_transfer: "Transfer collectible",
  nft_approve: "Authorize collectible transfer",
};
const OPERATION_LABELS: Record<string, string> = {
  setupRecovery: "Create recovery passkey",
  restoreRecovery: "Recover account",
  "Restore this account with a passkey": "Recover account",
  revokeKey: "Remove device key",
  revokeSessions: "Sign out other game sessions",
  exportWallet: "Create wallet words",
};
// How long one approval may stay open. Writing twelve words down takes longer
// than answering Yes or No, so only that flow gets more time.
export const approvalTtl = (method: unknown) =>
  method === "exportWallet" ? 900000 : 180000;
function escrowLines(
  msgText: unknown,
  amount: unknown,
  config: VaultConfig,
  view: ReviewView,
) {
  const q = (v: unknown) =>
    tokenAmount(config.contracts.qgold ?? "", v, config);
  const unread = () => {
    view.lines.push(["Escrow message", text(msgText)]);
    view.warnings.push(
      "The escrow message could not be read. Approve only if you know exactly what it does.",
    );
  };
  let msg: Record<string, unknown> | null = null;
  try {
    msg = plain(JSON.parse(String(msgText)));
  } catch {
    msg = null;
  }
  if (!msg) return unread();
  if (msg.kind === "task") {
    const slots = Number(msg.slots ?? 1);
    view.lines.push(["Purpose", "Create a paid task in the escrow"]);
    view.lines.push(["Task reward", q(msg.reward)]);
    if (/^[0-9]+$/.test(text(amount)) && /^[0-9]+$/.test(text(msg.reward)))
      view.lines.push([
        "Market fee",
        q((BigInt(text(amount)) - BigInt(text(msg.reward))).toString()),
      ]);
    if (slots !== 1) view.lines.push(["Completions paid", String(slots)]);
    if (typeof msg.assignee === "string") {
      view.lines.push(["Reward goes to", `${msg.assignee} (named worker)`]);
      view.warnings.push(
        `The whole task reward, ${q(msg.reward)}, can be paid to ${msg.assignee}. Approve only if you created this task for them.`,
      );
    } else
      view.lines.push([
        "Reward goes to",
        "Any player whose completion is approved (open task)",
      ]);
    view.lines.push(["Deadline", when(msg.deadline_ms)]);
    view.lines.push(["Task id", text(msg.id)]);
  } else if (msg.kind === "secret") {
    view.lines.push(["Purpose", "Buy a Secret"]);
    view.lines.push(["Paid to (creator)", text(msg.creator)]);
    view.lines.push(["Price", q(msg.price)]);
    view.lines.push(["Secret", text(msg.secret_id)]);
  } else if (msg.kind === "transfer") {
    const c = plain(msg.condition);
    view.lines.push(["Purpose", "Send QGOLD through the escrow"]);
    view.lines.push(["Paid to", text(msg.to)]);
    view.lines.push([
      "Released when",
      c?.type === "both_confirm"
        ? "You and the receiver both confirm"
        : c?.type === "after"
          ? `After ${when(c.at_ms)}`
          : c?.type === "gps"
            ? `The receiver is within ${text(c.radius_m)} m of place ${text(c.place_id)}`
            : text(msg.condition),
    ]);
    view.lines.push(["Refunded if not released by", when(msg.expires_ms)]);
    view.warnings.push(
      `${q(amount)} leaves your account and can be released to ${text(msg.to)}.`,
    );
  } else unread();
}
function callView(call: VaultCall, config: VaultConfig, view: ReviewView) {
  view.lines.push(["Your account", call.accountId]);
  const a = call.actions[0];
  if (!a) return;
  if (a.kind !== "functionCall") {
    view.lines.push([
      "Action",
      a.kind === "addKey" ? "Add account key" : "Remove account key",
    ]);
    view.lines.push(["Public key", a.publicKey]);
    return;
  }
  const args = a.args ?? {},
    m = a.methodName,
    escrow =
      !!config.contracts.qgoldEscrow &&
      args.receiver_id === config.contracts.qgoldEscrow;
  view.lines.push(["Action", METHOD_LABELS[m] ?? `Contract action: ${m}`]);
  view.lines.push(["Contract", call.receiverId]);
  view.lines.push(["Method", m]);
  const shown = new Set<string>();
  if (typeof args.receiver_id === "string") {
    view.lines.push([
      escrow ? "Paid into (escrow)" : "Recipient",
      args.receiver_id,
    ]);
    shown.add("receiver_id");
  }
  if (args.amount !== undefined) {
    view.lines.push([
      "Amount",
      tokenAmount(call.receiverId, args.amount, config),
    ]);
    shown.add("amount");
  }
  if (m === "ft_transfer_call" && args.msg !== undefined) {
    if (escrow && call.receiverId === config.contracts.qgold)
      escrowLines(args.msg, args.amount, config, view);
    else {
      view.lines.push(["Message to the contract", text(args.msg)]);
      view.warnings.push(
        `${text(args.receiver_id)} receives the tokens and acts on this message.`,
      );
    }
    shown.add("msg");
  } else if (
    ["ft_transfer", "nft_transfer", "nft_approve"].includes(m) &&
    typeof args.receiver_id === "string" &&
    args.receiver_id !== call.accountId
  )
    view.warnings.push(`This sends value to ${args.receiver_id}.`);
  if (typeof args.token_id === "string") {
    view.lines.push(["Collectible", args.token_id]);
    shown.add("token_id");
  }
  if (typeof args.memo === "string") {
    view.lines.push(["Memo", args.memo]);
    shown.add("memo");
  } else if (args.memo === null) shown.add("memo");
  const rest = Object.keys(args).filter((k) => !shown.has(k));
  if (rest.length)
    view.lines.push([
      "Other details",
      JSON.stringify(Object.fromEntries(rest.map((k) => [k, args[k]]))),
    ]);
  if (a.deposit !== "0" && a.deposit !== "1")
    view.lines.push([
      "Attached NEAR",
      `${formatUnits(a.deposit, NEAR_DECIMALS)} NEAR`,
    ]);
}
function intentLine(
  intent: Record<string, unknown>,
  account: string | undefined,
  config: VaultConfig,
  view: ReviewView,
) {
  const kind = text(intent.intent),
    to = typeof intent.receiver_id === "string" ? intent.receiver_id : null;
  const away = () => {
    if (to && to !== account)
      view.warnings.push(`This intent sends value to ${to}.`);
  };
  if (kind === "transfer") {
    const tokens = Object.entries(plain(intent.tokens) ?? {})
      .map(([id, v]) => intentToken(id, v, config))
      .join(", ");
    if (to !== account)
      view.warnings.push(
        `This intent sends value to ${to ?? "an unknown account"}.`,
      );
    return `Transfer ${tokens || "nothing"} to ${to ?? "an unknown account"}`;
  }
  if (kind === "token_diff") {
    const diff = Object.entries(plain(intent.diff) ?? {}),
      give = diff
        .filter(([, v]) => text(v).startsWith("-"))
        .map(([id, v]) => intentToken(id, text(v).slice(1), config)),
      get = diff
        .filter(([, v]) => !text(v).startsWith("-"))
        .map(([id, v]) => intentToken(id, v, config));
    return `Trade: you give ${give.join(", ") || "nothing"}; you receive ${get.join(", ") || "nothing"}`;
  }
  away();
  if (kind === "native_withdraw")
    return `Withdraw ${formatUnits(text(intent.amount), NEAR_DECIMALS)} NEAR to ${to}`;
  if (kind === "ft_withdraw")
    return `Withdraw ${tokenAmount(text(intent.token), intent.amount, config)} to ${to}`;
  if (kind === "nft_withdraw")
    return `Withdraw collectible ${text(intent.token_id)} (${text(intent.token)}) to ${to}`;
  view.warnings.push(`Intent "${kind}" is not one the game uses.`);
  return `${kind}: ${JSON.stringify(intent)}`;
}
function messageView(r: MessageReview, config: VaultConfig, view: ReviewView) {
  view.lines.push(["Your account", r.account ?? "Selected recovery passkey"]);
  if (r.operation !== undefined) {
    view.lines.push(["Action", OPERATION_LABELS[r.operation] ?? r.operation]);
    if (r.keyToRemove) view.lines.push(["Public key to remove", r.keyToRemove]);
    return;
  }
  let parsed: Record<string, unknown> | null = null;
  try {
    parsed = plain(JSON.parse(String(r.authorization)));
  } catch {
    parsed = null;
  }
  const intents =
    parsed && Array.isArray(parsed.intents) ? parsed.intents : null;
  view.lines.push([
    "Action",
    intents ? "Sign NEAR Intents" : "Authorize signed message",
  ]);
  if (r.recipient) view.lines.push(["Authorization recipient", r.recipient]);
  if (!parsed || !intents) {
    view.lines.push(["Message", text(r.authorization ?? "")]);
    return;
  }
  if (parsed.signer_id !== r.account)
    view.warnings.push(
      `The intents name another signer: ${text(parsed.signer_id)}.`,
    );
  if (parsed.deadline !== undefined)
    view.lines.push(["Valid until", text(parsed.deadline)]);
  intents.forEach((intent: unknown, i: number) => {
    const p = plain(intent);
    view.lines.push([
      `Intent ${i + 1}`,
      p ? intentLine(p, r.account, config, view) : text(intent),
    ]);
  });
}
/** The plain-words view of a pending review, as the approval window shows it. */
export function describeReview(
  review: unknown,
  config: VaultConfig,
): ReviewView {
  const view: ReviewView = { lines: [], warnings: [] },
    r = (plain(review) ?? {}) as Partial<VaultCall> & MessageReview;
  if (Array.isArray(r.actions) && typeof r.receiverId === "string")
    callView(r as VaultCall, config, view);
  else messageView(r, config, view);
  return view;
}

// ---- The one plain question the approval window asks (yes / no). Built from
// the same decoded request; the full breakdown stays under "Details".
const auraName = (id: string) => {
  const parts = id.split(":");
  return parts[0] === "aura" && parts.length >= 2
    ? `Aura ${parts.slice(1).join(" #")}`
    : id;
};
const goldAmount = (v: unknown) =>
  `${formatUnits(text(v), QGOLD_DECIMALS)} GOLD`;
function tradeQuestion(intent: Record<string, unknown>, config: VaultConfig) {
  const diff = Object.entries(plain(intent.diff) ?? {});
  const nft = diff.find(([id]) => id.startsWith("nep171:")),
    other = diff.find(([id]) => !id.startsWith("nep171:"));
  if (!nft || !other) return null;
  const [, , ...rest] = nft[0].split(":"),
    item = auraName(rest.join(":")),
    price = (v: unknown) => {
      const [, contract] = other[0].split(":");
      const raw = text(v).replace(/^-/, "");
      return WNEAR.includes(contract)
        ? `${formatUnits(raw, NEAR_DECIMALS)} NEAR`
        : tokenAmount(contract, raw, config);
    };
  return text(nft[1]).startsWith("-")
    ? `Sell your ${item} for ${price(other[1])}?`
    : `Buy ${item} for ${price(other[1])}?`;
}
export function reviewQuestion(review: unknown, config: VaultConfig): string {
  const r = (plain(review) ?? {}) as Partial<VaultCall> & MessageReview;
  if (Array.isArray(r.actions) && typeof r.receiverId === "string") {
    const a = r.actions[0];
    if (!a) return "Allow this account action?";
    if (a.kind !== "functionCall")
      return a.kind === "addKey"
        ? "Add a new key to your account?"
        : "Remove a key from your account?";
    const args = a.args ?? {},
      to = text(args.receiver_id);
    if (
      a.methodName === "ft_transfer_call" &&
      r.receiverId === config.contracts.qgold &&
      to === config.contracts.qgoldEscrow
    ) {
      let msg: Record<string, unknown> | null = null;
      try {
        msg = plain(JSON.parse(String(args.msg)));
      } catch {
        msg = null;
      }
      if (msg?.kind === "task")
        return `Pay ${goldAmount(args.amount)} to post this task?`;
      if (msg?.kind === "secret")
        return `Buy this Secret for ${goldAmount(msg.price)}?`;
      if (msg?.kind === "transfer")
        return `Send ${goldAmount(args.amount)} to ${text(msg.to)}?`;
    }
    if (a.methodName === "ft_transfer" || a.methodName === "ft_transfer_call")
      return `Send ${tokenAmount(r.receiverId, args.amount, config)} to ${to}?`;
    if (a.methodName === "nft_transfer" || a.methodName === "nft_transfer_call")
      return `Give ${auraName(text(args.token_id))} to ${to}?`;
    if (a.methodName === "nft_approve")
      return `Let ${text(args.account_id)} move ${auraName(text(args.token_id))}?`;
    if (a.deposit !== "0" && a.deposit !== "1")
      return `Pay ${formatUnits(a.deposit, NEAR_DECIMALS)} NEAR for this action?`;
    return "Allow this account action?";
  }
  if (r.operation !== undefined)
    return `${OPERATION_LABELS[r.operation] ?? r.operation}?`;
  let parsed: Record<string, unknown> | null = null;
  try {
    parsed = plain(JSON.parse(String(r.authorization)));
  } catch {
    parsed = null;
  }
  const intents = parsed && Array.isArray(parsed.intents) ? parsed.intents : [];
  if (intents.length === 1) {
    const p = plain(intents[0]);
    if (p?.intent === "token_diff") {
      const q = tradeQuestion(p, config);
      if (q) return q;
    }
    if (p?.intent === "native_withdraw")
      return `Move ${formatUnits(text(p.amount), NEAR_DECIMALS)} NEAR to ${text(p.receiver_id)}?`;
  }
  return "Allow this account action?";
}
