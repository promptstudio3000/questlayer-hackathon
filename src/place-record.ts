// Place messages as public records on NEAR Social (server/gold-spend/social.mjs).
// Same flow as note records (src/note-record.ts): quote, check every field,
// sign `set` from the player's own account, then read the chain back.
import { NEAR_NETWORK, SOCIAL_CONTRACT_ID } from "./near-network.ts";
import type { NativeSigner } from "./native-signer";

type PlaceRecord = {
  schema: string;
  kind: string;
  thread: string;
  title: string;
  text: string;
  cell: string;
  place: string;
  paid: string;
  created_at: string;
  mutation_id: string;
};
type Quote = {
  network: string;
  receiverId: string;
  accountId: string;
  methodName: "set";
  gas: string;
  deposit: string;
  key: string;
  record: PlaceRecord;
  args: { data: Record<string, { questlayer: { places: Record<string, PlaceRecord> } }> };
};
const DEPOSITS = ["1", "50000000000000000000000"];

export function assertPlaceQuote(q: Quote, accountId: string, key: string) {
  const root = q?.args?.data?.[accountId]?.questlayer?.places;
  const sent = root?.[key];
  if (
    !q ||
    q.network !== NEAR_NETWORK ||
    q.receiverId !== SOCIAL_CONTRACT_ID ||
    q.accountId !== accountId ||
    q.methodName !== "set" ||
    q.key !== key ||
    !DEPOSITS.includes(q.deposit) ||
    !/^\d+$/.test(q.gas) ||
    BigInt(q.gas) > 100_000_000_000_000n ||
    Object.keys(q.args.data).length !== 1 ||
    !root ||
    Object.keys(root).length !== 1 ||
    !sent ||
    JSON.stringify(sent) !== JSON.stringify(q.record) ||
    sent.schema !== "questlayer.place/1" ||
    !/^[0-9a-z]{7}$/.test(sent.cell)
  )
    throw Error("This record changed while it was prepared. Try again.");
}

export async function publishPlaceRecord({
  call,
  signer,
  accountId,
  playerId,
  targetId,
  attempts = 6,
}: {
  call: <T>(path: string, body?: unknown) => Promise<T>;
  signer: NativeSigner;
  accountId: string;
  playerId: string;
  targetId: string;
  attempts?: number;
}): Promise<boolean> {
  const quote = await call<Quote>(`/places/${targetId}/social/prepare`, {
    accountId,
    publicConsent: true,
    permanenceAcknowledged: true,
  });
  assertPlaceQuote(quote, accountId, targetId);
  await signer.send(
    {
      network: NEAR_NETWORK,
      signerId: accountId,
      receiverId: SOCIAL_CONTRACT_ID,
      actions: [{ type: "FunctionCall", params: { methodName: "set", args: quote.args, gas: quote.gas, deposit: quote.deposit } }],
    },
    { playerId },
  );
  for (let i = 0; i < attempts; i++) {
    const r = await call<{ confirmed: boolean }>(`/places/${targetId}/social/confirm`, {
      accountId,
      mutationId: quote.record.mutation_id,
    });
    if (r.confirmed) return true;
    await new Promise((resolve) => setTimeout(resolve, 900));
  }
  return false;
}
