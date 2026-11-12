import { questDisplayTitle } from "./quest-copy";
import { useEffect, useState, type ReactNode } from "react";
import {
  ArrowRight,
  Check,
  Clock,
  Flag,
  Gift,
  Sparkle,
} from "@phosphor-icons/react";
import type { Point, Quest, Zone } from "./types";
import { gold, meters, remaining } from "./api";
import { Badge, CoinIcon, distanceLabel } from "./app-bits";
import { tr } from "./i18n";
import LandmarkClue from "./LandmarkClue";
import { QuestThumbnail } from "./QuestThumbnail";
import { zoneSchedule } from "./zone-landmarks";
import "./zone-activities.css";

const at = (ms: number, timeZone?: string) => {
  try {
    return new Date(ms).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone });
  } catch {
    return new Date(ms).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  }
};

/** Today in this zone as one row of icon facts: open window, progress, what is left, reset. */
export function ZoneSchedule({ zone, quests, now, timezone }: { zone: Zone; quests: Quest[]; now: number; timezone?: string }) {
  const s = zoneSchedule(zone, quests, now, timezone);
  const allDay = s.closesAt >= s.resetAt - 60000;
  const window =
    s.phase === "upcoming"
      ? tr("Opens at {0} (in {1})", { 0: at(s.opensAt, timezone), 1: remaining(s.opensAt) })
      : s.phase === "open"
        ? allDay
          ? tr("Open now, all day")
          : tr("Open now until {0} (in {1})", { 0: at(s.closesAt, timezone), 1: remaining(s.closesAt) })
        : s.phase === "done"
          ? tr("Everything here is done for today")
          : tr("Closed for today");
  const windowShort =
    s.phase === "upcoming" ? at(s.opensAt, timezone)
      : s.phase === "open" ? (allDay ? tr("All day") : tr("Until {0}", { 0: at(s.closesAt, timezone) }))
        : s.phase === "done" ? tr("Done") : tr("Closed");
  const fact = (label: string, icon: ReactNode, text: string, tone?: string) => (
    <li title={label} data-tone={tone}>{icon}<span aria-hidden="true">{text}</span><span className="sr-only">{label}</span></li>
  );
  return (
    <ul className="zone-facts" aria-label={tr("Today in this zone")}>
      <li className="zone-facts-tier">
        <Badge tone={zone.tier === 1 ? "green" : "purple"}>
          {zone.tier === 1 ? tr("Free") : tr("Tier {0}", { 0: zone.tier })}
        </Badge>
      </li>
      {fact(window, <Clock size={16} aria-hidden="true" />, windowShort, s.phase === "open" ? "open" : "closed")}
      {fact(tr("Done today: {0} of {1} activities", { 0: s.done, 1: s.total }), <Flag size={16} aria-hidden="true" />, `${s.done}/${s.total}`)}
      {s.xp > 0 && fact(tr("Still to win today:") + " " + tr("{0} XP", { 0: s.xp }), <Sparkle size={16} aria-hidden="true" />, tr("{0} XP", { 0: s.xp }))}
      {s.gold_u > 0 && fact(tr("Still to win today:") + " " + tr("{0} QGOLD", { 0: gold(s.gold_u) }), <CoinIcon />, gold(s.gold_u))}
      {s.loot.length > 0 && fact(tr("Still to win today:") + " " + tr("chest Auras: {0}", { 0: s.loot.map((l) => l.name).join(", ") }), <Gift size={16} aria-hidden="true" />, String(s.loot.length))}
    </ul>
  );
}

export function ZoneActivities({
  zone,
  quests,
  selectedQuest,
  playerTier,
  position,
  now,
  busy,
  choices,
  onChoose,
  onClue,
  onGuide,
  onComplete,
  lockedContent,
  renderDetail,
  timezone,
}: {
  timezone?: string;
  zone: Zone;
  quests: Quest[];
  selectedQuest?: Quest;
  playerTier: number;
  position: Point;
  now: number;
  busy: string | null;
  choices: Record<string, string>;
  lockedContent: ReactNode;
  renderDetail: (q: Quest) => ReactNode;
  onChoose: (id: string) => void;
  onClue: (id: string, choice: string) => void;
  onGuide: (q: Quest) => void;
  onComplete: (id: string) => void;
}) {
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => setCollapsed(false), [zone.id, selectedQuest?.id]);
  const status = (q: Quest) =>
    q.completed
      ? tr("Completed")
      : now < q.opens_at
        ? tr("Not open yet")
        : now >= q.closes_at
          ? tr("Closed for today")
          : tr("OPEN");
  return (
    <section
      className="zone-activity-panel"
      aria-label={tr("Choose another activity")}
    >
      <ZoneSchedule zone={zone} quests={quests} now={now} timezone={timezone} />
      {zone.tier > playerTier ? (
        lockedContent
      ) : (
        <div className="zone-activity-list">
          {quests.map((q) => {
            const selected = q.id === selectedQuest?.id && !collapsed;
            const point = q.nextPoint || q;
            const distance = meters(position, point);
            const open = q.opens_at <= now && now < q.closes_at;
            return (
              <article
                className={`zone-activity${selected ? " is-selected" : ""}`}
                key={q.id}
              >
                <button
                  className="activity-row"
                  data-quest-id={q.id}
                  onClick={() => {
                    setCollapsed(false);
                    onChoose(q.id);
                  }}
                  aria-expanded={selected}
                  aria-controls={`quest-${q.id}`}
                >
                  <QuestThumbnail quest={q} now={now} playerTier={playerTier} />
                  <span className="activity-row-copy">
                    <strong>{questDisplayTitle(q.title)}</strong>
                    <small>
                      {[open && !q.completed ? "" : status(q), distanceLabel(distance), tr("{0} XP", { 0: q.xp }),
                        q.kind === "route" ? tr("{0}/{1} stops", { 0: q.checkpoint || 0, 1: q.checkpointCount }) : ""].filter(Boolean).join(" · ")}
                    </small>
                  </span>
                  {q.completed ? <Check size={20} /> : <ArrowRight size={20} />}
                </button>
                {selected && renderDetail(q)}
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
