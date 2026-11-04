// Mounted once the explorer account is ready: publishes the public NEAR Social
// profile in the background (src/auto-social-profile.ts). Renders nothing.
import { useEffect } from "react";
import { api } from "./api";
import { autoPublishProfile } from "./auto-social-profile";
import type { NativeSigner } from "./native-signer";
import type { Player } from "./types";

const tried = new Set<string>();
export function AutoSocialProfile({
  signer,
  player,
}: {
  signer: NativeSigner;
  player: Player;
}) {
  const accountId = signer.accountId;
  const linked = player.wallets.some((w) => w.account_id === accountId);
  useEffect(() => {
    if (!linked || signer.kind !== "managed" || tried.has(accountId)) return;
    tried.add(accountId);
    // Silent: a failure only means the player can still publish from Profile.
    void autoPublishProfile({
      accountId,
      playerId: player.id,
      name: player.name,
      signer,
      call: api,
    }).catch(() => {});
  }, [accountId, linked]);
  return null;
}
