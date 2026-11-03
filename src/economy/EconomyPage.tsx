// Public, read-only economy ledger at /economy (docs/ECONOMY-PAGE.md). It reads
// GET /api/economy/ledger once and shows the one global prize pool: treasury,
// realized yield, stNEAR, daily budget, payouts, the distribution audit and an
// explorer link for every transaction. No sign-in, no actions.
import React, { useEffect, useState } from "react";
import { exactNear, priceLabel, shortAccount, shortHash, shortNear } from "./format";
import "./economy.css";

type Link = { explorerUrl: string | null };
type Ledger = {
  network: string;
  explorer: string;
  generatedAt: string;
  rewardsContract: { id: string; explorerUrl: string } | null;
  treasury: {
    status: string;
    observedAt?: string;
    funded?: string;
    liabilities?: string;
    awarded?: string;
    withdrawn?: string;
    liquid?: string | null;
    yieldBackedDays?: boolean;
  };
  audit: {
    status: string;
    observedAt?: string;
    failed?: string[];
    reason?: string | null;
    checks?: { name: string; ok: boolean }[];
    scope?: string | null;
  };
  realizedYield: {
    status: string;
    reason?: string | null;
    paid?: string;
    committed?: string;
    free?: string;
    vaults?: ({ accountId: string; gamePaid: string } & Link)[];
  };
  stnear: {
    status: string;
    reason?: string | null;
    account?: string;
    accountUrl?: string;
    contract?: string;
    balance?: string;
    parked?: string;
    price?: string;
    depositPrice?: string | null;
    value?: string;
    principal?: string;
    growth?: string;
    harvested?: string;
    yieldStatus?: string | null;
    deposits?: ({ at: string; near: string; stnear: string } & Link)[];
    harvests?: { at: string; received: string | null; receiptId: string | null; sellUrl: string | null; fundUrl: string | null }[];
  };
  budget: { date: string; cities: number; coinBudget: string; zoneBudget: string; total: string; fromYield: string }[];
  days: ({ id: string; date: string; state: string; funding: string; coins: number; zones: number; total: string; transactionHash: string | null } & Link)[];
  payouts: {
    count: number;
    total: string;
    byKind: Record<string, { count: number; total: string }>;
    recent: ({ dayId: string; kind: string; account: string; amount: string | null; at: string | null; transactionHash: string | null } & Link)[];
  };
  yieldCycle: null | {
    summary: string;
    rewardsContract: string;
    pool: string;
    generation: string;
    realizedYieldYocto: string;
    fundedBefore: string | null;
    fundedAfter: string | null;
    reconciliation: string;
    auditStatus: string | null;
    timeline: { step: string; epoch: number | null; at: string | null; detail: string | null }[];
    flushes: ({ vault: string; gamePaidYocto: string; at: string; transactionHash: string } & Link)[];
  };
};

export const CHECK_LABELS: Record<string, string> = {
  "ledger-conservation": "Every funded yoctoNEAR is accounted for",
  "coin-reservations-explained": "Coin reservations equal unclaimed coins of open days",
  "zone-reservations-explained": "Zone reservations equal unwon zone prizes",
  "open-days-match-manifests": "Every open day matches its published manifest",
  "receipts-within-chain-claims": "Our receipts never exceed claims the chain accepted",
  "date-totals-match-publications": "Daily totals match what was published and stay under the cap",
  "yield-backed-days-covered": "Days paid from yield cost no more than the yield received",
  "account-covers-liabilities": "The contract account holds enough to pay everything it owes",
};

export const YIELD_STATUS_COPY: Record<string, string> = {
  growing: "stNEAR is worth more NEAR than at deposit; the growth is harvested into the prize pool.",
  "price-flat":
    "stNEAR has not gained against NEAR since the deposit (the testnet price has stayed flat), so there is no growth to harvest yet. Realized yield comes from the staking vaults.",
  waiting: "The deposit is less than a day old; growth is checked daily.",
  "no-deposit": "No stNEAR deposit is recorded yet.",
};

function Amount({ yocto, digits }: { yocto?: string | null; digits?: number }) {
  return (
    <span className="eco-amount" title={`${exactNear(yocto)} NEAR (${yocto ?? "—"} yocto)`}>
      {shortNear(yocto, digits)} <small>NEAR</small>
    </span>
  );
}

function Yocto({ value }: { value?: string | null }) {
  return <code className="eco-yocto">{value ?? "—"} yocto</code>;
}

function Tx({ url, hash }: { url: string | null | undefined; hash?: string | null }) {
  if (!url) return <span className="eco-muted">no hash</span>;
  return (
    <a className="eco-tx" href={url} target="_blank" rel="noreferrer">
      {hash ? shortHash(hash) : "view"} ↗
    </a>
  );
}

function Stat({ label, children, note }: { label: string; children: React.ReactNode; note?: React.ReactNode }) {
  return (
    <div className="eco-stat">
      <span className="eco-stat-label">{label}</span>
      <span className="eco-stat-value">{children}</span>
      {note ? <span className="eco-stat-note">{note}</span> : null}
    </div>
  );
}

const when = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }) + " UTC" : "—";

const Unavailable = ({ what, reason }: { what: string; reason?: string | null }) => (
  <p className="eco-muted">{what} is not available on this host right now{reason ? `: ${reason}` : "."}</p>
);

export default function EconomyPage() {
  const [data, setData] = useState<Ledger | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    document.title = "QuestLayer · Prize pool ledger";
    document.documentElement.classList.add("eco-root");
    fetch("/api/economy/ledger")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then(setData)
      .catch((e) => setError(String(e?.message || e)));
    return () => document.documentElement.classList.remove("eco-root");
  }, []);

  return (
    <main className="eco">
      <header className="eco-top">
        <a className="eco-brand" href="/">QuestLayer</a>
        <nav>
          <a href="/how-it-works">How it works</a>
          <a className="eco-play" href="/">Play</a>
        </nav>
      </header>
      <section className="eco-hero">
        <h1>Prize pool ledger</h1>
        <p>
          One global prize pool pays every coin and zone prize on the map. Everything below is read from the NEAR
          chain or from the server's public records, with an explorer link for every transaction.
        </p>
        {data ? (
          <p className="eco-meta">
            <span className="eco-chip">{data.network === "mainnet" ? "NEAR mainnet" : "NEAR testnet"}</span>
            Read {when(data.generatedAt)}
            {data.rewardsContract ? (
              <>
                {" · "}
                <a href={data.rewardsContract.explorerUrl} target="_blank" rel="noreferrer">
                  {data.rewardsContract.id} ↗
                </a>
              </>
            ) : null}
          </p>
        ) : null}
      </section>

      {error ? <p className="eco-card eco-error">The ledger could not be loaded ({error}). Try again in a minute.</p> : null}
      {!data && !error ? <p className="eco-card eco-muted">Reading the chain…</p> : null}

      {data ? (
        <>
          <section className="eco-stats" aria-label="Summary">
            <Stat label="Prize pool funded" note={data.treasury.status === "observed" ? <Yocto value={data.treasury.funded} /> : "not audited yet"}>
              <Amount yocto={data.treasury.funded} />
            </Stat>
            <Stat label="Still to pay out" note="open days + unclaimed">
              <Amount yocto={data.treasury.liabilities} />
            </Stat>
            <Stat label="Awarded to players" note={`${data.payouts.count} confirmed claims`}>
              <Amount yocto={data.treasury.awarded ?? data.payouts.total} />
            </Stat>
            <Stat
              label="Realized yield received"
              note={data.realizedYield.status === "observed" ? <Yocto value={data.realizedYield.paid} /> : "not observed"}
            >
              <Amount yocto={data.realizedYield.paid} digits={6} />
            </Stat>
            <Stat label="Treasury in stNEAR" note={data.stnear.status === "observed" ? `≈ ${shortNear(data.stnear.value)} NEAR` : "not observed"}>
              <span className="eco-amount">
                {shortNear(data.stnear.balance)} <small>stNEAR</small>
              </span>
            </Stat>
          </section>

          <section className="eco-card" aria-labelledby="eco-audit">
            <div className="eco-card-head">
              <h2 id="eco-audit">Distribution audit</h2>
              <span className={`eco-badge ${data.audit.status === "verified" ? "ok" : data.audit.status === "drift" ? "bad" : ""}`}>
                {data.audit.status}
              </span>
            </div>
            <p className="eco-muted">
              Re-run by the reward worker before it publishes any new day; any drift stops new prizes. Last run{" "}
              {when(data.audit.observedAt)}.
            </p>
            {data.audit.checks?.length ? (
              <ul className="eco-checks">
                {data.audit.checks.map((c) => (
                  <li key={c.name} className={c.ok ? "ok" : "bad"}>
                    <span aria-hidden>{c.ok ? "✓" : "✗"}</span> {CHECK_LABELS[c.name] ?? c.name}
                  </li>
                ))}
              </ul>
            ) : (
              <Unavailable what="The audit" reason={data.audit.reason} />
            )}
          </section>

          <section className="eco-card" aria-labelledby="eco-yield">
            <h2 id="eco-yield">Realized yield</h2>
            <p className="eco-muted">
              Staking vaults pay part of their staking rewards into the prize pool. Only yield that has actually
              arrived counts; days paid from yield can never spend more than this.
            </p>
            {data.realizedYield.status === "observed" ? (
              <>
                <dl className="eco-dl">
                  <dt>Received</dt>
                  <dd>
                    <Amount yocto={data.realizedYield.paid} digits={6} /> <Yocto value={data.realizedYield.paid} />
                  </dd>
                  <dt>Already promised to yield-paid days</dt>
                  <dd>
                    <Amount yocto={data.realizedYield.committed} digits={6} /> <Yocto value={data.realizedYield.committed} />
                  </dd>
                  <dt>Free for the next yield-paid day</dt>
                  <dd>
                    <Amount yocto={data.realizedYield.free} digits={6} /> <Yocto value={data.realizedYield.free} />
                  </dd>
                </dl>
                <div className="eco-table-wrap">
                  <table className="eco-table">
                    <thead>
                      <tr><th>Vault</th><th>Paid to the prize pool</th></tr>
                    </thead>
                    <tbody>
                      {(data.realizedYield.vaults || []).map((v) => (
                        <tr key={v.accountId}>
                          <td><a href={v.explorerUrl ?? undefined} target="_blank" rel="noreferrer">{shortAccount(v.accountId)} ↗</a></td>
                          <td><Yocto value={v.gamePaid} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            ) : (
              <Unavailable what="Live vault yield" reason={data.realizedYield.reason} />
            )}
          </section>

          <section className="eco-card" aria-labelledby="eco-stnear">
            <h2 id="eco-stnear">Treasury in stNEAR</h2>
            {data.stnear.status === "observed" ? (
              <>
                <p className={`eco-note ${data.stnear.yieldStatus === "growing" ? "ok" : ""}`}>
                  {YIELD_STATUS_COPY[data.stnear.yieldStatus ?? ""] ?? data.stnear.yieldStatus}
                </p>
                <dl className="eco-dl">
                  <dt>Holder</dt>
                  <dd><a href={data.stnear.accountUrl} target="_blank" rel="noreferrer">{data.stnear.account} ↗</a></dd>
                  <dt>Balance</dt>
                  <dd>{exactNear(data.stnear.balance)} stNEAR{data.stnear.parked && data.stnear.parked !== "0" ? <> · <Amount yocto={data.stnear.parked} /> in the yield vault</> : null}</dd>
                  <dt>Price now / at deposit</dt>
                  <dd>{priceLabel(data.stnear.price)} / {priceLabel(data.stnear.depositPrice)} NEAR per stNEAR</dd>
                  <dt>Value / principal</dt>
                  <dd><Amount yocto={data.stnear.value} /> / <Amount yocto={data.stnear.principal} /></dd>
                  <dt>Growth / harvested into the pool</dt>
                  <dd><Amount yocto={data.stnear.growth} digits={6} /> / <Amount yocto={data.stnear.harvested} digits={6} /></dd>
                </dl>
                <ul className="eco-list">
                  {(data.stnear.deposits || []).map((d) => (
                    <li key={d.at}>Deposit {when(d.at)} · <Amount yocto={d.near} /> · <Tx url={d.explorerUrl} /></li>
                  ))}
                  {(data.stnear.harvests || []).map((h) => (
                    <li key={h.at}>Harvest {when(h.at)} · <Amount yocto={h.received} digits={6} /> · sold <Tx url={h.sellUrl} /> · funded <Tx url={h.fundUrl} /></li>
                  ))}
                </ul>
              </>
            ) : (
              <Unavailable what="The stNEAR treasury" reason={data.stnear.reason} />
            )}
          </section>

          <section className="eco-card" aria-labelledby="eco-budget">
            <h2 id="eco-budget">Daily prize budget</h2>
            <p className="eco-muted">One budget per day for the whole map, split between live cities by player demand.</p>
            {data.budget.length ? (
              <div className="eco-table-wrap">
                <table className="eco-table">
                  <thead>
                    <tr><th>Date</th><th>Cities</th><th>Coins</th><th>Zones</th><th>Total</th><th>From yield</th></tr>
                  </thead>
                  <tbody>
                    {data.budget.map((b) => (
                      <tr key={b.date}>
                        <td>{b.date}</td>
                        <td>{b.cities}</td>
                        <td><Amount yocto={b.coinBudget} /></td>
                        <td><Amount yocto={b.zoneBudget} /></td>
                        <td><Amount yocto={b.total} /></td>
                        <td>{b.fromYield === "0" ? "—" : <Amount yocto={b.fromYield} digits={6} />}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="eco-muted">No prize day is published on this host yet.</p>
            )}
            {data.days.length ? (
              <details className="eco-details">
                <summary>Published days ({data.days.length})</summary>
                <div className="eco-table-wrap">
                  <table className="eco-table">
                    <thead>
                      <tr><th>Day</th><th>State</th><th>Paid from</th><th>Total</th><th>Publish tx</th></tr>
                    </thead>
                    <tbody>
                      {data.days.map((d) => (
                        <tr key={d.id}>
                          <td>{d.id}</td>
                          <td>{d.state}</td>
                          <td>{d.funding === "realized-yield" ? "yield" : "treasury"}</td>
                          <td><Amount yocto={d.total} /></td>
                          <td><Tx url={d.explorerUrl} hash={d.transactionHash} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
            ) : null}
          </section>

          <section className="eco-card" aria-labelledby="eco-payouts">
            <h2 id="eco-payouts">Payouts</h2>
            <p className="eco-muted">
              {data.payouts.count} confirmed claims, <Amount yocto={data.payouts.total} digits={6} /> in total
              {Object.entries(data.payouts.byKind).map(([k, v]) => ` · ${v.count} ${k}`).join("")}.
            </p>
            {data.payouts.recent.length ? (
              <div className="eco-table-wrap">
                <table className="eco-table">
                  <thead>
                    <tr><th>When</th><th>Kind</th><th>Player account</th><th>Amount</th><th>Claim tx</th></tr>
                  </thead>
                  <tbody>
                    {data.payouts.recent.map((p, i) => (
                      <tr key={p.transactionHash ?? `${p.dayId}-${i}`}>
                        <td>{when(p.at)}</td>
                        <td>{p.kind}</td>
                        <td>{shortAccount(p.account)}</td>
                        <td>{p.amount ? <Amount yocto={p.amount} digits={6} /> : "—"}</td>
                        <td><Tx url={p.explorerUrl} hash={p.transactionHash} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="eco-muted">No claim is confirmed on this host yet.</p>
            )}
          </section>

          {data.yieldCycle ? (
            <section className="eco-card" aria-labelledby="eco-cycle">
              <div className="eco-card-head">
                <h2 id="eco-cycle">Proof: yield reached the prize pool</h2>
                {data.yieldCycle.auditStatus ? (
                  <span className={`eco-badge ${data.yieldCycle.auditStatus === "verified" ? "ok" : ""}`}>audit {data.yieldCycle.auditStatus}</span>
                ) : null}
              </div>
              <p>{data.yieldCycle.summary}</p>
              <dl className="eco-dl">
                <dt>Realized yield</dt>
                <dd><Amount yocto={data.yieldCycle.realizedYieldYocto} digits={6} /> <Yocto value={data.yieldCycle.realizedYieldYocto} /></dd>
                <dt>Pool funded before / after</dt>
                <dd><Yocto value={data.yieldCycle.fundedBefore} /> → <Yocto value={data.yieldCycle.fundedAfter} /></dd>
                <dt>Prize pool</dt>
                <dd>{data.yieldCycle.rewardsContract}</dd>
              </dl>
              <ol className="eco-timeline">
                {data.yieldCycle.timeline.map((s, i) => (
                  <li key={`${s.step}-${i}`}>
                    <strong>{s.step}</strong>
                    {s.epoch != null ? ` · epoch ${s.epoch}` : ""}
                    {s.at ? ` · ${s.at}` : ""}
                    {s.detail ? <span className="eco-muted"> — {s.detail}</span> : null}
                  </li>
                ))}
              </ol>
              <div className="eco-table-wrap">
                <table className="eco-table">
                  <thead>
                    <tr><th>Vault</th><th>Paid</th><th>Flush tx</th></tr>
                  </thead>
                  <tbody>
                    {data.yieldCycle.flushes.map((f) => (
                      <tr key={f.transactionHash}>
                        <td>{shortAccount(f.vault)}</td>
                        <td><Yocto value={f.gamePaidYocto} /></td>
                        <td><Tx url={f.explorerUrl} hash={f.transactionHash} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="eco-muted eco-small">{data.yieldCycle.reconciliation}</p>
              <p className="eco-muted eco-small">{data.yieldCycle.generation}</p>
            </section>
          ) : null}

          <footer className="eco-foot">
            <p>
              Raw data: <a href="/api/economy/ledger">/api/economy/ledger</a> ·{" "}
              <a href="/api/native/distribution">/api/native/distribution</a> ·{" "}
              <a href="/api/treasury/stnear">/api/treasury/stnear</a> ·{" "}
              <a href="/native-yield-cycle-proof.json">yield cycle proof</a>
            </p>
            {data.audit.scope ? <p className="eco-small">{data.audit.scope}</p> : null}
          </footer>
        </>
      ) : null}
    </main>
  );
}
