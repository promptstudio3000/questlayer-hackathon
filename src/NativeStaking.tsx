import { useEffect, useState } from "react";
import { ArrowDown, ArrowUp, Wallet } from "@phosphor-icons/react";
import { api } from "./api";
import type { Player } from "./types";
import { parseTestNear, type VaultRequest } from "./native-vault-quote";
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
    <section className="native-expeditions native-staking">
      <h2>Native staking pilot</h2>
      <p>
        Choose a validator and fund your own contract on NEAR testnet. Your
        wallet controls deposits and withdrawals. The server cannot sign for
        you.
      </p>
      {error && (
        <p role="alert" className="native-error">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="native-notice">
          {notice}
        </p>
      )}
      {!data && !error && <p>Reading the testnet factory…</p>}
      {!data && error && (
        <button disabled={busy} onClick={() => void refresh()}>
          Retry testnet connection
        </button>
      )}
      {data?.status === "not-configured" && (
        <p>The staking factory is not configured yet.</p>
      )}
      {data?.config && (
        <>
          <div className="native-expedition-actions">
            {account ? (
              <label>
                Staking wallet
                <select
                  value={account}
                  onChange={(e) => setAccount(e.target.value)}
                >
                  {player.wallets.map((w) => (
                    <option key={w.account_id}>{w.account_id}</option>
                  ))}
                </select>
              </label>
            ) : (
              <button onClick={onConnect}>
                <Wallet size={20} />
                Connect a NEAR wallet
              </button>
            )}
            <button disabled={busy} onClick={() => void refresh()}>
              Refresh positions
            </button>
          </div>
          <details className="native-receipts">
            <summary>Create a staking position</summary>
            <p>
              Experimental contracts, test tokens only. No fixed APY. Validator
              rewards and losses affect your position. A full exit normally
              takes an estimated 1–7 days; the pool controls release by network
              epochs.
            </p>
            <div className="native-staking-fields">
              <label>
                Validator
                <select value={pool} onChange={(e) => setPool(e.target.value)}>
                  {data.pools.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Yield contributed to the game: {contribution}%
                <input
                  type="range"
                  min="0"
                  max="100"
                  step="1"
                  value={contribution}
                  onChange={(e) => setContribution(Number(e.target.value))}
                />
              </label>
              <p>
                {100 - contribution}% of eligible yield remains yours. This
                fraction is fixed for this position; changing it currently
                requires a full exit and a new position.
              </p>
            </div>
            <p>
              <strong>
                Setup: {value(data.config.setup_deposit)} test NEAR.
              </strong>{" "}
              This includes {value(data.config.vault_reserve)} for the
              contract's storage and operation, plus{" "}
              {value(data.config.factory_storage)} factory storage. This setup
              reserve is separate from stake and cannot currently be withdrawn.
              Add your stake in a second transaction.
            </p>
            <label className="native-setup-consent">
              <input
                type="checkbox"
                checked={understood}
                onChange={(e) => setUnderstood(e.target.checked)}
              />
              <span>
                I understand the setup reserve and that this is an unaudited
                testnet pilot.
              </span>
            </label>
            <button
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
              Create my testnet position
            </button>
            <p className="native-secondary">
              Pilot capacity: {data.config.created}/{data.config.capacity}{" "}
              positions, up to four per wallet. Your position is created without
              access keys; the wallet owner is fixed in its contract.
            </p>
          </details>
          {data.positions.length === 0 ? (
            <p>No native staking positions for this wallet yet.</p>
          ) : (
            <>
              <label className="native-stake-amount">
                Amount to add (test NEAR)
                <input
                  inputMode="decimal"
                  value={amount}
                  aria-invalid={!!amountError}
                  aria-describedby={
                    amountError ? "native-amount-error" : undefined
                  }
                  onChange={(e) => setAmount(e.target.value)}
                />
              </label>
              {amountError && (
                <p
                  role="alert"
                  id="native-amount-error"
                  className="native-error"
                >
                  {amountError}
                </p>
              )}
              {data.positions.map((p) => {
                const s = p.position,
                  idle = s?.stage === "idle",
                  pending = s?.owner_pending !== "0" || s?.game_pending !== "0";
                return (
                  <article
                    className="native-quest native-position"
                    key={p.account_id}
                  >
                    <h3>
                      {p.pool.split(".")[0]} · {p.contribution_bps / 100}% to
                      the game
                    </h3>
                    <a
                      href={`https://testnet.nearblocks.io/address/${p.account_id}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Inspect your keyless position
                    </a>
                    {!s ? (
                      <p>
                        {p.state === "created"
                          ? "Created; treasury registration needs a retry."
                          : p.state === "failed"
                            ? "Creation failed. Your setup refund is available below."
                            : "Creation or registration is pending. Refresh to check again."}
                      </p>
                    ) : (
                      <>
                        <dl>
                          <div>
                            <dt>Observed staked balance</dt>
                            <dd>{value(s.staked)} test NEAR</dd>
                          </div>
                          <div>
                            <dt>Your liquid withdrawal</dt>
                            <dd>{value(s.owner_credit)} test NEAR</dd>
                          </div>
                          <div>
                            <dt>Confirmed game yield</dt>
                            <dd>{value(s.game_credit)} test NEAR</dd>
                          </div>
                          <div>
                            <dt>Status</dt>
                            <dd>{String(s.stage).replaceAll("_", " ")}</dd>
                          </div>
                        </dl>
                        {s.stage === "unlocking" && (
                          <p>
                            Waiting for epoch {String(s.unlock_epoch)} or later.
                            The last observation is epoch {String(s.epoch)}. A
                            later request cannot reset this batch.
                          </p>
                        )}
                        {!!s.exit_requested && (
                          <p>
                            Your full exit is requested. Its stake no longer
                            counts toward native tiers.
                          </p>
                        )}
                        <div className="native-expedition-actions">
                          <button
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
                            <ArrowUp size={20} />
                            Stake test NEAR
                          </button>
                          <button
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
                          <button
                            disabled={
                              busy || !idle || pending || s.owner_credit === "0"
                            }
                            onClick={() =>
                              void run({
                                action: "withdraw",
                                vaultId: p.account_id,
                              })
                            }
                          >
                            <ArrowDown size={20} />
                            Withdraw ready funds
                          </button>
                          <button
                            disabled={
                              busy ||
                              (!idle &&
                                !["unlocking", "awaiting_cash"].includes(
                                  String(s.stage),
                                ))
                            }
                            onClick={() =>
                              void run({
                                action: idle ? "refresh" : "advance",
                                vaultId: p.account_id,
                              })
                            }
                          >
                            Update from pool
                          </button>
                        </div>
                      </>
                    )}
                    {p.state === "created" && (
                      <button
                        disabled={busy}
                        onClick={() =>
                          void run({
                            action: "register",
                            vaultId: p.account_id,
                            positionId: p.id,
                          })
                        }
                      >
                        Retry registration
                      </button>
                    )}
                  </article>
                );
              })}
            </>
          )}
          {data.refund && data.refund.available !== "0" && (
            <button
              disabled={busy || data.refund.pending !== "0"}
              onClick={() => void run({ action: "refund" })}
            >
              Withdraw setup refund · {value(data.refund.available)} test NEAR
            </button>
          )}
          <p className="native-secondary">
            Only realized, received game yield funds rewards. Principal and your
            retained yield are separate. Higher-tier access matures after a
            complete subsequent epoch; this pilot conservatively counts mature
            principal and may require a fresh pool update.
          </p>
        </>
      )}
    </section>
  );
}
