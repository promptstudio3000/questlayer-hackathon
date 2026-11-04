// Experimental Aura <-> wNEAR trades through NEAR Intents, on the game's own
// test copy of the Intents verifier (not intents.near). The device key signs
// token_diff intents silently; the server's solver submits matching pairs to
// execute_intents and the verifier settles both legs atomically. Key
// registration and deposits of things the player already holds are relayed;
// wrapping NEAR is paid from the player's own account.
import { useEffect, useState } from "react";
import { api } from "./api";
import { Details } from "./ScreenTabs";
import { formatNativeNear, parseNearPrice } from "./native-amounts";
import { auraTokenDiff, signIntents, type IntentsAccount, type IntentsConfig } from "./intents-order";
import type { OrderSigner } from "./order-signers";
import type { NativeItem } from "./types";
import { EXPLORER_BASE } from "./near-network";
import { tr } from "./i18n";

const GAS = "100000000000000",
  NFT_GAS = "200000000000000",
  WNEAR_STORAGE = "1250000000000000000000"; // 0.00125 NEAR, refunded if registered

export function IntentsPanel({ signer, owned, onEnabled }: { signer: OrderSigner | null; owned: NativeItem[]; onEnabled?: (on: boolean) => void }) {
  const [config, setConfig] = useState<IntentsConfig | null>(null),
    [mine, setMine] = useState<IntentsAccount | null>(null),
    [sellToken, setSellToken] = useState(""),
    [price, setPrice] = useState("0.01"),
    [step, setStep] = useState(""),
    [error, setError] = useState(""),
    [done, setDone] = useState<{ text: string; tx?: string } | null>(null);
  const accountId = signer?.accountId ?? null;
  const canSign = !!signer?.key;

  async function refresh() {
    const c = await api<IntentsConfig>("/native/intents");
    setConfig(c);
    onEnabled?.(!!c.enabled);
    if (c.enabled && accountId && signer)
      setMine(
        await api<IntentsAccount>(
          `/native/intents/account?account=${encodeURIComponent(accountId)}&publicKey=${encodeURIComponent(signer.knownPublicKey() || "")}`,
        ),
      );
  }
  useEffect(() => {
    void refresh().catch(() => {});
  }, [accountId]);
  const sellable = [...(mine?.auras || []), ...owned.map((i) => i.tokenId)].filter((t, i, all) => all.indexOf(t) === i);
  useEffect(() => {
    if (!sellable.includes(sellToken)) setSellToken(sellable[0] || "");
  }, [sellable.join(",")]);
  if (!config?.enabled) return null;
  const c = config;

  async function run(work: () => Promise<{ text: string; tx?: string }>) {
    setError("");
    setDone(null);
    setStep(tr("Working…"));
    try {
      setDone(await work());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setStep("");
      void refresh().catch(() => {});
    }
  }
  const call = (receiverId: string, methodName: string, args: Record<string, unknown>, deposit: string, gas = GAS) =>
    signer!.call({ receiverId, methodName, args, deposit, gas });
  const sign = (intents: unknown[]) => signIntents(signer!.key!, c, intents);

  const enable = () =>
    run(async () => {
      await call(c.verifier, "add_public_key", { public_key: signer!.knownPublicKey() }, "1");
      return { text: tr("Done. Settled on chain.") };
    });
  const list = (tokenId: string, yocto: string) =>
    run(async () => {
      if (!mine?.auras.includes(tokenId))
        await call(c.nftContract, "nft_transfer_call", { receiver_id: c.verifier, token_id: tokenId, approval_id: null, memo: null, msg: "" }, "1", NFT_GAS);
      await api("/native/intents/orders", { signed: await sign([auraTokenDiff("sell", c.nftContract, tokenId, yocto, c.wnear)]) });
      return { text: tr("Your Aura is listed. Anyone can buy it with one signed intent.") };
    });
  const buy = (orderId: string, tokenId: string, yocto: string) =>
    run(async () => {
      let missing = BigInt(yocto) - BigInt(mine?.wnear || "0");
      // A 0.05 NEAR deposit would look like a storage deposit and be routed
      // to the relayer, which refuses wrapping; wrap 1 yocto more instead.
      if (missing === 50000000000000000000000n) missing += 1n;
      if (missing > 0n) {
        await call(c.wnear, "storage_deposit", { account_id: accountId, registration_only: true }, WNEAR_STORAGE);
        await call(c.wnear, "near_deposit", {}, missing.toString());
        await call(c.wnear, "ft_transfer_call", { receiver_id: c.verifier, amount: missing.toString(), msg: "" }, "1");
      }
      const r = await api<{ transactionHash: string }>("/native/intents/fill", {
        orderId,
        signed: await sign([auraTokenDiff("buy", c.nftContract, tokenId, yocto, c.wnear)]),
      });
      return { text: tr("Done. Settled on chain."), tx: r.transactionHash };
    });
  const withdraw = () =>
    run(async () => {
      const intents: unknown[] = (mine?.auras || []).slice(0, 3).map((token_id) => ({ intent: "nft_withdraw", token: c.nftContract, token_id, receiver_id: accountId }));
      if (BigInt(mine?.wnear || "0") > 0n) intents.push({ intent: "native_withdraw", receiver_id: accountId, amount: mine!.wnear });
      const r = await api<{ transactionHash: string }>("/native/intents/withdraw", { signed: await sign(intents) });
      return { text: tr("Done. Settled on chain."), tx: r.transactionHash };
    });

  const others = c.orders.filter((o) => o.maker !== accountId && o.side === "sell");
  const held = (mine?.auras.length || 0) > 0 || BigInt(mine?.wnear || "0") > 0n;
  return (
    <section className="signed-orders intents-panel" aria-labelledby="intents-title">
      <h3 id="intents-title">{tr("NEAR Intents (test)")}</h3>
      <Details>
        <p>{tr("Experimental: trades settle on our own test copy of the NEAR Intents verifier, not on intents.near.")}</p>
      </Details>
      {error && <p role="alert">{error}</p>}
      {step && <p role="status">{step}</p>}
      {done && !step && (
        <p role="status" className="native-market-message">
          {done.text}{" "}
          {done.tx && (
            <a href={`${EXPLORER_BASE}/txns/${done.tx}`} target="_blank" rel="noreferrer">
              {done.tx.slice(0, 8)}…
            </a>
          )}
        </p>
      )}
      {!canSign ? (
        <p>{tr("Trades through Intents need the explorer's device key.")}</p>
      ) : !mine ? null : !mine.keyRegistered ? (
        <button className="primary-button" disabled={!!step} onClick={() => void enable()}>
          {tr("Turn on Intents trading")}
        </button>
      ) : (
        <>
          {held && (
            <p>
              {tr("Held in the verifier: {0} Auras, {1} wNEAR", { 0: mine.auras.length, 1: formatNativeNear(mine.wnear) })}{" "}
              <button className="button secondary" disabled={!!step} onClick={() => void withdraw()}>
                {tr("Withdraw to my account")}
              </button>
            </p>
          )}
          {sellable.length > 0 && (
            <form
              className="native-sell-form"
              onSubmit={(e) => {
                e.preventDefault();
                try {
                  void list(sellToken, parseNearPrice(price));
                } catch (err) {
                  setError(err instanceof Error ? err.message : String(err));
                }
              }}
            >
              <h4>{tr("Sell through Intents")}</h4>
              <select value={sellToken} onChange={(e) => setSellToken(e.target.value)} aria-label={tr("Sell through Intents")}>
                {sellable.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
              <input value={price} inputMode="decimal" onChange={(e) => setPrice(e.target.value)} aria-label={tr("Price in wNEAR")} />
              <button className="primary-button" disabled={!!step || !sellToken}>{tr("List for sale")}</button>
            </form>
          )}
          {!others.length ? (
            <p>{tr("No Intents offers yet.")}</p>
          ) : (
            <ul className="signed-order-history">
              {others.map((o) => (
                <li key={o.id}>
                  <span>{o.tokenId}</span>{" "}
                  <button className="primary-button" disabled={!!step} onClick={() => void buy(o.id, o.tokenId, o.price)}>
                    {tr("Buy for {0} wNEAR", { 0: formatNativeNear(o.price) })}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
