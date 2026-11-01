import { NEAR_NETWORK } from "./near-network.ts";

// Creator money on the creators contract: buy access and donate are paid by the
// player's own key (the relayer refuses money), withdraw is relayed (1 yocto).
export type CreatorPaymentRequest = {
  kind: "buy" | "donate" | "withdraw";
  questId?: string;
  amount?: string;
};
export type CreatorPaymentQuote = {
  network: string;
  signerId: string;
  receiverId: string;
  actions: Array<{
    type: "FunctionCall";
    params: {
      methodName: string;
      args: Record<string, unknown>;
      gas: string;
      deposit: string;
    };
  }>;
  price?: string;
  creatorShare?: string;
  treasuryShare?: string;
  amount?: string;
};
export type CreatorEarnings = {
  credit: string;
  pending: string;
  withdrawn: string;
  earned_access: string;
  earned_donations: string;
  earned_rounds: string;
};
export type CreatorMoneySnapshot = {
  network: string;
  contractId: string;
  publisher: "configured" | "not-configured";
  treasuryBps: string;
  openRound: string | null;
  creator: CreatorEarnings | null;
  registeredQuests: number;
  myQuests: string[];
};
export type CreatorChainQuest = {
  author: string;
  price: string;
  open: boolean;
  policy_version: string;
  access_sold: number;
  donations: string;
};
export type CreatorQuestMoney = {
  quest: CreatorChainQuest | null;
  access: { paid: string } | null;
};

const METHODS = { buy: "buy_access", donate: "donate", withdraw: "withdraw" };
const YOCTO = /^[0-9]{1,40}$/;

/** Throws unless the server quote is exactly the payment the player reviewed. */
export function assertCreatorQuote(
  quote: CreatorPaymentQuote,
  request: CreatorPaymentRequest,
  expected: { accountId: string; contractId: string; price?: string },
) {
  const action = quote.actions?.[0]?.params;
  const deposit =
    request.kind === "withdraw"
      ? "1"
      : request.kind === "donate"
        ? request.amount
        : expected.price;
  const args = request.kind === "withdraw" ? {} : { quest_id: request.questId };
  if (
    quote.network !== NEAR_NETWORK ||
    quote.signerId !== expected.accountId ||
    quote.receiverId !== expected.contractId ||
    quote.actions.length !== 1 ||
    quote.actions[0].type !== "FunctionCall" ||
    !action ||
    action.methodName !== METHODS[request.kind] ||
    !deposit ||
    !YOCTO.test(deposit) ||
    action.deposit !== deposit ||
    !YOCTO.test(action.gas) ||
    BigInt(action.gas) > 100n * 10n ** 12n ||
    JSON.stringify(action.args) !== JSON.stringify(args)
  )
    throw Error(
      "The payment details changed before signing. Review them again.",
    );
}

/** 0.05 → yocto string; donation bounds 0.01 to 100 test NEAR. */
export function parseDonation(text: string): string {
  if (!/^(0|[1-9]\d{0,2})(\.\d{1,24})?$/.test(text.trim()))
    throw Error("Enter an amount like 0.1.");
  const [whole, fraction = ""] = text.trim().split(".");
  const amount = BigInt(whole) * 10n ** 24n + BigInt(fraction.padEnd(24, "0"));
  if (amount < 10n ** 22n || amount > 100n * 10n ** 24n)
    throw Error("Give between 0.01 and 100 test NEAR.");
  return amount.toString();
}

export function nearText(yocto: string | undefined | null, digits = 3) {
  if (!yocto || !YOCTO.test(yocto)) return "0";
  const value = BigInt(yocto),
    scale = 10n ** BigInt(24 - digits),
    rounded = (value + scale / 2n) / scale,
    whole = rounded / 10n ** BigInt(digits),
    fraction = (rounded % 10n ** BigInt(digits))
      .toString()
      .padStart(digits, "0")
      .replace(/0+$/, "");
  if (value > 0n && rounded === 0n) return "<0." + "0".repeat(digits - 1) + "1";
  return whole.toString() + (fraction ? "." + fraction : "");
}
