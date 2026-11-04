import { EmptyState } from "./EmptyState";
import { NativePicture } from "./NativeWardrobe";
import { useEffect, useRef, useState } from "react";
import { api } from "./api";
import { AuraArt } from "./Ghost";
import { formatNativeNear, parseNearPrice } from "./native-amounts";
import type { OrderSigner } from "./order-signers";
import { SignedOrdersPanel } from "./SignedOrdersPanel";
import { IntentsPanel } from "./IntentsPanel";
import { Details } from "./ScreenTabs";
import { ArrowClockwise } from "@phosphor-icons/react";
import type {
  Player,
  NativeWardrobeState,
  NativeMarketState,
  NativeMarketBalance,
  NativeTradeRequest,
} from "./types";
import { tr } from "./i18n";
export function NativeMarketPanel({
  player,
  wardrobe,
  busy,
  onConnect,
  onTrade,
  orderSigner = null,
  section = "all",
}: {
  player: Player;
  wardrobe: NativeWardrobeState | null;
  busy: string;
  onConnect: () => Promise<void>;
  onTrade: (request: NativeTradeRequest) => Promise<boolean>;
  orderSigner?: OrderSigner | null;
  /** Market screen tab: fixed-price listings, signed offers, or both. */
  section?: "all" | "secured" | "offers";
}) {
  const showListings = section !== "offers",
    showOffers = section !== "secured";
  const [data, setData] = useState<NativeMarketState | null>(null),
    [balances, setBalances] = useState<NativeMarketBalance[]>([]),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [page, setPage] = useState(0),
    [loading, setLoading] = useState(true),
    [accountId, setAccount] = useState(
      player.nativeAccount || player.wallets[0]?.account_id || "",
    ),
    [tokenId, setToken] = useState(""),
    [price, setPrice] = useState("10"),
    [priceError, setPriceError] = useState("");
  const priceInput = useRef<HTMLInputElement>(null);
  const generation = useRef(0),
    walletKey = player.wallets.map((w) => w.account_id).join(","),
    owned =
      wardrobe?.accounts
        .find((a) => a.accountId === accountId)
        ?.items.filter((i) => i.kind === "aura") || [],
    balance = balances.find((a) => a.accountId === accountId);
  useEffect(() => {
    if (!player.wallets.some((w) => w.account_id === accountId))
      setAccount(player.wallets[0]?.account_id || "");
  }, [walletKey]);
  useEffect(() => {
    if (!owned.some((i) => i.tokenId === tokenId))
      setToken(owned[0]?.tokenId || "");
  }, [wardrobe, accountId]);
  async function load(fresh = false, verifyToken?: string) {
    const request = ++generation.current;
    try {
      const query = new URLSearchParams({ from: String(page) });
      if (fresh) query.set("refresh", "1");
      if (verifyToken) query.set("token", verifyToken);
      const state = await api<NativeMarketState>("/native/market?" + query);
      const accounts =
        state.status === "available" && player.wallets.length
          ? (
              await api<{ accounts: NativeMarketBalance[] }>(
                "/native/market/accounts" + (fresh ? "?refresh=1" : ""),
              )
            ).accounts
          : [];
      if (request === generation.current) {
        setData(state);
        setBalances(accounts);
        setError("");
        setLoading(false);
      }
      return { state, accounts };
    } catch (e) {
      if (request === generation.current) {
        setError(
          e instanceof Error
            ? e.message
            : tr("The secured market could not load. Try again in a moment."),
        );
        setLoading(false);
      }
      throw e;
    }
  }
  useEffect(() => {
    void load().catch(() => {});
    const timer = setInterval(() => void load().catch(() => {}), 20000);
    return () => {
      clearInterval(timer);
      generation.current++;
    };
  }, [page, walletKey]);
  async function perform(request: NativeTradeRequest) {
    setMessage("");
    setError("");
    try {
      const submitted = await onTrade(request);
      if (!submitted) {
        await load(true, request.tokenId);
        return;
      }
      let confirmed = false;
      for (let attempt = 0; attempt < 4; attempt++) {
        const result = await load(true, request.tokenId),
          listing = result.state.verifiedListing;
        confirmed =
          request.kind === "list"
            ? listing?.state === "active" &&
              listing.seller === request.accountId &&
              listing.price === request.price
            : request.kind === "buy"
              ? result.state.token?.ownerId === request.accountId
              : request.kind === "cancel"
                ? !listing && result.state.token?.ownerId === request.accountId
                : result.accounts.some(
                    (a) =>
                      a.accountId === request.accountId &&
                      a.credit === "0" &&
                      a.withdrawing === "0",
                  );
        if (confirmed) break;
        await new Promise((resolve) => setTimeout(resolve, 800));
      }
      setMessage(
        confirmed
          ? request.kind === "list"
            ? tr("Your Aura is on the market. It stays held until sold or cancelled.")
            : request.kind === "buy"
              ? tr("The Aura is yours. Find it in your Secured collection.")
              : request.kind === "cancel"
                ? tr("Your Aura is back in your Secured collection.")
                : tr("Your market balance was withdrawn.")
          : tr("Still confirming. Refresh your collection and balance before retrying."),
      );
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : tr("The market action could not finish. Try again."),
      );
    }
  }
  const unavailable = !!busy || loading || !!error || !accountId || !wardrobe;
  const requestBase = {
    accountId,
    marketId: data?.marketContract || "",
    nftContractId: data?.nftContract || "",
  };
  return (
    <section className="native-market">
      <div className="section-label market-head">
        <h2>
          {tr("Secured Aura market")}</h2>
        <span className="badge purple" title={tr("Secured Auras trade for test NEAR, which has no monetary value.")}>{tr("TEST NETWORK")}</span>
        <button
          className="market-refresh"
          aria-label={tr("Refresh market")}
          title={tr("Refresh market")}
          disabled={!!busy}
          onClick={() => void load(true).catch(() => {})}
        >
          <ArrowClockwise size={20} aria-hidden="true" />
        </button>
      </div>
      {error && <p role="alert">{error}</p>}
      {message && (
        <p role="status" className="native-market-message">
          {message}
        </p>
      )}
      {loading ? (
        <p role="status">{tr("Loading the market…")}</p>
      ) : data?.status !== "available" ? (
        <p>{tr("The secured market is not available here yet.")}</p>
      ) : (
        <>
          {showOffers && data.stats.version !== 2 && section === "offers" && (
            <p>{tr("Signed offers are not available on this market yet.")}</p>
          )}
          {showListings && (
            <>
          {!player.wallets.length ? (
            <button
              className="primary-button"
              disabled={!!busy}
              onClick={() => void onConnect()}
            >
              {tr("Link a NEAR account to trade")}</button>
          ) : (
            <div className="native-market-wallet">
              <label>
                {tr("Trading account")}<select
                  value={accountId}
                  onChange={(e) => setAccount(e.target.value)}
                >
                  {player.wallets.map((w) => (
                    <option value={w.account_id} key={w.account_id}>
                      {w.account_id}
                    </option>
                  ))}
                </select>
              </label>
              <span className="native-address">{accountId}</span>
              <p>
                {tr("Available to withdraw:")}{" "}
                <strong>
                  {balance
                    ? formatNativeNear(balance.credit) + " test NEAR"
                    : tr("not available")}
                </strong>
                {balance?.withdrawing !== "0" &&
                  balance?.withdrawing &&
                  tr(" · withdrawal pending")}
              </p>
              <button
                className="button secondary"
                disabled={
                  unavailable ||
                  !balance ||
                  balance.credit === "0" ||
                  balance.withdrawing !== "0"
                }
                onClick={() =>
                  void perform({ ...requestBase, kind: "withdraw" })
                }
              >
                {tr("Withdraw market balance")}</button>
            </div>
          )}
          {data.stats.paused && (
            <p role="status">
              {tr("Trading is paused. You can still cancel your listings and withdraw your balance.")}</p>
          )}
          {!!player.wallets.length && (
            <form
              className="native-sell-form"
              onSubmit={(e) => {
                e.preventDefault();
                setPriceError("");
                try {
                  const amount = parseNearPrice(price);
                  if (!tokenId) throw Error("Choose an Aura you own.");
                  void perform({
                    ...requestBase,
                    kind: "list",
                    tokenId,
                    price: amount,
                  });
                } catch (e) {
                  setPriceError(
                    e instanceof Error ? e.message : tr("Choose a valid price."),
                  );
                  priceInput.current?.focus();
                }
              }}
            >
              <h3>{tr("List an Aura you own")}</h3>
              {!owned.length ? (
                <p>
                  {tr("You have no secured Aura to list. Secure one you earned, or cancel an existing listing.")}</p>
              ) : (
                <>
                  <label>
                    {tr("Aura")}<select
                      value={tokenId}
                      onChange={(e) => setToken(e.target.value)}
                    >
                      {owned.map((item) => (
                        <option value={item.tokenId} key={item.tokenId}>
                          #{item.serial} · {item.title}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    {tr("Price in test NEAR")}<input
                      ref={priceInput}
                      aria-invalid={!!priceError}
                      aria-describedby={
                        priceError ? "native-price-error" : undefined
                      }
                      value={price}
                      onChange={(e) => {
                        setPrice(e.target.value);
                        setPriceError("");
                      }}
                      inputMode="decimal"
                      placeholder="10"
                      autoComplete="off"
                    />
                  </label>
                  {priceError && (
                    <p id="native-price-error" role="alert">
                      {priceError}
                    </p>
                  )}
                  <Details>
                    <p>
                      {tr("You can list up to three Auras. You approve handing the Aura to the market; storage is covered by the project.")}</p>
                  </Details>
                  <button
                    className="primary-button"
                    disabled={unavailable || data.stats.paused || !tokenId}
                  >
                    {tr("List Aura")}</button>
                </>
              )}
            </form>
          )}
          {!data.listings.length ? (
            <EmptyState art="chest" title={tr("No Auras on the market yet")}>
              {tr("Secure an Aura from a chest and list it for other explorers.")}</EmptyState>
          ) : (
            <div className="native-offers">
              {data.listings.map((offer) => (
                <article className="native-offer" key={offer.id}>
                  {offer.token ? (
                    <NativePicture item={offer.token} />
                  ) : (
                    <AuraArt small />
                  )}
                  <div>
                    <h3>{offer.token?.title || tr("Native Aura")}</h3>
                    <span className="native-address">{offer.token_id}</span>
                    {offer.state === "deposited" ? (
                      <strong className="native-price">
                        {tr("Signed offers only")}</strong>
                    ) : (
                      <strong className="native-price">
                        {formatNativeNear(offer.price)} {" "}{tr("test NEAR")}</strong>
                    )}
                    <span className="native-address">
                      {tr("Seller:")}{" "}{offer.seller}
                    </span>
                    <span>
                      {offer.state === "buying" || offer.state === "filling"
                        ? tr("Sale confirming")
                        : offer.state === "deposited"
                          ? tr("Held by the market for signed offers")
                        : offer.state === "returning"
                          ? tr("Returning to owner")
                          : offer.available
                            ? tr("Held by the market")
                            : tr("Ownership not confirmed")}
                    </span>
                  </div>
                  {offer.seller === accountId ? (
                    <button
                      className="button secondary"
                      disabled={
                        unavailable ||
                        (offer.state !== "active" && offer.state !== "deposited")
                      }
                      onClick={() =>
                        void perform({
                          ...requestBase,
                          kind: "cancel",
                          tokenId: offer.token_id,
                          listingId: offer.id,
                        })
                      }
                    >
                      {offer.state === "deposited"
                        ? tr("Return to collection")
                        : tr("Cancel listing")}
                    </button>
                  ) : offer.state === "deposited" ? null : (
                    <button
                      className="primary-button"
                      disabled={
                        unavailable || data.stats.paused || !offer.available
                      }
                      onClick={() =>
                        void perform({
                          ...requestBase,
                          kind: "buy",
                          tokenId: offer.token_id,
                          listingId: offer.id,
                          price: offer.price,
                        })
                      }
                    >
                      {tr("Buy Aura")}</button>
                  )}
                </article>
              ))}
            </div>
          )}
            </>
          )}
          {showOffers && (
          <SignedOrdersPanel
            data={data}
            signer={orderSigner}
            owned={
              wardrobe?.accounts
                .find((a) => a.accountId === orderSigner?.accountId)
                ?.items.filter((i) => i.kind === "aura") || []
            }
            balance={balances.find(
              (a) => a.accountId === orderSigner?.accountId,
            )}
            busy={busy}
            onChanged={async () => (await load(true)).state}
          />
          )}
          {showOffers && (
          <IntentsPanel
            signer={orderSigner}
            owned={
              wardrobe?.accounts
                .find((a) => a.accountId === orderSigner?.accountId)
                ?.items.filter((i) => i.kind === "aura") || []
            }
          />
          )}
          {showListings && (
          <div className="native-market-pages">
            <button
              className="button secondary"
              disabled={!!busy || page === 0}
              onClick={() => setPage(Math.max(0, page - 24))}
            >
              {tr("Previous offers")}</button>
            <button
              className="button secondary"
              disabled={!!busy || !data.truncated}
              onClick={() => setPage(page + 24)}
            >
              {tr("Next offers")}</button>
          </div>
          )}
        </>
      )}
    </section>
  );
}
