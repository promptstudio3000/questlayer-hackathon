// Explorer · Nearby: player tasks, Secrets and conditional sends around the
// explorer (docs/TASK-MARKET.md). Every amount is real QGOLD: the player pays
// it into the qgold-escrow contract with one sponsored ft_transfer_call from
// their own NEAR account, and the game releases or refunds it on chain.
// Posters pay the reward plus a 10 % fee on top; Secret creators get 90 % of
// the price after a visit or 7 days without a dispute; sends carry no fee.
import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import {
  ArrowRight,
  ChatCircle,
  CheckCircle,
  Copy,
  Eye,
  HandCoins,
  LockKey,
  MapPin,
  Plus,
  Question,
  Star,
  X,
} from "@phosphor-icons/react";
import { api, gold, GOLD } from "./api";
import { tr } from "./i18n";
import { Dialog } from "./Dialog";
import { EmptyState } from "./EmptyState";
import { Badge, CoinIcon, distanceLabel, units } from "./app-bits";
import type { Fix, Point } from "./types";
import "./nearby-market.css";

type Who = { id: string; name: string; rating?: { count: number; average: number } | null };
type Claim = {
  id: string;
  worker: Who;
  state: string;
  offer: number | null;
  evidence: string | null;
  note: string | null;
  paid: number;
  reservedUntil: number | null;
};
export type MarketTask = {
  id: string;
  title: string;
  description: string;
  type: string;
  visibility: string;
  poster: Who;
  lat: number;
  lng: number;
  radiusM: number;
  reward: number;
  slots: number;
  rounds: number;
  everyDays: number;
  remaining: number;
  paidSlots: number;
  payoutMode: string;
  state: string;
  deadline: number;
  mine: boolean;
  myClaim: Claim | null;
  linkKey?: string | null;
  claims?: Claim[];
  messages?: { id: string; from: Who; text: string; at: number }[];
  distanceM?: number;
};
export type MarketSecret = {
  id: string;
  kind: string;
  title: string;
  teaser: string;
  creator: Who;
  fog: Point & { radiusM: number };
  price: number;
  visitReward: number;
  visitsLeft: number;
  state: string;
  inside: boolean;
  revealed: boolean;
  mine: boolean;
  reveal: { id: string; state: string; visitedAt: number | null; releaseAt: number } | null;
  place?: Point;
  route?: Point[];
  text?: string;
  linkKey?: string | null;
  reveals?: number;
  distanceM?: number;
};
type Transfer = {
  id: string;
  from: Who;
  to: Who;
  amount: number;
  condition: string;
  at: number | null;
  place: (Point & { radiusM: number }) | null;
  senderConfirmed: boolean;
  receiverConfirmed: boolean;
  note: string;
  state: string;
  expiresAt: number;
  incoming: boolean;
};
/** The exact call the player signs to pay QGOLD into the market escrow. */
export type MarketFunding = {
  id: string;
  signerId: string;
  receiverId: string;
  methodName: "ft_transfer_call";
  args: { receiver_id: string; amount: string; memo: null; msg: string };
  gas: string;
  deposit: "1";
};
type Nearby = {
  wallet?: { account: string | null; balance: number | null };
  tasks: MarketTask[];
  forMe: MarketTask[];
  taking: MarketTask[];
  mine: MarketTask[];
  secrets: MarketSecret[];
  transfers: Transfer[];
};

const TYPE_LABEL: Record<string, () => string> = {
  go: () => tr("Go to a place"),
  photo: () => tr("Take a photo"),
  deliver: () => tr("Deliver something"),
  meet: () => tr("Meet up"),
  collect: () => tr("Collect something"),
  event: () => tr("Join an event"),
  answer: () => tr("Answer a question"),
  create: () => tr("Make something"),
  recurring: () => tr("Repeating task"),
  chain: () => tr("Next chain step"),
};
const GPS_TYPES = new Set(["go", "meet", "collect", "event", "deliver"]);
const STATE_LABEL: Record<string, () => string> = {
  reserved: () => tr("Taken by you"),
  offered: () => tr("Counteroffer sent"),
  submitted: () => tr("Proof sent, waiting for review"),
  disputed: () => tr("In dispute with a moderator"),
  paid: () => tr("Paid"),
  rejected: () => tr("Rejected"),
  expired: () => tr("Reservation expired"),
  cancelled: () => tr("Cancelled"),
};

/** Reads `#task=<id>&k=<key>` or `#secret=<id>&k=<key>` share links. */
export function marketLinkFromHash(hash = location.hash) {
  const p = new URLSearchParams(hash.replace(/^#/, ""));
  const task = p.get("task"),
    secret = p.get("secret"),
    k = p.get("k") || undefined;
  return task ? { kind: "task" as const, id: task, k } : secret ? { kind: "secret" as const, id: secret, k } : null;
}
function shareUrl(kind: "task" | "secret", id: string, k?: string | null) {
  return `${location.origin}/#${kind}=${encodeURIComponent(id)}${k ? `&k=${encodeURIComponent(k)}` : ""}`;
}
const feeOnTop = (v: number) => Math.ceil(v / 10);
const when = (ms: number) =>
  new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(ms);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function NearbyMarket({
  position,
  fix,
  fund,
  notify,
  onBalance,
}: {
  position: Point;
  /** Current GPS fix (or the demo position as a fix). */
  fix: () => Fix;
  /** Signs the escrow funding call with the account it names. */
  fund: (call: MarketFunding) => Promise<void>;
  notify: (text: string, error?: boolean) => void;
  /** Called after any change that moves the player's GOLD. */
  onBalance: () => void;
}) {
  const [data, setData] = useState<Nearby | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [openTask, setOpenTask] = useState<{ id: string; k?: string } | null>(null);
  const [openSecret, setOpenSecret] = useState<{ id: string; k?: string } | null>(null);
  const [form, setForm] = useState<"" | "task" | "secret" | "send">("");
  const lat = Math.round(position.lat * 2000) / 2000,
    lng = Math.round(position.lng * 2000) / 2000;
  const load = useCallback(async () => {
    try {
      setData(await api<Nearby>(`/market/nearby?lat=${lat}&lng=${lng}`));
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }, [lat, lng]);
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    const read = () => {
      const link = marketLinkFromHash();
      if (link?.kind === "task") setOpenTask({ id: link.id, k: link.k });
      if (link?.kind === "secret") setOpenSecret({ id: link.id, k: link.k });
    };
    read();
    addEventListener("hashchange", read);
    return () => removeEventListener("hashchange", read);
  }, []);
  async function run<T>(label: string, work: () => Promise<T>, done?: string) {
    setBusy(label);
    try {
      const result = await work();
      const funding = (result as { funding?: MarketFunding | null } | undefined)?.funding;
      if (funding) {
        // The agreement opens once the QGOLD is in the escrow.
        await fund(funding);
        let state = "waiting";
        for (let i = 0; i < 10 && state !== "funded"; i++) {
          if (i) await sleep(1500);
          state = (await api<{ state: string }>("/market/funded", { id: funding.id })).state;
        }
        if (state !== "funded") {
          notify(tr("Your QGOLD is on its way. It opens here in a minute."));
          done = undefined;
        }
      }
      if (done) notify(done);
      onBalance();
      await load();
      return result;
    } catch (e) {
      notify((e as Error).message, true);
      return undefined;
    } finally {
      setBusy("");
    }
  }
  const closeLink = () => {
    if (marketLinkFromHash()) history.replaceState(null, "", location.pathname + location.search);
  };

  if (!data && !error) return <p className="nearby-loading" role="status">{tr("Looking around…")}</p>;
  if (!data) return <EmptyState art="place" title={tr("Nearby is unavailable")} status>{error}</EmptyState>;
  const active = [...data.taking, ...data.forMe.filter((t) => !data.taking.some((x) => x.id === t.id))];
  return (
    <div className="nearby-market">
      <div className="nearby-actions">
        <button className="secondary-button" onClick={() => setForm("task")}>
          <Plus size={18} aria-hidden="true" /> {tr("Post a task")}
        </button>
        <button className="secondary-button" onClick={() => setForm("secret")}>
          <LockKey size={18} aria-hidden="true" /> {tr("Hide a Secret")}
        </button>
        <button className="secondary-button" onClick={() => setForm("send")}>
          <HandCoins size={18} aria-hidden="true" /> {tr("Send on a condition")}
        </button>
      </div>
      <p className="nearby-note">
        {tr("Real QGOLD from your account, held by the escrow contract until the task is done. Posting a task adds a 10 % fee on top; sends are free.")}
        {data.wallet?.balance != null && ` ${tr("You hold {0} QGOLD.", { 0: gold(data.wallet.balance) })}`}
      </p>

      {active.length > 0 && (
        <TaskSection title={tr("Your active tasks")} tasks={active} onOpen={(t) => setOpenTask({ id: t.id })} />
      )}
      {data.transfers.length > 0 && (
        <section className="nearby-section">
          <div className="section-label"><h2>{tr("Pending sends")}</h2><span>{data.transfers.length}</span></div>
          {data.transfers.map((t) => (
            <TransferCard key={t.id} t={t} busy={!!busy} act={(action) =>
              run(`send:${t.id}`, () => api("/market/transfer/act", { transferId: t.id, action, fix: fix() }))
            } />
          ))}
        </section>
      )}
      <TaskSection
        title={tr("Tasks nearby")}
        tasks={data.tasks}
        onOpen={(t) => setOpenTask({ id: t.id })}
        empty={tr("No open player tasks within 5 km. Post one and pay explorers to do it.")}
      />
      <section className="nearby-section">
        <div className="section-label"><h2>{tr("Secrets")}</h2><span>{data.secrets.length}</span></div>
        {data.secrets.length === 0 && <p className="nearby-empty">{tr("No Secrets hidden within 10 km yet.")}</p>}
        {data.secrets.map((s) => (
          <button key={s.id} className="nearby-card secret-card" onClick={() => setOpenSecret({ id: s.id })}>
            <span className={`secret-fog${s.inside ? " inside" : ""}`} aria-hidden="true">
              {s.revealed ? <Eye size={22} /> : <Question size={22} weight="bold" />}
            </span>
            <span className="nearby-card-body">
              <strong>{s.title}</strong>
              <small>
                {s.inside ? tr("You are inside the fog") : distanceLabel(s.distanceM ?? NaN)}
                {" · "}
                {s.kind === "sponsored"
                  ? tr("Free · {0} GOLD for finding it", { 0: gold(s.visitReward) })
                  : s.price > 0
                    ? `${gold(s.price)} GOLD`
                    : tr("Free")}
              </small>
            </span>
            <ArrowRight size={18} aria-hidden="true" />
          </button>
        ))}
      </section>
      {data.mine.length > 0 && (
        <TaskSection title={tr("Tasks you posted")} tasks={data.mine} onOpen={(t) => setOpenTask({ id: t.id })} />
      )}

      {openTask && (
        <TaskDialog
          id={openTask.id}
          k={openTask.k}
          fix={fix}
          busy={busy}
          run={run}
          onClose={() => {
            setOpenTask(null);
            closeLink();
          }}
        />
      )}
      {openSecret && (
        <SecretDialog
          id={openSecret.id}
          k={openSecret.k}
          position={position}
          fix={fix}
          busy={busy}
          run={run}
          notify={notify}
          onClose={() => {
            setOpenSecret(null);
            closeLink();
          }}
        />
      )}
      {form === "task" && (
        <TaskForm balance={data.wallet?.balance ?? Number.MAX_SAFE_INTEGER} position={position} onClose={() => setForm("")} submit={async (input) => {
          const r = await run("task:new", () => api<{ id: string; linkKey: string | null }>("/market/tasks", input), tr("Task posted. The reward is held until someone completes it."));
          if (r) {
            setForm("");
            setOpenTask({ id: r.id, k: r.linkKey ?? undefined });
          }
        }} busy={busy === "task:new"} />
      )}
      {form === "secret" && (
        <SecretForm position={position} onClose={() => setForm("")} submit={async (input) => {
          const r = await run("secret:new", () => api<{ id: string; linkKey: string | null }>("/market/secrets", { ...input, fix: fix() }), tr("Secret hidden. Explorers nearby see only the fog."));
          if (r) {
            setForm("");
            setOpenSecret({ id: r.id, k: r.linkKey ?? undefined });
          }
        }} busy={busy === "secret:new"} />
      )}
      {form === "send" && (
        <SendForm position={position} onClose={() => setForm("")} busy={busy === "send:new"} submit={async (input) => {
          const r = await run("send:new", () => api("/market/transfers", input), tr("GOLD is held until the condition is met."));
          if (r) setForm("");
        }} />
      )}
    </div>
  );
}

function TaskSection({ title, tasks, onOpen, empty }: { title: string; tasks: MarketTask[]; onOpen: (t: MarketTask) => void; empty?: string }) {
  return (
    <section className="nearby-section">
      <div className="section-label"><h2>{title}</h2><span>{tasks.length}</span></div>
      {tasks.length === 0 && empty && <p className="nearby-empty">{empty}</p>}
      {tasks.map((t) => (
        <button key={t.id} className="nearby-card" onClick={() => onOpen(t)}>
          <span className="task-reward"><CoinIcon />{gold(t.reward)}</span>
          <span className="nearby-card-body">
            <strong>{t.title}</strong>
            <small>
              {TYPE_LABEL[t.type]?.() ?? t.type}
              {t.distanceM !== undefined && ` · ${distanceLabel(t.distanceM)}`}
              {t.myClaim && ` · ${STATE_LABEL[t.myClaim.state]?.() ?? t.myClaim.state}`}
              {t.mine && ` · ${tr("{0} of {1} paid", { 0: t.paidSlots, 1: t.slots * t.rounds })}`}
            </small>
          </span>
          <ArrowRight size={18} aria-hidden="true" />
        </button>
      ))}
    </section>
  );
}

type Run = <T>(label: string, work: () => Promise<T>, done?: string) => Promise<T | undefined>;

function TaskDialog({ id, k, fix, busy, run, onClose }: { id: string; k?: string; fix: () => Fix; busy: string; run: Run; onClose: () => void }) {
  const [task, setTask] = useState<MarketTask | null>(null);
  const [error, setError] = useState("");
  const [proof, setProof] = useState("");
  const [answer, setAnswer] = useState("");
  const [offer, setOffer] = useState("");
  const [message, setMessage] = useState("");
  const [reason, setReason] = useState("");
  const load = useCallback(async () => {
    try {
      setTask((await api<{ task: MarketTask }>(`/market/task?id=${encodeURIComponent(id)}${k ? `&k=${encodeURIComponent(k)}` : ""}`)).task);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [id, k]);
  useEffect(() => {
    void load();
  }, [load]);
  const act = async <T,>(label: string, path: string, data: unknown, done?: string) => {
    const r = await run<T>(label, () => api<T>(path, data), done);
    await load();
    return r;
  };
  const claim = task?.myClaim;
  const mineOpen = claim && ["reserved", "offered", "submitted", "disputed"].includes(claim.state);
  return (
    <Dialog label={task?.title || tr("Task")} onClose={onClose}>
      <div className="market-dialog">
        <div className="market-dialog-head">
          <h2>{task?.title || tr("Task")}</h2>
          <button className="icon-button" onClick={onClose} aria-label={tr("Close")}><X size={18} /></button>
        </div>
        {error && <p role="alert">{error}</p>}
        {task && (
          <>
            <div className="market-facts">
              <Badge tone="gold"><CoinIcon /> {gold(task.reward)} GOLD</Badge>
              <Badge>{TYPE_LABEL[task.type]?.() ?? task.type}</Badge>
              {task.visibility !== "public" && <Badge tone="purple"><LockKey size={12} /> {tr("Invite only")}</Badge>}
            </div>
            {task.description && <p>{task.description}</p>}
            <p className="market-meta">
              {tr("Posted by {0}", { 0: task.poster.name })}
              {task.poster.rating && <> · <Star size={12} weight="fill" /> {task.poster.rating.average} ({task.poster.rating.count})</>}
              {" · "}{tr("Open until {0}", { 0: when(task.deadline) })}
              {" · "}{tr("{0} places left", { 0: task.remaining })}
              {task.rounds > 1 && ` · ${tr("Repeats every {0} days", { 0: task.everyDays })}`}
            </p>
            {GPS_TYPES.has(task.type) && <p className="market-meta"><MapPin size={14} /> {tr("Be within {0} m of the pinned place to complete it.", { 0: task.radiusM })}</p>}

            {task.mine ? (
              <PosterControls task={task} busy={busy} act={act} />
            ) : !claim || !mineOpen ? (
              task.state === "open" && (
                <div className="market-form-row">
                  <button disabled={!!busy} onClick={() => act("take", "/market/task/reserve", { taskId: task.id, k }, tr("Task taken. It is yours for the next 3 hours."))}>
                    {tr("Take this task")}
                  </button>
                  <label className="inline-field">
                    <span>{tr("Or ask for more")}</span>
                    <input inputMode="decimal" placeholder={gold(task.reward * 1.5)} value={offer} onChange={(e) => setOffer(e.target.value)} />
                  </label>
                  <button className="secondary-button" disabled={!!busy || !offer} onClick={() => act("offer", "/market/task/reserve", { taskId: task.id, k, offer: units(offer) }, tr("Counteroffer sent to the poster."))}>
                    {tr("Send counteroffer")}
                  </button>
                </div>
              )
            ) : (
              <div className="market-claim">
                <p role="status"><strong>{STATE_LABEL[claim.state]?.() ?? claim.state}</strong>{claim.reservedUntil && claim.state === "reserved" ? ` · ${tr("until {0}", { 0: when(claim.reservedUntil) })}` : ""}</p>
                {claim.state === "reserved" && task.type === "answer" && (
                  <div className="market-form-row">
                    <input aria-label={tr("Your answer")} value={answer} onChange={(e) => setAnswer(e.target.value)} />
                    <button disabled={!!busy || !answer} onClick={async () => {
                      const r = await act<{ correct?: boolean; state: string }>("submit", "/market/task/submit", { claimId: claim.id, answer });
                      if (r && r.correct === false) setError(tr("Not quite. Try again."));
                    }}>{tr("Answer")}</button>
                  </div>
                )}
                {claim.state === "reserved" && task.type !== "answer" && (
                  <div className="market-form-col">
                    {!GPS_TYPES.has(task.type) && (
                      <textarea aria-label={tr("What did you do?")} placeholder={tr("Describe what you did, and link a photo if you have one.")} value={proof} onChange={(e) => setProof(e.target.value)} />
                    )}
                    <button disabled={!!busy} onClick={() => act("submit", "/market/task/submit", { claimId: claim.id, evidence: proof, fix: fix() }, tr("Proof sent."))}>
                      <CheckCircle size={18} /> {GPS_TYPES.has(task.type) ? tr("I'm here") : tr("Send proof")}
                    </button>
                  </div>
                )}
                {["submitted", "rejected"].includes(claim.state) && claim.note && <p className="market-meta">{claim.note}</p>}
                {claim.state === "rejected" && (
                  <DisputeRow reason={reason} setReason={setReason} busy={busy} onSend={() => act("dispute", "/market/task/dispute", { claimId: claim.id, reason }, tr("A moderator will look at it."))} />
                )}
              </div>
            )}
            {claim && ["paid", "rejected"].includes(claim.state) && !task.mine && (
              <RateRow onRate={(stars) => act("rate", "/market/task/rate", { claimId: claim.id, stars }, tr("Thanks for rating."))} />
            )}
            {task.messages && (
              <div className="market-chat">
                <h3><ChatCircle size={16} /> {tr("Messages")}</h3>
                {task.messages.length === 0 && <p className="market-meta">{tr("No messages yet.")}</p>}
                {task.messages.map((m) => <p key={m.id}><strong>{m.from.name}:</strong> {m.text}</p>)}
                <form className="market-form-row" onSubmit={(e) => {
                  e.preventDefault();
                  void act("msg", "/market/task/message", { taskId: task.id, text: message }).then(() => setMessage(""));
                }}>
                  <input aria-label={tr("Message")} value={message} maxLength={500} onChange={(e) => setMessage(e.target.value)} />
                  <button disabled={!!busy || !message.trim()}>{tr("Send")}</button>
                </form>
              </div>
            )}
          </>
        )}
      </div>
    </Dialog>
  );
}

function PosterControls({ task, busy, act }: { task: MarketTask; busy: string; act: <T>(label: string, path: string, data: unknown, done?: string) => Promise<T | undefined> }) {
  const [reason, setReason] = useState<Record<string, string>>({});
  return (
    <div className="market-claim">
      {task.visibility !== "user" && task.visibility !== "group" && (
        <ShareRow url={shareUrl("task", task.id, task.visibility === "private" ? task.linkKey : null)} />
      )}
      {(task.claims || []).length === 0 && <p className="market-meta">{tr("Nobody has taken it yet.")}</p>}
      {(task.claims || []).map((c) => (
        <div key={c.id} className="market-claim-row">
          <p>
            <strong>{c.worker.name}</strong> · {STATE_LABEL[c.state]?.() ?? c.state}
            {c.offer ? ` · ${tr("asks {0} GOLD", { 0: gold(c.offer) })}` : ""}
          </p>
          {c.evidence && <p className="market-meta">{c.evidence}</p>}
          {c.state === "offered" && (
            <button disabled={!!busy} onClick={() => act("accept", "/market/task/accept-offer", { claimId: c.id }, tr("Offer accepted. The extra amount plus 10 % is now held."))}>
              {tr("Accept for {0} GOLD + fee", { 0: gold((c.offer || 0) - task.reward) })}
            </button>
          )}
          {c.state === "submitted" && (
            <div className="market-form-row">
              <button disabled={!!busy} onClick={() => act("approve", "/market/task/review", { claimId: c.id, approve: true }, tr("Paid."))}>{tr("Approve and pay")}</button>
              <input aria-label={tr("Reason")} placeholder={tr("Why not?")} value={reason[c.id] || ""} onChange={(e) => setReason({ ...reason, [c.id]: e.target.value })} />
              <button className="secondary-button" disabled={!!busy || (reason[c.id] || "").length < 3} onClick={() => act("reject", "/market/task/review", { claimId: c.id, approve: false, reason: reason[c.id] })}>{tr("Reject")}</button>
            </div>
          )}
          {c.state === "paid" && <RateRow onRate={(stars) => act("rate", "/market/task/rate", { claimId: c.id, stars }, tr("Thanks for rating."))} />}
        </div>
      ))}
      {task.state === "open" && (
        <button className="secondary-button" disabled={!!busy} onClick={() => act("cancel", "/market/task/cancel", { taskId: task.id }, tr("Task closed. Unused GOLD and its fee are back."))}>
          {tr("Close task and refund the rest")}
        </button>
      )}
    </div>
  );
}

function ShareRow({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="market-form-row">
      <input readOnly aria-label={tr("Share link")} value={url} onFocus={(e) => e.currentTarget.select()} />
      <button className="secondary-button" onClick={() => {
        void navigator.clipboard?.writeText(url).then(() => setCopied(true));
      }}>
        <Copy size={16} /> {copied ? tr("Copied") : tr("Copy link")}
      </button>
    </div>
  );
}
function RateRow({ onRate }: { onRate: (stars: number) => void }) {
  return (
    <div className="market-rate" role="group" aria-label={tr("Rate")}>
      {[1, 2, 3, 4, 5].map((n) => (
        <button key={n} className="icon-button" aria-label={tr("{0} stars", { 0: n })} onClick={() => onRate(n)}>
          <Star size={20} />
        </button>
      ))}
    </div>
  );
}
function DisputeRow({ reason, setReason, busy, onSend }: { reason: string; setReason: (v: string) => void; busy: string; onSend: () => void }) {
  return (
    <div className="market-form-row">
      <input aria-label={tr("What went wrong?")} placeholder={tr("What went wrong?")} value={reason} onChange={(e) => setReason(e.target.value)} />
      <button className="secondary-button" disabled={!!busy || reason.length < 5} onClick={onSend}>{tr("Ask a moderator")}</button>
    </div>
  );
}

function SecretDialog({ id, k, position, fix, busy, run, notify, onClose }: { id: string; k?: string; position: Point; fix: () => Fix; busy: string; run: Run; notify: (t: string, e?: boolean) => void; onClose: () => void }) {
  const [secret, setSecret] = useState<MarketSecret | null>(null);
  const [error, setError] = useState("");
  const [reason, setReason] = useState("");
  const load = useCallback(async () => {
    try {
      setSecret((await api<{ secret: MarketSecret }>(`/market/secret?id=${encodeURIComponent(id)}${k ? `&k=${encodeURIComponent(k)}` : ""}&lat=${position.lat}&lng=${position.lng}`)).secret);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [id, k, position.lat, position.lng]);
  useEffect(() => {
    void load();
  }, [load]);
  const act = async <T,>(label: string, path: string, data: unknown, done?: string) => {
    const r = await run<T>(label, () => api<T>(path, data), done);
    await load();
    return r;
  };
  const s = secret;
  return (
    <Dialog label={s?.title || tr("Secret")} onClose={onClose}>
      <div className="market-dialog">
        <div className="market-dialog-head">
          <h2>{s?.title || tr("Secret")}</h2>
          <button className="icon-button" onClick={onClose} aria-label={tr("Close")}><X size={18} /></button>
        </div>
        {error && <p role="alert">{error}</p>}
        {s && (
          <>
            <div className="market-facts">
              <Badge tone="purple"><LockKey size={12} /> {s.kind === "route" ? tr("Secret route") : s.kind === "sponsored" ? tr("Sponsored Secret") : s.kind === "private" ? tr("Private Secret") : tr("Secret place")}</Badge>
              {s.price > 0 && <Badge tone="gold"><CoinIcon /> {gold(s.price)} GOLD</Badge>}
              {s.kind === "sponsored" && <Badge tone="green">{tr("{0} GOLD for finding it · {1} left", { 0: gold(s.visitReward), 1: s.visitsLeft })}</Badge>}
            </div>
            {s.teaser && <p>{s.teaser}</p>}
            <p className="market-meta">
              {tr("Hidden by {0}", { 0: s.creator.name })} · {tr("Somewhere in a {0} m fog circle.", { 0: s.fog.radiusM })}
              {s.inside && ` ${tr("You are inside it.")}`}
            </p>
            {s.revealed && s.text ? (
              <div className="secret-revealed">
                <p>{s.text}</p>
                {s.place && (
                  <a className="secondary-button" href={`https://www.openstreetmap.org/?mlat=${s.place.lat}&mlon=${s.place.lng}#map=18/${s.place.lat}/${s.place.lng}`} target="_blank" rel="noreferrer">
                    <MapPin size={16} /> {tr("Open the exact place")}
                  </a>
                )}
                {s.route && s.route.length > 1 && <p className="market-meta">{tr("Route with {0} points. Walk to the last one.", { 0: s.route.length })}</p>}
                {s.mine ? (
                  <>
                    <p className="market-meta">{tr("{0} explorers revealed it.", { 0: s.reveals ?? 0 })}</p>
                    {s.kind === "private" && <ShareRow url={shareUrl("secret", s.id, s.linkKey)} />}
                    {s.kind !== "private" && <ShareRow url={shareUrl("secret", s.id)} />}
                    {s.state === "open" && (
                      <button className="secondary-button" disabled={!!busy} onClick={() => act("close", "/market/secret/close", { secretId: s.id }, tr("Secret closed."))}>{tr("Close this Secret")}</button>
                    )}
                  </>
                ) : (
                  <>
                    {!s.reveal?.visitedAt && (
                      <button disabled={!!busy} onClick={() => act("visit", "/market/secret/visit", { secretId: s.id, fix: fix() }, tr("Found it!"))}>
                        <CheckCircle size={18} /> {tr("I found it")}
                      </button>
                    )}
                    {s.reveal?.state === "held" && (
                      <>
                        <p className="market-meta">{tr("The creator is paid when you get there, or on {0} if you do not dispute it.", { 0: when(s.reveal.releaseAt) })}</p>
                        <DisputeRow reason={reason} setReason={setReason} busy={busy} onSend={() => act("dispute", "/market/secret/dispute", { secretId: s.id, reason }, tr("A moderator will look at it."))} />
                      </>
                    )}
                  </>
                )}
              </div>
            ) : (
              s.state === "open" && (
                <button disabled={!!busy} onClick={async () => {
                  const r = await act("reveal", "/market/secret/reveal", { secretId: s.id, k });
                  if (r) notify(tr("Revealed. Go and find it."));
                }}>
                  <Eye size={18} /> {s.price > 0 ? tr("Reveal for {0} GOLD", { 0: gold(s.price) }) : tr("Reveal for free")}
                </button>
              )
            )}
          </>
        )}
      </div>
    </Dialog>
  );
}

function FormShell({ title, onClose, onSubmit, children }: { title: string; onClose: () => void; onSubmit: (e: FormEvent) => void; children: ReactNode }) {
  return (
    <Dialog label={title} onClose={onClose}>
      <form className="market-dialog" onSubmit={(e) => { e.preventDefault(); onSubmit(e); }}>
        <div className="market-dialog-head">
          <h2>{title}</h2>
          <button type="button" className="icon-button" onClick={onClose} aria-label={tr("Close")}><X size={18} /></button>
        </div>
        {children}
      </form>
    </Dialog>
  );
}
function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="market-field"><span>{label}</span>{children}</label>;
}

function TaskForm({ balance, position, busy, onClose, submit }: { balance: number; position: Point; busy: boolean; onClose: () => void; submit: (input: Record<string, unknown>) => void }) {
  const [v, setV] = useState({ title: "", description: "", type: "go", reward: "5", slots: "1", days: "7", visibility: "public", assignee: "", group: "", answer: "", rounds: "4", everyDays: "7" });
  const set = (key: keyof typeof v) => (e: { target: { value: string } }) => setV({ ...v, [key]: e.target.value });
  const reward = units(v.reward),
    slots = Math.max(1, Number(v.slots) || 1),
    rounds = v.type === "recurring" ? Math.max(2, Number(v.rounds) || 2) : 1;
  const total = reward * slots * rounds,
    fee = feeOnTop(total);
  const short = total + fee > balance;
  return (
    <FormShell title={tr("Post a task")} onClose={onClose} onSubmit={() => submit({
      title: v.title, description: v.description, type: v.type, lat: position.lat, lng: position.lng,
      reward, slots, days: Number(v.days), visibility: v.visibility,
      ...(v.visibility === "user" ? { assignee: v.assignee.trim() } : {}),
      ...(v.visibility === "group" ? { group: v.group.split(/[\s,]+/).filter(Boolean) } : {}),
      ...(v.type === "answer" ? { answer: v.answer } : {}),
      ...(v.type === "recurring" ? { rounds, everyDays: Number(v.everyDays) } : {}),
    })}>
      <Field label={tr("What should explorers do?")}><input required minLength={5} maxLength={100} value={v.title} onChange={set("title")} /></Field>
      <Field label={tr("Type")}>
        <select value={v.type} onChange={set("type")}>
          {Object.keys(TYPE_LABEL).filter((t) => t !== "chain").map((t) => <option key={t} value={t}>{TYPE_LABEL[t]()}</option>)}
        </select>
      </Field>
      <Field label={tr("Details")}><textarea maxLength={1000} value={v.description} onChange={set("description")} /></Field>
      {v.type === "answer" && <Field label={tr("Correct answer (kept secret)")}><input required value={v.answer} onChange={set("answer")} /></Field>}
      <div className="market-form-row">
        <Field label={tr("Reward (GOLD)")}><input inputMode="decimal" required value={v.reward} onChange={set("reward")} /></Field>
        <Field label={tr("Completions")}><input type="number" min={1} max={50} value={v.slots} onChange={set("slots")} /></Field>
        {v.type === "recurring" ? (
          <>
            <Field label={tr("Rounds")}><input type="number" min={2} max={12} value={v.rounds} onChange={set("rounds")} /></Field>
            <Field label={tr("Every (days)")}><input type="number" min={1} max={30} value={v.everyDays} onChange={set("everyDays")} /></Field>
          </>
        ) : (
          <Field label={tr("Open (days)")}><input type="number" min={1} max={30} value={v.days} onChange={set("days")} /></Field>
        )}
      </div>
      <Field label={tr("Who can see it")}>
        <select value={v.visibility} onChange={set("visibility")}>
          <option value="public">{tr("Everyone nearby")}</option>
          <option value="link">{tr("Anyone with the link")}</option>
          <option value="private">{tr("Only with a private link")}</option>
          <option value="user">{tr("One player")}</option>
          <option value="group">{tr("A group of players")}</option>
        </select>
      </Field>
      {v.visibility === "user" && <Field label={tr("Player id or NEAR account")}><input required value={v.assignee} onChange={set("assignee")} /></Field>}
      {v.visibility === "group" && <Field label={tr("Player ids or NEAR accounts, separated by commas")}><input required value={v.group} onChange={set("group")} /></Field>}
      <p className="market-meta">{tr("Pinned at your current position.")}</p>
      <p className="market-total" role="status">
        {tr("You pay {0} GOLD: {1} in rewards + {2} fee (10 %). Unused GOLD and its fee come back.", { 0: gold(total + fee), 1: gold(total), 2: gold(fee) })}
      </p>
      {short && <p role="alert">{tr("Not enough QGOLD in your account.")}</p>}
      <button disabled={busy || short || reward < 0.01 * GOLD}>{tr("Post and hold the reward")}</button>
    </FormShell>
  );
}

function SecretForm({ position, busy, onClose, submit }: { position: Point; busy: boolean; onClose: () => void; submit: (input: Record<string, unknown>) => void }) {
  const [v, setV] = useState({ kind: "place", title: "", teaser: "", reveal: "", price: "2", fog: "700", visitReward: "1", visits: "10" });
  const set = (key: keyof typeof v) => (e: { target: { value: string } }) => setV({ ...v, [key]: e.target.value });
  const sponsored = v.kind === "sponsored";
  const budget = units(v.visitReward) * (Number(v.visits) || 0);
  return (
    <FormShell title={tr("Hide a Secret")} onClose={onClose} onSubmit={() => submit({
      kind: v.kind, title: v.title, teaser: v.teaser, reveal: v.reveal,
      lat: position.lat, lng: position.lng, fogRadiusM: Number(v.fog),
      ...(sponsored ? { visitReward: units(v.visitReward), visits: Number(v.visits) } : { price: units(v.price) }),
    })}>
      <p className="market-meta">{tr("Stand at the place you are hiding. Others see only a fog circle around it until they reveal it.")}</p>
      <Field label={tr("Type")}>
        <select value={v.kind} onChange={set("kind")}>
          <option value="place">{tr("Secret place")}</option>
          <option value="private">{tr("Private, for people with the link")}</option>
          <option value="sponsored">{tr("Sponsored: free to reveal, you pay finders")}</option>
        </select>
      </Field>
      <Field label={tr("Title")}><input required minLength={3} maxLength={80} value={v.title} onChange={set("title")} /></Field>
      <Field label={tr("Teaser everyone sees")}><input maxLength={300} value={v.teaser} onChange={set("teaser")} /></Field>
      <Field label={tr("What they find (shown after reveal)")}><textarea required minLength={10} maxLength={2000} value={v.reveal} onChange={set("reveal")} /></Field>
      <Field label={tr("Fog circle")}>
        <select value={v.fog} onChange={set("fog")}>
          <option value="500">500 m</option>
          <option value="700">700 m</option>
          <option value="1000">{tr("1 km")}</option>
        </select>
      </Field>
      {sponsored ? (
        <>
          <div className="market-form-row">
            <Field label={tr("GOLD per finder")}><input inputMode="decimal" value={v.visitReward} onChange={set("visitReward")} /></Field>
            <Field label={tr("Finders")}><input type="number" min={1} max={500} value={v.visits} onChange={set("visits")} /></Field>
          </div>
          <p className="market-total">{tr("You pay {0} GOLD: {1} for finders + {2} fee (10 %).", { 0: gold(budget + feeOnTop(budget)), 1: gold(budget), 2: gold(feeOnTop(budget)) })}</p>
        </>
      ) : (
        <>
          <Field label={tr("Price to reveal (GOLD, 0 = free)")}><input inputMode="decimal" value={v.price} onChange={set("price")} /></Field>
          <p className="market-total">{tr("You get 90 % of each reveal when the explorer gets there, or after 7 days without a dispute.")}</p>
        </>
      )}
      <button disabled={busy}>{tr("Hide it here")}</button>
    </FormShell>
  );
}

function SendForm({ position, busy, onClose, submit }: { position: Point; busy: boolean; onClose: () => void; submit: (input: Record<string, unknown>) => void }) {
  const [v, setV] = useState({ to: "", amount: "1", condition: "both_confirm", at: "", note: "", days: "7" });
  const set = (key: keyof typeof v) => (e: { target: { value: string } }) => setV({ ...v, [key]: e.target.value });
  const at = useMemo(() => (v.at ? Date.parse(v.at) : NaN), [v.at]);
  return (
    <FormShell title={tr("Send on a condition")} onClose={onClose} onSubmit={() => submit({
      to: v.to.trim(), amount: units(v.amount), condition: v.condition, note: v.note, days: Number(v.days),
      ...(v.condition === "after" ? { at } : {}),
      ...(v.condition === "gps" ? { place: { lat: position.lat, lng: position.lng } } : {}),
    })}>
      <Field label={tr("To (player id or NEAR account)")}><input required value={v.to} onChange={set("to")} /></Field>
      <Field label={tr("Amount (GOLD)")}><input inputMode="decimal" required value={v.amount} onChange={set("amount")} /></Field>
      <Field label={tr("Released when")}>
        <select value={v.condition} onChange={set("condition")}>
          <option value="both_confirm">{tr("You both confirm")}</option>
          <option value="after">{tr("A date arrives")}</option>
          <option value="gps">{tr("They reach this place")}</option>
        </select>
      </Field>
      {v.condition === "after" && <Field label={tr("Release at")}><input type="datetime-local" required value={v.at} onChange={set("at")} /></Field>}
      {v.condition === "gps" && <p className="market-meta">{tr("The place is your current position.")}</p>}
      <Field label={tr("Note")}><input maxLength={200} value={v.note} onChange={set("note")} /></Field>
      <Field label={tr("Returns to you after (days)")}><input type="number" min={1} max={60} value={v.days} onChange={set("days")} /></Field>
      <p className="market-total">{tr("No fee. The receiver can decline, and it returns to you if the condition is not met in time.")}</p>
      <button disabled={busy}>{tr("Hold and send")}</button>
    </FormShell>
  );
}

function TransferCard({ t, busy, act }: { t: Transfer; busy: boolean; act: (action: string) => void }) {
  const waiting = t.condition === "both_confirm" && ((t.incoming && t.receiverConfirmed) || (!t.incoming && t.senderConfirmed));
  return (
    <div className="nearby-card transfer-card">
      <span className="task-reward"><CoinIcon />{gold(t.amount)}</span>
      <span className="nearby-card-body">
        <strong>{t.incoming ? tr("From {0}", { 0: t.from.name }) : tr("To {0}", { 0: t.to.name })}</strong>
        <small>
          {t.condition === "both_confirm" ? tr("When you both confirm") : t.condition === "after" ? tr("On {0}", { 0: when(t.at || 0) }) : tr("At a place")}
          {t.note && ` · ${t.note}`}
        </small>
        <span className="market-form-row">
          {t.condition === "both_confirm" && !waiting && <button disabled={busy} onClick={() => act("confirm")}>{tr("Confirm")}</button>}
          {waiting && <small>{tr("Waiting for the other side")}</small>}
          {t.condition === "gps" && t.incoming && <button disabled={busy} onClick={() => act("arrive")}>{tr("I'm here")}</button>}
          {t.incoming && <button className="secondary-button" disabled={busy} onClick={() => act("decline")}>{tr("Decline")}</button>}
          {!t.incoming && t.condition === "both_confirm" && !t.receiverConfirmed && <button className="secondary-button" disabled={busy} onClick={() => act("cancel")}>{tr("Cancel")}</button>}
        </span>
      </span>
    </div>
  );
}
