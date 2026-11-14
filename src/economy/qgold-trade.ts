// Buy and sell QGOLD at the vault from the /treasury and /economy pages
// (docs/QGOLD-MARKET.md). Loaded only when a visitor presses Buy or Sell.
// Selling signs with this browser's game account key (the QGOLD lives there).
// Buying is paid by the game account when it holds enough NEAR; otherwise the
// player's NEAR wallet (Meteor, HOT, ...) pays and the vault mints the QGOLD
// straight into the game account (`deposit({receiver_id})`). Amounts are
// integer strings.
import { NEAR_NETWORK } from "../near-network.ts";
import { api } from "../api.ts";
import { indexedDbKeyStore, loadDeviceKey } from "../player-key.ts";
import { sendSelfPaid } from "../self-paid-native-transaction.ts";
import type { ExitPath } from "./qgold-quote.ts";

const TGAS = 10n ** 12n;
export const BUY_GAS_TGAS = 100n;
// redeem + one NEAR transfer + a 10 Tgas callback use well under 60 Tgas; a
// smaller prepay lets a lightly funded game account (0.02 NEAR) still sell.
export const SELL_GAS_TGAS = 80n;
// Gas prepaid at the worst testnet/mainnet gas price plus the account's own
// storage stake: what a game account must keep beside the amount it pays.
const STORAGE_YOCTO_PER_BYTE = 10n ** 19n;
const GAS_PRICE_CAP = 2n * 10n ** 8n; // yocto per gas unit (2x the floor)
export const gasReserve = (tgas: bigint) => tgas * TGAS * GAS_PRICE_CAP;

export async function playerAccount(): Promise<string | null> {
  try {
    return (await loadDeviceKey(indexedDbKeyStore()))?.accountId ?? null;
  } catch {
    return null;
  }
}

let rpc: Promise<string> | null = null;
async function rpcUrl() {
  rpc ??= api<{ rpcUrl?: string }>("/config").then((c) => {
    if (typeof c.rpcUrl !== "string") throw Error("The game network is unavailable. Try again in a moment.");
    return c.rpcUrl;
  });
  return rpc.catch((e) => {
    rpc = null;
    throw e;
  });
}

/** Spendable NEAR (yocto) of an account: balance minus its storage stake. */
export async function spendableNear(accountId: string): Promise<bigint | null> {
  try {
    const r = await fetch(await rpcUrl(), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: "qx", method: "query", params: { request_type: "view_account", finality: "final", account_id: accountId } }),
    });
    const v = (await r.json())?.result as { amount?: string; locked?: string; storage_usage?: number } | undefined;
    if (!v?.amount) return null;
    const storage = BigInt(v.storage_usage ?? 0) * STORAGE_YOCTO_PER_BYTE;
    const free = BigInt(v.amount) - storage;
    return free > 0n ? free : 0n;
  } catch {
    return null;
  }
}

/** True when the game account can pay `near` itself (plus its gas). */
export function gameAccountCovers(spendable: bigint | null, near: bigint) {
  return spendable != null && spendable >= near + gasReserve(BUY_GAS_TGAS);
}

async function send(receiverId: string, methodName: string, args: Record<string, unknown>, deposit: bigint, gas: bigint) {
  const key = await loadDeviceKey(indexedDbKeyStore());
  if (!key?.accountId) throw Error("Play once on this device to get your game account, then come back.");
  return sendSelfPaid(key, {
    network: NEAR_NETWORK,
    signerId: key.accountId,
    receiverId,
    actions: [
      {
        type: "FunctionCall",
        params: { methodName, args, gas: (gas * TGAS).toString(), deposit: deposit.toString() },
      },
    ],
  });
}

const minOut = (quoted: bigint) => ((quoted * 99n) / 100n).toString();

/** Payable deposit at R + 1 % from the game account, accepting at most 1 % less than quoted. */
export function buyQgold(vault: string, near: bigint, quoted: bigint) {
  return send(vault, "deposit", { min_out: minOut(quoted) }, near, BUY_GAS_TGAS);
}

/** Redeem burns the caller's QGOLD first, then pays its share (1 yocto attached). */
export function sellQgold(vault: string, qgold: bigint, path: ExitPath, quoted: bigint) {
  return send(vault, "redeem", { amount: qgold.toString(), path, min_out: minOut(quoted) }, 1n, SELL_GAS_TGAS);
}

// ------------------------------------------------------------ NEAR wallet

type ConnectorWallet = {
  manifest?: { features?: { signAndSendTransaction?: boolean } };
  getAccounts(): Promise<{ accountId: string }[]>;
  signAndSendTransaction(input: {
    network?: string;
    signerId?: string;
    receiverId: string;
    actions: { type: "FunctionCall"; params: { methodName: string; args: Record<string, unknown>; gas: string; deposit: string } }[];
  }): Promise<unknown>;
};
let connector: Promise<{ connect(): Promise<ConnectorWallet>; getConnectedWallet(): Promise<{ wallet: ConnectorWallet; accounts: { accountId: string }[] }> }> | null = null;
function nearConnector() {
  connector ??= import("@hot-labs/near-connect").then(async ({ NearConnector }) => {
    const c = new NearConnector({
      network: NEAR_NETWORK,
      autoConnect: true,
      features: { testnet: NEAR_NETWORK === "testnet", signAndSendTransaction: true },
      footerBranding: null,
    });
    await c.whenManifestLoaded;
    return c as unknown as Awaited<NonNullable<typeof connector>>;
  });
  return connector.catch((e) => {
    connector = null;
    throw e;
  });
}

/** The NEAR wallet this browser already connected on the treasury page, if any. */
export async function connectedWallet(): Promise<string | null> {
  try {
    const c = await nearConnector();
    const { accounts } = await c.getConnectedWallet();
    return accounts[0]?.accountId ?? null;
  } catch {
    return null;
  }
}

function failedOutcome(outcome: unknown) {
  const o = outcome as { status?: unknown; receipts_outcome?: { outcome?: { status?: unknown } }[] } | null;
  const bad = (s: unknown) => !!s && typeof s === "object" && "Failure" in (s as object);
  return !!o && (bad(o.status) || (o.receipts_outcome ?? []).some((r) => bad(r.outcome?.status)));
}

/**
 * Pays with the player's NEAR wallet; the vault mints the QGOLD into the game
 * account (`receiver`), where the game and the Sell button can use it.
 */
export async function buyQgoldWithWallet(vault: string, near: bigint, quoted: bigint, receiver: string) {
  const c = await nearConnector();
  let wallet: ConnectorWallet;
  let signerId: string | undefined;
  try {
    const current = await c.getConnectedWallet();
    wallet = current.wallet;
    signerId = current.accounts[0]?.accountId;
  } catch {
    wallet = await c.connect();
    signerId = (await wallet.getAccounts())[0]?.accountId;
  }
  if (!signerId) throw Error("The wallet did not return an account. Try again or pick another wallet.");
  if (wallet.manifest && wallet.manifest.features?.signAndSendTransaction === false)
    throw Error("Choose a wallet that supports NEAR transactions.");
  let outcome: unknown;
  try {
    outcome = await wallet.signAndSendTransaction({
      network: NEAR_NETWORK,
      signerId,
      receiverId: vault,
      actions: [
        {
          type: "FunctionCall",
          params: { methodName: "deposit", args: { min_out: minOut(quoted), receiver_id: receiver }, gas: (BUY_GAS_TGAS * TGAS).toString(), deposit: near.toString() },
        },
      ],
    });
  } catch (e) {
    const text = String((e as Error)?.message || e);
    if (/reject|cancel|denied|closed/i.test(text)) throw Error("The wallet closed without paying. Nothing was sent.");
    if (/NotEnoughBalance|not have enough balance|insufficient/i.test(text)) throw Error(`${signerId} does not hold enough NEAR for this amount.`);
    throw Error(text.length <= 200 ? text : "The wallet could not send this purchase. Nothing was taken; try again.");
  }
  if (failedOutcome(outcome)) throw Error("It didn't go through. The vault refunded the NEAR; try again.");
  const hash = (outcome as { transaction?: { hash?: string }; transaction_outcome?: { id?: string } } | null);
  return { transactionHash: hash?.transaction?.hash ?? hash?.transaction_outcome?.id ?? "", payer: signerId };
}
