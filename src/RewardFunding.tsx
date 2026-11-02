import { useEffect, useRef } from "react";
import {
  ArrowClockwise,
  ArrowRight,
  CheckCircle,
  CloudSlash,
  Handshake,
  Plant,
  Prohibit,
  SealCheck,
  WarningCircle,
  XCircle,
  ChartDonut,
} from "@phosphor-icons/react";
import { GameObjectArt } from "./game-object-art";
import {
  CHECK_NAMES,
  EXCLUDED_NAMES,
  dayLabel,
  goldCompact,
  goldExact,
  potView,
  refreshRewardFunding,
  useRewardFunding,
  type BooksState,
  type FundingSource,
  type PotView,
} from "./reward-funding";
import "./reward-funding.css";

// Return focus to the Explore element after the funding page closes.
let returnFocusToPot = false;

const clock = (at: number | string) =>
  new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(at));

function sourceText(source: FundingSource) {
  if (source.kind === "sponsor") return "Funded by sponsors";
  if (source.kind === "mixed") return "Funded by sponsors and realized yield";
  return "Funded by sponsors or realized yield";
}

function BooksChip({ books }: { books: BooksState }) {
  if (books === "checked")
    return (
      <span className="pot-chip pot-chip-ok">
        <SealCheck size={16} weight="fill" aria-hidden="true" />
        Books checked
      </span>
    );
  if (books === "drift")
    return (
      <span className="pot-chip pot-chip-alert">
        <WarningCircle size={16} weight="fill" aria-hidden="true" />
        Books under review
      </span>
    );
  return <span className="pot-chip">Not checked yet</span>;
}

function PotLines({ view, practice }: { view: PotView; practice: boolean }) {
  if (view.kind === "loading")
    return <span className="pot-line">Checking today's pot…</span>;
  if (view.kind === "practice")
    return (
      <>
        <span className="pot-line">
          Practice GOLD is play money with no value.
        </span>
        <small className="pot-note">See how real rewards are funded</small>
      </>
    );
  if (view.kind === "failed")
    return (
      <>
        <span className="pot-line">Couldn't check the pot right now.</span>
        <small className="pot-note">
          {view.offline
            ? "You're offline. It updates when you reconnect."
            : "Open to try again."}
        </small>
      </>
    );
  return (
    <>
      {view.today ? (
        <span className="pot-line pot-values">
          <LeftOf
            art="coin"
            label="Coins"
            left={view.today.coinsLeft}
            funded={view.today.coinsFunded}
          />
          <LeftOf
            art="place"
            label="Prizes"
            left={view.today.prizesLeft}
            funded={view.today.prizesFunded}
          />
        </span>
      ) : view.openDays ? (
        <span className="pot-line">No funded day is open yet today.</span>
      ) : view.treasury ? (
        <span className="pot-line">
          <b>{goldCompact(view.treasury.funded)} GOLD</b> funded so far
        </span>
      ) : (
        <span className="pot-line">Today's amounts could not be read.</span>
      )}
      <small className="pot-note">
        {view.stale && view.treasuryObservedAt
          ? `Last confirmed ${clock(view.treasuryObservedAt)} · `
          : ""}
        {sourceText(view.source)}
        {practice ? " · your practice GOLD is separate" : ""}
      </small>
    </>
  );
}

function LeftOf({
  art,
  label,
  left,
  funded,
}: {
  art: "coin" | "place";
  label: string;
  left: string;
  funded: string | null;
}) {
  return (
    <span>
      <GameObjectArt kind={art} size={20} />
      <span className="pot-label">{label}</span>
      <span>
        <b>{goldCompact(left)}</b>
        {funded ? ` of ${goldCompact(funded)}` : ""} GOLD left
      </span>
    </span>
  );
}

/** Compact Explore-sheet element: what is left today, where it comes from. */
export function TodaysPot({
  practice,
  onOpen,
}: {
  practice: boolean;
  onOpen: () => void;
}) {
  const snapshot = useRewardFunding();
  const view = potView(snapshot);
  const button = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    void refreshRewardFunding();
    const online = () => void refreshRewardFunding(true);
    window.addEventListener("online", online);
    return () => window.removeEventListener("online", online);
  }, []);
  useEffect(() => {
    if (!returnFocusToPot) return;
    returnFocusToPot = false;
    const element = button.current;
    if (element && element.getClientRects().length > 0)
      element.focus({ preventScroll: false });
  }, []);
  const chip =
    view.kind === "ready" ? (
      <BooksChip books={view.books} />
    ) : view.kind === "practice" ? (
      <span className="pot-chip">Practice</span>
    ) : view.kind === "failed" && view.offline ? (
      <span className="pot-chip">
        <CloudSlash size={16} aria-hidden="true" />
        Offline
      </span>
    ) : null;
  return (
    <button
      ref={button}
      type="button"
      className="todays-pot"
      data-pot-state={view.kind}
      onClick={() => {
        returnFocusToPot = true;
        onOpen();
      }}
    >
      <span className="todays-pot-art" aria-hidden="true">
        <GameObjectArt kind="coin" size={32} />
      </span>
      <span className="todays-pot-body">
        <span className="todays-pot-title">
          <strong>Today's pot</strong>
          {chip}
        </span>
        <PotLines view={view} practice={practice} />
      </span>
      <ArrowRight size={20} aria-hidden="true" className="todays-pot-go" />
    </button>
  );
}

function Amount({ value }: { value: string | null | undefined }) {
  return value == null ? (
    <span className="pot-unavailable">Not available</span>
  ) : (
    <b className="pot-amount">{goldExact(value)} GOLD</b>
  );
}

/** "How rewards are funded": rules from docs/ECONOMY-RULES.md plus live reads. */
export function RewardFundingPage({
  practice,
  onExplore,
  onLedger,
}: {
  practice: boolean;
  onExplore: () => void;
  onLedger: () => void;
}) {
  const snapshot = useRewardFunding();
  const view = potView(snapshot);
  const root = useRef<HTMLElement>(null);
  useEffect(() => {
    void refreshRewardFunding();
    const panel = root.current?.closest<HTMLElement>(".main-panel");
    if (panel) panel.scrollTop = 0;
    panel
      ?.querySelector<HTMLElement>(".panel-heading h1")
      ?.focus({ preventScroll: true });
  }, []);
  const ready = view.kind === "ready" ? view : null;
  const treasury = ready?.treasury ?? null;
  const excludes = treasury?.excludes?.length
    ? treasury.excludes
    : Object.keys(EXCLUDED_NAMES);
  return (
    <article className="reward-funding" ref={root}>
      <p className="reward-funding-lead">
        Rewards are paid only from money the game has actually received: sponsor
        funding and realized staking yield. Explorers' own deposits never pay
        for rewards.
      </p>
      {practice && view.kind !== "practice" && (
        <p className="pot-callout">
          You're playing with practice GOLD. It is play money with no value and
          is kept separate from the funded pot below.
        </p>
      )}

      <section aria-labelledby="funding-today">
        <h2 id="funding-today">Today's pot</h2>
        {view.kind === "loading" && <p role="status">Checking today's pot…</p>}
        {view.kind === "practice" && (
          <p className="pot-callout">
            The funded pot isn't open here yet, so today's rewards are practice
            GOLD: play money with no value. No funded amounts are shown because
            none could be read.
          </p>
        )}
        {view.kind === "failed" && (
          <>
            <p className="pot-callout pot-callout-alert" role="status">
              {view.offline
                ? "You're offline, so the pot can't be checked. Your play is not affected."
                : "The pot couldn't be checked right now. Your play is not affected."}
            </p>
            <button
              type="button"
              className="pot-button"
              disabled={snapshot.loading}
              onClick={() => void refreshRewardFunding(true)}
            >
              <ArrowClockwise size={20} aria-hidden="true" />
              {snapshot.loading ? "Checking…" : "Try again"}
            </button>
          </>
        )}
        {ready && (
          <>
            {ready.today ? (
              <dl className="pot-facts">
                <div>
                  <dt>
                    <GameObjectArt kind="coin" size={24} />
                    Street coins
                  </dt>
                  <dd>
                    <Amount value={ready.today.coinsLeft} /> left
                    {ready.today.coinsFunded && (
                      <small>
                        of <Amount value={ready.today.coinsFunded} /> funded
                        today
                      </small>
                    )}
                  </dd>
                </div>
                <div>
                  <dt>
                    <GameObjectArt kind="place" size={24} />
                    Zone prizes
                  </dt>
                  <dd>
                    <Amount value={ready.today.prizesLeft} /> left
                    {ready.today.prizesFunded && (
                      <small>
                        of <Amount value={ready.today.prizesFunded} /> funded
                        today
                      </small>
                    )}
                  </dd>
                </div>
              </dl>
            ) : (
              <p>
                {ready.openDays
                  ? "No funded day is open yet today."
                  : "Today's amounts could not be read."}
              </p>
            )}
            {ready.openDays && ready.openDays.some((d) => !d.today) && (
              <>
                <h3>Other open days</h3>
                <ul className="pot-days">
                  {ready.openDays
                    .filter((d) => !d.today)
                    .map((d) => (
                      <li key={d.id}>
                        <span>{d.date ? dayLabel(d.date) : "Open day"}</span>
                        <span>
                          {goldExact(d.coinsLeft)} GOLD coins ·{" "}
                          {goldExact(d.prizesLeft)} GOLD prizes set aside
                        </span>
                      </li>
                    ))}
                </ul>
              </>
            )}
            <p className="pot-meta">
              {ready.stale && ready.treasuryObservedAt
                ? `Last confirmed ${clock(ready.treasuryObservedAt)}; current amounts could not be read.`
                : ready.booksObservedAt
                  ? `Amounts read at ${clock(ready.booksObservedAt)}.`
                  : ""}
            </p>
          </>
        )}
      </section>

      <section aria-labelledby="funding-sources">
        <h2 id="funding-sources">Where the money comes from</h2>
        <ul className="pot-sources">
          <li>
            <Handshake size={24} aria-hidden="true" />
            <span>
              <strong>Sponsors</strong>
              <small>Partners fund the global prize pool directly.</small>
            </span>
          </li>
          <li>
            <Plant size={24} aria-hidden="true" />
            <span>
              <strong>Realized yield</strong>
              <small>
                Explorers who stake can share part of the yield they actually
                receive. Expected or future yield never counts.
              </small>
              {ready?.source.kind === "mixed" && (
                <small>
                  Received so far: <Amount value={ready.source.yieldReceived} />
                </small>
              )}
              {ready?.source.kind === "sponsor" && (
                <small>No realized yield has arrived yet.</small>
              )}
            </span>
          </li>
        </ul>
        {ready && (
          <p>
            <strong>{sourceText(ready.source)}.</strong>{" "}
            {ready.source.kind === "unknown"
              ? "The split between the two could not be read right now."
              : ""}
          </p>
        )}
        <h3>Never used for rewards</h3>
        <ul className="pot-excludes">
          {excludes.map((e) => (
            <li key={e}>
              <Prohibit size={20} aria-hidden="true" />
              {EXCLUDED_NAMES[e] || e}
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="funding-split">
        <h2 id="funding-split">How the money is split</h2>
        <p>
          Every amount that comes in is split in half: 50&nbsp;% for street
          coins and 50&nbsp;% for zone prizes. An odd last unit goes to zones.
        </p>
        {treasury && (
          <>
            <div className="pot-buckets">
              {(
                [
                  ["coins", "Street coins", "coin"],
                  ["zones", "Zone prizes", "place"],
                ] as const
              ).map(([key, label, art]) => (
                <div className="pot-bucket" key={key}>
                  <h3>
                    <GameObjectArt kind={art} size={24} />
                    {label} · 50 %
                  </h3>
                  <dl>
                    <div>
                      <dt>Ready for new days</dt>
                      <dd>
                        <Amount value={treasury.buckets[key].available} />
                      </dd>
                    </div>
                    <div>
                      <dt>Set aside for open days</dt>
                      <dd>
                        <Amount value={treasury.buckets[key].reserved} />
                      </dd>
                    </div>
                    <div>
                      <dt>Paid to explorers</dt>
                      <dd>
                        <Amount value={treasury.buckets[key].awarded} />
                      </dd>
                    </div>
                  </dl>
                </div>
              ))}
            </div>
            <p>
              Funded in total: <Amount value={treasury.funded} />
            </p>
          </>
        )}
      </section>

      <section aria-labelledby="funding-rules">
        <h2 id="funding-rules">Who gets what</h2>
        <ul className="pot-rules">
          <li>
            <strong>Street coins.</strong> The first explorer to reach a coin
            collects it, and it disappears for everyone.
          </li>
          <li>
            <strong>Zone prizes.</strong> Tier 2 and Tier 3 zones carry a shared
            prize that pays once, to the first confirmed visit. Free zones give
            XP only.
          </li>
          <li>
            <strong>XP.</strong> You earn an activity's XP once per account,
            even after the shared prize is gone.
          </li>
          <li>
            <strong>Unclaimed rewards.</strong> When a day ends, what nobody
            collected goes back to the same half of the pot for later days. It
            is not shared out among players.
          </li>
        </ul>
      </section>

      <section aria-labelledby="funding-books">
        <h2 id="funding-books">Books checked</h2>
        {!ready || ready.books === "unchecked" ? (
          <p>
            {view.kind === "loading"
              ? "Checking…"
              : view.kind === "practice"
                ? "The books are checked once the funded pot is open here."
                : "The books could not be checked right now, so no result is shown."}
          </p>
        ) : (
          <>
            <p className="pot-books-summary">
              <BooksChip books={ready.books} />
              {ready.books === "checked"
                ? `All ${ready.checks.length} checks passed.`
                : "A check did not match. New days pause until it is fixed; collecting continues."}
            </p>
            <ul className="pot-checks">
              {ready.checks.map((c) => (
                <li key={c.name} data-ok={c.ok}>
                  {c.ok ? (
                    <CheckCircle size={20} weight="fill" aria-label="Passed" />
                  ) : (
                    <XCircle size={20} weight="fill" aria-label="Failed" />
                  )}
                  {CHECK_NAMES[c.name] || c.name}
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      <section aria-labelledby="funding-forecast">
        <h2 id="funding-forecast">Forecasts</h2>
        <p>
          No forecast or return rate is shown.{" "}
          {ready?.outlookReason ||
            "Rewards are counted only after money arrives."}
        </p>
      </section>

      <p className="pot-meta">
        GOLD is how the game shows amounts; it is not a separate coin. Practice
        GOLD is play money with no value.
      </p>
      <div className="pot-actions">
        <button
          type="button"
          className="pot-button"
          disabled={snapshot.loading}
          onClick={() => void refreshRewardFunding(true)}
        >
          <ArrowClockwise size={20} aria-hidden="true" />
          {snapshot.loading ? "Checking…" : "Check again"}
        </button>
        <button
          type="button"
          className="pot-button pot-button-primary"
          onClick={onExplore}
        >
          Back to exploring
          <ArrowRight size={20} aria-hidden="true" />
        </button>
      </div>
      <button type="button" className="play-entry" onClick={onLedger}>
        <ChartDonut size={24} aria-hidden="true" />
        <span>
          <b>Detailed ledger</b>
          <small>Advanced · exact accounting and staking pools</small>
        </span>
        <ArrowRight size={20} aria-hidden="true" />
      </button>
    </article>
  );
}
