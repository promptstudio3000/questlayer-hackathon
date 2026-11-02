// Mints player badges on the soulbound questlayer_badges contract.
//
// The minter is a function-call access key on the badge contract's own
// account (methods create_badge and claim only), installed on the VPS as
// <state dir>/badges-minter.json by scripts/install-badges-minter-vps.sh.
// Gas and storage come from the contract account; the game sponsors player
// badges on testnet. Every claim still carries an Ed25519 signature from the
// game's award signer, so even a leaked minter key cannot mint a badge to an
// account the server did not check.
import { existsSync } from "node:fs";
import { loadServiceAccount } from "../relayer/key-transport.mjs";

const GAS = 60n * 10n ** 12n;
export const CLAIM_TTL_MS = 10 * 60_000;

export function claimMessage(contractId, badgeId, accountId, expiresAtMs) {
  const network = contractId.endsWith(".testnet") ? "testnet" : "mainnet";
  return `QuestLayer badge claim v1\nContract: ${contractId}\nNetwork: ${network}\nBadge: ${badgeId}\nAccount: ${accountId}\nExpires: ${expiresAtMs}`;
}

const failureText = (r) => {
  const failures = [r?.status, ...(r?.receipts_outcome || []).map((x) => x.outcome?.status)].filter(
    (s) => s && typeof s === "object" && "Failure" in s,
  );
  return failures.length ? JSON.stringify(failures[0].Failure) : null;
};

/** Contract args for one badge row (server/badges/service.mjs). */
export function createArgs(row) {
  const kind =
    row.kind === "quest"
      ? { Quest: { quest_ref: row.quest_ref } }
      : row.kind === "place"
        ? { Place: { lat_e6: Math.round(row.lat * 1e6), lng_e6: Math.round(row.lng * 1e6), radius_m: row.radius_m } }
        : "Event";
  return {
    badge_id: row.id,
    creator_id: row.creator_account,
    input: {
      title: row.title,
      description: row.description,
      icon: row.icon,
      color: row.color,
      kind,
      max_supply: row.max_supply,
      starts_at_ms: row.starts_at ? String(row.starts_at) : null,
      ends_at_ms: row.ends_at ? String(row.ends_at) : null,
    },
  };
}

export function createBadgeChain({ provider, contractId, signer, keyPath, now = Date.now, log = console }) {
  const state = { contractId, ready: false, account: null, error: null };
  async function connect() {
    if (!contractId || !signer || !keyPath || !existsSync(keyPath)) {
      state.error = !contractId ? "no contract" : !signer ? "no award signer" : "no minter key";
      return state;
    }
    try {
      const service = await loadServiceAccount(provider, keyPath, { expectAccountId: contractId, requireFullAccess: false });
      const config = await view("get_config");
      if (config.claim_signer !== signer.publicKey) throw new Error("the contract's claim signer is not this server's award signer");
      state.account = service.account;
      state.ready = true;
      state.error = null;
    } catch (e) {
      state.error = String(e?.message || e).slice(0, 200);
      log.warn?.(JSON.stringify({ badges: "minter unavailable", error: state.error }));
    }
    return state;
  }
  async function view(method, args = {}) {
    const r = await provider.query({
      request_type: "call_function",
      account_id: contractId,
      method_name: method,
      args_base64: Buffer.from(JSON.stringify(args)).toString("base64"),
      finality: "optimistic",
    });
    return JSON.parse(Buffer.from(r.result).toString());
  }
  async function call(methodName, args) {
    const r = await state.account.callFunctionRaw({ contractId, methodName, args, deposit: 0n, gas: GAS, waitUntil: "FINAL" });
    const tx = r?.transaction?.hash || r?.transaction_outcome?.id || null;
    const failure = failureText(r);
    if (failure) {
      const e = new Error(failure);
      e.tx = tx;
      throw e;
    }
    return tx;
  }
  function signClaim(badgeId, accountId) {
    const expires = now() + CLAIM_TTL_MS;
    return {
      badge_id: badgeId,
      account_id: accountId,
      expires_at_ms: String(expires),
      signature: signer.sign(claimMessage(contractId, badgeId, accountId, expires)),
    };
  }
  return {
    get contractId() {
      return state.contractId;
    },
    get ready() {
      return state.ready;
    },
    get error() {
      return state.error;
    },
    connect,
    view,
    signClaim,
    async createBadge(row) {
      return call("create_badge", createArgs(row));
    },
    async claim(badgeId, accountId) {
      return call("claim", signClaim(badgeId, accountId));
    },
  };
}

/** One pass over the queue: create queued designs, then mint queued claims. */
export async function runBadgeQueue(service, chain, { maxCreates = 3, maxClaims = 10 } = {}) {
  const done = { created: 0, minted: 0, failed: 0 };
  if (!chain?.ready) return done;
  for (const row of service.pendingCreations(maxCreates)) {
    try {
      service.markCreated(row.id, await chain.createBadge(row));
      done.created++;
    } catch (e) {
      const text = String(e?.message || e);
      // A lost response after success: the id is ours if the creator matches.
      if (/already taken/i.test(text)) {
        const onChain = await chain.view("get_badge", { badge_id: row.id }).catch(() => null);
        if (onChain?.creator_id === row.creator_account) {
          service.markCreated(row.id, e.tx || null);
          done.created++;
          continue;
        }
      }
      service.markCreateFailed(row.id, text);
      done.failed++;
    }
  }
  for (const c of service.pendingClaims(maxClaims)) {
    try {
      const tx = await chain.claim(c.badge_id, c.account_id);
      const serial = await chain.view("has_badge", { badge_id: c.badge_id, account_id: c.account_id }).catch(() => null);
      service.markMinted(c.badge_id, c.player_id, tx, serial ? `${c.badge_id}:${serial}` : null);
      done.minted++;
    } catch (e) {
      const text = String(e?.message || e);
      if (/Already holds this badge/i.test(text)) {
        const serial = await chain.view("has_badge", { badge_id: c.badge_id, account_id: c.account_id }).catch(() => null);
        service.markMinted(c.badge_id, c.player_id, e.tx || null, serial ? `${c.badge_id}:${serial}` : null);
        done.minted++;
        continue;
      }
      const final = /All badges are given out|Badge has ended|not accepting holders/i.test(text);
      service.markClaimFailed(c.badge_id, c.player_id, text, final);
      done.failed++;
    }
  }
  return done;
}

/** Background worker: reconnects lazily and drains the queue every interval. */
export function startBadgeWorker(service, chain, { intervalMs = 15_000, log = console } = {}) {
  let stopped = false,
    timer = null,
    lastConnect = 0;
  async function tick() {
    if (stopped) return;
    try {
      if (!chain.ready && Date.now() - lastConnect > 5 * 60_000) {
        lastConnect = Date.now();
        await chain.connect();
      }
      const r = await runBadgeQueue(service, chain);
      if (r.created || r.minted || r.failed) log.info?.(JSON.stringify({ badges: r }));
    } catch (e) {
      log.warn?.(JSON.stringify({ badges: "queue error", error: String(e?.message || e).slice(0, 200) }));
    }
    if (!stopped) {
      timer = setTimeout(tick, intervalMs);
      timer.unref?.();
    }
  }
  timer = setTimeout(tick, 2_000);
  timer.unref?.();
  return {
    stop() {
      stopped = true;
      clearTimeout(timer);
    },
  };
}
