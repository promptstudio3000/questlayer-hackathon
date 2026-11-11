import { readFileSync, statSync } from "node:fs";
import { Account, KeyPairSigner } from "near-api-js";
import { atomic } from "../database.mjs";
import { assert, id, hash } from "../domain.mjs";
import { publishNativeDays } from "./day-publication.mjs";
import { auditDistribution } from "./distribution.mjs";
import {
  nativePublicationMatches,
  storedNativeManifest,
  rewardMessage,
} from "./reward-manifest.mjs";
import { assertTestnetRpc } from "../identity/near.mjs";
import { NativeContractReader } from "./reader.mjs";
import { VAULT_POOLS } from "./vaults.mjs";
import { NETWORK } from "./network.mjs";
import {
  nativeDayContract,
  onContractSql,
  quarantineForeignDay,
  recordCurrentDay,
} from "./day-contracts.mjs";
import {
  MAP_CHAIN_METHODS,
  mapChainEnabled,
  runMapChainWorker,
} from "../map-rewards/chain.mjs";
import { PAYOUT_CHAIN_METHODS } from "../payouts/payout-tree.mjs";
import { payoutRoundMs, payoutsEnabled, runPayoutWorker } from "../payouts/worker.mjs";
import { WORLD_CHAIN_METHODS,runConfiguredGlobalRewards } from '../global-reward-worker.mjs';
const METHODS = ["publish_day", "close_day", "claim", "maintain_vault"];
// The key is the native set alone, the native set plus the map-day methods
// (contracts/rewards map_days.rs), or both plus the daily payout methods
// (payouts.rs); nothing else.
export function allowedWorkerMethods(names) {
  if (!Array.isArray(names) || new Set(names).size !== names.length) return null;
  const withMap = [...METHODS, ...MAP_CHAIN_METHODS];
  const withPayouts = [...withMap, ...PAYOUT_CHAIN_METHODS];
  const withWorld=[...withPayouts,...WORLD_CHAIN_METHODS];
  for (const set of [METHODS, withMap, withPayouts,withWorld])
    if (names.length === set.length && names.every((m) => set.includes(m)))
      return set;
  return null;
}
export async function rewardTransport(
  provider,
  contractId,
  keyPath,
  expectedCodeHash,
) {
  assert(
    (statSync(keyPath).mode & 0o077) === 0,
    "Worker key permissions must be private.",
    503,
  );
  const config = JSON.parse(readFileSync(keyPath));
  assert(
    config.network === NETWORK && config.accountId === contractId,
    "Wrong worker identity.",
    503,
  );
  await assertTestnetRpc(provider);
  const code = await provider.query({
    request_type: "view_account",
    account_id: contractId,
    finality: "final",
  });
  assert(
    typeof expectedCodeHash === "string" && code.code_hash === expectedCodeHash,
    "Native reward bytecode differs from the reviewed deployment.",
    503,
  );
  const signer = KeyPairSigner.fromSecretKey(config.secretKey);
  const publicKey = (await signer.getPublicKey()).toString();
  const access = await provider.query({
    request_type: "view_access_key",
    account_id: contractId,
    public_key: publicKey,
    finality: "final",
  });
  const p = access.permission?.FunctionCall;
  const allowed = allowedWorkerMethods(p?.method_names);
  assert(
    p &&
      p.receiver_id === contractId &&
      p.allowance !== null &&
      BigInt(p.allowance) <= 10n ** 24n &&
      allowed,
    "Worker key must have only bounded reward methods.",
    503,
  );
  const account = new Account(contractId, provider, signer);
  const send = async (method, args) => {
    assert(allowed.includes(method), "Unsupported worker method.");
    const result = await account.callFunctionRaw({
      contractId,
      methodName: method,
      args,
      gas: 280n * 10n ** 12n,
      deposit: 0n,
      waitUntil: "FINAL",
    });
    assert(
      !result.status?.Failure,
      "The native worker transaction failed.",
      503,
    );
    return result.transaction?.hash || result.transaction_outcome?.id;
  };
  send.mapDays = allowed.length > METHODS.length;
  send.payouts = allowed.includes('claim_payout');
  send.worldDays = allowed.includes('reserve_world_day');
  return send;
}
export async function runRewardWorker(
  native,
  send,
  { clock = Date.now, maxClaims = 8 } = {},
) {
  const db = native.db,
    owner = id("native-lease"),
    now = clock();
  const acquired = atomic(
    db,
    () =>
      db
        .prepare(
          "UPDATE native_worker_lease SET owner=?,until_ms=? WHERE id=1 AND until_ms<=?",
        )
        .run(owner, now + 120000, now).changes === 1,
  );
  if (!acquired) return { busy: true };
  const renew = () => {
    assert(
      db
        .prepare(
          "UPDATE native_worker_lease SET until_ms=? WHERE id=1 AND owner=? AND until_ms>?",
        )
        .run(clock() + 120000, owner, clock()).changes === 1,
      "Native worker lease expired.",
      503,
    );
  };
  const writeOwned = (sql, ...parameters) =>
    atomic(db, () => {
      renew();
      return db.prepare(sql).run(...parameters);
    });
  // RPC completion does not prove this process still owns the durable work.
  // Fence both sides of a send; a lost response is reconciled by the next owner
  // from the contract receipt/state, never by a stale worker rewriting its result.
  const sendOwned = async (method, args) => {
    renew();
    const result = await send(method, args);
    renew();
    return result;
  };
  let completed = 0;
  try {
    const configuration = await native.view("get_config", {}, true);
    renew();
    assert(
      configuration.attestor === native.signer.publicKey &&
        configuration.publisher === native.contractId,
      "Native worker identity prevents settlement and maintenance.",
      503,
    );
    let settlementError = null;
    try {
      assert(
        configuration.paused === false,
        "Native reward publication and claims are paused.",
        503,
      );
      // Reconcile the oldest durable acceptance first; a failed older receipt blocks
      // later claims, retaining deterministic first-valid-winner order.
      for (let n = 0; n < maxClaims; n++) {
        const row = db
          .prepare(
            "SELECT * FROM native_reward_claims WHERE state!='confirmed' ORDER BY seq LIMIT 1",
          )
          .get();
        if (!row || row.run_after > clock()) break;
        renew();
        const claim = JSON.parse(row.body);
        let receipt = await native.view(
            "get_receipt",
            { receipt_id: row.id },
            true,
          ),
          tx = row.transaction_hash;
        try {
          if (!receipt) {
            tx = await sendOwned("claim", { claim, signature: row.signature });
            writeOwned(
              "UPDATE native_reward_claims SET transaction_hash=? WHERE id=?",
              tx,
              row.id,
            );
            receipt = await native.view(
              "get_receipt",
              { receipt_id: row.id },
              true,
            );
          }
          assert(
            receipt?.receiver_id === row.account_id &&
              receipt.message_hash ===
                hash(rewardMessage(native.contractId, claim)),
            "Native receipt does not match accepted evidence.",
            503,
          );
          writeOwned(
            "UPDATE native_reward_claims SET state='confirmed',amount=?,xp=?,confirmed_at=?,transaction_hash=?,last_error=NULL WHERE id=?",
            receipt.amount,
            receipt.xp,
            clock(),
            tx,
            row.id,
          );
          completed++;
        } catch (error) {
          writeOwned(
            "UPDATE native_reward_claims SET state='retrying',attempts=attempts+1,run_after=?,last_error=? WHERE id=?",
            clock() + Math.min(300000, 5000 * 2 ** Math.min(row.attempts, 6)),
            String(error.message).slice(0, 200),
            row.id,
          );
          throw error;
        }
      }
      // Retire only after every accepted receipt for that day is authoritative.
      // Days of another rewards contract (an older generation) are quarantined
      // and skipped, so they never stop the audit or publication. A failing day
      // of this contract does not stop the other closures or the audit, but it
      // still withholds new publication: the chain then differs from what we
      // committed, which is a reason to stop, not to carry on.
      let retireError = null;
      const contractId = native.contractId;
      const onContract = onContractSql(db);
      for (const row of db
        .prepare(
          `SELECT * FROM native_days d WHERE state='published'${onContract} ORDER BY day LIMIT 10`,
        )
        .all(...(onContract ? [contractId] : []))) {
        try {
          const m = storedNativeManifest(row);
          if (
            clock() < m.endsAt + 86400000 ||
            db
              .prepare(
                "SELECT 1 FROM native_reward_claims WHERE day_id=? AND state!='confirmed'",
              )
              .get(row.id)
          )
            continue;
          renew();
          let day = await native.view("get_day", { day_id: row.id }, true);
          const owner = nativeDayContract(db, row.id);
          if (!owner) {
            // Legacy row with no recorded contract: a published day that the
            // current contract does not know was published on an older one.
            if (!day) {
              quarantineForeignDay(
                writeOwned,
                row.id,
                `Published day is absent from ${contractId}; it belongs to an earlier rewards contract.`,
                clock(),
              );
              continue;
            }
            recordCurrentDay(writeOwned, row.id, contractId, clock());
          }
          assert(
            nativePublicationMatches(m, day, { closed: day?.closed === true }),
            "Native day differs from the durable manifest before closure.",
            503,
          );
          if (!day?.closed) await sendOwned("close_day", { day_id: row.id });
          day = await native.view("get_day", { day_id: row.id }, true);
          assert(
            nativePublicationMatches(m, day, { closed: true }),
            "Day closure has not confirmed against its original publication.",
            503,
          );
          writeOwned(
            "UPDATE native_days SET state='closed',updated_at=? WHERE id=?",
            clock(),
            row.id,
          );
        } catch (error) {
          if (/lease expired/i.test(String(error.message))) throw error;
          retireError ||= new Error(
            `${String(error.message).slice(0, 160)} (day ${row.id})`,
          );
          retireError.status ||= error.status;
        }
      }
      // Settled claims and closures first; then prove the treasury still adds
      // up before reserving anything new. Drift stops publication only.
      const audit = await auditDistribution(native, { clock });
      native.lastAudit = audit;
      renew();
      // The audit result is stored either way; the day's own error is the
      // more specific report.
      if (retireError) throw retireError;
      assert(
        audit.status !== "drift",
        `Distribution audit found drift (${(audit.failed || []).join(", ")}); new days are not published.`,
        503,
      );
      await publishNativeDays(native, { clock, renew, writeOwned, sendOwned });
    } catch (error) {
      settlementError = error;
    }
    // Keepers have no beneficiary methods. A busy/failing vault cannot block
    // funded claims, and paused/failed claims cannot block an existing exit.
    // Preserve the settlement error and receipt order after maintenance finishes.
    try {
      for (const v of await native.vaultList()) {
        const job = db
          .prepare("SELECT * FROM native_vault_jobs WHERE account_id=?")
          .get(v.accountId);
        if (job?.next_check > clock()) continue;
        renew();
        try {
          const code = await native.provider.query({
            request_type: "view_account",
            account_id: v.accountId,
            finality: "final",
          });
          assert(
            typeof v.codeHash === "string" && code.code_hash === v.codeHash,
            "Vault bytecode changed; maintenance is paused.",
            503,
          );
          if (
            !(native.config.vaults || []).some(
              (p) => p.accountId === v.accountId,
            )
          ) {
            const keys = await native.provider.query({
              request_type: "view_access_key_list",
              account_id: v.accountId,
              finality: "final",
            });
            assert(
              Array.isArray(keys.keys) && keys.keys.length === 0,
              "Vault keyless ownership changed; maintenance is paused.",
              503,
            );
          }
          const reader = new NativeContractReader(native.provider, v.accountId);
          let state = await reader.view("get_state", {}, true),
            action = null;
          assert(
            state.beneficiary === v.beneficiary &&
              state.rewards === native.contractId &&
              VAULT_POOLS.some((p) => p.id === state.pool) &&
              (!v.pool || state.pool === v.pool),
            "Vault configuration mismatch.",
            503,
          );
          if (
            state.stage === "awaiting_cash" ||
            (state.stage === "unlocking" &&
              BigInt(state.epoch) >= BigInt(state.unlock_epoch))
          )
            action = "advance";
          if (
            state.stage === "idle" &&
            state.owner_pending === "0" &&
            state.game_pending === "0"
          ) {
            if (BigInt(state.game_credit) > 0n) action = "flush_game";
            else if (state.exit_requested) action = "advance";
            else if (BigInt(state.principal) > 0n) {
              // v3 vaults harvest only a fee of at least `min_harvest` and
              // only after their cooldown; older states carry neither field.
              const gain =
                BigInt(state.staked) +
                BigInt(state.unstaked) -
                BigInt(state.high_water_basis);
              const fee =
                (gain * BigInt(state.contribution_bps)) / 10000n;
              const worthIt =
                gain > 10n ** 18n &&
                state.contribution_bps > 0 &&
                fee >= BigInt(state.min_harvest ?? "0") &&
                BigInt(state.epoch) >= BigInt(state.next_harvest_epoch ?? "0");
              action = worthIt ? "harvest" : "refresh";
            }
          }
          if (action) {
            const transactionHash = await sendOwned("maintain_vault", {
              vault_id: v.accountId,
              action,
            });
            state = await reader.view("get_state", {}, true);
            // One line per maintenance call so yield-cycle steps stay auditable.
            console.log(
              JSON.stringify({
                event: "vault-maintenance",
                vault: v.accountId,
                action,
                transactionHash,
                stage: state.stage,
                gameCredit: state.game_credit,
                gamePaid: state.game_paid,
                at: new Date(clock()).toISOString(),
              }),
            );
          }
          writeOwned(
            "INSERT INTO native_vault_jobs VALUES(?,?,?,?,NULL) ON CONFLICT(account_id) DO UPDATE SET next_check=excluded.next_check,last_action=excluded.last_action,last_state=excluded.last_state,last_error=NULL",
            v.accountId,
            clock() + (state.stage === "awaiting_cash" ? 30000 : 30 * 60000),
            action,
            JSON.stringify(state),
          );
        } catch (error) {
          writeOwned(
            "INSERT INTO native_vault_jobs(account_id,next_check,last_error) VALUES(?,?,?) ON CONFLICT(account_id) DO UPDATE SET next_check=excluded.next_check,last_error=excluded.last_error",
            v.accountId,
            clock() + 300000,
            String(error.message).slice(0, 200),
          );
        }
      }
    } catch (error) {
      settlementError ||= error;
    }
    writeOwned(
      "DELETE FROM native_locations WHERE received_at<?",
      clock() - 86400000,
    );
    if (settlementError) throw settlementError;
    writeOwned(
      "UPDATE native_worker_lease SET last_success=?,last_error=NULL WHERE id=1 AND owner=?",
      clock(),
      owner,
    );
    return { completed };
  } catch (error) {
    db.prepare(
      "UPDATE native_worker_lease SET last_error=? WHERE id=1 AND owner=?",
    ).run(String(error.message).slice(0, 200), owner);
    throw error;
  } finally {
    db.prepare(
      "UPDATE native_worker_lease SET until_ms=0,owner=NULL WHERE id=1 AND owner=?",
    ).run(owner);
  }
}
export function startRewardWorker(
  native,
  { keyPath, intervalMs = 30000, qgoldRate = null } = {},
) {
  let stopped = false,
    running = null,
    send = null,
    timer;
  async function tick() {
    if (stopped || running) return;
    const startedAt = Date.now();
    running = (async () => {
      let enteredWorker = false;
      try {
        send ||= await rewardTransport(
          native.provider,
          native.contractId,
          keyPath,
          native.config.codeHash,
        );
        enteredWorker = true;
        await runRewardWorker(native, send).catch(error=>console.error('Native settlement:',String(error.message).slice(0,200)));
        await runConfiguredGlobalRewards(native,send).catch(error=>console.error('Global reward worker:',String(error.message).slice(0,300)));
        // Map days ride on the same key once it allows the map methods.
        // With nightly payouts on, map coins are paid only through them
        // (one leaf per account per day), so claim_map is not sent.
        const payouts = payoutsEnabled() && send.payouts;
        if (mapChainEnabled() && send.mapDays)
          await runMapChainWorker(native.db, {
            call: send,
            view: (method, args) => native.view(method, args, true),
            signer: native.signer,
            contractId: native.contractId,
            qgoldRate,
            budgetOnly: payouts,
          }).catch((error) =>
            console.error("Map chain worker:", String(error.message).slice(0, 200)),
          );
        if (payouts)
          await runPayoutWorker(native.db, {
            call: send,
            view: (method, args) => native.view(method, args, true),
            roundMs: payoutRoundMs(),
          }).catch((error) =>
            console.error("Payout worker:", String(error.message).slice(0, 200)),
          );
      } catch (error) {
        console.error(
          "Native reward worker:",
          String(error.message).slice(0, 200),
        );
        // runRewardWorker records errors only under its own lease. An older
        // process must not overwrite the health of a successor after a late RPC.
        if (!enteredWorker)
          native.db
            .prepare(
              "UPDATE native_worker_lease SET last_error=? WHERE id=1 AND until_ms<=? AND (last_success IS NULL OR last_success<?)",
            )
            .run(String(error.message).slice(0, 200), Date.now(), startedAt);
      }
    })();
    await running;
    running = null;
  }
  timer = setInterval(tick, intervalMs);
  timer.unref();
  void tick();
  return {
    stop: async () => {
      stopped = true;
      clearInterval(timer);
      await running;
    },
  };
}
