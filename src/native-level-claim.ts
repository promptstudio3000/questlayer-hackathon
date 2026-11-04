import claims from "../public/native-claims-testnet.json" with { type: "json" };
import rewards from "../public/native-rewards-testnet.json" with { type: "json" };
import { NEAR_NETWORK } from "./near-network.ts";
export const NATIVE_LEVEL_POLICY = "native-xp-level-v1";
export type NativeLevelClaim = {
  network: string;
  contractId: string;
  sourceContractId: string;
  policy: string;
  level: number;
  xp: string;
  state: string;
  claim_id: string;
  edition: string;
  receiver_id: string;
  expires_at: number;
  signature: string;
  token_id?: string;
};
export function assertNativeLevelClaim(
  c: NativeLevelClaim,
  account: string,
  level: number,
  edition: string,
  now = Date.now(),
) {
  if (
    !["issued", "minted"].includes(c.state) ||
    c.network !== NEAR_NETWORK ||
    c.contractId !== claims.contractId ||
    c.sourceContractId !== rewards.contractId ||
    c.receiver_id !== account ||
    c.policy !== NATIVE_LEVEL_POLICY ||
    c.level !== level ||
    c.edition !== edition ||
    !c.claim_id.startsWith("earned:level:") ||
    !/^earned:level:[a-f0-9]{64}$/.test(c.claim_id)
  )
    throw Error(
      "The level reward does not match your selected wallet and milestone.",
    );
  if (
    c.state !== "minted" &&
    (!Number.isSafeInteger(c.expires_at) ||
      c.expires_at <= now ||
      c.expires_at > now + 16 * 60_000 ||
      !/^([A-Za-z0-9+/]{4}){21}[A-Za-z0-9+/]{2}==$/.test(c.signature))
  )
    throw Error(
      "The level reward expired or could not be verified. Refresh before signing.",
    );
}
