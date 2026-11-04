// Treasury mix card on /economy (docs/TREASURY-MIX.md): what the sponsor
// treasury holds now against the 50 % liquid staking / 40 % stablecoins /
// 10 % NEAR target, the per-protocol exposure and the last rebalancing runs.
// Reads GET /api/treasury/mix on its own, so the rest of the page never waits.
import React, { useEffect, useState } from "react";
import { shortNear } from "./format";

type Bucket = { bucket: "lst" | "stable" | "near"; current: string; target: string; currentBps: number; targetBps: number; policyBps: number };
type Holding = {
  id: string;
  label: string;
  bucket: string;
  protocol: string;
  decimals: number;
  wallet: string;
  vault: string;
  value: string;
  market: { utilizationBps: number; offered: boolean; supplyAprPercent: number | null } | null;
};
type Step = { op: string; asset: string; value: string; route?: string; transaction?: string; error?: string };
type Mix = {
  network: string;
  account: string;
  vault: string | null;
  policy: { maxProtocolBps: number; maxUtilBps: number; maxMoveBps: number };
  total: string;
  buckets: Bucket[];
  exposure: { protocol: string; bps: number; overCap: boolean }[];
  holdings: Holding[];
  prices: { nearUsdE8: string; stale: { id: string }[] };
  next: { action: string; reason: string | null; steps: Step[]; notes: string[] };
  runs: { at: string; steps: Step[] }[];
};

const NAMES = { lst: "Liquid staking", stable: "Stablecoins (Rhea Lend)", near: "NEAR reserve" } as const;
const pct = (bps: number) => `${(bps / 100).toFixed(bps % 100 ? 1 : 0)} %`;
const units = (raw: string, decimals: number) => {
  const n = Number(raw) / 10 ** decimals;
  return n.toLocaleString("en-GB", { maximumFractionDigits: decimals > 6 ? 4 : 2 });
};
const OPS: Record<string, string> = {
  "sell-lst": "sell",
  "sell-stable": "sell",
  "buy-stable": "buy",
  "stake-lst": "stake into",
  "deposit-vault": "lend via the vault",
  "withdraw-vault": "withdraw from the vault",
  wrap: "add to the reserve as",
  unwrap: "take from the reserve",
};
const stepLabel = (s: Step, label: string) => `${OPS[s.op] ?? s.op} ${label} ${shortNear(s.value)} NEAR`;
const explorer = (network: string, hash: string) =>
  `https://${network === "mainnet" ? "" : "testnet."}nearblocks.io/txns/${hash}`;

export default function TreasuryMix() {
  const [mix, setMix] = useState<Mix | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    fetch("/api/treasury/mix")
      .then((r) => (r.ok ? r.json() : r.json().then((b) => Promise.reject(new Error(b?.error || `HTTP ${r.status}`)))))
      .then(setMix)
      .catch((e) => setError(String(e?.message || e)));
  }, []);

  const labelOf = (id: string) => mix?.holdings.find((h) => h.id === id)?.label ?? id;
  return (
    <section className="eco-card" aria-labelledby="eco-mix">
      <h2 id="eco-mix">Treasury mix</h2>
      <p className="eco-muted eco-small">
        Target: 50 % liquid staking, 40 % stablecoins lent on Rhea Lend, 10 % NEAR. At most {pct(mix?.policy.maxProtocolBps ?? 4000)} with any one
        protocol, and nothing new goes to a lending market that is {pct(mix?.policy.maxUtilBps ?? 9500)} or more lent out. What a cap blocks waits in
        NEAR. Each run moves at most {pct(mix?.policy.maxMoveBps ?? 2500)} of the treasury.
      </p>
      {error ? <p className="eco-muted">The treasury mix is not available on this host right now: {error}</p> : null}
      {!mix && !error ? <p className="eco-muted">Reading the chain…</p> : null}
      {mix ? (
        <>
          <div className="eco-mix-bars">
            {mix.buckets.map((b) => (
              <div key={b.bucket} className="eco-mix-row">
                <span className="eco-mix-name">{NAMES[b.bucket]}</span>
                <span className="eco-mix-track" aria-hidden="true">
                  <span className={`eco-mix-fill eco-mix-${b.bucket}`} style={{ width: `${Math.min(100, b.currentBps / 100)}%` }} />
                  <span className="eco-mix-goal" style={{ left: `${Math.min(100, b.policyBps / 100)}%` }} />
                </span>
                <span className="eco-mix-num">
                  {pct(b.currentBps)} <small>/ {pct(b.policyBps)}</small> · {shortNear(b.current)} <small>NEAR</small>
                </span>
              </div>
            ))}
          </div>
          <dl className="eco-dl">
            <dt>Total, valued in NEAR</dt>
            <dd>{shortNear(mix.total)} NEAR at {(Number(mix.prices.nearUsdE8) / 1e8).toFixed(2)} USD per NEAR (Pyth){mix.prices.stale.length ? " · testnet price feed is stale" : ""}</dd>
            <dt>Exposure per protocol</dt>
            <dd>
              {mix.exposure.map((e, i) => (
                <span key={e.protocol} className={e.overCap ? "eco-bad" : undefined}>
                  {i ? " · " : ""}
                  {e.protocol} {pct(e.bps)}
                  {e.overCap ? " (over the cap, being reduced)" : ""}
                </span>
              ))}
            </dd>
          </dl>
          <ul className="eco-list">
            {mix.holdings
              .filter((h) => h.value !== "0")
              .map((h) => (
                <li key={h.id}>
                  {h.label}: {h.wallet !== "0" ? `${units(h.wallet, h.decimals)} in the wallet` : null}
                  {h.wallet !== "0" && h.vault !== "0" ? " · " : null}
                  {h.vault !== "0" ? (h.bucket === "lst" ? `${shortNear(h.vault)} NEAR in the yield vault` : `${units(h.vault, h.decimals)} in the yield vault`) : null}
                  {" "}≈ {shortNear(h.value)} NEAR
                  {h.market ? ` · Rhea ${h.market.utilizationBps / 100} % lent out${h.market.supplyAprPercent != null ? `, ${h.market.supplyAprPercent} % APR` : ""}` : ""}
                </li>
              ))}
          </ul>
          <p className="eco-small">
            Next run:{" "}
            {mix.next.action === "rebalance"
              ? mix.next.steps.map((s) => stepLabel(s, labelOf(s.asset))).join(", ")
              : mix.next.reason === "within-drift"
                ? "nothing to do, the mix is within 3 points of its target."
                : mix.next.reason ?? mix.next.action}
          </p>
          {mix.next.notes.length ? (
            <ul className="eco-list eco-small eco-muted">
              {mix.next.notes.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          ) : null}
          {mix.runs.length ? (
            <ul className="eco-list eco-small">
              {mix.runs
                .slice()
                .reverse()
                .flatMap((r) =>
                  r.steps.map((s, i) => (
                    <li key={`${r.at}-${i}`}>
                      {r.at.slice(0, 16).replace("T", " ")} UTC · {stepLabel(s, labelOf(s.asset))}
                      {s.route === "testnet-mint" ? " (testnet stand-in swap)" : ""}
                      {s.transaction ? (
                        <>
                          {" "}
                          · <a href={explorer(mix.network, s.transaction)} target="_blank" rel="noreferrer">tx ↗</a>
                        </>
                      ) : null}
                      {s.error ? <span className="eco-bad"> · failed</span> : null}
                    </li>
                  )),
                )}
            </ul>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
