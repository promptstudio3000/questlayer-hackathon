// "How it works" one-pager (docs/HOW-IT-WORKS-PLAN.md). A lazily loaded page
// at /how-it-works that explains the game chapter by chapter. Every scene
// animates once when its chapter scrolls into view (CSS keyframes gated by
// data-inview) and shows its final state under reduced motion.
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import {
  ArrowDown,
  ArrowUp,
  BookOpen,
  Buildings,
  CalendarBlank,
  CastleTurret,
  CheckCircle,
  Coins,
  Compass,
  Crown,
  Eye,
  Flag,
  Footprints,
  HandCoins,
  Key,
  Lightning,
  LockSimple,
  LockSimpleOpen,
  MapPin,
  Mountains,
  Scales,
  Scroll,
  ShieldCheck,
  Sparkle,
  Storefront,
  Sword,
  Trophy,
  UserCircle,
  Vault,
} from "@phosphor-icons/react";
import { ArrowRight } from "../dir-icons";
import { Ghost } from "../Ghost";
import { GameObjectArt } from "../game-object-art";
import { AuraSprite } from "../aura-art";
import { AURA_SUPPLY, catalogEdition } from "../aura-catalog";
import { loadFeedbackPreferences, prefersReducedMotion } from "../feedback";
import {
  CHAPTERS,
  DAILY_ZONES,
  LEVEL_LADDER,
  MAX_LEVEL,
  PLACE_BADGE_COUNT,
  SAMPLE_PLACES,
  SEASON,
  STAKER_LADDER,
  STAKER_MIN_NEAR,
  TIER_NEAR,
  type ChapterId,
} from "./content";
import "./how-it-works.css";
import "../public-polish.css";
import { tr } from "../i18n";

const PLAY_URL = "/";
const stagger = (i: number) => ({ "--i": i }) as CSSProperties;

function useChapters(reduce: boolean) {
  const [seen, setSeen] = useState<ReadonlySet<string>>(
    () => new Set(reduce ? CHAPTERS.map((c) => c.id) : ["start"]),
  );
  const [active, setActive] = useState<ChapterId>("start");
  useEffect(() => {
    const sections = CHAPTERS.map((c) => document.getElementById(c.id)).filter(
      (s): s is HTMLElement => !!s,
    );
    if (typeof IntersectionObserver === "undefined") {
      setSeen(new Set(CHAPTERS.map((c) => c.id)));
      return;
    }
    const reveal = new IntersectionObserver(
      (entries) => {
        const shown = entries.filter((e) => e.isIntersecting).map((e) => e.target.id);
        if (shown.length)
          setSeen((prev) => (shown.every((id) => prev.has(id)) ? prev : new Set([...prev, ...shown])));
      },
      { threshold: 0.3 },
    );
    // A chapter is "current" while it crosses the upper third of the screen.
    const current = new IntersectionObserver(
      (entries) => {
        for (const e of entries) if (e.isIntersecting) setActive(e.target.id as ChapterId);
      },
      { rootMargin: "-30% 0px -65% 0px" },
    );
    for (const s of sections) {
      reveal.observe(s);
      current.observe(s);
    }
    return () => {
      reveal.disconnect();
      current.disconnect();
    };
  }, []);
  return { seen, active };
}

/** Eases a number from 0 to `to` once `active` turns true. */
function Counter({
  to,
  active,
  reduce,
  decimals = 0,
  duration = 1400,
  delay = 0,
}: {
  to: number;
  active: boolean;
  reduce: boolean;
  decimals?: number;
  duration?: number;
  delay?: number;
}) {
  const [value, setValue] = useState(reduce ? to : 0);
  useEffect(() => {
    if (!active || reduce) {
      if (reduce) setValue(to);
      return;
    }
    let frame = 0;
    const start = performance.now() + delay;
    const tick = (now: number) => {
      const t = Math.min(1, Math.max(0, (now - start) / duration));
      setValue(to * (1 - (1 - t) ** 3));
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [active, reduce, to, duration, delay]);
  const text = (n: number) =>
    n.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  return (
    <>
      <span aria-hidden="true">{text(value)}</span>
      <span className="hiw-sr">{text(to)}</span>
    </>
  );
}

function Chapter({
  id,
  seen,
  eyebrow,
  title,
  lead,
  chips,
  scene,
  flip = false,
  children,
}: {
  id: ChapterId;
  seen: ReadonlySet<string>;
  eyebrow: string;
  title: ReactNode;
  lead: ReactNode;
  chips?: readonly ReactNode[];
  scene: ReactNode;
  flip?: boolean;
  children?: ReactNode;
}) {
  const index = CHAPTERS.findIndex((c) => c.id === id);
  return (
    <section
      id={id}
      className={`hiw-chapter ${flip ? "flip" : ""}`}
      data-inview={seen.has(id)}
      aria-labelledby={`${id}-title`}
    >
      <div className="hiw-copy">
        <p className="hiw-eyebrow">
          <span>{String(index).padStart(2, "0")}</span> {eyebrow}
        </p>
        <h2 id={`${id}-title`}>{title}</h2>
        <p className="hiw-lead">{lead}</p>
        {chips && (
          <ul className="hiw-chips">
            {chips.map((c, i) => (
              <li key={i} style={stagger(i)}>
                {c}
              </li>
            ))}
          </ul>
        )}
        {children}
      </div>
      <div className="hiw-scene" aria-hidden="true">
        {scene}
      </div>
    </section>
  );
}

// 01 Walk: the ghost follows a route and picks up what it passes.
const ROUTE = "M24 176 C 70 176, 84 112, 128 112 S 196 150, 232 110 S 276 40, 300 36";
const ROUTE_PICKUPS = [
  { x: 70, y: 168, kind: "coin" as const, at: 0.18 },
  { x: 128, y: 112, kind: "coin" as const, at: 0.38 },
  { x: 196, y: 134, kind: "discovery" as const, at: 0.6 },
  { x: 262, y: 66, kind: "coin" as const, at: 0.82 },
];
const WALK_MS = 4200;
function WalkScene({ active, reduce }: { active: boolean; reduce: boolean }) {
  const motion = useRef<SVGAnimateMotionElement>(null);
  useEffect(() => {
    if (active && !reduce) motion.current?.beginElement?.();
  }, [active, reduce]);
  return (
    <div className="hiw-walk">
      <svg viewBox="0 0 320 210" className="hiw-walk-map">
        <g className="hiw-blocks">
          <rect x="8" y="8" width="88" height="70" rx="6" />
          <rect x="112" y="8" width="96" height="70" rx="6" />
          <rect x="8" y="94" width="60" height="58" rx="6" />
          <rect x="150" y="150" width="70" height="52" rx="6" />
          <rect x="236" y="130" width="76" height="72" rx="6" />
          <rect x="224" y="8" width="40" height="58" rx="6" />
          <circle cx="98" cy="190" r="16" className="park" />
        </g>
        <path d={ROUTE} className="hiw-route-shadow" />
        <path d={ROUTE} className="hiw-route" pathLength={1} />
        {ROUTE_PICKUPS.map((p, i) => (
          <g
            key={i}
            className="hiw-pickup"
            style={{ "--at": `${p.at * WALK_MS}ms` } as CSSProperties}
            transform={`translate(${p.x - 11} ${p.y - 11})`}
          >
            <g className="hiw-pickup-art">
              <svg width="22" height="22" viewBox="0 0 32 32">
                <GameObjectArt kind={p.kind} size={32} />
              </svg>
            </g>
            <text x="11" y="-4" className="hiw-pickup-label">
              {p.kind === "coin" ? "+0.01" : "+15 XP"}
            </text>
          </g>
        ))}
        <g transform={reduce ? "translate(300 36)" : undefined} className="hiw-walker">
          <image href="/assets/aavegotchi-starter-1278fb922f4e.svg" x="-18" y="-34" width="36" height="36" />
          {!reduce && (
            <animateMotion
              ref={motion}
              begin="indefinite"
              dur={`${WALK_MS}ms`}
              fill="freeze"
              path={ROUTE}
              calcMode="spline"
              keyTimes="0;1"
              keySplines="0.45 0 0.55 1"
            />
          )}
        </g>
      </svg>
      <div className="hiw-tally">
        <span>
          <GameObjectArt kind="coin" size={22} /> <Counter to={0.03} decimals={2} active={active} reduce={reduce} duration={WALK_MS} /> GOLD
        </span>
        <span>
          <Lightning size={20} weight="fill" /> <Counter to={45} active={active} reduce={reduce} duration={WALK_MS} /> XP
        </span>
      </div>
    </div>
  );
}

// 02 Daily zones: six zones light up, the free chest opens and an Aura rises.
function ZonesScene() {
  return (
    <div className="hiw-zones">
      <div className="hiw-zone-map">
        {DAILY_ZONES.map((z, i) => (
          <span key={z.id} className={`hiw-zone t${z.tier}`} style={stagger(i)}>
            {z.tier === 1 ? <MapPin size={18} weight="fill" /> : <LockSimple size={16} weight="bold" />}
            <b>{z.tier === 1 ? tr("Free") : tr("Tier {0}", { 0: z.tier })}</b>
          </span>
        ))}
        <div className="hiw-chest">
          <span className="hiw-chest-aura">
            <AuraSprite edition="polar" slot="above" size={2} animated={false} />
          </span>
          <span className="hiw-chest-closed">
            <GameObjectArt kind="chest" state="ready" size={64} />
          </span>
          <span className="hiw-chest-open">
            <GameObjectArt kind="chest" state="open" size={64} />
          </span>
        </div>
      </div>
      <ol className="hiw-zone-steps">
        <li style={stagger(0)}>
          <Footprints size={18} /> {" "}{tr("Trail")}</li>
        <li style={stagger(1)}>
          <Flag size={18} /> {" "}{tr("Visit")}</li>
        <li style={stagger(2)}>
          <Sparkle size={18} weight="fill" /> {" "}{tr("Chest")}</li>
      </ol>
    </div>
  );
}

// 03 Levels: the XP ring fills and the ladder lights rung by rung.
function LevelsScene({ active, reduce }: { active: boolean; reduce: boolean }) {
  const r = 52,
    c = 2 * Math.PI * r;
  return (
    <div className="hiw-levels">
      <div className="hiw-ring">
        <svg viewBox="0 0 128 128">
          <circle cx="64" cy="64" r={r} className="track" />
          <circle
            cx="64"
            cy="64"
            r={r}
            className="fill"
            style={{ "--c": c } as CSSProperties}
            strokeDasharray={c}
          />
        </svg>
        <span className="hiw-ring-label">
          <small>{tr("Level")}</small>
          <b>
            <Counter to={MAX_LEVEL} active={active} reduce={reduce} duration={2600} />
          </b>
        </span>
      </div>
      <ol className="hiw-ladder">
        {LEVEL_LADDER.map((l, i) => (
          <li key={l.level} style={stagger(i)}>
            <b>L{l.level}</b>
            <span>
              {l.unlock}
              {l.item && <em> · {l.item}</em>}
            </span>
            <small>{l.xp.toLocaleString("en-US")} XP</small>
          </li>
        ))}
      </ol>
    </div>
  );
}

// 04 Collectibles: cards deal in, one flips to its edition back, the ghost wears it.
const SHOWCASE = ["polar", "moon", "comet", "gold"] as const;
function CollectiblesScene() {
  return (
    <div className="hiw-collect">
      <div className="hiw-cards">
        {SHOWCASE.map((id, i) => {
          const e = catalogEdition(id);
          return (
            <div key={id} className={`hiw-card ${i === 3 ? "flips" : ""}`} style={stagger(i)}>
              <div className="hiw-card-face front" data-rarity={e?.rarity}>
                <AuraSprite edition={id} slot={e?.slot} size={2} animated={false} />
                <b>{e?.name}</b>
                <small>{e?.rarity}</small>
              </div>
              {i === 3 && (
                <div className="hiw-card-face back">
                  <ShieldCheck size={28} weight="duotone" />
                  <b>{tr("Edition")}</b>
                  <small>{AURA_SUPPLY ? tr("Max {0} ever", { 0: AURA_SUPPLY }) : tr("No supply cap")}</small>
                  <small>{tr("Secured on NEAR")}</small>
                </div>
              )}
            </div>
          );
        })}
      </div>
      <div className="hiw-wear">
        <span className="hiw-wear-aura">
          <AuraSprite edition="gold" slot="above" size={2} />
        </span>
        <Ghost className="hiw-wear-ghost" />
        <span className="hiw-switch">
          <span>{tr("Practice")}</span>
          <span>{tr("Secured")}</span>
          <i />
        </span>
      </div>
    </div>
  );
}

// 05 Badges: medals stamp onto real places.
const PLACE_ICON = { peak: Mountains, landmark: CastleTurret, city: Buildings } as Record<string, typeof Mountains>;
const PIN_SPOTS = [
  { x: 72, y: 22 },
  { x: 24, y: 40 },
  { x: 58, y: 66 },
  { x: 30, y: 78 },
];
function BadgesScene() {
  return (
    <div className="hiw-badges">
      <div className="hiw-badge-map">
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="hiw-badge-trail">
          <path d="M30 78 L58 66 L24 40 L72 22" pathLength={1} />
        </svg>
        {SAMPLE_PLACES.map((p, i) => {
          const Icon = PLACE_ICON[p.kind] ?? Eye;
          const spot = PIN_SPOTS[i];
          return (
            <span
              key={p.id}
              className="hiw-medal"
              style={{ ...stagger(i), left: `${spot.x}%`, top: `${spot.y}%` } as CSSProperties}
            >
              <span className="hiw-medal-disc">
                <Icon size={22} weight="duotone" />
              </span>
              <small>{p.name}</small>
            </span>
          );
        })}
      </div>
      <ul className="hiw-badge-kinds">
        <li style={stagger(0)}>
          <MapPin size={18} weight="fill" /> {" "}{tr("Place")}</li>
        <li style={stagger(1)}>
          <CalendarBlank size={18} weight="fill" /> {" "}{tr("Event")}</li>
        <li style={stagger(2)}>
          <Scroll size={18} weight="fill" /> {" "}{tr("Quest")}</li>
      </ul>
    </div>
  );
}

// 06 NPCs: cards slide in and speak; the trader merges three Auras into one.
const NPCS = [
  { id: "story", get name() { return tr("Storyteller"); }, get line() { return tr("Want to hear chapter one?"); }, icon: BookOpen, aura: "comet" },
  { id: "quest", get name() { return tr("Quest giver"); }, get line() { return tr("Three stops, one chest."); }, icon: Scroll, aura: "polar" },
  { id: "trader", get name() { return tr("Trader"); }, get line() { return tr("Three commons for a rare?"); }, icon: Storefront, aura: "gold" },
  { id: "keeper", get name() { return tr("Keeper"); }, get line() { return tr("The inner vault opens for stakers."); }, icon: Vault, aura: "moon" },
] as const;
function NpcScene() {
  return (
    <div className="hiw-npcs">
      <div className="hiw-npc-grid">
        {NPCS.map((n, i) => (
          <div key={n.id} className="hiw-npc" style={stagger(i)}>
            <span className="hiw-npc-art">
              <span className="hiw-npc-aura">
                <AuraSprite edition={n.aura} slot={catalogEdition(n.aura)?.slot} size={1} animated={false} />
              </span>
              <Ghost />
            </span>
            <span className="hiw-npc-name">
              <n.icon size={16} weight="bold" /> {n.name}
            </span>
            <span className="hiw-bubble">{n.line}</span>
          </div>
        ))}
      </div>
      <div className="hiw-npc-row">
        <div className="hiw-monster">
          <Sword size={26} weight="duotone" />
          <span>
            <b>{tr("Monster duel")}</b>
            <small>{tr("Win shards, XP and roll tickets")}</small>
          </span>
        </div>
        <div className="hiw-tradeup">
          <span className="in a">
            <AuraSprite edition="ember" slot="above" size={1} animated={false} />
          </span>
          <span className="in b">
            <AuraSprite edition="dew" slot="above" size={1} animated={false} />
          </span>
          <span className="in c">
            <AuraSprite edition="bloom" slot="above" size={1} animated={false} />
          </span>
          <ArrowRight size={18} weight="bold" className="arrow" />
          <span className="out">
            <AuraSprite edition="storm" slot="above" size={1} animated={false} />
          </span>
        </div>
      </div>
    </div>
  );
}

// 07 Staking: a deposit matures over two epochs, then gates open step by step.
function StakingScene({ active, reduce }: { active: boolean; reduce: boolean }) {
  return (
    <div className="hiw-stake">
      <div className="hiw-vault-row">
        <div className="hiw-vault">
          <span className="hiw-near-coin">
            {STAKER_MIN_NEAR}
            <small>NEAR</small>
          </span>
          <Vault size={64} weight="duotone" />
        </div>
        <ol className="hiw-epochs">
          {[tr("Deposit"), "E+1", "E+2"].map((e, i) => (
            <li key={e} style={stagger(i)}>
              <span />
              {e}
            </li>
          ))}
        </ol>
        <div className="hiw-staker-badge">
          <Crown size={22} weight="fill" /> {" "}{tr("Staker")}</div>
      </div>
      <ol className="hiw-gates">
        {STAKER_LADDER.map((r, i) => (
          <li key={r.key} style={stagger(i)}>
            <span className="hiw-lock">
              <LockSimple size={18} weight="bold" className="closed" />
              <LockSimpleOpen size={18} weight="bold" className="open" />
            </span>
            <span className="hiw-gate-step">
              {r.stepLabel} + L{r.level}
            </span>
            <span className="hiw-gate-what">{r.unlocks.join(" · ")}</span>
          </li>
        ))}
      </ol>
      <div className="hiw-pot">
        <span className="hiw-pot-label">
          <HandCoins size={18} weight="fill" /> {" "}{tr("One global prize pool, filled by yield")}</span>
        <span className="hiw-pot-bar">
          <i />
        </span>
        <span className="hiw-pot-note">
          {tr("Your principal:")}{" "}<Counter to={STAKER_MIN_NEAR} decimals={2} active={active} reduce={reduce} /> {" "}{tr("NEAR, still yours")}</span>
      </div>
    </div>
  );
}

// 08 Seasons: points from three kinds of play fill the bar to the goal.
function SeasonScene({ active, reduce }: { active: boolean; reduce: boolean }) {
  // An example finisher: 6 hunts, 6 zone visits, 4 NPC lines = 30 points.
  const mix = [
    { ...SEASON.points[0], count: 6 },
    { ...SEASON.points[1], count: 6 },
    { ...SEASON.points[2], count: 4 },
  ];
  return (
    <div className="hiw-season">
      <div className="hiw-season-head">
        <Trophy size={28} weight="duotone" />
        <span>
          <b>
            <Counter to={SEASON.goal} active={active} reduce={reduce} duration={2200} /> / {SEASON.goal}
          </b>{" "}
          {tr("season points")}</span>
      </div>
      <div className="hiw-season-bar">
        {mix.map((m, i) => (
          <span
            key={m.id}
            className={`seg ${m.id}`}
            style={{ ...stagger(i), flexGrow: (m.points * m.count) / SEASON.goal } as CSSProperties}
          >
            {m.count}× {m.label}
          </span>
        ))}
      </div>
      <ul className="hiw-season-points">
        {SEASON.points.map((p, i) => (
          <li key={p.id} style={stagger(i)}>
            <b>+{p.points}</b> {p.label}
          </li>
        ))}
      </ul>
      <ol className="hiw-ranks">
        {SEASON.ranks.map((r, i) => (
          <li key={r} style={stagger(i)}>
            {r}
            <small>{i === 0 ? tr("any points") : i === 1 ? tr("the goal") : tr("{0}× the goal", { 0: i })}</small>
          </li>
        ))}
      </ol>
    </div>
  );
}

const PRINCIPLES = [
  { icon: Eye, get title() { return tr("Looks, not power"); }, get text() { return tr("Auras and badges change how you look, never your odds, damage or payouts."); } },
  { icon: Scales, get title() { return tr("No betting"); }, get text() { return tr("Nothing to wager. Rolls and rewards are earned by playing."); } },
  { icon: Coins, get title() { return tr("Prizes from real yield"); }, get text() { return tr("Prizes come from received staking yield or sponsors, never from deposits."); } },
  { icon: Compass, get title() { return tr("Free first"); }, get text() { return tr("The first adventure works solo, with no wallet and no deposit."); } },
] as const;
function FairScene() {
  return (
    <ul className="hiw-principles">
      {PRINCIPLES.map((p, i) => (
        <li key={p.title} style={stagger(i)}>
          <p.icon size={30} weight="duotone" />
          <b>{p.title}</b>
          <span>{p.text}</span>
        </li>
      ))}
    </ul>
  );
}

const JOIN_STEPS = [
  { icon: UserCircle, get title() { return tr("Pick a name"); }, get text() { return tr("No sign-up, no e-mail, no deposit."); } },
  { icon: Footprints, get title() { return tr("Walk to your first coin"); }, get text() { return tr("The coach shows the nearest find on the map."); } },
  { icon: Sparkle, get title() { return tr("Open a chest, wear your Aura"); }, get text() { return tr("Your ghost changes on the map right away."); } },
  { icon: ShieldCheck, get title() { return tr("Secure it on NEAR"); }, get text() { return tr("A passkey keeps your game account safe."); }, optional: true },
  { icon: Crown, get title() { return tr("Stake {0} NEAR, become a Staker", { 0: STAKER_MIN_NEAR }); }, get text() { return tr("Opens the inner vault and patron lines."); }, optional: true },
] as const;

export default function HowItWorks() {
  const [reduce] = useState(() => {
    loadFeedbackPreferences();
    return prefersReducedMotion();
  });
  const { seen, active } = useChapters(reduce);
  const progress = useRef<HTMLDivElement>(null);
  const hero = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = document.documentElement;
    root.classList.add("hiw-root");
    const previousTitle = document.title;
    document.title = tr("How QuestLayer works");
    return () => {
      root.classList.remove("hiw-root");
      document.title = previousTitle;
    };
  }, []);

  // Deep link to a chapter (the page renders after the lazy chunk, so the
  // browser's own hash jump has already happened on an empty page).
  useEffect(() => {
    const id = decodeURIComponent(location.hash.slice(1));
    if (id && CHAPTERS.some((c) => c.id === id))
      document.getElementById(id)?.scrollIntoView({ block: "start" });
  }, []);

  // Progress bar and hero parallax: transform only, one frame per scroll.
  useEffect(() => {
    let frame = 0;
    const update = () => {
      frame = 0;
      const max = document.documentElement.scrollHeight - innerHeight;
      progress.current?.style.setProperty("--p", String(max > 0 ? scrollY / max : 0));
      if (!reduce) hero.current?.style.setProperty("--y", String(Math.min(scrollY, innerHeight)));
    };
    const onScroll = () => {
      frame ||= requestAnimationFrame(update);
    };
    update();
    addEventListener("scroll", onScroll, { passive: true });
    addEventListener("resize", onScroll);
    return () => {
      removeEventListener("scroll", onScroll);
      removeEventListener("resize", onScroll);
      cancelAnimationFrame(frame);
    };
  }, [reduce]);

  // Keyboard: step chapter by chapter (Arrow/Page keys, Space), Home and End.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
      const t = e.target as HTMLElement | null;
      if (t?.closest("input, textarea, select, [contenteditable]")) return;
      const sections = CHAPTERS.map((c) => document.getElementById(c.id)!).filter(Boolean);
      const tops = sections.map((s) => s.getBoundingClientRect().top);
      let target: HTMLElement | undefined;
      const forward = ["ArrowDown", "PageDown"].includes(e.key) || (e.key === " " && !e.shiftKey);
      const back = ["ArrowUp", "PageUp"].includes(e.key) || (e.key === " " && e.shiftKey);
      if (forward) target = sections[tops.findIndex((top) => top > 8)];
      else if (back) target = [...sections].reverse()[[...tops].reverse().findIndex((top) => top < -8)];
      else if (e.key === "Home") target = sections[0];
      else if (e.key === "End") target = sections[sections.length - 1];
      else return;
      if (e.key === " " && t?.closest("a, button")) return;
      if (!target) return;
      e.preventDefault();
      target.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [reduce]);

  const is = (id: ChapterId) => seen.has(id);

  return (
    <div className={`hiw ${reduce ? "hiw-still" : ""}`}>
      <div className="hiw-progress" ref={progress} aria-hidden="true" />
      <header className="hiw-top">
        <a className="hiw-brand" href={PLAY_URL}>
          <img src="/icon.svg" alt="" width={32} height={32} />
          <span>QuestLayer</span>
        </a>
        <a className="hiw-top-play" href={PLAY_URL}>
          {tr("Play now")}{" "}<ArrowRight size={18} weight="bold" />
        </a>
      </header>

      <nav className="hiw-rail" aria-label={tr("Chapters")}>
        <ol>
          {CHAPTERS.map((c) => (
            <li key={c.id}>
              <a href={`#${c.id}`} aria-current={active === c.id ? "step" : undefined}>
                <span className="hiw-rail-dot" />
                <span className="hiw-rail-label">{c.label}</span>
              </a>
            </li>
          ))}
        </ol>
      </nav>

      <main>
        <section id="start" className="hiw-hero" data-inview={is("start")} aria-labelledby="start-title">
          <div className="hiw-hero-bg" ref={hero} aria-hidden="true">
            <span className="street h one" />
            <span className="street h two" />
            <span className="street v one" />
            <span className="street v two" />
            <span className="street v three" />
          </div>
          <div className="hiw-hero-art" aria-hidden="true">
            <span className="hiw-hero-glow" />
            <span className="hiw-hero-aura">
              <AuraSprite edition="polar" slot="above" size={3} />
            </span>
            <Ghost className="hiw-hero-ghost" />
            {[0, 1, 2].map((i) => (
              <span key={i} className={`hiw-hero-coin c${i}`} style={stagger(i)}>
                <GameObjectArt kind="coin" size={40} />
              </span>
            ))}
          </div>
          <div className="hiw-hero-copy">
            <p className="hiw-eyebrow">{tr("How QuestLayer works")}</p>
            <h1 id="start-title">
              {tr("Your city is")}{" "}<em>{tr("the game board.")}</em>
            </h1>
            <p className="hiw-lead">
              {tr("Walk real streets, collect coins, open chests and dress your ghost in Auras that are truly yours. Stake a little NEAR when you want more, and its yield grows one prize pool shared by every city.")}</p>
            <div className="hiw-actions">
              <a className="hiw-button primary" href={PLAY_URL}>
                {tr("Start exploring")}{" "}<ArrowRight size={20} weight="bold" />
              </a>
              <a className="hiw-button ghost" href="#walk">
                {tr("See how it works")}{" "}<ArrowDown size={20} weight="bold" />
              </a>
            </div>
            <ul className="hiw-chips">
              <li style={stagger(0)}>{tr("Free to start")}</li>
              <li style={stagger(1)}>{tr("No wallet needed")}</li>
              <li style={stagger(2)}>{tr("Works on your phone")}</li>
            </ul>
          </div>
        </section>

        <Chapter
          id="walk"
          seen={seen}
          eyebrow={tr("Walk and collect")}
          title={tr("Walk. Every street hides something.")}
          lead={tr("Your phone's GPS moves your ghost on a real map. Street coins and sparkling finds appear along the way: walk up to them and they are yours.")}
          chips={[tr("Street coins"), tr("Sparkle finds"), tr("Honest GPS distance")]}
          scene={<WalkScene active={is("walk")} reduce={reduce} />}
        />

        <Chapter
          id="zones"
          seen={seen}
          flip
          eyebrow={tr("Daily zones")}
          title={tr("Six new zones every day.")}
          lead={tr("Each day every live city gets six zones with trails, visits and chests, all paid from the same global prize pool. Three are open to everyone; the others open as you stake. Chests hold Auras.")}
          chips={[tr("3 free"), tr("2 for Tier 2"), tr("1 for Tier 3")]}
          scene={<ZonesScene />}
        />

        <Chapter
          id="levels"
          seen={seen}
          eyebrow={tr("Levels")}
          title={tr("Level up to {0}. Every level opens something.", { 0: MAX_LEVEL })}
          lead={tr("Everything you do earns XP. Each level unlocks something to do or to wear: new Auras, rings, quest lines, a title. Never better odds.")}
          chips={[tr("Level n at 100·(n−1)² XP"), tr("Something new every level")]}
          scene={<LevelsScene active={is("levels")} reduce={reduce} />}
        />

        <Chapter
          id="collectibles"
          seen={seen}
          flip
          eyebrow={tr("Collectibles and editions")}
          title={tr("Wear what you earn. Own it on NEAR.")}
          lead={tr("Auras are the glow your ghost wears, above or below. There is no supply cap: they keep appearing as quest rewards and in chests at harder spots on the map. Secure one and it becomes yours on NEAR: keep it, wear it or trade it on the market.")}
          chips={[tr("Limited editions"), tr("Above and below slots"), tr("Market and traders")]}
          scene={<CollectiblesScene />}
        />

        <Chapter
          id="badges"
          seen={seen}
          eyebrow={tr("Badges")}
          title={tr("Collect the places you have really been.")}
          lead={tr("Stand on a summit, at a viewpoint or a landmark and a badge is yours. {0} notable places to start, and players can design their own place, event and quest badges, like a POAP.", { 0: PLACE_BADGE_COUNT })}
          chips={[tr("Real GPS check"), tr("POAP-like player badges"), tr("Soulbound, never sold")]}
          scene={<BadgesScene />}
        />

        <Chapter
          id="npcs"
          seen={seen}
          flip
          eyebrow={tr("NPCs, monsters and traders")}
          title={tr("The city is alive.")}
          lead={tr("Friendly ghosts roam the map. Storytellers and quest givers hand out quest lines, monsters wait for a duel, a weekly boss calls everyone out, and traders swap three Auras for a better one.")}
          chips={[tr("Quest lines"), tr("Monster duels"), tr("Weekly boss"), tr("Trade-ups")]}
          scene={<NpcScene />}
        />

        <Chapter
          id="staking"
          seen={seen}
          eyebrow={tr("Staking")}
          title={tr("Stake a little. Unlock a lot more.")}
          lead={
            <>
              {tr("From")}{" "}{STAKER_MIN_NEAR} {" "}{tr("NEAR (about 5 €) you become a")}{" "}<b>{tr("Staker")}</b>{tr(". Your NEAR stays yours and keeps earning staking yield; you choose how much of that yield goes to the global prize pool. There is one pool for the whole game, and each day's rewards land where people actually play. After two epochs your stake matures and new things open step by step, together with your level.")}</>
          }
          chips={[
            tr("Staker from {0} NEAR", { 0: STAKER_MIN_NEAR }),
            tr("Tier 2 from {0} NEAR, Tier 3 from {1}", { 0: TIER_NEAR.tier2, 1: TIER_NEAR.tier3 }),
            tr("One global prize pool"),
            tr("Withdraw any time"),
            tr("Unlocks to do and wear, never odds"),
          ]}
          scene={<StakingScene active={is("staking")} reduce={reduce} />}
        />

        <Chapter
          id="seasons"
          seen={seen}
          flip
          eyebrow={tr("Seasons")}
          title={tr("Seasons give every week a goal.")}
          lead={tr("A season runs about {0} days. Hunts, zone visits and NPC lines earn points, never money. Reach the goal for the season mark and the season Aura; go further for cosmetic ranks on the board.", { 0: SEASON.lengthDays })}
          chips={[tr("Points for play only"), tr("Cosmetic ranks"), tr("Season Aura for finishers"), tr("No streaks")]}
          scene={<SeasonScene active={is("seasons")} reduce={reduce} />}
        />

        <Chapter
          id="fair-play"
          seen={seen}
          eyebrow={tr("Fair play")}
          title={tr("Fair by design.")}
          lead={tr("Skill and walking win here. What you own makes you look good, and money never buys a better chance.")}
          scene={<FairScene />}
        />

        <section id="join" className="hiw-chapter hiw-join" data-inview={is("join")} aria-labelledby="join-title">
          <div className="hiw-copy">
            <p className="hiw-eyebrow">
              <span>{String(CHAPTERS.length - 1).padStart(2, "0")}</span> {" "}{tr("How to join")}</p>
            <h2 id="join-title">{tr("Start in under a minute.")}</h2>
            <ol className="hiw-steps">
              {JOIN_STEPS.map((s, i) => (
                <li key={s.title} style={stagger(i)} className={"optional" in s ? "optional" : undefined}>
                  <span className="hiw-step-icon">
                    <s.icon size={24} weight="duotone" />
                  </span>
                  <span>
                    <b>
                      {s.title}
                      {"optional" in s && <small> {" "}{tr("Optional")}</small>}
                    </b>
                    <span>{s.text}</span>
                  </span>
                  {!("optional" in s) && <CheckCircle size={22} weight="fill" className="hiw-step-check" />}
                </li>
              ))}
            </ol>
            <div className="hiw-actions">
              <a className="hiw-button primary" href={PLAY_URL}>
                {tr("Start exploring")}{" "}<ArrowRight size={20} weight="bold" />
              </a>
              <a className="hiw-button ghost" href="#start">
                <ArrowUp size={20} weight="bold" /> {" "}{tr("Back to the top")}</a>
            </div>
            <p className="hiw-fine">
              <Key size={16} /> {" "}{tr("QuestLayer never asks for your recovery phrase.")}</p>
            <p className="hiw-fine">
              <HandCoins size={16} /> {" "}<a href="/economy">{tr("See the prize pool ledger")}</a></p>
          </div>
        </section>
      </main>
    </div>
  );
}
