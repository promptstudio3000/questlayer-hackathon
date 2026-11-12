import { useEffect, useRef } from "react";
import { MapPin, ShieldCheck, Sparkle } from "@phosphor-icons/react";
import { ArrowRight } from "./dir-icons";
import { GameObjectArt, questObjectPresentation } from "./game-object-art";
import { distanceLabel } from "./app-bits";
import { questDisplayObjective, questDisplayTitle } from "./quest-copy";
import { gold, remaining } from "./api";
import LandmarkClue from "./LandmarkClue";
import { tr } from "./i18n";
import { zoneInteriorMargin } from "./zone-presence";
import { questTarget, remainingQuestStops } from "./quest-route";
import { activityKind } from "./activity-view";
import type { Fix, Point, Quest, Zone } from "./types";
import "./quest-brief.css";

/** Presentation only. Start focuses an activity; only onComplete can request its existing claim. */
export function QuestBrief({ quest: q, zone, position, now, tier, arena, fix, online, distance, busy, started, choice, onChoose, onPoint, onLocate, onComplete, onMap }: {
  quest: Quest; zone: Zone; now: number; tier: number; arena: boolean; distance: number; busy: boolean;
  started: boolean; position: Point; fix: Fix | null; online: boolean; choice?: string; onChoose: (choice: string) => void;
  onPoint: () => void; onLocate: () => void; onComplete: () => void; onMap: () => void;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  const wasStarted = useRef(started);
  useEffect(() => {
    if (started && !wasStarted.current) heading.current?.focus({ preventScroll: true });
    wasStarted.current = started;
  }, [started]);
  const open = !zone.operatorPause && zone.placeStatus !== "closed" && zone.opensAt <= now && zone.closesAt > now && q.opens_at <= now && q.closes_at > now && q.placeStatus !== "closed";
  const far = distance > 25;
  const outside = !!zone.geometry && zoneInteriorMargin(zone, position) === null;
  const gpsReady = arena || (!!fix && Number.isFinite(fix.accuracy) && fix.accuracy >= 0 && fix.accuracy <= 35 && Number.isFinite(fix.timestamp) && now - fix.timestamp <= 15000 && fix.timestamp <= now + 2000);
  const steps = q.checkpointCount || q.activity?.steps.length || 1;
  const target = questTarget(q, position);
  const targetNumber = remainingQuestStops(q).find(p => p.lat === target.lat && p.lng === target.lng)?.number || (q.checkpoint || 0) + 1;
  const title = questDisplayTitle(q.title);
  const status = q.completed ? tr("Completed") : !online ? tr("You're offline") : zone.operatorPause ? tr("Not open now") : !open
    ? q.opens_at > now ? tr("opens in {0}", { 0: remaining(q.opens_at) }) : tr("Closed for today")
    : "";
  const routeProgress = q.kind === "route" && !q.completed && open && online;
  const here = !far && !outside;
  // One reason at most, right above the one button it explains.
  const requirement = q.completed || !open || !online ? ""
    : !far && outside ? tr("Step inside the place first.")
    : here && !gpsReady ? tr("Needs a fresh, accurate GPS fix.")
    : here && q.clue && !choice ? tr("Choose an answer to continue.") : "";
  return <section className="quest-detail quest-brief" role="region" aria-label={title} tabIndex={-1} id={"quest-" + q.id}>
    {(routeProgress || status) && <p className={`quest-brief-status${routeProgress ? " quest-brief-progress" : ""}`}>{routeProgress ? <strong>{q.visitedStops ? tr("Any order") : tr("Next stop")} · {tr("Stop {0} of {1}", {0: targetNumber, 1: steps})}</strong> : status}</p>}
    <h2 className="sr-only" ref={heading} tabIndex={-1}>{title}</h2>
    <p className="quest-brief-description activity-objective">{questDisplayObjective(q.activity?.objective || q.description)}</p>
    {q.kind === "route" && <ol className="activity-step-diagram" aria-label={q.visitedStops ? tr("Any order") : tr("Activity overview")}>
      {Array.from({ length: steps }, (_, i) => <li key={i} data-done={(q.visitedStops ? q.visitedStops.includes(i) : i < (q.checkpoint || 0)) || undefined}>
        <span>{activityKind(q) === "return" && i === steps - 1 ? 1 : i + 1}</span>
        {activityKind(q) === "return" && i === steps - 1 && <small>{tr("Return")}</small>}
      </li>)}
    </ol>}
    {zone.operatorPause && <p role="status">{zone.operatorPause.reason}</p>}
    <div className="quest-brief-rewards" aria-label={tr("Rewards")}>
      <span><Sparkle aria-hidden="true" />{q.xp} XP</span>
      {q.kind === "chest" && <span><GameObjectArt kind="chest" size={24} />{q.completed ? tr("Completed") : q.itemAvailable === true ? tr("Aura chest") : q.itemAvailable === false ? tr("XP only") : tr("Aura not confirmed yet")}</span>}
      {q.gold_u > 0 && <span title={tr("The QGOLD prize goes to the first explorer to finish. Your XP is always yours.")}>{q.claimant ? tr("QGOLD already collected") : `${gold(q.gold_u)} QGOLD`}</span>}
      {q.nearPrize?.available && <span title={tr("First confirmed completion: {0} NEAR, converted to QGOLD at settlement.", {0:q.nearPrize.amountNear})}>{tr("QGOLD for the first finisher")}</span>}
      {q.activity?.safety.instruction && !q.completed && open && <span title={q.activity.safety.instruction}><ShieldCheck aria-hidden="true" />{tr("Public paths only")}</span>}
    </div>
    {!q.completed && open && here && q.clue && <LandmarkClue clue={q.clue} choice={choice} disabled={busy} onChoose={onChoose} />}
    {!!q.completed && q.clue?.result && <LandmarkClue clue={q.clue} choice={q.clue.result.choice} disabled onChoose={() => {}} />}
    {requirement && <p className="quest-brief-requirement" role="status">{requirement}</p>}
    {q.completed || !open ? <button className="primary-button" onClick={onMap}>{tr("Back to map")}<ArrowRight aria-hidden="true" /></button>
      : !online ? <button className="primary-button" disabled>{tr("You're offline")}</button>
      : far || outside ? <button className="primary-button" disabled={busy} onClick={onPoint}>{tr("Go")} · {distanceLabel(distance)}<ArrowRight aria-hidden="true" /></button>
      : !gpsReady ? <button className="primary-button" disabled={busy} onClick={onLocate}>{tr("Update location")}<MapPin aria-hidden="true" /></button>
      : <button className="primary-button" disabled={busy || (!!q.clue && !choice)} onClick={onComplete}>
        {busy ? tr("Checking visit…") : q.kind === "route" ? (q.checkpoint || 0) >= steps ? tr("Finish walk") : tr("Confirm stop {0}", { 0: targetNumber }) : q.kind === "chest" && q.itemAvailable === true ? tr("Open chest") : q.activity?.actionLabel || tr("Confirm visit")}<ArrowRight aria-hidden="true" />
      </button>}
  </section>;
}
