// Plain-language reasons why the explorer's own account cannot sign yet. The
// app never falls back to a wallet popup for these: the player's account was
// made with the explorer and signs every in-game action by itself.
import { tr } from "./i18n.ts";
import type { InvisibleAccountStatus } from "./useInvisibleAccount";

export function explorerAccountMessage(reason: InvisibleAccountStatus): string {
  switch (reason) {
    case "play-first":
      return tr("Your account opens with your first find. Collect a coin or finish a quest, then try again.");
    case "needs-recovery":
      return tr("This device is not linked to your explorer yet. Open Profile, Settings, Account and devices to restore it with your recovery passkey.");
    case "error":
      return tr("Your account could not be prepared. Try again in a moment.");
    default:
      return tr("Your account is still being prepared. Try again in a few seconds.");
  }
}
