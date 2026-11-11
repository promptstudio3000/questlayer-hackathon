// Animated scenes for the /wiki: the whole game in one strip, the phone map
// screen with its controls, and the map of screens. They use the game's own
// authored art (explorer sprite, pixel coin and chest) and Phosphor for
// utility icons. Motion only explains a state or a flow and stops under
// reduced motion (useMotion plus the CSS guard in wiki.css).
import React from "react";
import {
  ArrowsClockwise,
  Backpack,
  ChatsCircle,
  Coins,
  Compass,
  Fire,
  GearSix,
  Key,
  MapPin,
  NotePencil,
  Smiley,
  Sparkle,
  Stack,
  UserCircle,
  UsersThree,
  Vault,
  type Icon,
} from "@phosphor-icons/react";
import { GameObjectArt, gameObjectRects, type GameObjectKind } from "../game-object-art";
import { STARTER_SPRITE } from "../character-art";
import { useMotion } from "./viz";
import { EDITIONS, PLACE_BADGES } from "./chapters";

// ------------------------------------------------------- big picture ----

type Step = { icon: React.ReactNode; title: string; text: string };

const STEPS: Step[] = [
  {
    icon: <Vault size={36} weight="duotone" />,
    title: "Stake, lose nothing",
    text: "Stake NEAR if you like: the principal stays yours, only the share of its yield you choose goes to the game.",
  },
  {
    icon: <Coins size={36} weight="duotone" />,
    title: "One treasury",
    text: "All that yield lands in one global treasury and becomes each day's rewards, spread across the map.",
  },
  {
    icon: <img className="wk-bp-ghost" src={STARTER_SPRITE} alt="" width={44} height={50} draggable={false} />,
    title: "Play and create",
    text: "Walk real streets, solve quests at real places, meet NPCs, post tasks and hide Secrets.",
  },
  {
    icon: <GameObjectArt kind="coin" size={40} />,
    title: "Paid in QGOLD",
    text: "Rewards arrive within minutes as QGOLD, fully backed by NEAR, in your own NEAR account.",
  },
  {
    icon: <Fire size={36} weight="duotone" />,
    title: "Spend = burn",
    text: "Spending QGOLD burns it, so the NEAR behind every remaining token rises for all holders.",
  },
];

/** **bold** only: the fact cards are data, not chapter markup. */
const bold = (text: string) =>
  text
    .replace(/ %/g, "\u00a0%")
    .split(/\*\*([^*]+)\*\*/g)
    .map((t, i) => (i % 2 ? <b key={i}>{t}</b> : t));

type FactCard = { icon: Icon; title: string; facts: string[] };

const CARDS: FactCard[] = [
  {
    icon: MapPin,
    title: "Real streets",
    facts: [
      "**6** prize zones open in the city every day",
      "daily tasks at real places in every map cell, Wikidata riddles at landmarks",
      "NPCs out **07–22**, talking through NEAR AI Cloud; the rules set rewards, never the AI",
      `**${PLACE_BADGES}** notable places give a soulbound badge NFT`,
    ],
  },
  {
    icon: UsersThree,
    title: "Players create",
    facts: [
      "tasks paid in QGOLD through an on-chain escrow",
      "Secrets: the finder pays to reveal, the author gets **90 %**",
      "map notes that fade after a day or a week, topics, recommended places",
      "encrypted mail stored on NEAR Social",
    ],
  },
  {
    icon: Sparkle,
    title: "Collect and trade",
    facts: [
      `Auras: **${EDITIONS.length}** NFT editions on NEAR, each with a capped supply`,
      "peer-to-peer trades through NEAR Intents, **2 %** to the treasury",
      "NPC traders buy and sell the same way and send their profit to the treasury",
      "planned: real Aavegotchi wearables through the Aavegotchi marketplace",
    ],
  },
  {
    icon: Key,
    title: "Invisible blockchain",
    facts: [
      "every player gets an own NEAR account automatically",
      "its key never leaves the device; recover with a passkey or a linked wallet",
      "the game pays the gas for every game action",
      "a small deposit for storage and first own payments (**0.02 NEAR** on mainnet), with a capped daily top-up",
    ],
  },
  {
    icon: Stack,
    title: "One mechanic, many layers",
    facts: [
      "the theme can change; stake-to-play stays",
      "every community can build its own layer: its own world and rules on the same mechanics and QGOLD",
      "a layer's share of the yield follows what its players stake (planned)",
      "first: the 3D Space Layer, on testnet behind a switch",
    ],
  },
];

/** The TL;DR of the whole game: five steps a coin walks through, then the facts in five cards. */
export function BigPicture() {
  const motion = useMotion();
  return (
    <section className="wk-bp" aria-labelledby="wk-bp-title">
      <h2 id="wk-bp-title">
        <span className="wk-tldr-tag">TL;DR</span> QuestLayer in 30 seconds
      </h2>
      <p className="wk-bp-lead">
        <b>Pokémon GO + Geocaching + PoolTogether.</b> A stake-to-play game where your stake stays yours: by playing, exploring and creating, players win back the yield
        of everyone's stake.
      </p>
      <ol className={`wk-bp-steps${motion ? " moving" : ""}`}>
        {STEPS.map((s, i) => (
          <li key={s.title} style={{ "--i": i } as React.CSSProperties}>
            <span className="wk-bp-icon" aria-hidden="true">
              {s.icon}
            </span>
            <span className="wk-bp-copy">
              <b>{s.title}</b>
              <span>{s.text}</span>
            </span>
            {i < STEPS.length - 1 ? (
              <span className="wk-bp-link" aria-hidden="true">
                <i />
              </span>
            ) : null}
          </li>
        ))}
      </ol>
      <p className="wk-bp-loop">
        <ArrowsClockwise size={20} weight="bold" aria-hidden="true" />
        <span>
          Every day starts again. <strong>Nobody pays to win:</strong> no paid chance, no streaks, no pay-to-win, no stake needed to start; staker perks are only things to do or
          wear.
        </span>
      </p>
      <ul className="wk-bp-cards">
        {CARDS.map((c) => (
          <li key={c.title}>
            <span className="wk-bp-card-head">
              <c.icon size={22} weight="duotone" aria-hidden="true" />
              <b>{c.title}</b>
            </span>
            <ul>
              {c.facts.map((f) => (
                <li key={f}>{bold(f)}</li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </section>
  );
}

// ---------------------------------------------------------- phone hud ----

/** The authored 32 × 32 pixel object, drawn inside another SVG. */
function Pixel({ kind, x, y, size, className }: { kind: GameObjectKind; x: number; y: number; size: number; className?: string }) {
  return (
    <svg x={x} y={y} width={size} height={size} viewBox="0 0 32 32" shapeRendering="crispEdges" className={className} aria-hidden="true">
      {gameObjectRects({ kind, state: "ready", selected: false }).map((r, i) => (
        <rect key={i} x={r.x} y={r.y} width={r.width} height={r.height} fill={r.color} />
      ))}
    </svg>
  );
}

function Callout({ n, x, y }: { n: number; x: number; y: number }) {
  return (
    <g className="wk-hud-callout" transform={`translate(${x},${y})`}>
      <circle r={11} />
      <text y={4.5} textAnchor="middle">
        {n}
      </text>
    </g>
  );
}

const ACTION_ICONS: Icon[] = [NotePencil, ChatsCircle, MapPin, Smiley];

/** Phone map screen: what sits where, with the moving parts animated. */
function PhoneHud() {
  const motion = useMotion();
  const W = 300,
    H = 580;
  const fan = ACTION_ICONS.map((_, i) => {
    const a = (Math.PI / 2) * (i / (ACTION_ICONS.length - 1));
    return { x: 246 - Math.sin(a) * 62, y: 470 - Math.cos(a) * 62 };
  });
  return (
    <figure className="wk-fig wk-hud">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-labelledby="wk-hud-desc" className={`wk-hud-phone${motion ? " moving" : ""}`}>
        <desc id="wk-hud-desc">
          A phone showing the map screen: logo and daily board top left, avatar with the GOLD balance and the map settings gear top right, the explorer on a street with coins,
          a dashed direction guide to a quest marker, the joystick bottom left, the Actions button bottom right and the Explore, Inventory and Community tab bar at the bottom.
        </desc>
        <rect x={6} y={6} width={W - 12} height={H - 12} rx={38} className="wk-hud-body" />
        <rect x={18} y={18} width={W - 36} height={H - 36} rx={28} className="wk-hud-screen" />
        {/* streets and a park zone */}
        <g className="wk-hud-map">
          <path d="M18 330 L282 250" className="wk-hud-street" />
          <path d="M120 18 L170 562" className="wk-hud-street" />
          <path d="M18 170 L282 205" className="wk-hud-street thin" />
          <path d="M210 18 L250 562" className="wk-hud-street thin" />
          <path d="M60 380 L120 360 L132 450 L70 470 Z" className="wk-hud-zone" />
        </g>
        {/* direction guide: a straight line, never a walking route */}
        <path d="M150 300 L96 412" className="wk-hud-guide" />
        <g transform="translate(84,400)">
          <Pixel kind="chest" x={0} y={0} size={26} />
        </g>
        {/* coins on the street; one flies to the GOLD counter */}
        <Pixel kind="coin" x={196} y={262} size={16} />
        <Pixel kind="coin" x={236} y={250} size={16} />
        <Pixel kind="coin" x={174} y={273} size={16} className="wk-hud-fly" />
        {/* explorer */}
        <g className="wk-hud-explorer">
          <ellipse cx={150} cy={318} rx={16} ry={5} className="wk-hud-shadow" />
          <image href={STARTER_SPRITE} x={128} y={266} width={44} height={50} />
        </g>
        {/* top left: logo and the daily board */}
        <g transform="translate(30,32)">
          <rect width={84} height={34} rx={17} className="wk-hud-chip" />
          <circle cx={17} cy={17} r={11} className="wk-hud-logo" />
          <text x={36} y={22} className="wk-hud-text">
            0/3
          </text>
        </g>
        {/* top right: avatar + GOLD bubble, settings gear */}
        <g transform="translate(150,32)">
          <rect width={86} height={34} rx={17} className="wk-hud-chip" />
          <circle cx={17} cy={17} r={12} className="wk-hud-avatar" />
          <Pixel kind="coin" x={33} y={9} size={16} />
          <text x={52} y={22} className="wk-hud-text">
            12.4
          </text>
        </g>
        <g transform="translate(244,32)">
          <rect width={34} height={34} rx={17} className="wk-hud-chip" />
          <foreignObject x={7} y={7} width={20} height={20}>
            <GearSix size={20} className="wk-hud-ico" />
          </foreignObject>
        </g>
        {/* joystick */}
        <g transform="translate(64,470)">
          <circle r={34} className="wk-hud-joy" />
          <circle r={14} className="wk-hud-knob" />
        </g>
        {/* Actions fan */}
        <g className="wk-hud-fan">
          {fan.map((p, i) => {
            const I = ACTION_ICONS[i];
            return (
              <g key={i} transform={`translate(${p.x},${p.y})`}>
                <g className="wk-hud-fan-item" style={{ animationDelay: `${i * 0.08}s` }}>
                  <circle r={15} className="wk-hud-chip" />
                  <foreignObject x={-9} y={-9} width={18} height={18}>
                    <I size={18} className="wk-hud-ico" />
                  </foreignObject>
                </g>
              </g>
            );
          })}
        </g>
        <g transform="translate(246,470)">
          <circle r={24} className="wk-hud-actions" />
          <path d="M-8 0 H8 M0 -8 V8" className="wk-hud-plus" />
        </g>
        {/* tab bar */}
        <g transform="translate(18,512)">
          <rect width={W - 36} height={50} className="wk-hud-tabs" />
          {[Compass, Backpack, UsersThree].map((I, i) => (
            <g key={i} transform={`translate(${44 + i * 88},0)`}>
              <foreignObject x={-10} y={8} width={20} height={20}>
                <I size={20} className="wk-hud-ico" weight={i === 0 ? "fill" : "regular"} />
              </foreignObject>
              <text y={42} textAnchor="middle" className="wk-hud-tab-label">
                {["Explore", "Inventory", "Community"][i]}
              </text>
            </g>
          ))}
        </g>
        <Callout n={1} x={30} y={82} />
        <Callout n={2} x={204} y={82} />
        <Callout n={3} x={118} y={242} />
        <Callout n={4} x={106} y={372} />
        <Callout n={5} x={30} y={430} />
        <Callout n={6} x={274} y={430} />
        <Callout n={7} x={150} y={504} />
      </svg>
      <ol className="wk-hud-legend">
        <li>
          <b>Logo and today's board.</b> Three small goals a day; finishing all three pays +50 XP once.
        </li>
        <li>
          <b>Avatar + GOLD bubble</b> opens Profile. The gear opens Map settings: city demo or GPS, My location, Turn the map with me, Full map, City overview, Globe.
        </li>
        <li>
          <b>Coins collect themselves</b> when you pass them. A confirmed coin flies to the GOLD counter.
        </li>
        <li>
          <b>Direction guide</b> to the next target. A straight line with an X to hide it, never a walking route.
        </li>
        <li>
          <b>Joystick</b> (city demo only): up walks the way you face, sideways turns, down steps back. Arrows and WASD work too.
        </li>
        <li>
          <b>Actions</b> fans out: Leave a note, Open a topic, Add a place, Change mood; Post a task and Hide a Secret on the map-coins ledger; Create a quest for creators.
        </li>
        <li>
          <b>Tab bar:</b> Explore (the Nearby list), Inventory and Community. An open card sits on the tab bar and lifts the joystick and Actions above it.
        </li>
      </ol>
      <figcaption>The phone map screen. The map is home; everything else opens over it and closes back to it.</figcaption>
    </figure>
  );
}

// --------------------------------------------------------- screen map ----

type Screen = { icon: Icon; name: string; from: string; tabs: { name: string; sub?: string }[] };

const SCREENS: Screen[] = [
  {
    icon: Compass,
    name: "Explore",
    from: "tab bar",
    tabs: [
      { name: "Nearby list", sub: "All · Zones · Quests · NPCs · Community" },
      { name: "Sort", sub: "Nearest · Most XP · Top reward" },
      { name: "Today's coins", sub: "within 10 km or everywhere, pot left" },
    ],
  },
  {
    icon: Backpack,
    name: "Inventory",
    from: "tab bar",
    tabs: [
      { name: "Wardrobe", sub: "All · Auras · Wearables · Worn" },
      { name: "Shop", sub: "Items (GOLD) · Market (Auras)" },
    ],
  },
  {
    icon: UsersThree,
    name: "Community",
    from: "tab bar",
    tabs: [
      { name: "Quests" },
      { name: "Tasks" },
      { name: "Local chat", sub: "Notes · Shouts & topics" },
      { name: "Places" },
      { name: "Creators" },
    ],
  },
  {
    icon: UserCircle,
    name: "Profile",
    from: "avatar bubble",
    tabs: [
      { name: "Character", sub: "stats, badges, your story" },
      { name: "Stake", sub: "Stake · Earnings" },
      { name: "Settings", sub: "game, help, account, links" },
    ],
  },
];

/** Where everything lives: four screens over the map, with their tabs. */
function ScreenMap() {
  return (
    <figure className="wk-fig">
      <div className="wk-screens">
        <div className="wk-screens-home">
          <MapPin size={22} weight="duotone" aria-hidden="true" />
          <b>Map</b>
          <span>home: objective, coins, NPCs, zones</span>
        </div>
        <ul>
          {SCREENS.map((s) => (
            <li key={s.name} className="wk-screen">
              <span className="wk-screen-head">
                <s.icon size={22} weight="duotone" aria-hidden="true" />
                <b>{s.name}</b>
                <small>from the {s.from}</small>
              </span>
              <ul>
                {s.tabs.map((t) => (
                  <li key={t.name}>
                    {t.name}
                    {t.sub ? <small>{t.sub}</small> : null}
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      </div>
      <figcaption>Every screen opens over the map. On a desktop they open as a centred card over the dimmed map; on a phone full screen.</figcaption>
    </figure>
  );
}

export const SCENES = {
  "phone-hud": PhoneHud,
  "screen-map": ScreenMap,
} as const;
