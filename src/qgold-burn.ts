// One durable purchase reference spans quote, burn, confirmation and delivery.
import { api, ApiError } from "./api.ts";
import { tr } from "./i18n.ts";
import { NEAR_NETWORK } from "./near-network.ts";

export type QgoldBurnCall = {
  purchaseId: string; submission: number; state: "prepared" | "credited" | "complete"; canSign: boolean;
  txHash: string | null; relayJobId: string | null;
  signerId: string; receiverId: string; methodName: "ft_burn";
  args: { amount: string; memo: string }; gas: string; deposit: "1";
};
export type QgoldBurner = (call: QgoldBurnCall) => Promise<string | null | void>;
let active: { burner: QgoldBurner; playerId: string } | null = null;
export function setQgoldBurner(burner: QgoldBurner | null, playerId?: string) {
  active = burner && playerId ? { burner, playerId } : null;
}
const canonical = (v: unknown): unknown => Array.isArray(v) ? v.map(canonical) : v && typeof v === "object"
  ? Object.fromEntries(Object.keys(v).sort().map(k => [k, canonical((v as Record<string, unknown>)[k])])) : v;
const identity = (path: string, input: Record<string, unknown>) => JSON.stringify(canonical({ path, input: Object.fromEntries(Object.entries(input).filter(([k]) => !["fix", "encounter"].includes(k))) }));
type Pending = { id: string; submitterId: string; request: string; signatureKeys?: string[] };
const uuid = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(v);
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const inFlight = new Map<string, Promise<unknown>>();

export async function withQgoldBurn<T>(path: string, input: Record<string, unknown>): Promise<T> {
  const actor = active;
  if (!actor) {
    try { return await api<T>(path, input); }
    catch (error) {
      if (error instanceof ApiError && error.code === "QGOLD_BURN") throw Error(tr("Sign in with a NEAR account to spend QGOLD."));
      throw error;
    }
  }
  const key = `questlayer:purchase:${NEAR_NETWORK}:${actor.playerId}`, request = identity(path, input);
  const flightKey = `${key}:${request}`;
  if (inFlight.has(flightKey)) return inFlight.get(flightKey) as Promise<T>;
  const execute = async () => {
    const storage = globalThis.localStorage;
    const read = (): Pending[] => {
      const raw = storage.getItem(key); if (!raw) return [];
      if (raw.length > 150000) throw Error("Purchase recovery storage is damaged. Keep the saved payment reference.");
      const rows = JSON.parse(raw) as Pending[];
      if (!Array.isArray(rows) || rows.length > 8 || rows.some(r => !uuid(r.id) || !uuid(r.submitterId) || typeof r.request !== "string"))
        throw Error("Purchase recovery storage is damaged. Keep the saved payment reference.");
      return rows;
    };
    const write = (rows: Pending[]) => {
      const raw = JSON.stringify(rows); storage.setItem(key, raw);
      if (storage.getItem(key) !== raw) throw Error("Purchase recovery storage is unavailable. No new payment will be signed.");
    };
    const locked = <R>(work: () => R): Promise<R> => globalThis.navigator?.locks
      ? navigator.locks.request<R>(key, () => work()) : Promise.resolve().then(work);
    const pending = await locked(() => {
      const rows = read(), found = rows.find(r => r.request === request); if (found) return found;
      if (rows.length >= 8) throw Error("Existing purchases are still being confirmed. Their payments are saved.");
      const row = { id: crypto.randomUUID(), submitterId: crypto.randomUUID(), request }; write([...rows, row]); return row;
    });
    const run = () => api<T>(path, input, { purchaseId: pending.id });
    let result: T;
    try { result = await run(); }
    catch (error) {
      if (error instanceof ApiError && (error.details as { purchaseReleased?: string } | undefined)?.purchaseReleased === pending.id) {
        // Only the server can prove that this request never prepared a payment.
        // Invalid/free requests must not fill all recovery slots indefinitely.
        await locked(() => write(read().filter(row => row.id !== pending.id)));
      }
      if (error instanceof ApiError && error.code === "QGOLD_SHORT") throw Error(tr("Not enough QGOLD in your account."));
      if (!(error instanceof ApiError) || error.code !== "QGOLD_BURN") throw error;
      const call = await api<QgoldBurnCall>("/gold/burn/prepare", { purchaseId: pending.id, submitterId: pending.submitterId });
      await locked(() => write(read().map(row => row.id === pending.id ? { ...row, signatureKeys: [...new Set([
        ...(row.signatureKeys ?? []), `questlayer:burn-submission:${NEAR_NETWORK}:${call.signerId}:${call.purchaseId}:${call.submission}`,
      ])] } : row)));
      if (!["credited", "complete"].includes(call.state)) {
        let txHash = call.txHash;
        if (!txHash && call.relayJobId) {
          const { waitForRelayJob } = await import("./relayed-native-transaction.ts");
          txHash = (await waitForRelayJob(call.relayJobId)).transactionHash;
        }
        if (!txHash) {
          if (!call.canSign) throw Error("This purchase is already being signed. Its payment will be checked before another is sent.");
          txHash = (await actor.burner(call)) || null;
        }
        if (!txHash) throw Error(tr("The wallet did not report the burn. Spend QGOLD from your explorer account."));
        for (let attempt = 0; ; attempt++) {
          try { await api("/gold/burn/confirm", { purchaseId: call.purchaseId, txHash }); break; }
          catch (e) {
            if (e instanceof ApiError && e.code === "BURN_PENDING" && attempt < 5) { await sleep(1500); continue; }
            throw e;
          }
        }
      }
      result = await run();
    }
    await locked(() => {
      const rows = read();
      for (const signatureKey of rows.find(r => r.id === pending.id)?.signatureKeys ?? []) {
        if (signatureKey.startsWith(`questlayer:burn-submission:${NEAR_NETWORK}:`)) storage.removeItem(signatureKey);
      }
      write(rows.filter(r => r.id !== pending.id));
    });
    return result;
  };
  const work = execute(); inFlight.set(flightKey, work);
  try { return await work; } finally { inFlight.delete(flightKey); }
}
