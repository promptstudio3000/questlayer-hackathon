import { useEffect, useState } from "react";
import {
  ArrowDown,
  ArrowSquareOut,
  ArrowUp,
  ArrowsClockwise,
  CaretDown,
  CheckCircle,
  Clock,
  Info,
  Plant,
  Plus,
  Wallet,
  WarningCircle,
} from "@phosphor-icons/react";
import "./native-staking.css";
import { api } from "./api";
import type { Player } from "./types";
import { parseTestNear, type VaultRequest } from "./native-vault-quote";
import { EXPLORER_BASE } from "./near-network.ts";
import { ChainLink } from "./ChainLink";
import type { ChainRef } from "./chain-proof";
import { tr } from "./i18n";
type Position = {
  id: string;
  account_id: string;
  beneficiary: string;
  pool: string;
  contribution_bps: number;
  state: string;
  position: Record<string, string | number | boolean> | null;
};
export type VaultSnapshot = {
  status?: string;
  network: string;
  factoryId: string;
  config: {
    setup_deposit: string;
    vault_reserve: string;
    factory_storage: string;
    created: number;
    capacity: number;
  };
  pools: { id: string; name: string }[];
  positions: Position[];
  refund: { available: string; pending: string } | null;
};
const value = (n: unknown) =>
  new Intl.NumberFormat("en-US", { maximumFractionDigits: 8 }).format(
    Number(n || 0) / 1e24,
  );
const exactValue = (n: unknown) => {
  const yocto = BigInt(String(n || "0"));
  const whole = (yocto / 10n ** 24n).toLocaleString("en-US");
  const fraction = (yocto % 10n ** 24n)
    .toString()
    .padStart(24, "0")
    .replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole;
};
function positionStatus(p: Position) {
  const s = p.position;
  if (!s)
    return p.state === "created"
      ? tr("Finish setup")
      : p.state === "failed"
        ? tr("Setup failed")
        : tr("Setup pending");
  if (s.stage === "unlocking") return tr("Unlocking · epoch {0}", { 0: s.unlock_epoch });
  if (s.owner_pending !== "0" || s.game_pending !== "0")
    return tr("Transfer pending");
  if (s.stage !== "idle") return String(s.stage).replaceAll("_", " ");
  if (s.owner_credit !== "0") return tr("Ready to withdraw");
  if (s.exit_requested) return tr("Exit requested");
  return BigInt(String(s.principal || "0")) > 0n ? tr("Staked") : tr("Ready to stake");
}
export function NativeStaking({
  player,
  onConnect,
  onTransaction,
  readVaults = (account: string) =>
    api<VaultSnapshot>(
      "/native/vaults" +
        (account ? "?account=" + encodeURIComponent(account) : ""),
    ),
}: {
  player: Player;
  onConnect: () => void;
  onTransaction: (r: VaultRequest) => Promise<boolean>;
  readVaults?: (account: string) => Promise<VaultSnapshot>;
}) {
  const [account, setAccount] = useState(player.wallets[0]?.account_id || ""),
    [data, setData] = useState<VaultSnapshot | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState(""),
    [proof, setProof] = useState<ChainRef | null>(null),
    [pool, setPool] = useState("aurora.pool.f863973.m0"),
    [contribution, setContribution] = useState(50),
    [amount, setAmount] = useState("0.1"),
    [understood, setUnderstood] = useState(false);
  async function refresh() {
    try {
      setData(await readVaults(account));
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }
  useEffect(() => {
    let active = true;
    void readVaults(account)
      .then((s) => {
        if (active) {
          setData(s);
          setError("");
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [account]);
  useEffect(() => {
    if (!player.wallets.some((w) => w.account_id === account))
      setAccount(player.wallets[0]?.account_id || "");
  }, [player.wallets.map((w) => w.account_id).join("|")]);
  async function run(request: Omit<VaultRequest, "accountId">) {
    setBusy(true);
    setError("");
    setNotice("");
    setProof(null);
    const since = Date.now() - 60_000;
    try {
      if (await onTransaction({ ...request, accountId: account })) {
        setProof({ id: `latest:stake:${since}`, account });
        setNotice(tr("Transaction submitted. Check the confirmed position below."));
        await refresh();
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const amountError = (() => {
    try {
      parseTestNear(amount);
      return "";
    } catch (e) {
      return (e as Error).message;
    }
  })();
  return (
    <section className="staking-panel" aria-labelledby="native-staking-title">
      <header className="staking-heading">
        <Plant size={28} weight="duotone" aria-hidden="true" />
        <div>
          <h2 id="native-staking-title">{tr("Staking")}</h2>
          <p>{tr("Optional support for the game, from your share of yield.")}</p>
        </div>
        <span className="staking-network">{tr("Testnet")}</span>
      </header>
      {error && (
        <p role="alert" className="staking-feedback staking-error">
          <WarningCircle size={20} aria-hidden="true" /> {error}
        </p>
      )}
      {busy && (
        <p role="status" className="staking-feedback">
          <Clock size={20} aria-hidden="true" /> {" "}{tr("Waiting for your wallet or the network…")}</p>
      )}
      {notice && !busy && (
        <p role="status" className="staking-feedback staking-success">
          <CheckCircle size={20} aria-hidden="true" /> {notice}{" "}
          {proof && <ChainLink label chain={proof} />}
        </p>
      )}
      {!data && !error && <p role="status">{tr("Loading testnet positions…")}</p>}
      {!data && error && (
        <button
          className="staking-action"
          disabled={busy}
          onClick={() => void refresh()}
        >
          <ArrowsClockwise size={20} aria-hidden="true" /> {" "}{tr("Try again")}</button>
      )}
      {data?.status === "not-configured" && (
        <p>{tr("Staking is not available yet. You can keep exploring without it.")}</p>
      )}
      {data?.config && (
        <>
          <div className="staking-wallet">
            {account ? (
              <label>
                <span>{tr("NEAR wallet")}</span>
                <select
                  value={account}
                  disabled={busy}
                  onChange={(e) => {
                    setData(null);
                    setUnderstood(false);
                    setAccount(e.target.value);
                  }}
                >
                  {player.wallets.map((w) => (
                    <option key={w.account_id}>{w.account_id}</option>
                  ))}
                </select>
              </label>
            ) : (
              <button
                className="staking-action staking-primary"
                onClick={onConnect}
              >
                <Wallet size={20} aria-hidden="true" /> {" "}{tr("Connect NEAR wallet")}</button>
            )}
            <button
              className="staking-action staking-refresh"
              disabled={busy}
              onClick={() => void refresh()}
              aria-label={tr("Refresh staking positions")}
            >
              <ArrowsClockwise size={20} aria-hidden="true" /> {" "}{tr("Refresh")}</button>
          </div>

          {data.positions.length === 0 ? (
            <p className="staking-empty">
              {account
                ? tr("No staking positions yet.")
                : tr("Connect to see your positions.")}
              <span>{tr("You can play for free without staking.")}</span>
            </p>
          ) : (
            <div className="staking-positions">
              {data.positions.map((p) => {
                const s = p.position,
                  idle = s?.stage === "idle",
                  pending = s?.owner_pending !== "0" || s?.game_pending !== "0",
                  ready = !!s && idle && !pending && s.owner_credit !== "0",
                  canUpdate =
                    idle ||
                    ["unlocking", "awaiting_cash"].includes(String(s?.stage)),
                  amountId = `stake-amount-${p.id}`,
                  amountErrorId = `${amountId}-error`;
                return (
                  <details className="staking-position" key={p.account_id}>
                    <summary>
                      <div className="staking-position-label">
                        <strong>
                          {data.pools.find((pool) => pool.id === p.pool)
                            ?.name || p.pool.split(".")[0]}
                        </strong>
                        <span>
                          {p.contribution_bps / 100}{tr("% of yield to the game")}</span>
                        <span
                          className={
                            ready
                              ? "staking-status staking-status-ready"
                              : "staking-status"
                          }
                        >
                          {ready ? (
                            <ArrowDown size={16} aria-hidden="true" />
                          ) : (
                            <Clock size={16} aria-hidden="true" />
                          )}
                          {positionStatus(p)}
                        </span>
                      </div>
                      <div className="staking-position-value">
                        {s && (
                          <>
                            <strong>
                              {value(ready ? s.owner_credit : s.staked)}
                            </strong>
                            <span>
                              {tr("test NEAR ·")}{" "}{ready ? "ready" : tr("observed stake")}
                            </span>
                          </>
                        )}
                        <span className="staking-manage">
                          {tr("Manage")}{" "}<CaretDown size={18} aria-hidden="true" />
                        </span>
                      </div>
                    </summary>
                    <div className="staking-management">
                      {!s ? (
                        <p>
                          {p.state === "created"
                            ? tr("Your position is created. Retry registration to finish setup.")
                            : p.state === "failed"
                              ? tr("Setup failed. Check your available refund below.")
                              : tr("Setup is pending. Refresh to check again.")}
                        </p>
                      ) : (
                        <>
                          <dl className="staking-balances">
                            <div>
                              <dt>{tr("Observed stake")}</dt>
                              <dd>{exactValue(s.staked)} {" "}{tr("test NEAR")}</dd>
                            </div>
                            <div>
                              <dt>{tr("Ready for you")}</dt>
                              <dd>{exactValue(s.owner_credit)} {" "}{tr("test NEAR")}</dd>
                            </div>
                            <div>
                              <dt>{tr("Confirmed game yield")}</dt>
                              <dd>{exactValue(s.game_credit)} {" "}{tr("test NEAR")}</dd>
                            </div>
                          </dl>
                          {s.stage === "unlocking" && (
                            <p className="staking-feedback">
                              <Clock size={20} aria-hidden="true" />
                              <span>
                                {tr("Waiting for epoch")}{" "}{String(s.unlock_epoch)} {" "}{tr("or later. Last checked: epoch")}{" "}{String(s.epoch)}{tr(". A later request cannot reset this batch.")}</span>
                            </p>
                          )}
                          {!!s.exit_requested && (
                            <p className="staking-secondary">
                              {tr("Full exit requested. This stake no longer counts toward native tiers.")}</p>
                          )}
                          {pending && (
                            <p className="staking-secondary">
                              {tr("A transfer is pending. Deposits and withdrawals resume after it settles.")}</p>
                          )}

                          {s.owner_credit !== "0" && (
                            <button
                              className="staking-action staking-primary staking-full"
                              disabled={
                                busy ||
                                !idle ||
                                pending ||
                                s.owner_credit === "0"
                              }
                              onClick={() =>
                                void run({
                                  action: "withdraw",
                                  vaultId: p.account_id,
                                })
                              }
                            >
                              <ArrowDown size={20} aria-hidden="true" />{" "}
                              {tr("Withdraw ready funds")}</button>
                          )}
                          {!s.exit_requested && (
                            <div className="staking-deposit">
                              <label htmlFor={amountId}>
                                {tr("Add stake · test NEAR")}</label>
                              <div className="staking-deposit-controls">
                                <input
                                  id={amountId}
                                  inputMode="decimal"
                                  value={amount}
                                  aria-invalid={!!amountError}
                                  aria-describedby={
                                    amountError ? amountErrorId : undefined
                                  }
                                  onChange={(e) => setAmount(e.target.value)}
                                />
                                <button
                                  className={`staking-action ${ready ? "" : "staking-primary"}`}
                                  disabled={
                                    busy ||
                                    !idle ||
                                    pending ||
                                    !!s.exit_requested ||
                                    !!amountError
                                  }
                                  onClick={() => {
                                    try {
                                      void run({
                                        action: "deposit",
                                        vaultId: p.account_id,
                                        amount: parseTestNear(amount),
                                      });
                                    } catch (e) {
                                      setError((e as Error).message);
                                    }
                                  }}
                                >
                                  <ArrowUp size={20} aria-hidden="true" /> {" "}{tr("Stake")}</button>
                              </div>
                              {amountError && (
                                <p
                                  role="alert"
                                  id={amountErrorId}
                                  className="staking-error"
                                >
                                  {amountError}
                                </p>
                              )}
                              {!idle && (
                                <p className="staking-secondary">
                                  {tr("Wait for the current pool operation before adding stake.")}</p>
                              )}
                            </div>
                          )}
                          <button
                            className={`staking-action staking-full ${!idle && canUpdate ? "staking-primary" : ""}`}
                            disabled={busy || !canUpdate}
                            onClick={() =>
                              void run({
                                action: idle ? "refresh" : "advance",
                                vaultId: p.account_id,
                              })
                            }
                          >
                            <ArrowsClockwise size={20} aria-hidden="true" />{" "}
                            {tr("Update from pool")}</button>
                          {!canUpdate && (
                            <p className="staking-secondary">
                              {tr("A pool operation is in progress. Refresh positions to check its result.")}</p>
                          )}
                          {!s.exit_requested &&
                            BigInt(String(s.principal || "0")) > 0n && (
                              <details className="staking-exit">
                                <summary>
                                  <ArrowDown size={20} aria-hidden="true" />{" "}
                                  {tr("Exit this position")}{" "}
                                  <CaretDown size={18} aria-hidden="true" />
                                </summary>
                                <p>
                                  {tr("Exit all your stake. It stops counting toward tiers immediately. Unlocking usually takes an estimated 1–7 days; the pool sets the release epoch.")}</p>
                                <button
                                  className="staking-action staking-full"
                                  disabled={
                                    busy ||
                                    BigInt(String(s.principal || "0")) === 0n ||
                                    !!s.exit_requested
                                  }
                                  onClick={() =>
                                    void run({
                                      action: "exit",
                                      vaultId: p.account_id,
                                    })
                                  }
                                >
                                  {tr("Request full exit")}</button>
                              </details>
                            )}
                        </>
                      )}
                      {p.state === "created" && (
                        <button
                          className="staking-action staking-primary staking-full"
                          disabled={busy}
                          onClick={() =>
                            void run({
                              action: "register",
                              vaultId: p.account_id,
                              positionId: p.id,
                            })
                          }
                        >
                          {tr("Finish registration")}</button>
                      )}
                      <a
                        className="staking-explorer"
                        href={`${EXPLORER_BASE}/address/${p.account_id}`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {tr("Inspect position on NEAR")}{" "}
                        <ArrowSquareOut size={18} aria-hidden="true" />
                      </a>
                    </div>
                  </details>
                );
              })}
            </div>
          )}

          {data.refund && data.refund.available !== "0" && (
            <div className="staking-refund">
              <button
                className="staking-action staking-primary staking-full"
                disabled={busy || data.refund.pending !== "0"}
                onClick={() => void run({ action: "refund" })}
              >
                <ArrowDown size={20} aria-hidden="true" /> {" "}{tr("Refund")}{" "}
                {exactValue(data.refund.available)} {" "}{tr("test NEAR")}</button>
              {data.refund.pending !== "0" && (
                <p className="staking-secondary">
                  {tr("Your setup refund transfer is pending.")}</p>
              )}
            </div>
          )}

          <details className="staking-create">
            <summary>
              <Plus size={22} aria-hidden="true" />
              <span>
                <strong>{tr("Create a position")}</strong>
                <span>{tr("Setup")}{" "}{value(data.config.setup_deposit)} {" "}{tr("test NEAR")}</span>
              </span>
              <CaretDown size={20} aria-hidden="true" />
            </summary>
            <div className="staking-create-body">
              <label>
                {tr("Validator")}<select
                  value={pool}
                  onChange={(e) => setPool(e.target.value)}
                  disabled={busy}
                >
                  {data.pools.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="staking-share">
                {tr("Yield split")}<span className="staking-share-labels">
                  <span>
                    {tr("Game")}{" "}<strong>{contribution}%</strong>
                  </span>
                  <span>
                    {tr("You")}{" "}<strong>{100 - contribution}%</strong>
                  </span>
                </span>
                <input
                  type="range"
                  min="0"
                  max="100"
                  step="1"
                  aria-label={tr("Percentage of eligible yield contributed to the game")}
                  aria-valuetext={tr("{0}% to the game, {1}% retained by you", { 0: contribution, 1: 100 - contribution })}
                  value={contribution}
                  disabled={busy}
                  onChange={(e) => setContribution(Number(e.target.value))}
                />
              </label>
              <p className="staking-secondary">
                {tr("This split is fixed for this position. To change it, fully exit and create another.")}</p>
              <div className="staking-setup-cost">
                <strong>
                  {tr("Setup:")}{" "}{exactValue(data.config.setup_deposit)} {" "}{tr("test NEAR")}</strong>
                <p>
                  {exactValue(data.config.vault_reserve)} {" "}{tr("for contract storage and operation +")}{" "}{exactValue(data.config.factory_storage)}{" "}
                  {tr("factory storage.")}</p>
                <p>
                  <strong>
                    {tr("Separate from stake and not currently withdrawable.")}</strong>{" "}
                  {tr("Add your stake in a second transaction.")}</p>
              </div>
              <p className="staking-secondary">
                {tr("Unaudited testnet pilot; test tokens only. No fixed APY. Validator rewards and losses affect your position. Exits are estimated at 1–7 days and depend on pool epochs.")}</p>
              <label className="staking-consent">
                <input
                  type="checkbox"
                  checked={understood}
                  disabled={busy}
                  onChange={(e) => setUnderstood(e.target.checked)}
                />
                <span>
                  {tr("I understand the setup reserve and that this is an unaudited testnet pilot.")}</span>
              </label>
              <button
                className="staking-action staking-primary staking-full"
                disabled={
                  !account ||
                  !understood ||
                  busy ||
                  data.config.created >= data.config.capacity
                }
                onClick={() =>
                  void run({
                    action: "create",
                    poolId: pool,
                    contributionBps: contribution * 100,
                    setupDeposit: data.config.setup_deposit,
                  })
                }
              >
                <Plus size={20} aria-hidden="true" /> {" "}{tr("Create testnet position")}</button>
              {!account && (
                <p className="staking-secondary">
                  {tr("Connect a NEAR wallet above to create a position.")}</p>
              )}
              {data.config.created >= data.config.capacity && (
                <p className="staking-secondary">
                  {tr("This pilot is full. Existing positions can still be managed.")}</p>
              )}
              <p className="staking-secondary">
                {tr("Pilot:")}{" "}{data.config.created}/{data.config.capacity} {" "}{tr("positions, up to four per wallet.")}</p>
            </div>
          </details>
          <details className="staking-about">
            <summary>
              <Info size={20} aria-hidden="true" /> {" "}{tr("How staking supports the game")}{" "}<CaretDown size={18} aria-hidden="true" />
            </summary>
            <p>
              {tr("Only realized yield received by the game funds rewards. Principal and your retained yield stay separate.")}</p>
            <p>
              {tr("Higher-tier access matures after a complete subsequent epoch. This pilot conservatively counts mature principal and may need a fresh pool update.")}</p>
            <p>
              {tr("Your wallet controls deposits and withdrawals. Positions have no access keys and their owner is fixed in the contract. The server cannot sign for you.")}</p>
          </details>
        </>
      )}
    </section>
  );
}
