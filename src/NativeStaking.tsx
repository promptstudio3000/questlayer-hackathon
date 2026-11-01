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
      ? "Finish setup"
      : p.state === "failed"
        ? "Setup failed"
        : "Setup pending";
  if (s.stage === "unlocking") return `Unlocking · epoch ${s.unlock_epoch}`;
  if (s.owner_pending !== "0" || s.game_pending !== "0")
    return "Transfer pending";
  if (s.stage !== "idle") return String(s.stage).replaceAll("_", " ");
  if (s.owner_credit !== "0") return "Ready to withdraw";
  if (s.exit_requested) return "Exit requested";
  return BigInt(String(s.principal || "0")) > 0n ? "Staked" : "Ready to stake";
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
    try {
      if (await onTransaction({ ...request, accountId: account })) {
        setNotice("Transaction submitted. Check the confirmed position below.");
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
          <h2 id="native-staking-title">Staking</h2>
          <p>Optional support for the game, from your share of yield.</p>
        </div>
        <span className="staking-network">Testnet</span>
      </header>
      {error && (
        <p role="alert" className="staking-feedback staking-error">
          <WarningCircle size={20} aria-hidden="true" /> {error}
        </p>
      )}
      {busy && (
        <p role="status" className="staking-feedback">
          <Clock size={20} aria-hidden="true" /> Waiting for your wallet or the
          network…
        </p>
      )}
      {notice && !busy && (
        <p role="status" className="staking-feedback staking-success">
          <CheckCircle size={20} aria-hidden="true" /> {notice}
        </p>
      )}
      {!data && !error && <p role="status">Loading testnet positions…</p>}
      {!data && error && (
        <button
          className="staking-action"
          disabled={busy}
          onClick={() => void refresh()}
        >
          <ArrowsClockwise size={20} aria-hidden="true" /> Try again
        </button>
      )}
      {data?.status === "not-configured" && (
        <p>Staking is not available yet. You can keep exploring without it.</p>
      )}
      {data?.config && (
        <>
          <div className="staking-wallet">
            {account ? (
              <label>
                <span>NEAR wallet</span>
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
                <Wallet size={20} aria-hidden="true" /> Connect NEAR wallet
              </button>
            )}
            <button
              className="staking-action staking-refresh"
              disabled={busy}
              onClick={() => void refresh()}
              aria-label="Refresh staking positions"
            >
              <ArrowsClockwise size={20} aria-hidden="true" /> Refresh
            </button>
          </div>

          {data.positions.length === 0 ? (
            <p className="staking-empty">
              {account
                ? "No staking positions yet."
                : "Connect to see your positions."}
              <span>You can play for free without staking.</span>
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
                          {p.contribution_bps / 100}% of yield to the game
                        </span>
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
                              test NEAR · {ready ? "ready" : "observed stake"}
                            </span>
                          </>
                        )}
                        <span className="staking-manage">
                          Manage <CaretDown size={18} aria-hidden="true" />
                        </span>
                      </div>
                    </summary>
                    <div className="staking-management">
                      {!s ? (
                        <p>
                          {p.state === "created"
                            ? "Your position is created. Retry registration to finish setup."
                            : p.state === "failed"
                              ? "Setup failed. Check your available refund below."
                              : "Setup is pending. Refresh to check again."}
                        </p>
                      ) : (
                        <>
                          <dl className="staking-balances">
                            <div>
                              <dt>Observed stake</dt>
                              <dd>{exactValue(s.staked)} test NEAR</dd>
                            </div>
                            <div>
                              <dt>Ready for you</dt>
                              <dd>{exactValue(s.owner_credit)} test NEAR</dd>
                            </div>
                            <div>
                              <dt>Confirmed game yield</dt>
                              <dd>{exactValue(s.game_credit)} test NEAR</dd>
                            </div>
                          </dl>
                          {s.stage === "unlocking" && (
                            <p className="staking-feedback">
                              <Clock size={20} aria-hidden="true" />
                              <span>
                                Waiting for epoch {String(s.unlock_epoch)} or
                                later. Last checked: epoch {String(s.epoch)}. A
                                later request cannot reset this batch.
                              </span>
                            </p>
                          )}
                          {!!s.exit_requested && (
                            <p className="staking-secondary">
                              Full exit requested. This stake no longer counts
                              toward native tiers.
                            </p>
                          )}
                          {pending && (
                            <p className="staking-secondary">
                              A transfer is pending. Deposits and withdrawals
                              resume after it settles.
                            </p>
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
                              Withdraw ready funds
                            </button>
                          )}
                          {!s.exit_requested && (
                            <div className="staking-deposit">
                              <label htmlFor={amountId}>
                                Add stake · test NEAR
                              </label>
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
                                  <ArrowUp size={20} aria-hidden="true" /> Stake
                                </button>
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
                                  Wait for the current pool operation before
                                  adding stake.
                                </p>
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
                            Update from pool
                          </button>
                          {!canUpdate && (
                            <p className="staking-secondary">
                              A pool operation is in progress. Refresh positions
                              to check its result.
                            </p>
                          )}
                          {!s.exit_requested &&
                            BigInt(String(s.principal || "0")) > 0n && (
                              <details className="staking-exit">
                                <summary>
                                  <ArrowDown size={20} aria-hidden="true" />{" "}
                                  Exit this position{" "}
                                  <CaretDown size={18} aria-hidden="true" />
                                </summary>
                                <p>
                                  Exit all your stake. It stops counting toward
                                  tiers immediately. Unlocking usually takes an
                                  estimated 1–7 days; the pool sets the release
                                  epoch.
                                </p>
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
                                  Request full exit
                                </button>
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
                          Finish registration
                        </button>
                      )}
                      <a
                        className="staking-explorer"
                        href={`${EXPLORER_BASE}/address/${p.account_id}`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Inspect position on NEAR{" "}
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
                <ArrowDown size={20} aria-hidden="true" /> Refund{" "}
                {exactValue(data.refund.available)} test NEAR
              </button>
              {data.refund.pending !== "0" && (
                <p className="staking-secondary">
                  Your setup refund transfer is pending.
                </p>
              )}
            </div>
          )}

          <details className="staking-create">
            <summary>
              <Plus size={22} aria-hidden="true" />
              <span>
                <strong>Create a position</strong>
                <span>Setup {value(data.config.setup_deposit)} test NEAR</span>
              </span>
              <CaretDown size={20} aria-hidden="true" />
            </summary>
            <div className="staking-create-body">
              <label>
                Validator
                <select
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
                Yield split
                <span className="staking-share-labels">
                  <span>
                    Game <strong>{contribution}%</strong>
                  </span>
                  <span>
                    You <strong>{100 - contribution}%</strong>
                  </span>
                </span>
                <input
                  type="range"
                  min="0"
                  max="100"
                  step="1"
                  aria-label="Percentage of eligible yield contributed to the game"
                  aria-valuetext={`${contribution}% to the game, ${100 - contribution}% retained by you`}
                  value={contribution}
                  disabled={busy}
                  onChange={(e) => setContribution(Number(e.target.value))}
                />
              </label>
              <p className="staking-secondary">
                This split is fixed for this position. To change it, fully exit
                and create another.
              </p>
              <div className="staking-setup-cost">
                <strong>
                  Setup: {exactValue(data.config.setup_deposit)} test NEAR
                </strong>
                <p>
                  {exactValue(data.config.vault_reserve)} for contract storage
                  and operation + {exactValue(data.config.factory_storage)}{" "}
                  factory storage.
                </p>
                <p>
                  <strong>
                    Separate from stake and not currently withdrawable.
                  </strong>{" "}
                  Add your stake in a second transaction.
                </p>
              </div>
              <p className="staking-secondary">
                Unaudited testnet pilot; test tokens only. No fixed APY.
                Validator rewards and losses affect your position. Exits are
                estimated at 1–7 days and depend on pool epochs.
              </p>
              <label className="staking-consent">
                <input
                  type="checkbox"
                  checked={understood}
                  disabled={busy}
                  onChange={(e) => setUnderstood(e.target.checked)}
                />
                <span>
                  I understand the setup reserve and that this is an unaudited
                  testnet pilot.
                </span>
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
                <Plus size={20} aria-hidden="true" /> Create testnet position
              </button>
              {!account && (
                <p className="staking-secondary">
                  Connect a NEAR wallet above to create a position.
                </p>
              )}
              {data.config.created >= data.config.capacity && (
                <p className="staking-secondary">
                  This pilot is full. Existing positions can still be managed.
                </p>
              )}
              <p className="staking-secondary">
                Pilot: {data.config.created}/{data.config.capacity} positions,
                up to four per wallet.
              </p>
            </div>
          </details>
          <details className="staking-about">
            <summary>
              <Info size={20} aria-hidden="true" /> How staking supports the
              game <CaretDown size={18} aria-hidden="true" />
            </summary>
            <p>
              Only realized yield received by the game funds rewards. Principal
              and your retained yield stay separate.
            </p>
            <p>
              Higher-tier access matures after a complete subsequent epoch. This
              pilot conservatively counts mature principal and may need a fresh
              pool update.
            </p>
            <p>
              Your wallet controls deposits and withdrawals. Positions have no
              access keys and their owner is fixed in the contract. The server
              cannot sign for you.
            </p>
          </details>
        </>
      )}
    </section>
  );
}
