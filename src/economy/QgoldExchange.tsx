// QGOLD ⇄ NEAR exchange card (docs/QGOLD-MARKET.md, docs/TREASURY-PAGE.md).
// Buys at the vault for R + fee and sells back at R − fee, signed with this
// browser's game account (the same key the game uses). Shown next to the
// treasury numbers on /treasury and in the QGOLD section of /economy.
import { useEffect, useState } from "react";
import { ArrowDown, ArrowSquareOut, Lightning, Hourglass } from "@phosphor-icons/react";
import { shortHash, shortNear } from "./format";
import { buyQuote, parseUnits, sellQuote, type ExitPath } from "./qgold-quote";
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

const QG = 10n ** 6n;
function qgoldText(units: bigint | null, digits = 4) {
  if (units == null) return "—";
  const whole = units / QG,
    frac = (units % QG).toString().padStart(6, "0").slice(0, digits).replace(/0+$/, "");
  return `${whole.toLocaleString("en-US")}${frac ? "." + frac : ""}`;
}
const pctText = (bps: number) => `${(bps / 100).toLocaleString("en-US", { maximumFractionDigits: 2 })} %`;

export default function QgoldExchange({ data, compact = false }: { data: ExchangeData; compact?: boolean }) {
  const v = data.vault;
  const [mode, setMode] = useState<"buy" | "sell">("buy");
  const [amount, setAmount] = useState("1");
  const [path, setPath] = useState<ExitPath>("near_instant");
  const [account, setAccount] = useState<string | null | undefined>(undefined);
  const [balance, setBalance] = useState<bigint | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string; hash?: string } | null>(null);

  useEffect(() => {
    let live = true;
    // A browser without a game key answers quickly; never leave the card waiting.
    const giveUp = setTimeout(() => live && setAccount((a) => (a === undefined ? null : a)), 4000);
    void import("./qgold-trade")
      .then((m) => m.playerAccount())
      .then(async (id) => {
        if (!live) return;
        setAccount(id);
        if (!id) return;
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
  const parsed = parseUnits(amount, buying ? 24 : 6);
  const out = parsed == null ? null : buying ? buyQuote(parsed, rate, data.rules.buyFeeBps) : sellQuote(parsed, rate, data.rules.sellFeeBps);
  const tooMuch = !buying && parsed != null && balance != null && parsed > balance;
  const paths = (data.exitPaths ?? []).filter((p) => p.available && p.id !== "lst");
  const left = BigInt(v.exit.instantCap24h || "0") - BigInt(v.exit.instantUsed24h || "0");
  const explorer = data.network === "mainnet" ? "https://nearblocks.io" : "https://testnet.nearblocks.io";

  function pick(next: "buy" | "sell") {
    setMode(next);
    setResult(null);
    setAmount(next === "buy" ? "1" : balance ? qgoldText(balance, 6).replace(/,/g, "") : "100");
  }
  async function go() {
    if (parsed == null || out == null || out <= 0n || tooMuch) return;
    setBusy(true);
    setResult(null);
    try {
      const m = await import("./qgold-trade");
      const r = buying ? await m.buyQgold(v!.contract, parsed, out) : await m.sellQgold(v!.contract, parsed, path, out);
      setResult({ ok: true, text: buying ? "Bought. The QGOLD is in your account." : path === "near_queue" ? "Queued. Claim the NEAR after the safe window." : "Sold. The NEAR is in your account.", hash: r.transactionHash });
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
        <span className="qx-rate">1 QGOLD = {shortNear(v.rate, 6)} NEAR</span>
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
            <button type="button" className="qx-max" onClick={() => setAmount(qgoldText(balance, 6).replace(/,/g, ""))}>
              Balance {qgoldText(balance, 2)} · Max
            </button>
          ) : null}
        </span>
        <span className="qx-box-row">
          <input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} aria-label={`Amount of ${payToken} to pay`} />
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
      {account === undefined ? null : account ? (
        <button type="button" className="qx-go" disabled={busy || out == null || out <= 0n || v.paused || tooMuch} onClick={go}>
          {busy ? "Signing…" : v.paused ? "Paused by the guardian" : `${buying ? "Buy" : "Sell"} ${buying ? "QGOLD" : "for NEAR"}`}
        </button>
      ) : (
        <a className="qx-go" href="/">
          Play once to get your account
        </a>
      )}
      {account ? <p className="qx-who">Signed with your game account {account.length > 26 ? `${account.slice(0, 12)}…${account.slice(-10)}` : account}. It pays its own gas.</p> : null}
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
