// Shared fake chain for relayer tests: no network, deterministic clock.
import {
  KeyPair,
  KeyPairSigner,
  PublicKey,
  actions,
  buildDelegateAction,
  encodeSignedDelegate,
} from "near-api-js";
import { openDatabase, createPlayer } from "../server/database.mjs";
import { ManagedAccounts } from "../server/relayer/accounts.mjs";
import { Relayer } from "../server/relayer/relay.mjs";

export const NOW = Date.parse("2026-11-01T09:00:00Z");
export const FACTORY = "players.questlayer.testnet",
  RELAYER = "relayer.questlayer.testnet",
  CONTRACTS = {
    collectibles: "nfts.auratrail-dev-20261030.testnet",
    market: "questlayer-market-20261031.testnet",
    rewards: "questlayer-rewards-20261031.testnet",
    social: "v1.social08.testnet",
  };
export const NEAR = 10n ** 24n;
export const encode = (value) =>
  Buffer.from(JSON.stringify(value)).toString("base64");

export function chain() {
  const accounts = new Map();
  const state = {
    accounts,
    height: 5000,
    add(id, { amount = NEAR, keys = [] } = {}) {
      accounts.set(id, {
        amount: BigInt(amount),
        keys: new Map(
          keys.map(([pk, nonce = 0, permission = "FullAccess"]) => [
            pk,
            { nonce, permission },
          ]),
        ),
      });
      return accounts.get(id);
    },
  };
  state.provider = {
    async query(q) {
      const a = accounts.get(q.account_id);
      if (q.request_type === "view_account") {
        if (!a)
          throw Error(`account ${q.account_id} does not exist while viewing`);
        return {
          amount: a.amount.toString(),
          code_hash: "11111111111111111111111111111111",
          block_height: state.height,
        };
      }
      if (q.request_type === "view_access_key") {
        const key = a?.keys.get(q.public_key);
        if (!key)
          throw Error(
            `access key ${q.public_key} does not exist while viewing`,
          );
        return {
          nonce: key.nonce,
          permission: key.permission,
          block_height: state.height,
        };
      }
      throw Error(`unsupported ${q.request_type}`);
    },
    async viewBlock() {
      return { header: { height: state.height, hash: "B".repeat(44) } };
    },
  };
  return state;
}
// A factory that creates sub-accounts and transfers on the fake chain.
export function fakeFactory(state, { fail = null } = {}) {
  const calls = [];
  let n = 0;
  return {
    accountId: FACTORY,
    calls,
    async signAndSendTransaction({ receiverId, actions: list }) {
      calls.push({ receiverId, actions: list });
      const hash = `F${++n}`;
      const failure = fail?.(receiverId, list, calls.length);
      if (failure instanceof Error) throw failure;
      const ok = {
        final_execution_status: "FINAL",
        transaction: { hash, signer_id: FACTORY, receiver_id: receiverId },
        status: failure ? { Failure: failure } : { SuccessValue: "" },
        transaction_outcome: {
          outcome: { executor_id: FACTORY, status: { SuccessReceiptId: "R" } },
        },
        receipts_outcome: [
          {
            outcome: {
              executor_id: receiverId,
              status: failure ? { Failure: failure } : { SuccessValue: "" },
            },
          },
        ],
      };
      if (failure) return ok;
      for (const action of list) {
        if (action.createAccount) state.add(receiverId, { amount: 0n });
        if (action.transfer)
          state.accounts.get(receiverId).amount += BigInt(
            action.transfer.deposit,
          );
        if (action.addKey)
          state.accounts
            .get(receiverId)
            .keys.set(action.addKey.publicKey.toString(), {
              nonce: 0,
              permission: "FullAccess",
            });
      }
      return ok;
    },
  };
}
// Builds the RPC view of a relayed meta-transaction from the decoded delegate.
export function outcomeFor(
  signedDelegate,
  { hash = "T1", failure = null, relayer = RELAYER, successValue, owner } = {},
) {
  const d = signedDelegate.delegateAction,
    [action] = d.actions;
  let view;
  if (action.functionCall)
    view = {
      FunctionCall: {
        method_name: action.functionCall.methodName,
        args: Buffer.from(action.functionCall.args).toString("base64"),
        gas: Number(action.functionCall.gas),
        deposit: action.functionCall.deposit.toString(),
      },
    };
  else if (action.addKey)
    view = {
      AddKey: {
        public_key: keyString(action.addKey.publicKey),
        access_key: { nonce: 0, permission: "FullAccess" },
      },
    };
  else
    view = { DeleteKey: { public_key: keyString(action.deleteKey.publicKey) } };
  const method = action.functionCall?.methodName;
  const value =
    successValue ??
    (method === "mint_avatar"
      ? encode({
          token_id: `avatar:${d.senderId}`,
          owner_id: owner ?? d.senderId,
        })
      : method === "redeem_aura"
        ? encode({ token_id: "aura:polar:7", owner_id: owner ?? d.senderId })
        : method === "buy" || method === "withdraw"
          ? encode(true)
          : "");
  const status = failure ? { Failure: failure } : { SuccessValue: value };
  return {
    final_execution_status: "FINAL",
    transaction: {
      hash,
      signer_id: relayer,
      receiver_id: d.senderId,
      actions: [
        {
          Delegate: {
            delegate_action: {
              sender_id: d.senderId,
              receiver_id: d.receiverId,
              actions: [view],
              nonce: Number(d.nonce),
              max_block_height: Number(d.maxBlockHeight),
              public_key: keyString(d.publicKey),
            },
            signature: "ed25519:signature",
          },
        },
      ],
    },
    status,
    transaction_outcome: {
      block_hash: "B".repeat(44),
      outcome: {
        executor_id: relayer,
        status: { SuccessReceiptId: "R".repeat(44) },
      },
    },
    receipts_outcome: [
      {
        block_hash: "B".repeat(44),
        outcome: {
          executor_id: d.senderId,
          status: failure
            ? { Failure: failure }
            : { SuccessReceiptId: "S".repeat(44) },
        },
      },
      {
        block_hash: "B".repeat(44),
        outcome: {
          executor_id: d.receiverId,
          status: failure ? { Failure: failure } : { SuccessValue: value },
        },
      },
    ],
  };
}
function keyString(value) {
  return PublicKey.from(value).toString();
}
export function fakeTransport(state) {
  let n = 0;
  const transport = {
    accountId: RELAYER,
    publicKey: "ed25519:relayer",
    sends: [],
    onSend: null,
    onStatus: async () => {
      throw Error("UNKNOWN_TRANSACTION");
    },
    async sign({ receiverId, actions: list }) {
      const hash = `T${++n}`;
      return {
        hash,
        send: async () => {
          const signedDelegate = list[0].signedDelegate;
          transport.sends.push({ hash, receiverId, signedDelegate });
          if (transport.onSend)
            return transport.onSend({ hash, receiverId, signedDelegate });
          const account = state.accounts.get(
            signedDelegate.delegateAction.senderId,
          );
          const key = account?.keys.get(
            keyString(signedDelegate.delegateAction.publicKey),
          );
          if (key) key.nonce = Number(signedDelegate.delegateAction.nonce);
          return outcomeFor(signedDelegate, { hash });
        },
      };
    },
    status: (hash) => transport.onStatus(hash),
  };
  return transport;
}
export function fixture({
  fundYocto = NEAR / 10n,
  topupCapYocto = NEAR / 5n,
  maxJobsPerDay = 40,
  factoryOptions,
} = {}) {
  const db = openDatabase(":memory:"),
    state = chain(),
    player = createPlayer(db, "Alice Nováková", NOW);
  let now = NOW;
  const clock = () => now;
  state.add(FACTORY, { amount: 100n * NEAR });
  const factory = fakeFactory(state, factoryOptions),
    transport = fakeTransport(state);
  const accounts = new ManagedAccounts(db, state.provider, factory, {
    factoryId: FACTORY,
    fundYocto,
    topupCapYocto,
    clock,
  });
  const relayer = new Relayer(db, state.provider, transport, {
    accounts,
    contracts: CONTRACTS,
    clock,
    blockTtl: 120,
    maxJobsPerDay,
  });
  return {
    db,
    state,
    player,
    factory,
    transport,
    accounts,
    relayer,
    clock,
    advance: (ms) => (now += ms),
    // A ready managed account with one active device key, as finalize() leaves it.
    ready(
      playerId = player,
      slug = "alice-novakova",
      { amount = NEAR / 10n, nonce = 100 } = {},
    ) {
      const device = KeyPair.fromRandom("ed25519"),
        publicKey = device.getPublicKey().toString(),
        accountId = `${slug}.${FACTORY}`;
      db.prepare(
        "INSERT INTO managed_accounts(account_id,player_id,slug,factory_id,network,state,funded_yocto,created_at,ready_at,updated_at) VALUES(?,?,?,?,'testnet','ready',?,?,?,?)",
      ).run(
        accountId,
        playerId,
        slug,
        FACTORY,
        fundYocto.toString(),
        NOW,
        NOW,
        NOW,
      );
      db.prepare(
        "INSERT INTO managed_account_keys VALUES(?,?,'device','active','first device',?,?)",
      ).run(accountId, publicKey, NOW, NOW);
      db.prepare("INSERT INTO wallet_links VALUES(?,?,?)").run(
        accountId,
        playerId,
        NOW,
      );
      state.add(accountId, { amount, keys: [[publicKey, nonce]] });
      return {
        accountId,
        device,
        publicKey,
        signer: new KeyPairSigner(device),
      };
    },
    async sign(
      acct,
      {
        receiverId = CONTRACTS.collectibles,
        action,
        nonce,
        maxBlockHeight,
      } = {},
    ) {
      const prepared = await relayer.prepare(acct.playerId ?? player, {
        accountId: acct.accountId,
      });
      const delegateAction = buildDelegateAction({
        senderId: acct.accountId,
        receiverId,
        actions: [
          action ??
            actions.functionCall(
              "mint_avatar",
              {},
              100_000_000_000_000n,
              50n * 10n ** 21n,
            ),
        ],
        nonce: nonce ?? BigInt(prepared.nonce),
        maxBlockHeight: maxBlockHeight ?? BigInt(prepared.maxBlockHeight),
        publicKey: await acct.signer.getPublicKey(),
      });
      const { signedDelegate } =
        await acct.signer.signDelegateAction(delegateAction);
      return Buffer.from(encodeSignedDelegate(signedDelegate)).toString(
        "base64",
      );
    },
    job: (id) => db.prepare("SELECT * FROM relay_jobs WHERE id=?").get(id),
    rows: (table) => db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all(),
  };
}
