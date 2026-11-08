import { questDisplayTitle } from "./quest-copy";
import { useEffect, useState, type ReactNode } from "react";
import {
  ArrowRight,
  Check,
  Flag,
  MapPin,
  NavigationArrow,
  Sparkle,
} from "@phosphor-icons/react";
import type { Point, Quest, Zone } from "./types";
import { gold, meters, remaining } from "./api";
import { Badge, CoinIcon, distanceLabel } from "./app-bits";
import { tr } from "./i18n";
import LandmarkClue from "./LandmarkClue";
import { QuestThumbnail } from "./QuestThumbnail";
import "./zone-activities.css";

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
}: {
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
      <div className="zone-access">
        <Badge tone={zone.tier === 1 ? "green" : "purple"}>
          {zone.tier === 1 ? tr("Free zone") : tr("Tier {0}", { 0: zone.tier })}
        </Badge>
        <span>{tr("{0} activities", { 0: quests.length })}</span>
      </div>
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
                    if (selected) setCollapsed(true);
                    else {
                      setCollapsed(false);
                      onChoose(q.id);
                    }
                  }}
                  aria-expanded={selected}
                  aria-controls={`quest-${q.id}`}
                >
                  <QuestThumbnail quest={q} now={now} playerTier={playerTier} />
                  <span className="activity-row-copy">
                    <strong>{questDisplayTitle(q.title)}</strong>
                    <small>
                      {status(q)} · {distanceLabel(distance)}
                      {q.kind === "route"
                        ? ` · ${tr("{0}/{1} stops", { 0: q.checkpoint || 0, 1: q.checkpointCount })}`
                        : ""}
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
