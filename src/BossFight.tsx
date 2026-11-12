import { ActorPortrait } from "./ActorPortrait";
// Weekly co-op boss sheet (NPC-PLAN §13.1, §13.4). Opened from the encounter
// sheet when the boss offers "Strike". Every player chips at one shared HP
// pool with a short mini-game; the server replays the inputs and turns the
// score into damage from level and skill only. Also shows the hunt pouch
// (shards, roll tickets) and crafting at the Golden Altar.
import { useEffect, useState } from "react";
import { Lightning, Trophy, Timer } from "@phosphor-icons/react";
import { api, ApiError } from "./api";
import { withQgoldBurn } from "./qgold-burn";
import { Dialog } from "./Dialog";
import { ChallengeExample } from "./ChallengeExample";
import { useLearning } from "./useLearning";
import { helpText } from "./activity-help";
import { ChallengePlay } from "./MonsterChallenge";
import { FORMAT_COPY, retryLabel, type Challenge, type ChallengeFormat, type MonsterRef } from "./monster-challenge";
import "./monster-challenge.css";
import { tr } from "./i18n";

type BossEvent = {
  id: string;
  weekId: string;
  hp: number;
  maxHp: number;
  state: "active" | "defeated";
  participants: number;
  hitsForEdition: number;
  leaderboard: { rank: number; name: string; hits: number; damage: number; you: boolean }[];
  you?: { hits: number; damage: number; nextHitAt: number | null };
};
type Hit = Challenge & { power: number };
type HitResult = { damage: number; landed: boolean; score: number; max: number; reason?: string; defeated: boolean; event: BossEvent };
type Pouch = {
  shards: Record<string, number>;
  shardTotal: number;
  shardsToday: number;
  dailyShardCap: number;
  rollTickets: number;
  guardianWins: number;
  craft: { edition: string; shards: number; ready: boolean; needs: string[]; perDay?: number };
  altar?: { perDay: number; craftedToday: number; recipes: Recipe[] };
};
type Recipe = {
  id: string;
  edition: string;
  name: string;
  rarity: string;
  element: string | null;
  shards: number;
  commons: number;
  guardian: boolean;
  ready: boolean;
  needs: string[];
};

function recipeCost(r: Recipe) {
  const shards = `${r.shards} ${r.element ? `${r.element} ` : ""}shards`;
  const commons = r.commons > 1 ? `${r.commons} common Auras` : "a common Aura";
  return `${shards} + ${commons}${r.guardian ? " · guardian win" : ""}`;
}

const NEEDS: Record<string, string> = {
  shards: "more shards of that kind",
  guardian: "a guardian win",
  get "common-aura"() { return tr("common Auras you are not wearing"); },
  daily: "tomorrow (daily offerings used)",
};

export function BossFight({
  actor,
  encounter,
  worldId,
  playerId,
  onClose,
}: {
  actor: MonsterRef;
  encounter: string;
  worldId: string;
  playerId?: string;
  onClose: () => void;
}) {
  const learning = useLearning(playerId);
  const [exampleFormat, setExampleFormat] = useState<ChallengeFormat>("rhythm");
  const base = `/actors/${encodeURIComponent(actor.id)}/boss`;
  const [event, setEvent] = useState<BossEvent | null>(null);
  const [hit, setHit] = useState<Hit | null>(null);
  const [result, setResult] = useState<HitResult | null>(null);
  const [pouch, setPouch] = useState<Pouch | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [crafted, setCrafted] = useState<string | null>(null);

  async function loadPouch() {
    try {
      const r = await api<Pouch & { boss: BossEvent | null }>(`/hunt?worldId=${encodeURIComponent(worldId)}`);
      setPouch(r);
      if (r.boss) setEvent((e) => e || r.boss);
    } catch {
      // The pouch is a bonus panel; the fight works without it.
    }
  }
  useEffect(() => {
    void loadPouch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [worldId]);

  async function strike() {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const r = await api<{ hit: Hit; event: BossEvent }>(base, { encounter });
      setEvent(r.event);
      setHit({ ...r.hit, actorId: actor.id });
      learning.acknowledge("boss");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : tr("The boss is out of reach."));
    } finally {
      setBusy(false);
    }
  }

  async function submit(input: unknown) {
    if (!hit) return;
    setBusy(true);
    try {
      const r = await api<HitResult>(`${base}/${hit.id}`, input);
      setResult(r);
      setEvent(r.event);
      setHit(null);
      void loadPouch();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : tr("Your hit did not land."));
      setHit(null);
    } finally {
      setBusy(false);
    }
  }

  async function craft(recipe?: string) {
    setBusy(true);
    setError(null);
    try {
      const r = await withQgoldBurn<Pouch & { crafted: { item: { name: string } } }>("/hunt/craft", { worldId, ...(recipe ? { recipe } : {}) });
      setPouch(r);
      setCrafted(r.crafted.item.name);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : tr("The altar did not answer."));
    } finally {
      setBusy(false);
    }
  }

  const ev = event;
  const nextAt = ev?.you?.nextHitAt ?? null;
  const waiting = !!nextAt && nextAt > Date.now();
  return (
    <Dialog presentation="encounter" label={tr("Weekly boss {0}", { 0: actor.name })} onClose={onClose}>
      <div className="monster-challenge monster-boss">
        <header className="monster-head">
          <div className="monster-portrait"><ActorPortrait model={actor.model} label={actor.name} /></div>
          <div>
            <h2>{actor.name}</h2>
            <p className="monster-sub">{tr("Weekly boss at the Great Portal")}{ev ? tr(" · week {0}", { 0: ev.weekId.split("-W")[1] }) : ""}</p>
          </div>
        </header>
        {ev && (
          <div className="boss-pool">
            <div className="boss-bar" role="meter" aria-label={tr("Boss health")} aria-valuemin={0} aria-valuemax={ev.maxHp} aria-valuenow={ev.hp}>
              <span style={{ width: `${(100 * ev.hp) / ev.maxHp}%` }} />
            </div>
            <p className="monster-sub">
              {ev.hp} / {ev.maxHp} {" "}{tr("HP ·")}{" "}{ev.participants === 1 ? tr("1 hunter") : tr("{0} hunters", { 0: ev.participants })}
              {ev.you ? tr(" · your hits: {0}", { 0: ev.you.hits }) : ""}
            </p>
          </div>
        )}
        {error && <p className="monster-error" role="alert">{error}</p>}
        {hit ? (
          <ChallengePlay
            challenge={hit}
            busy={busy}
            submit={submit}
            monster={actor}
            onDone={() => {}}
            onError={setError}
          />
        ) : ev?.state === "defeated" ? (
          <div className="monster-result won" role="status">
            <Trophy size={40} weight="fill" aria-hidden="true" />
            <h3>{tr("The boss is beaten this week!")}</h3>
            <p>
              {tr("Everyone who landed a hit earned XP and a roll ticket. Hunters with")}{" "}{ev.hitsForEdition}{tr("+ hits received the Bossbane Fangring.")}</p>
          </div>
        ) : (
          <>
            {result && (
              <p className={`monster-rewards ${result.landed ? "" : "missed"}`} role="status">
                {result.landed ? (
                  <>
                    <Lightning size={18} weight="fill" aria-hidden="true" /> {" "}{tr("You dealt {0} damage (score {1} of {2}).", { 0: result.damage, 1: result.score, 2: result.max })}
                  </>
                ) : (
                  tr("Your strike missed. Try again after the cooldown.")
                )}
              </p>
            )}
            <p className="monster-fair">
              {tr("1 hit every 10 min · {0} hits earn the Bossbane Fangring", { 0: ev?.hitsForEdition ?? 3 })}</p>
            {waiting ? (
              <p className="monster-tell">
                <Timer size={18} aria-hidden="true" /> {retryLabel(nextAt ?? undefined)}
              </p>
            ) : (
              <button type="button" className="monster-primary" disabled={busy} onClick={() => void strike()}>
                {tr("Strike the boss")}</button>
            )}
          </>
        )}
        {ev && ev.leaderboard.length > 0 && (
          <section className="boss-board" aria-label={tr("Hunters by hits")}>
            <h3>{tr("Hunters by hits")}</h3>
            <ol>
              {ev.leaderboard.map((r) => (
                <li key={r.rank} className={r.you ? "you" : undefined}>
                  <span>{r.name}</span>
                  <span>{tr("{0} hits", { 0: r.hits })}</span>
                </li>
              ))}
            </ol>
          </section>
        )}
        {pouch && (
          <section className="hunt-pouch" aria-label={tr("Hunt pouch")}>
            <h3>{tr("Hunt pouch")}</h3>
            <p className="monster-sub">
              {tr("Shards:")}{" "}
              {Object.entries(pouch.shards)
                .map(([k, v]) => `${k} ${v}`)
                .join(" · ")}{" "}
              {tr("· roll tickets")}{" "}{pouch.rollTickets}
            </p>
            {pouch.rollTickets > 0 && (
              <p className="monster-sub">{tr("Spend roll tickets at the wisp: Inventory, Secured tab.")}</p>
            )}
            {crafted && <p className="monster-rewards">{tr("The Golden Altar gave you")}{" "}{crafted}.</p>}
            {pouch.altar ? (
              <>
                <p className="monster-sub">
                  {tr("Golden Altar · offerings today")}{" "}{pouch.altar.craftedToday}/{pouch.altar.perDay}
                </p>
                <ul className="altar-recipes">
                  {pouch.altar.recipes.map((r) => (
                    <li key={r.id} className={`altar-recipe rarity-${r.rarity}`}>
                      <div>
                        <strong>{r.name}</strong> <span className="monster-sub">({r.rarity})</span>
                        <p className="monster-sub">{recipeCost(r)}</p>
                        {!r.ready && (
                          <p className="monster-sub">{tr("Still missing:")}{" "}{r.needs.map((n) => NEEDS[n] || n).join(", ")}.</p>
                        )}
                      </div>
                      {r.ready && (
                        <button type="button" className="monster-primary" disabled={busy} onClick={() => void craft(r.id)}>
                          {tr("Offer")}</button>
                      )}
                    </li>
                  ))}
                </ul>
              </>
            ) : pouch.craft.ready ? (
              <button type="button" className="monster-primary" disabled={busy} onClick={() => void craft()}>
                {tr("Offer")}{" "}{pouch.craft.shards} {" "}{tr("shards and a common Aura for Wardbreaker Horns")}</button>
            ) : (
              <p className="monster-sub">
                {tr("Wardbreaker Horns at the Golden Altar need")}{" "}{pouch.craft.shards} {" "}{tr("shards. Still missing:")}{" "}
                {pouch.craft.needs.map((n) => NEEDS[n] || n).join(", ")}.
              </p>
            )}
          </section>
        )}
        {!hit && (
          <button type="button" className="monster-secondary" onClick={onClose}>
            {tr("Back to the map")}</button>
        )}
      </div>
    </Dialog>
  );
}

