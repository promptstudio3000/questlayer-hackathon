// Every picture in the wiki, keyed by the VizId a chapter block names.
// Static diagrams are data for the primitives in viz.tsx; the few live ones
// read public read-only endpoints and fall back to the documented targets.
import React, { useEffect, useMemo, useState } from "react";
import type { VizId } from "./chapters";
import { EDITIONS, GOLD, LEVELS, STAKER_GATES, STAKER_MIN_NEAR } from "./chapters";
import { Bars, Donut, Flow, LineChart, Sequence, StackBar, Timeline24, type Tone } from "./viz";
import { SCENES } from "./scenes";
export { BigPicture } from "./scenes";

const useJson = <T,>(url: string): T | null => {
  const [data, setData] = useState<T | null>(null);
  useEffect(() => {
    let alive = true;
    fetch(url, { headers: { accept: "application/json" } })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => alive && setData(j))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [url]);
  return data;
};

const pragueHour = () => {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Prague", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date());
  const h = Number(parts.find((p) => p.type === "hour")?.value ?? 0),
    m = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
  return h + m / 60;
};

// ------------------------------------------------------------ overview ----

function Architecture() {
  return (
    <Flow
      title="Architecture: the phone talks to one game server; money and ownership settle on NEAR."
      width={720}
      height={340}
      nodes={[
        { id: "phone", x: 90, y: 50, label: "Phone / browser", sub: "React + MapLibre", tone: "player", pulse: true },
        { id: "server", x: 300, y: 50, label: "Game server", sub: "rules · GPS checks", tone: "core" },
        { id: "db", x: 510, y: 50, label: "SQLite (WAL)", sub: "exactly-once ledger", tone: "core" },
        { id: "poi", x: 650, y: 165, w: 120, label: "POI database", sub: "OSM · Overture", tone: "world" },
        { id: "key", x: 90, y: 165, label: "Device key", sub: "signs NEAR actions", tone: "player" },
        { id: "ai", x: 300, y: 165, label: "AI providers", sub: "NEAR AI · Ollama", tone: "ai" },
        { id: "workers", x: 510, y: 165, w: 120, label: "Workers", sub: "rewards · keepers", tone: "core" },
        { id: "relayer", x: 200, y: 290, label: "Relayer", sub: "NEP-366 · pays gas", tone: "chain" },
        { id: "near", x: 510, y: 290, w: 200, h: 60, label: "NEAR contracts", sub: "rewards · QGOLD · NFTs · Intents", tone: "chain", pulse: true },
      ]}
      edges={[
        { from: "phone", to: "server", label: "HTTPS + SSE", flow: true, tone: "core" },
        { from: "server", to: "db", flow: true, tone: "core" },
        { from: "db", to: "workers", tone: "core" },
        { from: "poi", to: "db", dashed: true, label: "read-only", tone: "world" },
        { from: "server", to: "ai", dashed: true, tone: "ai" },
        { from: "phone", to: "key", tone: "player" },
        { from: "key", to: "relayer", label: "signed delegate", flow: true, tone: "chain" },
        { from: "relayer", to: "near", flow: true, tone: "chain" },
        { from: "workers", to: "near", label: "publish · claim", flow: true, tone: "chain" },
      ]}
    />
  );
}

function MoneyModes() {
  return (
    <Flow
      title="Every coin is backed: play earns QGOLD from the funded daily budget, a payout round every 5 minutes mints it, spending burns it."
      width={720}
      height={230}
      nodes={[
        { id: "play", x: 90, y: 115, label: "Your play", sub: "coins · quests · wins", tone: "player", pulse: true },
        { id: "xp", x: 300, y: 40, label: "XP → QXP", sub: "soulbound", tone: "core" },
        { id: "gold", x: 300, y: 115, label: "On its way", sub: "coins · zone prizes", tone: "money" },
        { id: "near", x: 300, y: 190, label: "Funded NEAR days", sub: "Plzeň ledger", tone: "money" },
        { id: "qgold", x: 560, y: 190, label: "QGOLD", sub: "your NEAR account", tone: "money" },
        { id: "burn", x: 560, y: 115, label: "Cosmetics", sub: "spend = ft_burn", tone: "muted" },
        { id: "lvl", x: 560, y: 40, label: "Levels & gates", tone: "core" },
      ]}
      edges={[
        { from: "play", to: "xp", flow: true, tone: "core" },
        { from: "play", to: "gold", flow: true, tone: "muted" },
        { from: "play", to: "near", flow: true, tone: "money" },
        { from: "near", to: "qgold", label: "Claim as QGOLD", flow: true, tone: "money" },
        { from: "gold", to: "qgold", label: "Payout round (5 min)", flow: true, tone: "money" },
        { from: "qgold", to: "burn", tone: "muted" },
        { from: "xp", to: "lvl", tone: "core" },
      ]}
    />
  );
}

// ---------------------------------------------------------------- play ----

function CoreLoop() {
  return (
    <Flow
      title="The core loop: every step ends in a confirmed result that feeds the next one."
      width={720}
      height={300}
      nodes={[
        { id: "walk", x: 360, y: 40, label: "Walk (GPS)", tone: "player", pulse: true },
        { id: "collect", x: 600, y: 110, label: "Collect coins & finds", tone: "money" },
        { id: "zone", x: 560, y: 240, label: "Zones & quests", tone: "world" },
        { id: "actors", x: 160, y: 240, label: "NPCs & monsters", tone: "ai" },
        { id: "grow", x: 120, y: 110, label: "XP · Auras · badges", tone: "core" },
      ]}
      edges={[
        { from: "walk", to: "collect", flow: true, tone: "player", bend: -0.3 },
        { from: "collect", to: "zone", flow: true, tone: "money", bend: -0.3 },
        { from: "zone", to: "actors", flow: true, tone: "world", bend: -0.3 },
        { from: "actors", to: "grow", flow: true, tone: "ai", bend: -0.3 },
        { from: "grow", to: "walk", label: "next goal", flow: true, tone: "core", bend: -0.3 },
      ]}
    />
  );
}

function MapCoins() {
  return (
    <Bars
      title="Every coin of a day is worth the same share of the map budget; a pioneer coin (a cell nobody visited for 30 days) counts twice. Coin size on the map is only drawing."
      bars={[
        { label: "Normal coin", value: 1, tone: "money", note: "1 share" },
        { label: "Pioneer coin", value: 2, tone: "warn", note: "2 shares" },
      ]}
      max={2}
      format={(v) => `× ${v}`}
    />
  );
}

function PayoutRound() {
  return (
    <Flow
      title="From a picked-up coin to QGOLD in your account: one round every 5 minutes, one Merkle root per round, 8 accounts per transaction."
      width={720}
      height={250}
      nodes={[
        { id: "coin", x: 90, y: 60, label: "Coin confirmed", sub: "server receipt, exactly once", tone: "player", pulse: true },
        { id: "way", x: 300, y: 60, label: "On its way", sub: "Profile · Stake · Earnings", tone: "money" },
        { id: "round", x: 520, y: 60, w: 150, label: "Round every 5 min", sub: "sum per account → root", tone: "core" },
        { id: "claim", x: 520, y: 190, w: 150, label: "claim_payout", sub: "8 leaves per transaction", tone: "chain" },
        { id: "mint", x: 300, y: 190, label: "QGOLD vault", sub: "mint_for at rate R", tone: "chain", pulse: true },
        { id: "you", x: 90, y: 190, label: "Your NEAR account", sub: "QGOLD balance", tone: "money" },
      ]}
      edges={[
        { from: "coin", to: "way", flow: true, tone: "player" },
        { from: "way", to: "round", label: "≥ 1 min old", flow: true, tone: "money" },
        { from: "round", to: "claim", label: "publish_payout_day", flow: true, tone: "core" },
        { from: "claim", to: "mint", flow: true, tone: "chain" },
        { from: "mint", to: "you", flow: true, tone: "money" },
      ]}
    />
  );
}

function WearableRarity() {
  return (
    <Bars
      title="Share of wearable finds by rarity. A wearable find is a free in-game clone of an official Aavegotchi wearable: cosmetic, not an NFT, no GOLD value."
      bars={[
        { label: "Common", value: 40, tone: "muted" },
        { label: "Uncommon", value: 26, tone: "world" },
        { label: "Rare", value: 18, tone: "chain" },
        { label: "Legendary", value: 10, tone: "money" },
        { label: "Mythical", value: 5, tone: "player" },
        { label: "Godlike", value: 1, tone: "core" },
      ]}
      max={40}
      format={(v) => `${v} %`}
    />
  );
}

function InboxSeq() {
  return (
    <Sequence
      title="A private message: sealed on the sender's device, stored on NEAR Social as ciphertext, opened only on the recipient's device."
      lanes={["Sender device", "NEAR Social", "Game server", "Recipient device"]}
      msgs={[
        { from: 0, to: 1, label: "Read recipient's inbox key", tone: "player" },
        { from: 0, to: 0, label: "Seal: X25519 + XChaCha20", tone: "player" },
        { from: 0, to: 1, label: "Write ciphertext (relayer pays)", tone: "chain" },
        { from: 2, to: 1, label: "Read exact record → delivered", tone: "core" },
        { from: 3, to: 1, label: "Read the sealed record", tone: "player" },
        { from: 3, to: 3, label: "Open with own secret key", tone: "player" },
      ]}
    />
  );
}

function DayClock() {
  const waves = Array.from({ length: 6 }, (_, i) => {
    const from = 7 + i * 2.5;
    return { from, to: from + 0.35, label: `W${i + 1}`, tone: "money" as Tone };
  });
  return (
    <Timeline24
      title="A world day in local time. The line is the current time in Prague."
      now={pragueHour()}
      rows={[
        { label: "NPCs & monsters", spans: [{ from: 7, to: 22, label: "07–22", tone: "ai" }] },
        { label: "POI quests", spans: [{ from: 8, to: 20, label: "08–20", tone: "world" }] },
        { label: "Coin waves (±30 min)", spans: waves },
        { label: "Tier 1 zones", spans: [{ from: 0, to: 24, label: "all day", tone: "core" }] },
        { label: "Tier 2 timed zone", spans: [{ from: 12, to: 15, label: "3 h", tone: "warn" }] },
        { label: "Tier 3 zone", spans: [{ from: 18, to: 19, label: "1 h", tone: "chain" }] },
        { label: "New board & day", spans: [{ from: 0, to: 0.4, tone: "muted" }] },
      ]}
    />
  );
}

function QuestKinds() {
  return (
    <Bars
      title="XP per quest kind (POI quests, clues and errands give XP only; city zones also pay prize money)."
      bars={[
        { label: "Category hunt", value: 90, tone: "world" },
        { label: "Landmark clue (right)", value: 70, tone: "core" },
        { label: "POI chest", value: 60, tone: "world" },
        { label: "Daily board bonus", value: 50, tone: "money" },
        { label: "POI visit", value: 40, tone: "world" },
        { label: "NPC errand (+10 clue)", value: 40, tone: "ai" },
        { label: "Landmark clue (wrong)", value: 20, tone: "muted" },
      ]}
      format={(v) => `${v} XP`}
    />
  );
}

function XpCurve() {
  return (
    <LineChart
      title="XP needed per level: 100 × (level − 1)². Each dot unlocks something to do or wear."
      xLabel="Level"
      yLabel="XP"
      markers
      xTicks={LEVELS.map((l) => l.level)}
      series={[{ label: "XP needed", points: LEVELS.map((l) => [l.level, l.xp]), tone: "core" }]}
    />
  );
}

function ActorDialog() {
  return (
    <Sequence
      title="An NPC conversation: rules first, words second."
      lanes={["Player", "Game server", "AI model"]}
      msgs={[
        { from: 0, to: 1, label: "Talk (encounter ≤ 35 m)", tone: "player" },
        { from: 1, to: 1, label: "Build offer menu from rules", tone: "core" },
        { from: 1, to: 2, label: "Persona + menu + question", tone: "ai" },
        { from: 2, to: 1, label: "Reply + chosen offer index", tone: "ai" },
        { from: 1, to: 1, label: "Filter text · verify signature", tone: "core" },
        { from: 1, to: 0, label: "Short line + action buttons", tone: "player" },
      ]}
    />
  );
}

function MonsterFlow() {
  return (
    <Flow
      title="A monster encounter. Power is level + skill only; nothing can be wagered."
      width={720}
      height={240}
      nodes={[
        { id: "meet", x: 80, y: 120, label: "Encounter", tone: "player" },
        { id: "pick", x: 240, y: 120, label: "Pick challenge", sub: "quiz · rhythm · duel", tone: "ai" },
        { id: "win", x: 450, y: 50, label: "Win", sub: "XP · shards · ticket", tone: "money", pulse: true },
        { id: "lose", x: 450, y: 190, label: "Loss", sub: "1 h cooldown", tone: "warn" },
        { id: "altar", x: 640, y: 50, label: "Altar / roll", tone: "core" },
        { id: "chest", x: 640, y: 120, label: "Guarded chest opens", tone: "world" },
      ]}
      edges={[
        { from: "meet", to: "pick", flow: true },
        { from: "pick", to: "win", flow: true, tone: "money" },
        { from: "pick", to: "lose", tone: "warn" },
        { from: "win", to: "altar", tone: "core" },
        { from: "win", to: "chest", tone: "world" },
      ]}
    />
  );
}

function WispRoll() {
  return (
    <Sequence
      title="Wisp roll with commit-reveal: the outcome depends on a block the player could not know when committing."
      lanes={["Player", "Game server", "npc-games contract"]}
      msgs={[
        { from: 0, to: 1, label: "Win lurker quiz", tone: "player" },
        { from: 1, to: 0, label: "Signed roll ticket", tone: "core" },
        { from: 0, to: 2, label: "start_roll(ticket, commitment)", tone: "chain" },
        { from: 2, to: 2, label: "wait ≥ 3 blocks", tone: "muted" },
        { from: 0, to: 2, label: "resolve_roll(secret)", tone: "chain" },
        { from: 2, to: 0, label: "Prize from block randomness", tone: "money" },
        { from: 0, to: 2, label: "redeem_aura → NFT", tone: "chain" },
      ]}
    />
  );
}

const RARITY_TONE: Record<string, Tone> = { common: "muted", rare: "world", epic: "ai", legendary: "money" };
function AuraCatalog() {
  const sources = ["chest", "level", "npc", "monster", "season"];
  const rarities = ["common", "rare", "epic", "legendary"];
  return (
    <figure className="wk-fig">
      <div className="wk-matrix" role="table" aria-label="Aura editions by source and rarity">
        <div role="row" className="wk-matrix-row head">
          <span role="columnheader">Source</span>
          {rarities.map((r) => (
            <span role="columnheader" key={r} className={`tone-${RARITY_TONE[r]}`}>
              {r}
            </span>
          ))}
        </div>
        {sources.map((s) => (
          <div role="row" className="wk-matrix-row" key={s}>
            <span role="rowheader">{s}</span>
            {rarities.map((r) => {
              const n = EDITIONS.filter((e) => e.source === s && e.rarity === r).length;
              return (
                <span role="cell" key={r} className={`wk-cell tone-${RARITY_TONE[r]}`} data-empty={n === 0}>
                  {Array.from({ length: n }, (_, i) => (
                    <i key={i} className="wk-gem" style={{ animationDelay: `${i * 0.15}s` }} />
                  ))}
                  <b>{n || "–"}</b>
                </span>
              );
            })}
          </div>
        ))}
      </div>
      <figcaption>Every gem is one edition from the live catalog ({EDITIONS.length} in total).</figcaption>
    </figure>
  );
}

function AuraSecure() {
  return (
    <Flow
      title="From a chest to a tradable NFT, without a wallet pop-up."
      width={720}
      height={200}
      nodes={[
        { id: "chest", x: 80, y: 100, label: "Chest / roll / level", tone: "world" },
        { id: "inv", x: 240, y: 100, label: "Inventory", sub: "server award", tone: "core" },
        { id: "redeem", x: 410, y: 100, label: "redeem_aura", sub: "device key + relayer", tone: "chain", pulse: true },
        { id: "nft", x: 580, y: 50, label: "Aura NFT", sub: "your NEAR account", tone: "money" },
        { id: "sell", x: 580, y: 160, label: "Sell / trade", sub: "Intents · Mintbase", tone: "chain" },
      ]}
      edges={[
        { from: "chest", to: "inv", flow: true },
        { from: "inv", to: "redeem", flow: true, tone: "chain" },
        { from: "redeem", to: "nft", flow: true, tone: "money" },
        { from: "nft", to: "sell", tone: "chain" },
      ]}
    />
  );
}

// ---------------------------------------------------------------- world ----

function CoverageTiers() {
  return (
    <Flow
      title="Coverage: the more a place is reviewed, the more it can hold. Only reviewed cities get real-money days."
      width={720}
      height={220}
      nodes={[
        { id: "a", x: 120, y: 110, w: 180, h: 80, label: "A · reviewed city", sub: "6 zones · funded days", tone: "money", pulse: true },
        { id: "b", x: 360, y: 110, w: 180, h: 80, label: "B · auto city", sub: "85 towns · practice", tone: "world" },
        { id: "c", x: 600, y: 110, w: 180, h: 80, label: "C · street cell", sub: "every H3 res-7 cell", tone: "core" },
      ]}
      edges={[
        { from: "c", to: "b", label: "town ≥ 15k", dashed: true, tone: "world" },
        { from: "b", to: "a", label: "human review", dashed: true, tone: "money" },
      ]}
    />
  );
}

function PoiPipeline() {
  return (
    <Flow
      title="Weekly POI import on the server: open data in, safe quest places out."
      width={720}
      height={210}
      nodes={[
        { id: "osm", x: 80, y: 40, label: "OpenStreetMap", tone: "world" },
        { id: "ov", x: 80, y: 105, label: "Overture", tone: "world" },
        { id: "wd", x: 80, y: 170, label: "Wikidata", tone: "world" },
        { id: "tax", x: 280, y: 105, label: "Taxonomy", sub: "categories", tone: "core" },
        { id: "safe", x: 450, y: 105, label: "Safety filter", sub: "40 m snap · 25 m buffer", tone: "warn", pulse: true },
        { id: "db", x: 630, y: 105, label: "current.sqlite", sub: "read-only for game", tone: "core" },
      ]}
      edges={[
        { from: "osm", to: "tax", flow: true, tone: "world" },
        { from: "ov", to: "tax", flow: true, tone: "world" },
        { from: "wd", to: "tax", flow: true, tone: "world" },
        { from: "tax", to: "safe", flow: true },
        { from: "safe", to: "db", flow: true },
      ]}
    />
  );
}

function MapFormula() {
  return (
    <StackBar
      title="How the day's zone prizes are shared between cells (coins are equal everywhere). Votes take up to half; unused vote share flows to the rest."
      segments={[
        { label: "Votes (QGOLD holders)", value: 50, tone: "ai" },
        { label: "Demand (players, 7 days)", value: 20, tone: "player" },
        { label: "Random (3 % of cells)", value: 15, tone: "warn" },
        { label: "Potential (√ places)", value: 10, tone: "world" },
        { label: "Stake (stakers, 30 days)", value: 5, tone: "money" },
      ]}
    />
  );
}

function MapMerkle() {
  return (
    <Flow
      title="One Merkle root per day: the contract pays a cell claim only with a valid proof."
      width={720}
      height={260}
      nodes={[
        { id: "root", x: 360, y: 40, label: "Day root", sub: "publish_map_day", tone: "chain", pulse: true },
        { id: "h1", x: 220, y: 125, label: "hash", tone: "muted", w: 90 },
        { id: "h2", x: 500, y: 125, label: "hash", tone: "muted", w: 90 },
        { id: "c1", x: 120, y: 215, label: "cell A", sub: "coins · zones", tone: "world", w: 110 },
        { id: "c2", x: 290, y: 215, label: "cell B", tone: "world", w: 110 },
        { id: "c3", x: 430, y: 215, label: "cell C", tone: "world", w: 110 },
        { id: "c4", x: 600, y: 215, label: "cell D", sub: "pioneer ×2", tone: "money", w: 110 },
      ]}
      edges={[
        { from: "c1", to: "h1", tone: "muted" },
        { from: "c2", to: "h1", tone: "muted" },
        { from: "c3", to: "h2", tone: "muted" },
        { from: "c4", to: "h2", tone: "muted" },
        { from: "h1", to: "root", flow: true, tone: "chain" },
        { from: "h2", to: "root", flow: true, tone: "chain" },
      ]}
    />
  );
}

// -------------------------------------------------------------- economy ----

function MoneyFlow() {
  return (
    <Flow
      title="Money flow: yield and fees fill one treasury; daily budgets pay players; burns and fees raise QGOLD's backing rate."
      width={720}
      height={400}
      nodes={[
        { id: "lst", x: 90, y: 40, label: "Liquid staking", sub: "stNEAR · LiNEAR", tone: "money" },
        { id: "lend", x: 90, y: 110, label: "Rhea Lend", sub: "USDC · USDT", tone: "money" },
        { id: "vaults", x: 90, y: 180, label: "Player stake vaults", sub: "yield share", tone: "money" },
        { id: "fees", x: 90, y: 250, label: "Fees", sub: "2 % trades · 10 % tasks", tone: "warn" },
        { id: "sponsor", x: 90, y: 320, label: "Sponsors & traders", sub: "surplus sweeps", tone: "warn" },
        { id: "treasury", x: 330, y: 180, w: 160, h: 70, label: "Global treasury", sub: "rewards contract", tone: "chain", pulse: true },
        { id: "budget", x: 540, y: 110, label: "Daily budget", sub: "city days · map plan", tone: "core" },
        { id: "players", x: 540, y: 250, label: "Players", sub: "coins · zone prizes", tone: "player" },
        { id: "qgold", x: 640, y: 350, label: "QGOLD vault", sub: "backing R", tone: "money" },
      ]}
      edges={[
        { from: "lst", to: "treasury", flow: true, tone: "money" },
        { from: "lend", to: "treasury", flow: true, tone: "money" },
        { from: "vaults", to: "treasury", flow: true, tone: "money" },
        { from: "fees", to: "treasury", flow: true, tone: "warn" },
        { from: "sponsor", to: "treasury", flow: true, tone: "warn" },
        { from: "treasury", to: "budget", flow: true, tone: "core" },
        { from: "budget", to: "players", flow: true, tone: "player" },
        { from: "players", to: "qgold", label: "claim as QGOLD", flow: true, tone: "money" },
        { from: "treasury", to: "players", label: "unclaimed stays", dashed: true, tone: "muted", bend: 0.5 },
      ]}
    />
  );
}

type Mix = { total: string; buckets: { bucket: string; currentBps: number; targetBps: number }[] } | null;
function TreasuryMix() {
  const mix = useJson<Mix>("/api/treasury/mix");
  const names: Record<string, string> = { staked: "Staked NEAR", lst: "Liquid staking", stable: "Stablecoins on Rhea", near: "NEAR reserve" };
  const tones: Record<string, Tone> = { staked: "core", lst: "money", stable: "world", near: "chain" };
  const target = [
    { label: names.staked, value: 90, tone: tones.staked },
    { label: "USDC on Rhea", value: 5, tone: tones.stable },
    { label: "USDT on Rhea", value: 5, tone: "money" as Tone },
  ];
  const live = mix?.buckets?.length
    ? mix.buckets.filter((b) => b.currentBps > 0).map((b) => ({ label: names[b.bucket] ?? b.bucket, value: b.currentBps / 100, tone: tones[b.bucket] ?? "core" }))
    : null;
  return (
    <div className="wk-pair">
      <Donut segments={target} title="Target mix" center="target" />
      {live && live.some((s) => s.value > 0) ? (
        <Donut segments={live} title="Live mix now (from /api/treasury/mix)" center="live" />
      ) : (
        <figure className="wk-fig wk-empty">
          <p>Live mix appears here when the treasury reader answers.</p>
        </figure>
      )}
    </div>
  );
}

// The treasury mix the DAO adopted (11 Nov 2026): 90 % staked NEAR, 5 % USDC,
// 5 % USDT. On testnet only validator staking earns; the stablecoins earn 0.
const MIX_STAKED = 0.9,
  MIX_STABLE = 0.1;
function YieldSim() {
  const [treasury, setTreasury] = useState(1000);
  const [stakeApr, setStakeApr] = useState(9.8);
  const [stableApr, setStableApr] = useState(0);
  const [share, setShare] = useState(100);
  const apr = MIX_STAKED * stakeApr + MIX_STABLE * stableApr;
  const daily = (treasury * (apr / 100) * (share / 100)) / 365;
  const coins = daily * 0.5,
    zones = daily * 0.5;
  const year = Array.from({ length: 13 }, (_, m) => [m, daily * 30.4 * m] as [number, number]);
  return (
    <figure className="wk-fig wk-sim">
      <div className="wk-controls">
        <label>
          Treasury <b>{treasury.toLocaleString("en-US")} NEAR</b>
          <input type="range" min={10} max={20000} step={10} value={treasury} onChange={(e) => setTreasury(Number(e.target.value))} />
        </label>
        <label>
          Staking yield on 90 % <b>{stakeApr} % a year</b>
          <input type="range" min={1} max={14} step={0.1} value={stakeApr} onChange={(e) => setStakeApr(Number(e.target.value))} />
        </label>
        <label>
          Stablecoin yield on 5 % + 5 % <b>{stableApr} % a year</b>
          <input type="range" min={0} max={12} step={0.5} value={stableApr} onChange={(e) => setStableApr(Number(e.target.value))} />
        </label>
        <label>
          Share released <b>{share} %</b>
          <input type="range" min={10} max={100} step={5} value={share} onChange={(e) => setShare(Number(e.target.value))} />
        </label>
      </div>
      <div className="wk-kpis">
        <span>
          <small>Daily budget ({apr.toFixed(1)} % blended)</small>
          <b>{daily.toFixed(3)} NEAR</b>
        </span>
        <span>
          <small>Street coins</small>
          <b>{coins.toFixed(3)}</b>
        </span>
        <span>
          <small>Zone prizes</small>
          <b>{zones.toFixed(3)}</b>
        </span>
        <span>
          <small>Principal used</small>
          <b>0</b>
        </span>
      </div>
      <LineChart
        title="Paid to players over a year from yield alone; the principal stays untouched."
        xLabel="Months"
        yFormat={(v) => `${v.toFixed(v < 10 ? 1 : 0)} N`}
        series={[{ label: "Cumulative payouts", points: year, tone: "money" }]}
        height={200}
      />
    </figure>
  );
}

function StakingVault() {
  return (
    <Flow
      title="A staking vault's yield cycle. Every step is a permissionless call; no step can choose who gets paid."
      width={720}
      height={200}
      nodes={[
        { id: "stake", x: 80, y: 100, label: "Staked", sub: "E+2 to mature", tone: "money" },
        { id: "harvest", x: 240, y: 100, label: "harvest", sub: "gain above basis", tone: "core", pulse: true },
        { id: "unlock", x: 400, y: 100, label: "unlocking", sub: "≥ 4 epochs", tone: "muted" },
        { id: "withdraw", x: 540, y: 40, label: "withdraw", tone: "core" },
        { id: "flush", x: 640, y: 150, label: "flush_game", sub: "→ treasury", tone: "chain" },
      ]}
      edges={[
        { from: "stake", to: "harvest", flow: true, tone: "money" },
        { from: "harvest", to: "unlock", flow: true },
        { from: "unlock", to: "withdraw", flow: true },
        { from: "withdraw", to: "flush", flow: true, tone: "chain" },
        { from: "flush", to: "stake", label: "next epoch", dashed: true, bend: 0.4, tone: "muted" },
      ]}
    />
  );
}

type QgoldLive = { status: string; vault: null | { rate: string; supply: string; backing: string } } | null;
function QgoldSim() {
  const live = useJson<QgoldLive>("/api/economy/qgold");
  const liveR = live?.vault?.rate ? Number(BigInt(live.vault.rate) / 10n ** 12n) / 1e12 : null;
  const [mintPerDay, setMint] = useState(50_000);
  const [burnPct, setBurn] = useState(5);
  const [tradeFees, setFees] = useState(0.5);
  const [days, setDays] = useState(60);
  const series = useMemo(() => {
    let supply = 1_000_000,
      backing = supply * 0.001;
    const pts: [number, number][] = [[0, (backing / supply) * 1000]];
    for (let d = 1; d <= days; d++) {
      const r = backing / supply;
      supply += mintPerDay;
      backing += mintPerDay * r; // mint at exactly R: R unchanged
      supply -= supply * (burnPct / 100) * (1 / 30); // monthly burn share spread per day
      backing += tradeFees * 0.9; // vault fees to backing side (simplified)
      pts.push([d, (backing / supply) * 1000]);
    }
    return pts;
  }, [mintPerDay, burnPct, tradeFees, days]);
  const end = series.at(-1)![1];
  return (
    <figure className="wk-fig wk-sim">
      <div className="wk-controls">
        <label>
          QGOLD minted per day <b>{mintPerDay.toLocaleString("en-US")}</b>
          <input type="range" min={0} max={200000} step={5000} value={mintPerDay} onChange={(e) => setMint(Number(e.target.value))} />
        </label>
        <label>
          Burned in game per month <b>{burnPct} %</b>
          <input type="range" min={0} max={20} step={1} value={burnPct} onChange={(e) => setBurn(Number(e.target.value))} />
        </label>
        <label>
          Fee NEAR into backing per day <b>{tradeFees}</b>
          <input type="range" min={0} max={5} step={0.1} value={tradeFees} onChange={(e) => setFees(Number(e.target.value))} />
        </label>
        <label>
          Days <b>{days}</b>
          <input type="range" min={10} max={365} step={5} value={days} onChange={(e) => setDays(Number(e.target.value))} />
        </label>
      </div>
      <div className="wk-kpis">
        <span>
          <small>R at start</small>
          <b>1.000 mNEAR</b>
        </span>
        <span>
          <small>R after {days} days</small>
          <b>{end.toFixed(3)} mNEAR</b>
        </span>
        <span>
          <small>Live R on testnet</small>
          <b>{liveR != null ? `${(liveR * 1000).toFixed(4)} mNEAR` : "—"}</b>
        </span>
      </div>
      <LineChart
        title="Model of R (milli-NEAR per QGOLD). Mints keep R flat; burns and fees lift it. It never falls through a call."
        xLabel="Day"
        yFormat={(v) => v.toFixed(3)}
        series={[
          { label: "R", points: series, tone: "money" },
          { label: "Start", points: [[0, 1], [days, 1]], tone: "muted", dashed: true },
        ]}
        height={220}
      />
      <p className="wk-small">
        A teaching model with made-up volumes, not a forecast. Real numbers are on <a href="/economy">Economy</a>.
      </p>
    </figure>
  );
}

function QgoldExit() {
  return (
    <Flow
      title="Redeeming QGOLD: burn first, then pay at most your share, instantly within the caps or after the safe window."
      width={720}
      height={230}
      nodes={[
        { id: "burn", x: 90, y: 115, label: "Burn own QGOLD", sub: "redeem(amount)", tone: "player", pulse: true },
        { id: "share", x: 270, y: 115, label: "Share = amount × R", sub: "minus 1 %", tone: "core" },
        { id: "caps", x: 450, y: 115, label: "Within caps?", sub: "5 % global · 1 % account / 24 h", tone: "warn" },
        { id: "now", x: 640, y: 50, label: "Paid now", tone: "money" },
        { id: "queue", x: 640, y: 180, label: "Queued 24–48 h", sub: "claim_exit → only you", tone: "muted" },
      ]}
      edges={[
        { from: "burn", to: "share", flow: true },
        { from: "share", to: "caps", flow: true },
        { from: "caps", to: "now", label: "yes", flow: true, tone: "money" },
        { from: "caps", to: "queue", label: "no", tone: "muted" },
      ]}
    />
  );
}

function QgoldKeeper() {
  return (
    <LineChart
      title="Keeper bands around R: buy and burn below R, buy back below 1.1 R, sell on the 1.1 / 1.2 / 1.3 R ladder."
      xLabel="Pool price relative to R"
      xTicks={[0.9, 1, 1.1, 1.2, 1.3]}
      xFormat={(v) => `${v.toFixed(1)} R`}
      yFormat={(v) => (v > 0 ? "sell" : v < 0 ? "buy" : "hold")}
      series={[
        {
          label: "Keeper action",
          points: [
            [0.9, -2],
            [0.999, -2],
            [1.0, -1],
            [1.099, -1],
            [1.1, 1],
            [1.199, 1],
            [1.2, 2],
            [1.299, 2],
            [1.3, 3],
          ],
          tone: "money",
        },
      ]}
      height={200}
    />
  );
}

function Fees() {
  return (
    <Bars
      title="Fees by activity. All of them go to the treasury and return to players through the daily budget."
      bars={[
        { label: "Tasks & paid content", value: 10, tone: "warn", note: "on top" },
        { label: "Peer-to-peer trades", value: 2, tone: "chain" },
        { label: "Aura royalty (outside markets)", value: 2, tone: "chain" },
        { label: "QGOLD deposit / redeem", value: 1, tone: "money" },
        { label: "Sends & conditional sends", value: 0, tone: "muted" },
      ]}
      format={(v) => `${v} %`}
      max={10}
    />
  );
}

function GoldPrices() {
  const items = [
    ...GOLD.cosmetics.map((c) => ({ label: `Frame ${c.id.replace("frame-", "")}`, value: c.price, tone: "ai" as Tone })),
    { label: "NPC gear (rare)", value: GOLD.gear.price.rare, tone: "world" as Tone },
    { label: "NPC gear (epic)", value: GOLD.gear.price.epic, tone: "money" as Tone },
    { label: "Altar fee", value: GOLD.altar.default, tone: "muted" as Tone },
  ].sort((a, b) => b.value - a.value);
  return <Bars title="QGOLD prices from server/data/gold-spend.json; every price is burned, never paid to anyone." bars={items} format={(v) => `${v} QGOLD`} />;
}

function StakerLadder() {
  const steps = ["staker", "tier2", "tier3"] as const;
  const label = { staker: `Staker · ${STAKER_MIN_NEAR} NEAR`, tier2: "Tier 2", tier3: "Tier 3" };
  return (
    <figure className="wk-fig">
      <div className="wk-ladder" role="table" aria-label="Staker gates by step and level">
        {steps.map((s, i) => (
          <div key={s} className="wk-ladder-step" role="row" style={{ marginLeft: `${i * 8}%` }}>
            <b role="rowheader">{label[s]}</b>
            <span role="cell">
              {STAKER_GATES.filter((g) => g.step === s)
                .sort((a, b) => a.level - b.level)
                .map((g) => (
                  <em key={g.id}>
                    L{g.level} · {g.label}
                  </em>
                ))}
            </span>
          </div>
        ))}
      </div>
      <figcaption>Perks open by step and level, read live from server/data/staker-gates.json.</figcaption>
    </figure>
  );
}

function PatronRank() {
  return (
    <LineChart
      title="Patron rank ladder: epochs of matured stake needed for each rank (no decay)."
      xLabel="Rank"
      yLabel="Epochs"
      markers
      xTicks={[0, 1, 2, 3, 4, 5]}
      xFormat={(v) => ["Staker", "Spark", "Ember", "Lantern", "Beacon", "Hearth"][v] ?? ""}
      series={[{ label: "Epochs", points: [[0, 0], [1, 1], [2, 4], [3, 14], [4, 28], [5, 60]], tone: "money" }]}
      height={220}
    />
  );
}

// ---------------------------------------------------------------- chain ----

function ChainStates() {
  return (
    <figure className="wk-fig">
      <div className="wk-states" role="list" aria-label="On-chain proof stages">
        {[
          { k: "sending", t: "Sending", d: "Signed, waiting for a hash", tone: "muted" },
          { k: "received", t: "Received", d: "Transaction hash known", tone: "chain" },
          { k: "final", t: "Final", d: "Receipt succeeded", tone: "money" },
          { k: "failed", t: "Not saved", d: "Failed; retry is safe", tone: "warn" },
        ].map((s, i) => (
          <div key={s.k} role="listitem" className={`wk-state tone-${s.tone}`} style={{ animationDelay: `${i * 1.2}s` }}>
            <span className={`wk-cube ${s.k}`} aria-hidden="true" />
            <b>{s.t}</b>
            <small>{s.d}</small>
          </div>
        ))}
      </div>
      <figcaption>The cube icon cycles through these stages; tap it to open the transaction in the explorer.</figcaption>
    </figure>
  );
}

function ChainSplit() {
  return (
    <Bars
      title="Which actions settle on NEAR today (bar = how much of the action is on chain)."
      max={100}
      format={(v) => (v >= 100 ? "on chain" : v >= 50 ? "partly" : v > 0 ? "recorded" : "game DB")}
      bars={[
        { label: "Aura NFTs (secure, trade)", value: 100, tone: "chain" },
        { label: "Badges", value: 100, tone: "chain" },
        { label: "Wisp rolls", value: 100, tone: "chain" },
        { label: "Peer & NPC trades", value: 100, tone: "chain" },
        { label: "Stake & yield vaults", value: 100, tone: "chain" },
        { label: "Funded city & map days", value: 100, tone: "money" },
        { label: "QGOLD mint / burn / exit", value: 100, tone: "money" },
        { label: "Map coins & zone prizes", value: 100, tone: "money", note: "payout rounds" },
        { label: "GOLD spending", value: 100, tone: "money", note: "ft_burn" },
        { label: "Task market & Secrets", value: 100, tone: "money", note: "QGOLD escrow" },
        { label: "XP", value: 30, tone: "core", note: "QXP ledger" },
      ]}
    />
  );
}

function AccountSeq() {
  return (
    <Sequence
      title="An invisible NEAR account: created for you, controlled only by your device."
      lanes={["Device", "Game server", "Relayer", "NEAR"]}
      msgs={[
        { from: 0, to: 0, label: "Generate key pair", tone: "player" },
        { from: 0, to: 1, label: "Create account (public key)", tone: "player" },
        { from: 1, to: 3, label: "create + 0.02 NEAR + add key", tone: "chain" },
        { from: 0, to: 0, label: "Sign delegate action", tone: "player" },
        { from: 0, to: 2, label: "POST /api/relay", tone: "core" },
        { from: 2, to: 2, label: "Policy check · budget", tone: "core" },
        { from: 2, to: 3, label: "Submit, pay gas", tone: "chain" },
        { from: 3, to: 0, label: "Receipt → proof icon", tone: "money" },
      ]}
    />
  );
}

function IntentsSeq() {
  return (
    <Sequence
      title="Selling an Aura through NEAR Intents: two signed diffs, one atomic settlement."
      lanes={["Seller", "Buyer", "Solver", "Verifier"]}
      msgs={[
        { from: 0, to: 3, label: "Deposit Aura", tone: "chain" },
        { from: 0, to: 2, label: "Signed: −Aura +wNEAR", tone: "player" },
        { from: 1, to: 2, label: "Signed: −wNEAR +Aura", tone: "player" },
        { from: 2, to: 3, label: "execute_intents(both)", tone: "chain" },
        { from: 3, to: 3, label: "Check sums · 2 % fee", tone: "warn" },
        { from: 3, to: 1, label: "Aura", tone: "money" },
        { from: 3, to: 0, label: "wNEAR − fee", tone: "money" },
      ]}
    />
  );
}

// ------------------------------------------------------------- platform ----

function AiChain() {
  return (
    <Flow
      title="Provider fallback for NPC talk. Every path ends in a reply; the menu always comes from the server."
      width={720}
      height={200}
      nodes={[
        { id: "q", x: 80, y: 100, label: "NPC question", tone: "player" },
        { id: "near", x: 270, y: 100, label: "NEAR AI Cloud", sub: "TEE · attested", tone: "ai", pulse: true },
        { id: "ollama", x: 450, y: 100, label: "Ollama", sub: "fallback", tone: "ai" },
        { id: "tpl", x: 630, y: 100, label: "Template", sub: "always works", tone: "muted" },
      ]}
      edges={[
        { from: "q", to: "near", flow: true, tone: "ai" },
        { from: "near", to: "ollama", label: "timeout / error", dashed: true },
        { from: "ollama", to: "tpl", label: "timeout / error", dashed: true },
      ]}
    />
  );
}

function FairPlay() {
  return (
    <Bars
      title="Daily XP caps from location play (the claim still succeeds; extra XP is trimmed)."
      bars={[
        { label: "XP per day", value: 3000, tone: "core" },
        { label: "XP per cell per day", value: 600, tone: "world" },
        { label: "Cells per day", value: 12, tone: "muted", note: "cells" },
        { label: "Max speed (m/s)", value: 15, tone: "warn", note: "m/s" },
      ]}
    />
  );
}

function DailyJobs() {
  return (
    <Timeline24
      title="Background work over a UTC day."
      rows={[
        { label: "Prague midnight publish", spans: [{ from: 23, to: 23.4, tone: "chain" }] },
        { label: "Quest flavour batch", spans: [{ from: 1, to: 2, label: "AI", tone: "ai" }] },
        { label: "POI import (Sundays)", spans: [{ from: 2.66, to: 3.2, tone: "world" }] },
        { label: "Database backup", spans: [{ from: 3.33, to: 3.6, tone: "core" }] },
        { label: "Harvest + mix (06:30 CET)", spans: [{ from: 5.5, to: 6, tone: "money" }] },
        { label: "Reward worker", spans: [{ from: 0, to: 24, label: "every 30 s", tone: "chain" }] },
        { label: "QGOLD payout rounds", spans: [{ from: 0, to: 24, label: "every 5 min", tone: "money" }] },
        { label: "QGOLD keeper", spans: [{ from: 0, to: 24, label: "every 5 min", tone: "money" }] },
        { label: "Trader keeper", spans: [{ from: 0, to: 24, label: "every 10 min", tone: "ai" }] },
      ]}
    />
  );
}

function CiGates() {
  return (
    <Flow
      title="Every change passes these gates before it can merge."
      width={720}
      height={200}
      nodes={[
        { id: "pr", x: 70, y: 100, label: "Change", tone: "player", w: 100 },
        { id: "check", x: 230, y: 50, label: "Build · budget · tests", sub: "incl. wiki check", tone: "core" },
        { id: "e2e", x: 230, y: 150, label: "Phone journeys", sub: "3 devices · languages", tone: "world" },
        { id: "wasm", x: 430, y: 50, label: "Reproducible WASM", sub: "pinned sha256", tone: "chain" },
        { id: "clean", x: 430, y: 150, label: "Clean clone", tone: "muted" },
        { id: "merge", x: 620, y: 100, label: "Merge → deploy", tone: "money", pulse: true },
      ]}
      edges={[
        { from: "pr", to: "check", flow: true },
        { from: "pr", to: "e2e", flow: true },
        { from: "check", to: "wasm", flow: true },
        { from: "e2e", to: "clean", flow: true },
        { from: "wasm", to: "merge", flow: true, tone: "money" },
        { from: "clean", to: "merge", flow: true, tone: "money" },
      ]}
    />
  );
}

function WikiLoop() {
  return (
    <Flow
      title="The update loop: a mechanism change is not done until its chapter is."
      width={720}
      height={220}
      nodes={[
        { id: "code", x: 90, y: 110, label: "Change a mechanism", tone: "player" },
        { id: "doc", x: 280, y: 40, label: "Update its doc", tone: "core" },
        { id: "wiki", x: 470, y: 40, label: "Update the chapter", tone: "ai" },
        { id: "stamp", x: 620, y: 110, label: "npm run wiki:stamp", tone: "money", pulse: true },
        { id: "ci", x: 380, y: 180, label: "CI: tests/wiki", sub: "fails on stale hash", tone: "warn" },
      ]}
      edges={[
        { from: "code", to: "doc", flow: true },
        { from: "doc", to: "wiki", flow: true },
        { from: "wiki", to: "stamp", flow: true },
        { from: "stamp", to: "ci", flow: true, tone: "warn" },
        { from: "ci", to: "code", label: "green → merge", dashed: true, tone: "muted" },
      ]}
    />
  );
}

function DaoFlow() {
  return (
    <Flow
      title="Who decides: explorers vote on the mix each week; the council approves each daily run only after checking it."
      width={720}
      height={250}
      nodes={[
        { id: "explorers", x: 95, y: 60, w: 150, label: "Explorers (L3+)", sub: "weekly mix vote, 1 : 1", tone: "player", pulse: true },
        { id: "keeper", x: 330, y: 60, w: 150, label: "Keeper", sub: "files polls, results, runs", tone: "core" },
        { id: "council", x: 590, y: 60, w: 170, label: "Council 2 of 3", sub: "approves after checks", tone: "chain", pulse: true },
        { id: "mix", x: 590, y: 190, w: 170, label: "Adopted mix", sub: "e.g. 90 / 5 / 5", tone: "money" },
        { id: "run", x: 330, y: 190, w: 150, label: "Daily run", sub: "≤ 25 % moved", tone: "money" },
        { id: "treasury", x: 95, y: 190, w: 150, label: "Treasury", sub: "staking · stables · NEAR", tone: "world" },
      ]}
      edges={[
        { from: "explorers", to: "keeper", label: "votes", flow: true, tone: "player" },
        { from: "keeper", to: "council", label: "proposal", flow: true, tone: "core" },
        { from: "council", to: "mix", label: "adopt", flow: true, tone: "chain" },
        { from: "mix", to: "run", label: "target", flow: true, tone: "money" },
        { from: "run", to: "treasury", label: "rebalance", flow: true, tone: "money" },
      ]}
    />
  );
}

const VIZ: Record<VizId, () => React.ReactElement> = {
  architecture: Architecture,
  "money-modes": MoneyModes,
  "core-loop": CoreLoop,
  "coverage-tiers": CoverageTiers,
  "poi-pipeline": PoiPipeline,
  "day-clock": DayClock,
  "quest-kinds": QuestKinds,
  "xp-curve": XpCurve,
  "level-unlocks": XpCurve,
  "actor-dialog": ActorDialog,
  "monster-flow": MonsterFlow,
  "wisp-roll": WispRoll,
  "aura-catalog": AuraCatalog,
  "aura-secure": AuraSecure,
  "money-flow": MoneyFlow,
  "treasury-mix": TreasuryMix,
  "yield-sim": YieldSim,
  "staking-vault": StakingVault,
  "qgold-sim": QgoldSim,
  "qgold-exit": QgoldExit,
  "qgold-keeper": QgoldKeeper,
  "map-formula": MapFormula,
  "map-merkle": MapMerkle,
  "map-coins": MapCoins,
  fees: Fees,
  "gold-prices": GoldPrices,
  "staker-ladder": StakerLadder,
  "patron-rank": PatronRank,
  "chain-states": ChainStates,
  "chain-split": ChainSplit,
  "account-seq": AccountSeq,
  "intents-seq": IntentsSeq,
  "ai-chain": AiChain,
  "fair-play": FairPlay,
  "daily-jobs": DailyJobs,
  "ci-gates": CiGates,
  "wiki-loop": WikiLoop,
  "payout-round": PayoutRound,
  "wearable-rarity": WearableRarity,
  "inbox-seq": InboxSeq,
  "phone-hud": SCENES["phone-hud"],
  "screen-map": SCENES["screen-map"],
  "dao-flow": DaoFlow,
};

export function Viz({ id }: { id: VizId }) {
  const C = VIZ[id];
  return C ? <C /> : null;
}
export const VIZ_IDS = Object.keys(VIZ);
