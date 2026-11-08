import { useEffect, useRef } from "react";
import { ArrowRight } from "./dir-icons";
import { Dialog } from "./Dialog";
import { Ghost, AuraArt } from "./Ghost";
import { ActorPortrait } from "./ActorPortrait";
import { GameObjectArt } from "./game-object-art";
import { tr } from "./i18n";
import "./game-learning.css";

export function GameIntro({ manual = false, onStart, onSkip }: { manual?: boolean; onStart: () => void; onSkip: () => void }) {
  const title = useRef<HTMLHeadingElement>(null);
  useEffect(() => { const frame = requestAnimationFrame(() => title.current?.focus()); return () => cancelAnimationFrame(frame); }, []);
  return <Dialog label={tr("How to play")} onClose={onSkip}>
    <section className="game-intro">
      <header className="game-intro-head"><span className="game-intro-brand"><Ghost />QuestLayer</span>
        <button className="text-button" onClick={onSkip}>{manual ? tr("Close") : tr("Skip")}</button></header>
      <div><h1 ref={title} tabIndex={-1}>{tr("Your city has stories.")}</h1><p>{tr("Find a small adventure. Make it yours.")}</p></div>
      <div className="game-intro-principles">
        <section className="game-intro-principle">
          <div className="intro-scene intro-scene-walk" aria-hidden="true"><Ghost /><GameObjectArt kind="place" size={40} /></div>
          <div><h2>{tr("Explore")}</h2><p>{tr("Walk with GPS. Use the pad in the demo.")}</p></div>
        </section>
        <section className="game-intro-principle">
          <div className="intro-scene intro-scene-meet" aria-hidden="true"><Ghost /><ActorPortrait model="pilgrim" label="" /></div>
          <div><h2>{tr("Meet & solve")}</h2><p>{tr("Follow a clue, a trail or a short challenge.")}</p></div>
        </section>
        <section className="game-intro-principle">
          <div className="intro-scene intro-scene-wear" aria-hidden="true"><AuraArt edition="polar" slot="above" /></div>
          <div><h2>{tr("Wear your finds")}</h2><p>{tr("Collect XP. Try on Auras you actually find.")}</p></div>
        </section>
      </div>
      <p className="game-intro-note">{tr("Auras change your look, not your power.")}</p>
      <button className="primary-button" onClick={onStart}>{manual ? tr("Back to map") : tr("Let's explore")}<ArrowRight aria-hidden="true" /></button>
      <p className="game-intro-foot">{tr("You can reopen this guide in Help.")}</p>
    </section>
  </Dialog>;
}
