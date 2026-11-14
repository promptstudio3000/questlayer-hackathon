// QGOLD ⇄ NEAR exchange card (docs/QGOLD-MARKET.md, docs/TREASURY-PAGE.md).
// Buys at the vault for R + fee and sells back at R − fee. Selling signs with
// this browser's game account (the QGOLD lives there). Buying is paid by the
// game account when it holds enough NEAR, otherwise by the player's NEAR
// wallet (Meteor, HOT, ...), and the QGOLD always lands in the game account.
// Shown next to the treasury numbers on /treasury and in /economy.
import { useEffect, useState } from "react";
import { ArrowDown, ArrowSquareOut, Lightning, Hourglass } from "@phosphor-icons/react";
import { shortHash, shortNear } from "./format";
import { buyQuote, parseQgoldUnits, parseUnits, QGOLD_ONE, sellQuote, type ExitPath } from "./qgold-quote";
import { qgoldCount, QGOLD_B_TOKENS } from "./treasury-model";
import "./exchange.css";

export type ExchangeData = {
  network?: string;
  rules: { buyFeeBps: number; sellFeeBps: number };
  vault: null | {
    contract: string;
    explorerUrl: string;
    rate: string;
    paused: boolean;
    exit: { instantCap24h: string; instantUsed24h: string; accountCap24h?: string | null; safeWindowMs?: number | null };
  };
  exitPaths?: { id: ExitPath; label: string; available: boolean }[];
  pool?: { swapUrl?: string | null };
};

// QGOLD in the game's one unit (1 NEAR ≈ 1B QGOLD): the token's smallest unit.
const short = (id: string) => (id.length > 26 ? `${id.slice(0, 12)}…${id.slice(-10)}` : id);
const qgoldText = (units: bigint | null) => (units == null ? "—" : qgoldCount(units.toString()));
// The vault refuses exits under 0.001 NEAR before the fee.
const MIN_REDEEM_YOCTO = 10n ** 21n;
const BUY_GAS_YOCTO = 2n * 10n ** 22n; // 100 Tgas at twice the floor gas price
const pctText = (bps: number) => `${(bps / 100).toLocaleString("en-US", { maximumFractionDigits: 2 })} %`;

export default function QgoldExchange({ data, compact = false }: { data: ExchangeData; compact?: boolean }) {
  const v = data.vault;
  const [mode, setMode] = useState<"buy" | "sell">("buy");
  const [amount, setAmount] = useState("1");
  const [path, setPath] = useState<ExitPath>("near_instant");
  const [account, setAccount] = useState<string | null | undefined>(undefined);
  const [balance, setBalance] = useState<bigint | null>(null);
  const [gameNear, setGameNear] = useState<bigint | null>(null);
  const [wallet, setWallet] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string; hash?: string } | null>(null);

  useEffect(() => {
    let live = true;
    // A browser without a game key answers quickly; never leave the card waiting.
    const giveUp = setTimeout(() => live && setAccount((a) => (a === undefined ? null : a)), 4000);
    void import("./qgold-trade")
      .then(async (m) => {
        const id = await m.playerAccount();
        if (!live) return;
        setAccount(id);
        if (!id) return;
        void m.spendableNear(id).then((n) => live && setGameNear(n));
        void m.connectedWallet().then((w) => live && setWallet(w));
        const r = await fetch(`/api/qgold/account?account=${encodeURIComponent(id)}`);
        const b = r.ok ? ((await r.json()) as { balance?: string | null }) : null;
        if (live && b?.balance && /^\d+$/.test(b.balance)) setBalance(BigInt(b.balance));
      })
      .catch(() => live && setAccount(null));
    return () => {
      live = false;
      clearTimeout(giveUp);
    };
  }, [result]);

  if (!v) return null;
  const rate = BigInt(v.rate);
  const buying = mode === "buy";
  const parsed = buying ? parseUnits(amount, 24) : parseQgoldUnits(amount);
  const out = parsed == null ? null : buying ? buyQuote(parsed, rate, data.rules.buyFeeBps) : sellQuote(parsed, rate, data.rules.sellFeeBps);
  const tooMuch = !buying && parsed != null && balance != null && parsed > balance;
  // Smallest sale the vault accepts (0.001 NEAR before the fee), in QGOLD units.
  const minSell = (MIN_REDEEM_YOCTO * QGOLD_ONE + rate - 1n) / rate;
  const tooLittle = !buying && parsed != null && parsed > 0n && parsed < minSell;
  // Who pays a purchase: the game account if it holds the NEAR, else a NEAR wallet.
  const viaWallet = buying && !(parsed != null && gameNear != null && gameNear >= parsed + BUY_GAS_YOCTO);
  const paths = (data.exitPaths ?? []).filter((p) => p.available && p.id !== "lst");
  const left = BigInt(v.exit.instantCap24h || "0") - BigInt(v.exit.instantUsed24h || "0");
  const explorer = data.network === "mainnet" ? "https://nearblocks.io" : "https://testnet.nearblocks.io";

  function pick(next: "buy" | "sell") {
    setMode(next);
    setResult(null);
    setAmount(next === "buy" ? "1" : balance ? balance.toString() : "100M");
  }
  async function go() {
    if (parsed == null || out == null || out <= 0n || tooMuch || tooLittle || !account) return;
    setBusy(true);
    setResult(null);
    try {
      const m = await import("./qgold-trade");
      const r = !buying
        ? await m.sellQgold(v!.contract, parsed, path, out)
        : viaWallet
          ? await m.buyQgoldWithWallet(v!.contract, parsed, out, account)
          : await m.buyQgold(v!.contract, parsed, out);
      if ("payer" in r && typeof r.payer === "string") setWallet(r.payer);
      setResult({ ok: true, text: buying ? "Bought. The QGOLD is in your game account." : path === "near_queue" ? "Queued. Claim the NEAR after the safe window." : "Sold. The NEAR is in your game account.", hash: r.transactionHash || undefined });
    } catch (e) {
      setResult({ ok: false, text: String((e as Error)?.message || e) });
    } finally {
      setBusy(false);
    }
  }

  const payToken = buying ? "NEAR" : "QGOLD";
  const getToken = buying ? "QGOLD" : "NEAR";
  return (
    <section className={compact ? "qx qx-compact" : "qx"} aria-labelledby="qx-title">
      <header className="qx-head">
        <h2 id="qx-title">Swap QGOLD and NEAR</h2>
        <span className="qx-rate">1B QGOLD = {shortNear((rate * BigInt(QGOLD_B_TOKENS)).toString(), 4)} NEAR</span>
      </header>
      <div className="qx-seg" role="radiogroup" aria-label="Buy or sell QGOLD">
        {(["buy", "sell"] as const).map((m) => (
          <button key={m} type="button" role="radio" aria-checked={mode === m} className={mode === m ? "on" : ""} onClick={() => pick(m)}>
            {m === "buy" ? "Buy QGOLD" : "Sell QGOLD"}
          </button>
        ))}
      </div>
      <label className="qx-box">
        <span className="qx-box-top">
          <span>You pay</span>
          {!buying && balance != null ? (
            <button type="button" className="qx-max" onClick={() => setAmount(balance.toString())}>
              Balance {qgoldText(balance)} · Max
            </button>
          ) : null}
        </span>
        <span className="qx-box-row">
          <input inputMode={buying ? "decimal" : "text"} value={amount} onChange={(e) => setAmount(e.target.value)} aria-label={`Amount of ${payToken} to pay`} />
          <b className={`qx-token qx-${payToken.toLowerCase()}`}>{payToken}</b>
        </span>
      </label>
      <span className="qx-arrow" aria-hidden="true">
        <ArrowDown size={18} weight="bold" />
      </span>
      <div className="qx-box qx-out" aria-live="polite">
        <span className="qx-box-top">
          <span>You get about</span>
        </span>
        <span className="qx-box-row">
          <output className="qx-out-value">{out == null ? "—" : buying ? qgoldText(out) : shortNear(out.toString(), 6)}</output>
          <b className={`qx-token qx-${getToken.toLowerCase()}`}>{getToken}</b>
        </span>
      </div>
      {!buying && paths.length > 1 ? (
        <div className="qx-paths" role="radiogroup" aria-label="How the NEAR is paid">
          {paths.map((p) => (
            <button key={p.id} type="button" role="radio" aria-checked={path === p.id} className={path === p.id ? "on" : ""} onClick={() => setPath(p.id)}>
              {p.id === "near_queue" ? <Hourglass size={18} aria-hidden="true" /> : <Lightning size={18} aria-hidden="true" />}
              {p.id === "near_queue" ? `Queued, ${v.exit.safeWindowMs ? Math.round(v.exit.safeWindowMs / 3_600_000) + " h" : "later"}` : "Instant"}
            </button>
          ))}
        </div>
      ) : null}
      <p className="qx-fine">
        {buying ? `Backing per QGOLD plus a ${pctText(data.rules.buyFeeBps)} fee.` : `Backing per QGOLD minus a ${pctText(data.rules.sellFeeBps)} fee.`} The fee goes to the treasury.
        {!buying && path === "near_instant" ? ` Instant exits left today: ${shortNear(left > 0n ? left.toString() : "0", 2)} NEAR for everyone.` : ""}
      </p>
      {tooMuch ? <p className="qx-msg bad">You hold {qgoldText(balance)} QGOLD.</p> : null}
      {tooLittle ? <p className="qx-msg bad">The vault buys back at least {qgoldText(minSell)} QGOLD at a time.</p> : null}
      {account === undefined ? null : account ? (
        <button type="button" className="qx-go" disabled={busy || out == null || out <= 0n || v.paused || tooMuch || tooLittle} onClick={go}>
          {busy ? "Signing…" : v.paused ? "Paused by the guardian" : !buying ? "Sell for NEAR" : viaWallet ? "Buy with your NEAR wallet" : "Buy QGOLD"}
        </button>
      ) : (
        <a className="qx-go" href="/">
          Play once to get your account
        </a>
      )}
      {account ? (
        <p className="qx-who">
          {viaWallet
            ? `${wallet ? `Your wallet ${short(wallet)} pays` : "Your NEAR wallet (Meteor, HOT, …) pays"}. The QGOLD goes to your game account ${short(account)}.`
            : `Signed with your game account ${short(account)}. It pays its own gas.`}
        </p>
      ) : null}
      {result ? (
        <p className={result.ok ? "qx-msg ok" : "qx-msg bad"} role="status">
          {result.text}{" "}
          {result.hash ? (
            <a href={`${explorer}/txns/${result.hash}`} target="_blank" rel="noreferrer">
              {shortHash(result.hash)} <ArrowSquareOut size={14} aria-hidden="true" />
            </a>
          ) : null}
        </p>
      ) : null}
      <p className="qx-links">
        <a href={v.explorerUrl} target="_blank" rel="noreferrer">
          Vault contract <ArrowSquareOut size={14} aria-hidden="true" />
        </a>
        {data.pool?.swapUrl ? (
          <a href={data.pool.swapUrl} target="_blank" rel="noreferrer">
            Or swap on Rhea <ArrowSquareOut size={14} aria-hidden="true" />
          </a>
        ) : null}
      </p>
    </section>
  );
}
