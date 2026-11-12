// A quest rating as a public record on NEAR Social (server/creators/feedback.mjs).
// Same flow as place records (src/place-record.ts): quote, check every field,
// sign `set` from the explorer's own account, then read the chain back.
import { NEAR_NETWORK, SOCIAL_CONTRACT_ID } from "./near-network.ts";
import type { NativeSigner } from "./native-signer";

type RatingRecord = {
  schema: string;
  quest_id: string;
  registry: string;
  stars: string;
  updated_at: string;
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
  record: RatingRecord;
  args: { data: Record<string, { questlayer: { ratings: Record<string, RatingRecord> } }> };
};
const DEPOSITS = ["1", "50000000000000000000000"];

export function assertRatingQuote(q: Quote, accountId: string, questId: string, stars: number) {
  const root = q?.args?.data?.[accountId]?.questlayer?.ratings;
  const sent = root?.[questId];
  if (
    !q ||
    q.network !== NEAR_NETWORK ||
    q.receiverId !== SOCIAL_CONTRACT_ID ||
    q.accountId !== accountId ||
    q.methodName !== "set" ||
    q.key !== questId ||
    !DEPOSITS.includes(q.deposit) ||
    !/^\d+$/.test(q.gas) ||
    BigInt(q.gas) > 100_000_000_000_000n ||
    Object.keys(q.args.data).length !== 1 ||
    Object.keys(q.args.data[accountId]).join() !== "questlayer" ||
    Object.keys(q.args.data[accountId].questlayer).join() !== "ratings" ||
    !root ||
    Object.keys(root).length !== 1 ||
    !sent ||
    JSON.stringify(sent) !== JSON.stringify(q.record) ||
    Object.keys(sent).sort().join() !== "mutation_id,quest_id,registry,schema,stars,updated_at" ||
    sent.schema !== "questlayer.rating/1" ||
    sent.quest_id !== questId ||
    sent.stars !== String(stars)
  )
    throw Error("This record changed while it was prepared. Try again.");
}

export async function publishRatingRecord({
  call,
  signer,
  accountId,
  playerId,
  questId,
  stars,
  attempts = 6,
}: {
  call: <T>(path: string, body?: unknown) => Promise<T>;
  signer: NativeSigner;
  accountId: string;
  playerId: string;
  questId: string;
  stars: number;
  attempts?: number;
}): Promise<boolean> {
  const base = `/creator-ratings/${encodeURIComponent(questId)}`;
  const quote = await call<Quote>(`${base}/prepare`, { accountId });
  assertRatingQuote(quote, accountId, questId, stars);
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
    const r = await call<{ confirmed: boolean }>(`${base}/confirm`, {
      accountId,
      mutationId: quote.record.mutation_id,
    });
    if (r.confirmed) return true;
    await new Promise((resolve) => setTimeout(resolve, 900));
  }
  return false;
}
