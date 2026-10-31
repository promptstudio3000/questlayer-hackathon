import type { NativeProfileQuote } from "./types";
const keys = (value: unknown, expected: string[]) =>
  !!value &&
  typeof value === "object" &&
  !Array.isArray(value) &&
  Object.keys(value).sort().join("|") === expected.slice().sort().join("|");
export function assertProfileQuote(
  quote: NativeProfileQuote,
  expected: {
    accountId: string;
    name: string;
    avatar: { contractId: string; tokenId: string } | null;
  },
) {
  const fail = () => {
    throw Error(
      "Your profile details changed. Refresh the profile and try again.",
    );
  };
  if (
    !quote ||
    quote.network !== "testnet" ||
    quote.receiverId !== "v1.social08.testnet" ||
    quote.accountId !== expected.accountId ||
    quote.methodName !== "set" ||
    !["1", "50000000000000000000000"].includes(quote.deposit) ||
    !keys(quote.args, ["data"]) ||
    !keys(quote.args.data, [expected.accountId])
  )
    fail();
  const root = quote.args.data[expected.accountId] as Record<string, unknown>;
  if (!keys(root, ["questlayer"])) fail();
  const layer = root.questlayer as Record<string, unknown>;
  if (!keys(layer, ["profile"])) fail();
  const fields = [
      "schema",
      "name",
      "avatar_contract",
      "avatar_token_id",
      "updated_at",
      "mutation_id",
    ],
    profile = quote.profile as Record<string, string>,
    actual = layer.profile as Record<string, string>;
  if (
    !keys(profile, fields) ||
    !keys(actual, fields) ||
    fields.some(
      (field) =>
        typeof profile[field] !== "string" || actual[field] !== profile[field],
    ) ||
    profile.schema !== "1" ||
    profile.name !== expected.name.trim() ||
    profile.avatar_contract !== (expected.avatar?.contractId || "") ||
    profile.avatar_token_id !== (expected.avatar?.tokenId || "") ||
    !/^profile_[a-f0-9-]{36}$/.test(profile.mutation_id) ||
    !/^\d{13}$/.test(profile.updated_at)
  )
    fail();
}
