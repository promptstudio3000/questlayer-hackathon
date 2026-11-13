// "Game economy" (owner request, 13 Nov 2026): what the game is about in four
// small pictures, then the same stake form as Profile → Stake. Nothing
// technical here: chain details live in Settings and on /treasury.
import type { ComponentProps, ReactNode } from "react";
import { LockSimple, MapPin } from "@phosphor-icons/react";
import { ActorPortrait } from "./ActorPortrait";
import { FuelTheCity } from "./FuelTheCity";
import { GameObjectArt } from "./game-object-art";
import { Ghost } from "./Ghost";
import { tr } from "./i18n";
import "./game-economy.css";

/** A few streets with a pin: the real city is the board. */
function Streets() {
  return (
    <svg className="game-eco-streets" viewBox="0 0 64 64" aria-hidden="true">
      <path d="M-4 22 L68 14 M-4 48 L68 40 M18 -4 L26 68 M46 -4 L52 68" />
    </svg>
  );
}

export function GameLoop() {
  const steps: [string, string, string, ReactNode][] = [
    [
      "walk",
      tr("Walk"),
      tr("Your real streets are the map."),
      <>
        <Streets />
        <Ghost />
        <MapPin className="game-eco-pin" size={18} weight="fill" aria-hidden="true" />
      </>,
    ],
    [
      "collect",
      tr("Collect"),
      tr("Coins and quests pay QGOLD."),
      <>
        <GameObjectArt kind="chest" state="open" size={40} />
        <GameObjectArt kind="coin" size={24} className="game-eco-coin" />
        <GameObjectArt kind="coin" size={18} className="game-eco-coin two" />
      </>,
    ],
    [
      "stake",
      tr("Stake"),
      tr("It stays yours. Its yield fills the map."),
      <ActorPortrait model="keeper" label="" />,
    ],
    [
      "unlock",
      tr("Unlock"),
      tr("A bigger stake opens more places."),
      <>
        <GameObjectArt kind="chest" state="locked" size={40} />
        <LockSimple className="game-eco-lock" size={18} weight="fill" aria-hidden="true" />
      </>,
    ],
  ];
  return (
    <ol className="game-eco-steps" aria-label={tr("How the game works")}>
      {steps.map(([id, title, text, art], i) => (
        <li key={id} className={`game-eco-${id}`}>
          <span className="game-eco-art" aria-hidden="true">
            {art}
            <i>{i + 1}</i>
          </span>
          <span className="game-eco-copy">
            <b>{title}</b>
            {text}
          </span>
        </li>
      ))}
    </ol>
  );
}

export function GameEconomy(props: ComponentProps<typeof FuelTheCity>) {
  return (
    <section className="game-eco" aria-label={tr("Game economy")}>
      <GameLoop />
      <FuelTheCity {...props} guide />
    </section>
  );
}
