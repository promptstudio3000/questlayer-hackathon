import "./style.css";
import {
  KeyPairSigner,
  PublicKey,
  JsonRpcProvider,
  actions,
  buildDelegateAction,
  decodeTransaction,
  encodeSignedDelegate,
} from "near-api-js";
import { actionView } from "./action-view.ts";
import {
  createDeviceKey,
  DEVICE_KEY,
  type PlayerKeyRecord,
} from "../player-key.ts";
import {
  setupPasskeyRecovery,
  nep413Proof,
  restoreWithPasskey,
  revokeAccountKey,
  signOutOtherSessions,
} from "../account-recovery.ts";
import {
  describeReview,
  needsProtection,
  reviewQuestion,
  trustedVaultMessage,
  validateVaultCall,
  validateVaultOrigins,
  type VaultAction,
  type VaultCall,
  type VaultConfig,
} from "./policy.ts";
import { localVaultKeyStore, vaultRecord, vaultRequests } from "./store.ts";
import { inboxKey, inboxOpen, inboxReveal, inboxSeal } from "./inbox.ts";
const config: VaultConfig = validateVaultOrigins(
  await (await fetch("/vault-config.json")).json(),
);
if (location.origin !== config.vaultOrigin)
  throw Error("Wrong signing origin.");
const store = localVaultKeyStore(),
  channel = new BroadcastChannel("questlayer-signing-vault-results");
type Request = { id: string; method: string; input: Record<string, unknown> };
type Pending = {
  request: Request;
  review: unknown;
  accountId: string | null;
  publicKey: string | null;
  createdAt: number;
  state: "waiting" | "executing" | "done";
  result?: unknown;
  error?: string;
};
const bytes = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const base64 = (b: Uint8Array) =>
  btoa(Array.from(b, (c) => String.fromCharCode(c)).join(""));
const publicRecord = (r: PlayerKeyRecord | null) =>
  r
    ? {
        publicKey: r.publicKey,
        accountId: r.accountId,
        origin: r.origin,
        createdAt: r.createdAt,
        secretKey: "",
        vaultId: config.vaultOrigin,
      }
    : null;
const need = (ok: unknown, message: string) => {
  if (!ok) throw Error(message);
};
async function api<T = Record<string, unknown>>(
  path: string,
  input?: unknown,
): Promise<T> {
  const response = await fetch(`${config.appOrigin}/api${path}`, {
    credentials: "include",
    method: input === undefined ? "GET" : "POST",
    ...(input === undefined
      ? {}
      : {
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(input),
        }),
  });
  const result = await response.json();
  if (!response.ok)
    throw Error(result.error ?? "The game could not verify this action.");
  return result;
}
function nearAction(a: VaultAction) {
  if (a.kind === "functionCall")
    return actions.functionCall(
      a.methodName,
      a.args,
      BigInt(a.gas),
      BigInt(a.deposit),
    );
  return a.kind === "addKey"
    ? actions.addFullAccessKey(PublicKey.fromString(a.publicKey))
    : actions.deleteKey(PublicKey.fromString(a.publicKey));
}
async function reviewed(request: Request, record: PlayerKeyRecord) {
  const i = request.input;
  if (
    [
      "setupRecovery",
      "restoreRecovery",
      "revokeKey",
      "revokeSessions",
    ].includes(request.method)
  )
    return {
      protected: true,
      review: {
        operation: request.method,
        account: record.accountId,
        ...(request.method === "revokeKey"
          ? { keyToRemove: String(i.target) }
          : {}),
      },
    };
  need(
    record.accountId && i.publicKey === record.publicKey,
    "The account key changed.",
  );
  if (request.method === "signMessage") {
    need(
      i.accountId === record.accountId &&
        typeof i.message === "string" &&
        i.message.length <= 16384 &&
        typeof i.recipient === "string" &&
        typeof i.nonce === "string" &&
        bytes(i.nonce).length === 32 &&
        !i.callbackUrl,
      "Invalid account authorization.",
    );
    return {
      protected: true,
      review: {
        account: record.accountId,
        recipient: i.recipient,
        authorization: i.message,
      },
    };
  }
  let call: VaultCall;
  if (request.method === "signTransaction") {
    need(
      typeof i.bytes === "string" && i.bytes.length <= 50000,
      "Invalid transaction.",
    );
    const tx = decodeTransaction(bytes(i.bytes as string));
    need(
      tx.publicKey.toString() === record.publicKey,
      "Wrong transaction key.",
    );
    call = {
      accountId: tx.signerId,
      receiverId: tx.receiverId,
      actions: tx.actions.map(actionView),
    };
  } else {
    need(request.method === "signDelegate", "Unsupported signing request.");
    call = i.call as VaultCall;
    need(
      typeof i.nonce === "string" &&
        /^[1-9][0-9]{0,19}$/.test(i.nonce) &&
        typeof i.maxBlockHeight === "string" &&
        /^[1-9][0-9]{0,19}$/.test(i.maxBlockHeight),
      "Invalid delegated transaction window.",
    );
  }
  validateVaultCall(call, record.accountId!);
  const protectedAction = await needsProtection(
    call,
    config,
    (memo) => api(`/gold/burn/intent?memo=${encodeURIComponent(memo)}`),
    record.publicKey,
  );
  return { protected: protectedAction, review: call };
}
async function execute(request: Request) {
  const record = await store.get(DEVICE_KEY),
    i = request.input;
  if (request.method === "restoreRecovery")
    return navigator.locks.request("vault-device-key", () =>
      restoreWithPasskey({
        store,
        credentials: navigator.credentials,
        rpId: location.hostname,
        api,
        userAgent: navigator.userAgent,
      }),
    );
  need(record?.accountId, "No secure account is bound on this device.");
  const key = record!,
    accountId = key.accountId!;
  // Only these already reviewed device actions can obtain a short management grant.
  async function deviceApi<T>(path: string, input?: unknown): Promise<T> {
    if (path === "/account/keys") {
      const challenge = await api<{
        challengeId: string;
        playerId: string;
        nonce: string;
        recipient: string;
        message: string;
      }>("/identity/management/challenge", { accountId });
      need(
        challenge.recipient === config.appOrigin &&
          /^player_[a-f0-9-]{36}$/.test(challenge.playerId) &&
          challenge.message ===
            `Authorize management of sign-in methods for explorer ${challenge.playerId} with ${accountId} on NEAR testnet for five minutes. No transaction or transfer.`,
        "The account authorization challenge does not match this device action.",
      );
      const proof = await nep413Proof(key, accountId, challenge);
      await api("/identity/management/verify", {
        challengeId: challenge.challengeId,
        ...proof,
      });
    }
    return api<T>(path, input);
  }
  if (request.method === "setupRecovery")
    return setupPasskeyRecovery({
      deviceKey: key,
      accountId,
      credentials: navigator.credentials,
      rpId: location.hostname,
      api: deviceApi,
    });
  if (request.method === "revokeKey")
    return revokeAccountKey({
      deviceKey: key,
      accountId,
      publicKey: String(i.target),
      api: deviceApi,
    });
  if (request.method === "revokeSessions")
    return signOutOtherSessions({ deviceKey: key, accountId, api });
  need(i.publicKey === key.publicKey, "The account key changed after review.");
  const signer = KeyPairSigner.fromSecretKey(
    key.secretKey as `ed25519:${string}`,
  );
  if (request.method === "signTransaction") {
    const tx = decodeTransaction(bytes(String(i.bytes)));
    const result = await signer.signTransaction(tx);
    return {
      signed: base64(result.signedTransaction.encode()),
      hash: base64(result.txHash),
    };
  }
  if (request.method === "signMessage") {
    const result = await signer.signNep413Message(accountId, {
      message: String(i.message),
      recipient: String(i.recipient),
      nonce: bytes(String(i.nonce)),
    });
    return {
      accountId,
      publicKey: key.publicKey,
      signature: base64(result.signature),
    };
  }
  const call = i.call as VaultCall;
  const da = buildDelegateAction({
    senderId: accountId,
    receiverId: call.receiverId,
    actions: call.actions.map(nearAction),
    nonce: BigInt(String(i.nonce)),
    maxBlockHeight: BigInt(String(i.maxBlockHeight)),
    publicKey: PublicKey.fromString(key.publicKey),
  });
  const result = await signer.signDelegateAction(da);
  return {
    signed: base64(encodeSignedDelegate(result.signedDelegate)),
    hash: base64(result.delegateHash),
  };
}
const INBOX_METHODS: Record<string, ((ctx: Parameters<typeof inboxKey>[0], input: Record<string, unknown>) => Promise<unknown>) | undefined> = {
  inboxKey: (ctx, input) => inboxKey(ctx, { rotate: input.rotate === true }),
  inboxSeal,
  inboxOpen,
  inboxReveal,
};
async function receive(request: Request) {
  const i = request.input;
  need(
    JSON.stringify(request).length <= 60000 && i && typeof i === "object",
    "Invalid secure account request.",
  );
  if (request.method === "read")
    return publicRecord(await store.get(DEVICE_KEY));
  if (request.method === "create")
    return navigator.locks.request("vault-device-key", async () =>
      publicRecord(await createDeviceKey(store)),
    );
  if (request.method === "bind") {
    const old = await store.get(DEVICE_KEY);
    need(
      old &&
        i.publicKey === old.publicKey &&
        typeof i.accountId === "string" &&
        (!old.accountId || old.accountId === i.accountId),
      "This key belongs to another account.",
    );
    const p = new JsonRpcProvider({ url: config.rpcUrl });
    const access = await p.query({
      request_type: "view_access_key",
      account_id: String(i.accountId),
      public_key: old!.publicKey,
      finality: "final",
    });
    need(
      access &&
        typeof access === "object" &&
        "permission" in access &&
        access.permission === "FullAccess",
      "The secure key has not been registered on this account.",
    );
    return navigator.locks.request("vault-device-key", async () => {
      const fresh = await store.get(DEVICE_KEY);
      need(
        fresh?.publicKey === old!.publicKey,
        "The key changed while binding the account.",
      );
      await store.put(DEVICE_KEY, { ...old!, accountId: String(i.accountId) });
      return publicRecord(await store.get(DEVICE_KEY));
    });
  }
  if (typeof request.method === "string" && Object.hasOwn(INBOX_METHODS, request.method)) {
    // Encryption only: nothing is signed or moved, so no approval window.
    const key = await store.get(DEVICE_KEY);
    need(key?.accountId, "No secure account is bound on this device.");
    need(config.contracts.social, "The inbox is not configured.");
    const provider = new JsonRpcProvider({ url: config.rpcUrl });
    return INBOX_METHODS[request.method]!(
      {
        accountId: key!.accountId!,
        socialContract: config.contracts.social!,
        view: async (args) => {
          const r = (await provider.query({
            request_type: "call_function",
            account_id: config.contracts.social!,
            method_name: "get",
            args_base64: base64(new TextEncoder().encode(JSON.stringify(args))),
            finality: "final",
          })) as unknown as { result: number[] };
          return JSON.parse(new TextDecoder().decode(Uint8Array.from(r.result)));
        },
      },
      i,
    );
  }
  const record = await store.get(DEVICE_KEY);
  const review =
    request.method === "restoreRecovery"
      ? {
          protected: true,
          review: { operation: "Restore this account with a passkey" },
        }
      : await reviewed(
          request,
          record ?? {
            publicKey: "",
            secretKey: "",
            accountId: null,
            origin: "device",
            createdAt: 0,
          },
        );
  if (!review.protected) return execute(request);
  return navigator.locks.request("vault-approval-queue", async () => {
    const existing = await vaultRecord<Pending>(`request:${request.id}`);
    need(
      !existing || JSON.stringify(existing.request) === JSON.stringify(request),
      "A pending account action changed.",
    );
    if (existing?.state === "done") {
      if (existing.error) throw Error(existing.error);
      return existing.result;
    }
    if (!existing) {
      let active = 0;
      for (const row of await vaultRequests<Pending>()) {
        if (row.state !== "executing" && Date.now() - row.createdAt > 180000)
          await vaultRecord(`request:${row.request.id}`, undefined, true);
        else active++;
      }
      need(
        active < 32,
        "Finish the existing secure account requests before starting another.",
      );
      await vaultRecord<Pending>(`request:${request.id}`, {
        request,
        review: review.review,
        accountId: record?.accountId ?? null,
        publicKey: record?.publicKey ?? null,
        createdAt: Date.now(),
        state: "waiting",
      });
    }
    return { awaitingApproval: true };
  });
}
if (location.pathname === "/approve") {
  need(
    window.top === window,
    "Account approvals must open in their own window.",
  );
  const id = new URL(location.href).searchParams.get("id") ?? "",
    pending = await vaultRecord<Pending>(`request:${id}`);
  const main = document.querySelector("#vault")!;
  const heading = document.createElement("h1");
  heading.textContent = "QuestLayer";
  main.append(heading);
  if (
    !pending ||
    pending.state !== "waiting" ||
    Date.now() - pending.createdAt > 180000
  ) {
    const p = document.createElement("p");
    p.textContent =
      "This request expired or is already complete. You can close this window.";
    main.append(p);
  } else {
    // One plain question with Yes / No. The decoded breakdown and the exact
    // request stay one tap away under "Details"; warnings stay visible.
    heading.textContent = reviewQuestion(pending.review, config);
    const intro = document.createElement("p");
    intro.textContent =
      "Nothing leaves your account unless you tap Yes. Tap No if you did not just do this in QuestLayer.";
    const review = document.createElement("section"),
      view = describeReview(pending.review, config);
    if (view.warnings.length) {
      const warnings = document.createElement("ul");
      warnings.className = "warnings";
      warnings.setAttribute("role", "alert");
      for (const warning of view.warnings) {
        const item = document.createElement("li");
        item.textContent = warning;
        warnings.append(item);
      }
      review.append(warnings);
    }
    const fields = document.createElement("dl");
    for (const [label, value] of view.lines) {
      const term = document.createElement("dt"),
        description = document.createElement("dd");
      term.textContent = label;
      description.textContent = value;
      fields.append(term, description);
    }
    const details = document.createElement("details"),
      summary = document.createElement("summary"),
      exact = document.createElement("pre");
    summary.textContent = "Details";
    exact.textContent = JSON.stringify(pending.review, null, 2);
    details.append(summary, fields, exact);
    review.append(details);
    const cancel = document.createElement("button"),
      approve = document.createElement("button"),
      status = document.createElement("p");
    cancel.textContent = "No";
    approve.textContent = "Yes";
    approve.className = "primary";
    status.setAttribute("role", "status");
    const controls = document.createElement("div");
    controls.className = "actions";
    controls.append(cancel, approve);
    main.append(intro, controls, review, status);
    cancel.focus();
    const finish = async (accepted: boolean) => {
      cancel.disabled = approve.disabled = true;
      const done: Pending = { ...pending, state: "done" };
      let claimed = false;
      try {
        await navigator.locks.request("vault-approval-queue", async () => {
          const fresh = await vaultRecord<Pending>(`request:${id}`);
          need(
            fresh?.state === "waiting" &&
              JSON.stringify(fresh.request) === JSON.stringify(pending.request),
            "This account action is already being handled.",
          );
          await vaultRecord(`request:${id}`, {
            ...pending,
            state: "executing",
          });
          claimed = true;
        });
        if (!accepted) throw Error("Account action cancelled.");
        need(
          Date.now() - pending.createdAt <= 180000,
          "Account action expired.",
        );
        done.result = await navigator.locks.request(
          "vault-account-approval",
          async () => {
            if (pending.request.method !== "restoreRecovery") {
              const current = await store.get(DEVICE_KEY);
              need(
                current?.accountId === pending.accountId &&
                  current?.publicKey === pending.publicKey,
                "The account changed after review. Start the action again.",
              );
            }
            return execute(pending.request);
          },
        );
      } catch (error) {
        if (!claimed) {
          status.textContent = (error as Error).message;
          return;
        }
        done.error = (error as Error).message;
      }
      await vaultRecord(`request:${id}`, done);
      channel.postMessage({ id });
      status.textContent = done.error ?? "Done. Back to QuestLayer…";
      if (!done.error) setTimeout(() => window.close(), 700);
    };
    cancel.onclick = () => void finish(false);
    approve.onclick = () => void finish(true);
    addEventListener("keydown", (e) => {
      if (e.key === "Escape" && !cancel.disabled) void finish(false);
    });
  }
} else {
  const reply = (id: string, body: Record<string, unknown>) =>
    parent.postMessage(
      { channel: "questlayer-signing-vault", id, ...body },
      config.appOrigin,
    );
  addEventListener("message", (event) => {
    if (
      window === parent ||
      !trustedVaultMessage(event, config.appOrigin, parent)
    )
      return;
    const request = event.data as Request;
    void receive(request).then(
      (result) =>
        reply(
          request.id,
          result && typeof result === "object" && "awaitingApproval" in result
            ? { approval: true }
            : { result },
        ),
      (error) => reply(request.id, { error: (error as Error).message }),
    );
  });
  channel.onmessage = async (event) => {
    const id = event.data?.id;
    if (typeof id !== "string") return;
    const pending = await vaultRecord<Pending>(`request:${id}`);
    if (pending?.state === "done")
      reply(id, { result: pending.result, error: pending.error });
  };
  parent.postMessage(
    { channel: "questlayer-signing-vault", ready: true },
    config.appOrigin,
  );
}
