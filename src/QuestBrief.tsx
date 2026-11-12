import { useEffect, useRef, type ReactNode } from "react";
import { Clock, Flag, Footprints, MapPin, Question, Sparkle } from "@phosphor-icons/react";
import { ArrowRight } from "./dir-icons";
import { GameObjectArt, questObjectPresentation } from "./game-object-art";
import { distanceLabel } from "./app-bits";
import { questDisplayTitle } from "./quest-copy";
import { gold, remaining } from "./api";
import LandmarkClue from "./LandmarkClue";
import { tr } from "./i18n";
import { zoneInteriorMargin } from "./zone-presence";
import { questTarget, remainingQuestStops } from "./quest-route";
import { activityKind } from "./activity-view";
import { ActivityHelp } from "./ActivityHelp";
import { questHelpTopic } from "./activity-help";
import { useLearning } from "./useLearning";
import type { Fix, Point, Quest, Zone } from "./types";
import "./quest-brief.css";

/** Presentation only. Start focuses an activity; only onComplete can request its existing claim. */
export function QuestBrief({ compact = false, playerId, quest: q, zone, position, now, tier, arena, fix, online, distance, busy, started, choice, onChoose, onStart, onPoint, onLocate, onComplete, onMap, children }: {
  compact?: boolean; playerId?: string; quest: Quest; zone: Zone; now: number; tier: number; arena: boolean; distance: number; busy: boolean;
  started: boolean; position: Point; fix: Fix | null; online: boolean; choice?: string; onChoose: (choice: string) => void;
  onStart: () => void; onPoint: () => void; onLocate: () => void; onComplete: () => void; onMap: () => void; children?: ReactNode;
}) {
  const learning = useLearning(playerId);
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
  const activity = started || (q.checkpoint || 0) > 0;
  const steps = q.checkpointCount || q.activity?.steps.length || 1;
  const minimum = q.activity?.distanceLowerBoundM;
  const target = questTarget(q, position);
  const targetNumber = remainingQuestStops(q).find(p => p.lat === target.lat && p.lng === target.lng)?.number || (q.checkpoint || 0) + 1;
  const title = questDisplayTitle(q.title);
  const status = q.completed ? tr("Completed") : !online ? tr("You're offline") : zone.operatorPause ? tr("Not open now") : !open
    ? q.opens_at > now ? tr("opens in {0}", { 0: remaining(q.opens_at) }) : tr("Closed for today")
    : activity ? tr("In progress") : tr("Ready to start");
  const routeProgress = q.kind === "route" && !q.completed && open && online;
  // In the zone list the row already says the activity is open; only say what differs.
  const quietStatus = compact && !routeProgress && !q.completed && open && online && !activity;
  return <section className={`quest-detail quest-brief${compact ? " quest-brief-compact" : ""}`} role="region" aria-label={title} tabIndex={-1} id={"quest-" + q.id}>
    {!compact && <div className="quest-detail-art" aria-hidden="true"><GameObjectArt {...questObjectPresentation(q, { now, playerTier: tier })} size={112} /></div>}
    {!quietStatus && <p className={`quest-brief-status${routeProgress ? " quest-brief-progress" : ""}`}>{routeProgress ? <><strong>{q.visitedStops ? tr("Any order") : tr("Next stop")} · {tr("Stop {0} of {1}", {0: targetNumber, 1: steps})}</strong><br />{tr("Completed")} · {q.checkpoint || 0}/{steps}</> : status}</p>}
    <h2 className={compact ? "sr-only" : undefined} ref={heading} tabIndex={-1}>{title}</h2>
    <p className="quest-brief-description activity-objective">{q.activity?.objective || q.description}</p>
    {q.kind === "route" && <ol className="activity-step-diagram" aria-label={q.visitedStops ? tr("Any order") : tr("Activity overview")}>
      {Array.from({ length: steps }, (_, i) => <li key={i} data-done={(q.visitedStops ? q.visitedStops.includes(i) : i < (q.checkpoint || 0)) || undefined}>
        <span>{activityKind(q) === "return" && i === steps - 1 ? 1 : i + 1}</span>
        {activityKind(q) === "return" && i === steps - 1 && <small>{tr("Return")}</small>}
      </li>)}
    </ol>}
    {zone.operatorPause && <p role="status">{zone.operatorPause.reason}</p>}
    {q.nearPrize && <p className="quest-brief-requirement"><strong>{tr("NEAR testnet")}. </strong>{q.nearPrize.available ? tr("First confirmed completion: {0} NEAR, converted to QGOLD at settlement.", {0:q.nearPrize.amountNear}) : tr("The shared NEAR prize was already earned. Personal XP is still available.")}</p>}

    <div className="quest-brief-rewards" aria-label={tr("Rewards")}>
      <span><Sparkle aria-hidden="true" />{q.xp} XP</span>
      {q.kind === "chest" && <span><GameObjectArt kind="chest" size={24} />{q.completed ? tr("Completed") : q.itemAvailable === true ? tr("Aura chest") : q.itemAvailable === false ? tr("XP only · all Auras found") : tr("Aura not confirmed yet")}</span>}
      {q.gold_u > 0 && <span>{q.claimant ? tr("GOLD already collected") : `${gold(q.gold_u)} GOLD`}</span>}
    </div>
    {!compact && <ul className="quest-brief-facts" aria-label={tr("Activity overview")}>
      <li><Clock aria-hidden="true" /><span>{tr("Time varies")}</span></li>
      <li><Flag aria-hidden="true" /><span>{steps === 1 ? tr("1 stop") : tr("{0} stops", { 0: steps })}</span></li>
      <li><Footprints aria-hidden="true" /><span>{distanceLabel(distance)} · {tr("Straight-line distance")}</span></li>
      {typeof minimum === "number" && minimum > 0 && <li><Footprints aria-hidden="true" /><span>{tr("At least {0} m between stops", { 0: Math.round(minimum) })}</span></li>}
      {q.clue && <li><Question aria-hidden="true" /><span>{tr("1 question")}</span></li>}
    </ul>}
    {!q.completed && open && activity && <>
      {q.clue && !far && !outside && <LandmarkClue clue={q.clue} choice={choice} disabled={busy} onChoose={onChoose} />}
      {far && <p className="quest-brief-requirement">{tr("Be within {0} m of the pinned place to complete it.", { 0: 25 })}</p>}
      {!far && outside && <p className="quest-brief-requirement" role="status">{tr("Step inside the place first, then confirm your visit.")}</p>}
      {!far && !gpsReady && <p className="quest-brief-requirement" role="status">{tr("Needs a fresh, accurate GPS fix.")}</p>}
    </>}
    {q.completed || !open ? <button className="primary-button" onClick={onMap}>{tr("Back to map")}<ArrowRight aria-hidden="true" /></button>
      : !online ? <button className="primary-button" disabled>{tr("You're offline")}</button>
      : !activity ? <button className="primary-button" disabled={busy} onClick={onStart}>{far || outside ? tr("Guide me") : tr("Start quest")}<ArrowRight aria-hidden="true" /></button>
      : far || outside ? <button className="primary-button" disabled={busy} onClick={onPoint}>{tr("Guide me")}<ArrowRight aria-hidden="true" /></button>
      : !gpsReady ? <button className="primary-button" disabled={busy} onClick={onLocate}>{tr("Update location")}<MapPin aria-hidden="true" /></button>
      : <button className="primary-button" disabled={busy || (!!q.clue && !choice)} onClick={onComplete}>
        {busy ? tr("Checking visit…") : q.kind === "route" ? (q.checkpoint || 0) >= steps ? tr("Finish walk") : tr("Confirm stop {0}", { 0: targetNumber }) : q.kind === "chest" && q.itemAvailable === true ? tr("Open chest") : q.activity?.actionLabel || tr("Confirm visit")}<ArrowRight aria-hidden="true" />
      </button>}
    {q.clue && activity && !far && !outside && !choice && <p className="quest-brief-requirement">{tr("Choose an answer to continue.")}</p>}
    <div className="quest-brief-help">
    <ActivityHelp topic={questHelpTopic(q)} onAcknowledge={() => learning.acknowledge(questHelpTopic(q))} />
    <details className="quest-brief-more">
      <summary>{tr("Learn more")}</summary>
      <p>{tr("Straight-line distance")}: {distanceLabel(distance)} · {q.opens_at > now ? tr("opens in {0}", { 0: remaining(q.opens_at) }) : q.closes_at <= now ? tr("Closed for today") : tr("closes in {0}", { 0: remaining(q.closes_at) })}</p>
      <p>{tr("Duration is not available for this activity. Distance between stops is a minimum, not a walking route.")}</p>
      <p>{tr("Be within {0} m of the pinned place to complete it.", { 0: 25 })}{!arena && <> {tr("Needs a fresh, accurate GPS fix.")}</>}</p>
      {arena && <p>{tr("City demo: hold ↑ or W (or the pad) to run, Shift to walk. Real play moves only with your phone's GPS.")}</p>}
      {q.activity?.safety.instruction && <p>{q.activity.safety.instruction}</p>}
      {q.gold_u > 0 && <p>{tr("The GOLD prize goes to the first explorer to finish. Your XP is always yours.")}</p>}
      {q.clue?.result && <LandmarkClue clue={q.clue} choice={q.clue.result.choice} disabled onChoose={() => {}} />}
      {children}
    </details>
    </div>
  </section>;
}
