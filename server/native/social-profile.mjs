import { assert, id } from "../domain.mjs";
import { nearAccountId, assertTestnetRpc } from "../identity/near.mjs";
import { NativeContractReader } from "./reader.mjs";
import { nativeInteger } from "./staking-pool.mjs";
import { NETWORK, SOCIAL_CONTRACT_ID } from "./network.mjs";
export const SOCIAL_TESTNET = SOCIAL_CONTRACT_ID;
export const SOCIAL_CODE_HASH = "B5Yf5EquM36fGu3JNAD2K83fT6L4dpzcx8mYLnkjJJbS";
const leaf = (value) =>
  typeof value === "string"
    ? value
    : typeof value?.[""] === "string"
      ? value[""]
      : null;
export function parsePublicProfile(value) {
  if (!value || !leaf(value.name))
    return { status: "unpublished", profile: null };
  const name = leaf(value.name),
    schema = leaf(value.schema),
    mutation = leaf(value.mutation_id);
  if (
    schema !== "1" ||
    name.length < 2 ||
    name.length > 24 ||
    /[\u0000-\u001f\u007f]/.test(name) ||
    !/^profile_[a-f0-9-]{36}$/.test(mutation || "")
  )
    return { status: "unsupported", profile: null };
  const contract = leaf(value.avatar_contract) || "",
    token = leaf(value.avatar_token_id) || "";
  if (contract.length > 64 || token.length > 128)
    return { status: "unsupported", profile: null };
  return {
    status: "published",
    profile: {
      name,
      mutationId: mutation,
      updatedAt: leaf(value.updated_at),
      avatar:
        contract && token ? { contractId: contract, tokenId: token } : null,
    },
  };
}
export class NativeSocialProfile extends NativeContractReader {
  constructor(
    provider,
    collectibles,
    { clock = Date.now, expectedCodeHash = SOCIAL_CODE_HASH } = {},
  ) {
    super(provider, SOCIAL_TESTNET);
    this.collectibles = collectibles;
    this.clock = clock;
    this.expectedCodeHash = expectedCodeHash;
  }
  async read(accountId, fresh = false) {
    nearAccountId(accountId);
    await assertTestnetRpc(this.provider);
    const avatarTokenId = `avatar:${accountId}`;
    const [value, balance, bounds, account, candidate] = await Promise.all([
      this.view(
        "get",
        {
          keys: [
            "schema",
            "name",
            "avatar_contract",
            "avatar_token_id",
            "updated_at",
            "mutation_id",
          ].map((field) => `${accountId}/questlayer/profile/${field}`),
        },
        fresh,
      ),
      this.view("storage_balance_of", { account_id: accountId }, fresh),
      this.view("storage_balance_bounds", {}, fresh),
      this.provider.query({
        request_type: "view_account",
        account_id: this.contractId,
        finality: "final",
      }),
      this.collectibles.view("nft_token", { token_id: avatarTokenId }, fresh),
    ]);
    const parsed = parsePublicProfile(value?.[accountId]?.questlayer?.profile);
    if (balance) {
      nativeInteger(balance.total);
      nativeInteger(balance.available);
      assert(
        BigInt(balance.available) <= BigInt(balance.total),
        "Invalid public-profile storage balance.",
        503,
      );
    }
    nativeInteger(bounds.min);
    let avatarVerified = false;
    if (parsed.profile?.avatar?.contractId === this.collectibles.contractId) {
      const token =
        parsed.profile.avatar.tokenId === avatarTokenId
          ? candidate
          : await this.collectibles.view(
              "nft_token",
              { token_id: parsed.profile.avatar.tokenId },
              fresh,
            );
      avatarVerified =
        token?.owner_id === accountId && token.token_id?.startsWith("avatar:");
    }
    return {
      network: NETWORK,
      contractId: this.contractId,
      accountId,
      ...parsed,
      avatarVerified,
      publishAvatar:
        candidate?.owner_id === accountId
          ? { contractId: this.collectibles.contractId, tokenId: avatarTokenId }
          : null,
      storage: balance
        ? { total: balance.total, available: balance.available }
        : null,
      minimumStorage: bounds.min,
      deposit:
        balance && BigInt(balance.available) >= 10n ** 22n
          ? "1"
          : (5n * 10n ** 22n).toString(),
      publishEnabled:
        account.code_hash === this.expectedCodeHash &&
        BigInt(bounds.min) <= 5n * 10n ** 22n,
    };
  }
  async prepare(accountId, name) {
    nearAccountId(accountId);
    assert(
      typeof name === "string" &&
        name.trim().length >= 2 &&
        name.trim().length <= 24 &&
        !/[\u0000-\u001f\u007f]/.test(name),
      "Your game alias cannot be published in this format.",
    );
    const snapshot = await this.read(accountId, true);
    assert(
      snapshot.publishEnabled,
      "Public profile publishing is temporarily unavailable.",
      503,
    );
    const avatar = snapshot.publishAvatar;
    const profile = {
      schema: "1",
      name: name.trim(),
      avatar_contract: avatar?.contractId || "",
      avatar_token_id: avatar?.tokenId || "",
      updated_at: String(this.clock()),
      mutation_id: id("profile"),
    };
    return {
      network: NETWORK,
      receiverId: this.contractId,
      accountId,
      methodName: "set",
      gas: "80000000000000",
      deposit: snapshot.deposit,
      profile,
      args: { data: { [accountId]: { questlayer: { profile } } } },
    };
  }
  async confirm(accountId, mutationId) {
    assert(
      /^profile_[a-f0-9-]{36}$/.test(mutationId || ""),
      "Invalid profile publication.",
    );
    const snapshot = await this.read(accountId, true);
    return {
      confirmed:
        snapshot.status === "published" &&
        snapshot.profile.mutationId === mutationId,
      snapshot,
    };
  }
}
