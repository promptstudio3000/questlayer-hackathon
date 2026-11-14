import { useEffect, useState } from "react";
import {
  ArrowClockwise,
  CheckCircle,
  Clock,
  Coins,
  HandHeart,
  Heart,
  LockKeyOpen,
  WarningCircle,
} from "@phosphor-icons/react";
import { api, ApiError } from "./api";
import {
  type CreatorMoneySnapshot,
  type CreatorPaymentRequest,
  type CreatorQuestMoney,
} from "./creator-money-quote";
import { tr } from "./i18n";
import { parseQgoldAmount, qgoldOfNear, qgoldOfYocto } from "./qgold-display";
// Gifts typed in QGOLD: 10M to 100B (0.01 to 100 NEAR, the contract's bounds).
const parseGift = (text: string) => parseQgoldAmount(text, 10_000_000, 100_000_000_000);

/** What the app hands the creator screens so they can pay without owning a signer. */
export type CreatorMoneyBridge = {
  /** The account that signs: the invisible account when ready, else a linked one, else "". */
  accountId: string;
  /** True when the invisible account signs, so nothing pops up. */
  managed: boolean;
  pay: (
    request: CreatorPaymentRequest,
    expected: { contractId: string; price?: string },
  ) => Promise<boolean>;
};

type Outcome =
  | { kind: "idle" }
  | { kind: "pending"; text: string }
  | { kind: "done"; text: string }
  | { kind: "failed"; text: string };

const DONATIONS = ["0.05", "0.1", "0.5"];

function OutcomeLine({ outcome }: { outcome: Outcome }) {
  if (outcome.kind === "idle") return null;
  const Icon =
    outcome.kind === "pending"
      ? Clock
      : outcome.kind === "done"
        ? CheckCircle
        : WarningCircle;
  return (
    <p
      className={`creator-money-outcome is-${outcome.kind}`}
      role={outcome.kind === "failed" ? "alert" : "status"}
    >
      <Icon size={18} aria-hidden="true" /> {outcome.text}
    </p>
  );
}

function paidLine(managed: boolean) {
  return managed
    ? tr("Paid from your balance, no popup.")
    : tr("Paid from your balance; your NEAR wallet asks you to approve.");
}

const disabledError = (error: unknown) =>
  error instanceof ApiError && error.code === "CREATORS_DISABLED";

/** Quest detail: like, donate and (when priced) buy access. */
export function CreatorSupport({
  questId,
  ownQuest,
  money,
  onAccess,
}: {
  questId: string;
  ownQuest: boolean;
  money: CreatorMoneyBridge;
  /** Whether this player may start: free, already unlocked, or creator money off. */
  onAccess?: (unlocked: boolean) => void;
}) {
  const [snap, setSnap] = useState<CreatorMoneySnapshot | null>(null),
    [quest, setQuest] = useState<CreatorQuestMoney | null>(null),
    [state, setState] = useState<"loading" | "ready" | "off" | "error">(
      "loading",
    ),
    [refresh, setRefresh] = useState(0),
    [outcome, setOutcome] = useState<Outcome>({ kind: "idle" }),
    [liked, setLiked] = useState(false),
    [custom, setCustom] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    setState("loading");
    void Promise.all([
      api<CreatorMoneySnapshot>("/native/creators", undefined, {
        signal: controller.signal,
      }),
      api<CreatorQuestMoney>(
        `/native/creators/quest?quest=${encodeURIComponent(questId)}`,
        undefined,
        { signal: controller.signal },
      ),
    ]).then(
      ([s, q]) => {
        if (controller.signal.aborted) return;
        setSnap(s);
        setQuest(q);
        setState("ready");
        // Not yet listed on chain: a paid quest cannot be unlocked or started yet.
        onAccess?.(
          ownQuest ||
            (!!q.quest && (BigInt(q.quest.price) === 0n || !!q.access)),
        );
      },
      (error) => {
        if (controller.signal.aborted) return;
        const off = disabledError(error);
        setState(off ? "off" : "error");
        // Creator money off on this host: nothing to unlock, the server agrees.
        onAccess?.(off);
      },
    );
    return () => controller.abort();
  }, [questId, refresh, ownQuest, onAccess]);
  if (state === "off") return null;
  if (state === "loading")
    return (
      <div className="creator-money" aria-busy="true">
        <p className="creator-hint">{tr("Checking support for this quest…")}</p>
      </div>
    );
  if (state === "error" || !snap)
    return (
      <div className="creator-money">
        <p className="creator-hint">{tr("Support for this quest could not load.")}</p>
        <button
          className="text-button"
          onClick={() => setRefresh((n) => n + 1)}
        >
          {tr("Try again")}{" "}<ArrowClockwise size={18} />
        </button>
      </div>
    );
  const chain = quest?.quest;
  const busy = outcome.kind === "pending";
  const noAccount = !money.accountId;
  async function pay(request: CreatorPaymentRequest, label: string) {
    if (busy || !snap) return;
    setOutcome({ kind: "pending", text: `${label}…` });
    const ok = await money.pay(request, {
      contractId: snap.contractId,
      price: chain?.price,
    });
    setOutcome(
      ok
        ? {
            kind: "done",
            text:
              request.kind === "buy"
                ? tr("Access unlocked. 80% went to the creator.")
                : tr("Thank you. The whole gift went to the creator."),
          }
        : { kind: "failed", text: tr("Nothing was paid. You can try again.") },
    );
    if (ok) setRefresh((n) => n + 1);
  }
  async function like() {
    if (busy) return;
    setOutcome({ kind: "pending", text: tr("Saving your like…") });
    try {
      await api("/native/creators/like", { questId });
      setLiked(true);
      setOutcome({
        kind: "done",
        text: tr("Liked. It counts toward today's creator round once."),
      });
    } catch (error) {
      setOutcome({
        kind: "failed",
        text: error instanceof Error ? error.message : tr("The like did not save."),
      });
    }
  }
  const price = chain ? BigInt(chain.price) : 0n;
  const treasuryPct = Number(snap.treasuryBps) / 100;
  return (
    <section className="creator-money" aria-label={tr("Support the creator")}>
      <h4>
        <HandHeart size={20} aria-hidden="true" /> {" "}{tr("Support the creator")}</h4>
      {!chain ? (
        <p className="creator-hint">
          {tr("Gifts open once this quest is listed for support. That happens shortly after it is published.")}</p>
      ) : (
        <>
          <p className="creator-money-facts">
            {qgoldOfYocto(chain.donations)} {" "}{tr("QGOLD in gifts")}{chain.access_sold ? ` · ${chain.access_sold} unlocked` : ""}
          </p>
          {ownQuest ? (
            <p className="creator-hint">
              {tr("This is your quest. Earnings show in My creations.")}</p>
          ) : noAccount ? (
            <p className="creator-hint">
              {tr("Your explorer account is still being prepared. Gifts open when it is ready.")}</p>
          ) : (
            <>
              {price > 0n && !quest?.access && (
                <button
                  className="primary-button"
                  disabled={busy || !chain.open}
                  onClick={() =>
                    void pay(
                      { kind: "buy", questId },
                      tr("Unlocking for {0} QGOLD", { 0: qgoldOfYocto(chain.price) }),
                    )
                  }
                >
                  <LockKeyOpen size={20} /> {" "}{tr("Unlock for")}{" "}{qgoldOfYocto(chain.price)}{" "}
                  QGOLD
                </button>
              )}
              {price > 0n && !quest?.access && (
                <p className="creator-hint">
                  {100 - treasuryPct}{tr("% to the creator,")}{" "}{treasuryPct}{tr("% to the global prize pool.")}</p>
              )}
              {quest?.access && (
                <p className="creator-money-facts">
                  <CheckCircle size={18} aria-hidden="true" /> {" "}{tr("You unlocked this quest.")}</p>
              )}
              <div
                className="creator-money-chips"
                role="group"
                aria-label={tr("Gift amount")}
              >
                {DONATIONS.map((amount) => (
                  <button
                    key={amount}
                    className="secondary-button"
                    disabled={busy || !chain.open}
                    onClick={() =>
                      void pay(
                        {
                          kind: "donate",
                          questId,
                          amount: parseGift(qgoldOfNear(amount)),
                        },
                        tr("Sending {0} QGOLD", { 0: qgoldOfNear(amount) }),
                      )
                    }
                  >
                    {tr("Give")}{" "}{qgoldOfNear(amount)} QGOLD
                  </button>
                ))}
              </div>
              <form
                className="creator-money-custom"
                onSubmit={(event) => {
                  event.preventDefault();
                  try {
                    const amount = parseGift(custom);
                    void pay(
                      { kind: "donate", questId, amount },
                      tr("Sending {0} QGOLD", { 0: qgoldOfYocto(amount) }),
                    );
                  } catch (error) {
                    setOutcome({
                      kind: "failed",
                      text: (error as Error).message,
                    });
                  }
                }}
              >
                <label htmlFor={`creator-gift-${questId}`}>{tr("Other amount")}</label>
                <input
                  id={`creator-gift-${questId}`}
                  inputMode="text"
                  placeholder="200M"
                  value={custom}
                  onChange={(e) => setCustom(e.target.value)}
                />
                <button
                  className="secondary-button"
                  type="submit"
                  disabled={busy || !custom || !chain.open}
                >
                  {tr("Give")}</button>
              </form>
              <p className="creator-hint">
                {paidLine(money.managed)} {" "}{tr("Gifts go 100% to the creator.")}</p>
            </>
          )}
        </>
      )}
      {!ownQuest && (
        <button
          className="text-button"
          disabled={busy || liked}
          onClick={() => void like()}
        >
          <Heart size={20} weight={liked ? "fill" : "regular"} />
          {liked ? tr("Liked") : tr("Like for free")}
        </button>
      )}
      <OutcomeLine outcome={outcome} />
    </section>
  );
}

/** My creations: what the creator earned and a relayed withdraw. */
export function CreatorEarningsPanel({ money }: { money: CreatorMoneyBridge }) {
  const [snap, setSnap] = useState<CreatorMoneySnapshot | null>(null),
    [state, setState] = useState<"loading" | "ready" | "off" | "error">(
      "loading",
    ),
    [refresh, setRefresh] = useState(0),
    [outcome, setOutcome] = useState<Outcome>({ kind: "idle" });
  useEffect(() => {
    const controller = new AbortController();
    setState("loading");
    api<CreatorMoneySnapshot>("/native/creators", undefined, {
      signal: controller.signal,
    }).then(
      (s) => {
        if (controller.signal.aborted) return;
        setSnap(s);
        setState("ready");
      },
      (error) => {
        if (!controller.signal.aborted)
          setState(disabledError(error) ? "off" : "error");
      },
    );
    return () => controller.abort();
  }, [refresh, money.accountId]);
  if (state === "off") return null;
  const c = snap?.creator;
  const credit = c ? BigInt(c.credit) : 0n,
    pending = c ? BigInt(c.pending) : 0n;
  const busy = outcome.kind === "pending";
  async function withdraw() {
    if (busy || !snap) return;
    setOutcome({ kind: "pending", text: tr("Sending your earnings…") });
    const ok = await money.pay(
      { kind: "withdraw" },
      { contractId: snap.contractId },
    );
    setOutcome(
      ok
        ? { kind: "done", text: tr("{0} QGOLD is on its way.", { 0: qgoldOfYocto(c?.credit) }) }
        : { kind: "failed", text: tr("Nothing moved. You can try again.") },
    );
    if (ok) setRefresh((n) => n + 1);
  }
  return (
    <section className="creator-earnings" aria-label={tr("Your creator earnings")}>
      <div className="creator-heading">
        <h4>
          <Coins size={20} aria-hidden="true" /> {" "}{tr("Your earnings")}</h4>
        <button
          className="creator-icon"
          aria-label={tr("Refresh earnings")}
          disabled={state === "loading" || busy}
          onClick={() => setRefresh((n) => n + 1)}
        >
          <ArrowClockwise size={20} />
        </button>
      </div>
      {state === "loading" ? (
        <p className="creator-hint">{tr("Checking your earnings…")}</p>
      ) : state === "error" ? (
        <p className="creator-hint">{tr("Earnings could not load right now.")}</p>
      ) : !money.accountId ? (
        <p className="creator-hint">
          {tr("Your explorer account is still being prepared. Earnings appear once it is ready.")}</p>
      ) : (
        <>
          <p className="creator-earnings-total">
            <strong>{qgoldOfYocto(c?.credit)} QGOLD</strong> {" "}{tr("ready to withdraw")}</p>
          <dl className="creator-earnings-grid">
            <div>
              <dt>{tr("Gifts")}</dt>
              <dd>{qgoldOfYocto(c?.earned_donations)} QGOLD</dd>
            </div>
            <div>
              <dt>{tr("Unlocks")}</dt>
              <dd>{qgoldOfYocto(c?.earned_access)} QGOLD</dd>
            </div>
            <div>
              <dt>{tr("Daily rounds")}</dt>
              <dd>{qgoldOfYocto(c?.earned_rounds)} QGOLD</dd>
            </div>
            <div>
              <dt>{tr("Withdrawn")}</dt>
              <dd>{qgoldOfYocto(c?.withdrawn)} QGOLD</dd>
            </div>
          </dl>
          {pending > 0n && (
            <p className="creator-hint">
              {qgoldOfYocto(c?.pending)} {" "}{tr("QGOLD from today's round settles after the round closes at midnight UTC. Withdraw opens then.")}</p>
          )}
          <button
            className="primary-button"
            disabled={busy || credit === 0n || pending > 0n}
            onClick={() => void withdraw()}
          >
            {tr("Withdraw")}{" "}{credit > 0n ? `${qgoldOfYocto(c?.credit)} QGOLD` : ""}
          </button>
          <p className="creator-hint">
            {credit === 0n
              ? tr("Likes and finished quests earn a share of the daily creator round. Gifts and unlocks add up here.")
              : money.managed
                ? tr("No fee and no popup; we cover the network cost.")
                : tr("Your NEAR wallet asks you to approve.")}
          </p>
        </>
      )}
      <OutcomeLine outcome={outcome} />
    </section>
  );
}
