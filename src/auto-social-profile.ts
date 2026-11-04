// Publishes the explorer's public profile (game alias + owned avatar
// reference) to NEAR Social right after the invisible explorer account is
// ready, so every NEAR app can read it from the player's own account.
// Quiet: no popup, no fee for the player (the relayer sponsors the managed
// account's call), no toast. Runs once per account per browser; a profile that
// is already published (by us or anyone) is never overwritten.
import { assertProfileQuote } from "./native-profile-quote.ts";
import { NEAR_NETWORK, SOCIAL_CONTRACT_ID } from "./near-network.ts";
import type { NativeSigner } from "./native-signer.ts";
import type { NativeProfileQuote, NativeProfileState } from "./types.ts";

export const AUTO_PROFILE_PREFIX = "questlayer:social-auto:v1:";
export type AutoProfileOutcome =
  | "done"
  | "already"
  | "published"
  | "sent"
  | "paused";

type Call = <T>(path: string, data?: unknown) => Promise<T>;
type Store = Pick<Storage, "getItem" | "setItem">;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function autoPublishProfile({
  accountId,
  playerId,
  name,
  signer,
  call,
  storage,
  wait = sleep,
}: {
  accountId: string;
  playerId: string;
  name: string;
  signer: NativeSigner;
  call: Call;
  storage?: Store | null;
  wait?: (ms: number) => Promise<unknown>;
}): Promise<AutoProfileOutcome> {
  const key = AUTO_PROFILE_PREFIX + accountId;
  const mark = () => {
    try {
      storage?.setItem(key, String(Date.now()));
    } catch {
      /* private mode: the server read below keeps this idempotent anyway */
    }
  };
  try {
    if (storage?.getItem(key)) return "done";
  } catch {
    /* storage unavailable */
  }
  if (signer.kind !== "managed" || signer.accountId !== accountId)
    throw Error("Only the explorer account publishes its profile on its own.");
  const state = await call<NativeProfileState>(
    `/native/profile?accountId=${encodeURIComponent(accountId)}&refresh=1`,
  );
  if (state.status !== "unpublished") {
    mark();
    return "already";
  }
  // Contract under check: try again on a later visit.
  if (!state.publishEnabled) return "paused";
  const quote = await call<NativeProfileQuote>("/native/profile/prepare", {
    accountId,
    publicConsent: true,
  });
  assertProfileQuote(quote, { accountId, name, avatar: state.publishAvatar });
  await signer.send(
    {
      network: NEAR_NETWORK,
      signerId: accountId,
      receiverId: SOCIAL_CONTRACT_ID,
      actions: [
        {
          type: "FunctionCall",
          params: {
            methodName: "set",
            args: quote.args,
            gas: "80000000000000",
            deposit: quote.deposit,
          },
        },
      ],
    },
    { playerId },
  );
  mark();
  for (let attempt = 0; attempt < 5; attempt++) {
    const r = await call<{ confirmed: boolean }>("/native/profile/confirm", {
      accountId,
      mutationId: quote.profile.mutation_id,
    });
    if (r.confirmed) return "published";
    await wait(1000);
  }
  return "sent";
}
