// Settings → On chain: everything this explorer did on NEAR, newest first,
// each with its proof icon. Two sources, merged here:
//   /api/chain/feed     relayed explorer-account calls, native reward claims,
//                       badge mints and history rows with a transaction
//   /api/chain/actions  coin, XP, street find, monster and quest records
//                       (optional: older servers answer 404)
import { useCallback, useEffect, useState } from "react";
import { ArrowClockwise, ArrowSquareOut, Cube } from "@phosphor-icons/react";
import { ArrowRight } from "./dir-icons";
import { api, gold } from "./api";
import { tr } from "./i18n";
import { EXPLORER_BASE } from "./near-network.ts";
import { ChainLink } from "./ChainLink";
import type { ChainRef } from "./chain-proof";
import "./chain-feed.css";
export { ChainLink };
export { AutoSocialProfile } from "./AutoSocialProfile";

export type ChainFeedItem = ChainRef & {
  id: string;
  kind: string;
  at: number;
  xp?: number | null;
  gold?: number | null;
};

const TITLES: Record<string, () => string> = {
  account: () => tr("Explorer account created"),
  profile: () => tr("Public profile saved"),
  native_profile: () => tr("Public profile saved"),
  aura: () => tr("Aura secured as NFT"),
  "native-aura": () => tr("Aura secured as NFT"),
  avatar: () => tr("Explorer minted"),
  wardrobe: () => tr("Outfit changed"),
  market: () => tr("Market trade"),
  "intents-trade": () => tr("Aura trade on NEAR Intents"),
  "intents-withdraw": () => tr("Withdrawn from NEAR Intents"),
  "npc-trade": () => tr("Trade with a trader"),
  transfer: () => tr("Aura sent"),
  roll: () => tr("Wisp roll"),
  stake: () => tr("Stake"),
  creator: () => tr("Creator quest"),
  key: () => tr("Device key"),
  "reward-coin": () => tr("Coin reward"),
  "reward-quest": () => tr("Quest reward"),
  badge: () => tr("Badge minted"),
  coin: () => tr("Coin collected"),
  find: () => tr("Street find"),
  "street-find": () => tr("Street find"),
  quest: () => tr("Quest complete"),
  monster: () => tr("Monster defeated"),
  xp: () => tr("XP earned"),
};
export const feedTitle = (kind: string) =>
  (TITLES[kind] ?? (() => tr("Transaction")))();

type Answer = { items?: unknown[]; actions?: unknown[] };
const asItems = (answer: Answer | null): ChainFeedItem[] => {
  const list = answer?.items ?? answer?.actions ?? [];
  return (Array.isArray(list) ? list : [])
    .filter(
      (x): x is Record<string, unknown> =>
        !!x && typeof x === "object" && typeof (x as { id?: unknown }).id === "string",
    )
    .map((x) => ({
      ...(x as ChainFeedItem),
      kind: typeof x.kind === "string" ? x.kind : "other",
      at: Number(x.at ?? x.createdAt ?? 0) || 0,
    }));
};

/** Both sources, deduplicated by transaction, newest first. */
export function mergeFeeds(...lists: ChainFeedItem[][]): ChainFeedItem[] {
  const seen = new Set<string>(),
    out: ChainFeedItem[] = [];
  for (const item of lists.flat().sort((a, b) => b.at - a.at)) {
    const key = item.tx ? `tx:${item.tx}` : `id:${item.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

export function ChainFeed({ accountId }: { accountId: string | null }) {
  const [items, setItems] = useState<ChainFeedItem[] | null>(null),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(false);
  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [feed, actions] = await Promise.all([
        api<Answer>("/chain/feed?limit=50"),
        api<Answer>("/chain/actions?limit=50").catch(() => null),
      ]);
      setItems(mergeFeeds(asItems(feed), asItems(actions)).slice(0, 60));
    } catch {
      setError(tr("The on-chain feed is unavailable. Try again."));
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  return (
    <div className="chain-feed">
      <div className="chain-feed-head">
        {accountId ? (
          <a
            className="chain-feed-account"
            href={`${EXPLORER_BASE}/address/${accountId}`}
            target="_blank"
            rel="noreferrer"
          >
            <Cube size={18} aria-hidden="true" />
            <span>{accountId}</span>
            <ArrowSquareOut size={16} aria-hidden="true" />
          </a>
        ) : (
          <span className="chain-feed-account">
            {tr("Your explorer account is still being prepared.")}
          </span>
        )}
        <button
          type="button"
          className="chain-feed-refresh"
          aria-label={tr("Refresh")}
          disabled={loading}
          onClick={() => void load()}
        >
          <ArrowClockwise size={18} aria-hidden="true" />
        </button>
      </div>
      {error && (
        <p className="inline-error" role="alert">
          {error}
        </p>
      )}
      {!items && !error && <p role="status">{tr("Loading…")}</p>}
      {items && items.length === 0 && (
        <p className="fine-print">
          {tr("Nothing on NEAR yet. Secured Auras, badges, wisp rolls and trades appear here.")}
        </p>
      )}
      {items && items.length > 0 && (
        <ol className="chain-feed-list">
          {items.map((item) => (
            <li key={item.id}>
              <span className="chain-feed-text">
                <b>{feedTitle(item.kind)}</b>
                <small>
                  {item.at
                    ? new Date(item.at).toLocaleString([], {
                        day: "numeric",
                        month: "short",
                        hour: "2-digit",
                        minute: "2-digit",
                      })
                    : ""}
                  {typeof item.xp === "number" && item.xp > 0 ? ` · +${item.xp} XP` : ""}
                  {typeof item.gold === "number" && item.gold > 0
                    ? ` · +${gold(item.gold)} GOLD`
                    : ""}
                </small>
              </span>
              <ChainLink label chain={item} />
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

/** Settings → On chain: one row that opens the feed. */
export function ChainSettings({ accountId }: { accountId: string | null }) {
  const [open, setOpen] = useState(false);
  return (
    <section className="settings-group" aria-labelledby="settings-chain-title">
      <h2 id="settings-chain-title">{tr("On chain")}</h2>
      <button
        type="button"
        className="settings-row"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <Cube size={22} aria-hidden="true" />
        <span>
          {tr("On-chain feed")}
          <small>{tr("Every action saved on NEAR, with explorer links")}</small>
        </span>
        <ArrowRight size={18} aria-hidden="true" />
      </button>
      {open && (
        <div className="settings-pad">
          <ChainFeed accountId={accountId} />
        </div>
      )}
    </section>
  );
}
