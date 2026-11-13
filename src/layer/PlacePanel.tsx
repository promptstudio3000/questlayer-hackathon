import { Check, NavigationArrow } from "@phosphor-icons/react";
import { STARTER_SPRITE } from "../character-art";
import { GameObjectArt } from "../game-object-art";
import { Details } from "../ScreenTabs";
import { tr } from "../i18n";
import { PLACE_REACH, WORLD_PLACES, type WorldPlaceId } from "../../server/layer/story-world.mjs";
import { objectivePlace, placeName, placeTarget } from "./place-ui";
import { StoryBoard } from "./StoryBoard";
import type { ExpeditionProgress } from "./story-ui";

const TOUR: WorldPlaceId[] = ["treasury", "workshop", "hollow", "garden"];
export function PlaceDirectory({ progress, onPlace, tour = false }: {
  progress: ExpeditionProgress; onPlace: (id: WorldPlaceId) => void; tour?: boolean;
}) {
  const places = tour ? WORLD_PLACES.filter(place => TOUR.includes(place.id)) : WORLD_PLACES;
  return <ul className="ml-place-list">{places.map(place => <li key={place.id}><button className="secondary-button" onClick={() => onPlace(place.id)}>
    {progress.discoveries?.includes(place.id) ? <Check size={20} /> : <NavigationArrow size={20} />}
    <span>{placeName(place.id)}</span><small>{place.x.toFixed(0)}, {place.z.toFixed(0)}</small>
  </button></li>)}</ul>;
}

export function PlacePanel({ id, progress: p, position, busy, demoActors, onFace, onStory, onStart, onInteract, onObjective, onBuild, onActivity, onPlace }: {
  id: WorldPlaceId; progress: ExpeditionProgress; position: {x: number; y: number; z: number}; busy: boolean; demoActors: boolean;
  onFace: (id: WorldPlaceId) => void; onPlace: (id: WorldPlaceId) => void; onStory: () => void;
  onStart: () => void; onInteract: (body: Record<string,unknown>) => void; onObjective: () => void;
  onBuild: () => void; onActivity: () => void;
}) {
  const place = placeTarget(id), current = objectivePlace(p);
  const nearby = Math.hypot(position.x-place.x,position.z-place.z) <= PLACE_REACH && Math.abs(position.y-15) <= 3;
  const face = <button className="primary-button ml-wide" onClick={() => onFace(id)}>{tr("Face this place")}</button>;
  if (id === "nera") return <>
    <div className="ml-sheet-hero"><img src={STARTER_SPRITE} alt="" /><div><span className="section-label">{tr("Guide")}</span><h2>{placeName(id)}</h2></div></div>
    <p>{tr("The Fold scattered our signals. Bring light back to the square, one discovery at a time.")}</p>
    <div className="ml-story-actions">
      {p.quest.state === "available" ? nearby
        ? <button className="primary-button ml-wide" disabled={busy} onClick={onStart}>{tr("Accept expedition")}</button> : face
        : <button className="primary-button ml-wide" onClick={onObjective}>{tr("Face objective")}</button>}
      <button className="secondary-button ml-wide" onClick={onStory}>{tr("The Quiet Beacon")}</button>
    </div>
    <Details summary={tr("Meet the square")}><p>{tr("Find the treasury, the workshop, Crystal Hollow and the garden. Each visit stays in your field journal.")}</p>
      <p>{tr("{0} / {1} places found", {0: TOUR.filter(id=>p.discoveries?.includes(id)).length,1:TOUR.length})}</p><PlaceDirectory progress={p} onPlace={onPlace} tour />
    </Details>
  </>;
  if (id === "treasury") return <>
    <div className="ml-sheet-hero"><GameObjectArt kind="coin" state="locked" size={48} /><h2>{placeName(id)}</h2></div>
    <p className="badge">{tr("Treasury inactive")}</p>
    <p>{tr("This golden vault marks the future MetaGold treasury. It has no funded coin drops or spendable MetaGold yet.")}</p>
    <p>{tr("Play the expedition now. MetaGold rewards, MetaXP and NFTs need the reviewed NEAR integration.")}</p>
    <div className="ml-story-actions">{!nearby && face}<button className="primary-button ml-wide" onClick={onObjective}>{tr("Face objective")}</button>
      <button className="secondary-button ml-wide" onClick={onActivity}>{tr("Actions and NEAR proofs")}</button></div>
  </>;
  if (id === "workshop") return <>
    <div className="ml-sheet-hero"><img src={STARTER_SPRITE} alt="" /><h2>{placeName(id)}</h2></div>
    <p>{tr("Try a small shelter on the green ground outside this workshop. Choose Build, pick a block and aim at the ground.")}</p>
    {demoActors && <p className="ml-story-note">{tr("Tavi, Luma and Omi are demo explorers. They show the preview world in motion and are not online players.")}</p>}
    {nearby ? <button className="primary-button ml-wide" onClick={onBuild}>{tr("Build it myself")}</button> : face}
    <Details summary={tr("Build together")}><p>{tr("The green square is shared building space. The paths, guide, boards and workshop stay protected. Private parcels are not active yet.")}</p></Details>
  </>;
  if (current === id) return <>
    <p className="section-label">{placeName(id)} · {tr("Quest board")}</p>
    <StoryBoard progress={p} position={position} busy={busy} onStart={onStart} onInteract={onInteract} onFace={onObjective} onBuild={onBuild} onActivity={onActivity} />
  </>;
  const completed = id === "hollow" ? p.quest.state === "complete"
    : id === "quarry" ? p.story.quarry && p.story.basalt >= p.story.basaltGoal
    : id === "marker" ? p.story.marker : id === "beacon" ? p.story.stage === "complete" : p.story.signals.includes(id);
  const description = id === "hollow" ? tr("Mine 10 natural diamonds") : id === "quarry" ? tr("Visit the quarry and mine 6 basalt blocks.")
    : id === "marker" ? tr("Two spore stalk blocks, then a lamp. This public marker can be built by anyone.")
    : id === "beacon" ? tr("Return to the central beacon with your diamonds.") : tr("Read the inscription and tune its signal.");
  return <>
    <span className="section-label">{tr("Quest board")}</span><h2>{placeName(id)}</h2><p>{description}</p>
    <p className="ml-story-note">{completed ? tr("Complete") : tr("Continue the current chapter with Nera before tuning this place.")}</p>
    <div className="ml-story-actions">{!nearby && face}<button className="primary-button ml-wide" onClick={onObjective}>{tr("Face objective")}</button>
      <button className="secondary-button ml-wide" onClick={onStory}>{tr("The Quiet Beacon")}</button></div>
  </>;
}
