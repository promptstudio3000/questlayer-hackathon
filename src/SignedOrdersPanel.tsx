// Signed Aura offers (market version 2). The explorer's device key signs order
// terms silently with NEP-413; nothing moves until someone fills the order on
// chain. Free actions (turning offers on, escrowing an Aura, cancelling) go
// through the relayer; anything that moves money (buying, accepting an offer,
// funding an offer) is paid from the explorer's own account, still without a
// wallet popup.
import { EmptyState } from "./EmptyState";
import { Details } from "./ScreenTabs";
import { useEffect, useRef, useState } from "react";
import { api } from "./api";
import { formatNativeNear, parseNearPrice } from "./native-amounts";
import type { OrderSigner } from "./order-signers";
import {
  ORDER_STATUS_TEXT,
  ORDER_TTL_CHOICES,
  orderTerms,
  type OrderStatus,
  type OrderTerms,
  type SignedOrder,
} from "./signed-order";
import type { NativeItem, NativeMarketBalance, NativeMarketState } from "./types";
import { tr } from "./i18n";

export type MarketCall = {
  receiverId: string;
  methodName: string;
  args: Record<string, unknown>;
  deposit: string;
  gas: string;
};
type RelayedOrder = {
  id: string;
  terms: OrderTerms;
  order: SignedOrder;
  fillable: boolean;
};
type MyOrder = {
  order: SignedOrder;
  terms: OrderTerms;
  status: OrderStatus;
  cancelled?: boolean;
};
const GAS = "150000000000000";
const historyKey = (account: string) => `questlayer-signed-orders:${account}`;
function loadHistory(account: string): MyOrder[] {
  try {
    const raw = localStorage.getItem(historyKey(account));
    return raw ? (JSON.parse(raw) as MyOrder[]).slice(0, 20) : [];
  } catch {
    return [];
  }
}
function saveHistory(account: string, orders: MyOrder[]) {
  try {
    localStorage.setItem(historyKey(account), JSON.stringify(orders.slice(0, 20)));
  } catch {
    /* History is a convenience; the contract stays the authority. */
  }
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
function expiresIn(deadline: string) {
  const ms = Number(deadline) - Date.now();
  if (ms <= 0) return "expired";
  const h = Math.floor(ms / 3600000);
  return h >= 24
    ? tr("expires in {0} d", { 0: Math.floor(h / 24) })
    : h >= 1
      ? tr("expires in {0} h", { 0: h })
      : tr("expires in {0} min", { 0: Math.max(1, Math.floor(ms / 60000)) });
}

export function SignedOrdersPanel({
  data,
  signer,
  owned,
  balance,
  busy,
  onChanged,
}: {
  data: NativeMarketState;
  signer: OrderSigner | null;
  owned: NativeItem[];
  balance: NativeMarketBalance | undefined;
  busy: string;
  onChanged: () => Promise<NativeMarketState>;
}) {
  const accountId = signer?.accountId ?? null;
  const [registry, setRegistry] = useState<{ keys: string[]; epoch: number } | null>(null),
    [book, setBook] = useState<RelayedOrder[]>([]),
    [mine, setMine] = useState<MyOrder[]>([]),
    [step, setStep] = useState(""),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [sellToken, setSellToken] = useState(""),
    [sellPrice, setSellPrice] = useState("10"),
    [ttl, setTtl] = useState<number>(ORDER_TTL_CHOICES[1].ms),
    [offerFor, setOfferFor] = useState(""),
    [offerPrice, setOfferPrice] = useState("1"),
    [priceError, setPriceError] = useState("");
  const priceInput = useRef<HTMLInputElement>(null),
    offerInput = useRef<HTMLInputElement>(null);
  const v2 = data.stats.version === 2;
  const ready = v2 && !!signer;
  const knownKey = signer?.knownPublicKey() ?? null;
  const enabled = ready && !!knownKey && !!registry?.keys.includes(knownKey);
  const wallet = signer?.kind === "wallet";
  const escrowedByMe = data.listings.filter(
    (l) => l.state === "deposited" && l.seller === accountId,
  );
  const sellable = [
    ...escrowedByMe.map((l) => ({ tokenId: l.token_id, title: l.token?.title || l.token_id, escrowed: true })),
    ...owned.map((i) => ({ tokenId: i.tokenId, title: `#${i.serial} · ${i.title}`, escrowed: false })),
  ];
  const working = !!busy || !!step;

  async function refresh() {
    if (!v2) return;
    const [orders, me] = await Promise.all([
      api<{ orders: RelayedOrder[] }>("/native/market/orders"),
      accountId
        ? api<{ keys: string[]; epoch: number }>(
            "/native/market/signer?account=" + encodeURIComponent(accountId),
          )
        : Promise.resolve(null),
    ]);
    setBook(orders.orders);
    setRegistry(me);
    if (accountId) {
      const history = loadHistory(accountId);
      const live = history.filter((o) => o.status === "open" || o.status === "pending");
      if (live.length) {
        const { statuses } = await api<{ statuses: { state: OrderStatus }[] }>(
          "/native/market/orders/status",
          { orders: live.map((o) => o.order) },
        );
        live.forEach((o, i) => {
          const state = statuses[i]?.state;
          // The index knows cancellations from chain events; a local cancel
          // still wins while its event is being recorded.
          if (state) o.status = state === "filled" && o.cancelled ? "cancelled" : state;
        });
        saveHistory(accountId, history);
      }
      setMine(history);
    }
  }
  useEffect(() => {
    void refresh().catch(() => {});
    const timer = setInterval(() => void refresh().catch(() => {}), 20000);
    return () => clearInterval(timer);
  }, [v2, accountId, data.listings.length]);
  useEffect(() => {
    if (!sellable.some((s) => s.tokenId === sellToken)) setSellToken(sellable[0]?.tokenId || "");
  }, [sellable.map((s) => s.tokenId).join(",")]);

  async function run(label: string, work: () => Promise<string>) {
    setError("");
    setMessage("");
    setStep(label);
    try {
      setMessage(await work());
    } catch (e) {
      setError(e instanceof Error ? e.message : tr("The signed offer could not finish. Try again."));
    } finally {
      setStep("");
      void refresh().catch(() => {});
    }
  }
  async function call(c: Omit<MarketCall, "gas"> & { gas?: string }) {
    const hash = await signer!.call({ gas: GAS, ...c });
    // Feed the durable order index; it reads the final receipt itself.
    if (hash)
      void api("/native/market/orders/events", {
        transactionHash: hash,
        accountId,
      }).catch(() => {});
  }
  async function waitFor(check: (s: NativeMarketState) => boolean) {
    for (let i = 0; i < 8; i++) {
      if (check(await onChanged())) return true;
      await sleep(1000);
    }
    return false;
  }
  async function publish(kind: "sell" | "buy", tokenId: string, price: string) {
    const fresh = await api<{ keys: string[]; epoch: number }>(
      "/native/market/signer?account=" + encodeURIComponent(accountId!),
    );
    const terms = orderTerms({
      kind,
      market: data.marketContract,
      nftContract: data.nftContract,
      maker: accountId!,
      tokenId,
      price,
      deadlineMs: Date.now() + ttl,
      epoch: fresh.epoch,
    });
    const order = await signer!.sign(terms);
    const history = [{ order, terms, status: "pending" as OrderStatus }, ...loadHistory(accountId!)];
    saveHistory(accountId!, history);
    setMine(history);
    await api("/native/market/orders", { order });
    history[0].status = "open";
    saveHistory(accountId!, history);
  }

  const enable = () =>
    run(tr("Turning on signed offers…"), async () => {
      const publicKey = await signer!.publicKey(data.marketContract);
      if (!registry?.keys.includes(publicKey))
        await call({
          receiverId: data.marketContract,
          methodName: "add_signing_key",
          args: { public_key: publicKey },
          deposit: "1",
        });
      return wallet
        ? tr("Signed offers are on. Your wallet asks you to approve each order you sign.")
        : tr("Signed offers are on. This device signs them for you, with no popup.");
    });
  const sell = (price: string) =>
    run(tr("Signing your sell order…"), async () => {
      const item = sellable.find((s) => s.tokenId === sellToken);
      if (!item) throw Error("Choose an Aura you own.");
      if (!item.escrowed) {
        setStep(tr("Handing the Aura to the market…"));
        await call({
          receiverId: data.nftContract,
          methodName: "nft_transfer_call",
          args: { receiver_id: data.marketContract, token_id: item.tokenId, approval_id: null, memo: null, msg: JSON.stringify({ deposit: true }) },
          deposit: "1",
          gas: "200000000000000",
        });
        const held = await waitFor((s) =>
          s.listings.some((l) => l.token_id === item.tokenId && l.state === "deposited" && l.seller === accountId),
        );
        if (!held) throw Error("The market has not confirmed the Aura yet. Refresh, then sign again.");
        setStep(tr("Signing your sell order…"));
      }
      await publish("sell", item.tokenId, price);
      return tr("Your sell order for {0} test NEAR is open. The Aura stays held by the market until someone buys it or you cancel.", { 0: formatNativeNear(price) });
    });
  const offer = (tokenId: string, price: string) =>
    run(tr("Signing your offer…"), async () => {
      const credit = BigInt(balance?.credit || "0"),
        need = BigInt(price);
      if (credit < need) {
        setStep(tr("Adding test NEAR to your market balance…"));
        const top = need - credit < 10n ** 21n ? 10n ** 21n : need - credit;
        await call({ receiverId: data.marketContract, methodName: "deposit_near", args: {}, deposit: top.toString() });
      }
      setStep(tr("Signing your offer…"));
      await publish("buy", tokenId, price);
      setOfferFor("");
      return tr("Your offer of {0} test NEAR is open. Your market balance pays only if the owner accepts.", { 0: formatNativeNear(price) });
    });
  const fill = (o: RelayedOrder) =>
    run(o.terms.kind === "sell" ? tr("Buying the Aura…") : tr("Accepting the offer…"), async () => {
      const sellOrder = o.terms.kind === "sell";
      // A buy order (for example from an NPC trader) names an Aura you still
      // hold in your wallet: hand it to the market first, then accept.
      if (!sellOrder && !escrowedByMe.some((l) => l.token_id === o.terms.token_id)) {
        setStep(tr("Handing the Aura to the market…"));
        await call({
          receiverId: data.nftContract,
          methodName: "nft_transfer_call",
          args: { receiver_id: data.marketContract, token_id: o.terms.token_id, approval_id: null, memo: null, msg: JSON.stringify({ deposit: true }) },
          deposit: "1",
          gas: "200000000000000",
        });
        const held = await waitFor((s) =>
          s.listings.some((l) => l.token_id === o.terms.token_id && l.state === "deposited" && l.seller === accountId),
        );
        if (!held) throw Error("The market has not confirmed the Aura yet. Refresh, then accept again.");
        setStep(tr("Accepting the offer…"));
      }
      await call({
        receiverId: data.marketContract,
        methodName: sellOrder ? "fill_sell_order" : "fill_buy_order",
        args: { order: o.order },
        deposit: sellOrder ? o.terms.price : "1",
        gas: "200000000000000",
      });
      const done = await waitFor((s) => !s.listings.some((l) => l.token_id === o.terms.token_id));
      return done
        ? sellOrder
          ? tr("The Aura is yours. Find it in your Secured collection.")
          : tr("Offer accepted. The test NEAR is in your market balance.")
        : tr("Still settling. Refresh your collection and balance before retrying.");
    });
  const cancelOrder = (m: MyOrder) =>
    run(tr("Cancelling the order on chain…"), async () => {
      await call({ receiverId: data.marketContract, methodName: "cancel_order", args: { order: m.order }, deposit: "1" });
      const history = loadHistory(accountId!).map((h) =>
        h.order.nonce === m.order.nonce ? { ...h, cancelled: true, status: "cancelled" as OrderStatus } : h,
      );
      saveHistory(accountId!, history);
      return tr("Order cancelled on chain. Nobody can accept it any more.");
    });
  const cancelAll = () =>
    run(tr("Cancelling all your orders…"), async () => {
      await call({ receiverId: data.marketContract, methodName: "cancel_all_orders", args: {}, deposit: "1" });
      const history = loadHistory(accountId!).map((h) =>
        h.status === "open" || h.status === "pending" ? { ...h, cancelled: true, status: "cancelled" as OrderStatus } : h,
      );
      saveHistory(accountId!, history);
      return tr("Every order you signed before now is cancelled on chain.");
    });
  const priceFrom = (value: string, input = priceInput) => {
    try {
      setPriceError("");
      return parseNearPrice(value);
    } catch (e) {
      setPriceError(e instanceof Error ? e.message : tr("Choose a valid price."));
      input.current?.focus();
      return null;
    }
  };

  if (!v2) return null;
  const others = book.filter((o) => o.terms.maker !== accountId);
  const openMine = mine.filter((m) => m.status === "open" || m.status === "pending");
  return (
    <section className="signed-orders" aria-labelledby="signed-orders-title">
      <h3 id="signed-orders-title">{tr("Signed offers")}</h3>
      <p>{tr("Name an exact price in test NEAR and how long it stays open.")}</p>
      <Details>
        <p>
          {wallet
            ? tr("Your wallet signs each order; approving it publishes the order but moves nothing.")
            : tr("Your explorer signs the order on this device, with no popup.")}{" "}
          {tr("Only an Aura held by the market can be traded, and the market checks every signature before anything moves.")}</p>
      </Details>
      {error && <p role="alert">{error}</p>}
      {step && <p role="status">{step}</p>}
      {message && !step && (
        <p role="status" className="native-market-message">
          {message}
        </p>
      )}
      {!ready ? (
        <p>
          {tr("Link a NEAR account or start your QuestLayer explorer to sign offers.")}</p>
      ) : !registry ? (
        <p role="status">{tr("Checking your signing key…")}</p>
      ) : !enabled ? (
        <button className="primary-button" disabled={working} onClick={() => void enable()}>
          {tr("Turn on signed offers")}</button>
      ) : (
        <>
          <form
            className="native-sell-form"
            onSubmit={(e) => {
              e.preventDefault();
              const p = priceFrom(sellPrice);
              if (p) void sell(p);
            }}
          >
            <h4>{tr("Sell with a signed order")}</h4>
            {!sellable.length ? (
              <p>{tr("You have no secured Aura to sell.")}</p>
            ) : (
              <>
                <label>
                  {tr("Aura")}<select value={sellToken} onChange={(e) => setSellToken(e.target.value)}>
                    {sellable.map((s) => (
                      <option key={s.tokenId} value={s.tokenId}>
                        {s.title}
                        {s.escrowed ? tr(" (held by the market)") : ""}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  {tr("Sell price in test NEAR")}<input
                    ref={priceInput}
                    value={sellPrice}
                    inputMode="decimal"
                    autoComplete="off"
                    aria-invalid={!!priceError}
                    aria-describedby={priceError ? "signed-price-error" : undefined}
                    onChange={(e) => {
                      setSellPrice(e.target.value);
                      setPriceError("");
                    }}
                  />
                </label>
                {priceError && (
                  <p id="signed-price-error" role="alert">
                    {priceError}
                  </p>
                )}
                <label>
                  {tr("Open for")}<select value={ttl} onChange={(e) => setTtl(Number(e.target.value))}>
                    {ORDER_TTL_CHOICES.map((c) => (
                      <option key={c.ms} value={c.ms}>
                        {c.label}
                      </option>
                    ))}
                  </select>
                </label>
                <p>
                  {tr("If the Aura is in your collection, the market holds it first. That step is free. A buyer pays exactly your price.")}</p>
                <button className="primary-button" disabled={working || data.stats.paused}>
                  {tr("Sign sell order")}</button>
              </>
            )}
          </form>
          <h4>{tr("Open orders")}</h4>
          {!others.length ? (
            <EmptyState art="coin" title={tr("No open orders right now")}>
              {tr("Signed orders from other explorers and traders show up here.")}</EmptyState>
          ) : (
            <div className="native-offers">
              {others.map((o) => {
                const sellOrder = o.terms.kind === "sell",
                  heldByMe = escrowedByMe.some((l) => l.token_id === o.terms.token_id),
                  inWallet = owned.some((i) => i.tokenId === o.terms.token_id),
                  canAct = sellOrder ? o.fillable : (o.fillable && heldByMe) || (!sellOrder && inWallet);
                return (
                  <article className="native-offer signed-order" key={o.id}>
                    <div>
                      <h3>{sellOrder ? tr("For sale") : tr("Offer to buy")}</h3>
                      <span className="native-address">{o.terms.token_id}</span>
                      <strong className="native-price">{formatNativeNear(o.terms.price)} {" "}{tr("test NEAR")}</strong>
                      <span className="native-address">
                        {sellOrder ? tr("Seller") : tr("Buyer")}: {o.terms.maker}
                      </span>
                      <span>{expiresIn(o.terms.deadline_ms)}</span>
                      {!canAct && (
                        <span>
                          {sellOrder
                            ? tr("Not available: the Aura is not held by the market for this seller.")
                            : heldByMe
                              ? tr("The buyer's market balance no longer covers this offer.")
                              : tr("Only the Aura's owner can accept, after the market holds it.")}
                        </span>
                      )}
                      {canAct && (
                        <span>
                          {sellOrder
                            ? tr("Paid from your account: the exact price plus a small network fee.")
                            : tr("You receive the price in your market balance. Your account pays a small network fee.")}
                        </span>
                      )}
                    </div>
                    {(sellOrder || heldByMe || inWallet) && (
                      <button
                        className="primary-button"
                        disabled={working || data.stats.paused || !canAct}
                        onClick={() => void fill(o)}
                      >
                        {sellOrder ? tr("Buy for {0} test NEAR", { 0: formatNativeNear(o.terms.price) }) : heldByMe ? tr("Accept offer") : tr("Hand to the market and accept")}
                      </button>
                    )}
                  </article>
                );
              })}
            </div>
          )}
          {data.listings.some((l) => l.state === "deposited" && l.seller !== accountId) && (
            <>
              <h4>{tr("Make an offer")}</h4>
              <div className="native-offers">
                {data.listings
                  .filter((l) => l.state === "deposited" && l.seller !== accountId)
                  .map((l) => (
                    <article className="native-offer signed-order" key={l.id}>
                      <div>
                        <h3>{l.token?.title || tr("Native Aura")}</h3>
                        <span className="native-address">{l.token_id}</span>
                        <span className="native-address">{tr("Owner:")}{" "}{l.seller}</span>
                        <span>{tr("Held by the market for signed offers")}</span>
                      </div>
                      {offerFor === l.token_id ? (
                        <form
                          className="signed-offer-form"
                          onSubmit={(e) => {
                            e.preventDefault();
                            const p = priceFrom(offerPrice, offerInput);
                            if (p) void offer(l.token_id, p);
                          }}
                        >
                          <label>
                            {tr("Your offer in test NEAR")}<input
                              ref={offerInput}
                              value={offerPrice}
                              aria-invalid={!!priceError}
                              inputMode="decimal"
                              autoComplete="off"
                              onChange={(e) => {
                                setOfferPrice(e.target.value);
                                setPriceError("");
                              }}
                            />
                          </label>
                          {priceError && <p role="alert">{priceError}</p>}
                          <p>
                            {tr("Market balance:")}{" "}{formatNativeNear(balance?.credit || "0")} {" "}{tr("test NEAR. Anything missing is added from your account first.")}</p>
                          <button className="primary-button" disabled={working || data.stats.paused}>
                            {tr("Sign offer")}</button>
                          <button type="button" className="button secondary" onClick={() => setOfferFor("")}>
                            {tr("Not now")}</button>
                        </form>
                      ) : (
                        <button className="button secondary" disabled={working} onClick={() => setOfferFor(l.token_id)}>
                          {tr("Make an offer")}</button>
                      )}
                    </article>
                  ))}
              </div>
            </>
          )}
          <h4>{tr("Your signed orders")}</h4>
          {!mine.length ? (
            <p>{tr("You have not signed any orders on this device.")}</p>
          ) : (
            <ul className="signed-order-history">
              {mine.map((m) => (
                <li key={m.order.nonce} data-status={m.status}>
                  <span>
                    {m.terms.kind === "sell" ? tr("Sell") : tr("Offer")} · {m.terms.token_id} ·{" "}
                    {formatNativeNear(m.terms.price)} {" "}{tr("test NEAR")}</span>
                  <span>{ORDER_STATUS_TEXT[m.status]}</span>
                  {m.status === "open" && <span>{expiresIn(m.terms.deadline_ms)}</span>}
                  {m.status === "open" && (
                    <button className="button secondary" disabled={working} onClick={() => void cancelOrder(m)}>
                      {tr("Cancel order")}</button>
                  )}
                </li>
              ))}
            </ul>
          )}
          {!!openMine.length && (
            <button className="button secondary" disabled={working} onClick={() => void cancelAll()}>
              {tr("Cancel all my orders")}</button>
          )}
        </>
      )}
    </section>
  );
}
