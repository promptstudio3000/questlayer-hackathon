// Profile → Character, under the avatar (owner request, 10 Nov 2026): the
// same totals other explorers see on the player card, then the explorer's
// story: finds, quests, tasks, badges and stake moments, newest first.
// Data: GET /api/me/journey (server/player-journey.mjs).
import { useEffect, useState, type ReactNode } from "react";
import {
  ArrowFatUp,
  Flag,
  Flame,
  Gift,
  HandWaving,
  IdentificationCard,
  Medal,
  Scroll,
  Sparkle,
  Storefront,
} from "@phosphor-icons/react";
import { api, gold } from "./api";
import { CoinIcon } from "./app-bits";
import { ChainLink } from "./ChainLink";
import type { ChainRef } from "./chain-proof";
import { tr } from "./i18n";
import "./profile-journey.css";

type JourneyEvent = {
  id: string;
  kind: string;
  title: string;
  goldU: number;
  at: number;
  tier?: number;
  chain?: ChainRef;
};
export type Journey = {
  joinedAt: number | null;
  stats: {
    finds: number;
    quests: number;
    tasks: number;
    posted: number;
    monsters: number;
    wearables: number;
    badges: number;
    goldEarnedU: number;
  };
  timeline: JourneyEvent[];
};

const ICONS: Record<string, ReactNode> = {
  coin: <CoinIcon />,
  find: <Sparkle size={18} weight="duotone" />,
  quest: <Scroll size={18} weight="duotone" />,
  bounty: <Flag size={18} weight="duotone" />,
  task: <Flag size={18} weight="duotone" />,
  badge: <Medal size={18} weight="duotone" />,
  stake: <Flame size={18} weight="duotone" />,
  tier: <ArrowFatUp size={18} weight="duotone" />,
  sale: <Storefront size={18} weight="duotone" />,
  purchase: <Storefront size={18} weight="duotone" />,
  "earned-edition": <Gift size={18} weight="duotone" />,
  welcome: <HandWaving size={18} weight="duotone" />,
  native_profile: <IdentificationCard size={18} weight="duotone" />,
};

function label(e: JourneyEvent): string {
  switch (e.kind) {
    case "coin":
      return tr("Street coin");
    case "find":
      return tr("Street find");
    case "welcome":
      return tr("Your first steps");
    case "stake":
      return tr("Your fuel has matured");
    case "tier":
      return tr("Tier {0} is yours", { 0: e.tier ?? "" });
    default:
      return e.title;
  }
}

const day = (t: number) =>
  new Date(t).toLocaleDateString(undefined, { day: "numeric", month: "short" });
const time = (t: number) =>
  new Date(t).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });

/** Collapses runs of street coins into one row, so a walk is one line. */
function rows(events: JourneyEvent[]) {
  const out: (JourneyEvent & { count: number })[] = [];
  for (const e of events) {
    const last = out[out.length - 1];
    if (last && last.kind === "coin" && e.kind === "coin" && day(last.at) === day(e.at)) {
      last.count++;
      last.goldU += e.goldU;
      continue;
    }
    out.push({ ...e, count: 1 });
  }
  return out;
}

export function CharacterJourney({
  refreshKey,
  badges,
}: {
  /** Changes when XP or GOLD changes, so the story reloads after play. */
  refreshKey: string;
  /** The Badges chapter, shown between the totals and the story. */
  badges: ReactNode;
}) {
  const [data, setData] = useState<Journey | null>(null),
    [failed, setFailed] = useState(false),
    [all, setAll] = useState(false);
  useEffect(() => {
    let live = true;
    api<Journey>("/me/journey").then(
      (j) => {
        if (!live) return;
        setData(j);
        setFailed(false);
      },
      () => live && setFailed(true),
    );
    return () => {
      live = false;
    };
  }, [refreshKey]);

  const s = data?.stats;
  const stats: [string, ReactNode][] = s
    ? [
        [tr("Finds"), s.finds],
        [tr("Quests"), s.quests],
        [tr("Tasks"), s.tasks],
        [tr("Posted"), s.posted],
        [tr("Monsters"), s.monsters],
        [tr("Wearables"), s.wearables],
        [tr("Badges"), s.badges],
        ["QGOLD", gold(s.goldEarnedU)],
      ]
    : [];
  const story = data ? rows(data.timeline) : [];
  const shown = all ? story : story.slice(0, 8);
  return (
    <>
      {s && (
        <dl className="journey-stats" aria-label={tr("Your totals")}>
          {stats.map(([name, value]) => (
            <div key={name}>
              <dt>{name}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
      )}
      {badges}
      <section className="journey" aria-labelledby="journey-title">
        <h2 id="journey-title">
          {tr("Your story")}
          {data?.joinedAt && (
            <small>{tr("Exploring since")} {day(data.joinedAt)}</small>
          )}
        </h2>
        {failed && !data && <p className="journey-empty">{tr("Something went wrong.")}</p>}
        {!data && !failed && <p className="journey-empty">{tr("Loading…")}</p>}
        {data && story.length === 0 && (
          <p className="journey-empty">{tr("Nothing here yet")}</p>
        )}
        <ol className="journey-list">
          {shown.map((e) => (
            <li key={e.id} className={`journey-${e.kind}`}>
              <span className="journey-icon" aria-hidden="true">
                {ICONS[e.kind] ?? <Sparkle size={18} weight="duotone" />}
              </span>
              <span className="journey-text">
                <b>
                  {label(e)}
                  {e.count > 1 && <> × {e.count}</>}
                </b>
                <small>
                  {day(e.at)} · {time(e.at)}
                </small>
              </span>
              {e.goldU !== 0 && (
                <strong className={e.goldU > 0 ? "journey-plus" : ""}>
                  {e.goldU > 0 ? "+" : ""}
                  {gold(e.goldU)}
                </strong>
              )}
              {e.chain && e.count === 1 && <ChainLink chain={e.chain} />}
            </li>
          ))}
        </ol>
        {story.length > 8 && (
          <button type="button" className="journey-more" onClick={() => setAll((v) => !v)}>
            {all ? tr("Show less") : tr("Show all")}
          </button>
        )}
      </section>
    </>
  );
}
