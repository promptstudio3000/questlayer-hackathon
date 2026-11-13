import { Check, Compass, Diamond, NavigationArrow, Cube, Lamp, Star, Waves, Plant } from "@phosphor-icons/react";
import { InfoTip } from "../InfoTip";
import { Details } from "../ScreenTabs";
import "../daily-board.css";
import "../landmark-clue.css";
import { tr } from "../i18n";
import { MARKER, SIGNAL_SITES } from "../../server/layer/story-world.mjs";
import { siteName, signalClue, storyObjective, type ExpeditionProgress } from "./story-ui";

export function StoryBoard({ view = "quests", progress: p, position, busy, onStart, onInteract, onFace, onBuild, onActivity }: {
  view?: "quests" | "journal"; progress: ExpeditionProgress; position: { x: number; z: number }; busy: boolean;
  onStart: () => void; onInteract: (body: Record<string, unknown>) => void;
  onFace: () => void; onBuild: () => void; onActivity: () => void;
}) {
  const s = p.story, objective = storyObjective(p),
    distance = objective.target ? Math.hypot(position.x - objective.target.x, position.z - objective.target.z) : Infinity;
  const nearby = distance <= 6;
  const chapters = [tr("A light below"), tr("Echoes in basalt"), tr("Three forgotten signals"), tr("A light for everyone"), tr("Wake the quiet beacon")];
  const chapter = ["expedition", "quarry", "signals", "marker", "beacon", "complete"].indexOf(s.stage);
  if (view === "journal") return <section className="daily-board-sheet">
    <h2>{tr("Field journal")}</h2>
    <ul aria-label={tr("Story progress")}>{chapters.map((title, i) => <li key={title} className={chapter > i ? "done" : undefined}><div className="daily-board-go">{chapter > i ? <Check size={20} /> : <Compass size={20} />}<span><b>{title}</b></span><small>{i + 1}/5</small></div></li>)}</ul>
    <Details summary={tr("Three forgotten signals")}><ul className="ml-station-list">{SIGNAL_SITES.map(site => <li key={site.id}>{s.signals.includes(site.id) && <Check size={16} />}<span>{siteName(site.id)}</span></li>)}</ul></Details>
  </section>;
  return <section className="daily-board-sheet">
    <div className="section-label ml-story-heading"><h2>{tr("The Quiet Beacon")}</h2><InfoTip label={tr("Keeper Nera")}>{tr("The Fold scattered our signals. Bring light back to the square, one discovery at a time.")}</InfoTip></div>
    <p className="daily-board-lead">{tr("Chapter {0} of {1}", { 0: Math.min(chapter + 1, 5), 1: 5 })} · {s.stage === "complete" ? tr("Complete") : tr("Solo or together")}</p>
    {!(s.stage === "expedition" && p.quest.state === "available") && <><h3>{objective.title}</h3><p>{objective.hint}</p></>}
    {s.stage === "expedition" && <>
      <ul className="ml-quest-steps">
        <li className={p.quest.state === "mine" || p.quest.state === "complete" ? "done" : undefined}><NavigationArrow size={22} /><span>{tr("Discover Crystal Hollow")}</span></li>
        <li className={p.quest.state === "complete" ? "done" : undefined}><Diamond size={22} /><span>{tr("Mine 10 natural diamonds")}</span><strong>{Math.min(p.quest.diamonds, p.quest.goal)}/{p.quest.goal}</strong></li>
      </ul>
      <p className="ml-story-note">{tr("The diamonds will focus the beacon. Keep them in your backpack.")}</p>
      {p.quest.state === "available" ? <button className="primary-button ml-wide" disabled={busy} onClick={onStart}>{tr("Accept expedition")}</button> : <button className="primary-button ml-wide" onClick={onFace}>{tr("Face the mine")}</button>}
    </>}
    {s.stage === "quarry" && <>
      <ul className="ml-quest-steps">
        <li className={s.quarry ? "done" : undefined}><NavigationArrow size={22} /><span>{tr("Discover Basalt Quarry")}</span></li>
        <li className={s.basalt >= s.basaltGoal ? "done" : undefined}><Cube size={22} /><span>{tr("Mine natural basalt")}</span><strong>{s.basalt}/{s.basaltGoal}</strong></li>
      </ul>
      <button className="primary-button ml-wide" onClick={onFace}>{tr("Face objective")}</button>
    </>}
    {s.stage === "signals" && <>
      <fieldset className="landmark-clue ml-runes"><legend>{signalClue(SIGNAL_SITES[s.signals.length].id)}</legend>
        {([
          ["spore", tr("Spore"), Plant], ["tide", tr("Tide"), Waves], ["star", tr("Star"), Star],
        ] as const).map(([symbol, label, Icon]) => <button className="clue-option" key={symbol} disabled={!nearby || busy} onClick={() => onInteract({ action: "signal", site: SIGNAL_SITES[s.signals.length].id, symbol })}><Icon size={20} /><span>{label}</span></button>)}
      </fieldset>
      <p className="ml-story-note">{nearby ? tr("Choose the sign described by the inscription.") : tr("Walk closer to tune this signal.")}</p>
      {!nearby && <button className="primary-button ml-wide" onClick={onFace}>{tr("Face objective")}</button>}
    </>}
    {s.stage === "marker" && <>
      <div className="ml-blueprint" aria-label={tr("Two spore stalk blocks and a lamp on top")}><Lamp size={28} /><Cube size={28} /><Cube size={28} /></div>
      <p>{tr("Two spore stalk blocks, then a lamp. This public marker can be built by anyone.")}</p>
      <p className="ml-coordinate">{MARKER.x}, {MARKER.z}</p>
      {nearby ? <div className="ml-story-actions">
        <button className="primary-button ml-wide" disabled={busy} onClick={() => onInteract({ action: s.markerReady ? "marker" : "build-marker" })}>{s.markerReady ? tr("Check the shared marker") : tr("Place marker template")}</button>
        <button className="secondary-button ml-wide" onClick={onBuild}>{tr("Build it myself")}</button>
      </div> : <button className="primary-button ml-wide" onClick={onFace}>{tr("Face objective")}</button>}
    </>}
    {s.stage === "beacon" && <>
      <p>{tr("Your diamonds hold the signal. Tune the beacon to light the square for everyone.")}</p>
      <button className="primary-button ml-wide" disabled={busy} onClick={nearby ? () => onInteract({ action: "beacon" }) : onFace}>{nearby ? tr("Restore beacon") : tr("Face objective")}</button>
    </>}
    {s.stage === "complete" && <>
      <div className="ml-story-complete"><Check size={30} /><p>{tr("Nera: The square has a voice again. Its next shape belongs to all of us.")}</p></div>
      <button className="primary-button ml-wide" onClick={onBuild}>{tr("Keep building")}</button>
    </>}
  </section>;
}
