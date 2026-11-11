// Shop → Market: every Aura for sale as an illustrated card, Aavegotchi
// market style. Listings come from the NEAR Intents order book (the default
// market, NPC traders included) and the market contract. Filter by slot or
// your own listings, sort by name, rarity or price; a card opens a large
// preview with one Buy button. Selling starts from the Wardrobe.
import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowClockwise, Tag, X } from "@phosphor-icons/react";
import { api } from "./api";
import { tr } from "./i18n";
import { AuraSprite } from "./aura-art";
import { catalogEdition } from "./aura-catalog.ts";
import { formatNativeNear } from "./native-amounts";
import { grossForNet, type IntentsConfig } from "./intents-order";
import type { OrderSigner } from "./order-signers";
import { ChainLink } from "./ChainLink";
import type { ChainRef } from "./chain-proof";
import { Dialog } from "./Dialog";
import { EmptyState } from "./EmptyState";
import { FundsHelp } from "./FundsHelp";
import { checkFunds, fundsReason, nearText, GAS_HEADROOM, type FundsShortfall } from "./funds-help";
import type {
  NativeCollectionState,
  NativeMarketBalance,
  NativeMarketState,
  NativeTradeRequest,
  Player,
} from "./types";
import { arrangeListings, shortNear, type MarketFilter, type MarketListing, type MarketSort } from "./market-board";
import "./inventory.css";
import "./inventory-game.css";
import "./inventory-polish.css";
import "./market-board.css";

const rarityLabel = (rarity: string) =>
  ({ common: tr("Common"), uncommon: tr("Uncommon"), rare: tr("Rare"), epic: tr("Epic"), legendary: tr("Legendary") })[rarity] || rarity;

/** An NPC trader's account reads as its trader name, others as a short account. */
function sellerName(account: string, mine: boolean) {
  if (mine) return tr("You");
  const npc = account.match(/^npc-[a-z]+-([a-z]+)\./);
  if (npc) return npc[1][0].toUpperCase() + npc[1].slice(1);
  return account.length > 24 ? `${account.slice(0, 10)}…${account.slice(-8)}` : account;
}

export function MarketBoard({
  player,
  orderSigner,
  busy,
  onConnect,
  onTrade,
  onBought,
  explorerAccount,
  explorerStatus,
  onLinkWallet,
}: {
  player: Player;
  orderSigner: OrderSigner | null;
  busy: string;
  onConnect: () => Promise<void>;
  /** The invisible explorer account and why it may not be ready yet. */
  explorerAccount?: string;
  explorerStatus?: string;
  /** Links a NEAR wallet the player already has. */
  onLinkWallet?: () => Promise<void> | void;
  onTrade: (request: NativeTradeRequest) => Promise<boolean>;
  onBought: () => void;
}) {
  const [market, setMarket] = useState<NativeMarketState | null>(null);
  const [intents, setIntents] = useState<IntentsConfig | null>(null);
  const [collection, setCollection] = useState<NativeCollectionState | null>(null);
  const [balances, setBalances] = useState<NativeMarketBalance[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<MarketFilter>("all");
  const [sort, setSort] = useState<MarketSort>("newest");
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const [result, setResult] = useState<{ text: string; proof?: ChainRef; error?: boolean } | null>(null);
  // Why a Buy can't go through and what to do, instead of a bare error.
  const [help, setHelp] = useState<{ funds: FundsShortfall } | null>(null);
  const generation = useRef(0);
  const accounts = player.wallets.map((w) => w.account_id);
  const myAccount = orderSigner?.accountId || accounts[0] || "";

  async function load(fresh = false) {
    const request = ++generation.current;
    const q = fresh ? "?refresh=1" : "";
    const [m, i, c] = await Promise.all([
      api<NativeMarketState>("/native/market" + q).catch(() => null),
      api<IntentsConfig>("/native/intents").catch(() => null),
      api<NativeCollectionState>("/native/collection").catch(() => null),
    ]);
    const b =
      m?.status === "available" && accounts.length
        ? await api<{ accounts: NativeMarketBalance[] }>("/native/market/accounts" + q)
            .then((r) => r.accounts)
            .catch(() => [])
        : [];
    if (request !== generation.current) return;
    setMarket(m);
    setIntents(i);
    if (c) setCollection(c);
    setBalances(b);
    setError(!m && !i?.enabled ? tr("The secured market could not load. Try again in a moment.") : "");
    setLoading(false);
  }
  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), 20000);
    return () => {
      clearInterval(timer);
      generation.current++;
    };
  }, [accounts.join(",")]);

  const listings = useMemo(() => {
    const tokens = new Map((collection?.items || []).map((item) => [item.tokenId, item]));
    const out: MarketListing[] = [];
    const describe = (tokenId: string, known?: { title: string; edition: string | null; rarity: string; color: string } | null) => {
      const token = known || tokens.get(tokenId) || null;
      const edition = catalogEdition(token?.edition);
      return {
        title: token?.title || edition?.demoName || tr("Aura #{0}", { 0: tokenId }),
        edition: token?.edition || null,
        rarity: token?.rarity || edition?.rarity || "common",
        slot: (edition?.slot === "below" ? "below" : "above") as "above" | "below",
        color: token?.color || null,
      };
    };
    if (intents?.enabled)
      intents.orders.forEach((o, index) => {
        if (o.side !== "sell" || o.state !== "open") return;
        out.push({
          key: `intents:${o.id}`,
          source: "intents",
          id: o.id,
          tokenId: o.tokenId,
          ...describe(o.tokenId),
          price: o.price,
          pays: o.buyerPays || grossForNet(o.price, intents.fee || 0),
          seller: o.maker,
          mine: o.maker === myAccount || accounts.includes(o.maker),
          order: o.deadlineMs || index,
        });
      });
    if (market?.status === "available")
      market.listings.forEach((offer) => {
        if (offer.state !== "active") return;
        out.push({
          key: `market:${offer.id}`,
          source: "market",
          id: String(offer.id),
          listingId: offer.id,
          tokenId: offer.token_id,
          ...describe(offer.token_id, offer.token),
          price: offer.price,
          pays: offer.price,
          seller: offer.seller,
          mine: accounts.includes(offer.seller),
          order: offer.id,
        });
      });
    return out;
  }, [market, intents, collection, myAccount, accounts.join(",")]);
  const shown = arrangeListings([...listings], filter, sort);
  const open = listings.find((l) => l.key === openKey) || null;
  const credit = balances.find((b) => b.accountId === myAccount && b.credit !== "0" && b.withdrawing === "0");
  const mineCount = listings.filter((l) => l.mine).length;

  /** The account that pays for this listing ("" when none can) and the NEAR it needs, gas included. */
  async function buyerNeeds(listing: MarketListing): Promise<{ account: string; need: bigint }> {
    const viaIntents = listing.source === "intents";
    const account = viaIntents ? (orderSigner?.key ? orderSigner.accountId : "") : myAccount;
    let need = BigInt(listing.pays) + GAS_HEADROOM;
    if (viaIntents && account) {
      // wNEAR already deposited in the Intents account pays first.
      const held = await api<{ wnear?: string }>(`/native/intents/account?account=${encodeURIComponent(account)}`)
        .then((r) => BigInt(r.wnear || "0"))
        .catch(() => 0n);
      need = need > held ? need - held : GAS_HEADROOM;
    }
    return { account, need };
  }
  async function explain(listing: MarketListing): Promise<boolean> {
    const { account, need } = await buyerNeeds(listing);
    const funds = await checkFunds(account, need);
    // Enough NEAR and an account: the cause is elsewhere, so the plain message stays.
    if (fundsReason(funds) === "unknown") return false;
    setHelp({ funds });
    return true;
  }
  async function buy(listing: MarketListing) {
    setWorking(true);
    setResult(null);
    try {
      // Explain first when it can't work: no account to pay from, or too little NEAR.
      if (await explain(listing)) return;
      if (listing.source === "intents") {
        if (!orderSigner?.key) throw Error(tr("Trades through Intents need the explorer's device key."));
        const { buyAuraOnIntents } = await import("./intents-order");
        const r = await buyAuraOnIntents(orderSigner, { id: listing.id, tokenId: listing.tokenId, price: listing.price });
        setResult({ text: tr("The Aura is yours. Find it in your Wardrobe."), proof: { tx: r.transactionHash, status: "confirmed" } });
      } else {
        const ok = await onTrade({
          kind: "buy",
          accountId: myAccount,
          marketId: market?.marketContract || "",
          nftContractId: market?.nftContract || "",
          tokenId: listing.tokenId,
          listingId: listing.listingId,
          price: listing.price,
        });
        if (!ok) throw Error(tr("The market action could not finish. Try again."));
        setResult({ text: tr("The Aura is yours. Find it in your Wardrobe."), proof: { id: `latest:market:${Date.now() - 60_000}`, account: myAccount } });
      }
      onBought();
      await load(true);
    } catch (e) {
      const text = e instanceof Error ? e.message : tr("The market action could not finish. Try again.");
      // A failed buy opens the same help: it re-reads the balance and says why.
      if (!(await explain(listing).catch(() => false))) setResult({ text, error: true });
    } finally {
      setWorking(false);
    }
  }
  async function cancel(listing: MarketListing) {
    setWorking(true);
    setResult(null);
    try {
      const ok = await onTrade({
        kind: "cancel",
        accountId: listing.seller,
        marketId: market?.marketContract || "",
        nftContractId: market?.nftContract || "",
        tokenId: listing.tokenId,
        listingId: listing.listingId,
      });
      if (!ok) throw Error(tr("The market action could not finish. Try again."));
      setResult({ text: tr("Your Aura is back in your Wardrobe.") });
      await load(true);
    } catch (e) {
      setResult({ text: e instanceof Error ? e.message : tr("The market action could not finish. Try again."), error: true });
    } finally {
      setWorking(false);
    }
  }
  async function withdraw() {
    if (!market) return;
    setWorking(true);
    try {
      await onTrade({ kind: "withdraw", accountId: myAccount, marketId: market.marketContract, nftContractId: market.nftContract });
      await load(true);
    } finally {
      setWorking(false);
    }
  }
  const locked = !!busy || working;

  return (
    <section className="inventory-experience market-board" aria-label={tr("Market")}>
      <div className="market-board-tools">
        <div className="inv-chips" role="group" aria-label={tr("Filter Auras")}>
          {(["all", "above", "below", "mine"] as const).map((id) => (
            <button key={id} type="button" className="inv-chip" aria-pressed={filter === id} onClick={() => setFilter(id)}>
              {id === "all" ? (
                <>
                  {tr("All")} <span className="inv-chip-count">{listings.length}</span>
                </>
              ) : id === "above" ? (
                tr("Above")
              ) : id === "below" ? (
                tr("Below")
              ) : (
                <>
                  {tr("Mine")} {!!mineCount && <span className="inv-chip-count">{mineCount}</span>}
                </>
              )}
            </button>
          ))}
        </div>
        <label className="market-board-sort">
          <span className="sr-only">{tr("Sort")}</span>
          <select value={sort} onChange={(e) => setSort(e.target.value as MarketSort)}>
            <option value="newest">{tr("Newest")}</option>
            <option value="name">{tr("Name A–Z")}</option>
            <option value="rarity">{tr("Rarity")}</option>
            <option value="price-up">{tr("Price: low to high")}</option>
            <option value="price-down">{tr("Price: high to low")}</option>
          </select>
        </label>
        <button
          type="button"
          className="market-refresh"
          aria-label={tr("Refresh market")}
          title={tr("Refresh market")}
          disabled={locked}
          onClick={() => void load(true)}
        >
          <ArrowClockwise size={20} aria-hidden="true" />
        </button>
      </div>
      {error && <p role="alert">{error}</p>}
      {result && !open && (
        <p role={result.error ? "alert" : "status"} className="native-market-message">
          {result.text} {result.proof && <ChainLink label chain={result.proof} />}
        </p>
      )}
      {credit && (
        <p className="market-board-credit">
          <span>
            {tr("Available to withdraw:")} <strong>{formatNativeNear(credit.credit)} NEAR</strong>
          </span>
          <button type="button" className="button secondary" disabled={locked} onClick={() => void withdraw()}>
            {tr("Withdraw market balance")}
          </button>
        </p>
      )}
      {loading ? (
        <EmptyState art="chest" title={tr("Loading the market…")} status />
      ) : !shown.length ? (
        <EmptyState art="chest" title={tr("No Auras on the market yet")}>
          {tr("Sell an Aura from your Wardrobe and it shows up here.")}
        </EmptyState>
      ) : (
        <ul className="market-board-grid">
          {shown.map((l) => (
            <li key={l.key}>
              <button
                type="button"
                className={`market-card rarity-${l.rarity}${l.mine ? " mine" : ""}`}
                onClick={() => {
                  setResult(null);
                  setOpenKey(l.key);
                }}
                aria-label={tr("{0}, {1}, {2} NEAR", { 0: l.title, 1: rarityLabel(l.rarity), 2: shortNear(l.pays) })}
              >
                {l.mine && <span className="market-card-mine">{tr("Yours")}</span>}
                <span className="market-card-art" aria-hidden="true">
                  <AuraSprite edition={l.edition} slot={l.slot} color={l.color} size={1} animated={false} />
                </span>
                <strong>{l.title}</strong>
                <small className={`inv-rarity rarity-${l.rarity}`}>{rarityLabel(l.rarity)}</small>
                <span className="market-card-price">{shortNear(l.pays)} NEAR</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {open && (
        <Dialog label={open.title} onClose={() => setOpenKey(null)}>
          <section className="inventory-dialog inv-detail market-detail">
            <header className="inv-detail-head">
              <div className="inv-detail-title">
                <h2>{open.title}</h2>
                <p>
                  <span className={`inv-rarity rarity-${open.rarity}`}>{rarityLabel(open.rarity)}</span> ·{" "}
                  {open.slot === "above" ? tr("Above") : tr("Below")}
                </p>
              </div>
              <button className="inventory-icon-button sheet-close" aria-label={tr("Close")} onClick={() => setOpenKey(null)}>
                <X size={16} />
              </button>
            </header>
            <div className={`market-detail-art rarity-${open.rarity}`} aria-hidden="true">
              <AuraSprite edition={open.edition} slot={open.slot} color={open.color} size={3} />
            </div>
            <dl className="market-detail-facts">
              <div>
                <dt>{tr("Price")}</dt>
                <dd>{shortNear(open.pays)} NEAR</dd>
              </div>
              <div>
                <dt>{tr("Seller")}</dt>
                <dd>{sellerName(open.seller, open.mine)}</dd>
              </div>
            </dl>
            {open.source === "intents" && !!intents?.fee && (
              <p className="fine-print">{tr("Prices include {0} % for the prize pool.", { 0: String(intents.fee / 10_000) })}</p>
            )}
            {result && (
              <p role={result.error ? "alert" : "status"} className="native-market-message">
                {result.text} {result.proof && <ChainLink label chain={result.proof} />}
              </p>
            )}
            {open.mine ? (
              open.source === "market" ? (
                <button type="button" className="inventory-secondary" disabled={locked} onClick={() => void cancel(open)}>
                  {tr("Cancel listing")}
                </button>
              ) : (
                <p className="inventory-sale-note">{tr("Your listing. It stays on the market until someone buys it.")}</p>
              )
            ) : !myAccount ? (
              <button type="button" className="inventory-action" disabled={locked} onClick={() => void onConnect()}>
                {tr("Activate my account")}
              </button>
            ) : (
              <button type="button" className="inventory-action" disabled={locked} onClick={() => void buy(open)}>
                <Tag size={20} aria-hidden="true" />
                {working ? tr("Working…") : tr("Buy for {0} NEAR", { 0: shortNear(open.pays) })}
              </button>
            )}
          </section>
        </Dialog>
      )}
      {help && (
        <FundsHelp
          title={tr("Why you can't buy this yet")}
          needLine={tr("Buying it needs about {0} NEAR (the price and a little gas).", { 0: nearText(help.funds.need, 2) })}
          funds={help.funds}
          explorerAccount={explorerAccount}
          explorerStatus={explorerStatus}
          onRecheck={() =>
            void checkFunds(help.funds.account, help.funds.need).then((funds) => setHelp((h) => (h ? { ...h, funds } : h)))
          }
          onLinkWallet={onLinkWallet}
          onClose={() => setHelp(null)}
        />
      )}
    </section>
  );
}
