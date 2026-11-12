// Wallet (QGOLD balance and payouts), fund and bounty screens, split from App.tsx so the map
// screen loads without them (first-screen JS budget).
import { ChainLink } from "./ChainLink";
import { useEffect, useState } from "react";
import { Wallet, Plus, ArrowUpRight, Sparkle, Coins, Leaf, PaperPlane, ShieldCheck, Flag, SealCheck } from "@phosphor-icons/react";
import { ArrowRight } from "./dir-icons";
import { api, GOLD, gold, near, meters, remaining } from "./api";
import type { Player, Point, Dashboard, Bounty } from "./types";
import { EXPLORER_BASE } from "./near-network.ts";
import { tr } from "./i18n";
import { distanceLabel, units, CoinIcon, Badge } from "./app-bits";
export function WalletPanel({
  player,
  busy,
  action,
  onPlayer,
  onNear,
  notify,
}: {
  player: Player;
  busy: string;
  action: <T>(n: string, f: () => Promise<T>) => Promise<T | undefined>;
  onPlayer: (p: Player) => void;
  onNear: () => Promise<void>;
  notify: (s: string, e?: boolean) => void;
}) {
  const [balance, setBalance] = useState<string | null>(null);
  return (
    <>
      <QgoldWallet player={player} />
      <section className="form-section">
        <div className="section-label">
          <h2>{tr("NEAR account")}</h2>
          <Badge tone="green">{tr("TEST NETWORK")}</Badge>
        </div>
        <p>{tr("Link a NEAR test account by signing a message. Nothing is paid.")}</p>
        {player.wallets.map((w) => (
          <div className="connected-wallet" key={w.account_id}>
            <SealCheck weight="fill" />
            <b>{w.account_id}</b>
          </div>
        ))}
        {balance && (
          <p>
            {tr("Real balance:")}{" "}<b>{balance} testNEAR</b>
          </p>
        )}
        <button
          className="secondary-button"
          disabled={!!busy}
          onClick={() => void onNear()}
        >
          <Wallet size={17} />
          {player.wallets.length ? tr("Link another account") : tr("Link NEAR account")}
        </button>
        {player.wallets.length > 0 && (
          <button
            className="text-button"
            onClick={() =>
              void action("balance", async () => {
                const r = await api<{ amount: string }>("/wallet/balance");
                setBalance(
                  (Number(BigInt(r.amount) / 10n ** 18n) / 1e6).toLocaleString(
                    "en-US",
                    { maximumFractionDigits: 4 },
                  ),
                );
              })
            }
          >
            {tr("Check NEAR balance")}</button>
        )}
        <p className="fine-print">
          {tr("Walks and Aura trading on the test network are a project pilot. Map coins and zone prizes are paid in QGOLD to the linked account. Never enter a recovery phrase here.")}</p>
      </section>
      <section className="form-section">
        <h2>{tr("Adventure history")}</h2>
        <div className="history-list">
          {player.history.slice(0, 20).map((h) => (
            <div key={h.id}>
              <span className={`history-dot ${h.kind}`}>
                <Sparkle size={15} />
              </span>
              <span>
                <b>{h.title}</b>
                <small>
                  {new Date(h.created_at).toLocaleTimeString("en-US", {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </small>
              </span>
              <strong>
                {h.gold_u
                  ? `${h.gold_u > 0 ? "+" : ""}${gold(h.gold_u)}`
                  : tr("XP / item")}
              </strong>
              {h.chain && <ChainLink chain={h.chain} />}
            </div>
          ))}
        </div>
      </section>
    </>
  );
}
export function FundPanel() {
  const [proof, setProof] = useState<any>(null);
  const [data, setData] = useState<Dashboard | null>(null);
  useEffect(() => {
    api<Dashboard>("/dashboard").then(setData);
    fetch("/testnet-deployment.json")
      .then((r) => (r.ok ? r.json() : null))
      .then(setProof)
      .catch(() => {});
  }, []);
  if (!data) return <p>{tr("Loading fund…")}</p>;
  const total = data.buckets.reduce(
    (s, b) => s + b.available_u + b.reserved_u,
    0,
  );
  return (
    <>
      <p className="panel-subtitle">
        {tr("Clear rules. Every reward has its backing.")}</p>
      <div className="fund-hero">
        <div className="fund-donut">
          <span>
            <b>50 / 50</b>
            <small>{tr("GAME YIELD")}</small>
          </span>
        </div>
        <div>
          <small>{tr("TOTAL PRACTICE FUND")}</small>
          <h2>
            {gold(total)} <span>QGOLD</span>
          </h2>
          <p>
            {tr("The opening fund is a sponsor contribution for the demo. The 5% rate is simulated.")}</p>
        </div>
      </div>
      <div className="bucket-grid">
        {data.buckets.map((b) => (
          <div className={`bucket-card ${b.bucket}`} key={b.bucket}>
            <span>{b.bucket === "coins" ? <Coins /> : <Flag />}</span>
            <h3>{b.bucket === "coins" ? tr("Street coins") : tr("Daily zones")}</h3>
            <strong>
              {gold(b.available_u)} <small>{tr("QGOLD available")}</small>
            </strong>
            <dl>
              <div>
                <dt>{tr("Backed rewards")}</dt>
                <dd>{gold(b.reserved_u)}</dd>
              </div>
              <div>
                <dt>{tr("Paid out")}</dt>
                <dd>{gold(b.paid_u)}</dd>
              </div>
            </dl>
          </div>
        ))}
      </div>
      <div className="two-stats">
        <div>
          <small>{tr("Staking accounts")}</small>
          <b>{data.stakers}</b>
        </div>
        <div>
          <small>{tr("Practice stake")}</small>
          <b>{gold(data.staked)} QGOLD</b>
        </div>
      </div>
      <div className="section-label">
        <h2>{tr("Reward outlook")}</h2>
        <Badge>{tr("5% APR SIMULATION")}</Badge>
      </div>
      <div className="projections">
        {[
          [tr("Day"), 1],
          [tr("Week"), 7],
          [tr("Month"), 30],
          [tr("Quarter"), 90],
          [tr("Year"), 365],
        ].map(([label, days]) => (
          <div key={label}>
            <span>{label}</span>
            <b>
              {gold(
                Math.floor(((data.contributing * 0.05) / 365) * Number(days)),
              )}{" "}
              QGOLD
            </b>
          </div>
        ))}
      </div>
      <p className="fine-print">
        {tr("Estimated yield at a simulated 5% APR, after contribution splits. The horizons are alternatives, not separate funds or promised returns.")}</p>
      <div className="info-banner">
        <ShieldCheck />
        <span>
          {tr("Unclaimed coins and prizes return to their fund. Your own stake never pays for rewards.")}</span>
      </div>
      {proof && (
        <section className="native-proof">
          <div className="section-label">
            <h2>{tr("Verified on NEAR")}</h2>
            <Badge tone="green">{tr("TEST NETWORK")}</Badge>
          </div>
          <p>
            {tr("Earned Auras can be secured to your NEAR account, traded in Market and shown on a public profile. Staking and QGOLD rewards stay practice-only.")}</p>
          <a
            href={`${EXPLORER_BASE}/address/${proof.collectiblesContract}`}
            target="_blank"
            rel="noreferrer"
          >
            {tr("Aura NFT contract")}{" "}<ArrowUpRight size={14} />
            <small>{proof.collectiblesContract}</small>
          </a>
          {proof.transactions
            ?.filter(
              // The first-alpha game contract (coin batches, withdraw_reward) is
              // retired; only the collectibles proofs are still linked.
              (x: any) => x.label.includes("transfer NFT"),
            )
            .map((x: any) => (
              <a
                key={x.transaction}
                href={`${EXPLORER_BASE}/txns/${x.transaction}`}
                target="_blank"
                rel="noreferrer"
              >
                {x.label}
                <ArrowUpRight size={14} />
              </a>
            ))}
          <a href="/testnet-deployment.json" target="_blank" rel="noreferrer">
            {tr("All deployment proofs")}{" "}<ArrowUpRight size={14} />
          </a>
        </section>
      )}
      <div className="section-label">
        <h2>{tr("This world in numbers")}</h2>
      </div>
      <div className="three-stats">
        <div>
          <strong>{data.players}</strong>
          <span>{tr("explorer accounts")}</span>
        </div>
        <div>
          <strong>{data.coinsCollected}</strong>
          <span>{tr("coins collected")}</span>
        </div>
        <div>
          <strong>{data.worlds}</strong>
          <span>{tr("daily worlds")}</span>
        </div>
      </div>
    </>
  );
}
export function Bounties({
  position,
  player,
  action,
  onPlayer,
  notify,
}: {
  position: Point;
  player: Player;
  action: <T>(n: string, f: () => Promise<T>) => Promise<T | undefined>;
  onPlayer: (p: Player) => void;
  notify: (s: string, e?: boolean) => void;
}) {
  const [items, setItems] = useState<Bounty[]>([]),
    [create, setCreate] = useState(false),
    [title, setTitle] = useState(""),
    [description, setDescription] = useState(""),
    [reward, setReward] = useState("100"),
    [evidence, setEvidence] = useState(""),
    [selected, setSelected] = useState<string | null>(null),
    [submissions, setSubmissions] = useState<any[]>([]);
  const load = () =>
    api<{ bounties: Bounty[] }>("/bounties").then((r) => setItems(r.bounties));
  useEffect(() => {
    void load();
  }, []);
  return (
    <>
      <div className="info-banner">
        <ShieldCheck />
        <span>
          {tr("The reward is set aside before a task goes live. Anyone can join.")}</span>
      </div>
      <button className="secondary-button" onClick={() => setCreate((v) => !v)}>
        <Plus /> {" "}{tr("New task")}</button>
      {create && (
        <form
          className="inline-form"
          onSubmit={(e) => {
            e.preventDefault();
            void action("bounty", async () => {
              const r = await api<{ player: Player }>("/bounties", {
                title,
                description,
                amount: units(reward),
                ...position,
              });
              onPlayer(r.player);
              setCreate(false);
              await load();
              notify(tr("Task published. Its reward is set aside."));
            });
          }}
        >
          <label>
            {tr("Title")}<input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              minLength={5}
              maxLength={100}
              required
            />
          </label>
          <label>
            {tr("What needs to be done?")}<textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={1000}
            />
          </label>
          <label>
            {tr("Reward in practice QGOLD")}<input
              value={reward}
              onChange={(e) => setReward(e.target.value)}
              inputMode="decimal"
            />
          </label>
          <button className="primary-button">
            {tr("Lock reward and publish")}{" "}<ArrowRight />
          </button>
          <p className="fine-print">
            {tr("Open for seven days. A submission sent in time keeps the reward reserved until it is reviewed.")}</p>
        </form>
      )}
      <div className="bounty-list">
        {items.map((b) => (
          <article key={b.id}>
            <div>
              <Badge tone={b.state === "open" ? "green" : "purple"}>
                {b.state === "open"
                  ? tr("OPEN")
                  : b.state === "paid"
                    ? tr("COMPLETED")
                    : tr("REFUNDED")}
              </Badge>
              <b>
                <CoinIcon />
                {gold(b.amount_u)} QGOLD
              </b>
            </div>
            <h3>{b.title}</h3>
            <p>{b.description}</p>
            <small>
              {b.creator_name} · {distanceLabel(meters(position, b))}
            </small>
            {b.state === "open" &&
              (b.creator === player.id ? (
                <button
                  className="text-button"
                  onClick={() =>
                    void action("submissions", async () => {
                      const r = await api<{ submissions: any[] }>(
                        `/bounties/submissions?id=${b.id}`,
                      );
                      setSubmissions(r.submissions);
                      setSelected(b.id);
                    })
                  }
                >
                  {tr("Review submissions")}</button>
              ) : (
                <button
                  className="text-button"
                  onClick={() => {
                    setSelected(b.id);
                    setSubmissions([]);
                  }}
                >
                  {tr("Submit proof")}</button>
              ))}
            {selected === b.id && b.creator !== player.id && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void action("submit", async () => {
                    await api("/bounties/submit", { bountyId: b.id, evidence });
                    setSelected(null);
                    setEvidence("");
                    notify(tr("Proof sent. The creator will review it."));
                  });
                }}
              >
                <textarea
                  value={evidence}
                  onChange={(e) => setEvidence(e.target.value)}
                  minLength={10}
                  maxLength={1000}
                  placeholder={tr("Describe how you completed the task…")}
                  required
                />
                <button className="secondary-button">
                  {tr("Submit proof")}{" "}<PaperPlane />
                </button>
              </form>
            )}
            {selected === b.id && b.creator === player.id && (
              <div>
                {submissions.length ? (
                  submissions.map((s) => (
                    <div className="submission" key={s.id}>
                      <b>{s.name}</b>
                      <p>{s.evidence}</p>
                      {s.state === "pending" && (
                        <button
                          className="secondary-button"
                          onClick={() =>
                            void action("approve", async () => {
                              await api("/bounties/approve", {
                                submissionId: s.id,
                              });
                              await load();
                              setSelected(null);
                              notify(tr("Proof approved. Reward paid."));
                            })
                          }
                        >
                          {tr("Approve and pay")}</button>
                      )}
                    </div>
                  ))
                ) : (
                  <p>{tr("No submissions yet.")}</p>
                )}
              </div>
            )}
          </article>
        ))}
      </div>
    </>
  );
}

type PendingQgold = {
  accountId: string | null;
  units: number;
  items: number;
  awaitingAccount: number;
  enabled: boolean;
};

/**
 * Real QGOLD: what is on the player's NEAR account and what the nightly
 * payout still owes them for map coins and zone prizes (docs/DAILY-PAYOUTS.md).
 */
export function QgoldWallet({ player }: { player: Player }) {
  const [pending, setPending] = useState<PendingQgold | null>(null),
    [balance, setBalance] = useState<number | null>(null);
  useEffect(() => {
    let live = true;
    void api<PendingQgold>("/qgold/pending")
      .then(async (p) => {
        if (!live) return;
        setPending(p);
        if (!p.accountId) return;
        const a = await api<{ balance: string | null }>(
          `/qgold/account?account=${encodeURIComponent(p.accountId)}`,
        );
        if (live) setBalance(Number(a.balance || 0));
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [player.id, player.gold_u]);
  return (
    <div className="wallet-hero">
      <span>{tr("QGOLD")}</span>
      <div>
        <CoinIcon />
        <strong>{balance === null ? "…" : gold(balance, 6)}</strong>
      </div>
      <small>
        {pending?.accountId
          ? tr("On your NEAR account {0}", { 0: pending.accountId })
          : tr("Sign in with a NEAR account to receive QGOLD.")}
      </small>
      {!!pending?.units && (
        <small>
          {pending.awaitingAccount
            ? tr("{0} QGOLD collected waits for your NEAR account.", { 0: gold(pending.units, 6) })
            : tr("+{0} QGOLD arrives with the next payout, within minutes.", { 0: gold(pending.units, 6) })}
        </small>
      )}
    </div>
  );
}
